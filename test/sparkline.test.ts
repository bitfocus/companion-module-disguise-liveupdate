/**
 * The trend line drawn on the button: the pixels it produces, the history it keeps, and the wiring
 * that feeds it from the Director's values.
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
	destroyInstances,
	FakeDirector,
	type FeedbackInstance,
	liveUpdateFeedback,
	loadDist,
	newInstance,
	settle,
	until,
} from './harness'

const dist = loadDist()

// a failing test must not leave timers running into the next one
afterEach(destroyInstances)
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the built module is plain CommonJS
const sparkline = require(require('node:path').join(__dirname, '..', 'dist', 'sparkline.js')) as {
	drawSparkline: (options: Record<string, unknown>) => Uint8Array
	ValueHistory: new (capacity: number) => {
		push: (v: unknown) => void
		samples: (number | undefined)[]
		resize: (n: number) => void
	}
	sparklineWindow: (value: unknown) => number
}

const pixel = (buffer: Uint8Array, width: number, x: number, y: number): [number, number, number, number] => {
	const i = (y * width + x) * 4
	return [buffer[i], buffer[i + 1], buffer[i + 2], buffer[i + 3]]
}

test('a rising line is drawn from the bottom left to the top right', () => {
	const width = 16
	const height = 8
	const buffer = sparkline.drawSparkline({
		width,
		height,
		samples: Array.from({ length: 16 }, (_v, i) => i),
		line: [255, 0, 0],
	})
	assert.equal(buffer.length, width * height * 4)
	// the first sample is the smallest, so it sits on the bottom row; the last on the top row
	assert.deepEqual(pixel(buffer, width, 0, height - 1), [255, 0, 0, 255])
	assert.deepEqual(pixel(buffer, width, width - 1, 0), [255, 0, 0, 255])
})

test('a flat line stays visible instead of collapsing', () => {
	const width = 8
	const height = 8
	const buffer = sparkline.drawSparkline({ width, height, samples: [5, 5, 5, 5, 5, 5, 5, 5], line: [0, 255, 0] })
	const drawn = []
	for (let y = 0; y < height; y++) if (pixel(buffer, width, 0, y)[3] === 255) drawn.push(y)
	assert.equal(drawn.length, 1, 'exactly one row is drawn')
	assert.ok(drawn[0] > 0 && drawn[0] < height - 1, 'and it is not pinned to an edge')

	// 1 either side of a value this large is the same number, which left no band to draw in
	const large: [string, Record<string, unknown>][] = [
		['1e17', { samples: [1e17, 1e17, 1e17] }],
		['-1e17', { samples: [-1e17, -1e17] }],
		['2^53', { samples: [2 ** 53, 2 ** 53] }],
		['a uint64 none value', { samples: [Number('18446744073709551615'), Number('18446744073709551615')] }],
		['a fixed scale of one value', { samples: [1e17, 1e17], min: 1e17, max: 1e17 }],
	]
	for (const [what, options] of large) {
		const flat = sparkline.drawSparkline({ width, height, line: [0, 255, 0], ...options })
		const rows = []
		for (let y = 0; y < height; y++) if (pixel(flat, width, width - 1, y)[3] === 255) rows.push(y)
		assert.equal(rows.length, 1, `${what}: one row is drawn`)
		assert.ok(rows[0] > 0 && rows[0] < height - 1, `${what}: not pinned to an edge (row ${rows[0]})`)
	}
})

test('a gap in the values breaks the line instead of inventing one', () => {
	const width = 8
	const height = 8
	const buffer = sparkline.drawSparkline({ width, height, samples: [0, undefined, 7], line: [0, 0, 255] })
	let drawnColumns = 0
	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) {
			if (pixel(buffer, width, x, y)[3] === 255) {
				drawnColumns++
				break
			}
		}
	}
	assert.ok(drawnColumns <= 3, `only the samples are drawn, not a bridge (${drawnColumns} columns)`)
})

test('an empty or non-numeric history draws nothing', () => {
	const buffer = sparkline.drawSparkline({ width: 4, height: 4, samples: ['ERROR', undefined], line: [1, 2, 3] })
	assert.ok(
		[...buffer].every((byte) => byte === 0),
		'nothing is drawn for a variable that has no numbers',
	)
})

test('the history is bounded and keeps the newest values', () => {
	const history = new sparkline.ValueHistory(3)
	for (const value of [1, 2, 3, 4, 5]) history.push(value)
	assert.deepEqual(history.samples, [3, 4, 5])
	history.push('PATH_ERROR')
	assert.deepEqual(history.samples, [4, 5, undefined], 'a sentinel becomes a gap')
})

test('values from the Director feed the sparkline of the feedback that asked for them', async () => {
	let value = 59
	const director = new FakeDirector({ valueFor: () => value })
	const { inst } = await newInstance(director, [
		liveUpdateFeedback(
			'v',
			'subsystem:MonitoringManager.findLocalMonitor("fps")',
			'object.seriesAverage("Actual", 1)',
			'fps',
		),
	])
	await settle(50)
	const feedbacks = dist.getFeedbackDefinitions(inst)
	// the sparkline announces itself the way module-base would
	feedbacks.liveUpdateSparkline.subscribe({ id: 'spark', options: { variableName: 'fps', window: 10 } })

	for (const next of [58, 57, 60]) {
		value = next
		director.pushValueForPair(
			'subsystem:MonitoringManager.findLocalMonitor("fps")',
			'object.seriesAverage("Actual", 1)',
			next,
		)
		await settle(20)
	}
	const result = feedbacks.liveUpdateSparkline.callback({
		id: 'spark',
		options: { variableName: 'fps', window: 10, autoScale: true, lineColour: 0x78ffdc, fill: false },
		image: { width: 12, height: 6 },
	})
	assert.ok(result.imageBuffer instanceof Uint8Array, 'a button image is returned')
	assert.equal(result.imageBufferEncoding.pixelFormat, 'RGBA')
	assert.equal(result.imageBufferPosition.width, 12)
	assert.ok(
		[...(result.imageBuffer as Uint8Array)].some((byte) => byte !== 0),
		'and it has something drawn on it',
	)

	// once the feedback is gone the history goes with it
	feedbacks.liveUpdateSparkline.unsubscribe({ id: 'spark', options: { variableName: 'fps' } })
	assert.deepEqual(inst.getSparklineSamples('fps'), [])
	await inst.destroy()
})

test('a sparkline without a button size returns nothing rather than guessing', async () => {
	const director = new FakeDirector({ valueFor: () => 1 })
	const { inst } = await newInstance(director, [liveUpdateFeedback('v', 'track:"A"', 'object.lengthInBeats', 'len')])
	await settle(50)
	const feedbacks = dist.getFeedbackDefinitions(inst)
	const result = feedbacks.liveUpdateSparkline.callback({ id: 's', options: { variableName: 'len', window: 10 } })
	assert.deepEqual(result, {})
	await inst.destroy()
})

/** The 72x58 image Companion 5 asks a feedback for on a button with its top bar */
const WIDTH = 72
const HEIGHT = 58

/** Pixels drawn at full opacity: the line (the fill is drawn at 90, the threshold rule at 160) */
const linePixels = (buffer: Uint8Array): [number, number][] => {
	const lit: [number, number][] = []
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < WIDTH; x++) if (pixel(buffer, WIDTH, x, y)[3] === 255) lit.push([x, y])
	return lit
}

/** Groups of pixels that touch, diagonals included */
const strokes = (lit: [number, number][]): number => {
	const unseen = new Set(lit.map(([x, y]) => `${x},${y}`))
	let groups = 0
	for (const start of unseen) {
		groups++
		const queue = [start]
		unseen.delete(start)
		while (queue.length) {
			const [x, y] = queue.pop()!.split(',').map(Number)
			for (let dx = -1; dx <= 1; dx++)
				for (let dy = -1; dy <= 1; dy++) {
					const next = `${x + dx},${y + dy}`
					if (unseen.delete(next)) queue.push(next)
				}
		}
	}
	return groups
}

test('a steep line stays one stroke instead of breaking into dots', () => {
	const series = {
		wave: Array.from({ length: 60 }, (_v, i) => 10 + 8 * Math.sin(i / 3)),
		// a frame rate that flickers between 60 and the float32 of 59.94
		flicker: Array.from({ length: 60 }, (_v, i) => (i % 2 ? 60 : Math.fround(59.94))),
		dips: Array.from({ length: 60 }, (_v, i) => (i === 20 || i === 40 ? 58 : 60)),
	}
	for (const [name, samples] of Object.entries(series)) {
		const buffer = sparkline.drawSparkline({ width: WIDTH, height: HEIGHT, samples, line: [255, 255, 255] })
		const lit = linePixels(buffer)
		assert.equal(strokes(lit), 1, `${name}: the line is one connected stroke`)
		assert.equal(new Set(lit.map(([x]) => x)).size, WIDTH, `${name}: across every column`)
	}
})

test('the fill covers every column under the line, also while the history is short', () => {
	for (const count of [3, 10, 60]) {
		const samples = Array.from({ length: count }, (_v, i) => 30 + 5 * Math.sin(i / 6))
		const buffer = sparkline.drawSparkline({
			width: WIDTH,
			height: HEIGHT,
			samples,
			line: [120, 255, 220],
			fill: [120, 255, 220],
		})
		const empty = []
		for (let x = 0; x < WIDTH; x++) if (pixel(buffer, WIDTH, x, HEIGHT - 1)[3] === 0) empty.push(x)
		assert.deepEqual(empty, [], `${count} samples: no unfilled column on the bottom row`)
	}
})

test('the threshold rule stays visible on a filled line, and the line crosses over it', () => {
	// a frame rate at 60 with one dip to 45, and a frame budget at 50: the usual case, line above the rule
	const samples = Array.from({ length: 60 }, (_v, i) => (i === 30 ? 45 : 60))
	const buffer = sparkline.drawSparkline({
		width: WIDTH,
		height: HEIGHT,
		samples,
		line: [120, 255, 220],
		fill: [120, 255, 220],
		threshold: 50,
		thresholdColour: [200, 80, 80],
	})
	// scaled from 45 (bottom) to 60 (top): 50 sits on row 38
	const row = Math.round((1 - 5 / 15) * (HEIGHT - 1))
	let rule = 0
	for (let x = 0; x < WIDTH; x += 2) {
		const [r, g, b, a] = pixel(buffer, WIDTH, x, row)
		if (a === 255) {
			assert.deepEqual([r, g, b], [120, 255, 220], `column ${x}: the line is drawn over the rule`)
			continue
		}
		assert.deepEqual([r, g, b, a], [200, 80, 80, 160], `column ${x}: the rule, not the fill`)
		rule++
	}
	assert.ok(rule >= WIDTH / 2 - 4, `the rule shows in ${rule} of ${WIDTH / 2} columns`)
})

test('a gap shows as a break even when there are more samples than columns', () => {
	const samples: (number | undefined)[] = Array.from({ length: 300 }, (_v, i) => 30 + 5 * Math.sin(i / 10))
	samples[150] = undefined
	const buffer = sparkline.drawSparkline({
		width: WIDTH,
		height: HEIGHT,
		samples,
		line: [120, 255, 220],
		fill: [120, 255, 220],
	})
	const blank = []
	for (let x = 0; x < WIDTH; x++) {
		let drawn = false
		for (let y = 0; y < HEIGHT; y++) if (pixel(buffer, WIDTH, x, y)[3] !== 0) drawn = true
		if (!drawn) blank.push(x)
	}
	assert.deepEqual(blank, [Math.round((150 / 299) * (WIDTH - 1))], 'the column of the gap is left empty')
})

test('every text a readout shows instead of a value is a gap, and a run of them is one break', () => {
	const history = new sparkline.ValueHistory(40)
	history.push('OFFLINE')
	assert.deepEqual(history.samples, [], 'a history does not start with a gap')
	for (const sentinel of dist.SENTINELS) {
		history.push(1)
		history.push(sentinel)
		history.push(sentinel)
	}
	assert.deepEqual(
		history.samples,
		dist.SENTINELS.flatMap(() => [1, undefined]),
		'each sentinel is one gap, however often it is written',
	)
	history.push(2)
	for (const value of ['', '  ', null, { errorType: 'X' }, [5], Number.NaN, Number.POSITIVE_INFINITY])
		history.push(value)
	history.push('12.5')
	history.push(true)
	history.push(false)
	assert.deepEqual(history.samples.slice(-5), [2, undefined, 12.5, 1, 0], 'any other non-number is a gap too')
})

test('the window of a sparkline is held to the range of its field', () => {
	assert.equal(sparkline.sparklineWindow(10), 10)
	assert.equal(sparkline.sparklineWindow('25'), 25)
	assert.equal(sparkline.sparklineWindow(1), 4)
	assert.equal(sparkline.sparklineWindow(1000), 300)
	for (const blank of [undefined, null, '', 'abc', 0, Number.NaN]) assert.equal(sparkline.sparklineWindow(blank), 60)
})

const FPS_OBJECT = 'subsystem:MonitoringManager.findLocalMonitor("fps")'
const FPS_PROPERTY = 'object.seriesAverage("Actual", 1)'

/** A Sparkline feedback on a Companion 5 button: the host passes the size of the image it wants */
const sparklineFeedback = (id: string, options: Record<string, unknown>): FeedbackInstance =>
	({
		id,
		feedbackId: 'liveUpdateSparkline',
		controlId: 'ctl_' + id,
		options,
		upgradeIndex: null,
		disabled: false,
		image: { width: WIDTH, height: HEIGHT },
	}) as FeedbackInstance

/** What the Sparkline feedback draws for these samples with its default options */
const render = (samples: (number | undefined)[]): Uint8Array =>
	sparkline.drawSparkline({ width: WIDTH, height: HEIGHT, samples, line: [120, 255, 220], fill: [120, 255, 220] })

/** The image a feedback last sent to its button */
const shown = (host: { feedbackValues: Map<string, unknown> }, id: string): Uint8Array | undefined =>
	(host.feedbackValues.get(id) as { imageBuffer?: Uint8Array } | undefined)?.imageBuffer

test('two sparklines on one variable each draw the number of samples they keep', async () => {
	let value = 50
	const director = new FakeDirector({ valueFor: () => value })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('v', FPS_OBJECT, FPS_PROPERTY, 'fps'),
		sparklineFeedback('short', { variableName: 'fps', window: 4 }),
		sparklineFeedback('long', { variableName: 'fps', window: 20 }),
		sparklineFeedback('blank', { variableName: 'fps', window: '' }),
	])
	await settle(50)
	for (let i = 0; i < 25; i++) {
		value = 30 + ((i * 37) % 50)
		director.pushValueForPair(FPS_OBJECT, FPS_PROPERTY, value)
		await settle(5)
	}
	await settle(20)
	const history = [...inst.getSparklineSamples('fps')]
	assert.equal(history.length, 26, 'one history, kept for the longest window (60)')
	assert.deepEqual(shown(host, 'short'), render(history.slice(-4)), 'the short one draws its last 4 samples')
	assert.deepEqual(shown(host, 'long'), render(history.slice(-20)), 'the long one its last 20')
	assert.deepEqual(shown(host, 'blank'), render(history), 'and a blank window is the default of 60')
	assert.notDeepEqual(render(history.slice(-4)), render(history.slice(-20)))
	assert.notDeepEqual(render(history.slice(-20)), render(history))
	await inst.destroy()
})

test('an outage breaks the line instead of joining the values on either side of it', async () => {
	let value = 58
	const director = new FakeDirector({ valueFor: () => value })
	const { inst, host } = await newInstance(
		director,
		[liveUpdateFeedback('v', FPS_OBJECT, FPS_PROPERTY, 'fps'), sparklineFeedback('spark', { variableName: 'fps' })],
		{ reconnectInterval: 100 },
	)
	await settle(50)
	value = 57
	director.pushValueForPair(FPS_OBJECT, FPS_PROPERTY, 57)
	await settle(20)
	assert.deepEqual(inst.getSparklineSamples('fps'), [58, 57])

	director.sock!.drop()
	await settle(20)
	assert.deepEqual(inst.getSparklineSamples('fps'), [58, 57, undefined], 'the outage is a gap')
	assert.deepEqual(shown(host, 'spark'), render([58, 57, undefined]), 'and the button shows it during the outage')

	assert.ok(await until(() => inst.isConnectionReady()))
	await settle(50)
	value = 31
	director.pushValueForPair(FPS_OBJECT, FPS_PROPERTY, 31)
	await settle(20)
	const after = inst.getSparklineSamples('fps')
	assert.deepEqual(after.slice(0, 3), [58, 57, undefined], 'the values before and after are not joined')
	assert.ok(
		after.slice(3).every((sample: unknown) => typeof sample === 'number'),
		'and the line resumes after it',
	)
	assert.equal(after[after.length - 1], 31)
	await inst.destroy()
})

test('a property error between two values breaks the line', async () => {
	const director = new FakeDirector({ valueFor: () => 58 })
	const { inst, host } = await newInstance(director, [
		liveUpdateFeedback('v', FPS_OBJECT, FPS_PROPERTY, 'fps'),
		sparklineFeedback('spark', { variableName: 'fps' }),
	])
	await settle(50)
	director.pushValueForPair(FPS_OBJECT, FPS_PROPERTY, { errorType: 'AttributeError', message: 'no such attribute' })
	await settle(20)
	assert.equal(host.variables.get('fps'), 'PATH_ERROR')
	assert.deepEqual(shown(host, 'spark'), render([58, undefined]), 'the button shows the break at once')
	director.pushValueForPair(FPS_OBJECT, FPS_PROPERTY, 60)
	await settle(20)
	assert.deepEqual(inst.getSparklineSamples('fps'), [58, undefined, 60])
	await inst.destroy()
})

test('a readout moved to an object the Director refuses, or to a path that cannot be resolved, starts over', async () => {
	const director = new FakeDirector({
		valueFor: () => 58,
		errorFor: (o, p) => (o === 'track:"Gone"' ? `Unable to subscribe to ${o} / ${p} - object not found` : null),
	})
	const readout = liveUpdateFeedback('v', FPS_OBJECT, FPS_PROPERTY, 'fps')
	const { inst, host } = await newInstance(director, [readout, sparklineFeedback('spark', { variableName: 'fps' })])
	await settle(50)
	assert.deepEqual(inst.getSparklineSamples('fps'), [58])
	inst.updateFeedbacks({ v: { ...readout, options: { ...readout.options, objectPath: 'track:"Gone"' } } })
	await settle(50)
	assert.equal(host.variables.get('fps'), 'ERROR')
	assert.deepEqual(inst.getSparklineSamples('fps'), [], 'the values of the previous object are dropped')
	assert.equal(shown(host, 'spark'), undefined, 'and the button is redrawn without them')

	inst.updateFeedbacks({ v: readout })
	await settle(50)
	assert.deepEqual(inst.getSparklineSamples('fps'), [58])
	inst.updateFeedbacks({ v: { ...readout, options: { ...readout.options, objectPath: 'track:"$NA"' } } })
	await settle(50)
	assert.equal(host.variables.get('fps'), 'UNSET')
	assert.deepEqual(inst.getSparklineSamples('fps'), [])
	assert.equal(shown(host, 'spark'), undefined)
	await inst.destroy()
})

test('a readout moved to another object starts a new line instead of joining the two objects', async () => {
	const director = new FakeDirector({ valueFor: (objectPath) => (objectPath === FPS_OBJECT ? 58 : 5000) })
	const readout = liveUpdateFeedback('v', FPS_OBJECT, FPS_PROPERTY, 'fps')
	const { inst, host } = await newInstance(director, [readout, sparklineFeedback('spark', { variableName: 'fps' })])
	await settle(50)
	director.hold()
	inst.updateFeedbacks({ v: { ...readout, options: { ...readout.options, objectPath: 'track:"Track 1"' } } })
	await settle(20)
	// the readout says PENDING while the new object is asked for; the old object's line is gone already
	assert.equal(host.variables.get('fps'), 'PENDING')
	assert.deepEqual(inst.getSparklineSamples('fps'), [])
	assert.equal(shown(host, 'spark'), undefined)
	director.release()
	await settle(50)
	assert.equal(host.variables.get('fps'), 5000)
	assert.deepEqual(inst.getSparklineSamples('fps'), [5000], 'the scale is set by the new object alone')

	// only the property that feeds the readout counts: a new interval keeps the line
	inst.updateFeedbacks({
		v: { ...readout, options: { ...readout.options, objectPath: 'track:"Track 1"', updateFrequency: 500 } },
	})
	await settle(50)
	assert.deepEqual(inst.getSparklineSamples('fps'), [5000, undefined, 5000])
	await inst.destroy()
})

test('a new interval set while the Director is away keeps the line', async () => {
	const director = new FakeDirector({ valueFor: () => 10 })
	const readout = liveUpdateFeedback('v', FPS_OBJECT, FPS_PROPERTY, 'fps', 1000)
	const { inst, host } = await newInstance(director, [readout, sparklineFeedback('spark', { variableName: 'fps' })])
	await settle(50)
	assert.deepEqual(inst.getSparklineSamples('fps'), [10])
	director.sock!.drop()
	await settle(20)
	assert.deepEqual(inst.getSparklineSamples('fps'), [10, undefined])
	// nothing feeds the readout during the outage, yet it still watches the same object
	inst.updateFeedbacks({ v: { ...readout, options: { ...readout.options, updateFrequency: 500 } } })
	await settle(20)
	assert.equal(host.variables.get('fps'), 'OFFLINE')
	assert.deepEqual(inst.getSparklineSamples('fps'), [10, undefined], 'the line is kept')
	assert.deepEqual(shown(host, 'spark'), render([10, undefined]))
	await inst.destroy()
})

test('a readout removed and placed again starts a new line; one another feedback still feeds keeps it', async () => {
	let value = 10
	const director = new FakeDirector({ refCount: true, valueFor: () => value })
	const readout = liveUpdateFeedback('v', FPS_OBJECT, FPS_PROPERTY, 'fps')
	const { inst, host } = await newInstance(director, [
		readout,
		liveUpdateFeedback('twin', FPS_OBJECT, FPS_PROPERTY, 'fps'),
		sparklineFeedback('spark', { variableName: 'fps' }),
	])
	await settle(50)
	value = 20
	director.pushValueForPair(FPS_OBJECT, FPS_PROPERTY, 20)
	await settle(20)
	inst.updateFeedbacks({ twin: null })
	await settle(50)
	assert.deepEqual(inst.getSparklineSamples('fps'), [10, 20], 'the other feedback still feeds the readout')

	inst.updateFeedbacks({ v: null })
	await settle(50)
	assert.deepEqual(inst.getSparklineSamples('fps'), [], 'the removed readout takes its line with it')
	assert.equal(shown(host, 'spark'), undefined)
	value = 30
	inst.updateFeedbacks({ v: readout })
	await settle(50)
	assert.deepEqual(inst.getSparklineSamples('fps'), [30])
	await inst.destroy()
})
