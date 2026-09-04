/**
 * The trend line drawn on the button: the pixels it produces, the history it keeps, and the wiring
 * that feeds it from the Director's values.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeDirector, liveUpdateFeedback, loadDist, newInstance, settle } from './harness'

const dist = loadDist()
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the built module is plain CommonJS
const sparkline = require(require('node:path').join(__dirname, '..', 'dist', 'sparkline.js')) as {
	drawSparkline: (options: Record<string, unknown>) => Uint8Array
	ValueHistory: new (capacity: number) => {
		push: (v: unknown) => void
		samples: (number | undefined)[]
		resize: (n: number) => void
	}
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
