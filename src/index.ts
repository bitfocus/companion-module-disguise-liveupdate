import {
	InstanceBase,
	InstanceStatus,
	runEntrypoint,
	SomeCompanionConfigField,
	CompanionStaticUpgradeScript,
} from '@companion-module/base'
import WebSocket from 'ws'
import { getConfigFields, DisguiseConfig } from './config'
import { isReservedVariableName, isSelectionId, readSelections, UNSET_SELECTION, validateSelection } from './selections'
import { getActionDefinitions } from './actions'
import { getFeedbackDefinitions } from './feedbacks'
import { getPresetDefinitions } from './presets'
import { getVariableDefinitions } from './variables'
import { upgradeScripts } from './upgrades'

/**
 * Config keys that require the WebSocket connection to be re-established when they change
 */
const CONNECTION_CONFIG_KEYS = ['host', 'port', 'reconnectInterval', 'pendingSubscriptionTimeout'] as const

const BACKOFF_BASE_MS = 2000
const BACKOFF_MAX_MS = 60000

/** Template placeholders such as <TRACK_NAME> or <OBJECT_PATH> */
const PLACEHOLDER_TOKEN = /<[A-Z][A-Z0-9_]*>/

/** Empty argument or index slots left by an unset selection: f(, 1), f(1, ), f(,), a[] */
const EMPTY_SLOT = /\(\s*,|,\s*\)|,\s*,|\[\s*\]/

/**
 * Paths that must not be sent to the Director: template placeholders, unresolved Companion
 * variable references ($NA or a raw $(...) reference), empty quoted names, empty argument slots
 * and the remote-monitor node form without a hostname.
 */
export function isUnresolvedPath(path: string): boolean {
	const trimmed = path.trim()
	if (!trimmed) return true
	if (PLACEHOLDER_TOKEN.test(trimmed)) return true
	if (trimmed.includes('$NA')) return true
	if (/\$\([^)]*\)/.test(trimmed)) return true
	if (trimmed.includes('""') || trimmed.includes("''")) return true
	if (EMPTY_SLOT.test(trimmed)) return true
	if (/"\s*:d3"/.test(trimmed)) return true
	return false
}

/**
 * Key of an (object path, property path) pair; the Director echoes both strings back verbatim
 */
function pairKey(objectPath: string, propertyPath: string): string {
	return `${objectPath.trim()}\n${propertyPath.trim()}`
}

/**
 * Convert a ws message payload to a UTF-8 string
 */
function rawDataToString(data: WebSocket.RawData): string {
	if (Buffer.isBuffer(data)) return data.toString('utf8')
	if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
	return Buffer.from(data).toString('utf8')
}

/**
 * Represents a subscription in the LiveUpdate API
 */
export interface LiveUpdateSubscription {
	id: number
	objectPath: string
	propertyPath: string
	/** The feedback that created the subscription; other feedbacks may share it (see feedbackIdToSubscriptionId) */
	feedbackId: string
	variableName: string
	value?: any
	changeTimestamp?: number
	messageTimestamp?: number
	errorCount?: number
}

/**
 * A subscribe request that the Director has not confirmed yet. All feedbacks that asked for the
 * same pair while the request was in flight are collected here instead of sending it again.
 */
interface PendingSubscription {
	objectPath: string
	propertyPath: string
	variableName: string
	feedbackIds: Set<string>
	timestamp: number
}

interface FeedbackOptionsCacheEntry {
	objectPath: string
	propertyPath: string
	variableName: string
	updateFrequency?: number
}

interface BackoffEntry {
	attempts: number
	notBefore: number
	timer?: NodeJS.Timeout
}

/**
 * Disguise Designer module instance with LiveUpdate API support
 */
export class DisguiseInstance extends InstanceBase<DisguiseConfig> {
	public config!: DisguiseConfig
	private ws: WebSocket | null = null
	private reconnectTimer: NodeJS.Timeout | undefined
	private pendingCleanupTimer: NodeJS.Timeout | undefined
	private subscriptions: Map<number, LiveUpdateSubscription> = new Map()
	private feedbackIdToSubscriptionId: Map<string, number> = new Map()
	private pendingSubscriptions: Map<string, PendingSubscription> = new Map()
	public feedbackOptionsCache: Map<string, FeedbackOptionsCacheEntry> = new Map()
	/** Per-feedback back-off after failed subscriptions (guards against subscribe storms) */
	private subscriptionBackoff: Map<string, BackoffEntry> = new Map()
	/** Feedbacks already logged as "path not resolved yet" / "reserved name" (avoid repeating the message) */
	private unresolvedLogged: Set<string> = new Set()
	private connectionReady = false
	private shouldReconnect = false
	private hasLoggedConnectionError = false

	async init(config: DisguiseConfig): Promise<void> {
		this.log('debug', 'Initializing Disguise Designer LiveUpdate module')
		this.updateStatus(InstanceStatus.Disconnected)
		await this.applyConfig(config)
	}

	async destroy(): Promise<void> {
		this.shouldReconnect = false
		this.connectionReady = false

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = undefined
		}

		if (this.pendingCleanupTimer) {
			clearTimeout(this.pendingCleanupTimer)
			this.pendingCleanupTimer = undefined
		}

		if (this.ws) {
			this.ws.removeAllListeners()
			this.ws.close()
			this.ws = null
		}

		this.subscriptions.clear()
		this.feedbackIdToSubscriptionId.clear()
		this.pendingSubscriptions.clear()
		this.feedbackOptionsCache.clear()
		this.clearAllBackoff()
	}

	async configUpdated(config: DisguiseConfig): Promise<void> {
		const connectionChanged = CONNECTION_CONFIG_KEYS.some((key) => this.config?.[key] !== config[key])

		if (!connectionChanged && this.connectionReady) {
			// Only preset settings or selections changed: refresh definitions and variables
			// without dropping the socket (and the subscriptions) for nothing.
			this.config = config
			this.setupActions()
			this.setupFeedbacks()
			this.updateVariableDefinitions()
			this.applySelections()
			this.setupPresets()
			return
		}

		this.shouldReconnect = false
		this.disconnect()
		await this.applyConfig(config)
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return getConfigFields()
	}

	getUpgradeScripts(): CompanionStaticUpgradeScript<DisguiseConfig>[] {
		return upgradeScripts
	}

	setupActions(): void {
		this.setActionDefinitions(getActionDefinitions(this))
	}

	setupFeedbacks(): void {
		this.setFeedbackDefinitions(getFeedbackDefinitions(this))
	}

	setupVariables(): void {
		this.setVariableDefinitions(getVariableDefinitions())
	}

	setupPresets(): void {
		this.setPresetDefinitions(getPresetDefinitions(this))
	}

	isConnectionReady(): boolean {
		return this.connectionReady
	}

	/**
	 * Get the current value of a subscription by ID
	 */
	getSubscriptionValue(id: number): any {
		return this.subscriptions.get(id)?.value
	}

	/**
	 * Get the current value of a subscription by feedback ID
	 */
	getSubscriptionValueByFeedbackId(feedbackId: string): any {
		const subId = this.feedbackIdToSubscriptionId.get(feedbackId)
		if (subId !== undefined) {
			return this.subscriptions.get(subId)?.value
		}
		return undefined
	}

	/**
	 * Get a subscription by feedback ID
	 */
	getSubscriptionByFeedbackId(feedbackId: string): LiveUpdateSubscription | undefined {
		const subId = this.feedbackIdToSubscriptionId.get(feedbackId)
		if (subId !== undefined) {
			return this.subscriptions.get(subId)
		}
		return undefined
	}

	/**
	 * Check if feedback options have changed and update subscription if needed.
	 * Also ensures subscription is active (self-healing).
	 */
	checkAndUpdateSubscription(
		feedbackId: string,
		variableName: string,
		objectPath: string,
		propertyPath: string,
		updateFrequency?: number,
	): void {
		const cached = this.feedbackOptionsCache.get(feedbackId)
		const existingSubscription = this.getSubscriptionByFeedbackId(feedbackId)
		const complete = !!variableName && !!objectPath && !!propertyPath

		if (!cached) {
			this.feedbackOptionsCache.set(feedbackId, { variableName, objectPath, propertyPath, updateFrequency })

			if (!existingSubscription && this.isConnectionReady() && complete) {
				this.subscribeToVariable(feedbackId, variableName, objectPath, propertyPath, updateFrequency)
			}
			return
		}

		const optionsChanged =
			cached.variableName !== variableName ||
			cached.objectPath !== objectPath ||
			cached.propertyPath !== propertyPath ||
			cached.updateFrequency !== updateFrequency

		if (optionsChanged) {
			this.log(
				'info',
				`Feedback options changed: ${cached.objectPath}.${cached.propertyPath} → ${objectPath}.${propertyPath}`,
			)
			this.feedbackOptionsCache.set(feedbackId, { variableName, objectPath, propertyPath, updateFrequency })
			this.unsubscribeFromVariable(feedbackId)

			if (complete) {
				this.subscribeToVariable(feedbackId, variableName, objectPath, propertyPath, updateFrequency)
			}
			return
		}

		// Options haven't changed, but check if subscription is missing (e.g., connection was lost)
		// This handles presets added while disconnected, or subscriptions that were dropped
		if (!existingSubscription && this.isConnectionReady() && complete) {
			this.subscribeToVariable(feedbackId, variableName, objectPath, propertyPath, updateFrequency)
		}
	}

	/**
	 * Get all current subscriptions
	 */
	getSubscriptions(): Map<number, LiveUpdateSubscription> {
		return this.subscriptions
	}

	/**
	 * Get a subscription by variable name
	 */
	getSubscriptionByVariableName(variableName: string): LiveUpdateSubscription | undefined {
		for (const subscription of this.subscriptions.values()) {
			if (subscription.variableName === variableName) {
				return subscription
			}
		}
		return undefined
	}

	private send(message: unknown): boolean {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			try {
				this.ws.send(JSON.stringify(message))
				return true
			} catch (error) {
				this.log('error', `Failed to send message: ${error instanceof Error ? error.message : String(error)}`)
				// Connection might be closing or in a bad state, trigger reconnect
				this.disconnect()
				this.updateStatus(InstanceStatus.Disconnected, 'Send failed')
				this.scheduleReconnect()
				return false
			}
		} else {
			this.log('warn', 'Cannot send message - WebSocket not connected')
			return false
		}
	}

	/**
	 * Feedbacks currently mapped to a subscription id
	 */
	private feedbacksOfSubscription(subscriptionId: number): string[] {
		const result: string[] = []
		for (const [feedbackId, subId] of this.feedbackIdToSubscriptionId.entries()) {
			if (subId === subscriptionId) result.push(feedbackId)
		}
		return result
	}

	/**
	 * Subscribe to a LiveUpdate property and bind it to a module variable
	 */
	subscribeToVariable(
		feedbackId: string,
		variableName: string,
		objectPath: string,
		propertyPath: string,
		updateFrequencyMs: number | undefined,
	): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.log('warn', 'Cannot subscribe - WebSocket not connected')
			return
		}

		// The module's own variables (selections, connection_status) cannot be overwritten by Director data
		if (isReservedVariableName(variableName)) {
			if (!this.unresolvedLogged.has(feedbackId)) {
				this.unresolvedLogged.add(feedbackId)
				this.log(
					'warn',
					`Variable name '${variableName}' is reserved for the module (selections, connection status); choose another name for feedback ${feedbackId}`,
				)
			}
			return
		}

		// Never send template placeholders, unresolved variables or empty names to the Director
		if (isUnresolvedPath(objectPath) || isUnresolvedPath(propertyPath)) {
			if (!this.unresolvedLogged.has(feedbackId)) {
				this.unresolvedLogged.add(feedbackId)
				this.log(
					'debug',
					`Not subscribing feedback ${feedbackId}: path not resolved yet (${objectPath} / ${propertyPath})`,
				)
			}
			return
		}
		this.unresolvedLogged.delete(feedbackId)

		// Wait out the back-off after a failed attempt instead of retrying on every value update
		const backoff = this.subscriptionBackoff.get(feedbackId)
		if (backoff && Date.now() < backoff.notBefore) {
			return
		}

		// A request for this pair is already on its way: join it instead of sending it again
		const key = pairKey(objectPath, propertyPath)
		const pending = this.pendingSubscriptions.get(key)
		if (pending) {
			pending.feedbackIds.add(feedbackId)
			if (pending.variableName !== variableName) {
				this.log(
					'warn',
					`Feedbacks share ${objectPath}.${propertyPath} with different variable names ('${pending.variableName}' and '${variableName}'); '${pending.variableName}' will receive the values`,
				)
			}
			return
		}

		// Check if we already have a subscription for this object/property
		for (const [subId, sub] of this.subscriptions.entries()) {
			if (pairKey(sub.objectPath, sub.propertyPath) === key) {
				// Reuse existing subscription, just update the feedback mapping
				this.log('debug', `Reusing existing subscription ${subId} for feedback ${feedbackId}`)
				this.feedbackIdToSubscriptionId.set(feedbackId, subId)

				if (sub.variableName !== variableName) {
					this.log(
						'warn',
						`Feedbacks share ${objectPath}.${propertyPath} with different variable names ('${sub.variableName}' and '${variableName}'); '${variableName}' will receive the values`,
					)
					sub.variableName = variableName
				}

				return
			}
		}

		const message: {
			subscribe: { object: string; properties: string[]; configuration?: { updateFrequencyMs: number } }
		} = {
			subscribe: {
				object: objectPath,
				properties: [propertyPath],
			},
		}

		if (updateFrequencyMs !== undefined && updateFrequencyMs > 0) {
			message.subscribe.configuration = { updateFrequencyMs }
		}

		this.log('info', `Subscribing to ${objectPath}.${propertyPath} as variable '${variableName}'`)

		if (!this.send(message)) {
			return
		}

		this.pendingSubscriptions.set(key, {
			objectPath,
			propertyPath,
			variableName,
			feedbackIds: new Set([feedbackId]),
			timestamp: Date.now(),
		})

		// Initialize the module variable as undefined until first value arrives
		this.setVariableValues({ [variableName]: undefined })
	}

	/**
	 * Unsubscribe from a LiveUpdate property by feedback ID. The Director subscription is only
	 * released when no other feedback uses it.
	 */
	unsubscribeFromVariable(feedbackId: string): void {
		const subscriptionId = this.feedbackIdToSubscriptionId.get(feedbackId)

		// A removed or edited feedback starts over without back-off
		this.clearBackoff(feedbackId)
		this.unresolvedLogged.delete(feedbackId)

		// Leave in-flight requests in place (the Director will confirm them); when nobody is
		// interested any more the confirmation is answered with an unsubscribe.
		for (const pending of this.pendingSubscriptions.values()) {
			pending.feedbackIds.delete(feedbackId)
		}

		if (subscriptionId === undefined) {
			return
		}

		this.feedbackIdToSubscriptionId.delete(feedbackId)

		const stillUsedBy = this.feedbacksOfSubscription(subscriptionId)
		if (stillUsedBy.length > 0) {
			this.log('debug', `Subscription ${subscriptionId} stays active for ${stillUsedBy.length} other feedback(s)`)
			this.updateVariableDefinitions()
			return
		}

		const subscription = this.subscriptions.get(subscriptionId)

		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.log('warn', 'Cannot unsubscribe - WebSocket not connected')
			this.subscriptions.delete(subscriptionId)
			this.updateVariableDefinitions()
			return
		}

		this.log('info', `Unsubscribing from ${subscription?.objectPath}.${subscription?.propertyPath}`)
		this.send({ unsubscribe: { id: subscriptionId } })

		this.subscriptions.delete(subscriptionId)
		this.updateVariableDefinitions()
	}

	/**
	 * Set a LiveUpdate property value by subscription ID
	 */
	setProperty(id: number, value: unknown): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.log('warn', 'Cannot set property - WebSocket not connected')
			return
		}

		if (!this.subscriptions.has(id)) {
			this.log('warn', `Subscription ID ${id} does not exist`)
			return
		}

		const message = {
			set: [{ id, value }],
		}

		this.log('debug', `Setting property ID ${id} to: ${JSON.stringify(value)}`)

		this.send(message)
	}

	/**
	 * Set a selection variable (selTrack, selScreen, ...) and persist it in the connection config.
	 * Companion re-evaluates every feedback whose options reference the variable, which makes the
	 * presets built on it re-subscribe to the newly selected object. Values are validated for the
	 * kind of slot they are spliced into (name, host, integer, number, uid).
	 */
	setSelection(selectionId: string, value: string): void {
		if (!isSelectionId(selectionId)) {
			this.log('warn', `Unknown selection '${selectionId}'`)
			return
		}

		const trimmed = value.trim()
		const problem = validateSelection(selectionId, trimmed)
		if (problem) {
			this.log('warn', `Selection rejected: ${problem}`)
			return
		}

		this.config = { ...this.config, [selectionId]: trimmed }
		this.setVariableValues({ [selectionId]: trimmed === '' ? UNSET_SELECTION : trimmed })
		this.saveConfig(this.config, undefined)
		this.log('info', `Selection ${selectionId} = '${trimmed}'`)
	}

	/**
	 * Push the selection values stored in the config into the module variables
	 */
	private applySelections(): void {
		const values = readSelections(this.config as unknown as Record<string, unknown>, (_id, message) =>
			this.log('warn', `Selection ignored: ${message}`),
		)
		this.setVariableValues(values)
	}

	/**
	 * Remember a failed subscription attempt and delay the next retry (2 s, 4 s, ... up to 60 s)
	 * so that a wrong path does not turn every incoming value update into a new subscribe request.
	 * A timer re-evaluates the feedback when the delay has elapsed, so the retry does not depend on
	 * other subscriptions producing traffic.
	 */
	private noteSubscriptionFailure(feedbackId: string, reason: string): void {
		const previous = this.subscriptionBackoff.get(feedbackId)
		if (previous?.timer) clearTimeout(previous.timer)
		const attempts = (previous?.attempts ?? 0) + 1
		const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1))
		const timer = setTimeout(() => {
			const entry = this.subscriptionBackoff.get(feedbackId)
			if (entry) entry.timer = undefined
			if (this.connectionReady && this.ws && this.ws.readyState === WebSocket.OPEN) {
				this.checkFeedbacksById(feedbackId)
			}
		}, delay)
		this.subscriptionBackoff.set(feedbackId, { attempts, notBefore: Date.now() + delay, timer })
		this.log(
			attempts === 1 ? 'warn' : 'debug',
			`Subscription for feedback ${feedbackId} failed (${reason}); next retry in ${Math.round(delay / 1000)} s`,
		)
	}

	private clearBackoff(feedbackId: string): void {
		const entry = this.subscriptionBackoff.get(feedbackId)
		if (!entry) return
		if (entry.timer) clearTimeout(entry.timer)
		this.subscriptionBackoff.delete(feedbackId)
	}

	private clearAllBackoff(): void {
		for (const entry of this.subscriptionBackoff.values()) {
			if (entry.timer) clearTimeout(entry.timer)
		}
		this.subscriptionBackoff.clear()
	}

	private async applyConfig(config: DisguiseConfig): Promise<void> {
		this.config = config

		if (!config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Host or IP required')
			return
		}

		this.setupActions()
		this.setupFeedbacks()
		this.setupVariables()
		this.applySelections()
		this.setupPresets()

		this.shouldReconnect = true
		this.connect()
	}

	private connect(): void {
		if (this.ws) {
			this.disconnect()
		}

		const url = `ws://${this.config.host}:${this.config.port}/api/session/liveupdate`
		this.log('debug', `Connecting to Disguise Designer at ${url}`)
		this.updateStatus(InstanceStatus.Connecting)
		this.hasLoggedConnectionError = false // Reset before each connection attempt

		try {
			this.ws = new WebSocket(url)

			this.ws.on('open', () => {
				this.log('info', 'Connected to Disguise Designer LiveUpdate API')
				this.updateStatus(InstanceStatus.Ok)
				this.connectionReady = true
				this.hasLoggedConnectionError = false // Reset on successful connection
				this.stopReconnectTimer()
				this.setVariableValues({
					connection_status: 'Connected',
				})
				this.checkFeedbacks('connectionState')

				this.subscribeFeedbacks()
				this.startPendingCleanupTimer()
			})

			this.ws.on('message', (data: WebSocket.RawData) => {
				this.handleMessage(rawDataToString(data))
			})

			this.ws.on('error', (error: Error) => {
				if (!this.hasLoggedConnectionError) {
					this.log('error', `WebSocket error: ${error.message}`)
					this.hasLoggedConnectionError = true
				}
				this.updateStatus(InstanceStatus.ConnectionFailure, error.message)
			})

			this.ws.on('close', (code: number, reason: Buffer) => {
				const reasonStr = reason ? reason.toString() : ''
				this.log('warn', `WebSocket closed: ${code} ${reasonStr}`)
				this.connectionReady = false
				this.subscriptions.clear()
				this.feedbackIdToSubscriptionId.clear()
				this.pendingSubscriptions.clear()
				this.feedbackOptionsCache.clear()
				this.clearAllBackoff()
				this.setVariableValues({
					connection_status: 'Disconnected',
				})
				this.checkFeedbacks('connectionState')

				if (this.pendingCleanupTimer) {
					clearTimeout(this.pendingCleanupTimer)
					this.pendingCleanupTimer = undefined
				}

				if (this.shouldReconnect) {
					this.updateStatus(InstanceStatus.Disconnected, 'Connection lost')
					this.scheduleReconnect()
				} else {
					this.updateStatus(InstanceStatus.Disconnected)
				}
			})
		} catch (error) {
			if (!this.hasLoggedConnectionError) {
				this.log('error', `Failed to create WebSocket: ${error}`)
				this.hasLoggedConnectionError = true
			}
			this.updateStatus(InstanceStatus.ConnectionFailure)
			this.scheduleReconnect()
		}
	}

	private disconnect(): void {
		this.stopReconnectTimer() // This will clear reconnectTimer

		if (this.pendingCleanupTimer) {
			clearTimeout(this.pendingCleanupTimer)
			this.pendingCleanupTimer = undefined
		}

		const wasReady = this.connectionReady
		this.connectionReady = false

		if (this.ws) {
			try {
				this.ws.removeAllListeners()
				if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
					this.ws.close()
				}
			} catch {
				// Ignore close errors
			}
			this.ws = null
		}
		this.subscriptions.clear()
		this.feedbackIdToSubscriptionId.clear()
		this.pendingSubscriptions.clear()
		this.feedbackOptionsCache.clear()
		this.clearAllBackoff()

		if (wasReady) {
			this.setVariableValues({ connection_status: 'Disconnected' })
			this.checkFeedbacks('connectionState')
		}
	}

	private scheduleReconnect(): void {
		if (!this.shouldReconnect) return

		this.stopReconnectTimer()
		const interval = this.config.reconnectInterval ?? 5000
		this.log('info', `Reconnecting in ${interval}ms`)

		this.reconnectTimer = setTimeout(() => {
			this.connect()
		}, interval)
	}

	private stopReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = undefined
		}
	}

	private handleMessage(data: string): void {
		try {
			const message = JSON.parse(data)

			if (message.error) {
				this.handleErrorMessage(String(message.error))
				return
			}

			if (message.subscriptions) {
				this.handleSubscriptionsUpdate(message.subscriptions)
			}

			if (message.valuesChanged) {
				this.handleValuesChanged(message.valuesChanged)
			}
		} catch (error) {
			this.log('error', `Failed to parse message: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * A Director error such as "Unable to subscribe to OBJECT / PROPERTY - reason". The pending
	 * request whose paths appear verbatim in the text has failed; every feedback waiting for it is
	 * put into back-off and its variable shows ERROR.
	 */
	private handleErrorMessage(error: string): void {
		this.log('error', `LiveUpdate error: ${error}`)

		let matched = false
		for (const [key, pending] of this.pendingSubscriptions.entries()) {
			if (!error.includes(`${pending.objectPath} / ${pending.propertyPath}`)) continue
			matched = true
			this.log('warn', `Removing failed pending subscription for variable '${pending.variableName}'`)
			this.pendingSubscriptions.delete(key)
			for (const feedbackId of pending.feedbackIds) {
				this.noteSubscriptionFailure(feedbackId, error)
			}
			// Set error message in the variable so user knows it failed
			this.setVariableValues({ [pending.variableName]: 'ERROR' })
		}

		if (!matched && this.pendingSubscriptions.size > 0) {
			this.log('debug', 'Error did not name a pending subscription; pending requests are kept until they time out')
		}
	}

	private handleSubscriptionsUpdate(subscriptions: any[]): void {
		this.log('debug', `Subscriptions updated: ${subscriptions.length} active`)

		// Update our subscription map
		const newSubscriptions = new Map<number, LiveUpdateSubscription>()
		const newFeedbackMap = new Map<string, number>()

		for (const sub of subscriptions) {
			const existing = this.subscriptions.get(sub.id)
			const key = pairKey(String(sub.objectPath ?? ''), String(sub.propertyPath ?? ''))
			const pending = this.pendingSubscriptions.get(key)

			if (pending) {
				this.pendingSubscriptions.delete(key)

				if (pending.feedbackIds.size === 0) {
					// Everybody lost interest while the request was in flight: release it again
					this.log('debug', `Releasing subscription ${sub.id} nobody is waiting for any more`)
					this.send({ unsubscribe: { id: sub.id } })
					continue
				}

				const [firstFeedbackId] = pending.feedbackIds
				newSubscriptions.set(sub.id, {
					id: sub.id,
					objectPath: sub.objectPath,
					propertyPath: sub.propertyPath,
					feedbackId: firstFeedbackId,
					variableName: pending.variableName,
					value: existing?.value,
					changeTimestamp: existing?.changeTimestamp,
					messageTimestamp: existing?.messageTimestamp,
				})

				for (const feedbackId of pending.feedbackIds) {
					newFeedbackMap.set(feedbackId, sub.id)
				}
				this.log(
					'info',
					`Subscription ${sub.id}: ${sub.objectPath}.${sub.propertyPath} -> variable: ${pending.variableName}`,
				)
			} else if (existing) {
				// Preserve existing subscription and every feedback mapped to it
				newSubscriptions.set(sub.id, existing)
				for (const feedbackId of this.feedbacksOfSubscription(sub.id)) {
					newFeedbackMap.set(feedbackId, sub.id)
				}
			} else {
				this.log('debug', `Director reports subscription ${sub.id} (${sub.objectPath}) that no feedback owns`)
			}
		}

		this.subscriptions = newSubscriptions
		this.feedbackIdToSubscriptionId = newFeedbackMap

		// Update feedbacks and variable definitions
		this.updateVariableDefinitions()
		this.checkFeedbacks()
	}

	/**
	 * Handle value updates from Disguise LiveUpdate API.
	 * Updates module variables that Companion exposes as $(liveupdate:variable_name)
	 */
	private handleValuesChanged(values: any[]): void {
		const changedVars: Record<string, any> = {}
		let definitionsChanged = false

		for (const valueUpdate of values) {
			const subscription = this.subscriptions.get(valueUpdate.id)
			if (!subscription) continue

			subscription.value = valueUpdate.value
			subscription.changeTimestamp = valueUpdate.changeTimestamp
			subscription.messageTimestamp = valueUpdate.messageTimestamp

			// Check if the value is an error object from Disguise
			if (valueUpdate.value && typeof valueUpdate.value === 'object' && valueUpdate.value.errorType) {
				const errorMessage = String(valueUpdate.value.message || 'Unknown error')

				// Track consecutive errors
				subscription.errorCount = (subscription.errorCount || 0) + 1

				this.log(
					subscription.errorCount === 1 ? 'error' : 'debug',
					`Property path error for ${subscription.objectPath}.${subscription.propertyPath}: ${errorMessage} (error count: ${subscription.errorCount})`,
				)

				// If we've hit 3 consecutive errors, unsubscribe and retry later with back-off
				if (subscription.errorCount >= 3) {
					this.log(
						'warn',
						`Unsubscribing variable '${subscription.variableName}' after ${subscription.errorCount} consecutive errors; fix the property path in the feedback, the subscription is retried with a growing back-off`,
					)

					// Unsubscribe from Disguise (once, however many feedbacks share it)
					this.send({ unsubscribe: { id: subscription.id } })

					// Clean up local state for every feedback that shares the subscription
					this.subscriptions.delete(subscription.id)
					for (const feedbackId of this.feedbacksOfSubscription(subscription.id)) {
						this.feedbackIdToSubscriptionId.delete(feedbackId)
						this.noteSubscriptionFailure(feedbackId, errorMessage)
					}
					definitionsChanged = true

					// Set error indicator in variable
					changedVars[subscription.variableName] = 'PATH_ERROR (unsubscribed)'
				} else {
					changedVars[subscription.variableName] = 'PATH_ERROR'
				}

				continue
			}

			// Reset error count on successful value update; the subscription has proven itself
			if (subscription.errorCount) subscription.errorCount = 0
			for (const feedbackId of this.feedbacksOfSubscription(subscription.id)) {
				this.clearBackoff(feedbackId)
			}

			// Keep primitives (number, string, boolean) as-is for Companion expressions
			// Convert complex objects (arrays, objects) to JSON strings for display
			let displayValue = valueUpdate.value
			if (valueUpdate.value !== null && valueUpdate.value !== undefined && typeof valueUpdate.value === 'object') {
				// Arrays and objects need to be stringified
				displayValue = JSON.stringify(valueUpdate.value)
			}

			// Update the module variable
			// This makes the value available as $(liveupdate:variable_name) throughout Companion
			changedVars[subscription.variableName] = displayValue
		}

		// Definitions first, so an error indicator written below reaches a defined variable
		if (definitionsChanged) {
			this.updateVariableDefinitions()
		}

		// Push all updated variables to Companion's variable system in one batch
		if (Object.keys(changedVars).length > 0) {
			this.setVariableValues(changedVars)
		}

		// Trigger feedback re-evaluation (compare feedbacks, self-healing of missing subscriptions)
		this.checkFeedbacks()
	}

	/**
	 * Update Companion's list of available module variables.
	 * Every variable owned by a placed LiveUpdate Variable feedback stays defined, whether or not
	 * its subscription is confirmed, so error indicators reach the button.
	 */
	private updateVariableDefinitions(): void {
		const variableDefinitions = getVariableDefinitions()
		const defined = new Set(variableDefinitions.map((definition) => definition.variableId))

		const add = (variableId: string, name: string): void => {
			if (!variableId || defined.has(variableId) || isReservedVariableName(variableId)) return
			defined.add(variableId)
			variableDefinitions.push({ variableId, name })
		}

		for (const sub of this.subscriptions.values()) {
			add(sub.variableName, `${sub.objectPath}.${sub.propertyPath}`)
		}
		for (const cached of this.feedbackOptionsCache.values()) {
			add(cached.variableName, `${cached.objectPath}.${cached.propertyPath}`)
		}

		this.log('debug', `Setting ${variableDefinitions.length} variable definitions`)
		this.setVariableDefinitions(variableDefinitions)
	}

	/**
	 * Clean up pending subscriptions that have timed out; the feedbacks waiting for them back off
	 */
	private cleanupPendingSubscriptions(): void {
		const now = Date.now()
		const timeout = this.config.pendingSubscriptionTimeout ?? 30000

		for (const [key, pending] of this.pendingSubscriptions.entries()) {
			if (now - pending.timestamp > timeout) {
				this.log('warn', `Pending subscription timed out: ${pending.objectPath}.${pending.propertyPath}`)
				this.pendingSubscriptions.delete(key)
				for (const feedbackId of pending.feedbackIds) {
					this.noteSubscriptionFailure(feedbackId, 'no answer from the Director')
				}
			}
		}
	}

	/**
	 * Start periodic cleanup timer for pending subscriptions
	 */
	private startPendingCleanupTimer(): void {
		if (this.pendingCleanupTimer) {
			clearTimeout(this.pendingCleanupTimer)
		}

		this.pendingCleanupTimer = setTimeout(() => {
			this.cleanupPendingSubscriptions()
			// Reschedule if still connected
			if (this.connectionReady) {
				this.startPendingCleanupTimer()
			}
		}, this.config.pendingSubscriptionTimeout ?? 30000)
	}
}

runEntrypoint(DisguiseInstance, upgradeScripts)

export type { DisguiseConfig }
