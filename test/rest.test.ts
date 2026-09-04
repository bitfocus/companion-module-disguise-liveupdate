/**
 * The command channel against a mock Session REST API: the paths and bodies the module sends, the
 * destructive gate, the arm-and-confirm, and what happens when a Director does not know a command.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { installHarness, loadDist, tick } from './harness'

installHarness({ fakeSocket: true })
const dist = loadDist()

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
			if (req.method !== 'POST' || missing.has(path)) {
				res.writeHead(404, { 'content-type': 'text/html' })
				res.end('not found')
				return
			}
			let body: unknown = null
			try {
				body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
			} catch {
				body = null
			}
			received.push({ path, body })
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
	const press = () =>
		actions.restRsSync.callback({ options: { layers: 'RenderStream 2' }, controlId: 'bank4' }, context)
	await press()
	await press() // arm, then send
	assert.equal(inst.host.variables.get('rest_last_status'), 'UNSUPPORTED')
	assert.ok(inst.host.logs.some((l: { message: string }) => l.message.includes('has no')))
	const before = received.length
	await press()
	await press()
	assert.equal(received.length, before, 'the absent path is not tried again')
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
