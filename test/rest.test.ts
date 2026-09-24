/**
 * The command channel against a mock Session REST API: the paths and bodies the module sends, the
 * destructive gate, the arm-and-confirm, and what happens when a Director does not know a command.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import path from 'node:path'
import { installHarness, loadDist, ROOT, tick } from './harness'

installHarness({ fakeSocket: true })
const dist = loadDist()
/* eslint-disable @typescript-eslint/no-require-imports */
const rest = require(path.join(ROOT, 'dist/rest.js'))
const config = require(path.join(ROOT, 'dist/config.js'))
/* eslint-enable @typescript-eslint/no-require-imports */

interface Received {
	path: string
	body: unknown
}

const received: Received[] = []
/** Paths the mock Director does not implement */
const missing = new Set<string>(['/api/session/renderstream/synclayers'])
/** Paths that answer with a Director-level failure */
const refuses = new Set<string>()
/** Paths that fail with the reason only in status.details, the shape r34.0.3 uses for some refusals */
const refusesQuietly = new Set<string>()

let server: Server
let port = 0

before(async () => {
	server = createServer((req, res) => {
		const chunks: Buffer[] = []
		req.on('data', (c: Buffer) => chunks.push(c))
		req.on('end', () => {
			const path = req.url ?? ''
			let body: unknown = null
			try {
				body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
			} catch {
				body = null
			}
			// Recorded before the 404, so a test can see whether a missing path was tried again
			received.push({ path, body })
			if (req.method !== 'POST' || missing.has(path)) {
				res.writeHead(404, { 'content-type': 'text/html' })
				res.end('not found')
				return
			}
			const failure = refuses.has(path)
			const quiet = refusesQuietly.has(path)
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(
				JSON.stringify({
					status: {
						code: failure || quiet ? (quiet ? 1000 : 4000) : 0,
						message: failure ? 'refused by the Director' : '',
						details: quiet ? [{ message: 'Transport speed control is disabled.' }] : [],
					},
				}),
			)
		})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	port = (server.address() as AddressInfo).port
})

after(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function connected(overrides: Record<string, unknown> = {}) {
	received.length = 0
	refuses.clear()
	refusesQuietly.clear()
	const inst = new dist.DisguiseInstance()
	await inst.init({ host: '127.0.0.1', port, reconnectInterval: 1000, pendingSubscriptionTimeout: 5000, ...overrides })
	return inst
}

const context = { parseVariablesInString: async (text: string) => text }

/** The warnings logged after the given position in the host log */
const warningsSince = (inst: { host: { logs: { level: string; message: string }[] } }, from: number): string[] =>
	inst.host.logs
		.slice(from)
		.filter((l) => l.level === 'warn')
		.map((l) => l.message)

test('a transport command posts the documented path and body', async () => {
	const inst = await connected()
	const actions = dist.getActionDefinitions(inst)
	await actions.restPlay.callback({ options: { transport: 'default' }, controlId: 'bank1' }, context)
	assert.equal(received.length, 1)
	assert.equal(received[0].path, '/api/session/transport/play')
	assert.deepEqual(received[0].body, { transports: [{ name: 'default' }] })
	assert.equal(inst.host.variables.get('rest_last_status'), 'OK')
	await inst.destroy()
})

test('a numeric transport command wraps the value next to the transport', async () => {
	const inst = await connected()
	const actions = dist.getActionDefinitions(inst)
	await actions.restBrightness.callback(
		{ options: { transport: 'default', brightness: '0.5' }, controlId: 'b' },
		context,
	)
	assert.deepEqual(received[0].body, { transports: [{ transport: { name: 'default' }, brightness: 0.5 }] })
	await inst.destroy()
})

test('a uid is sent as a uid and a name as a name', async () => {
	const inst = await connected()
	const actions = dist.getActionDefinitions(inst)
	await actions.restGotoTrack.callback(
		{ options: { transport: '1234567890123456789', track: 'demo', playmode: 'Play' }, controlId: 'b' },
		context,
	)
	assert.deepEqual(received[0].body, {
		transports: [{ transport: { uid: '1234567890123456789' }, track: { name: 'demo' }, playmode: 'Play' }],
	})
	await inst.destroy()
})

test('next and previous section and track wrap the transport and carry the play mode', async () => {
	// The OpenAPI body for these four is {transports:[{transport, playmode}]}, not the play/stop shape.
	// A button saved before the play mode option existed has no playmode and must send 'NotSet'.
	const inst = await connected()
	const actions = dist.getActionDefinitions(inst)
	const steps: [string, string][] = [
		['restNextSection', '/api/session/transport/gotonextsection'],
		['restPrevSection', '/api/session/transport/gotoprevsection'],
		['restNextTrack', '/api/session/transport/gotonexttrack'],
		['restPrevTrack', '/api/session/transport/gotoprevtrack'],
	]
	for (const [actionId, url] of steps) {
		const playmode = actions[actionId].options.find((o: { id: string }) => o.id === 'playmode')
		assert.equal(playmode?.default, 'NotSet', `${actionId} offers the play mode, leaving it unchanged by default`)
		received.length = 0
		await actions[actionId].callback({ options: { transport: 'default' }, controlId: 'b' }, context)
		assert.equal(received.length, 1, actionId)
		assert.equal(received[0].path, url)
		assert.deepEqual(received[0].body, { transports: [{ transport: { name: 'default' }, playmode: 'NotSet' }] })
	}
	received.length = 0
	await actions.restNextSection.callback(
		{ options: { transport: 'default', playmode: 'Play' }, controlId: 'b' },
		context,
	)
	assert.deepEqual(received[0].body, { transports: [{ transport: { name: 'default' }, playmode: 'Play' }] })
	await inst.destroy()
})

test('play, stop, play/loop section and return to start keep the body that only names the transport', async () => {
	const inst = await connected()
	const actions = dist.getActionDefinitions(inst)
	for (const actionId of ['restPlay', 'restStop', 'restPlaySection', 'restLoopSection', 'restReturnToStart']) {
		received.length = 0
		await actions[actionId].callback({ options: { transport: 'default' }, controlId: 'b' }, context)
		assert.deepEqual(received[0].body, { transports: [{ name: 'default' }] }, actionId)
	}
	await inst.destroy()
})

test('an empty numeric field sends nothing instead of 0', async () => {
	// Number('') is 0: an empty brightness would black the show, an empty time jump to 0 s.
	const inst = await connected()
	const actions = dist.getActionDefinitions(inst)
	// A custom variable that was just created is an empty string
	const empty = { parseVariablesInString: async (text: string) => text.replace(/\$\(custom:\w+\)/g, '') }
	const fields: [string, string, string][] = [
		['restBrightness', 'brightness', 'Brightness 0..1'],
		['restVolume', 'volume', 'Volume 0..1'],
		['restSpeed', 'speed', 'Speed (1 = normal)'],
		['restGotoTime', 'time', 'Time in seconds'],
	]
	for (const [actionId, field, label] of fields) {
		for (const value of ['', '   ', '$(custom:level)']) {
			const warnings = inst.host.logs.length
			await actions[actionId].callback({ options: { transport: 'default', [field]: value }, controlId: 'b' }, empty)
			const logged = warningsSince(inst, warnings)
			assert.equal(logged.length, 1, `${actionId} '${value}' logs one warning`)
			assert.ok(logged[0].includes(`'${label}' is empty or unresolved, nothing was sent`), logged[0])
		}
	}
	assert.equal(received.length, 0)
	await actions.restBrightness.callback({ options: { transport: 'default', brightness: '0' }, controlId: 'b' }, empty)
	assert.deepEqual(
		received[0].body,
		{ transports: [{ transport: { name: 'default' }, brightness: 0 }] },
		'a typed 0 is sent',
	)
	await inst.destroy()
})

test('a destructive command is refused until it is allowed, then needs two presses', async () => {
	const inst = await connected({ restAllowDestructive: false })
	const actions = dist.getActionDefinitions(inst)
	const press = () =>
		actions.restRsRestart.callback({ options: { layers: 'RenderStream 2' }, controlId: 'bank9' }, context)

	await press()
	assert.equal(received.length, 0, 'refused while destructive commands are off')
	assert.ok(inst.host.logs.some((l: { message: string }) => l.message.includes('Allow destructive commands')))

	await inst.configUpdated({ ...inst.config, restAllowDestructive: true })
	await press()
	assert.equal(received.length, 0, 'the first press only arms')
	assert.equal(inst.host.variables.get('rest_armed'), 'RenderStream: Restart layers (RenderStream 2)')

	await press()
	assert.equal(received.length, 1, 'the second press sends it')
	assert.equal(received[0].path, '/api/session/renderstream/restartlayers')
	assert.deepEqual(received[0].body, { layers: [{ name: 'RenderStream 2' }] })
	assert.equal(inst.host.variables.get('rest_armed'), '')
	await inst.destroy()
})

test('changing the target re-arms instead of firing at something else', async () => {
	const inst = await connected({ restAllowDestructive: true })
	const actions = dist.getActionDefinitions(inst)
	await actions.restFailoverMachine.callback({ options: { machine: 'ACTOR01' }, controlId: 'bank3' }, context)
	assert.equal(received.length, 0, 'armed for ACTOR01')
	await actions.restFailoverMachine.callback({ options: { machine: 'ACTOR02' }, controlId: 'bank3' }, context)
	assert.equal(received.length, 0, 'a different machine arms again rather than firing')
	await actions.restFailoverMachine.callback({ options: { machine: 'ACTOR02' }, controlId: 'bank3' }, context)
	assert.equal(received.length, 1)
	assert.deepEqual(received[0].body, { machine: { name: 'ACTOR02' } })
	await inst.destroy()
})

test('a command the Director does not know is reported once and not retried', async () => {
	const inst = await connected({ restAllowDestructive: true })
	const actions = dist.getActionDefinitions(inst)
	const path = '/api/session/renderstream/synclayers'
	const hits = () => received.filter((r) => r.path === path).length
	// The Director's 404 is logged by the client once per request that reached it
	const notFound = () =>
		inst.host.logs.filter((l: { message: string }) => l.message.includes('REST /renderstream/synclayers -> 404')).length
	const press = () =>
		actions.restRsSync.callback({ options: { layers: 'RenderStream 2' }, controlId: 'bank4' }, context)
	await press()
	await press() // arm, then send
	assert.equal(hits(), 1, 'the first send reaches the Director')
	assert.equal(inst.host.variables.get('rest_last_status'), 'UNSUPPORTED')
	assert.ok(inst.host.logs.some((l: { message: string }) => l.message.includes('has no')))
	await press()
	await press()
	assert.equal(hits(), 1, 'the absent path is not tried again')
	assert.equal(notFound(), 1, 'the 404 is reported once')
	assert.equal(inst.host.variables.get('rest_last_status'), 'UNSUPPORTED', 'the cached answer is still reported')
	await inst.destroy()
})

test('a Director-level refusal is reported as a failure', async () => {
	const inst = await connected()
	refuses.add('/api/session/transport/stop')
	const actions = dist.getActionDefinitions(inst)
	await actions.restStop.callback({ options: { transport: 'default' }, controlId: 'b' }, context)
	assert.equal(inst.host.variables.get('rest_last_status'), 'FAILED')
	assert.equal(inst.host.variables.get('rest_last_message'), 'refused by the Director')
	const feedbacks = dist.getFeedbackDefinitions(inst)
	assert.equal(feedbacks.restLastResult.callback({ options: {} }), true)
	await inst.destroy()
})

test('an unresolved option sends nothing', async () => {
	const inst = await connected()
	const actions = dist.getActionDefinitions(inst)
	await actions.restPlay.callback({ options: { transport: '$NA' }, controlId: 'b' }, context)
	await actions.restGotoTrack.callback({ options: { transport: 'default', track: '' }, controlId: 'b' }, context)
	assert.equal(received.length, 0)
	await tick(10)
	await inst.destroy()
})

test('a text parameter that is empty or unresolved is refused with one warning, for every command', async () => {
	// The host turns an unknown variable into '$NA', and the module publishes '$NA' for an empty
	// selection; a reference the host could not parse stays as '$('. None of it may reach the Director.
	const inst = await connected({ restAllowDestructive: true })
	const actions = dist.getActionDefinitions(inst)
	const host = { parseVariablesInString: async (text: string) => text.replace(/\$\(d3:\w+\)/g, '$NA') }
	const cases: [string, Record<string, unknown>, string][] = [
		['restGotoSection', { transport: 'default', section: '$(d3:selSection)', playmode: 'NotSet' }, 'Section number'],
		['restGotoSection', { transport: 'default', section: '' }, 'Section number'],
		['restGotoNote', { transport: 'default', note: 'Intro $(d3:selNote)', playmode: 'Play' }, 'Note'],
		['restGotoTag', { transport: 'default', tagType: 'CUE', value: '$(custom:cue' }, 'Tag value'],
		['restGotoTimecode', { transport: 'default', timecode: '  ' }, 'Timecode'],
		['restGotoTrack', { transport: 'default', track: '$(d3:selTrack)' }, 'track'],
		['restGotoTrack', { transport: 'default', track: 'name:' }, 'track'],
		['restGotoTrack', { transport: 'uid:demo', track: 'demo' }, 'transport'],
		['restFailoverMachine', { machine: '$(d3:selMachine)' }, 'machine'],
		['restRsRestart', { layers: '$(d3:selLayer)' }, 'a layer'],
		['restRsRestart', { layers: 'Layer A,$(d3:selLayer)' }, 'a layer'],
		['restRsStart', { layers: 'Layer A,' }, 'a layer'],
		['restRsStop', { layers: '' }, 'a layer'],
	]
	for (const [actionId, options, field] of cases) {
		const from = inst.host.logs.length
		await actions[actionId].callback({ actionId, options, controlId: 'bank7' }, host)
		const logged = warningsSince(inst, from)
		const what = `${actionId} ${JSON.stringify(options)}`
		assert.equal(logged.length, 1, `${what} logs one warning: ${logged.join(' | ')}`)
		assert.ok(logged[0].includes(field) && logged[0].includes('nothing was sent'), logged[0])
		assert.equal(inst.host.variables.get('rest_armed') ?? '', '', `${what} does not arm`)
	}
	assert.equal(received.length, 0)
	await inst.destroy()
})

test('name: and uid: choose how a reference is sent, over the 6-digit rule', async () => {
	assert.deepEqual(rest.parseTarget('1234567890123456789'), { uid: '1234567890123456789' })
	assert.deepEqual(rest.parseTarget('20250914'), { uid: '20250914' }, 'the default rule is unchanged')
	assert.deepEqual(rest.parseTarget('12345'), { name: '12345' })
	assert.deepEqual(rest.parseTarget('name:20250914'), { name: '20250914' })
	assert.deepEqual(rest.parseTarget(' name: Track 1 '), { name: 'Track 1' })
	assert.deepEqual(rest.parseTarget('name:uid:7'), { name: 'uid:7' })
	assert.deepEqual(rest.parseTarget('uid:42'), { uid: '42' })
	for (const nothing of ['', 'name:', 'uid:', 'uid:demo', 'uid:0x1f'])
		assert.equal(rest.parseTarget(nothing), null, nothing)

	const inst = await connected({ restAllowDestructive: true })
	const actions = dist.getActionDefinitions(inst)
	await actions.restGotoTrack.callback(
		{ options: { transport: 'uid:42', track: 'name:20250914', playmode: 'NotSet' }, controlId: 'b' },
		context,
	)
	assert.deepEqual(received[0].body, {
		transports: [{ transport: { uid: '42' }, track: { name: '20250914' }, playmode: 'NotSet' }],
	})
	const layers = () =>
		actions.restRsStart.callback({ options: { layers: 'name:100001, uid:1234567' }, controlId: 'b' }, context)
	await layers()
	await layers() // arm, then send
	assert.deepEqual(received[1].body, { layers: [{ name: '100001' }, { uid: '1234567' }] })

	const tooltip = (actionId: string, id: string): string =>
		actions[actionId].options.find((o: { id: string }) => o.id === id)?.tooltip ?? ''
	for (const [actionId, id] of [
		['restPlay', 'transport'],
		['restGotoTrack', 'track'],
		['restFailoverMachine', 'machine'],
		['restRestoreMachine', 'machine'],
		['restRsStart', 'layers'],
	]) {
		assert.ok(tooltip(actionId, id).includes('name:') && tooltip(actionId, id).includes('uid:'), `${actionId}.${id}`)
	}
	await inst.destroy()
})

test('a reply that stalls or breaks after the headers is a failure, never OK', async () => {
	// The Director may send 'HTTP 200' and then a refusal in the body; if the body never arrives the
	// outcome is unknown.
	const sockets = new Set<Socket>()
	const stalling = createServer((req, res) => {
		req.resume()
		req.on('end', () => {
			const body = JSON.stringify({ status: { code: 5, message: 'refused' } })
			res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) })
			res.write(body.slice(0, 5))
			// /stop breaks the connection mid-body; everything else stalls past the timeout
			if (req.url?.endsWith('/transport/stop')) setTimeout(() => res.socket?.destroy(), 50)
		})
	})
	stalling.on('connection', (socket: Socket) => sockets.add(socket))
	await new Promise<void>((resolve) => stalling.listen(0, '127.0.0.1', resolve))
	const logs: string[] = []
	const client = new rest.RestClient({
		host: '127.0.0.1',
		port: (stalling.address() as AddressInfo).port,
		timeoutMs: 300,
		log: (_level: string, message: string) => logs.push(message),
	})
	try {
		const stalled = await client.post('returnToStart', { transports: [{ name: 'default' }] })
		assert.equal(stalled.ok, false)
		assert.equal(stalled.status, 200)
		assert.equal(stalled.message, 'timed out reading the reply')
		assert.ok(stalled.durationMs >= 250, `the duration includes the body read (${stalled.durationMs} ms)`)

		const broken = await client.post('stop', { transports: [{ name: 'default' }] })
		assert.equal(broken.ok, false)
		assert.match(broken.message, /^could not read the reply/)
		assert.ok(
			logs.some((line) => line.includes('(timed out reading the reply)')),
			`the log says why: ${logs.join(' | ')}`,
		)
	} finally {
		for (const socket of sockets) socket.destroy()
		await new Promise<void>((resolve) => stalling.close(() => resolve()))
	}
})

test('commands can be switched off entirely', async () => {
	const inst = await connected({ restEnabled: false })
	const actions = dist.getActionDefinitions(inst)
	await actions.restPlay.callback({ options: { transport: 'default' }, controlId: 'b' }, context)
	assert.equal(received.length, 0)
	assert.ok(inst.host.logs.some((l: { message: string }) => l.message.includes('Command channel is off')))
	await inst.destroy()
})

test('a refusal whose reason is only in the details is still reported with that reason', async () => {
	// r34.0.3 answers POST /transport/speed with HTTP 200, status code 1000 and, depending on the
	// build, the reason in status.details rather than status.message.
	const inst = await connected()
	refusesQuietly.add('/api/session/transport/speed')
	const actions = dist.getActionDefinitions(inst)
	await actions.restSpeed.callback({ options: { transport: 'default', speed: '0.5' }, controlId: 'b' }, context)
	assert.equal(inst.host.variables.get('rest_last_status'), 'FAILED')
	assert.equal(inst.host.variables.get('rest_last_message'), 'Transport speed control is disabled.')
	await inst.destroy()
})

test('go to note sends the name, go to section sends the number', async () => {
	// The Director parses 'section' as a uint64 and refuses a section name, so the two are separate
	// actions: the number goes to gotosection, the name to gotonote.
	const inst = await connected()
	const actions = dist.getActionDefinitions(inst)
	await actions.restGotoNote.callback(
		{ options: { transport: 'default', note: 'Opening', playmode: 'Stop' }, controlId: 'b' },
		context,
	)
	assert.equal(received[0].path, '/api/session/transport/gotonote')
	assert.deepEqual(received[0].body, {
		transports: [{ transport: { name: 'default' }, note: 'Opening', playmode: 'Stop' }],
	})

	await actions.restGotoSection.callback(
		{ options: { transport: 'default', section: '2', playmode: 'NotSet' }, controlId: 'b' },
		context,
	)
	assert.equal(received[1].path, '/api/session/transport/gotosection')
	assert.deepEqual(received[1].body, {
		transports: [{ transport: { name: 'default' }, section: '2', playmode: 'NotSet' }],
	})
	await inst.destroy()
})

test('go to tag carries the tag type and the global-jump flag', async () => {
	const inst = await connected()
	const actions = dist.getActionDefinitions(inst)
	await actions.restGotoTag.callback(
		{
			options: { transport: 'default', tagType: 'CUE', value: '12', allowGlobalJump: true, playmode: 'Play' },
			controlId: 'b',
		},
		context,
	)
	assert.equal(received[0].path, '/api/session/transport/gototag')
	assert.deepEqual(received[0].body, {
		transports: [{ transport: { name: 'default' }, type: 'CUE', value: '12', allowGlobalJump: true, playmode: 'Play' }],
	})
	await inst.destroy()
})

test('the Commands settings text gates exactly the destructive commands', () => {
	const gated = new Set(
		Object.values(rest.REST_ENDPOINTS)
			.filter((endpoint: any) => endpoint.destructive)
			.map((endpoint: any) => endpoint.group),
	)
	assert.deepEqual([...gated].sort(), ['failover', 'renderstream'])
	const info: string = config.getConfigFields().find((field: any) => field.id === 'commandInfo').value
	// transport commands are not destructive: the text must not promise that they are refused or armed
	assert.doesNotMatch(info, /what the audience sees/)
	assert.match(info, /Transport commands fire on one press/)
	assert.match(info, /RenderStream and failover commands [^.]*refused unless you allow them/)
})
