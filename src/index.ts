import {
	InstanceBase,
	InstanceStatus,
	runEntrypoint,
	SomeCompanionConfigField,
	CompanionStaticUpgradeScript,
	CompanionVariableValues,
} from '@companion-module/base'
import WebSocket from 'ws'
import { getConfigFields, DisguiseConfig } from './config'
import { isSelectionId, readSelections, UNSET_SELECTION, validateSelection } from './selections'
import { getActionDefinitions } from './actions'
import { getFeedbackDefinitions, isDirectorError } from './feedbacks'
import { getPresetDefinitions } from './presets'
import {
	ERROR_VALUE,
	getVariableDefinitions,
	isReservedVariableName,
	OFFLINE_VALUE,
	PATH_ERROR_UNSUBSCRIBED_VALUE,
	PATH_ERROR_VALUE,
	PENDING_VALUE,
	UNSET_VALUE,
} from './variables'
import { upgradeScripts } from './upgrades'
import { RestClient, RestCommand, REST_ENDPOINTS } from './rest'
import { getRestActionDefinitions } from './restActions'
import { choicesFrom, DISCOVERY_SOURCES } from './discovery'
import { sparklineWindow, ValueHistory } from './sparkline'
import { PRESET_CATALOG } from './presetCatalog'

export { OFFLINE_VALUE, SENTINELS, isSentinel } from './variables'

/**
 * Config keys that require the WebSocket connection to be re-established when they change
 */
const CONNECTION_CONFIG_KEYS = ['host', 'port', 'reconnectInterval', 'pendingSubscriptionTimeout'] as const

const BACKOFF_BASE_MS = 2000
const BACKOFF_MAX_MS = 60000

/**
 * How long an id the module has just released stays remembered. A `subscriptions` message that was
 * already on the wire when the unsubscribe was sent still lists it; without this the module would
 * answer that echo with a second unsubscribe for an id it no longer holds.
 */
const RELEASED_ID_GRACE_MS = 5000

/**
 * A rotary encoder produces one action per detent. The first write of a burst goes out at once so a
 * single press stays instant; further writes to the same property inside this window are collapsed
 * to the last value, which is the one the operator is turning towards anyway.
 */
const WRITE_COALESCE_MS = 40

/** The Designer major version every catalog row was verified against */
const CATALOG_DESIGNER_MAJOR = '34'

/** The pair the Designer version is read from, once per connection */
const VERSION_OBJECT = 'subsystem:MonitoringManager'
const VERSION_PROPERTY = 'ReleaseVersion.versionString()'

/**
 * Companion variable ids: letters, digits, `_`, `-` and `.`. This is the host's own rule (Companion
 * 5.0.4 defines a variable only when its id matches it); 1.0.2 sent any name without a check, so every
 * name it could get defined keeps working.
 */
const VARIABLE_ID = /^[A-Za-z0-9_.-]+$/

/** Template placeholders such as <TRACK_NAME> or <OBJECT_PATH> */
const PLACEHOLDER_TOKEN = /<[A-Z][A-Z0-9_]*>/

/**
 * An object path that is nothing but a type and an empty name, `track:""`: what an empty custom
 * variable leaves behind. Anything longer is left to the Director, which refuses a broken path with a
 * visible ERROR; `""`, `[]` and `(1,)` are ordinary Python in a property path.
 */
const EMPTY_OBJECT_NAME = /^[A-Za-z_][A-Za-z0-9_]*\s*:\s*(""|'')$/

/** A selection reference the module fills in itself (discovery sources and the preset check) */
const SELECTION_REFERENCE = /\$\(liveupdate:sel[A-Za-z0-9_]+\)/

/** "Unable to subscribe to OBJECT / PROPERTY - reason": an error that says which request it is about */
const NAMES_A_PAIR = /Unable to subscribe to .+ \/ .+ - /

/**
 * Feedbacks whose state the module computes itself rather than a Director value: they are
 * re-checked when the connection comes and goes, because no variable change would re-check them.
 */
const STATE_FEEDBACKS = ['connectionState', 'liveUpdateCompare', 'liveUpdateSparkline', 'restArmed', 'restLastResult']

/**
 * Paths that must not be sent to the Director: empty paths, template placeholders and unresolved
 * Companion variable references ($NA or a raw $(...) reference). Everything else is sent as it is;
 * a path the Director cannot evaluate comes back as a visible ERROR or PATH_ERROR.
 */
export function isUnresolvedPath(path: string): boolean {
	const trimmed = path.trim()
	if (!trimmed) return true
	if (PLACEHOLDER_TOKEN.test(trimmed)) return true
	if (trimmed.includes('$NA')) return true
	if (/\$\([^)]*\)/.test(trimmed)) return true
	return false
}

/**
 * An object path that must not be sent: everything isUnresolvedPath refuses, a bare empty name such
 * as `track:""`, and the remote-monitor node form without a hostname (`":d3"`).
 */
export function isUnresolvedObjectPath(path: string): boolean {
	const trimmed = path.trim()
	return isUnresolvedPath(trimmed) || EMPTY_OBJECT_NAME.test(trimmed) || /"\s*:d3"/.test(trimmed)
}

/** The major version in a Designer version string such as `r34.0.3` or `34.0.3.258249` */
export function designerMajor(version: string): string | undefined {
	return /(?:^|\s)r?(\d+)(?:\.|\s|$)/.exec(version.trim())?.[1]
}

/**
 * Key of an (object path, property path) pair; the Director echoes both strings back verbatim
 */
function pairKey(objectPath: string, propertyPath: string): string {
	return `${objectPath.trim()}\n${propertyPath.trim()}`
}

/** The faster of two update intervals; undefined (0, as fast as possible) is faster than any number */
function fasterInterval(a: number | undefined, b: number | undefined): number | undefined {
	if (a === undefined || !(a > 0) || b === undefined || !(b > 0)) return undefined
	return Math.min(a, b)
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
	/** The updateFrequencyMs this subscription was requested with (undefined = the Director default) */
	updateFrequencyMs?: number
	/** The feedback that created the subscription; other feedbacks may share it (see feedbackIdToSubscriptionId) */
	feedbackId: string
	variableName: string
	/** The last value the Director sent; undefined while the property path answers with an error */
	value?: any
	/** The {errorType, message} object the Director sent instead of a value, until a value arrives */
	error?: unknown
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
	/** The interval the frame carries (undefined = the Director default) */
	updateFrequencyMs: number | undefined
	/** The fastest interval any feedback that joined the request asks for */
	wantedFrequencyMs: number | undefined
	/** The frame has left: only now can a `subscriptions` reply be the answer to it */
	sent: boolean
	/** A one-shot read holds the pair; the frame goes out when the read has finished */
	heldForProbe: boolean
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
 * A one-shot read of a pair (selection lists, Designer version, preset check). It subscribes on its
 * own only when no feedback holds or requests the pair; otherwise it waits for that feedback's
 * value and never touches the feedback's Director reference.
 */
interface Probe {
	objectPath: string
	propertyPath: string
	resolvers: ((value: unknown) => void)[]
	timer: NodeJS.Timeout
	/** True when the probe sent its own subscribe and so holds one Director reference */
	sent: boolean
	/** The id the Director confirmed for the probe's own subscribe */
	id?: number
}

interface ArmedCommand {
	at: number
	describe: string
	/** The button that armed it: only that button shows the arm and can fire it */
	controlId: string
	timer: NodeJS.Timeout
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
	/**
	 * The options of every placed LiveUpdate Variable feedback. They belong to the buttons, not to the
	 * connection, so a disconnect keeps them: the interval and the re-checks still need them after a
	 * reconnect. The unsubscribe hook and destroy() remove entries.
	 */
	public feedbackOptionsCache: Map<string, FeedbackOptionsCacheEntry> = new Map()
	/** Per-feedback back-off after failed subscriptions (guards against subscribe storms) */
	private subscriptionBackoff: Map<string, BackoffEntry> = new Map()
	/** Feedbacks refused for their path or name, already logged (they are retried only when their options change) */
	private unresolvedLogged: Set<string> = new Set()
	/** Ids the module has just released, so a stale `subscriptions` echo is not answered twice */
	private releasedSubscriptionIds: Map<number, number> = new Map()
	/**
	 * Variable names of the feedbacks that are placed, kept across a disconnect so their buttons keep
	 * a defined variable to show OFFLINE in. Only readout names are kept: never a selection or one of
	 * the module's own variables. Only destroy() empties it.
	 */
	private retainedVariables: Map<string, string> = new Map()
	/** Compare feedbacks by the variable name they watch, so a value change re-checks only them */
	private compareFeedbacks: Map<string, string> = new Map()
	private connectionReady = false
	private shouldReconnect = false
	private hasLoggedConnectionError = false
	/** Command channel: LiveUpdate cannot carry commands, the Session REST API can */
	private rest: RestClient
	/** Destructive commands are armed by the first press and fired by the second */
	private armed: Map<string, ArmedCommand> = new Map()
	/** One-shot reads, keyed by object/property pair */
	private probes: Map<string, Probe> = new Map()
	/** Writes waiting out the coalescing window, by subscription id */
	private pendingWrites: Map<number, { value: unknown; timer: NodeJS.Timeout }> = new Map()
	/** The preset check walks the whole catalog, so only one may run at a time */
	private selfCheckRunning = false
	/** Subscribe requests waiting for the end of the tick, one entry per object and interval */
	private subscribeQueue: Map<
		string,
		{ objectPath: string; updateFrequencyMs: number | undefined; properties: string[] }
	> = new Map()
	private subscribeFlushScheduled = false
	/** The lists the Set selection action offers, read from the Director */
	public discoveryChoices: Map<string, string[]> = new Map()
	/** Value history per variable, kept only while a Sparkline feedback asks for it */
	private histories: Map<string, ValueHistory> = new Map()
	/** Which variable each Sparkline feedback watches, and how much history it wants */
	private sparklines: Map<string, { variableName: string; window: number }> = new Map()
	/** The variable definitions last sent to the host, so an unchanged list is not sent again */
	private definitionsSignature = ''

	constructor(internal: unknown) {
		super(internal)
		this.rest = new RestClient({
			host: '127.0.0.1',
			port: 80,
			timeoutMs: 5000,
			log: (level, message) => this.log(level, message),
		})
	}

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

		this.closeSocket()

		this.dropConnectionState()
		this.feedbackOptionsCache.clear()
		this.retainedVariables.clear()
		for (const armed of this.armed.values()) clearTimeout(armed.timer)
		this.armed.clear()
		for (const write of this.pendingWrites.values()) clearTimeout(write.timer)
		this.pendingWrites.clear()
	}

	async configUpdated(config: DisguiseConfig): Promise<void> {
		const connectionChanged = CONNECTION_CONFIG_KEYS.some((key) => this.config?.[key] !== config[key])

		// An arm must not outlive the permission it was given under, nor follow the connection to
		// another Director: the confirming press would fire at something the operator did not arm.
		if (
			!config.restAllowDestructive ||
			config.restEnabled === false ||
			this.config?.host !== config.host ||
			this.config?.port !== config.port
		) {
			this.clearArms()
		}

		// The selection lists and the version belong to the Director they were read from. A failed
		// read on the new host must leave the lists empty rather than offer the old show's names.
		if (this.config && (this.config.host !== config.host || this.config.port !== config.port)) {
			this.discoveryChoices.clear()
			this.setVariableValues({ designer_version: undefined })
		}

		if (!connectionChanged && this.connectionReady) {
			// Only preset settings or selections changed: refresh definitions and variables
			// without dropping the socket (and the subscriptions) for nothing.
			this.config = config
			this.rest.update({ timeoutMs: Math.max(1000, Number(config.restTimeout ?? 5000)) })
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
		this.setActionDefinitions({ ...getActionDefinitions(this), ...getRestActionDefinitions(this) })
	}

	setupFeedbacks(): void {
		this.setFeedbackDefinitions(getFeedbackDefinitions(this))
	}

	/**
	 * The static variables and every readout a placed feedback owns: a readout that is dropped from
	 * the definitions loses its value, and with it the OFFLINE a button shows during an outage.
	 */
	setupVariables(): void {
		this.updateVariableDefinitions()
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

		if (!cached) {
			this.feedbackOptionsCache.set(feedbackId, { variableName, objectPath, propertyPath, updateFrequency })
			this.retainReadout(feedbackId, variableName)
			// The variable exists from the moment the feedback is placed, so error indicators can reach it
			this.updateVariableDefinitions()
			this.markOffline(variableName)

			// An empty path is refused by subscribeToVariable itself, which marks the variable UNSET
			if (!existingSubscription && this.isConnectionReady() && variableName) {
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
			this.retainReadout(feedbackId, variableName)
			this.unsubscribeFromVariable(feedbackId)
			this.updateVariableDefinitions()
			this.markOffline(variableName)

			if (variableName) {
				this.subscribeToVariable(feedbackId, variableName, objectPath, propertyPath, updateFrequency)
			}

			// The old subscription is gone. When the new one could not be asked for (a cleared
			// selection, an empty field), the button must not keep showing the previous object's value.
			if (!this.feedbackIsFed(feedbackId)) {
				this.markUnset(variableName)
				if (cached.variableName !== variableName) this.markUnset(cached.variableName)
			}
			const names = new Set([variableName, cached.variableName])
			const stale = this.stateFeedbacksOf(names)
			if (stale.length) this.checkFeedbacksById(...stale)
			return
		}

		// Options haven't changed, but check if subscription is missing (e.g., connection was lost)
		// This handles presets added while disconnected, or subscriptions that were dropped
		if (!existingSubscription && this.isConnectionReady() && variableName) {
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

	/** The confirmed subscription of a pair, if a feedback holds it */
	private subscriptionOfPair(key: string): LiveUpdateSubscription | undefined {
		for (const subscription of this.subscriptions.values()) {
			if (pairKey(subscription.objectPath, subscription.propertyPath) === key) return subscription
		}
		return undefined
	}

	/** A readout variable: a valid variable id that is not one of the module's own */
	private isReadoutName(name: string): boolean {
		return !!name && VARIABLE_ID.test(name) && !isReservedVariableName(name)
	}

	/** Remember the readout a placed feedback owns (a refused name is never remembered) */
	private retainReadout(feedbackId: string, variableName: string): void {
		if (this.isReadoutName(variableName)) this.retainedVariables.set(feedbackId, variableName)
		else this.retainedVariables.delete(feedbackId)
	}

	/** True while a confirmed or requested subscription writes values into this variable */
	private isVariableFed(variableName: string): boolean {
		for (const subscription of this.subscriptions.values()) {
			if (subscription.variableName === variableName) return true
		}
		for (const pending of this.pendingSubscriptions.values()) {
			if (pending.variableName === variableName && pending.feedbackIds.size > 0) return true
		}
		return false
	}

	/** True while the feedback holds a subscription or waits for one */
	private feedbackIsFed(feedbackId: string): boolean {
		if (this.feedbackIdToSubscriptionId.has(feedbackId)) return true
		for (const pending of this.pendingSubscriptions.values()) if (pending.feedbackIds.has(feedbackId)) return true
		return false
	}

	/**
	 * Show UNSET in a readout whose path cannot be resolved, unless another feedback still feeds the
	 * same variable. While the socket is down the readout keeps saying OFFLINE instead.
	 */
	private markUnset(variableName: string): void {
		if (!this.connectionReady || !this.isReadoutName(variableName) || this.isVariableFed(variableName)) return
		this.setVariableValues({ [variableName]: UNSET_VALUE })
		this.recordHistory(variableName, UNSET_VALUE)
	}

	/**
	 * Show OFFLINE in a readout defined while the socket is not open: a feedback placed or renamed
	 * while the Director is away, or before the first connection. It would otherwise stay empty, which
	 * reads as a Director value, until a connection attempt fails; the open handler replaces it.
	 */
	private markOffline(variableName: string): void {
		if (this.connectionReady || !this.isReadoutName(variableName)) return
		this.setVariableValues({ [variableName]: OFFLINE_VALUE })
		this.recordHistory(variableName, OFFLINE_VALUE)
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

		// The module's own variables (selections, status, version, preset check, commands) cannot be
		// overwritten by Director data
		if (isReservedVariableName(variableName)) {
			if (!this.unresolvedLogged.has(feedbackId)) {
				this.unresolvedLogged.add(feedbackId)
				this.log(
					'warn',
					`Variable name '${variableName}' is reserved for the module (selections, connection status, Designer version, preset check, commands); choose another name for feedback ${feedbackId}`,
				)
			}
			return
		}

		// The name becomes a Companion variable id and the lookup key of every Set / Toggle action
		if (!VARIABLE_ID.test(variableName)) {
			if (!this.unresolvedLogged.has(feedbackId)) {
				this.unresolvedLogged.add(feedbackId)
				this.log(
					'warn',
					`Variable name '${variableName}' of feedback ${feedbackId} is not a valid Companion variable id (letters, digits, '_', '-' and '.' only); the subscription is skipped`,
				)
			}
			return
		}

		// Never send template placeholders, unresolved variables or an empty object name to the Director
		if (isUnresolvedObjectPath(objectPath) || isUnresolvedPath(propertyPath)) {
			if (!this.unresolvedLogged.has(feedbackId)) {
				this.unresolvedLogged.add(feedbackId)
				this.log(
					'warn',
					`Not subscribing feedback ${feedbackId}: the path cannot be resolved yet (${objectPath} / ${propertyPath}); '${variableName}' shows ${UNSET_VALUE} until it can`,
				)
			}
			this.markUnset(variableName)
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
			// a faster joiner is served when the request is confirmed (see handleSubscriptionsUpdate)
			pending.wantedFrequencyMs = fasterInterval(pending.wantedFrequencyMs, updateFrequencyMs)
			if (pending.variableName !== variableName) {
				this.log(
					'warn',
					`Feedbacks share ${objectPath}.${propertyPath} with different variable names ('${pending.variableName}' and '${variableName}'); '${pending.variableName}' will receive the values`,
				)
				this.emptyUnfedReadout(variableName)
			}
			return
		}

		// One variable name must not be bound to two different properties: the Set / Toggle actions
		// look the subscription up by variable name, so the second button would write to the first
		// button's property. This is the out-of-the-box case for two dragged Templates presets. A
		// request nobody waits for any more (its feedback moved to another path while it was in
		// flight) does not count: it is released when it is answered.
		const conflicting =
			[...this.subscriptions.values()].find(
				(sub) => sub.variableName === variableName && pairKey(sub.objectPath, sub.propertyPath) !== key,
			) ??
			[...this.pendingSubscriptions.values()].find(
				(sub) =>
					sub.feedbackIds.size > 0 &&
					sub.variableName === variableName &&
					pairKey(sub.objectPath, sub.propertyPath) !== key,
			)
		if (conflicting) {
			this.log(
				'warn',
				`Variable '${variableName}' is already watching ${conflicting.objectPath}.${conflicting.propertyPath}; give this feedback its own variable name before it can watch ${objectPath}.${propertyPath}`,
			)
			return
		}

		// The interval the pair must run at: the fastest any placed feedback asks for
		const wanted = this.effectiveInterval(objectPath, propertyPath, updateFrequencyMs)

		// Check if we already have a subscription for this object/property
		for (const [subId, sub] of this.subscriptions.entries()) {
			if (pairKey(sub.objectPath, sub.propertyPath) === key) {
				if (wanted !== sub.updateFrequencyMs) {
					// A feedback asks for a faster rate than the one this subscription runs at; the
					// Director has no way to change it, so the old id is released and asked again.
					this.log(
						'debug',
						`Re-subscribing ${objectPath}.${propertyPath} at ${wanted ?? 'the Director default'} ms (was ${sub.updateFrequencyMs ?? 'the Director default'} ms)`,
					)
					this.releaseSubscription(subId)
					break
				}
				// Reuse existing subscription, just update the feedback mapping
				this.log('debug', `Reusing existing subscription ${subId} for feedback ${feedbackId}`)
				this.feedbackIdToSubscriptionId.set(feedbackId, subId)

				// Keep the name of the feedback that created the subscription, exactly as the pending
				// branch above does: overwriting it would silently freeze the first feedback's variable
				// and break every action bound to it.
				if (sub.variableName !== variableName) {
					this.log(
						'warn',
						`Feedbacks share ${objectPath}.${propertyPath} with different variable names ('${sub.variableName}' and '${variableName}'); '${sub.variableName}' will receive the values`,
					)
					this.emptyUnfedReadout(variableName)
				}

				return
			}
		}

		this.log('info', `Subscribing to ${objectPath}.${propertyPath} as variable '${variableName}'`)

		// A one-shot read holds this pair at the Director right now. The request waits until it has
		// finished, so a pair never has two requests in flight and the read's release cannot take the
		// reference the feedback is about to get.
		const heldForProbe = this.probes.get(key)?.sent === true

		// The request is queued rather than sent: several properties of one object asked for in the
		// same tick, which is what placing a page of presets does, leave as a single frame. The
		// pending map stays keyed per pair, so confirmations and errors match exactly as before.
		if (!heldForProbe && !this.queueSubscribe(objectPath, propertyPath, wanted)) {
			return
		}

		this.pendingSubscriptions.set(key, {
			objectPath,
			propertyPath,
			variableName,
			feedbackIds: new Set([feedbackId]),
			timestamp: Date.now(),
			updateFrequencyMs: wanted,
			wantedFrequencyMs: wanted,
			sent: false,
			heldForProbe,
		})

		// The readout says PENDING until its first value or an error arrives: a new request, one made
		// again at a faster rate and a retry after a back-off alike. The subscribe hook of a feedback
		// placed while connected gets here before its callback has defined the variable, and a value
		// written into a variable that is not defined is lost, so the request defines it first.
		this.updateVariableDefinitions()
		this.setVariableValues({ [variableName]: PENDING_VALUE })
		this.recordHistory(variableName, PENDING_VALUE)
	}

	/**
	 * A feedback that joined another feedback's property under a different name gets no values (the
	 * log says so): its readout is emptied rather than left on the PENDING a reconnect wrote into it.
	 */
	private emptyUnfedReadout(variableName: string): void {
		if (!this.isReadoutName(variableName) || this.isVariableFed(variableName)) return
		// A name with no value is not defined yet (the subscribe hook of a feedback placed while connected
		// runs before its callback): module-base gives it '' when the callback defines it. A write before
		// then reaches Companion as a delete, which its value batcher can apply after that '': $NA for good.
		const current = this.getVariableValue(variableName)
		if (current === undefined || current === '') return
		this.setVariableValues({ [variableName]: undefined })
	}

	/**
	 * Send one REST command. A destructive command needs the connection setting and two presses of
	 * the same button within the arm window; the arm is bound to the target so a changed selection
	 * re-arms instead of firing at something the operator did not see.
	 */
	async runRestCommand(command: RestCommand, body: unknown, describe: string, controlId: string): Promise<void> {
		const endpoint = REST_ENDPOINTS[command]
		if (this.config?.restEnabled === false) {
			this.log('warn', `Command channel is off in the connection settings; '${describe}' was not sent`)
			return
		}
		if (endpoint.destructive) {
			if (!this.config?.restAllowDestructive) {
				this.log(
					'warn',
					`'${describe}' is a destructive command; enable "Allow destructive commands" in the connection settings first`,
				)
				return
			}
			const key = `${controlId}:${command}:${describe}`
			const armed = this.armed.get(key)
			if (!armed) {
				const seconds = Math.max(1, Number(this.config?.restArmSeconds ?? 5))
				const timer = setTimeout(() => this.disarm(key), seconds * 1000)
				if (typeof timer.unref === 'function') timer.unref()
				this.armed.set(key, { at: Date.now(), describe, controlId, timer })
				this.setVariableValues({ rest_armed: describe })
				this.checkFeedbacks('restArmed')
				this.log('info', `Armed '${describe}'. Press again within ${seconds} s to send it.`)
				return
			}
			this.disarm(key)
		}

		const result = await this.rest.post(command, body)
		this.setVariableValues({
			rest_last_command: describe,
			rest_last_status: result.ok ? 'OK' : result.absent ? 'UNSUPPORTED' : 'FAILED',
			rest_last_message: result.message,
		})
		this.checkFeedbacks('restLastResult')
		if (result.ok) this.log('info', `Sent '${describe}'`)
		else if (result.absent) this.log('warn', `This Designer build has no '${endpoint.path}' command`)
		else this.log('error', `'${describe}' failed: ${result.message || `HTTP ${result.status}`}`)
	}

	/** Drop one arm (fired or expired) and show what is still armed */
	private disarm(key: string): void {
		const armed = this.armed.get(key)
		if (!armed) return
		clearTimeout(armed.timer)
		this.armed.delete(key)
		this.publishArms()
	}

	/** Drop every arm, for example when destructive commands are no longer allowed */
	private clearArms(): void {
		if (this.armed.size === 0) return
		for (const armed of this.armed.values()) clearTimeout(armed.timer)
		this.armed.clear()
		this.log('info', 'Destructive commands waiting for their confirming press were disarmed')
		this.publishArms()
	}

	/** rest_armed names the most recent arm that is still waiting; empty when none is */
	private publishArms(): void {
		let latest: ArmedCommand | undefined
		for (const armed of this.armed.values()) if (!latest || armed.at >= latest.at) latest = armed
		this.setVariableValues({ rest_armed: latest?.describe ?? '' })
		this.checkFeedbacks('restArmed')
	}

	/**
	 * Read one property once. A pair a feedback already holds is answered from that feedback's
	 * subscription (its value, or the first one it receives) without a frame of its own: a second
	 * subscribe would only add a Director reference the feedback's release cannot remove. Only a pair
	 * nobody holds gets its own subscribe, released again after the first value or the timeout.
	 */
	private async probeValue(objectPath: string, propertyPath: string, timeoutMs = 4000): Promise<unknown> {
		const key = pairKey(objectPath, propertyPath)
		if (!this.isConnectionReady() || isUnresolvedObjectPath(objectPath) || isUnresolvedPath(propertyPath)) {
			return undefined
		}
		const held = this.subscriptionOfPair(key)
		if (held?.error !== undefined) return held.error
		if (held?.value !== undefined) return held.value
		return new Promise((resolve) => {
			const running = this.probes.get(key)
			if (running) {
				running.resolvers.push(resolve)
				return
			}
			// held without a value yet, or on its way for a feedback: wait for that feedback's value
			const sent = !held && !this.pendingSubscriptions.has(key)
			const timer = setTimeout(() => this.finishProbe(key, undefined), timeoutMs)
			if (typeof timer.unref === 'function') timer.unref()
			this.probes.set(key, { objectPath, propertyPath, resolvers: [resolve], timer, sent })
			if (sent) {
				this.send({
					subscribe: { object: objectPath, properties: [propertyPath], configuration: { updateFrequencyMs: 1000 } },
				})
			}
		})
	}

	/**
	 * Hand a one-shot read its answer. A probe that subscribed on its own releases its one reference
	 * exactly once; the id is only forgotten when no feedback holds it too. A feedback that asked for
	 * the pair while the probe held it sends its request now.
	 */
	private finishProbe(key: string, value: unknown): void {
		const probe = this.probes.get(key)
		if (!probe) return
		this.probes.delete(key)
		clearTimeout(probe.timer)
		if (probe.sent && probe.id !== undefined) {
			this.send({ unsubscribe: { id: probe.id } })
			if (!this.subscriptions.has(probe.id)) this.releasedSubscriptionIds.set(probe.id, Date.now())
		}
		for (const resolve of probe.resolvers) resolve(value)

		const pending = this.pendingSubscriptions.get(key)
		if (pending?.heldForProbe) {
			pending.heldForProbe = false
			if (pending.feedbackIds.size === 0) {
				this.pendingSubscriptions.delete(key)
			} else if (this.queueSubscribe(pending.objectPath, pending.propertyPath, pending.updateFrequencyMs)) {
				pending.timestamp = Date.now()
			}
		}
	}

	/** Answer a probe that waits for a feedback's value on this pair */
	private settleWaitingProbe(key: string, value: unknown): void {
		if (this.probes.get(key)?.sent === false) this.finishProbe(key, value)
	}

	/**
	 * Ask the Director for the lists the selections can be chosen from, so the operator picks a real
	 * name instead of typing one. Runs once per connection and on demand. An answer replaces the list,
	 * even when it is empty; a read that failed keeps the list the operator already has.
	 */
	async refreshDiscovery(): Promise<void> {
		if (!this.isConnectionReady()) {
			this.log('warn', 'Not connected, so the selection lists cannot be refreshed')
			return
		}
		const selections = readSelections(this.config as unknown as Record<string, unknown>)
		let found = 0
		for (const source of DISCOVERY_SOURCES) {
			if (source.needs?.some((id) => !selections[id] || selections[id] === UNSET_SELECTION)) continue
			const objectPath = this.substituteSelections(source.objectPath, selections)
			const propertyPath = this.substituteSelections(source.propertyPath, selections)
			const value = await this.probeValue(objectPath, propertyPath)
			if (value === undefined || isDirectorError(value)) continue
			const choices = choicesFrom(source, value)
			if (choices.length) {
				this.discoveryChoices.set(source.selection, choices)
				found++
			} else {
				// the Director has none (a track without such layers): the action falls back to text
				this.discoveryChoices.delete(source.selection)
			}
		}
		this.log('info', `Selection lists refreshed: ${found} of ${DISCOVERY_SOURCES.length} lists came back`)
		this.setupActions()
	}

	/** Replace a selection reference in a discovery path with the selection's current value */
	private substituteSelections(text: string, selections: Record<string, string>): string {
		return text.replace(/\$\(liveupdate:(sel[A-Za-z0-9_]+)\)/g, (match, id: string) => {
			const value = selections[id]
			return value && value !== UNSET_SELECTION ? value : match
		})
	}

	/**
	 * Read the Designer version once per connection. Several object paths in the catalog behave
	 * differently between builds, so the version is published as a variable and checked against the
	 * one the catalog was verified on.
	 */
	private async readDesignerVersion(): Promise<void> {
		const value = await this.probeValue(VERSION_OBJECT, VERSION_PROPERTY)
		if (typeof value !== 'string' || !value) return
		this.setVariableValues({ designer_version: value })
		const major = designerMajor(value)
		if (major && major !== CATALOG_DESIGNER_MAJOR) {
			this.log(
				'warn',
				`This Director runs Designer ${value}; the preset catalog was verified on r${CATALOG_DESIGNER_MAJOR}. Object paths can differ between major versions - check the readouts before the show.`,
			)
		}
	}

	/**
	 * Subscribe once to every catalog pair whose selections resolve, record whether the Director
	 * accepted it, and release it again. The in-product form of scripts/live-verify.mjs: it says
	 * which presets work on THIS Director and project without touching the buttons already placed.
	 *
	 * Every count is of distinct properties: rows that share a property are checked once. ok answered
	 * with a value, failed answered with an error or not at all, skipped need a selection that is
	 * empty. Template rows and rows without a path (module-native) are not counted at all.
	 */
	async runSelfCheck(): Promise<void> {
		if (!this.isConnectionReady()) {
			this.log('warn', 'Not connected, so the preset check cannot run')
			return
		}
		if (this.selfCheckRunning) {
			this.log('warn', 'The preset check is already running')
			return
		}
		this.selfCheckRunning = true
		const selections = readSelections(this.config as unknown as Record<string, unknown>)
		const pairs = new Map<string, { objectPath: string; propertyPath: string }>()
		const skipped = new Set<string>()
		let rows = 0
		for (const entry of PRESET_CATALOG) {
			if (!entry.objectPath || !entry.propertyPath) continue
			if (PLACEHOLDER_TOKEN.test(entry.objectPath) || PLACEHOLDER_TOKEN.test(entry.propertyPath)) continue
			const objectPath = this.substituteSelections(entry.objectPath, selections)
			const propertyPath = this.substituteSelections(entry.propertyPath, selections)
			if (isUnresolvedObjectPath(objectPath) || isUnresolvedPath(propertyPath)) {
				// substituteSelections leaves the reference of an empty selection in place
				if (SELECTION_REFERENCE.test(objectPath) || SELECTION_REFERENCE.test(propertyPath)) {
					skipped.add(pairKey(objectPath, propertyPath))
				}
				continue
			}
			rows++
			pairs.set(pairKey(objectPath, propertyPath), { objectPath, propertyPath })
		}
		this.log(
			'info',
			`Checking ${pairs.size} distinct preset properties against this Director (${rows} preset rows; rows that share a property are checked once)`,
		)
		let value = 0
		let failed = 0
		let index = 0
		for (const pair of pairs.values()) {
			if (!this.isConnectionReady()) break
			index++
			const answer = await this.probeValue(pair.objectPath, pair.propertyPath, 3000)
			if (answer === undefined || isDirectorError(answer)) failed++
			else value++
			if (index % 25 === 0) {
				this.setVariableValues({ selfcheck_progress: `${index}/${pairs.size}` })
			}
		}
		this.setVariableValues({
			selfcheck_progress: `${index}/${pairs.size}`,
			selfcheck_ok: String(value),
			selfcheck_failed: String(failed),
			selfcheck_skipped: String(skipped.size),
		})
		this.log(
			'info',
			`Preset check: ${value} of ${pairs.size} properties answered with a value, ${failed} did not; ${skipped.size} properties were skipped because a selection they need is empty (rows that share a property count once; templates and module-native rows are not counted)`,
		)
		this.selfCheckRunning = false
	}

	/**
	 * Hold a subscribe request until the end of the tick so the properties of one object leave
	 * together. The Director answers a batched frame with one entry per property, exactly as it does
	 * for separate frames, so nothing downstream changes.
	 *
	 * Returns false when the socket is gone, matching what the immediate send used to report.
	 */
	private queueSubscribe(objectPath: string, propertyPath: string, updateFrequencyMs: number | undefined): boolean {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.log('warn', 'Cannot subscribe - WebSocket not connected')
			return false
		}
		// one batch per object and interval: the interval is part of the frame, not of the property
		const batchKey = `${objectPath}\n${updateFrequencyMs ?? 0}`
		const existing = this.subscribeQueue.get(batchKey)
		if (existing) {
			if (!existing.properties.includes(propertyPath)) existing.properties.push(propertyPath)
			return true
		}
		this.subscribeQueue.set(batchKey, { objectPath, updateFrequencyMs, properties: [propertyPath] })
		if (!this.subscribeFlushScheduled) {
			this.subscribeFlushScheduled = true
			setImmediate(() => this.flushSubscribeQueue())
		}
		return true
	}

	/** Send every queued subscribe, one frame per object and interval */
	private flushSubscribeQueue(): void {
		this.subscribeFlushScheduled = false
		const batches = [...this.subscribeQueue.values()]
		this.subscribeQueue.clear()
		for (const batch of batches) {
			const message: {
				subscribe: { object: string; properties: string[]; configuration?: { updateFrequencyMs: number } }
			} = { subscribe: { object: batch.objectPath, properties: batch.properties } }
			if (batch.updateFrequencyMs !== undefined && batch.updateFrequencyMs > 0) {
				message.subscribe.configuration = { updateFrequencyMs: batch.updateFrequencyMs }
			}
			if (batch.properties.length > 1) {
				this.log('debug', `Subscribing to ${batch.properties.length} properties of ${batch.objectPath} in one frame`)
			}
			if (!this.send(message)) continue
			for (const property of batch.properties) {
				const pending = this.pendingSubscriptions.get(pairKey(batch.objectPath, property))
				if (pending) pending.sent = true
			}
		}
	}

	/** Forget which commands answered 404 so a Director that gained them is picked up */
	rescanRestCommands(): void {
		this.rest.forget()
		this.log('info', 'Command API rescanned; every command will be tried again')
	}

	/**
	 * True while a destructive command is waiting for its confirming press: on the given button, or
	 * on any button when none is given
	 */
	isRestArmed(controlId?: string): boolean {
		if (controlId === undefined) return this.armed.size > 0
		for (const armed of this.armed.values()) if (armed.controlId === controlId) return true
		return false
	}

	/** Remember what a Sparkline feedback watches (undefined removes it) */
	registerSparkline(feedbackId: string, variableName: string | undefined, window: number): void {
		if (!variableName) {
			this.sparklines.delete(feedbackId)
		} else {
			this.sparklines.set(feedbackId, { variableName, window: sparklineWindow(window) })
		}
		// keep only the histories something still watches
		const wanted = new Set([...this.sparklines.values()].map((entry) => entry.variableName))
		for (const name of [...this.histories.keys()]) if (!wanted.has(name)) this.histories.delete(name)
	}

	/**
	 * The recent values of one variable, oldest first; a gap is undefined. The history is kept for the
	 * longest window any Sparkline of the variable asks for, so each one passes its own to get its share.
	 */
	getSparklineSamples(variableName: string, window?: number): (number | undefined)[] {
		const samples = this.histories.get(variableName)?.samples ?? []
		return window === undefined ? samples : samples.slice(-sparklineWindow(window))
	}

	/**
	 * Record a value for every Sparkline feedback that watches this variable. A sentinel the readout
	 * shows instead of a value (OFFLINE, ERROR, PATH_ERROR, UNSET, PENDING) is recorded as well: it is
	 * the gap that breaks the line, so values from before and after it are never joined.
	 */
	private recordHistory(variableName: string, value: unknown): void {
		let window = 0
		for (const entry of this.sparklines.values())
			if (entry.variableName === variableName) window = Math.max(window, entry.window)
		if (!window) return
		let history = this.histories.get(variableName)
		if (!history) {
			history = new ValueHistory(window)
			this.histories.set(variableName, history)
		} else {
			history.resize(window)
		}
		history.push(value)
	}

	/** Remember which variable a Compare feedback watches (undefined removes it) */
	registerCompareFeedback(feedbackId: string, variableName: string | undefined): void {
		if (variableName) this.compareFeedbacks.set(feedbackId, variableName)
		else this.compareFeedbacks.delete(feedbackId)
	}

	/** Every feedback that reads one of these variables: the owning readouts and the Compare feedbacks */
	private feedbacksOfVariables(variableNames: Set<string>): string[] {
		const ids: string[] = []
		for (const [feedbackId, entry] of this.feedbackOptionsCache.entries())
			if (variableNames.has(entry.variableName)) ids.push(feedbackId)
		ids.push(...this.stateFeedbacksOf(variableNames))
		return ids
	}

	/** The Compare and Sparkline feedbacks that read one of these variables */
	private stateFeedbacksOf(variableNames: Set<string>): string[] {
		const ids: string[] = []
		for (const [feedbackId, variableName] of this.compareFeedbacks.entries())
			if (variableNames.has(variableName)) ids.push(feedbackId)
		for (const [feedbackId, entry] of this.sparklines.entries())
			if (variableNames.has(entry.variableName)) ids.push(feedbackId)
		return ids
	}

	/**
	 * LiveUpdate Variable feedbacks that should hold a subscription and neither hold one nor wait for
	 * one: after a Director reply they are the only ones worth re-evaluating. Feedbacks refused for
	 * their path or name wait for an options change, and a back-off has its own timer.
	 */
	private feedbacksWaitingToSubscribe(): string[] {
		const inFlight = new Set<string>()
		for (const pending of this.pendingSubscriptions.values()) for (const id of pending.feedbackIds) inFlight.add(id)
		const ids: string[] = []
		for (const [feedbackId, entry] of this.feedbackOptionsCache.entries()) {
			if (!entry.variableName || this.feedbackIdToSubscriptionId.has(feedbackId) || inFlight.has(feedbackId)) continue
			if (this.unresolvedLogged.has(feedbackId) || this.subscriptionBackoff.get(feedbackId)?.timer) continue
			ids.push(feedbackId)
		}
		return ids
	}

	/** Re-evaluate the placed feedbacks of one variable that are not fed, so a refused one tries again */
	private recheckVariable(variableName: string): void {
		const ids = this.feedbacksWaitingToSubscribe().filter(
			(feedbackId) => this.feedbackOptionsCache.get(feedbackId)?.variableName === variableName,
		)
		if (ids.length) this.checkFeedbacksById(...ids)
	}

	/**
	 * Drop one Director subscription and every local trace of it. The id is remembered briefly so a
	 * `subscriptions` message that was already in flight is not answered with a second unsubscribe.
	 */
	private releaseSubscription(subscriptionId: number): void {
		const variableName = this.subscriptions.get(subscriptionId)?.variableName
		this.send({ unsubscribe: { id: subscriptionId } })
		this.subscriptions.delete(subscriptionId)
		for (const [feedbackId, id] of this.feedbackIdToSubscriptionId.entries()) {
			if (id === subscriptionId) this.feedbackIdToSubscriptionId.delete(feedbackId)
		}
		this.releasedSubscriptionIds.set(subscriptionId, Date.now())
		this.recheckStateOf(variableName)
	}

	/**
	 * Re-evaluate the Compare and Sparkline feedbacks of a variable whose subscription just went
	 * away. Nothing else would: the Director's reply to the unsubscribe no longer names the pair, so
	 * a state colour would otherwise stay lit on a value that is no longer watched.
	 */
	private recheckStateOf(variableName: string | undefined): void {
		if (!variableName) return
		const ids = this.stateFeedbacksOf(new Set([variableName]))
		if (ids.length) this.checkFeedbacksById(...ids)
	}

	/**
	 * The interval a pair should run at: the fastest any placed feedback asks for, so a fast readout
	 * is not slowed down by a slower one that happens to share the property. 0 (as fast as possible)
	 * is the fastest of all; it is sent as no interval at all, the Director default, which is what
	 * undefined stands for here.
	 */
	private effectiveInterval(
		objectPath: string,
		propertyPath: string,
		callerInterval: number | undefined,
	): number | undefined {
		const key = pairKey(objectPath, propertyPath)
		// The caller may not be in the options cache yet: a feedback can reach subscribeToVariable
		// from its subscribe hook before its callback has stored its options.
		let fastest = callerInterval
		for (const entry of this.feedbackOptionsCache.values()) {
			if (pairKey(entry.objectPath, entry.propertyPath) !== key) continue
			fastest = fasterInterval(fastest, entry.updateFrequency)
		}
		return fastest
	}

	/**
	 * Unsubscribe from a LiveUpdate property by feedback ID. The Director subscription is only
	 * released when no other feedback uses it.
	 */
	unsubscribeFromVariable(feedbackId: string): void {
		const subscriptionId = this.feedbackIdToSubscriptionId.get(feedbackId)
		if (!this.feedbackOptionsCache.has(feedbackId)) this.retainedVariables.delete(feedbackId)

		// A removed or edited feedback starts over without back-off
		this.clearBackoff(feedbackId)
		this.unresolvedLogged.delete(feedbackId)

		// Leave in-flight requests in place (the Director will confirm them); when nobody is
		// interested any more the confirmation is answered with an unsubscribe.
		for (const pending of this.pendingSubscriptions.values()) {
			pending.feedbackIds.delete(feedbackId)
		}

		if (subscriptionId === undefined) {
			this.updateVariableDefinitions()
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
			this.recheckStateOf(subscription?.variableName)
			return
		}

		this.log('info', `Unsubscribing from ${subscription?.objectPath}.${subscription?.propertyPath}`)
		this.send({ unsubscribe: { id: subscriptionId } })

		this.subscriptions.delete(subscriptionId)
		this.releasedSubscriptionIds.set(subscriptionId, Date.now())
		this.updateVariableDefinitions()
		this.recheckStateOf(subscription?.variableName)
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

		const waiting = this.pendingWrites.get(id)
		if (waiting) {
			// inside the window of a burst: keep the newest value, the timer will send it
			waiting.value = value
			return
		}

		this.log('debug', `Setting property ID ${id} to: ${JSON.stringify(value)}`)
		this.send({ set: [{ id, value }] })

		// hold the window open so a fast rotary spin becomes one write per window, not one per detent
		const entry: { value: unknown; timer: NodeJS.Timeout } = {
			value,
			timer: setTimeout(() => {
				const pending = this.pendingWrites.get(id)
				this.pendingWrites.delete(id)
				if (pending && pending.value !== value && this.ws?.readyState === WebSocket.OPEN) {
					this.log('debug', `Setting property ID ${id} to: ${JSON.stringify(pending.value)} (coalesced)`)
					this.send({ set: [{ id, value: pending.value }] })
				}
			}, WRITE_COALESCE_MS),
		}
		if (typeof entry.timer.unref === 'function') entry.timer.unref()
		this.pendingWrites.set(id, entry)
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

		// The action ran the value through the host parser, so an unknown variable arrives as $NA and
		// a nested reference as a raw $(...). Both mean "no value", which is a clear, not a rejection.
		const raw = value.trim()
		const trimmed = raw === UNSET_SELECTION || raw.includes('$(') ? '' : raw
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
			if (entry) {
				entry.timer = undefined
				// The timer alone decides that the delay is over. A timer can fire a millisecond before
				// Date.now() reaches notBefore, and the wall clock can step back; either would make the
				// gate in subscribeToVariable swallow this retry and end the chain.
				entry.notBefore = 0
			}
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
		// the command channel talks to the same Director as the socket
		this.rest.update({
			host: config.host,
			port: Number(config.port) || 80,
			timeoutMs: Math.max(1000, Number(config.restTimeout ?? 5000)),
		})

		if (!config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Host or IP required')
			return
		}

		this.setupActions()
		this.setupFeedbacks()
		// keeps the readouts of the placed feedbacks defined, so a save while the Director is away
		// does not turn their OFFLINE into an empty value
		this.setupVariables()
		this.applySelections()
		this.setupPresets()

		this.shouldReconnect = true
		this.connect()
	}

	/**
	 * Drop the socket without letting ws raise an error at nobody: closing a socket that is still
	 * connecting makes ws emit 'error' on the next tick, and with the listeners removed that
	 * would crash the module process (seen in Companion when a connection is restarted while the
	 * Director is slow to answer the handshake).
	 */
	private closeSocket(): void {
		const ws = this.ws
		if (!ws) return
		this.ws = null
		ws.removeAllListeners()
		ws.on('error', () => {})
		try {
			if (ws.readyState === WebSocket.CONNECTING) ws.terminate()
			else if (ws.readyState === WebSocket.OPEN) ws.close()
		} catch {
			// the socket is gone either way
		}
	}

	/** Forget everything that belonged to the socket; the placed feedbacks and their options stay */
	private dropConnectionState(): void {
		this.subscriptions.clear()
		this.feedbackIdToSubscriptionId.clear()
		this.pendingSubscriptions.clear()
		this.releasedSubscriptionIds.clear()
		for (const probe of this.probes.values()) {
			clearTimeout(probe.timer)
			for (const resolve of probe.resolvers) resolve(undefined)
		}
		this.probes.clear()
		this.subscribeQueue.clear()
		this.clearAllBackoff()
	}

	/**
	 * The Director is gone. The feedbacks are still on their buttons, so their variables stay defined
	 * (they are remembered in retainedVariables); without OFFLINE every readout would keep showing the
	 * last value it had, which during a show is worse than saying nothing. Only readouts owned by
	 * feedbacks are touched, never a selection or one of the module's own variables. The feedbacks
	 * whose state the module computes are re-checked, so no state colour outlives the connection.
	 */
	private showOffline(): void {
		const offline: CompanionVariableValues = { connection_status: 'Disconnected' }
		for (const variableName of this.retainedVariables.values()) {
			if (this.isReadoutName(variableName)) offline[variableName] = OFFLINE_VALUE
		}
		for (const variableName of this.histories.keys()) this.recordHistory(variableName, OFFLINE_VALUE)
		this.updateVariableDefinitions()
		this.setVariableValues(offline)
		this.checkFeedbacks(...STATE_FEEDBACKS)
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
				// No readout may keep saying OFFLINE now the Director is back: each one says PENDING and
				// its feedback re-subscribes below, or marks it UNSET when its path cannot be resolved; a
				// feedback that joins another one's property under a different name is emptied again.
				const waiting: CompanionVariableValues = {}
				for (const variableName of this.retainedVariables.values()) waiting[variableName] = PENDING_VALUE
				for (const variableName of Object.keys(waiting)) this.recordHistory(variableName, PENDING_VALUE)
				this.setVariableValues(waiting)
				this.checkFeedbacks(...STATE_FEEDBACKS)

				this.subscribeFeedbacks()
				this.startPendingCleanupTimer()
				// the version on every connection; the names the operator picks from when asked for
				void this.readDesignerVersion().then(async () => {
					if (this.config?.discoverOnConnect !== false) await this.refreshDiscovery()
				})
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
				this.dropConnectionState()
				this.showOffline()

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

		this.connectionReady = false

		// closeSocket removes the listeners, so the close handler does not run: do its work here
		this.closeSocket()
		this.dropConnectionState()
		this.showOffline()
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
	 * A Director error such as "Unable to subscribe to OBJECT / PROPERTY - reason". The request whose
	 * paths appear verbatim in the text has failed: a feedback request puts every feedback waiting for
	 * it into back-off and its variable shows ERROR; a one-shot read is answered with nothing. An
	 * error that names a pair is never pinned on another request.
	 */
	private handleErrorMessage(error: string): void {
		this.log('error', `LiveUpdate error: ${error}`)

		let matched = false
		for (const [key, pending] of [...this.pendingSubscriptions.entries()]) {
			if (!error.includes(`${pending.objectPath} / ${pending.propertyPath}`)) continue
			matched = true
			this.failPending(key, pending, error)
		}
		for (const [key, probe] of [...this.probes.entries()]) {
			// only a probe's own subscribe that is still unconfirmed can be refused
			if (!probe.sent || probe.id !== undefined) continue
			if (!error.includes(`${probe.objectPath} / ${probe.propertyPath}`)) continue
			matched = true
			this.finishProbe(key, undefined)
		}
		if (matched) return

		if (NAMES_A_PAIR.test(error) || !/\bsubscribe\b/i.test(error)) {
			this.log('debug', 'The error is not about a request in flight; no subscription is failed for it')
			return
		}

		// The Director also reports a bad object without echoing the paths, for example
		// "Unable to subscribe to object: Name 'Layer' not found". It can only be about a frame that
		// has left, and with a single such request in flight - a feedback's or a one-shot read's -
		// there is no ambiguity about which one it refers to.
		const pendings = [...this.pendingSubscriptions.entries()].filter(([, pending]) => pending.sent)
		const probes = [...this.probes.entries()].filter(([, probe]) => probe.sent && probe.id === undefined)
		if (pendings.length + probes.length > 1) {
			this.log('debug', 'Error did not name a pending subscription; pending requests are kept until they time out')
			return
		}
		if (pendings.length === 1) {
			const [[key, pending]] = pendings
			this.log('warn', `Attributing the error to the only request in flight ('${pending.variableName}')`)
			this.failPending(key, pending, error)
		} else if (probes.length === 1) {
			const [[key, probe]] = probes
			this.log('debug', `Attributing the error to the one-shot read of ${probe.objectPath}.${probe.propertyPath}`)
			this.finishProbe(key, undefined)
		}
	}

	/** A feedback request the Director refused */
	private failPending(key: string, pending: PendingSubscription, error: string): void {
		this.pendingSubscriptions.delete(key)
		this.settleWaitingProbe(key, undefined)
		if (pending.feedbackIds.size === 0) {
			// Its feedback moved to another path while it was in flight. The failure of the old path
			// is not written into a variable that may now belong to the new one.
			this.log(
				'debug',
				`Dropping the refused request for ${pending.objectPath}.${pending.propertyPath}; no feedback waits for it`,
			)
			this.recheckVariable(pending.variableName)
			return
		}
		this.log('warn', `Removing failed pending subscription for variable '${pending.variableName}'`)
		for (const feedbackId of pending.feedbackIds) {
			this.noteSubscriptionFailure(feedbackId, error)
		}
		// Set error message in the variable so user knows it failed
		this.setVariableValues({ [pending.variableName]: ERROR_VALUE })
		this.recordHistory(pending.variableName, ERROR_VALUE)
		const stale = this.stateFeedbacksOf(new Set([pending.variableName]))
		if (stale.length) this.checkFeedbacksById(...stale)
	}

	private handleSubscriptionsUpdate(subscriptions: any[]): void {
		this.log('debug', `Subscriptions updated: ${subscriptions.length} active`)

		const staleBefore = Date.now() - RELEASED_ID_GRACE_MS
		for (const [id, at] of this.releasedSubscriptionIds.entries())
			if (at < staleBefore) this.releasedSubscriptionIds.delete(id)

		// Update our subscription map
		const newSubscriptions = new Map<number, LiveUpdateSubscription>()
		const newFeedbackMap = new Map<string, number>()

		for (const sub of subscriptions) {
			const existing = this.subscriptions.get(sub.id)
			const objectPath = String(sub.objectPath ?? '')
			const propertyPath = String(sub.propertyPath ?? '')
			const key = pairKey(objectPath, propertyPath)
			const pending = this.pendingSubscriptions.get(key)
			// A probe's own subscribe is tracked by its pair, whichever branch below the id ends up in;
			// an id the module has just released is the echo of an earlier subscription, not the probe's
			const probe = this.probes.get(key)
			if (probe?.sent && probe.id === undefined && !this.releasedSubscriptionIds.has(sub.id)) probe.id = sub.id

			// only a request that has left can be answered; an earlier listing of the pair is an echo
			if (pending?.sent) {
				this.pendingSubscriptions.delete(key)

				if (pending.feedbackIds.size === 0) {
					// Everybody lost interest while the request was in flight: release it again
					this.log('debug', `Releasing subscription ${sub.id} nobody is waiting for any more`)
					this.send({ unsubscribe: { id: sub.id } })
					this.releasedSubscriptionIds.set(sub.id, Date.now())
					this.settleWaitingProbe(key, undefined)
					continue
				}

				// A faster feedback joined while the request was in flight: the Director cannot change the
				// interval of a subscription, so it is released and asked again at the faster rate.
				const wanted = this.effectiveInterval(objectPath, propertyPath, pending.wantedFrequencyMs)
				if (wanted !== pending.updateFrequencyMs && fasterInterval(wanted, pending.updateFrequencyMs) === wanted) {
					this.log(
						'debug',
						`Re-subscribing ${objectPath}.${propertyPath} at ${wanted ?? 'the Director default'} ms (asked at ${pending.updateFrequencyMs ?? 'the Director default'} ms)`,
					)
					this.send({ unsubscribe: { id: sub.id } })
					this.releasedSubscriptionIds.set(sub.id, Date.now())
					if (this.queueSubscribe(objectPath, propertyPath, wanted)) {
						this.pendingSubscriptions.set(key, {
							...pending,
							timestamp: Date.now(),
							updateFrequencyMs: wanted,
							wantedFrequencyMs: wanted,
							sent: false,
						})
					}
					continue
				}

				const [firstFeedbackId] = pending.feedbackIds
				newSubscriptions.set(sub.id, {
					id: sub.id,
					objectPath: sub.objectPath,
					propertyPath: sub.propertyPath,
					feedbackId: firstFeedbackId,
					variableName: pending.variableName,
					// the interval the frame carried, not one recomputed now
					updateFrequencyMs: pending.updateFrequencyMs,
					value: existing?.value,
					error: existing?.error,
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
			} else if (probe?.sent && probe.id === sub.id) {
				// a one-shot read: it keeps its subscription until the value arrives, then releases it
			} else if (this.releasedSubscriptionIds.has(sub.id)) {
				// The echo of a list the Director built before it processed our unsubscribe
				this.log('debug', `Ignoring the echo of released subscription ${sub.id}`)
			} else {
				// Nobody owns it and we did not just release it, so the two sides disagree. Left
				// alone the Director would keep evaluating a property whose value nothing reads.
				this.log('warn', `Releasing subscription ${sub.id} (${sub.objectPath}) that no feedback owns`)
				this.send({ unsubscribe: { id: sub.id } })
				this.releasedSubscriptionIds.set(sub.id, Date.now())
			}
		}

		// Readouts whose subscription the Director no longer lists
		const lost = new Set<string>()
		for (const [id, subscription] of this.subscriptions.entries()) {
			if (!newSubscriptions.has(id)) lost.add(subscription.variableName)
		}

		this.subscriptions = newSubscriptions
		this.feedbackIdToSubscriptionId = newFeedbackMap

		// Definitions are sent only when they changed, and only the feedbacks this reply can have
		// changed are re-evaluated: one reply arrives per subscribed property, so re-running every
		// feedback here would cost (properties) x (feedbacks) when a page of presets connects.
		this.updateVariableDefinitions()
		const recheck = new Set([...this.feedbacksWaitingToSubscribe(), ...this.stateFeedbacksOf(lost)])
		if (recheck.size > 0) this.checkFeedbacksById(...recheck)
	}

	/**
	 * Handle value updates from Disguise LiveUpdate API.
	 * Updates module variables that Companion exposes as $(liveupdate:variable_name)
	 */
	private handleValuesChanged(values: any[]): void {
		/** Variable names whose value changed in this message */
		const affected = new Set<string>()
		const changedVars: Record<string, any> = {}
		let definitionsChanged = false

		for (const valueUpdate of values) {
			// A one-shot read that holds this id itself gets its answer and releases its reference; a
			// feedback that holds the same id still gets the value below.
			const own = [...this.probes.entries()].find(([, probe]) => probe.sent && probe.id === valueUpdate.id)
			if (own) this.finishProbe(own[0], valueUpdate.value)

			const subscription = this.subscriptions.get(valueUpdate.id)
			if (!subscription) continue
			const key = pairKey(subscription.objectPath, subscription.propertyPath)

			subscription.changeTimestamp = valueUpdate.changeTimestamp
			subscription.messageTimestamp = valueUpdate.messageTimestamp

			// Check if the value is an error object from Disguise
			if (isDirectorError(valueUpdate.value)) {
				const errorMessage = String(valueUpdate.value.message || 'Unknown error')
				// the value is unknown now; the error is kept apart so nothing compares against it
				subscription.value = undefined
				subscription.error = valueUpdate.value
				this.settleWaitingProbe(key, valueUpdate.value)

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
					this.releasedSubscriptionIds.set(subscription.id, Date.now())

					// Clean up local state for every feedback that shares the subscription
					this.subscriptions.delete(subscription.id)
					for (const feedbackId of this.feedbacksOfSubscription(subscription.id)) {
						this.feedbackIdToSubscriptionId.delete(feedbackId)
						this.noteSubscriptionFailure(feedbackId, errorMessage)
					}
					definitionsChanged = true

					// Set error indicator in variable
					changedVars[subscription.variableName] = PATH_ERROR_UNSUBSCRIBED_VALUE
				} else {
					changedVars[subscription.variableName] = PATH_ERROR_VALUE
				}
				this.recordHistory(subscription.variableName, changedVars[subscription.variableName])
				affected.add(subscription.variableName)

				continue
			}

			subscription.value = valueUpdate.value
			subscription.error = undefined
			this.settleWaitingProbe(key, valueUpdate.value)

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
			this.recordHistory(subscription.variableName, valueUpdate.value)
			affected.add(subscription.variableName)
		}

		// Definitions first, so an error indicator written below reaches a defined variable
		if (definitionsChanged) {
			this.updateVariableDefinitions()
		}

		// Push all updated variables to Companion's variable system in one batch
		if (Object.keys(changedVars).length > 0) {
			this.setVariableValues(changedVars)
		}

		// Re-evaluate only the feedbacks bound to the variables that changed. The Director sends one
		// message per changed property, so re-checking every feedback of the connection here would
		// cost (messages per second) x (buttons on the page).
		const toCheck = this.feedbacksOfVariables(affected)
		if (toCheck.length > 0) this.checkFeedbacksById(...toCheck)
	}

	/**
	 * Update Companion's list of available module variables.
	 * Every variable owned by a placed LiveUpdate Variable feedback stays defined, whether or not
	 * its subscription is confirmed, so error indicators reach the button. The list is sent only
	 * when it differs from the one the host already has.
	 */
	private updateVariableDefinitions(): void {
		const variableDefinitions = getVariableDefinitions()
		const defined = new Set(variableDefinitions.map((definition) => definition.variableId))

		const add = (variableId: string, name: string): void => {
			if (defined.has(variableId) || !this.isReadoutName(variableId)) return
			defined.add(variableId)
			variableDefinitions.push({ variableId, name })
		}

		for (const sub of this.subscriptions.values()) {
			add(sub.variableName, `${sub.objectPath}.${sub.propertyPath}`)
		}
		// a request made from a subscribe hook, before the feedback's callback has cached its options
		for (const pending of this.pendingSubscriptions.values()) {
			if (pending.feedbackIds.size > 0) add(pending.variableName, `${pending.objectPath}.${pending.propertyPath}`)
		}
		for (const cached of this.feedbackOptionsCache.values()) {
			add(cached.variableName, `${cached.objectPath}.${cached.propertyPath}`)
		}
		for (const variableName of this.retainedVariables.values()) {
			add(variableName, variableName)
		}

		const signature = variableDefinitions.map((definition) => `${definition.variableId}\t${definition.name}`).join('\n')
		if (signature === this.definitionsSignature) return
		this.definitionsSignature = signature
		this.log('debug', `Setting ${variableDefinitions.length} variable definitions`)
		this.setVariableDefinitions(variableDefinitions)
	}

	/**
	 * Clean up pending subscriptions that have timed out; the feedbacks waiting for them back off
	 */
	private cleanupPendingSubscriptions(): void {
		const now = Date.now()
		const timeout = this.config.pendingSubscriptionTimeout ?? 30000

		for (const [key, pending] of [...this.pendingSubscriptions.entries()]) {
			// a request held back for a one-shot read goes out when the read ends, which has its own timeout
			if (pending.heldForProbe) continue
			if (now - pending.timestamp > timeout) {
				this.log('warn', `Pending subscription timed out: ${pending.objectPath}.${pending.propertyPath}`)
				this.pendingSubscriptions.delete(key)
				this.settleWaitingProbe(key, undefined)
				if (pending.feedbackIds.size === 0) {
					this.recheckVariable(pending.variableName)
					continue
				}
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
