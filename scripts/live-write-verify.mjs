// Live verification of the WRITE side of the catalog against a Designer Director.
//
// This script changes values in the running project. For every target it reads the current value,
// writes a small change, waits for the Director to report it, writes the original value back, waits
// for that too, and finally re-reads every touched property. A restore that fails stops the run.
// If the run is interrupted (Ctrl+C), crashes or loses the connection while a value is changed, the
// handler writes the original value back when it still can, prints "SET THIS BACK BY HAND" for what
// it could not, exits non-zero and always leaves the results file on disk. A final read-back that
// cannot read a value counts as not confirmed.
//
// Targets are grouped by their effect on the show output:
//   neutral (default) - layer properties on a track that is NOT the transport's current track, and
//                       that track's tc_adjust. Nothing that is on air changes. The script refuses
//                       to write when the track is the current one (a single-track project, or
//                       --track) or when the current track could not be read.
//   output            - master brightness/volume, surface and projector master fade, hold output,
//                       surface offset/rotation, render layer (on/off stage), Expression Variables.
//                       These are visible on the live output for the moment between write and
//                       restore; the script refuses to run them while the transport is playing, or
//                       when the playing state could not be read.
// --force skips those refusals. Machine.role / targets / hostname (failover topology) are never
// written.
//
// Usage:
//   node scripts/live-write-verify.mjs --host 192.0.2.10 [--port 80] [--group neutral|output|all]
//        [--yes] [--force] [--track "Track 1"] [--layer "Video 1"] [--screen "surface 1"]
//        [--projector "projector 1"] [--screen-uid 0x...] [--ev-uid 0x...] [--timeout 4000]
//        [--only <substring of a property path or preset id>]
//        [--out <file, default .live/live-write-verification.json>]
//
// Without --yes nothing is written: the script discovers the targets, reads the current values and
// prints the plan. The results file is raw site data; it goes to the git-ignored .live/ folder unless
// --out names another file.

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const require = createRequire(import.meta.url)
const {
	liveOutFile,
	siteDataReminder,
	writeRefusal,
	unverifiedLabel,
	unsettled,
	watchClose,
} = require('./live-safety.cjs')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
if (!args.host) {
	console.error('usage: node scripts/live-write-verify.mjs --host <director> [--group neutral|output|all] [--yes]')
	process.exit(2)
}
const host = args.host
const port = Number(args.port ?? 80)
const timeout = Number(args.timeout ?? 4000)
const write = args.yes === true
const force = args.force === true
const group = String(args.group ?? 'neutral')
if (!['neutral', 'output', 'all'].includes(group)) {
	console.error(`unknown --group ${group}`)
	process.exit(2)
}
const outFile = liveOutFile(root, args.out, 'live-write-verification.json')

function parseArgs(argv) {
	const out = {}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (!a.startsWith('--')) continue
		const key = a.slice(2)
		const next = argv[i + 1]
		if (next === undefined || next.startsWith('--')) out[key] = true
		else {
			out[key] = next
			i++
		}
	}
	return out
}

// ---------- LiveUpdate client ----------
class Client {
	constructor(url) {
		this.url = url
		this.ws = null
		this.subscriptions = []
		this.waiters = []
		this.errors = []
		this.latest = new Map()
		/** called with a reason when the Director closes the connection */
		this.onUnexpectedClose = null
		this.closeSocket = null
	}
	async connect() {
		this.ws = new WebSocket(this.url)
		await new Promise((res, rej) => {
			this.ws.once('open', res)
			this.ws.once('error', rej)
		})
		this.ws.on('error', (e) => this.errors.push({ at: stamp(), error: `socket: ${e.message}` }))
		this.ws.on('message', (d) => this.onMessage(d.toString()))
		this.closeSocket = watchClose(this.ws, (reason) => this.onUnexpectedClose?.(reason))
	}
	/** The script's own close, which is not an interruption */
	close() {
		if (this.closeSocket) this.closeSocket()
	}
	onMessage(text) {
		let msg
		try {
			msg = JSON.parse(text)
		} catch {
			return
		}
		if (msg.subscriptions) this.subscriptions = msg.subscriptions
		if (msg.valuesChanged) for (const v of msg.valuesChanged) this.latest.set(v.id, v.value)
		if (msg.error) this.errors.push({ at: stamp(), error: String(msg.error) })
		for (const w of [...this.waiters]) {
			if (w.test(msg)) {
				this.waiters = this.waiters.filter((x) => x !== w)
				w.resolve(msg)
			}
		}
	}
	send(m) {
		if (this.ws.readyState !== WebSocket.OPEN) throw new Error('socket is not open')
		this.ws.send(JSON.stringify(m))
	}
	waitFor(test, ms) {
		return new Promise((resolve) => {
			const w = { test, resolve }
			this.waiters.push(w)
			const timer = setTimeout(() => {
				if (this.waiters.includes(w)) {
					this.waiters = this.waiters.filter((x) => x !== w)
					resolve(null)
				}
			}, ms)
			if (typeof timer.unref === 'function') timer.unref()
		})
	}
	/** Subscribe and wait for the first value. Returns {id, value} or {id?, error}. */
	async subscribe(o, p, updateFrequencyMs = 200) {
		const errText = `${o} / ${p}`
		const outcome = this.waitFor(
			(m) =>
				(m.error && String(m.error).includes(errText)) ||
				(m.subscriptions && m.subscriptions.some((s) => s.objectPath === o && s.propertyPath === p)),
			timeout,
		)
		this.send({ subscribe: { object: o, properties: [p], configuration: { updateFrequencyMs } } })
		const a = await outcome
		if (!a) return { error: 'timeout waiting for the subscription answer' }
		if (a.error) return { error: String(a.error) }
		const sub = a.subscriptions.find((s) => s.objectPath === o && s.propertyPath === p)
		const known = this.latest.get(sub.id)
		if (known !== undefined) return finishRead(sub.id, known)
		const vm = await this.waitFor((m) => m.valuesChanged && m.valuesChanged.some((v) => v.id === sub.id), timeout)
		if (!vm) return { id: sub.id, error: 'no value within the timeout' }
		return finishRead(sub.id, vm.valuesChanged.find((v) => v.id === sub.id).value)
	}
	async unsubscribe(id) {
		const released = this.waitFor((m) => m.subscriptions && !m.subscriptions.some((s) => s.id === id), timeout)
		this.send({ unsubscribe: { id } })
		await released
		this.latest.delete(id)
	}
	/**
	 * Send one set and wait until the subscription reports a value accepted by `matches`.
	 * The set is ALWAYS sent: a restore must never be skipped because the cached value looks right.
	 */
	async setAndWait(id, value, matches, ms = timeout) {
		const errorsBefore = this.errors.length
		const wait = this.waitFor(
			(m) => m.valuesChanged && m.valuesChanged.some((v) => v.id === id && matches(v.value)),
			ms,
		)
		this.send({ set: [{ id, value }] })
		const m = await wait
		const errors = this.errors.slice(errorsBefore).map((e) => e.error)
		if (!m) return { ok: false, value: this.latest.get(id), errors }
		return { ok: true, value: m.valuesChanged.find((v) => v.id === id).value, errors }
	}
}

function finishRead(id, value) {
	if (value && typeof value === 'object' && value.errorType) return { id, error: JSON.stringify(value) }
	return { id, value }
}

// ---------- helpers ----------
const stamp = () => new Date().toISOString()
const near = (a, b) =>
	typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))
const numberMatch = (expected) => (v) => near(v, expected)
const boolMatch = (expected) => (v) => v === expected
const objectMatch = (expected) => (v) =>
	v &&
	typeof v === 'object' &&
	Object.entries(expected).every(([k, x]) => (typeof x === 'number' ? near(v[k], x) : v[k] === x))
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const nudge01 = (v, d) => (v > 0.5 ? clamp01(v - d) : clamp01(v + d))
const short = (v) => {
	const t = typeof v === 'string' ? v : JSON.stringify(v)
	return t && t.length > 120 ? t.slice(0, 120) + '…' : t
}
const finite = (x) => typeof x === 'number' && Number.isFinite(x)

// ---------- state shared with the interrupt handler ----------
const state = {
	client: null,
	results: [],
	meta: {},
	/** {id, label, original, match} while a value is changed and not yet restored */
	inFlight: null,
	aborted: false,
	saving: false,
}

function saveResults(extra = {}) {
	const summary = {}
	for (const e of state.results) summary[e.result] = (summary[e.result] || 0) + 1
	mkdirSync(dirname(outFile), { recursive: true })
	writeFileSync(
		outFile,
		JSON.stringify(
			{
				...state.meta,
				date: stamp(),
				summary,
				directorErrors: state.client?.errors ?? [],
				inFlight: state.inFlight ? { ...state.inFlight, match: undefined } : null,
				...extra,
				results: state.results,
			},
			null,
			1,
		),
	)
}

async function emergencyRestore(reason) {
	if (state.saving) return
	state.saving = true
	const f = state.inFlight
	console.error(`\n!! ${reason}`)
	if (f) {
		console.error(`!! restoring ${f.label} to ${short(f.original)}`)
		try {
			const r = await state.client.setAndWait(f.id, f.original, f.match, 3000)
			console.error(r.ok ? '!! restored' : `!! RESTORE FAILED, the Director still reports ${short(r.value)}`)
			if (!r.ok) console.error(`!! SET THIS BACK BY HAND: ${f.label} = ${JSON.stringify(f.original)}`)
			saveResults({ interrupted: reason, emergencyRestore: r.ok ? 'ok' : 'failed' })
		} catch (e) {
			console.error(`!! could not restore: ${String(e)}`)
			console.error(`!! SET THIS BACK BY HAND: ${f.label} = ${JSON.stringify(f.original)}`)
			saveResults({ interrupted: reason, emergencyRestore: 'not sent: ' + String(e) })
		}
	} else {
		saveResults({ interrupted: reason })
	}
	// values an earlier restore or the final read-back could not confirm
	for (const e of unsettled(state.results).byHand)
		console.error(
			`!! SET THIS BACK BY HAND: ${e.object} / ${e.property} = ${JSON.stringify(e.restoreValue ?? e.before)}`,
		)
	console.error(`!! results written to ${outFile}`)
	for (const line of siteDataReminder(root, outFile)) console.error(line)
	process.exit(1)
}

process.on('SIGINT', () => void emergencyRestore('interrupted (SIGINT)'))
process.on('SIGTERM', () => void emergencyRestore('terminated (SIGTERM)'))
process.on('uncaughtException', (e) => void emergencyRestore(`uncaught exception: ${String(e)}`))
process.on('unhandledRejection', (e) => void emergencyRestore(`unhandled rejection: ${String(e)}`))

// ---------- discovery ----------
async function discover(client) {
	const sel = {
		track: args.track,
		layer: args.layer,
		screen: args.screen,
		projector: args.projector,
		screenUid: args['screen-uid'],
		evUid: args['ev-uid'],
	}
	const read = async (o, p) => {
		const r = await client.subscribe(o, p)
		if (r.id !== undefined) await client.unsubscribe(r.id)
		return r
	}
	const current = await read('transportManager:default', 'object.track.description')
	const playing = await read('transportManager:default', 'object.player.playing')
	const tracks = await read(
		'subsystem:D3NetManagerSystem',
		'[t.description for t in resourceManager.allResources(Track)]',
	)
	const notes = []
	const known = typeof current.value === 'string'
	if (!known) notes.push(`WARNING: the transport's current track could not be read (${current.error ?? 'no value'})`)
	if (!sel.track) {
		const list = Array.isArray(tracks.value) ? tracks.value : []
		if (!Array.isArray(tracks.value))
			notes.push(`WARNING: the track list could not be read (${tracks.error ?? 'no list'})`)
		const other = list.find((t) => t !== current.value)
		sel.track = other ?? (known ? current.value : undefined)
		if (sel.track === undefined) notes.push('no track found; the track and layer tests are skipped')
		else if (!known) notes.push(`layer tests would use track "${sel.track}", which may be on air`)
		else if (other)
			notes.push(`layer tests use track "${sel.track}", which is not the transport's current track "${current.value}"`)
		else notes.push(`WARNING: only one track is available, and it is the transport's current track "${sel.track}"`)
	} else if (sel.track === current.value) {
		notes.push(`WARNING: --track is the transport's current track "${sel.track}"; layer changes would be on air`)
	}
	if (!sel.layer && sel.track) {
		const video = await read(`track:"${sel.track}"`, '[l.name for l in object.getLeafLayers(VariableVideoModule)]')
		sel.layer = Array.isArray(video.value) ? video.value[0] : undefined
		if (!sel.layer) notes.push(`track "${sel.track}" has no Video layer; the layer tests are skipped`)
	}
	if (!sel.screen) {
		const screens = await read(
			'subsystem:D3NetManagerSystem',
			'[s.description for s in resourceManager.allResources(Screen2)]',
		)
		sel.screen = Array.isArray(screens.value) ? screens.value[0] : undefined
	}
	if (!sel.projector) {
		const projectors = await read(
			'subsystem:D3NetManagerSystem',
			'[p.description for p in resourceManager.allResources(Projector)]',
		)
		sel.projector = Array.isArray(projectors.value) ? projectors.value[0] : undefined
	}
	if (!sel.screenUid && sel.screen) {
		const uid = await read(`screen2:"${sel.screen}"`, '"0x%x" % object.uid')
		sel.screenUid = typeof uid.value === 'string' ? uid.value : undefined
	}
	if (!sel.evUid) {
		const ev = await read(
			'subsystem:D3NetManagerSystem',
			'["0x%x" % d.uid for d in resourceManager.allResources(ExpressionVariablesDevice)]',
		)
		sel.evUid = Array.isArray(ev.value) ? ev.value[0] : undefined
	}
	return { sel, currentTrack: current.value, playing: playing.value, tracks: tracks.value, notes }
}

// ---------- targets ----------
function targets(sel) {
	const layer = sel.track && sel.layer ? `track:"${sel.track}".findLayerByName("${sel.layer}")` : null
	const screen = sel.screen ? `screen2:"${sel.screen}"` : null
	const projector = sel.projector ? `projector:"${sel.projector}"` : null
	const byUid = sel.screenUid ? `getByUID(${sel.screenUid})` : null
	const ev = sel.evUid ? `getByUID(${sel.evUid})` : null
	const list = [
		// ---- neutral: the selected track is not on air ----
		sel.track && {
			group: 'neutral',
			presets: ['trk_tc_adjust', 'trk_tc_adjust_plus', 'trk_tc_adjust_minus', 'trk_tc_adjust_reset'],
			object: `track:"${sel.track}"`,
			property: 'object.tc_adjust',
			kind: 'number',
			mutate: (v) => v + 0.5,
		},
		layer && {
			group: 'neutral',
			presets: ['trk_layer_enabled', 'lay_enable_on', 'lay_enable_off', 'lay_enable_toggle'],
			object: layer,
			property: 'object.enabled',
			kind: 'boolean',
			mutate: (v) => !v,
		},
		layer && {
			group: 'neutral',
			presets: ['trk_layer_tstart', 'lay_tstart_plus', 'lay_tstart_minus'],
			object: layer,
			property: 'object.tStart',
			kind: 'number',
			mutate: (v) => v + 1,
		},
		layer && {
			group: 'neutral',
			presets: ['trk_layer_tlength', 'lay_tlength_plus', 'lay_tlength_minus'],
			object: layer,
			property: 'object.tLength',
			kind: 'number',
			mutate: (v) => v + 1,
		},
		layer && {
			group: 'neutral',
			presets: ['trk_key_brightness', 'lay_bright_plus', 'lay_bright_minus', 'lay_bright_full', 'lay_bright_zero'],
			object: layer,
			property: 'object.findSequence("brightness").sequence.key(0).v',
			kind: 'number',
			mutate: (v) => nudge01(v, 0.1),
		},
		layer && {
			group: 'neutral',
			presets: ['trk_key_posx', 'lay_posx_plus', 'lay_posx_minus', 'lay_posx_zero', 'trk_key_posx_idx'],
			object: layer,
			property: 'object.findSequence("pos.x").sequence.key(0).v',
			kind: 'number',
			mutate: (v) => v + 0.01,
		},
		layer && {
			group: 'neutral',
			presets: ['trk_key_posy', 'lay_posy_plus', 'lay_posy_minus', 'lay_posy_zero'],
			object: layer,
			property: 'object.findSequence("pos.y").sequence.key(0).v',
			kind: 'number',
			mutate: (v) => v + 0.01,
		},
		layer && {
			group: 'neutral',
			presets: ['trk_key_scale', 'lay_scale_plus', 'lay_scale_minus', 'lay_scale_one'],
			object: layer,
			property: 'object.findSequence("scale.x").sequence.key(0).v',
			kind: 'number',
			mutate: (v) => v + 0.01,
		},
		layer && {
			group: 'neutral',
			presets: ['trk_brightness_const', 'lay_bright_const_on', 'lay_bright_const_off'],
			object: layer,
			property: 'object.findSequence("brightness").disableSequencing',
			kind: 'boolean',
			mutate: (v) => !v,
		},
		// ---- output: visible between write and restore ----
		{
			group: 'output',
			presets: ['tr_brightness', 'tr_brightness_up', 'tr_brightness_down', 'tr_brightness_full', 'tr_brightness_zero'],
			object: 'transportManager:default',
			property: 'object.brightness',
			kind: 'number',
			mutate: (v) => nudge01(v, 0.05),
		},
		{
			group: 'output',
			presets: ['tr_volume', 'tr_volume_up', 'tr_volume_down', 'tr_volume_full', 'tr_volume_mute'],
			object: 'transportManager:default',
			property: 'object.volume',
			kind: 'number',
			mutate: (v) => nudge01(v, 0.05),
		},
		{
			group: 'output',
			presets: ['tr_engaged', 'tr_engage', 'tr_disengage', 'tr_engaged_toggle'],
			object: 'transportManager:default',
			property: 'object.engaged',
			kind: 'boolean',
			mutate: (v) => !v,
		},
		screen && {
			group: 'output',
			presets: ['stg_screen_offset', 'stg_screen_offset_reset'],
			object: screen,
			property: 'object.offset',
			kind: 'json',
			// partial set: the Director merges the object into the vector
			mutate: (v) => ({ x: v.x + 0.01 }),
			expect: (v) => ({ x: v.x + 0.01, y: v.y, z: v.z }),
			restore: (v) => ({ x: v.x, y: v.y, z: v.z }),
		},
		screen && {
			group: 'output',
			presets: ['stg_screen_rotation'],
			object: screen,
			property: 'object.rotation',
			kind: 'json',
			mutate: (v) => ({ x: v.x + 0.5 }),
			expect: (v) => ({ x: v.x + 0.5, y: v.y, z: v.z }),
			restore: (v) => ({ x: v.x, y: v.y, z: v.z }),
		},
		screen && {
			group: 'output',
			presets: [
				'stg_screen_fade',
				'stg_screen_fade_up',
				'stg_screen_fade_down',
				'stg_screen_fade_full',
				'stg_screen_fade_zero',
			],
			object: screen,
			property: 'object.master_fade',
			kind: 'number',
			mutate: (v) => nudge01(v, 0.1),
		},
		screen && {
			group: 'output',
			presets: ['stg_screen_hold', 'stg_screen_hold_on', 'stg_screen_hold_off', 'stg_screen_hold_toggle'],
			object: screen,
			property: 'object.holdOutput',
			kind: 'boolean',
			mutate: (v) => !v,
		},
		screen && {
			group: 'output',
			presets: ['stg_screen_render_layer', 'stg_screen_on_stage', 'stg_screen_off_stage'],
			object: screen,
			property: 'object.renderLayer',
			// int enum (0 off stage, 1 on stage, ...): the presets write plain integers
			kind: 'number',
			mutate: (v) => (v === 1 ? 0 : 1),
		},
		projector && {
			group: 'output',
			presets: ['stg_proj_fade', 'stg_proj_fade_up', 'stg_proj_fade_down', 'stg_proj_fade_full', 'stg_proj_fade_zero'],
			object: projector,
			property: 'object.master_fade',
			kind: 'number',
			mutate: (v) => nudge01(v, 0.1),
		},
		projector && {
			group: 'output',
			presets: ['stg_proj_hold', 'stg_proj_hold_on', 'stg_proj_hold_off', 'stg_proj_hold_toggle'],
			object: projector,
			property: 'object.holdOutput',
			kind: 'boolean',
			mutate: (v) => !v,
		},
		byUid && {
			group: 'output',
			presets: ['stg_uid_fade', 'stg_uid_fade_up', 'stg_uid_fade_down', 'stg_uid_fade_full', 'stg_uid_fade_zero'],
			object: byUid,
			property: 'object.master_fade',
			kind: 'number',
			mutate: (v) => nudge01(v, 0.1),
		},
		byUid && {
			group: 'output',
			presets: ['stg_uid_hold', 'stg_uid_hold_on', 'stg_uid_hold_off', 'stg_uid_hold_toggle'],
			object: byUid,
			property: 'object.holdOutput',
			kind: 'boolean',
			mutate: (v) => !v,
		},
		byUid && {
			group: 'output',
			presets: ['stg_uid_render_layer', 'stg_uid_on_stage', 'stg_uid_off_stage'],
			object: byUid,
			property: 'object.renderLayer',
			kind: 'number',
			mutate: (v) => (v === 1 ? 0 : 1),
		},
		ev && {
			group: 'output',
			presets: ['ev_uid_float', 'ev_uid_float_up', 'ev_uid_float_down'],
			object: ev,
			property: 'object.container.variables[0].defaultFloat',
			kind: 'number',
			mutate: (v) => v + 1,
		},
	]
	const only = args.only ? String(args.only) : null
	return list
		.filter(Boolean)
		.filter((t) => group === 'all' || t.group === group)
		.filter((t) => !only || t.property.includes(only) || t.presets.some((p) => p.includes(only)))
}

// ---------- run ----------
async function main() {
	const client = new Client(`ws://${host}:${port}/api/session/liveupdate`)
	state.client = client
	console.log(`connecting to ${client.url}${write ? ` (group ${group}, WRITING)` : ' (dry run, nothing is written)'}`)
	client.onUnexpectedClose = (reason) => void emergencyRestore(reason)
	await client.connect()
	const { sel, currentTrack, playing, tracks, notes } = await discover(client)
	for (const n of notes) console.log('note:', n)
	console.log('targets:', sel)
	const trackText = typeof currentTrack === 'string' ? `"${currentTrack}"` : 'unknown'
	console.log(`transport: track ${trackText}, playing=${JSON.stringify(playing) ?? 'unknown'}`)
	state.meta = {
		host,
		port,
		group,
		mode: write ? 'write' : 'dry-run',
		selections: sel,
		currentTrack,
		playing,
		tracks,
		notes,
	}

	const list = targets(sel)
	const refusal = writeRefusal({
		neutral: list.some((t) => t.group === 'neutral'),
		output: list.some((t) => t.group === 'output'),
		track: sel.track,
		currentTrack,
		playing,
		force,
	})
	if (refusal) {
		if (write) {
			console.error(`refusing to write: ${refusal}`)
			saveResults({ refused: refusal })
			console.error(`results written to ${outFile}`)
			for (const line of siteDataReminder(root, outFile)) console.error(line)
			client.close()
			process.exitCode = 2
			return
		}
		console.log(`note: with --yes the script would stop here - ${refusal}`)
	}

	for (const t of list) {
		const entry = { presets: t.presets, group: t.group, object: t.object, property: t.property, kind: t.kind }
		state.results.push(entry)
		const label = `${t.object} / ${t.property}`
		if (state.aborted) {
			entry.result = 'not-run (aborted after a failed restore)'
			continue
		}
		const sub = await client.subscribe(t.object, t.property)
		if (sub.error || sub.value === undefined) {
			entry.result = 'skipped: could not read the current value'
			entry.error = sub.error
			if (sub.id !== undefined) await client.unsubscribe(sub.id)
			console.log(`skip     ${label}: ${sub.error}`)
			saveResults()
			continue
		}
		const v0 = sub.value
		entry.before = v0
		const typeOk =
			(t.kind === 'number' && finite(v0)) ||
			(t.kind === 'boolean' && typeof v0 === 'boolean') ||
			(t.kind === 'json' && v0 && typeof v0 === 'object' && ['x', 'y', 'z'].every((k) => finite(v0[k])))
		if (!typeOk) {
			entry.result = `skipped: current value ${short(v0)} is not a usable ${t.kind}`
			await client.unsubscribe(sub.id)
			console.log(`skip     ${label}: ${entry.result}`)
			saveResults()
			continue
		}
		const v1 = t.mutate(v0)
		const expect1 = t.expect ? t.expect(v0) : v1
		const restoreValue = t.restore ? t.restore(v0) : v0
		const match1 =
			t.kind === 'number' ? numberMatch(expect1) : t.kind === 'boolean' ? boolMatch(expect1) : objectMatch(expect1)
		const match0 = t.kind === 'number' ? numberMatch(v0) : t.kind === 'boolean' ? boolMatch(v0) : objectMatch(v0)
		entry.write = v1
		entry.restoreValue = restoreValue
		if (t.kind === 'number' && !finite(v1)) {
			entry.result = 'skipped: the mutation is not a finite number'
			await client.unsubscribe(sub.id)
			console.log(`skip     ${label}: ${entry.result}`)
			saveResults()
			continue
		}
		if (!write) {
			entry.result = 'planned'
			await client.unsubscribe(sub.id)
			console.log(`plan     ${label}: ${short(v0)} -> ${short(v1)} -> ${short(restoreValue)}`)
			saveResults()
			continue
		}

		// from here a value is changed on the Director; the interrupt handler knows how to put it back
		console.log(`write    ${label}: ${short(v0)} -> ${short(v1)} (restore ${short(restoreValue)})`)
		state.inFlight = { id: sub.id, label, original: restoreValue, match: match0, originalRead: v0 }
		saveResults()
		const w = await client.setAndWait(sub.id, v1, match1)
		entry.afterWrite = w.value
		if (w.errors?.length) entry.writeErrors = w.errors
		const r = await client.setAndWait(sub.id, restoreValue, match0)
		entry.afterRestore = r.value
		if (r.errors?.length) entry.restoreErrors = r.errors
		if (r.ok) state.inFlight = null
		await client.unsubscribe(sub.id)
		if (!r.ok) {
			entry.result = 'RESTORE FAILED'
			state.aborted = true
			console.log(
				`FAILED   ${label}: wrote ${short(v1)}, the Director reports ${short(r.value)}, original ${short(v0)} - stopping`,
			)
			saveResults()
			continue
		}
		entry.result = w.ok ? 'write-accepted-and-restored' : 'write-not-reflected-restored'
		console.log(`${w.ok ? 'ok      ' : 'noeffect'} ${label}: ${short(v0)} -> ${short(w.value)} -> ${short(r.value)}`)
		saveResults()
	}

	// final read-back of every touched value
	if (write) {
		for (const e of state.results) {
			if (e.before === undefined || String(e.result).startsWith('skipped') || String(e.result).startsWith('not-run'))
				continue
			const check = await client.subscribe(e.object, e.property)
			const same =
				e.kind === 'number'
					? near(check.value, e.before)
					: e.kind === 'boolean'
						? check.value === e.before
						: objectMatch(e.before)(check.value)
			// a value that could not be read is not confirmed: it is UNVERIFIED, never silently good
			e.finalCheck = same ? 'original value confirmed' : (unverifiedLabel(check) ?? `DIFFERS: ${short(check.value)}`)
			if (!same && check.id !== undefined) {
				console.log(
					`final    ${e.object} / ${e.property}: ${short(check.value)} differs from ${short(e.before)} - re-sending the original`,
				)
				const again = await client.setAndWait(
					check.id,
					e.restoreValue ?? e.before,
					e.kind === 'number'
						? numberMatch(e.before)
						: e.kind === 'boolean'
							? boolMatch(e.before)
							: objectMatch(e.before),
				)
				e.finalCheck = again.ok
					? 'original value restored on the second attempt'
					: `STILL DIFFERS: ${short(again.value)}`
			}
			if (check.id !== undefined) await client.unsubscribe(check.id)
			saveResults()
		}
	}

	saveResults()
	const summary = {}
	for (const e of state.results) summary[e.result] = (summary[e.result] || 0) + 1
	console.log('summary', summary)
	const { notRestored, unconfirmed, byHand } = unsettled(state.results)
	if (notRestored.length) {
		console.error(`VERDICT: ${notRestored.length} value(s) could NOT be restored during the run:`)
		for (const e of notRestored)
			console.error(`  ${e.object} / ${e.property}: final read-back ${e.finalCheck ?? 'not run'}`)
	}
	if (unconfirmed.length) {
		console.error(`VERDICT: ${unconfirmed.length} value(s) could not be confirmed by the final read-back:`)
		for (const e of unconfirmed) console.error(`  ${e.object} / ${e.property}: ${e.finalCheck}`)
	}
	for (const e of byHand)
		console.error(
			`!! SET THIS BACK BY HAND: ${e.object} / ${e.property} = ${JSON.stringify(e.restoreValue ?? e.before)}`,
		)
	if (notRestored.length || unconfirmed.length) process.exitCode = 1
	else if (write) console.log('VERDICT: every written value was restored and confirmed by a final read-back')
	console.log('wrote', outFile)
	for (const line of siteDataReminder(root, outFile)) console.log(line)
	client.close()
}

main().catch((e) => void emergencyRestore(`error: ${String(e)}`))
