/**
 * Test harness for the built module (dist/).
 *
 * `@companion-module/base` is replaced by a stub InstanceBase that records what the module sends
 * to the host and drives the REAL module-base FeedbackManager, so feedback subscribe / callback /
 * unsubscribe run exactly as in Companion. `ws` is replaced by an in-process fake that talks to a
 * FakeDirector implementing the LiveUpdate protocol (subscribe / unsubscribe / set / errors).
 * Call `installHarness()` before requiring anything from dist/.
 */
import Module from 'node:module'
import path from 'node:path'
import { EventEmitter } from 'node:events'

export const ROOT = path.resolve(__dirname, '..')

/* eslint-disable @typescript-eslint/no-require-imports */
const realBase = require(path.join(ROOT, 'node_modules/@companion-module/base'))
const { FeedbackManager } = require(path.join(ROOT, 'node_modules/@companion-module/base/dist/internal/feedback.js'))
/* eslint-enable @typescript-eslint/no-require-imports */

export interface DirectorSubscription {
	id: number
	objectPath: string
	propertyPath: string
	ref: number
	updateFrequencyMs?: number
}

/** The pair the module reads the Designer version from on every connection */
export const VERSION_OBJECT = 'subsystem:MonitoringManager'
export const VERSION_PROPERTY = 'ReleaseVersion.versionString()'

export interface FakeDirectorOptions {
	/** Reference-count identical subscriptions like the real Director */
	refCount?: boolean
	/** Return an error text for a subscribe request, or null to accept it */
	errorFor?: (objectPath: string, propertyPath: string) => string | null
	/** Return an error value ({errorType, message}) that the Director sends as the property value */
	errorValueFor?: (objectPath: string, propertyPath: string) => unknown
	/** Value to send on confirmation, or undefined to send nothing */
	valueFor?: (objectPath: string, propertyPath: string) => unknown
	/** Never answer (simulates a Director that ignores requests) */
	silent?: boolean
	/**
	 * The Designer version the Director answers for the version pair, whatever errorFor and valueFor
	 * say (default 'r34.0.3'). null leaves the pair to errorFor and valueFor like any other.
	 */
	version?: string | null
	/** The socket never opens (a Director that is switched off) */
	unreachable?: boolean
}

/**
 * In-process Director speaking the LiveUpdate protocol over the fake socket
 */
export class FakeDirector {
	subs: DirectorSubscription[] = []
	received: any[] = []
	nextId = 1
	sock: FakeWebSocket | null = null
	/** Ids handed out for the version pair, so count() can leave the connect-time version read out */
	private versionIds = new Set<number>()
	/** Replies held back by hold(), in order */
	private held: { sock: FakeWebSocket | null; msg: unknown }[] | null = null
	opts: FakeDirectorOptions

	constructor(opts: FakeDirectorOptions = {}) {
		this.opts = opts
	}

	attach(sock: FakeWebSocket): void {
		this.sock = sock
	}

	/** The client went away: like the real Director, drop everything it subscribed to */
	detach(sock: FakeWebSocket): void {
		if (this.sock === sock) this.subs = []
	}

	/** Keep every reply back until release(), so a test can act while requests are in flight */
	hold(): void {
		this.held ??= []
	}

	/** Deliver the held replies in the order they were produced, and answer at once again */
	release(): void {
		const held = this.held ?? []
		this.held = null
		for (const { sock, msg } of held) setImmediate(() => sock?.emit('message', Buffer.from(JSON.stringify(msg))))
	}

	/** Director reference count of a pair (0 when the Director does not hold it) */
	refs(objectPath: string, propertyPath: string): number {
		return this.subs
			.filter((s) => s.objectPath === objectPath && s.propertyPath === propertyPath)
			.reduce((total, s) => total + s.ref, 0)
	}

	/** Report a subscription list the module did not ask for (an out-of-band Director state) */
	announce(extra: { id: number; objectPath: string; propertyPath: string }[]): void {
		this.reply({
			subscriptions: [
				...this.subs.map((s) => ({ id: s.id, objectPath: s.objectPath, propertyPath: s.propertyPath })),
				...extra,
			],
		})
	}

	reply(msg: unknown): void {
		const sock = this.sock
		if (this.held) {
			this.held.push({ sock, msg })
			return
		}
		setImmediate(() => sock?.emit('message', Buffer.from(JSON.stringify(msg))))
	}

	private subscriptionsMessage(): unknown {
		return {
			subscriptions: this.subs.map((s) => ({ id: s.id, objectPath: s.objectPath, propertyPath: s.propertyPath })),
		}
	}

	handle(raw: string): void {
		const m = JSON.parse(raw)
		this.received.push(m)
		if (this.opts.silent) return
		if (m.subscribe) {
			const objectPath = String(m.subscribe.object)
			// the Director answers a frame with several properties with one subscription each
			for (const property of m.subscribe.properties as string[]) {
				const propertyPath = String(property)
				const isVersion =
					objectPath === VERSION_OBJECT && propertyPath === VERSION_PROPERTY && this.opts.version !== null
				const error = isVersion ? null : this.opts.errorFor?.(objectPath, propertyPath)
				if (error) {
					this.reply({ error })
					continue
				}
				let sub = this.opts.refCount
					? this.subs.find((s) => s.objectPath === objectPath && s.propertyPath === propertyPath)
					: undefined
				if (sub) sub.ref++
				else {
					sub = {
						id: this.nextId++,
						objectPath,
						propertyPath,
						ref: 1,
						updateFrequencyMs: m.subscribe.configuration?.updateFrequencyMs,
					}
					this.subs.push(sub)
				}
				this.reply(this.subscriptionsMessage())
				if (isVersion) {
					this.versionIds.add(sub.id)
					this.pushValue(sub.id, this.opts.version ?? 'r34.0.3')
					continue
				}
				const errorValue = this.opts.errorValueFor?.(objectPath, propertyPath)
				if (errorValue !== undefined) this.pushValue(sub.id, errorValue)
				else {
					const value = this.opts.valueFor?.(objectPath, propertyPath)
					if (value !== undefined) this.pushValue(sub.id, value)
				}
			}
		} else if (m.unsubscribe) {
			const ids: number[] = m.unsubscribe.ids ?? [m.unsubscribe.id]
			for (const id of ids) {
				const sub = this.subs.find((s) => s.id === id)
				if (!sub) continue
				sub.ref--
				if (sub.ref <= 0 || !this.opts.refCount) this.subs = this.subs.filter((s) => s !== sub)
			}
			this.reply(this.subscriptionsMessage())
		} else if (m.set) {
			for (const item of m.set) {
				const sub = this.subs.find((s) => s.id === item.id)
				if (sub) this.pushValue(sub.id, item.value)
			}
		}
	}

	pushValue(id: number, value: unknown): void {
		this.reply({ valuesChanged: [{ id, value, changeTimestamp: 1, messageTimestamp: 2 }] })
	}

	pushValueForPair(objectPath: string, propertyPath: string, value: unknown): void {
		const sub = this.subs.find((s) => s.objectPath === objectPath && s.propertyPath === propertyPath)
		if (!sub) throw new Error(`no subscription for ${objectPath} / ${propertyPath}`)
		this.pushValue(sub.id, value)
	}

	/**
	 * The connect-time Designer version read: its single-property subscribe frame and the unsubscribe
	 * that releases it. Every connection makes it, so count() leaves it out; `received` has it.
	 */
	private isVersionRead(m: any): boolean {
		if (m.subscribe)
			return (
				m.subscribe.object === VERSION_OBJECT &&
				m.subscribe.properties.length === 1 &&
				m.subscribe.properties[0] === VERSION_PROPERTY
			)
		if (m.unsubscribe) return this.versionIds.has(m.unsubscribe.id)
		return false
	}

	/** Properties asked for across every subscribe frame: the module may batch them per object */
	subscribedProperties(): number {
		return this.received
			.filter((m) => m.subscribe && !this.isVersionRead(m))
			.reduce((total, m) => total + m.subscribe.properties.length, 0)
	}

	/** Frames of one kind the module sent, leaving out the connect-time version read */
	count(kind: 'subscribe' | 'unsubscribe' | 'set'): number {
		return this.received.filter((m) => m[kind] && !this.isVersionRead(m)).length
	}
}

let currentDirector: FakeDirector | null = null

export class FakeWebSocket extends EventEmitter {
	static CONNECTING = 0
	static OPEN = 1
	static CLOSING = 2
	static CLOSED = 3
	readyState = FakeWebSocket.CONNECTING
	url: string
	private director: FakeDirector
	constructor(url: string) {
		super()
		this.url = url
		if (!currentDirector) throw new Error('no FakeDirector installed')
		this.director = currentDirector
		this.director.attach(this)
		if (this.director.opts.unreachable) return
		setImmediate(() => {
			this.readyState = FakeWebSocket.OPEN
			this.emit('open')
		})
	}
	send(data: string): void {
		this.director.handle(data)
	}
	terminate(): void {
		this.close()
	}
	close(): void {
		this.readyState = FakeWebSocket.CLOSED
		this.director.detach(this)
		setImmediate(() => this.emit('close', 1000, Buffer.from('')))
	}
	/** Simulate the Director dropping the connection */
	drop(): void {
		this.readyState = FakeWebSocket.CLOSED
		this.director.detach(this)
		this.emit('close', 1006, Buffer.from('dropped'))
	}
}

export interface HostRecord {
	logs: { level: string; message: string }[]
	statuses: { status: string; message?: string }[]
	definedVariables: Set<string>
	variables: Map<string, unknown>
	savedConfigs: unknown[]
	presetDefinitions: Record<string, unknown>
	actionDefinitions: Record<string, any>
	feedbackDefinitions: Record<string, any>
	variableDefinitionCalls: number
	/** The latest value each feedback instance reported to the host, by instance id: what the button shows */
	feedbackValues: Map<string, unknown>
}

/**
 * Stub of InstanceBase: records host traffic, emulates the variable store rules of module-base
 * (values of undefined variables are dropped) and drives the real FeedbackManager.
 */
export class StubInstanceBase {
	host: HostRecord = {
		logs: [],
		statuses: [],
		definedVariables: new Set(),
		variables: new Map(),
		savedConfigs: [],
		presetDefinitions: {},
		actionDefinitions: {},
		feedbackDefinitions: {},
		variableDefinitionCalls: 0,
		feedbackValues: new Map(),
	}
	fm: any
	label = 'liveupdate'

	constructor() {
		this.fm = new FeedbackManager(
			async ({ text }: { text: string }) => ({ text }),
			// module-base sends the values debounced (5 ms, at most 25 ms); settle() waits for them
			(msg: { values: { id: string; value: unknown }[] }) => {
				for (const entry of msg.values) this.host.feedbackValues.set(entry.id, entry.value)
			},
			() => {},
			(level: string, message: string) => this.log(level, message),
		)
	}

	log(level: string, message: string): void {
		this.host.logs.push({ level, message })
	}
	updateStatus(status: string, message?: string): void {
		this.host.statuses.push({ status, message })
	}
	setActionDefinitions(definitions: Record<string, any>): void {
		this.host.actionDefinitions = definitions
	}
	setFeedbackDefinitions(definitions: Record<string, any>): void {
		this.host.feedbackDefinitions = definitions
		this.fm.setFeedbackDefinitions(definitions)
	}
	setPresetDefinitions(definitions: Record<string, unknown>): void {
		this.host.presetDefinitions = definitions
	}
	setVariableDefinitions(definitions: { variableId: string }[]): void {
		this.host.variableDefinitionCalls++
		this.host.definedVariables = new Set(definitions.map((d) => d.variableId))
		for (const id of [...this.host.variables.keys()]) {
			if (!this.host.definedVariables.has(id)) this.host.variables.delete(id)
		}
	}
	setVariableValues(values: Record<string, unknown>): void {
		for (const [id, value] of Object.entries(values)) {
			if (value === undefined || !this.host.definedVariables.has(id)) this.host.variables.delete(id)
			else this.host.variables.set(id, value)
		}
	}
	getVariableValue(id: string): unknown {
		return this.host.variables.get(id)
	}
	saveConfig(config: unknown): void {
		this.host.savedConfigs.push(config)
	}
	checkFeedbacks(...types: string[]): void {
		this.fm.checkFeedbacks(types)
	}
	checkFeedbacksById(...ids: string[]): void {
		this.fm.checkFeedbacksById(ids)
	}
	subscribeFeedbacks(...ids: string[]): void {
		this.fm.subscribeFeedbacks(ids)
	}
	unsubscribeFeedbacks(...ids: string[]): void {
		this.fm.unsubscribeFeedbacks(ids)
	}

	/** Insert or update feedback instances the way the host does */
	updateFeedbacks(feedbacks: Record<string, FeedbackInstance | null>): void {
		this.fm.handleUpdateFeedbacks(feedbacks)
	}
}

export interface FeedbackInstance {
	id: string
	feedbackId: string
	controlId: string
	options: Record<string, unknown>
	upgradeIndex: null
	disabled: boolean
	isInverted?: boolean
}

export function liveUpdateFeedback(
	id: string,
	objectPath: string,
	propertyPath: string,
	variableName: string,
	updateFrequency = 0,
): FeedbackInstance {
	return {
		id,
		feedbackId: 'liveUpdateVariable',
		controlId: 'ctl_' + id,
		options: { variableName, objectPath, propertyPath, updateFrequency },
		upgradeIndex: null,
		disabled: false,
	}
}

let installed = false

export interface HarnessOptions {
	/** Use the in-process fake socket (default) or the real ws module (for the mock server tests) */
	fakeSocket?: boolean
}

/**
 * Hook module resolution so that dist/ sees the stub base and (optionally) the fake socket.
 */
export function installHarness(options: HarnessOptions = {}): void {
	if (installed) return
	installed = true
	const fakeSocket = options.fakeSocket ?? true
	const origLoad = (Module as any)._load
	;(Module as any)._load = function (request: string, ...rest: unknown[]) {
		if (request === '@companion-module/base')
			return { ...realBase, InstanceBase: StubInstanceBase, runEntrypoint: () => {} }
		if (request === 'ws' && fakeSocket) return FakeWebSocket
		return origLoad.call(this, request, ...rest)
	}
}

export function loadDist(): {
	DisguiseInstance: any
	isUnresolvedPath: (path: string) => boolean
	isUnresolvedObjectPath: (path: string) => boolean
	designerMajor: (version: string) => string | undefined
	SENTINELS: readonly string[]
	compareValues: (actual: unknown, operator: string, expected: string) => boolean
	readBooleanValue: (value: unknown) => boolean | undefined
	validateSelection: (id: string, value: string) => string | undefined
	readSelections: (
		config: Record<string, unknown>,
		onInvalid?: (id: string, message: string) => void,
	) => Record<string, string>
	SELECTIONS: any[]
	getPresetDefinitions: (instance: any) => Record<string, any>
	getActionDefinitions: (instance: any) => Record<string, any>
	getRestActionDefinitions: (instance: any) => Record<string, any>
	getFeedbackDefinitions: (instance: any) => Record<string, any>
	PRESET_CATALOG: any[]
	PRESET_TEXTS: any[]
	getPresetInterval: (config: any, cls: string) => number
} {
	installHarness()
	/* eslint-disable @typescript-eslint/no-require-imports */
	const index = require(path.join(ROOT, 'dist/index.js'))
	const feedbacks = require(path.join(ROOT, 'dist/feedbacks.js'))
	const actions = require(path.join(ROOT, 'dist/actions.js'))
	const selections = require(path.join(ROOT, 'dist/selections.js'))
	const presets = require(path.join(ROOT, 'dist/presets.js'))
	const catalog = require(path.join(ROOT, 'dist/presetCatalog.js'))
	const config = require(path.join(ROOT, 'dist/config.js'))
	const restActions = require(path.join(ROOT, 'dist/restActions.js'))
	/* eslint-enable @typescript-eslint/no-require-imports */
	return {
		DisguiseInstance: index.DisguiseInstance,
		isUnresolvedPath: index.isUnresolvedPath,
		isUnresolvedObjectPath: index.isUnresolvedObjectPath,
		designerMajor: index.designerMajor,
		SENTINELS: index.SENTINELS,
		compareValues: feedbacks.compareValues,
		readBooleanValue: actions.readBooleanValue,
		validateSelection: selections.validateSelection,
		readSelections: selections.readSelections,
		SELECTIONS: selections.SELECTIONS,
		getPresetDefinitions: presets.getPresetDefinitions,
		getActionDefinitions: (instance: any) => ({
			...actions.getActionDefinitions(instance),
			...restActions.getRestActionDefinitions(instance),
		}),
		getRestActionDefinitions: restActions.getRestActionDefinitions,
		getFeedbackDefinitions: feedbacks.getFeedbackDefinitions,
		PRESET_CATALOG: catalog.PRESET_CATALOG,
		PRESET_TEXTS: catalog.PRESET_TEXTS,
		getPresetInterval: config.getPresetInterval,
	}
}

export const tick = async (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** One turn of the event loop: the fake socket, the module and the FeedbackManager queue their work this way */
export const hop = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * Let queued socket replies and feedback checks run, then the host's debounced feedback values.
 * It waits for event-loop turns rather than timer rounds, so it takes the same few tens of
 * milliseconds on every machine whatever its timer resolution; a test that has to see a longer
 * timer fire (write coalescing, back-off, timeouts) waits for it with tick().
 */
export async function settle(rounds = 30): Promise<void> {
	for (let i = 0; i < rounds; i++) await hop()
	// module-base sends feedback values debounced: 5 ms after the last check, at most 25 ms
	await tick(30)
	for (let i = 0; i < rounds; i++) await hop()
}

/** Wait until the predicate holds (checked every event-loop turn and every few ms), at most `ms` */
export async function until(predicate: () => boolean, ms = 2000): Promise<boolean> {
	const deadline = Date.now() + ms
	while (!predicate()) {
		if (Date.now() > deadline) return false
		await hop()
		await tick(1)
	}
	return true
}

export interface Instance {
	inst: any
	host: HostRecord
	stub: StubInstanceBase
}

/** Every instance newInstance created and nobody destroyed yet */
const liveInstances = new Set<any>()

/**
 * Destroy every instance a test left behind. A test that fails before its own destroy() would
 * otherwise keep its reconnect and back-off timers running: they hang the test file and attach a
 * reconnecting socket to the next test's Director. Register it with afterEach.
 */
export async function destroyInstances(): Promise<void> {
	for (const inst of [...liveInstances]) await inst.destroy()
	liveInstances.clear()
}

/**
 * Create a connected module instance against the given FakeDirector with the given feedbacks placed
 */
export async function newInstance(
	director: FakeDirector,
	feedbacks: FeedbackInstance[] = [],
	config: Record<string, unknown> = {},
): Promise<Instance> {
	const { DisguiseInstance } = loadDist()
	currentDirector = director
	const inst = new DisguiseInstance()
	liveInstances.add(inst)
	const fullConfig = {
		// the fake socket ignores it; loopback keeps a command channel test from reaching the network
		host: '127.0.0.1',
		port: 80,
		reconnectInterval: 5000,
		pendingSubscriptionTimeout: 30000,
		discoverOnConnect: false,
		...config,
	}
	const initPromise = inst.init(fullConfig)
	if (feedbacks.length) {
		const update: Record<string, FeedbackInstance> = {}
		for (const feedback of feedbacks) update[feedback.id] = feedback
		inst.updateFeedbacks(update)
	}
	await initPromise
	await settle()
	return { inst, host: inst.host, stub: inst }
}

export function useDirector(director: FakeDirector): void {
	currentDirector = director
}
