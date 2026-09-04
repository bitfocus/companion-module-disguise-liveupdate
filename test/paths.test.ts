import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadDist } from './harness'

const dist = loadDist()

test('isUnresolvedPath refuses placeholders, unresolved variables and empty slots', () => {
	const unresolved = [
		'',
		'   ',
		'<OBJECT_PATH>',
		'object.<PROPERTY_PATH>',
		'track:"<TRACK_NAME>"',
		'track:"$NA"',
		'getByUID($NA)',
		'track:"$(custom:show_track)"',
		'track:""',
		"track:''",
		'object.getWorkloadInstance(, )',
		'object.getWorkloadInstance(1234, )',
		'object.getWorkloadInstance(, 0)',
		'object.container.variables[].defaultFloat',
		'subsystem:MonitoringManager.findRemoteMonitor(":d3", "fps")',
	]
	for (const path of unresolved) assert.equal(dist.isUnresolvedPath(path), true, `should be unresolved: ${path}`)

	const resolved = [
		'track:"Track 1"',
		'track:"Track 1".findLayerByName("Video 1")',
		'transportManager:default',
		'subsystem:MonitoringManager.findLocalMonitor("fps")',
		'subsystem:MonitoringManager.findRemoteMonitor("ACTOR01:d3", "fps")',
		'getByUID(0x0123456789abcdef)',
		'object.nSections()',
		'object.hasTakenOverFailedMachine()',
		'object.seriesAverage("Actual", 1)',
		'object.getWorkloadInstance(1234, 0).health()',
		'object.container.variables[3].defaultFloat',
		'[l.name for l in object.layers]',
		'object.sectionInfo(2).tStart',
	]
	for (const path of resolved) assert.equal(dist.isUnresolvedPath(path), false, `should be resolved: ${path}`)
})

test('validateSelection enforces the kind of each selection', () => {
	const ok = (id: string, value: string) =>
		assert.equal(dist.validateSelection(id, value), undefined, `${id} should accept ${JSON.stringify(value)}`)
	const bad = (id: string, value: string) =>
		assert.equal(typeof dist.validateSelection(id, value), 'string', `${id} should reject ${JSON.stringify(value)}`)

	ok('selTrack', 'Track 1')
	ok('selTrack', "O'Neil / Act 2")
	ok('selTrack', '')
	bad('selTrack', 'Track "1"')
	bad('selTrack', 'Track\\1')
	bad('selTrack', 'Track\n1')

	ok('selHost', 'ACTOR01')
	ok('selHost', 'render-node.local')
	bad('selHost', 'ACTOR01:d3')
	bad('selHost', 'a b')

	ok('selLayerIndex', '0')
	ok('selLayerIndex', '10')
	bad('selLayerIndex', '010')
	bad('selLayerIndex', '-1')
	bad('selLayerIndex', '1.5')
	bad('selLayerIndex', '1) or __import__("os")')

	ok('selBeat', '32')
	ok('selBeat', '-1.5')
	bad('selBeat', '1e3')
	bad('selBeat', 'abc')

	ok('selWorkload', '1234')
	ok('selWorkload', '0x1F')
	ok('selEvUid', '0x0123456789abcdef')
	bad('selEvUid', '0x')
	bad('selEvUid', 'abc')

	assert.equal(typeof dist.validateSelection('selNope', 'x'), 'string')
})

test('readSelections trims, validates and publishes $NA for unset values', () => {
	const invalid: string[] = []
	const values = dist.readSelections(
		{ selTrack: '  Track 1  ', selLayerIndex: '010', selBeat: 32, selHost: undefined },
		(id) => invalid.push(id),
	)
	assert.equal(values.selTrack, 'Track 1')
	assert.equal(values.selLayerIndex, '$NA')
	assert.equal(values.selBeat, '32')
	assert.equal(values.selHost, '$NA')
	assert.equal(values.selScreen, '$NA')
	assert.deepEqual(invalid, ['selLayerIndex'])
	for (const selection of dist.SELECTIONS) assert.ok(selection.id in values, `missing ${selection.id}`)
})

test('compareValues handles numbers, booleans, strings, objects and missing values', () => {
	const c = dist.compareValues
	assert.equal(c(60, 'eq', '60'), true)
	assert.equal(c('60', 'eq', '60.0'), true)
	assert.equal(c(49.5, 'lt', '50'), true)
	assert.equal(c(50, 'lt', '50'), false)
	assert.equal(c(50, 'le', '50'), true)
	assert.equal(c(17.2, 'ge', '17'), true)
	assert.equal(c(3, 'ne', '4'), true)
	assert.equal(c('Play', 'eq', 'Play'), true)
	assert.equal(c('Play', 'eq', 'Stop'), false)
	assert.equal(c(true, 'eq', 'true'), true)
	assert.equal(c(false, 'eq', 'true'), false)
	assert.equal(c(false, 'ne', 'true'), true)
	assert.equal(c('abc', 'lt', '5'), false)
	assert.equal(c(undefined, 'eq', ''), false)
	assert.equal(c(null, 'ne', 'x'), false)
	assert.equal(c({ status: 2, message: 'ok' }, 'contains', '"status":2'), true)
	assert.equal(c(['a', 'b'], 'contains', 'b'), true)

	assert.equal(c(true, 'truthy', ''), true)
	assert.equal(c(false, 'truthy', ''), false)
	assert.equal(c(0, 'truthy', ''), false)
	assert.equal(c(2, 'truthy', ''), true)
	assert.equal(c('False', 'truthy', ''), false)
	assert.equal(c('', 'truthy', ''), false)
	assert.equal(c('Track 1', 'truthy', ''), true)
	assert.equal(c([], 'truthy', ''), false)
	assert.equal(c([1], 'truthy', ''), true)
	assert.equal(c(undefined, 'truthy', ''), false)
})

test('readBooleanValue accepts real booleans, True/False strings and 0/1', () => {
	assert.equal(dist.readBooleanValue(true), true)
	assert.equal(dist.readBooleanValue(false), false)
	assert.equal(dist.readBooleanValue('True'), true)
	assert.equal(dist.readBooleanValue('false'), false)
	assert.equal(dist.readBooleanValue(1), true)
	assert.equal(dist.readBooleanValue(0), false)
	assert.equal(dist.readBooleanValue('maybe'), undefined)
	assert.equal(dist.readBooleanValue(undefined), undefined)
	assert.equal(dist.readBooleanValue({ x: 1 }), undefined)
})

test('getPresetInterval uses the connection settings with defaults and clamping', () => {
	assert.equal(dist.getPresetInterval({ host: 'x', port: 80 }, 'monitoring'), 1000)
	assert.equal(dist.getPresetInterval({ host: 'x', port: 80 }, 'playhead'), 250)
	assert.equal(dist.getPresetInterval({ host: 'x', port: 80 }, 'state'), 500)
	assert.equal(dist.getPresetInterval({ host: 'x', port: 80 }, 'static'), 5000)
	assert.equal(dist.getPresetInterval({ host: 'x', port: 80, presetIntervalPlayhead: 100 }, 'playhead'), 100)
	assert.equal(dist.getPresetInterval({ host: 'x', port: 80, presetIntervalStatic: 999999 }, 'static'), 60000)
	assert.equal(dist.getPresetInterval({ host: 'x', port: 80, presetIntervalState: -5 }, 'state'), 0)
	assert.equal(dist.getPresetInterval({ host: 'x', port: 80, presetIntervalState: 'abc' as any }, 'state'), 500)
})
