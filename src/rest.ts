/**
 * Designer's Session REST API.
 *
 * LiveUpdate can read and write properties but cannot issue commands, so play, stop, section
 * navigation, RenderStream workload control and failover live here. The paths and request bodies
 * below come from the Director's own OpenAPI document, served at /docs/session/d3api.swagger.json
 * (d3 API 2.0.3), so they are not guesses; `scripts/rest-discover.mjs` re-reads it from a rig.
 *
 * Everything is POST with a JSON body under the same host and port as the WebSocket connection.
 */
import { isSentinel } from './variables'

/** A Designer object is addressed by uid or by name; the module sends the name the operator chose. */
export interface RestTarget {
	uid?: string
	name?: string
}

export type RestGroup = 'transport' | 'renderstream' | 'failover'

export interface RestEndpoint {
	/** Path under /api/session */
	path: string
	group: RestGroup
	/**
	 * A command that changes the shape of the session (RenderStream workloads, failover): gated behind
	 * "Allow destructive commands" and two presses. Transport commands are not, whatever they do to the
	 * output: they fire on one press.
	 */
	destructive: boolean
	summary: string
}

/**
 * Every command this module offers. The keys are stable: they are part of the action ids.
 */
export const REST_ENDPOINTS = {
	play: { path: '/transport/play', group: 'transport', destructive: false, summary: 'Play' },
	stop: { path: '/transport/stop', group: 'transport', destructive: false, summary: 'Stop' },
	playSection: {
		path: '/transport/playsection',
		group: 'transport',
		destructive: false,
		summary: 'Play to end of section',
	},
	loopSection: { path: '/transport/playloopsection', group: 'transport', destructive: false, summary: 'Loop section' },
	returnToStart: {
		path: '/transport/returntostart',
		group: 'transport',
		destructive: false,
		summary: 'Return to start',
	},
	nextSection: { path: '/transport/gotonextsection', group: 'transport', destructive: false, summary: 'Next section' },
	prevSection: {
		path: '/transport/gotoprevsection',
		group: 'transport',
		destructive: false,
		summary: 'Previous section',
	},
	nextTrack: { path: '/transport/gotonexttrack', group: 'transport', destructive: false, summary: 'Next track' },
	prevTrack: { path: '/transport/gotoprevtrack', group: 'transport', destructive: false, summary: 'Previous track' },
	gotoSection: { path: '/transport/gotosection', group: 'transport', destructive: false, summary: 'Go to section' },
	gotoTrack: { path: '/transport/gototrack', group: 'transport', destructive: false, summary: 'Go to track' },
	gotoTimecode: { path: '/transport/gototimecode', group: 'transport', destructive: false, summary: 'Go to timecode' },
	gotoTime: { path: '/transport/gototime', group: 'transport', destructive: false, summary: 'Go to time' },
	gotoTag: { path: '/transport/gototag', group: 'transport', destructive: false, summary: 'Go to tag' },
	gotoNote: { path: '/transport/gotonote', group: 'transport', destructive: false, summary: 'Go to note' },
	brightness: { path: '/transport/brightness', group: 'transport', destructive: false, summary: 'Set brightness' },
	volume: { path: '/transport/volume', group: 'transport', destructive: false, summary: 'Set volume' },
	speed: { path: '/transport/speed', group: 'transport', destructive: false, summary: 'Set speed' },
	engaged: { path: '/transport/engaged', group: 'transport', destructive: false, summary: 'Set engaged' },
	rsStart: {
		path: '/renderstream/startlayers',
		group: 'renderstream',
		destructive: true,
		summary: 'Start RenderStream layers',
	},
	rsStop: {
		path: '/renderstream/stoplayers',
		group: 'renderstream',
		destructive: true,
		summary: 'Stop RenderStream layers',
	},
	rsRestart: {
		path: '/renderstream/restartlayers',
		group: 'renderstream',
		destructive: true,
		summary: 'Restart RenderStream layers',
	},
	rsSync: {
		path: '/renderstream/synclayers',
		group: 'renderstream',
		destructive: true,
		summary: 'Sync RenderStream layers',
	},
	failoverMachine: {
		path: '/failover/failovermachine',
		group: 'failover',
		destructive: true,
		summary: 'Fail over machine',
	},
	restoreMachine: {
		path: '/failover/restoremachine',
		group: 'failover',
		destructive: true,
		summary: 'Restore machine',
	},
	defaultRouting: {
		path: '/failover/applydefaultrouting',
		group: 'failover',
		destructive: true,
		summary: 'Apply default routing',
	},
} as const satisfies Record<string, RestEndpoint>

export type RestCommand = keyof typeof REST_ENDPOINTS

/** Playmode values the API accepts where a command can also change the play state */
export const PLAYMODES = ['NotSet', 'Play', 'PlaySection', 'Loop', 'Stop'] as const

export interface RestResult {
	ok: boolean
	status: number
	/** The Director's own status.message, or the transport-level failure */
	message: string
	durationMs: number
	/** True when the Director does not know this path: the build has no such command */
	absent: boolean
}

/** The body shape of the transport commands that only name the transport */
export const transportsBody = (target: RestTarget): unknown => ({ transports: [target] })

/** The body shape of the transport commands that carry a parameter next to the transport */
export const transportsWith = (target: RestTarget, extra: Record<string, unknown>): unknown => ({
	transports: [{ transport: target, ...extra }],
})

export const layersBody = (targets: RestTarget[]): unknown => ({ layers: targets })
export const machineBody = (target: RestTarget): unknown => ({ machine: target })

/**
 * Text a command must not carry: empty, or still holding the host's '$NA' (an unknown variable, or a
 * selection the module publishes while it is empty) or a $(...) reference the host left unparsed, or
 * exactly one of the readout markers (PENDING, UNSET, OFFLINE, ...): a readout that has no value. Only
 * the whole text counts as a marker, so a name that contains one is sent, and 'name:' still reaches an
 * object named like one. Every free-text command parameter goes through this one test before anything
 * is sent.
 */
export function isUnresolvedText(text: string): boolean {
	const trimmed = text.trim()
	return !trimmed || trimmed.includes('$NA') || trimmed.includes('$(') || isSentinel(trimmed)
}

/**
 * A Designer object reference from a free-text option: 6 or more decimal digits are a uid,
 * anything else is a name. Both are accepted by every endpoint that takes {uid, name}. A name that
 * is all digits (a date-stamped track such as 20250914) would read as a uid, so the operator can
 * choose explicitly: 'name:<text>' is always a name, 'uid:<digits>' always a uid.
 *
 * Null when the text names nothing: empty, a bare prefix, or 'uid:' followed by anything but digits.
 */
export function parseTarget(text: string): RestTarget | null {
	const trimmed = text.trim()
	if (trimmed.startsWith('name:')) {
		const name = trimmed.slice('name:'.length).trim()
		return name ? { name } : null
	}
	if (trimmed.startsWith('uid:')) {
		const uid = trimmed.slice('uid:'.length).trim()
		return /^\d+$/.test(uid) ? { uid } : null
	}
	if (!trimmed) return null
	if (/^\d{6,}$/.test(trimmed)) return { uid: trimmed }
	return { name: trimmed }
}

export interface RestClientOptions {
	host: string
	port: number
	timeoutMs: number
	log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
}

/**
 * Minimal POST client. No dependency: node18 has global fetch, which is also what Companion's
 * module runtime provides.
 */
export class RestClient {
	private options: RestClientOptions
	/** Paths the Director answered 404/405 for; not retried until the next rescan */
	private absent: Set<string> = new Set()

	constructor(options: RestClientOptions) {
		this.options = options
	}

	update(options: Partial<RestClientOptions>): void {
		this.options = { ...this.options, ...options }
		this.absent.clear()
	}

	forget(): void {
		this.absent.clear()
	}

	get baseUrl(): string {
		return `http://${this.options.host}:${this.options.port}/api/session`
	}

	isAbsent(command: RestCommand): boolean {
		return this.absent.has(REST_ENDPOINTS[command].path)
	}

	async post(command: RestCommand, body: unknown): Promise<RestResult> {
		const endpoint = REST_ENDPOINTS[command]
		const url = this.baseUrl + endpoint.path
		if (this.absent.has(endpoint.path)) {
			return { ok: false, status: 0, message: 'this Designer build has no such command', durationMs: 0, absent: true }
		}
		const started = Date.now()
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
		try {
			// eslint-disable-next-line n/no-unsupported-features/node-builtins -- global fetch ships in Node 18, which is the runtime Companion gives this module (manifest runtime.type node18)
			const response = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: controller.signal,
			})
			const absent = response.status === 404 || response.status === 405
			if (absent) this.absent.add(endpoint.path)
			let message = ''
			try {
				const text = await response.text()
				try {
					const parsed = JSON.parse(text) as {
						status?: { message?: string; code?: number; details?: { message?: string }[] }
					}
					message = parsed.status?.message ?? ''
					// A refused command answers HTTP 200 with a non-zero status code; the reason is in
					// status.message, or - when that is empty - in the first detail. Live example:
					// POST /transport/speed -> 200 code 1000 "Transport speed control is disabled."
					if (!message) message = parsed.status?.details?.find((d) => d.message)?.message ?? ''
					if (!message && parsed.status?.code) message = `status code ${parsed.status.code}`
				} catch {
					message = text.slice(0, 200)
				}
			} catch (error) {
				// The timer still runs while the body is read. A reply that stalls or breaks after the
				// headers may carry a refusal we never saw, so the outcome is unknown: a failure, never OK.
				message =
					error instanceof Error && error.name === 'AbortError'
						? 'timed out reading the reply'
						: `could not read the reply${error instanceof Error && error.message ? `: ${error.message}` : ''}`
			}
			const durationMs = Date.now() - started
			const ok = response.ok && !message
			this.options.log(
				ok ? 'debug' : 'warn',
				`REST ${endpoint.path} -> ${response.status}${message ? ` (${message})` : ''} in ${durationMs} ms`,
			)
			return { ok, status: response.status, message, durationMs, absent }
		} catch (error) {
			const durationMs = Date.now() - started
			const message =
				error instanceof Error ? (error.name === 'AbortError' ? 'timed out' : error.message) : String(error)
			this.options.log('warn', `REST ${endpoint.path} failed after ${durationMs} ms: ${message}`)
			return { ok: false, status: 0, message, durationMs, absent: false }
		} finally {
			clearTimeout(timer)
		}
	}
}
