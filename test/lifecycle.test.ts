/**
 * Subscription lifecycle against an in-process fake Director (real module-base FeedbackManager).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeDirector, liveUpdateFeedback, newInstance, settle, tick } from './harness'

const TRACK = 'track:"Track 1"'

test('one subscribe request per pair, however many feedbacks and re-checks', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const feedbacks = Array.from({ length: 20 }, (_, i) =>
		liveUpdateFeedback(`fb${i}`, `track:"Track ${i}"`, 'object.lengthInBeats', `len${i}`),
	)
	const { inst, host } = await newInstance(director, feedbacks)
	await settle(100)
	assert.equal(director.count('subscribe'), 20)
	assert.equal(director.subs.length, 20)
	for (let i = 0; i < 20; i++) {
		assert.ok(host.definedVariables.has(`len${i}`), `variable len${i} defined`)
		assert.equal(host.variables.get(`len${i}`), 1)
	}
	inst.checkFeedbacks()
	await settle()
	assert.equal(director.count('subscribe'), 20, 'no re-send for confirmed subscriptions')
	await inst.destroy()
})

test('feedbacks sharing a pair share one subscription that is released by the last one', async () => {
	const director = new FakeDirector({ valueFor: () => 240 })
	const a = liveUpdateFeedback('a', TRACK, 'object.lengthInBeats', 'trackLengthBeats')
	const b = liveUpdateFeedback('b', TRACK, 'object.lengthInBeats', 'trackLengthBeats')
	const { inst, host } = await newInstance(director, [a, b])
	await settle(50)
	assert.equal(director.count('subscribe'), 1)
	assert.equal(host.variables.get('trackLengthBeats'), 240)

	inst.updateFeedbacks({ a: null })
	await settle(50)
	assert.equal(director.count('unsubscribe'), 0, 'still used by b')
	assert.equal(director.subs.length, 1)

	inst.updateFeedbacks({ b: null })
	await settle(50)
	assert.equal(director.count('unsubscribe'), 1)
	assert.equal(director.subs.length, 0)
	await inst.destroy()
})

test('objects arrive as JSON text, primitives as they are', async () => {
	const director = new FakeDirector({
		valueFor: (o, p) =>
			p === 'object.offset' ? { x: 1, y: 2, z: 3 } : p === 'object.player.playing' ? true : 'Track 1',
	})
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('o', 'screen2:"Surface 1"', 'object.offset', 'screenOffset'),
		liveUpdateFeedback('p', 'transportManager:default', 'object.player.playing', 'isPlaying'),
		liveUpdateFeedback('n', 'transportManager:default', 'object.track.description', 'trackname'),
	])
	await settle(50)
	assert.equal(host.variables.get('screenOffset'), '{"x":1,"y":2,"z":3}')
	assert.equal(host.variables.get('isPlaying'), true)
	assert.equal(host.variables.get('trackname'), 'Track 1')
	await inst.destroy()
})

test('unresolved paths are never sent and reserved names are refused', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('u1', 'track:"$NA"', 'object.lengthInBeats', 'len'),
		liveUpdateFeedback('u2', '<OBJECT_PATH>', 'object.<PROPERTY_PATH>', 'myValue'),
		liveUpdateFeedback('u3', 'subsystem:RenderStreamSystem', 'object.getWorkloadInstance($NA, $NA).health()', 'h'),
		liveUpdateFeedback('r1', TRACK, 'object.description', 'selTrack'),
		liveUpdateFeedback('r2', TRACK, 'object.description', 'connection_status'),
		liveUpdateFeedback('ok', TRACK, 'object.lengthInBeats', 'trackLengthBeats'),
	])
	await settle(50)
	assert.equal(director.count('subscribe'), 1)
	assert.equal(director.subs[0].objectPath, TRACK)
	assert.ok(host.logs.some((l) => l.level === 'warn' && l.message.includes('reserved')))
	assert.ok(!host.definedVariables.has('selTrack') || host.variables.get('selTrack') === '$NA')
	await inst.destroy()
})

test('a Director error marks the variable ERROR and the timer retries with back-off', async () => {
	let attempts = 0
	const director = new FakeDirector({
		errorFor: (o, p) => {
			attempts++
			return attempts <= 2 ? `Unable to subscribe to ${o} / ${p} - object not found` : null
		},
		valueFor: () => 5,
	})
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('e', 'track:"Nope"', 'object.lengthInBeats', 'len'),
	])
	await settle(50)
	assert.equal(director.count('subscribe'), 1)
	assert.equal(host.variables.get('len'), 'ERROR', 'ERROR indicator reaches a defined variable')

	// re-checks during the back-off do not resend
	inst.checkFeedbacks()
	await settle(20)
	assert.equal(director.count('subscribe'), 1)

	// first retry after ~2 s, second after ~4 s more (attempts 2 -> 3 succeeds)
	await tick(2300)
	await settle(50)
	assert.equal(director.count('subscribe'), 2, 'retry fired by the back-off timer without other traffic')
	await tick(4300)
	await settle(50)
	assert.equal(director.count('subscribe'), 3)
	assert.equal(host.variables.get('len'), 5)
	await inst.destroy()
})

test('three property errors unsubscribe once, back off every sharer and escalate', async () => {
	let errors = 0
	const director = new FakeDirector({
		refCount: true,
		errorValueFor: () => {
			errors++
			return errors <= 4 ? { errorType: 'AttributeError', message: 'no such attribute' } : undefined
		},
		valueFor: () => 42,
	})
	const a = liveUpdateFeedback('a', TRACK, 'object.nope', 'nope')
	const b = liveUpdateFeedback('b', TRACK, 'object.nope', 'nope')
	const { inst, host } = await newInstance(director, [a, b])
	await settle(50)
	// first error value delivered; push two more
	director.pushValueForPair(TRACK, 'object.nope', { errorType: 'AttributeError', message: 'no such attribute' })
	await settle(20)
	director.pushValueForPair(TRACK, 'object.nope', { errorType: 'AttributeError', message: 'no such attribute' })
	await settle(50)
	assert.equal(director.count('unsubscribe'), 1, 'one unsubscribe for the shared subscription')
	assert.equal(host.variables.get('nope'), 'PATH_ERROR (unsubscribed)')
	assert.equal(director.count('subscribe'), 1, 'no immediate re-subscribe by the sharer')
	inst.checkFeedbacks()
	await settle(20)
	assert.equal(director.count('subscribe'), 1)
	await tick(2300)
	await settle(50)
	assert.equal(director.count('subscribe'), 2, 'retried after the back-off')
	await inst.destroy()
})

test('changing the object path or the interval re-subscribes', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const fb = liveUpdateFeedback('s', 'track:"A"', 'object.lengthInBeats', 'trackLengthBeats', 1000)
	const { inst } = await newInstance(director, [fb])
	await settle(50)
	assert.equal(director.count('subscribe'), 1)
	assert.equal(director.subs[0].updateFrequencyMs, 1000)

	inst.updateFeedbacks({ s: { ...fb, options: { ...fb.options, objectPath: 'track:"B"' } } })
	await settle(50)
	assert.equal(director.count('unsubscribe'), 1)
	assert.equal(director.count('subscribe'), 2)
	assert.equal(director.subs[0].objectPath, 'track:"B"')

	inst.updateFeedbacks({ s: { ...fb, options: { ...fb.options, objectPath: 'track:"B"', updateFrequency: 250 } } })
	await settle(50)
	assert.equal(director.count('subscribe'), 3)
	assert.equal(director.subs[0].updateFrequencyMs, 250)
	await inst.destroy()
})

test('config updates that only touch settings or selections keep the socket', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst, host } = await newInstance(director, [liveUpdateFeedback('k', TRACK, 'object.lengthInBeats', 'len')])
	await settle(50)
	const statusCount = host.statuses.length
	await inst.configUpdated({
		...inst.config,
		presetIntervalPlayhead: 100,
		selTrack: 'Track 2',
		showExperimentalPresets: true,
	})
	await settle(50)
	assert.equal(host.statuses.length, statusCount, 'no reconnect status change')
	assert.equal(director.count('subscribe'), 1)
	assert.equal(host.variables.get('selTrack'), 'Track 2')
	assert.ok(
		Object.keys(host.presetDefinitions).some((id) => id.startsWith('exp_heading_')),
		'presets regenerated',
	)

	await inst.configUpdated({ ...inst.config, host: '10.0.0.2' })
	assert.equal(inst.isConnectionReady(), false, 'ready flag reset by the deliberate disconnect')
	await settle(50)
	assert.ok(host.statuses.some((s) => s.status === 'connecting'))
	await inst.destroy()
})

test('setSelection validates, persists and publishes $NA for empty values', async () => {
	const director = new FakeDirector()
	const { inst, host } = await newInstance(director)
	inst.setSelection('selLayerIndex', '010')
	assert.equal(host.savedConfigs.length, 0)
	assert.ok(host.logs.some((l) => l.message.includes('Selection rejected')))
	inst.setSelection('selTrack', '  Track 2 ')
	assert.equal(host.savedConfigs.length, 1)
	assert.equal((host.savedConfigs[0] as any).selTrack, 'Track 2')
	assert.equal(host.variables.get('selTrack'), 'Track 2')
	inst.setSelection('selTrack', '')
	assert.equal(host.variables.get('selTrack'), '$NA')
	inst.setSelection('nope', 'x')
	assert.equal(host.savedConfigs.length, 2)
	await inst.destroy()
})

test('pending requests that time out back off instead of being re-sent', async () => {
	const director = new FakeDirector({ silent: true })
	const { inst, host } = await newInstance(director, [liveUpdateFeedback('t', TRACK, 'object.lengthInBeats', 'len')], {
		pendingSubscriptionTimeout: 100,
	})
	await settle(20)
	assert.equal(director.count('subscribe'), 1)
	inst.checkFeedbacks()
	await settle(20)
	assert.equal(director.count('subscribe'), 1, 'in-flight request is not re-sent')
	await tick(250)
	assert.ok(host.logs.some((l) => l.message.includes('timed out')))
	inst.checkFeedbacks()
	await settle(20)
	assert.equal(director.count('subscribe'), 1, 'back-off after the timeout')
	await inst.destroy()
})

test('connection loss resets state and the Connection OK feedback is re-checked', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst, host } = await newInstance(director, [liveUpdateFeedback('c', TRACK, 'object.lengthInBeats', 'len')])
	await settle(50)
	assert.equal(host.variables.get('connection_status'), 'Connected')
	director.sock!.drop()
	await settle(20)
	assert.equal(inst.isConnectionReady(), false)
	assert.equal(host.variables.get('connection_status'), 'Disconnected')
	await inst.destroy()
})
