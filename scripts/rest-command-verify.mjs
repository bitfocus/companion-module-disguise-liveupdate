// Live verification of the Session REST commands against a Designer Director.
//
// For every command the module can send, this script reads the current state, sends the command,
// reads the state back and then restores what it changed. The value, time, timecode, return-to-start
// and play / stop steps fail when the read-back does not show the command's effect; the section, note
// and track jumps and synclayers record what the Director showed and pass once the command was
// accepted. The transport state comes from GET /api/session/transport/activetransport; the playhead,
// which that endpoint does not report, is read over the LiveUpdate WebSocket.
//
// Usage:
//   node scripts/rest-command-verify.mjs --host 192.0.2.10 [--port 80]
//        [--group transport|renderstream|all] [--yes] [--force]
//        [--out <file, default .live/rest-verification.json>] [--designer <version, default r34.0.3>]
//
// The results record the host as 192.0.2.10 and the Designer version given with --designer.
//
// Without --yes nothing is sent: the script reads the state, prints the plan and exits. With --yes
// it sends the commands of the selected group. The default group only touches the transport: a value
// step puts its value back itself, the playhead goes home after the last jump; --group renderstream
// additionally syncs the RenderStream layers. Any other --group is a usage error (exit 2).
//
// The steps stop and rewind the transport, so --yes is refused while the transport is not stopped
// (or its playmode cannot be read) unless --force is given. With --force the final sweep puts the
// playhead back where it was and then resumes the original playmode from there. The sweep compares
// the state with the start; anything it could not put back is printed as "SET THIS BACK BY HAND" and
// the run exits 1. A value the Director refused to change (speed, while transport speed control is off
// in Designer) was never changed, so it has nothing to put back.
//
// An interrupt (Ctrl+C, SIGTERM) or a crash stops the steps and ends the run the same way: the
// restores still queued, the sweep, the comparison, the resume and the results file; the run exits 1.
// A second interrupt leaves at once and prints every field the sweep had not confirmed yet.
//
// Failover commands are never sent by this script. Failing a machine over is not restorable by a
// second command in the way the transport steps are, so it stays a human decision.

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const require = createRequire(import.meta.url)
const {
	RESUME,
	dropRefusedProbe,
	groupProblem,
	handRestoreLine,
	interruptAction,
	liveOutFile,
	playmodeRefusal,
	restoreError,
	restoreMismatches,
	siteDataReminder,
	statusReason,
	stepStatus,
	unsweptFields,
} = require('./live-safety.cjs')

const USAGE =
	'usage: node scripts/rest-command-verify.mjs --host <director> [--group transport|renderstream|all] [--yes] [--force]'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const host = args.host
if (!host) {
	console.error(USAGE)
	process.exit(2)
}
const port = Number(args.port ?? 80)
const group = String(args.group ?? 'transport')
const groupError = groupProblem(group, ['transport', 'renderstream', 'all'])
if (groupError) {
	console.error(groupError)
	console.error(USAGE)
	process.exit(2)
}
const commit = Boolean(args.yes)
const force = args.force === true
const outFile = liveOutFile(root, args.out, 'rest-verification.json')
const base = `http://${host}:${port}/api/session`

const results = []
/** Commands that must run before the script may exit, newest first. */
const restores = []
/** Fields whose probe the Director refused: nothing changed them, so nothing needs putting back */
const unchanged = []
let live = null
/** The state at the start, which the final sweep restores and compares with */
let origin = null
/** Set once the first command is about to go out */
let sending = false
/** Set when main's own restore sweep starts; an interrupt then lets it finish */
let settling = false
/** Set by an interrupt: the steps send nothing more, and the interrupt ends the run */
let halted = false

process.on('SIGINT', () => void bail('SIGINT'))
process.on('SIGTERM', () => void bail('SIGTERM'))
process.on('uncaughtException', (error) => void bail(`uncaught ${String(error?.message ?? error)}`))
process.on('unhandledRejection', (error) => void bail(`rejected ${String(error?.message ?? error)}`))

await main()

async function main() {
	const before = await transport()
	if (!before) {
		console.error(`no active transport on ${host} - is a project loaded?`)
		process.exit(1)
	}
	console.log(`Director  ${host}:${port}`)
	console.log(`transport playmode=${before.playmode} brightness=${before.brightness} volume=${before.volume}`)
	console.log(`          speed=${before.speed} engaged=${before.engaged} sections=?`)

	live = await openLiveUpdate()
	origin = {
		uid: before.uid,
		name: before.name,
		playmode: before.playmode,
		time: live.value('time'),
		timecode: live.value('timecode'),
		beat: live.value('beat'),
		section: live.value('section'),
		track: before.currentTrack,
		brightness: before.brightness,
		volume: before.volume,
		speed: before.speed,
		engaged: before.engaged,
	}
	console.log(`playhead  beat=${origin.beat} time=${origin.time}s timecode=${origin.timecode}`)

	const refusal = playmodeRefusal(origin.playmode, force)
	if (!commit) {
		console.log(`\ndry run - pass --yes to send the commands of --group ${group}. The groups:`)
		console.log('  transport    values, playhead moves, play/stop (sent by every group; put back as it goes)')
		console.log('  renderstream synclayers on the layers the Director reports (--group renderstream or all)')
		console.log('  failover     never sent by this script')
		if (refusal) console.log(`note: --yes would be refused now: ${refusal}`)
		await live.close()
		process.exit(0)
	}
	// checked before anything is sent: even a filtered (--only) run moves the playhead home at the end
	if (refusal) {
		console.error(`refusing to send commands: ${refusal}`)
		await live.close()
		process.exit(2)
	}
	if (origin.time === undefined) {
		console.error('the playhead could not be read over LiveUpdate; refusing to move it blind')
		await live.close()
		process.exit(1)
	}

	sending = true
	try {
		await verifyValues(origin)
		await verifyPlayhead(origin)
		await verifyPlayStop(origin)
		if (group === 'renderstream' || group === 'all') await verifyRenderStream()
	} catch (error) {
		// a restore outside a step (the playhead home) failed, or a read broke: still sweep and report
		console.error(`\nthe run stopped early: ${String(error?.message ?? error)}`)
		results.push({
			id: 'run',
			summary: 'the run stopped early',
			status: 'failed',
			detail: String(error?.message ?? error),
		})
	} finally {
		// once an interrupt has halted the steps, it ends the run itself (see bail)
		if (!halted) {
			settling = true
			await runRestores()
			const unrestored = await settleBack(origin)
			await live.close()
			report(unrestored)
		}
	}
}

// --- the steps -------------------------------------------------------------------------------

/** brightness, volume, speed and engaged: set, read back, put back. */
async function verifyValues(origin) {
	for (const [field, probe] of [
		['brightness', 0.9],
		['volume', 0.9],
		// speed is refused unless enableTransportSpeedControl is on in Designer; the step reports
		// the Director's own message rather than pretending the command does not exist.
		['speed', 0.9],
	]) {
		await step(`transport/${field}`, `set ${field} to ${probe}`, async () => {
			const restore = pushRestore(`/transport/${field}`, withTransport(origin, { [field]: origin[field] }))
			await sendProbe(field, restore, `/transport/${field}`, withTransport(origin, { [field]: probe }))
			const seen = await readBack(
				(t) => t?.[field],
				(v) => close(v, probe),
			)
			assertClose(seen, probe, `${field} read back as ${seen}`)
			await popRestore(restore)
			const back = await readBack(
				(t) => t?.[field],
				(v) => close(v, origin[field]),
			)
			assertClose(back, origin[field], `${field} restored to ${back}`)
			return `${origin[field]} -> ${probe} -> ${back}`
		})
	}

	await step('transport/engaged', 'disengage and re-engage the transport', async () => {
		const target = !origin.engaged
		const restore = pushRestore('/transport/engaged', withTransport(origin, { engaged: origin.engaged }))
		await sendProbe('engaged', restore, '/transport/engaged', withTransport(origin, { engaged: target }))
		const seen = await readBack(
			(t) => t?.engaged,
			(v) => v === target,
		)
		if (seen !== target) throw new Error(`engaged read back as ${seen}, wanted ${target}`)
		await popRestore(restore)
		const back = await readBack(
			(t) => t?.engaged,
			(v) => v === origin.engaged,
		)
		if (back !== origin.engaged) throw new Error(`engaged did not restore (${back})`)
		return `${origin.engaged} -> ${target} -> ${back}`
	})
}

/** The commands that move the playhead without starting playback. */
async function verifyPlayhead(origin) {
	const home = pushRestore('/transport/gototime', withTransport(origin, { time: origin.time, playmode: 'Stop' }))

	await step('transport/gototime', 'jump 10 seconds forward', async () => {
		const target = origin.time + 10
		await send('/transport/gototime', withTransport(origin, { time: target, playmode: 'Stop' }))
		const seen = await settledTime((v) => close(v, target, 0.25))
		assertClose(seen, target, `playhead is at ${seen}s, wanted ${target}s`, 0.25)
		return `${origin.time}s -> ${seen}s`
	})

	await step('transport/gototimecode', `jump back to timecode ${origin.timecode}`, async () => {
		if (!origin.timecode) return skip('the project reports no timecode for the playhead')
		await send(
			'/transport/gototimecode',
			withTransport(origin, { timecode: origin.timecode, ignoreTags: true, playmode: 'Stop' }),
		)
		const seen = await settledTime((v) => close(v, origin.time, 0.25))
		assertClose(seen, origin.time, `playhead is at ${seen}s, wanted ${origin.time}s`, 0.25)
		return `-> ${seen}s`
	})

	await step('transport/returntostart', 'return to the start of the track', async () => {
		await send('/transport/returntostart', transports(origin))
		const seen = await settledTime((v) => close(v, 0, 0.25))
		assertClose(seen, 0, `playhead is at ${seen}s, wanted 0s`, 0.25)
		return `-> ${seen}s`
	})

	await step('transport/gotonextsection', 'step to the next section', async () => {
		const from = live.value('beat')
		await send('/transport/gotonextsection', withTransport(origin, { playmode: 'Stop' }))
		const seen = await settledBeat()
		return `beat ${from} -> ${seen}` + (seen === from ? ' (single-section track, no move)' : '')
	})

	await step('transport/gotoprevsection', 'step to the previous section', async () => {
		const from = live.value('beat')
		await send('/transport/gotoprevsection', withTransport(origin, { playmode: 'Stop' }))
		const seen = await settledBeat()
		return `beat ${from} -> ${seen}`
	})

	// The published body says section:string, but the Director parses the field as a uint64: a
	// section name is rejected with "Invalid value for field 'section' of type uint64".
	await step('transport/gotosection', 'jump to section 1 by number', async () => {
		await send('/transport/gotosection', withTransport(origin, { section: 1, playmode: 'Stop' }))
		const seen = await settledBeat()
		return `section 1 -> beat ${seen}`
	})

	await step('transport/gotosection (name)', 'reject a section name', async () => {
		const section = live.value('section')
		if (!section) return skip('the track has no named section at the playhead')
		try {
			await send('/transport/gotosection', withTransport(origin, { section, playmode: 'Stop' }))
		} catch (error) {
			if (/uint64/.test(String(error?.message ?? error))) return 'rejected as uint64, as expected'
			throw error
		}
		throw new Error('a section name was accepted; the uint64 note in the module is wrong')
	})

	await step('transport/gotonote', 'jump to a section by its name', async () => {
		const note = live.value('section')
		if (!note) return skip('the track has no named section at the playhead')
		await send('/transport/gotonote', withTransport(origin, { note, playmode: 'Stop' }))
		const seen = await settledBeat()
		return `note (name withheld) -> beat ${seen}`
	})

	await step('transport/gototrack', 'select the track that is already current', async () => {
		await send('/transport/gototrack', withTransport(origin, { track: origin.track, playmode: 'Stop' }))
		const seen = (await transport())?.currentTrack
		// the results file must not carry a track uid of the site
		if (seen?.uid !== origin.track.uid) throw new Error('the current track changed (uid withheld)')
		return 'track unchanged'
	})

	for (const [path, label] of [
		['/transport/gotonexttrack', 'next track'],
		['/transport/gotoprevtrack', 'previous track'],
	]) {
		await step(path.slice(1), `step to the ${label}`, async () => {
			const from = (await transport())?.currentTrack
			// queued before the jump like every other change, so an interrupt in between still restores it;
			// it stays queued until the end of the run
			pushRestore('/transport/gototrack', withTransport(origin, { track: origin.track, playmode: 'Stop' }))
			await send(path, withTransport(origin, { playmode: 'Stop' }))
			const seen = (await transport())?.currentTrack
			return seen?.uid === from?.uid ? 'accepted, single-track setlist so the track did not change' : 'track changed'
		})
	}

	await popRestore(home)
}

/** play, playsection, playloopsection - each started, observed and stopped again. */
async function verifyPlayStop(origin) {
	await step('transport/stop', 'stop a transport that is already stopped', async () => {
		await send('/transport/stop', transports(origin))
		const seen = (await transport())?.playmode
		if (seen !== 'Stop') throw new Error(`playmode is ${seen}`)
		return 'playmode Stop'
	})

	for (const [path, wanted] of [
		['/transport/play', ['Play']],
		['/transport/playsection', ['PlaySection', 'Play']],
		['/transport/playloopsection', ['Loop', 'PlaySection', 'Play']],
	]) {
		await step(path.slice(1), `start with ${path.split('/').pop()} and stop again`, async () => {
			const home = pushRestore('/transport/gototime', withTransport(origin, { time: origin.time, playmode: 'Stop' }))
			const stop = pushRestore('/transport/stop', transports(origin))
			await send(path, transports(origin))
			const playing = await readBack(
				(t) => t?.playmode,
				(v) => wanted.includes(v),
			)
			await wait(400)
			await popRestore(stop)
			const stopped = await readBack(
				(t) => t?.playmode,
				(v) => v === 'Stop',
			)
			await popRestore(home)
			if (!wanted.includes(playing)) throw new Error(`playmode was ${playing}, wanted one of ${wanted.join('/')}`)
			if (stopped !== 'Stop') throw new Error(`playmode stayed ${stopped} after stop`)
			return `${playing} -> Stop`
		})
	}
}

/** synclayers is the one RenderStream command that does not start or stop a workload. */
async function verifyRenderStream() {
	const layers = (await get('/renderstream/layers'))?.result ?? []
	await step('renderstream/synclayers', 'sync the RenderStream layers', async () => {
		if (layers.length === 0) return skip('the project has no RenderStream layers')
		await send('/renderstream/synclayers', { layers: layers.map((l) => ({ uid: l.uid, name: l.name })) })
		return `accepted for ${layers.length} layer(s)`
	})
	results.push({
		id: 'renderstream/startlayers, stoplayers, restartlayers',
		summary: 'start / stop / restart a RenderStream workload',
		status: 'not-exercised',
		detail: 'starts or stops render processes on the workload machines; not restorable by a second command',
	})
	results.push({
		id: 'renderstream/failover, failoverpool, failover/*',
		summary: 'machine and pool failover',
		status: 'not-exercised',
		detail: 'reroutes video to an understudy machine; deliberately left to a human operator',
	})
}

// --- plumbing --------------------------------------------------------------------------------

function transports(origin) {
	return { transports: [{ uid: origin.uid, name: origin.name }] }
}

function withTransport(origin, extra) {
	return { transports: [{ transport: { uid: origin.uid, name: origin.name }, ...extra }] }
}

async function step(id, summary, run) {
	if (halted || (args.only && !id.includes(String(args.only)))) return
	process.stdout.write(`  ${id.padEnd(30)} ${summary} ... `)
	try {
		const detail = await run()
		if (detail && detail.skipped) {
			console.log(`skipped (${detail.reason})`)
			results.push({ id, summary, status: 'skipped', detail: detail.reason })
			return
		}
		console.log(`ok (${detail})`)
		results.push({ id, summary, status: 'ok', detail })
	} catch (error) {
		const message = String(error?.message ?? error)
		// "refused (1000)" is the Director declining a command for a reason it names: a Designer
		// option that is off, a tag that does not exist. The command reached it and was understood.
		// A refused restore is a failure: the state stays changed (see stepStatus).
		const status = stepStatus(error)
		console.log(
			status === 'refused' ? `refused (${message.replace(/^.*refused \(\d+\): /, '')})` : `FAILED (${message})`,
		)
		results.push({ id, summary, status, detail: message })
	}
}

function skip(reason) {
	return { skipped: true, reason }
}

function close(seen, wanted, tolerance = 1e-3) {
	return typeof seen === 'number' && Number.isFinite(seen) && Math.abs(seen - wanted) <= tolerance
}

function assertClose(seen, wanted, message, tolerance = 1e-3) {
	if (typeof seen !== 'number' || !Number.isFinite(seen)) throw new Error(message)
	if (Math.abs(seen - wanted) > tolerance) throw new Error(message)
}

function pushRestore(path, body) {
	const entry = { path, body }
	restores.push(entry)
	return entry
}

/** A step's command: once an interrupt has halted the run, nothing more goes out. Restores use post(). */
async function send(path, body) {
	if (halted) throw new Error(`${path} not sent: the run was interrupted`)
	return await post(path, body)
}

/**
 * A value step's probe. When the Director refuses it, the value never changed: the restore comes off
 * the queue unsent and the field needs no hand afterwards (speed, while transport speed control is off).
 */
async function sendProbe(field, restore, path, body) {
	try {
		await send(path, body)
	} catch (error) {
		if (dropRefusedProbe(restores, restore, error)) unchanged.push(field)
		throw error
	}
}

async function popRestore(entry) {
	// after an interrupt the entry stays for bail's sweep: a late restore from a step could stop a
	// transport the sweep has just resumed
	if (halted) return
	const at = restores.lastIndexOf(entry)
	if (at >= 0) restores.splice(at, 1)
	try {
		await post(entry.path, entry.body)
	} catch (error) {
		// keep it for runRestores to try once more, and fail the step whatever the Director said
		restores.push(entry)
		throw restoreError(entry.path, error)
	}
}

/** Send every pending restore, newest first; returns the paths that failed. */
async function runRestores() {
	const failed = []
	while (restores.length > 0) {
		const entry = restores.pop()
		try {
			await post(entry.path, entry.body)
		} catch (error) {
			failed.push(entry.path)
			console.error(`  restore ${entry.path} FAILED: ${String(error?.message ?? error)}`)
		}
	}
	return failed
}

/**
 * Put the transport back where it started, whatever the steps did, then compare the state with the
 * start. Returns what is still different ([{field, wanted, seen}]); an empty list is a clean restore.
 */
async function settleBack(origin) {
	const sweep = [
		['/transport/stop', transports(origin)],
		['/transport/gototrack', withTransport(origin, { track: origin.track, playmode: 'Stop' })],
		['/transport/gototime', withTransport(origin, { time: origin.time, playmode: 'Stop' })],
		['/transport/brightness', withTransport(origin, { brightness: origin.brightness })],
		['/transport/volume', withTransport(origin, { volume: origin.volume })],
		['/transport/speed', withTransport(origin, { speed: origin.speed })],
		['/transport/engaged', withTransport(origin, { engaged: origin.engaged })],
	]
	// One field the Director refuses - speed, when transport speed control is off in Designer - must
	// not stop the rest of the sweep, so every entry is put back on its own. Whether it worked is
	// decided by the comparison below, not by the answers.
	for (const [path, body] of sweep) {
		try {
			await post(path, body)
		} catch (error) {
			console.error(`  sweep ${path}: ${String(error?.message ?? error)}`)
		}
	}
	const after = await transport().catch(() => undefined)
	const time = await settledTime((v) => close(v, origin.time, 0.25))
	const unrestored = restoreMismatches(origin, after, time)

	// A transport that was playing (a --force run) resumes its playmode from the start position; the
	// show does not jump to where it would be now.
	let playmode = after?.playmode
	if (origin.playmode !== 'Stop' && unrestored.length === 0) {
		const resume = RESUME[origin.playmode]
		try {
			if (!resume) throw new Error(`no command resumes playmode ${origin.playmode}`)
			await post(resume, transports(origin))
			playmode = await readBack(
				(t) => t?.playmode,
				(v) => v === origin.playmode,
			)
		} catch (error) {
			console.error(`  resume ${origin.playmode}: ${String(error?.message ?? error)}`)
		}
	}
	if (playmode !== origin.playmode) unrestored.push({ field: 'playmode', wanted: origin.playmode, seen: playmode })

	console.log(
		`\nrestored  playmode=${playmode} brightness=${after?.brightness} volume=${after?.volume} ` +
			`speed=${after?.speed} engaged=${after?.engaged} time=${time}s (was ${origin.time}s)`,
	)
	return unrestored
}

/**
 * An interrupt or a crash. Once a command has gone out it ends the run the way main does: the steps
 * send nothing more, the queued restores and the sweep run, the state is compared with the start (a
 * --force run resumes its playmode) and the results are written; the run exits 1. An interrupt while
 * main's own sweep runs lets that sweep finish, and its report records the interrupt and exits 1 too.
 * What is still different is decided by that comparison, not by the answers to the restores.
 */
async function bail(reason) {
	const action = interruptAction({ sending, settling, halted })
	halted = true
	if (action === 'exit') {
		console.error(`\n${reason} - nothing was sent`)
		await live?.close()
		process.exit(1)
	}
	if (action === 'force') {
		console.error(`\n${reason} - leaving before the restore sweep has confirmed the state`)
		console.error(`\n!! ${handRestoreLine(unsweptFields(origin, unchanged))}\n`)
		process.exit(1)
	}
	// whichever sweep ends the run, its report counts this entry and exits 1
	results.push({ id: 'run', summary: 'the run was interrupted', status: 'failed', detail: reason })
	if (action === 'wait') {
		// main's own sweep has started: it finishes, then its report() writes the file and exits
		console.error(`\n${reason} - the restore sweep is running and reports when it is done (again to leave now)`)
		// should a crash keep report() from running, the run still does not exit 0
		process.exitCode = 1
		return
	}
	console.error(`\n${reason} - restoring before exit (again to leave now)`)
	await runRestores()
	const unrestored = await settleBack(origin)
	await live.close()
	report(unrestored)
}

async function get(path) {
	const response = await fetch(base + path)
	if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`)
	return await response.json()
}

async function post(path, body) {
	const response = await fetch(base + path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	const text = await response.text()
	if (!response.ok) throw new Error(`POST ${path} -> ${response.status} ${text.slice(0, 160)}`)
	const answer = text ? JSON.parse(text) : {}
	const code = answer?.status?.code
	if (code !== undefined && code !== 0) throw new Error(`${path} refused (${code}): ${statusReason(answer.status)}`)
	return answer
}

/** Poll the transport state until `accept` is happy or the Director has had 2 seconds. */
async function readBack(pick, accept) {
	let seen
	for (let i = 0; i < 20; i++) {
		seen = pick(await transport())
		if (accept(seen)) return seen
		await wait(100)
	}
	return seen
}

async function transport() {
	const body = await get('/transport/activetransport')
	return (body.transports ?? body.result ?? [])[0]
}

/**
 * The playhead does not move in the same millisecond the command is acknowledged, so "the value
 * stopped changing" is not on its own a sign that the jump has landed - it is also true before it
 * starts. Where the destination is known, wait for it; otherwise give the Director a moment first
 * and then wait for the value to settle.
 */
async function settledTime(accept) {
	return await settled(() => live.value('time'), accept)
}

async function settledBeat(accept) {
	return await settled(() => live.value('beat'), accept)
}

async function settled(read, accept) {
	if (accept) {
		let seen
		for (let i = 0; i < 24; i++) {
			seen = read()
			if (accept(seen)) return seen
			await wait(100)
		}
		return seen
	}
	await wait(500)
	let previous = read()
	for (let i = 0; i < 12; i++) {
		await wait(120)
		const now = read()
		if (now === previous) return now
		previous = now
	}
	return previous
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The playhead is not part of the REST transport state, so read it from LiveUpdate: beats, seconds,
 * timecode and the section note under the playhead.
 */
async function openLiveUpdate() {
	const properties = {
		beat: 'object.player.tRender',
		time: 'object.track.beatToTime(object.player.tRender)',
		timecode: 'object.beatToTimecode(object.player.tRender).__str__()',
		section: 'object.track.noteAtBeat(object.track.sectionToBeat(object.track.beatToSection(object.player.tRender)))',
	}
	const socket = new WebSocket(`ws://${host}:${port}/api/session/liveupdate`)
	const byId = new Map()
	const values = new Map()
	await new Promise((ok, fail) => {
		socket.once('open', ok)
		socket.once('error', fail)
	})
	socket.on('message', (raw) => {
		let message
		try {
			message = JSON.parse(String(raw))
		} catch {
			return
		}
		for (const s of message.subscriptions ?? []) {
			const key = Object.entries(properties).find(([, path]) => path === s.propertyPath)?.[0]
			if (key) byId.set(String(s.id), key)
		}
		for (const change of message.valuesChanged ?? []) {
			const key = byId.get(String(change.id))
			if (key) values.set(key, change.value)
		}
	})
	socket.send(
		JSON.stringify({
			subscribe: {
				object: 'transportManager:default',
				properties: Object.values(properties),
				configuration: { updateFrequencyMs: 100 },
			},
		}),
	)
	for (let i = 0; i < 40 && values.size < Object.keys(properties).length; i++) await wait(100)
	return {
		value: (key) => values.get(key),
		close: async () => {
			socket.close()
			await wait(50)
		},
	}
}

function report(unrestored) {
	if (unrestored.length) {
		// the file names the fields only: the values can carry a track name of the site
		results.push({
			id: 'restore',
			summary: 'put the transport back where it started',
			status: 'failed',
			detail: `not restored: ${unrestored.map((u) => u.field).join(', ')}`,
		})
	}
	const counts = { ok: 0, refused: 0, failed: 0, skipped: 0, 'not-exercised': 0 }
	for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1
	console.log(
		`\n${counts.ok} ok, ${counts.refused} refused by the Director, ${counts.failed} failed, ` +
			`${counts.skipped} skipped, ${counts['not-exercised']} not exercised`,
	)
	if (unrestored.length) console.error(`\n!! ${handRestoreLine(unrestored)}\n`)
	mkdirSync(dirname(outFile), { recursive: true })
	writeFileSync(
		outFile,
		JSON.stringify(
			{ host: '192.0.2.10', designer: args.designer ?? 'r34.0.3', group, at: new Date().toISOString(), results },
			null,
			2,
		) + '\n',
	)
	console.log(`wrote ${outFile}`)
	for (const line of siteDataReminder(root, outFile)) console.log(line)
	process.exit(counts.failed > 0 ? 1 : 0)
}

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
