import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadDist } from './harness'

const dist = loadDist()

test('isUnresolvedPath refuses placeholders and unresolved variables', () => {
	const unresolved = [
		'',
		'   ',
		'<OBJECT_PATH>',
		'object.<PROPERTY_PATH>',
		'track:"<TRACK_NAME>"',
		'track:"$NA"',
		'getByUID($NA)',
		'track:"$(custom:show_track)"',
		'object.getWorkloadInstance($NA, $NA).health()',
	]
	for (const path of unresolved) {
		assert.equal(dist.isUnresolvedPath(path), true, `should be unresolved: ${path}`)
		assert.equal(dist.isUnresolvedObjectPath(path), true, `should be an unresolved object path: ${path}`)
	}

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

test('a property path is free Python: empty strings, empty lists and 1-tuples are sent', () => {
	const resolved = [
		// the else branch of the catalog's None-guarded conditionals
		'(object.timecode.current.__str__() if object.timecode is not None else "")',
		'(object.timecode.statusString if object.timecode is not None else "")',
		'(object.venue.description if object.venue is not None else "")',
		'(object.d3NetManager.getDirectorUnderstudy().name if object.d3NetManager.getDirectorUnderstudy() is not None else "")',
		'[{"runningAs": (m.runningAs.name if m.runningAs is not None else "")} for m in object.machines]',
		'"; ".join([s.name + ": " + s.error for s in object.statuses if s.error])',
		// expressions 1.0.2 sent as they were
		'object.name.replace(" ", "")',
		'object.name.replace("_", "")',
		'getattr(object, "description", "")',
		'object.get("k", "")',
		'[l.name for l in object.layers] or []',
		'len(object.layers or [])',
		'object.f((1,))',
		'{"a": ""}',
		'str("".join(x))',
		'x if object.description not in ("", None) else "untitled"',
		'object.name + ":d3"',
		// a broken slot is the Director's to refuse, with a visible PATH_ERROR
		'object.getWorkloadInstance(, )',
		'object.container.variables[].defaultFloat',
	]
	for (const path of resolved) assert.equal(dist.isUnresolvedPath(path), false, `resolved: ${path}`)
})

test('an object path is refused only for a bare empty name or a remote node without a host', () => {
	const unresolved = [
		'track:""',
		"track:''",
		' screen2 : "" ',
		'subsystem:MonitoringManager.findRemoteMonitor(":d3", "fps")',
	]
	for (const path of unresolved) assert.equal(dist.isUnresolvedObjectPath(path), true, `unresolved: ${path}`)

	const resolved = [
		'track:"Track 1"',
		'track:"A".findLayerByName("")',
		'track:"".layers',
		'subsystem:MonitoringManager.findRemoteMonitor("ACTOR01:d3", "fps")',
		'subsystem:MonitoringManager',
	]
	for (const path of resolved) assert.equal(dist.isUnresolvedObjectPath(path), false, `resolved: ${path}`)
})

test('designerMajor reads the major version of a Designer build', () => {
	assert.equal(dist.designerMajor('r34.0.3'), '34')
	assert.equal(dist.designerMajor('34.0.3.258249'), '34')
	assert.equal(dist.designerMajor('r35.0.1'), '35')
	assert.equal(dist.designerMajor('r33'), '33')
	assert.equal(dist.designerMajor('d3 r34.0.3'), '34')
	assert.equal(dist.designerMajor('Designer'), undefined)
	assert.equal(dist.designerMajor(''), undefined)
})

test('compareValues satisfies no comparison for a value whose state is unknown', () => {
	const c = dist.compareValues
	const unknown = [undefined, null, { errorType: 'propertyPathError', message: 'x' }, ...dist.SENTINELS]
	const rules: [string, string][] = [
		['eq', ''],
		['ne', '[]'],
		['ne', '1'],
		['ne', ''],
		['lt', '5'],
		['ge', '0'],
		['truthy', ''],
		['contains', 'E'],
	]
	for (const value of unknown) {
		for (const [operator, expected] of rules) {
			assert.equal(c(value, operator, expected), false, `${JSON.stringify(value)} ${operator} ${expected}`)
		}
	}
	assert.deepEqual(
		[...dist.SENTINELS].sort(),
		['ERROR', 'OFFLINE', 'PATH_ERROR', 'PATH_ERROR (unsubscribed)', 'UNSET'],
		'the markers a button can show besides a value',
	)
	// a real value that merely contains a marker's text is still compared
	assert.equal(c('ERROR 42', 'contains', 'ERROR'), true)
})

test('every catalog property path survives the guard once its selections are filled in', () => {
	const examples: Record<string, string> = {}
	for (const selection of dist.SELECTIONS) examples[selection.id] = selection.example
	const substitute = (text: string): string =>
		text.replace(/\$\(liveupdate:(sel[A-Za-z0-9_]+)\)/g, (m: string, id: string) => examples[id] ?? m)
	for (const entry of dist.PRESET_CATALOG) {
		if (!entry.objectPath) continue
		if (entry.objectPath.includes('<') || entry.propertyPath.includes('<')) continue // templates
		assert.equal(
			dist.isUnresolvedObjectPath(substitute(entry.objectPath)),
			false,
			`${entry.id}: object path refused by the guard: ${substitute(entry.objectPath)}`,
		)
		assert.equal(
			dist.isUnresolvedPath(substitute(entry.propertyPath)),
			false,
			`${entry.id}: property path refused by the guard: ${substitute(entry.propertyPath)}`,
		)
	}
})
