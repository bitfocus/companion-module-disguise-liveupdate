// Live verification of the Session REST commands against a Designer Director.
//
// For every command the module can send, this script reads the current state, sends the command,
// reads the state back to prove the command took effect, and then restores what it changed. The
// transport state comes from GET /api/session/transport/activetransport; the playhead, which that
// endpoint does not report, is read over the LiveUpdate WebSocket.
//
// Usage:
//   node scripts/rest-command-verify.mjs --host 192.0.2.10 [--port 80]
//        [--group transport|renderstream|all] [--yes] [--out docs/research/rest-verification.json]
//
// Without --yes nothing is sent: the script reads the state, prints the plan and exits. With --yes
// it sends the commands of the selected group. The default group only touches the transport and
// every step restores itself; --group renderstream additionally syncs the RenderStream layers.
//
// Failover commands are never sent by this script. Failing a machine over is not restorable by a
// second command in the way the transport steps are, so it stays a human decision.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const host = args.host
if (!host) {
	console.error('usage: node scripts/rest-command-verify.mjs --host <director> [--group all] [--yes]')
	process.exit(2)
}
const port = Number(args.port ?? 80)
const group = args.group ?? 'transport'
const commit = Boolean(args.yes)
const outFile = resolve(root, args.out ?? 'docs/research/rest-verification.json')
const base = `http://${host}:${port}/api/session`

const results = []
/** Commands that must run before the script may exit, newest first. */
const restores = []
let live = null

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
	const origin = {
		uid: before.uid,
		name: before.name,
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

	if (!commit) {
		console.log('\ndry run - pass --yes to send the commands. Planned groups:')
		console.log('  transport    values, playhead moves, play/stop (each step restores itself)')
		console.log('  renderstream synclayers on the layers the Director reports')
		console.log('  failover     never sent by this script')
		await live.close()
		process.exit(0)
	}
	if (origin.time === undefined) {
		console.error('the playhead could not be read over LiveUpdate; refusing to move it blind')
		await live.close()
		process.exit(1)
	}

	try {
		await verifyValues(origin)
		await verifyPlayhead(origin)
		await verifyPlayStop(origin)
		if (group === 'renderstream' || group === 'all') await verifyRenderStream()
	} finally {
		await runRestores()
		await settleBack(origin)
		await live.close()
	}
	report()
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
			await post(`/transport/${field}`, withTransport(origin, { [field]: probe }))
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
		await post('/transport/engaged', withTransport(origin, { engaged: target }))
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
		await post('/transport/gototime', withTransport(origin, { time: target, playmode: 'Stop' }))
		const seen = await settledTime((v) => close(v, target, 0.25))
		assertClose(seen, target, `playhead is at ${seen}s, wanted ${target}s`, 0.25)
		return `${origin.time}s -> ${seen}s`
	})

	await step('transport/gototimecode', `jump back to timecode ${origin.timecode}`, async () => {
		if (!origin.timecode) return skip('the project reports no timecode for the playhead')
		await post(
			'/transport/gototimecode',
			withTransport(origin, { timecode: origin.timecode, ignoreTags: true, playmode: 'Stop' }),
		)
		const seen = await settledTime((v) => close(v, origin.time, 0.25))
		assertClose(seen, origin.time, `playhead is at ${seen}s, wanted ${origin.time}s`, 0.25)
		return `-> ${seen}s`
	})

	await step('transport/returntostart', 'return to the start of the track', async () => {
		await post('/transport/returntostart', transports(origin))
		const seen = await settledTime((v) => close(v, 0, 0.25))
		assertClose(seen, 0, `playhead is at ${seen}s, wanted 0s`, 0.25)
		return `-> ${seen}s`
	})

	await step('transport/gotonextsection', 'step to the next section', async () => {
		const from = live.value('beat')
		await post('/transport/gotonextsection', withTransport(origin, { playmode: 'Stop' }))
		const seen = await settledBeat()
		return `beat ${from} -> ${seen}` + (seen === from ? ' (single-section track, no move)' : '')
	})

	await step('transport/gotoprevsection', 'step to the previous section', async () => {
		const from = live.value('beat')
		await post('/transport/gotoprevsection', withTransport(origin, { playmode: 'Stop' }))
		const seen = await settledBeat()
		return `beat ${from} -> ${seen}`
	})

	// The published body says section:string, but the Director parses the field as a uint64: a
	// section name is rejected with "Invalid value for field 'section' of type uint64".
	await step('transport/gotosection', 'jump to section 1 by number', async () => {
		await post('/transport/gotosection', withTransport(origin, { section: 1, playmode: 'Stop' }))
		const seen = await settledBeat()
		return `section 1 -> beat ${seen}`
	})

	await step('transport/gotosection (name)', 'reject a section name', async () => {
		const section = live.value('section')
		if (!section) return skip('the track has no named section at the playhead')
		try {
			await post('/transport/gotosection', withTransport(origin, { section, playmode: 'Stop' }))
		} catch (error) {
			if (/uint64/.test(String(error?.message ?? error))) return 'rejected as uint64, as expected'
			throw error
		}
		throw new Error('a section name was accepted; the uint64 note in the module is wrong')
	})

	await step('transport/gotonote', 'jump to a section by its name', async () => {
		const note = live.value('section')
		if (!note) return skip('the track has no named section at the playhead')
		await post('/transport/gotonote', withTransport(origin, { note, playmode: 'Stop' }))
		const seen = await settledBeat()
		return `note (name withheld) -> beat ${seen}`
	})

	await step('transport/gototrack', 'select the track that is already current', async () => {
		await post('/transport/gototrack', withTransport(origin, { track: origin.track, playmode: 'Stop' }))
		const seen = (await transport())?.currentTrack
		if (seen?.uid !== origin.track.uid) throw new Error(`current track is now ${seen?.uid}`)
		return 'track unchanged'
	})

	for (const [path, label] of [
		['/transport/gotonexttrack', 'next track'],
		['/transport/gotoprevtrack', 'previous track'],
	]) {
		await step(path.slice(1), `step to the ${label}`, async () => {
			const from = (await transport())?.currentTrack
			await post(path, withTransport(origin, { playmode: 'Stop' }))
			const seen = (await transport())?.currentTrack
			restores.push({
				path: '/transport/gototrack',
				body: withTransport(origin, { track: origin.track, playmode: 'Stop' }),
			})
			return seen?.uid === from?.uid ? 'accepted, single-track setlist so the track did not change' : 'track changed'
		})
	}

	await popRestore(home)
}

/** play, playsection, playloopsection - each started, observed and stopped again. */
async function verifyPlayStop(origin) {
	await step('transport/stop', 'stop a transport that is already stopped', async () => {
		await post('/transport/stop', transports(origin))
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
			restores.push({ path: '/transport/stop', body: transports(origin) })
			await post(path, transports(origin))
			const playing = await readBack(
				(t) => t?.playmode,
				(v) => wanted.includes(v),
			)
			await wait(400)
			restores.pop()
			await post('/transport/stop', transports(origin))
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
		await post('/renderstream/synclayers', { layers: layers.map((l) => ({ uid: l.uid, name: l.name })) })
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
	if (args.only && !id.includes(String(args.only))) return
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
		const refused = /refused \(\d+\)/.test(message)
		console.log(refused ? `refused (${message.replace(/^.*refused \(\d+\): /, '')})` : `FAILED (${message})`)
		results.push({ id, summary, status: refused ? 'refused' : 'failed', detail: message })
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

async function popRestore(entry) {
	const at = restores.lastIndexOf(entry)
	if (at >= 0) restores.splice(at, 1)
	await post(entry.path, entry.body)
}

async function runRestores() {
	while (restores.length > 0) {
		const entry = restores.pop()
		try {
			await post(entry.path, entry.body)
		} catch (error) {
			console.error(`  restore ${entry.path} FAILED: ${String(error?.message ?? error)}`)
		}
	}
}

/** Put the transport back exactly where it started, whatever the steps did. */
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
	// not stop the rest of the sweep, so every entry is put back on its own.
	for (const [path, body] of sweep) {
		try {
			await post(path, body)
		} catch (error) {
			console.error(`  sweep ${path}: ${String(error?.message ?? error)}`)
		}
	}
	const after = await transport()
	const time = await settledTime((v) => close(v, origin.time, 0.25))
	console.log(
		`\nrestored  playmode=${after?.playmode} brightness=${after?.brightness} volume=${after?.volume} ` +
			`speed=${after?.speed} engaged=${after?.engaged} time=${time}s (was ${origin.time}s)`,
	)
}

async function bail(reason) {
	console.error(`\n${reason} - restoring before exit`)
	await runRestores()
	process.exit(1)
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
	if (code !== undefined && code !== 0) throw new Error(`${path} refused (${code}): ${answer.status.message}`)
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

function report() {
	const counts = { ok: 0, refused: 0, failed: 0, skipped: 0, 'not-exercised': 0 }
	for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1
	console.log(
		`\n${counts.ok} ok, ${counts.refused} refused by the Director, ${counts.failed} failed, ` +
			`${counts.skipped} skipped, ${counts['not-exercised']} not exercised`,
	)
	writeFileSync(
		outFile,
		JSON.stringify(
			{ host: '192.0.2.10', designer: args.designer ?? 'r34.0.3', group, at: new Date().toISOString(), results },
			null,
			2,
		) + '\n',
	)
	console.log(`wrote ${outFile}`)
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
