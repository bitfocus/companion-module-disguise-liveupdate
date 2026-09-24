/**
 * Subscription lifecycle against an in-process fake Director (real module-base FeedbackManager).
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
	destroyInstances,
	FakeDirector,
	type FeedbackInstance,
	liveUpdateFeedback,
	loadDist,
	newInstance,
	settle,
	tick,
	until,
	useDirector,
} from './harness'

const dist = loadDist()

// a failing test must not leave timers running into the next one
afterEach(destroyInstances)

const TRACK = 'track:"Track 1"'

/** A feedback instance of another type, placed the way the host does */
function placed(id: string, feedbackId: string, options: Record<string, unknown> = {}, controlId = `ctl_${id}`) {
	const instance: FeedbackInstance = { id, feedbackId, controlId, options, upgradeIndex: null, disabled: false }
	return instance
}

const compareFeedback = (id: string, variableName: string, operator: string, value: string): FeedbackInstance =>
	placed(id, 'liveUpdateCompare', { variableName, operator, value })

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
		liveUpdateFeedback('u4', 'track:""', 'object.lengthInBeats', 'emptyName'),
		liveUpdateFeedback('r1', TRACK, 'object.description', 'selTrack'),
		liveUpdateFeedback('r2', TRACK, 'object.description', 'connection_status'),
		liveUpdateFeedback('ok', TRACK, 'object.lengthInBeats', 'trackLengthBeats'),
	])
	await settle(50)
	assert.equal(director.count('subscribe'), 1)
	assert.equal(director.subs[0].objectPath, TRACK)
	assert.ok(host.logs.some((l) => l.level === 'warn' && l.message.includes('reserved')))
	assert.ok(!host.definedVariables.has('selTrack') || host.variables.get('selTrack') === '$NA')
	assert.equal(host.variables.get('connection_status'), 'Connected', 'a reserved name never receives Director data')
	// a path that cannot be resolved yet says so on the button, and in the log at warn level once
	for (const name of ['len', 'myValue', 'h', 'emptyName']) assert.equal(host.variables.get(name), 'UNSET', name)
	const refusals = host.logs.filter((l) => l.message.includes('Not subscribing feedback u1'))
	assert.equal(refusals.length, 1, 'logged once')
	assert.equal(refusals[0].level, 'warn')
	inst.checkFeedbacks()
	await settle()
	assert.equal(host.logs.filter((l) => l.message.includes('Not subscribing feedback u1')).length, 1)
	await inst.destroy()
})

test('every variable the module defines itself is reserved', async () => {
	const director = new FakeDirector({ valueFor: () => 'x' })
	const names = ['designer_version', 'selfcheck_ok', 'selfcheck_skipped', 'rest_last_status', 'rest_armed', 'selHost']
	const { inst, host } = await newInstance(
		director,
		names.map((name, i) => liveUpdateFeedback(`r${i}`, TRACK, `object.p${i}`, name)),
	)
	await settle(50)
	assert.equal(director.count('subscribe'), 0, 'none of them is subscribed')
	assert.equal(host.variables.get('rest_last_status'), undefined, 'no Director value in a module variable')
	assert.equal(host.variables.get('designer_version'), 'r34.0.3', 'the version read still owns designer_version')
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

	await inst.configUpdated({ ...inst.config, host: '127.0.0.2' })
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

test('a request still in flight is not re-sent', async () => {
	// the pending timeout is far longer than the test, so the check really meets the in-flight request
	const director = new FakeDirector({ silent: true })
	const { inst } = await newInstance(director, [liveUpdateFeedback('t', TRACK, 'object.lengthInBeats', 'len')], {
		pendingSubscriptionTimeout: 30000,
	})
	await settle(20)
	assert.equal(director.count('subscribe'), 1)
	assert.equal(inst.pendingSubscriptions.size, 1, 'the request is in flight')
	inst.checkFeedbacks()
	await settle(20)
	assert.equal(director.count('subscribe'), 1, 'in-flight request is not re-sent')
	await inst.destroy()
})

test('pending requests that time out back off instead of being re-sent', async () => {
	const director = new FakeDirector({ silent: true })
	const { inst, host } = await newInstance(director, [liveUpdateFeedback('t', TRACK, 'object.lengthInBeats', 'len')], {
		pendingSubscriptionTimeout: 100,
	})
	await tick(250)
	assert.ok(host.logs.some((l) => l.message.includes('timed out')))
	const backoff = inst.subscriptionBackoff.get('t')
	assert.ok(backoff && Date.now() < backoff.notBefore, 'the feedback is in its back-off window')
	inst.checkFeedbacks()
	await settle(20)
	assert.equal(director.count('subscribe'), 1, 'back-off after the timeout')
	await inst.destroy()
})

test('connection loss resets state and the Connection OK feedback is re-checked', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('c', TRACK, 'object.lengthInBeats', 'len'),
		placed('ok', 'connectionState'),
	])
	await settle(50)
	assert.equal(host.variables.get('connection_status'), 'Connected')
	assert.equal(host.feedbackValues.get('ok'), true, 'the button shows the connection')
	director.sock!.drop()
	await settle(20)
	assert.equal(inst.isConnectionReady(), false)
	assert.equal(host.variables.get('connection_status'), 'Disconnected')
	assert.equal(host.feedbackValues.get('ok'), false, 'and shows it is gone')
	await inst.destroy()
})

test('one variable name may not watch two different properties', async () => {
	const director = new FakeDirector({ valueFor: (_o, p) => (p === 'object.brightness' ? 1 : 0.5) })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('t1', 'transportManager:default', 'object.brightness', 'myValue'),
		liveUpdateFeedback('t2', 'transportManager:default', 'object.volume', 'myValue'),
	])
	await settle(50)
	assert.equal(director.count('subscribe'), 1, 'the colliding second feedback never subscribes')
	assert.equal(director.subs[0].propertyPath, 'object.brightness')
	assert.equal(host.variables.get('myValue'), 1, 'the first feedback keeps the variable')
	assert.ok(
		host.logs.some((l) => l.level === 'warn' && l.message.includes('is already watching')),
		'the collision is reported',
	)
	await inst.destroy()
})

test('a shared subscription keeps the variable name of the feedback that created it', async () => {
	const director = new FakeDirector({ refCount: true, valueFor: () => 240 })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('first', TRACK, 'object.lengthInBeats', 'lenA'),
		liveUpdateFeedback('second', TRACK, 'object.lengthInBeats', 'lenB'),
	])
	await settle(50)
	assert.equal(director.count('subscribe'), 1)
	assert.equal(host.variables.get('lenA'), 240, 'the first name still receives values')
	assert.equal(inst.getSubscriptionByVariableName('lenA')?.propertyPath, 'object.lengthInBeats')
	assert.ok(
		host.logs.some((l) => l.level === 'warn' && l.message.includes("'lenA' will receive the values")),
		'the second feedback is told which name wins',
	)
	await inst.destroy()
})

test('a disconnect replaces every readout with OFFLINE and keeps the variable defined', async () => {
	const director = new FakeDirector({ valueFor: () => 0.42 })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('b', 'transportManager:default', 'object.brightness', 'brightness'),
	])
	await settle(50)
	assert.equal(host.variables.get('brightness'), 0.42)

	director.sock!.drop()
	await settle(50)
	assert.ok(host.definedVariables.has('brightness'), 'the variable stays defined while the feedback is placed')
	assert.equal(host.variables.get('brightness'), 'OFFLINE', 'the stale value is replaced')
	assert.equal(host.variables.get('connection_status'), 'Disconnected')
	await inst.destroy()
})

test('a shared subscription runs at the smallest interval any feedback asks for', async () => {
	const director = new FakeDirector({ refCount: true, valueFor: () => 1 })
	const slow = liveUpdateFeedback('slow', TRACK, 'object.lengthInBeats', 'len', 5000)
	const { inst } = await newInstance(director, [slow])
	await settle(50)
	assert.equal(director.subs[0].updateFrequencyMs, 5000)

	inst.updateFeedbacks({ fast: liveUpdateFeedback('fast', TRACK, 'object.lengthInBeats', 'len', 250) })
	await settle(50)
	assert.equal(director.count('unsubscribe'), 1, 'the slow subscription is released')
	assert.equal(director.subs.at(-1)?.updateFrequencyMs, 250, 'and asked again at the faster rate')
	await inst.destroy()
})

test('a Director subscription no feedback owns is released', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst } = await newInstance(director, [liveUpdateFeedback('a', TRACK, 'object.lengthInBeats', 'len')])
	await settle(50)
	const before = director.count('unsubscribe')

	// the Director reports a subscription the module never asked for
	director.announce([{ id: 999, objectPath: 'track:"Ghost"', propertyPath: 'object.name' }])
	await settle(50)
	assert.equal(director.count('unsubscribe'), before + 1, 'the unknown subscription is released')
	await inst.destroy()
})

test('an error that names no path fails the only request in flight', async () => {
	const director = new FakeDirector({ errorFor: () => "Unable to subscribe to object: Name 'Layer' not found" })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('e', 'track:"A".getLeafLayers(Layer)[0]', 'object.name', 'layerName'),
	])
	await settle(50)
	assert.equal(host.variables.get('layerName'), 'ERROR')
	await inst.destroy()
})

test('a nudge does not write before the first value has arrived', async () => {
	// the subscription is confirmed but the Director has not sent a value yet
	const director = new FakeDirector({ valueFor: () => undefined })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('n', 'transportManager:default', 'object.brightness', 'brightness'),
	])
	await settle(50)
	const actions = dist.getActionDefinitions(inst)
	const context = { parseVariablesInString: async (text: string) => text.replace('$(liveupdate:brightness)', '') }
	await actions.setToDisguiseNumber.callback(
		{ options: { variableName: 'brightness', value: '$(liveupdate:brightness)-0.05' } },
		context,
	)
	assert.equal(director.count('set'), 0, 'no absolute value is written')
	assert.ok(host.logs.some((l) => l.message.includes('has no numeric value yet')))
	await inst.destroy()
})

test('the nudge guard knows the connection by its own label and hyphenated names', async () => {
	// Companion rewrites the label of an imported preset: a second connection is liveupdate_2
	const director = new FakeDirector({ valueFor: () => undefined })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('n', 'transportManager:default', 'object.brightness', 'brightness'),
		liveUpdateFeedback('v', 'transportManager:default', 'object.volume', 'master-volume'),
	])
	inst.label = 'liveupdate_2'
	await settle(50)
	const actions = dist.getActionDefinitions(inst)
	// the host substitutes an empty string for a variable it has no value for
	const context = { parseVariablesInString: async (text: string) => text.replace(/\$\([^)]*\)/g, '') }
	for (const [variableName, value] of [
		['brightness', '$(liveupdate_2:brightness)-0.05'],
		['brightness', '$(liveupdate_2:brightness)+0.05'],
		['master-volume', '$(liveupdate_2:master-volume)-0.05'],
	]) {
		await actions.setToDisguiseNumber.callback({ options: { variableName, value } }, context)
	}
	assert.equal(director.count('set'), 0, 'no nudge is sent as an absolute value')
	assert.equal(host.logs.filter((l) => l.message.includes('has no numeric value yet')).length, 3)

	// a plain value needs no current value and is written
	await actions.setToDisguiseNumber.callback({ options: { variableName: 'brightness', value: '0.5' } }, context)
	assert.equal(director.count('set'), 1, 'a plain value is still written')
	await inst.destroy()
})

test('a variable name that is not a Companion variable id is refused', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('bad', TRACK, 'object.lengthInBeats', 'layer brightness'),
		liveUpdateFeedback('ok', TRACK, 'object.bpm', 'trackBpm'),
	])
	await settle(50)
	assert.equal(director.count('subscribe'), 1, 'only the valid one subscribes')
	assert.ok(host.logs.some((l) => l.message.includes('is not a valid Companion variable id')))
	await inst.destroy()
})

test('names 1.0.2 accepted still subscribe: hyphens and a leading digit', async () => {
	const director = new FakeDirector({ valueFor: () => 42 })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('h', TRACK, 'object.lengthInBeats', 'track-length'),
		liveUpdateFeedback('d', TRACK, 'object.bpm', '1stTrackBpm'),
	])
	await settle(50)
	assert.equal(director.subscribedProperties(), 2)
	assert.equal(host.variables.get('track-length'), 42)
	assert.equal(host.variables.get('1stTrackBpm'), 42)
	await inst.destroy()
})

test('setSelection treats an unresolved variable as a clear', async () => {
	const director = new FakeDirector()
	const { inst, host } = await newInstance(director)
	inst.setSelection('selLayerIndex', '3')
	assert.equal(host.variables.get('selLayerIndex'), '3')
	inst.setSelection('selLayerIndex', '$NA')
	assert.equal(host.variables.get('selLayerIndex'), '$NA', 'the numeric selection is cleared, not kept')
	await inst.destroy()
})

test('the selection lists are read from the Director and released again', async () => {
	const director = new FakeDirector({
		valueFor: (objectPath, propertyPath) => {
			if (propertyPath.includes('allResources(Track)')) return ['demo', 'Show Track']
			if (propertyPath.includes('allResources(Screen2)') && !propertyPath.includes('uid')) return ['surface 1']
			return []
		},
	})
	const { inst, host } = await newInstance(director)
	await settle(50)
	await inst.refreshDiscovery()
	await settle(80)

	assert.deepEqual(inst.discoveryChoices.get('selTrack'), ['demo', 'Show Track'])
	assert.deepEqual(inst.discoveryChoices.get('selScreen'), ['surface 1'])
	assert.equal(director.subs.length, 0, 'every probe released its subscription')

	// the action now offers the real names
	const actions = dist.getActionDefinitions(inst)
	const option = actions.setSelection_selTrack.options[0]
	assert.equal(option.type, 'dropdown')
	assert.deepEqual(
		option.choices.map((c: { id: string }) => c.id),
		['demo', 'Show Track'],
	)
	assert.equal(option.allowCustom, true, 'a name can still be typed')
	assert.ok(host.logs.some((l) => l.message.includes('Selection lists refreshed')))
	await inst.destroy()
})

test('a selection profile applies several selections at once', async () => {
	const director = new FakeDirector()
	// selections that are already set, so leaving them alone can be told apart from clearing them
	const { inst, host } = await newInstance(director, [], { selLayer: 'Video 1', selProjector: 'Projector 1' })
	const actions = dist.getActionDefinitions(inst)
	const context = { parseVariablesInString: async (text: string) => text }
	await actions.setSelectionProfile.callback(
		{ options: { selTrack: 'demo', selScreen: 'surface 1', selLayer: '', selProjector: '   ' } },
		context,
	)
	assert.equal(host.variables.get('selTrack'), 'demo')
	assert.equal(host.variables.get('selScreen'), 'surface 1')
	assert.equal(host.variables.get('selLayer'), 'Video 1', 'an empty field leaves the selection alone')
	assert.equal(host.variables.get('selProjector'), 'Projector 1', 'so does a field of spaces')
	assert.equal(inst.config.selLayer, 'Video 1')
	assert.ok(
		host.savedConfigs.every((config: any) => config.selLayer === 'Video 1' && config.selProjector === 'Projector 1'),
		'no saved config clears them',
	)
	await inst.destroy()
})

test('a burst of writes to one property is collapsed to the last value', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst } = await newInstance(director, [liveUpdateFeedback('w', TRACK, 'object.tc_adjust', 'tcAdjust')])
	await settle(50)
	const id = director.subs[0].id

	// a rotary spin: one action per detent, faster than the coalescing window
	for (const value of [1, 2, 3, 4, 5]) inst.setProperty(id, value)
	// past the 40 ms coalescing window
	await tick(100)
	await settle()

	const sets = director.received.filter((m: { set?: unknown }) => m.set) as { set: { id: number; value: number }[] }[]
	assert.equal(sets.length, 2, 'the first value goes out at once and the rest collapse into one')
	assert.equal(sets[0].set[0].value, 1, 'a single press is never delayed')
	assert.equal(sets[1].set[0].value, 5, 'and the value the operator stopped on is the one that sticks')
	await inst.destroy()
})

test('the preset check reads every resolvable pair and releases it again', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst, host } = await newInstance(director, [], { selTrack: 'demo' })
	await settle(50)
	await inst.runSelfCheck()
	await settle(50)

	assert.equal(director.subs.length, 0, 'the check leaves no subscription behind')
	assert.ok(Number(host.variables.get('selfcheck_ok')) > 0, 'properties answered')
	assert.ok(host.logs.some((l) => l.message.includes('Preset check:')))
	await inst.destroy()
})

/** Distinct (object, property) pairs of the catalog with every selection filled or left empty */
function catalogPairs(selections: Record<string, string>): { checkable: number; needSelection: number } {
	const substitute = (text: string): string =>
		text.replace(/\$\(liveupdate:(sel[A-Za-z0-9_]+)\)/g, (m: string, id: string) => selections[id] ?? m)
	const checkable = new Set<string>()
	const needSelection = new Set<string>()
	for (const entry of dist.PRESET_CATALOG) {
		if (!entry.objectPath || !entry.propertyPath) continue // module-native
		if (/<[A-Z]/.test(entry.objectPath + entry.propertyPath)) continue // templates
		const key = `${substitute(entry.objectPath)}\n${substitute(entry.propertyPath)}`
		if (key.includes('$(liveupdate:sel')) needSelection.add(key)
		else checkable.add(key)
	}
	return { checkable: checkable.size, needSelection: needSelection.size }
}

test('the preset check counts distinct properties and skips only what an empty selection blocks', async () => {
	const examples: Record<string, string> = {}
	for (const selection of dist.SELECTIONS) examples[selection.id] = selection.example

	// every selection filled: nothing is skipped, whatever the rows that share a property
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst, host } = await newInstance(director, [], examples)
	await inst.runSelfCheck()
	const filled = catalogPairs(examples)
	assert.equal(host.variables.get('selfcheck_skipped'), '0')
	assert.equal(
		Number(host.variables.get('selfcheck_ok')) + Number(host.variables.get('selfcheck_failed')),
		filled.checkable,
	)
	assert.equal(host.variables.get('selfcheck_progress'), `${filled.checkable}/${filled.checkable}`)
	assert.ok(host.logs.some((l) => l.message.includes('rows that share a property')))
	await inst.destroy()

	// no selection filled: every property that needs one is skipped, once per property
	const director2 = new FakeDirector({ valueFor: () => 1 })
	const second = await newInstance(director2)
	await second.inst.runSelfCheck()
	const empty = catalogPairs({})
	assert.equal(second.host.variables.get('selfcheck_skipped'), String(empty.needSelection))
	assert.equal(second.host.variables.get('selfcheck_failed'), '0')
	await second.inst.destroy()
})

test('properties of one object asked for together leave as one frame', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst } = await newInstance(director, [
		liveUpdateFeedback('a', 'transportManager:default', 'object.brightness', 'brightness'),
		liveUpdateFeedback('b', 'transportManager:default', 'object.volume', 'volume'),
		liveUpdateFeedback('c', 'transportManager:default', 'object.engaged', 'engaged'),
		liveUpdateFeedback('d', TRACK, 'object.lengthInBeats', 'len'),
	])
	await settle(80)
	assert.equal(director.count('subscribe'), 2, 'one frame per object, not one per property')
	assert.equal(director.subscribedProperties(), 4, 'and every property was still asked for')
	assert.equal(director.subs.length, 4, 'the Director holds one subscription per property')
	await inst.destroy()
})

test('clearing a selection leaves UNSET on the button, not the previous object value', async () => {
	const director = new FakeDirector({ refCount: true, valueFor: () => 240 })
	const fb = liveUpdateFeedback('s', TRACK, 'object.lengthInBeats', 'trackLengthBeats')
	const { inst, host } = await newInstance(director, [fb, compareFeedback('cmp', 'trackLengthBeats', 'gt', '100')])
	await settle(50)
	assert.equal(host.variables.get('trackLengthBeats'), 240)
	assert.equal(host.feedbackValues.get('cmp'), true)

	// what the host produces for track:"$(liveupdate:selTrack)" once the selection is cleared
	inst.updateFeedbacks({ s: { ...fb, options: { ...fb.options, objectPath: 'track:"$NA"' } } })
	await settle(50)
	assert.equal(director.subs.length, 0, 'the old subscription is released')
	assert.equal(host.variables.get('trackLengthBeats'), 'UNSET')
	assert.equal(host.feedbackValues.get('cmp'), false, 'no state colour for a value that is not known')

	// an empty object path is refused the same way
	inst.updateFeedbacks({ s: { ...fb, options: { ...fb.options, objectPath: '' } } })
	await settle(50)
	assert.equal(host.variables.get('trackLengthBeats'), 'UNSET')
	await inst.destroy()
})

test('a readout another feedback still feeds keeps its value when one of them loses its path', async () => {
	const director = new FakeDirector({ refCount: true, valueFor: () => 240 })
	const a = liveUpdateFeedback('a', TRACK, 'object.lengthInBeats', 'trackLengthBeats')
	const b = liveUpdateFeedback('b', TRACK, 'object.lengthInBeats', 'trackLengthBeats')
	const { inst, host } = await newInstance(director, [a, b])
	await settle(50)
	inst.updateFeedbacks({ a: { ...a, options: { ...a.options, objectPath: 'track:"$NA"' } } })
	await settle(50)
	assert.equal(director.refs(TRACK, 'object.lengthInBeats'), 1, 'b still holds the subscription')
	assert.equal(host.variables.get('trackLengthBeats'), 240, 'and the variable is not blanked')
	await inst.destroy()
})

test('a path the Director can evaluate is sent even when it holds an empty string or an empty list', async () => {
	// a LiveUpdate Variable saved with 1.0.2, which sent every path as it was
	const director = new FakeDirector({ valueFor: () => 'Track1' })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('t', 'track:track_1', 'object.description.replace(" ", "")', 'trackname'),
		liveUpdateFeedback('l', 'track:track_1', 'len(object.layers or [])', 'layerCount'),
	])
	await settle(50)
	assert.equal(director.subscribedProperties(), 2)
	assert.equal(host.variables.get('trackname'), 'Track1')
	await inst.destroy()
})

test('the preset check reads a property a button holds from the button, without a second reference', async () => {
	const director = new FakeDirector({ refCount: true, valueFor: () => 0.5 })
	const button = liveUpdateFeedback('b', 'transportManager:default', 'object.brightness', 'brightness', 1000)
	const { inst, host } = await newInstance(director, [button], { selTrack: 'demo' })
	await settle(50)
	await inst.runSelfCheck()
	await settle(50)
	assert.equal(host.variables.get('selfcheck_failed'), '0', 'the property on the button is not reported as failed')
	assert.equal(director.refs('transportManager:default', 'object.brightness'), 1, 'only the button holds it')
	assert.equal(director.subs.length, 1, 'nothing else is left behind')
	director.pushValueForPair('transportManager:default', 'object.brightness', 0.7)
	await settle()
	assert.equal(host.variables.get('brightness'), 0.7, 'the button still updates')
	await inst.destroy()
})

test('the Designer version and the selection lists are read from buttons that hold the same pairs', async () => {
	const director = new FakeDirector({
		refCount: true,
		valueFor: (_o, p) =>
			p === '[l.name for l in object.layers]' ? ['Video 1', 'RS'] : p === 'object.remoteNodes()' ? ['ACTOR01:d3'] : [],
	})
	const { inst, host } = await newInstance(
		director,
		[
			liveUpdateFeedback('v', 'subsystem:MonitoringManager', 'ReleaseVersion.versionString()', 'designerVersion', 5000),
			liveUpdateFeedback('l', 'track:"demo"', '[l.name for l in object.layers]', 'layerNames', 5000),
			liveUpdateFeedback('r', 'subsystem:MonitoringManager', 'object.remoteNodes()', 'remoteNodes', 5000),
		],
		{ selTrack: 'demo', discoverOnConnect: true },
	)
	assert.ok(await until(() => host.logs.some((l) => l.message.includes('Selection lists refreshed'))))
	await settle(50)
	assert.equal(host.variables.get('designer_version'), 'r34.0.3')
	assert.equal(host.variables.get('designerVersion'), 'r34.0.3', 'the button has it too')
	assert.deepEqual(inst.discoveryChoices.get('selLayer'), ['Video 1', 'RS'])
	assert.deepEqual(inst.discoveryChoices.get('selLayerIndex'), ['0', '1'])
	assert.deepEqual(inst.discoveryChoices.get('selHost'), ['ACTOR01'])
	assert.equal(director.refs('subsystem:MonitoringManager', 'ReleaseVersion.versionString()'), 1)
	assert.equal(director.refs('track:"demo"', '[l.name for l in object.layers]'), 1)
	assert.equal(director.refs('subsystem:MonitoringManager', 'object.remoteNodes()'), 1)
	assert.equal(director.subs.length, 3, 'the reads left only the buttons behind')

	director.pushValueForPair('track:"demo"', '[l.name for l in object.layers]', ['Video 2'])
	await settle()
	assert.equal(host.variables.get('layerNames'), '["Video 2"]', 'the button still updates')
	await inst.destroy()
})

test('a button placed while a one-shot read holds its pair waits for it and keeps one reference', async () => {
	const director = new FakeDirector({ refCount: true, valueFor: () => 3 })
	const { inst, host } = await newInstance(director)
	const read = inst.probeValue(TRACK, 'object.lengthInBeats', 3000)
	inst.updateFeedbacks({ a: liveUpdateFeedback('a', TRACK, 'object.lengthInBeats', 'len') })
	assert.equal(await read, 3, 'the read gets its value')
	await settle(50)
	assert.equal(host.variables.get('len'), 3, 'and so does the button')
	assert.equal(director.refs(TRACK, 'object.lengthInBeats'), 1)
	director.pushValueForPair(TRACK, 'object.lengthInBeats', 4)
	await settle()
	assert.equal(host.variables.get('len'), 4)
	inst.updateFeedbacks({ a: null })
	await settle(50)
	assert.equal(director.subs.length, 0, 'removing the button leaves nothing behind')
	await inst.destroy()
})

test('a refused one-shot read is never blamed on a button request in flight', async () => {
	const forms = [
		(o: string, p: string) => `Unable to subscribe to ${o} / ${p} - Name 'Missing' not found`,
		() => "Unable to subscribe to object: Name 'Missing' not found",
	]
	for (const form of forms) {
		const director = new FakeDirector({
			errorFor: (o, p) => (o === 'track:"Missing"' ? form(o, p) : null),
			valueFor: () => 240,
		})
		const { inst, host } = await newInstance(director)
		const started = Date.now()
		const read = inst.probeValue('track:"Missing"', '[l.name for l in object.layers]', 3000)
		// a button is placed while the read is in flight; its request is the only feedback request
		inst.updateFeedbacks({ good: liveUpdateFeedback('good', 'track:"Good"', 'object.lengthInBeats', 'goodLen') })
		assert.equal(await read, undefined)
		assert.ok(Date.now() - started < 1000, 'the read ends with the error, not with its timeout')
		await settle(50)
		assert.equal(host.variables.get('goodLen'), 240, 'the button is not failed')
		assert.ok(!host.logs.some((l) => l.message.includes('Attributing the error to the only request in flight')))
		assert.ok(!host.logs.some((l) => l.message.includes('that no feedback owns')))
		await inst.destroy()
	}
})

test('a path changed while its first request is in flight subscribes the new path', async () => {
	const director = new FakeDirector({
		errorFor: (o, p) =>
			o === 'track:"Track 2"' ? `Unable to subscribe to ${o} / ${p} - Name 'Track 2' not found` : null,
		valueFor: (o) => (o === 'track:"Track 3"' ? 3 : 1),
	})
	const other = liveUpdateFeedback('other', 'transportManager:default', 'object.player.tRender', 'playhead')
	const { inst, host } = await newInstance(director, [other])
	await settle(50)

	director.hold()
	const f = liveUpdateFeedback('f', 'track:"Track 2"', 'object.lengthInBeats', 'len')
	inst.updateFeedbacks({ f })
	await settle()
	// the variable it uses changes again before the Director has answered
	inst.updateFeedbacks({ f: { ...f, options: { ...f.options, objectPath: 'track:"Track 3"' } } })
	await settle()
	director.release()
	await settle(50)

	assert.ok(!host.logs.some((l) => l.message.includes('is already watching')), 'not refused as a name clash')
	assert.ok(
		director.subs.some((s) => s.objectPath === 'track:"Track 3"'),
		'the new path is subscribed',
	)
	assert.equal(host.variables.get('len'), 3)
	await inst.destroy()
})

test('0 (as fast as possible) wins the shared interval', async () => {
	const director = new FakeDirector({ refCount: true, valueFor: () => 1 })
	const { inst } = await newInstance(director, [
		liveUpdateFeedback('zero', 'transportManager:default', 'object.player.tRender', 'playhead', 0),
	])
	await settle(50)
	inst.updateFeedbacks({
		slow: liveUpdateFeedback('slow', 'transportManager:default', 'object.player.tRender', 'playhead', 1000),
	})
	await settle(50)
	assert.equal(director.count('unsubscribe'), 0, 'the real-time subscription is kept')
	assert.equal(director.subs.length, 1)
	assert.equal(director.subs[0].updateFrequencyMs, undefined, 'at the Director default')
	await inst.destroy()
})

test('feedbacks placed together subscribe once at the fastest interval any of them asks for', async () => {
	const director = new FakeDirector({ refCount: true, valueFor: () => 1 })
	const { inst } = await newInstance(director, [
		liveUpdateFeedback('slow', TRACK, 'object.tStart', 'tStart', 1000),
		liveUpdateFeedback('fast', TRACK, 'object.tStart', 'tStart', 100),
	])
	await settle(50)
	assert.equal(director.count('subscribe'), 1)
	assert.equal(director.subs[0].updateFrequencyMs, 100, 'the frame carries the fastest interval')
	assert.equal(inst.getSubscriptionByVariableName('tStart').updateFrequencyMs, 100, 'the record is what was sent')
	await inst.destroy()
})

test('a faster feedback that joins a request in flight gets its rate', async () => {
	const director = new FakeDirector({ refCount: true, valueFor: () => 1 })
	const { inst, host } = await newInstance(director)
	director.hold()
	inst.updateFeedbacks({ slow: liveUpdateFeedback('slow', TRACK, 'object.tStart', 'tStart', 5000) })
	await settle()
	inst.updateFeedbacks({ fast: liveUpdateFeedback('fast', TRACK, 'object.tStart', 'tStart', 250) })
	await settle()
	director.release()
	await settle(50)
	assert.deepEqual(
		director.subs.map((s) => s.updateFrequencyMs),
		[250],
		'the Director runs the pair at the faster rate',
	)
	assert.equal(inst.getSubscriptionByVariableName('tStart').updateFrequencyMs, 250)
	assert.equal(host.variables.get('tStart'), 1)
	await inst.destroy()
})

test('an outage turns every state colour off and no readout stays OFFLINE once the Director is back', async () => {
	const director = new FakeDirector({ valueFor: (_o, p) => (p === 'object.player.playing' ? true : 1) })
	const { inst, host } = await newInstance(
		director,
		[
			liveUpdateFeedback('p', 'transportManager:default', 'object.player.playing', 'isPlaying'),
			compareFeedback('eq', 'isPlaying', 'eq', 'true'),
			compareFeedback('ne', 'isPlaying', 'ne', 'false'),
			placed('ok', 'connectionState'),
			liveUpdateFeedback('u', 'track:"$NA"', 'object.lengthInBeats', 'len'),
			// joins the same pair under another name, so it is never fed a value of its own
			liveUpdateFeedback('second', 'transportManager:default', 'object.player.playing', 'playingToo'),
		],
		{ reconnectInterval: 100 },
	)
	await settle(50)
	assert.equal(host.feedbackValues.get('eq'), true)
	assert.equal(host.feedbackValues.get('ne'), true)
	assert.equal(host.variables.get('len'), 'UNSET')

	director.sock!.drop()
	await settle(20)
	assert.equal(host.variables.get('isPlaying'), 'OFFLINE')
	assert.equal(host.variables.get('len'), 'OFFLINE')
	assert.equal(host.feedbackValues.get('eq'), false, 'no state colour without a Director')
	assert.equal(host.feedbackValues.get('ne'), false, 'not even for "not equal"')
	assert.equal(host.feedbackValues.get('ok'), false)

	// the module reconnects on its own
	assert.ok(await until(() => inst.isConnectionReady()))
	await settle(50)
	assert.equal(host.variables.get('isPlaying'), true)
	assert.equal(host.feedbackValues.get('eq'), true)
	assert.equal(host.feedbackValues.get('ok'), true)
	assert.equal(host.variables.get('len'), 'UNSET', 'an unresolved path says so, not OFFLINE')
	assert.notEqual(host.variables.get('playingToo'), 'OFFLINE')
	await inst.destroy()
})

test('an outage never writes OFFLINE into a selection or a module variable', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst, host } = await newInstance(
		director,
		[
			liveUpdateFeedback('bad', TRACK, 'object.description', 'selTrack'),
			liveUpdateFeedback('bad2', TRACK, 'object.name', 'connection_status'),
			liveUpdateFeedback('ok', TRACK, 'object.lengthInBeats', 'len'),
		],
		{ selTrack: 'Track 1', reconnectInterval: 100 },
	)
	await settle(50)
	director.sock!.drop()
	await settle(20)
	assert.equal(host.variables.get('selTrack'), 'Track 1')
	assert.equal(host.variables.get('connection_status'), 'Disconnected')
	assert.equal(host.variables.get('len'), 'OFFLINE')
	assert.ok(await until(() => inst.isConnectionReady()))
	await settle(50)
	assert.equal(host.variables.get('selTrack'), 'Track 1', 'the selection survives the outage')
	assert.equal(host.variables.get('len'), 1)
	await inst.destroy()
})

test('saving the settings while the Director is away keeps OFFLINE on the readouts', async () => {
	const director = new FakeDirector({ valueFor: () => 0.42 })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('b', 'transportManager:default', 'object.brightness', 'brightness'),
	])
	await settle(50)
	director.sock!.drop()
	await settle(20)
	assert.equal(host.variables.get('brightness'), 'OFFLINE')

	// the Director is switched off; the operator edits a selection in the connection settings
	useDirector(new FakeDirector({ unreachable: true }))
	await inst.configUpdated({ ...inst.config, selTrack: 'Track 2' })
	await settle(20)
	assert.ok(host.definedVariables.has('brightness'), 'the readout stays defined')
	assert.equal(host.variables.get('brightness'), 'OFFLINE', 'and keeps saying OFFLINE')
	await inst.destroy()
})

test('pointing the connection at another Director replaces the old values with OFFLINE', async () => {
	const director = new FakeDirector({ valueFor: () => 0.42 })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('b', 'transportManager:default', 'object.brightness', 'brightness'),
		compareFeedback('cmp', 'brightness', 'gt', '0.1'),
	])
	await settle(50)
	assert.equal(host.variables.get('brightness'), 0.42)
	assert.equal(host.feedbackValues.get('cmp'), true)
	useDirector(new FakeDirector({ unreachable: true }))
	await inst.configUpdated({ ...inst.config, host: '127.0.0.2' })
	await settle(20)
	assert.equal(host.variables.get('brightness'), 'OFFLINE', 'not the old Director value')
	assert.equal(host.feedbackValues.get('cmp'), false)
	await inst.destroy()
})

test('the Designer version is read on every connection and a different major is reported', async () => {
	for (const [version, warns] of [
		['r33.1.2', true],
		['r34.0.3', false],
	] as const) {
		const director = new FakeDirector({ version })
		const { inst, host } = await newInstance(director, [], { discoverOnConnect: false })
		await settle(50)
		assert.equal(host.variables.get('designer_version'), version, 'read even with the selection lists off')
		assert.equal(
			host.logs.some((l) => l.level === 'warn' && l.message.includes('verified on r34')),
			warns,
			`${version}: the warning is ${warns ? 'expected' : 'not expected'}`,
		)
		assert.equal(director.subs.length, 0, 'the read left nothing behind')
		await inst.destroy()
	}
})

test('confirmations re-run only the feedbacks they concern, and unchanged definitions are not sent again', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst, host } = await newInstance(director, [], { reconnectInterval: 100 })
	const definition = host.feedbackDefinitions.liveUpdateVariable
	const original = definition.callback
	let calls = 0
	definition.callback = async (feedback: unknown, context: unknown) => {
		calls++
		return original(feedback, context)
	}
	const feedbacks = Array.from({ length: 30 }, (_, i) =>
		liveUpdateFeedback(`fb${i}`, `track:"Track ${i}"`, 'object.lengthInBeats', `len${i}`),
	)
	const pushesBefore = host.variableDefinitionCalls
	const update: Record<string, FeedbackInstance> = {}
	for (const feedback of feedbacks) update[feedback.id] = feedback
	inst.updateFeedbacks(update)
	await settle(100)
	for (let i = 0; i < feedbacks.length; i++) assert.equal(host.variables.get(`len${i}`), 1)
	assert.ok(calls <= 3 * feedbacks.length, `${calls} callback runs for ${feedbacks.length} feedbacks`)
	const pushes = host.variableDefinitionCalls - pushesBefore
	assert.ok(pushes <= feedbacks.length, `${pushes} definition pushes for ${feedbacks.length} new variables`)

	// an outage and a reconnect change no definition
	const pushesConnected = host.variableDefinitionCalls
	director.sock!.drop()
	assert.ok(await until(() => inst.isConnectionReady()))
	await settle(100)
	assert.equal(host.variables.get('len0'), 1)
	assert.equal(host.variableDefinitionCalls, pushesConnected)
	await inst.destroy()
})

test('a back-off retry fires even when the clock says it is a little early', async () => {
	let attempts = 0
	const director = new FakeDirector({
		errorFor: (o, p) => (++attempts === 1 ? `Unable to subscribe to ${o} / ${p} - not there yet` : null),
		valueFor: () => 5,
	})
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('e', 'track:"Late"', 'object.lengthInBeats', 'len'),
	])
	await settle(50)
	assert.equal(host.variables.get('len'), 'ERROR')
	// the timer can fire a millisecond before Date.now() reaches notBefore, and the wall clock can
	// step back: either way the gate is still closed when the timer fires
	inst.subscriptionBackoff.get('e').notBefore += 60000
	await tick(2300)
	await settle(50)
	assert.equal(director.count('subscribe'), 2, 'the timer retried')
	assert.equal(host.variables.get('len'), 5)
	await inst.destroy()
})

test('a selection list is replaced by an answer, even an empty one, and kept when the read fails', async () => {
	let layers: unknown = ['Video 1', 'RS']
	const isLayers = (p: string): boolean => p === '[l.name for l in object.layers]'
	// every other list answers empty, so no read waits out its timeout
	const director = new FakeDirector({
		valueFor: (_o, p) => (isLayers(p) ? layers : []),
		errorValueFor: (_o, p) => (isLayers(p) && layers === 'fail' ? { errorType: 'X', message: 'x' } : undefined),
	})
	const { inst } = await newInstance(director, [], { selTrack: 'demo' })
	await inst.refreshDiscovery()
	assert.deepEqual(inst.discoveryChoices.get('selLayer'), ['Video 1', 'RS'])

	layers = 'fail'
	await inst.refreshDiscovery()
	assert.deepEqual(inst.discoveryChoices.get('selLayer'), ['Video 1', 'RS'], 'a failed read keeps the list')

	layers = []
	await inst.refreshDiscovery()
	assert.equal(inst.discoveryChoices.has('selLayer'), false, 'an empty answer replaces it')
	assert.equal(dist.getActionDefinitions(inst).setSelection_selLayer.options[0].type, 'textinput')
	await inst.destroy()
})

test('a property error leaves no state colour, and the error is not kept as the value', async () => {
	const director = new FakeDirector({ valueFor: () => [] })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('m', 'subsystem:D3NetManagerSystem', 'object.offline', 'offlineMachines'),
		compareFeedback('alarm', 'offlineMachines', 'ne', '[]'),
	])
	await settle(50)
	assert.equal(host.feedbackValues.get('alarm'), false)
	director.pushValueForPair('subsystem:D3NetManagerSystem', 'object.offline', {
		errorType: 'propertyPathError',
		message: 'x',
	})
	await settle()
	assert.equal(host.variables.get('offlineMachines'), 'PATH_ERROR')
	assert.equal(host.feedbackValues.get('alarm'), false, 'a path error does not light the alarm')
	assert.equal(inst.getSubscriptionByVariableName('offlineMachines').value, undefined)
	await inst.destroy()
})

test('an arm belongs to the button that armed it and does not outlive its permission or its Director', async () => {
	const received: string[] = []
	const server = createServer((req, res) => {
		received.push(req.url ?? '')
		req.resume()
		req.on('end', () => {
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ status: { code: 0, message: '', details: [] } }))
		})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = (server.address() as AddressInfo).port
	try {
		const director = new FakeDirector()
		const { inst, host } = await newInstance(
			director,
			[placed('fa', 'restArmed', {}, 'btnA'), placed('fb', 'restArmed', {}, 'btnB')],
			{ host: '127.0.0.1', port, restAllowDestructive: true, restArmSeconds: 60 },
		)
		const pressA = async () =>
			inst.runRestCommand('failoverMachine', { machine: { name: 'M1' } }, 'fail over M1', 'btnA')
		const pressB = async () => inst.runRestCommand('restoreMachine', { machine: { name: 'M2' } }, 'restore M2', 'btnB')

		await pressA()
		await settle()
		assert.equal(host.feedbackValues.get('fa'), true, 'the pressed button shows its arm')
		assert.equal(host.feedbackValues.get('fb'), false, 'the other button does not')

		await pressB()
		await settle()
		assert.equal(host.variables.get('rest_armed'), 'restore M2', 'rest_armed names the latest arm')
		await pressA()
		await settle()
		assert.equal(received.length, 1, 'the confirming press on A fired')
		assert.equal(host.variables.get('rest_armed'), 'restore M2', 'B is still armed')
		assert.equal(host.feedbackValues.get('fa'), false)
		assert.equal(host.feedbackValues.get('fb'), true)

		// the permission is withdrawn and given again: B has to be armed afresh
		await inst.configUpdated({ ...inst.config, restAllowDestructive: false })
		await settle()
		assert.equal(host.variables.get('rest_armed'), '')
		assert.equal(host.feedbackValues.get('fb'), false)
		await inst.configUpdated({ ...inst.config, restAllowDestructive: true })
		await pressB()
		await settle()
		assert.equal(received.length, 1, 'one press after the permission came back only arms')

		// the connection moves to another Director: the arm does not follow it
		await inst.configUpdated({ ...inst.config, port: port + 1 })
		await settle()
		assert.equal(inst.isRestArmed(), false)
		assert.equal(host.variables.get('rest_armed'), '')
		await inst.destroy()
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
})

test('after a reconnect a second button at the same interval joins the subscription instead of replacing it', async () => {
	const director = new FakeDirector({ refCount: true, valueFor: () => 0.5 })
	const pair = ['transportManager:default', 'object.brightness'] as const
	const { inst, host } = await newInstance(director, [liveUpdateFeedback('a', ...pair, 'brightness', 500)], {
		reconnectInterval: 100,
	})
	await settle(50)
	director.sock!.drop()
	assert.ok(await until(() => inst.isConnectionReady()))
	await settle(50)
	assert.equal(inst.getSubscriptionByVariableName('brightness').updateFrequencyMs, 500, 'the record survives')
	const unsubscribes = director.count('unsubscribe')
	inst.updateFeedbacks({ b: liveUpdateFeedback('b', ...pair, 'brightness', 500) })
	await settle(50)
	assert.equal(director.count('unsubscribe'), unsubscribes, 'the running subscription is not released')
	assert.equal(director.refs(...pair), 1)
	assert.equal(host.variables.get('brightness'), 0.5)
	await inst.destroy()
})
