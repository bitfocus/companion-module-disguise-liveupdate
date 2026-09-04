/**
 * End-to-end over a real WebSocket: the built module talks to a mock Director (test/mock-director.ts).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installHarness, liveUpdateFeedback, loadDist, settle, tick } from './harness'
import { MockDirector } from './mock-director'
import { createServer, type AddressInfo, type Socket } from 'node:net'

installHarness({ fakeSocket: false })
const dist = loadDist()

const TRACK = 'track:"Track 1"'
const director = new MockDirector()
let port = 0

before(async () => {
	port = await director.listen()
	director.setValue(TRACK, 'object.lengthInBeats', 240)
	director.setValue(TRACK, 'object.description', 'Track 1')
	director.setValue('transportManager:default', 'object.brightness', 1)
	director.setValue('transportManager:default', 'object.engaged', true)
	director.setValue('screen2:"Surface 1"', 'object.offset', { x: 0, y: 3, z: 0 })
	director.setErrorValue(TRACK, 'object.broken', { errorType: 'AttributeError', message: "no attribute 'broken'" })
})

after(async () => {
	await director.close()
})

async function connected(feedbacks = [] as ReturnType<typeof liveUpdateFeedback>[]) {
	const inst = new dist.DisguiseInstance()
	const initPromise = inst.init({
		host: '127.0.0.1',
		port,
		reconnectInterval: 1000,
		pendingSubscriptionTimeout: 5000,
		discoverOnConnect: false,
	})
	if (feedbacks.length) {
		const update: Record<string, any> = {}
		for (const feedback of feedbacks) update[feedback.id] = feedback
		inst.updateFeedbacks(update)
	}
	await initPromise
	for (let i = 0; i < 100 && !inst.isConnectionReady(); i++) await tick(10)
	assert.ok(inst.isConnectionReady(), 'connected to the mock Director')
	return inst
}

async function waitFor(predicate: () => boolean, ms = 2000): Promise<void> {
	const deadline = Date.now() + ms
	while (Date.now() < deadline) {
		if (predicate()) return
		await tick(10)
	}
	assert.ok(predicate(), 'condition not met in time')
}

test('subscribes over ws, receives values, sets and toggles properties', async () => {
	const inst = await connected([
		liveUpdateFeedback('len', TRACK, 'object.lengthInBeats', 'trackLengthBeats', 5000),
		liveUpdateFeedback('br', 'transportManager:default', 'object.brightness', 'brightness', 500),
		liveUpdateFeedback('en', 'transportManager:default', 'object.engaged', 'engaged', 500),
		liveUpdateFeedback('off', 'screen2:"Surface 1"', 'object.offset', 'screenOffset', 500),
	])
	const host = inst.host
	await waitFor(
		() => host.variables.get('trackLengthBeats') === 240 && host.variables.get('screenOffset') !== undefined,
	)
	assert.equal(host.variables.get('brightness'), 1)
	assert.equal(host.variables.get('engaged'), true)
	assert.equal(host.variables.get('screenOffset'), '{"x":0,"y":3,"z":0}')
	assert.equal(director.subscriptions.length, 4)
	// the module batches the properties of one object into a single frame
	assert.equal(
		director.received.filter((m) => m.subscribe).reduce((total, m) => total + m.subscribe.properties.length, 0),
		4,
	)

	// value pushed by the Director
	director.publish(TRACK, 'object.lengthInBeats', 300)
	await waitFor(() => host.variables.get('trackLengthBeats') === 300)

	// Set to Disguise (Number) with an expression on the current value
	const actions = dist.getActionDefinitions(inst)
	const context = {
		parseVariablesInString: async (text: string) =>
			text.replace('$(liveupdate:brightness)', String(host.variables.get('brightness'))),
	}
	await actions.setToDisguiseNumber.callback(
		{ options: { variableName: 'brightness', value: '$(liveupdate:brightness)-0.05' } },
		context,
	)
	await waitFor(() => host.variables.get('brightness') === 0.95)
	assert.deepEqual(director.sets.at(-1), {
		id: director.subscriptions.find((s) => s.propertyPath === 'object.brightness')!.id,
		value: 0.95,
	})

	// Toggle Disguise Boolean
	await actions.setToDisguiseToggle.callback({ options: { variableName: 'engaged' } }, context)
	await waitFor(() => host.variables.get('engaged') === false)

	// JSON partial set merges on the mock Director like on the real one
	await actions.setToDisguiseJSON.callback({ options: { variableName: 'screenOffset', value: '{"x": 4.0}' } }, context)
	await waitFor(() => host.variables.get('screenOffset') === '{"x":4,"y":3,"z":0}')

	// Compare feedback sees the live value
	const feedbacks = dist.getFeedbackDefinitions(inst)
	assert.equal(
		feedbacks.liveUpdateCompare.callback({ options: { variableName: 'brightness', operator: 'lt', value: '1' } }),
		true,
	)
	assert.equal(
		feedbacks.liveUpdateCompare.callback({ options: { variableName: 'engaged', operator: 'truthy', value: '' } }),
		false,
	)

	await inst.destroy()
	await waitFor(() => director.subscriptions.length === 0)
})

test('errors from the Director: unknown object and failing property', async () => {
	const inst = await connected([
		liveUpdateFeedback('bad', 'track:"Missing"', 'object.lengthInBeats', 'missingLen', 500),
		liveUpdateFeedback('brk', TRACK, 'object.broken', 'broken', 500),
	])
	const host = inst.host
	await waitFor(() => host.variables.get('missingLen') === 'ERROR')
	await waitFor(() => host.variables.get('broken') === 'PATH_ERROR')
	assert.ok(host.logs.some((l: { message: string }) => l.message.includes('next retry in')))
	await inst.destroy()
})

test('connection loss is reported and reconnection is scheduled', async () => {
	const inst = await connected([liveUpdateFeedback('len', TRACK, 'object.lengthInBeats', 'trackLengthBeats', 5000)])
	const host = inst.host
	await waitFor(() => host.variables.get('trackLengthBeats') !== undefined)
	for (const client of director.clients) client.terminate()
	await waitFor(() => host.variables.get('connection_status') === 'Disconnected')
	assert.equal(inst.isConnectionReady(), false)
	assert.ok(host.logs.some((l: { message: string }) => l.message.startsWith('Reconnecting in')))
	// the module reconnects on its own and re-subscribes
	await waitFor(
		() => host.variables.get('trackLengthBeats') === 240 || host.variables.get('trackLengthBeats') === 300,
		4000,
	)
	await inst.destroy()
	await settle()
})

test('tearing down a socket that is still connecting does not crash the module', async () => {
	// a TCP server that accepts the connection but never answers the WebSocket handshake
	const sockets = new Set<Socket>()
	const stall = createServer((socket) => {
		sockets.add(socket)
		socket.on('error', () => {})
	})
	await new Promise<void>((resolve) => stall.listen(0, '127.0.0.1', resolve))
	const stall2 = createServer((socket) => {
		sockets.add(socket)
		socket.on('error', () => {})
	})
	await new Promise<void>((resolve) => stall2.listen(0, '127.0.0.1', resolve))
	const port1 = (stall.address() as AddressInfo).port
	const port2 = (stall2.address() as AddressInfo).port
	let uncaught: unknown
	const onUncaught = (e: unknown) => {
		uncaught = e
	}
	process.on('uncaughtException', onUncaught)
	try {
		const inst = new dist.DisguiseInstance()
		await inst.init({
			host: '127.0.0.1',
			port: port1,
			reconnectInterval: 1000,
			pendingSubscriptionTimeout: 5000,
			discoverOnConnect: false,
		})
		await tick(50)
		assert.equal(inst.isConnectionReady(), false)
		// connection settings change while the first socket is still connecting
		await inst.configUpdated({ ...inst.config, port: port2 })
		await tick(50)
		// destroy while the second socket is still connecting
		await inst.destroy()
		await tick(50)
	} finally {
		process.off('uncaughtException', onUncaught)
		for (const socket of sockets) socket.destroy()
		stall.close()
		stall2.close()
	}
	assert.equal(uncaught, undefined, `uncaught exception: ${String(uncaught)}`)
})
