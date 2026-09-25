/**
 * A trend line drawn on the button.
 *
 * A frame rate or a latency printed as a number tells you what it is now; a line tells you where it
 * is going, which during a show is the thing you actually want to see. module-base lets an advanced
 * feedback return a raw pixel buffer for the button, so the module draws the line itself: no drawing
 * dependency, a few hundred bytes of history per feedback.
 */
import { isSentinel } from './variables'

export interface SparklineOptions {
	width: number
	height: number
	/** Oldest to newest. Values that are not finite numbers are gaps. */
	samples: (number | undefined)[]
	/** Fixed scale; when a bound is undefined the drawn range follows the samples */
	min?: number
	max?: number
	line: [number, number, number]
	fill?: [number, number, number]
	background?: [number, number, number]
	/** Draw a horizontal rule at this value, e.g. a frame budget */
	threshold?: number
	thresholdColour?: [number, number, number]
}

/**
 * Render to a flat RGBA buffer, the format module-base takes for a button image.
 */
export function drawSparkline(options: SparklineOptions): Uint8Array {
	const { width, height, samples } = options
	const buffer = new Uint8Array(width * height * 4)
	const background = options.background
	if (background) {
		for (let i = 0; i < width * height; i++) {
			buffer[i * 4] = background[0]
			buffer[i * 4 + 1] = background[1]
			buffer[i * 4 + 2] = background[2]
			buffer[i * 4 + 3] = 255
		}
	}
	if (width <= 0 || height <= 0) return buffer

	const finite = samples.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
	if (finite.length === 0) return buffer

	let low = options.min ?? Math.min(...finite)
	let high = options.max ?? Math.max(...finite)
	if (options.threshold !== undefined) {
		low = Math.min(low, options.threshold)
		high = Math.max(high, options.threshold)
	}
	if (!(high > low)) {
		// a flat line still deserves to be visible: give it a band around the value, wide enough to
		// survive the rounding of a large one (1 either side of 1e17 is the same number)
		const centre = high
		const pad = Math.max(1, Math.abs(centre) * 1e-9)
		low = centre - pad
		high = centre + pad
	}

	const plot = (x: number, y: number, colour: [number, number, number], alpha = 255): void => {
		if (x < 0 || y < 0 || x >= width || y >= height) return
		const index = (y * width + x) * 4
		buffer[index] = colour[0]
		buffer[index + 1] = colour[1]
		buffer[index + 2] = colour[2]
		buffer[index + 3] = alpha
	}

	/** The row of a value, not yet rounded, kept inside the image; the middle when the range has no width */
	const rowOf = (value: number): number => {
		const span = high - low
		const ratio = span > 0 && Number.isFinite(span) ? (value - low) / span : 0.5
		return Math.min(height - 1, Math.max(0, (1 - ratio) * (height - 1)))
	}

	// The line is collected first as vertical runs of rows per column, so the fill, the threshold
	// rule and the line can be drawn in that order: the rule stays visible on the fill, the line on both
	const runs: [number, number][][] = Array.from({ length: width }, () => [])
	const mark = (x: number, from: number, to: number): void => {
		if (x >= 0 && x < width) runs[x].push([Math.round(Math.min(from, to)), Math.round(Math.max(from, to))])
	}
	/** Columns a gap falls in: nothing is drawn there, so the break shows however dense the samples are */
	const broken = new Set<number>()

	// one column per sample, oldest on the left
	const count = samples.length
	const columnX = (index: number): number => (count <= 1 ? width - 1 : Math.round((index / (count - 1)) * (width - 1)))

	let previous: { x: number; y: number } | undefined
	for (let index = 0; index < count; index++) {
		const value = samples[index]
		const x = columnX(index)
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			broken.add(x)
			previous = undefined
			continue
		}
		const y = rowOf(value)
		if (!previous) {
			mark(x, y, y)
		} else if (x === previous.x) {
			// more samples than columns: the column shows the range they span
			mark(x, previous.y, y)
		} else {
			// straight segment between the two samples: every column it crosses gets the rows from where
			// the segment enters the column to where it leaves, so a steep step stays one stroke
			const slope = (y - previous.y) / (x - previous.x)
			for (let column = previous.x; column <= x; column++) {
				const enter = previous.y + slope * (Math.max(previous.x, column - 0.5) - previous.x)
				const leave = previous.y + slope * (Math.min(x, column + 0.5) - previous.x)
				mark(column, enter, leave)
			}
		}
		previous = { x, y }
	}
	for (const x of broken) runs[x] = []

	if (options.fill) {
		for (let x = 0; x < width; x++) {
			if (!runs[x].length) continue
			const top = Math.min(...runs[x].map(([from]) => from))
			for (let y = top; y < height; y++) plot(x, y, options.fill, 90)
		}
	}
	if (options.threshold !== undefined && options.thresholdColour) {
		const y = Math.round(rowOf(options.threshold))
		for (let x = 0; x < width; x += 2) plot(x, y, options.thresholdColour, 160)
	}
	for (let x = 0; x < width; x++) {
		for (const [from, to] of runs[x]) for (let y = from; y <= to; y++) plot(x, y, options.line)
	}
	return buffer
}

/**
 * The 'Samples to keep' of a Sparkline feedback, held to the range of its field (4 to 300); a
 * blank or unreadable value is the field's default of 60.
 */
export function sparklineWindow(value: unknown): number {
	return Math.max(4, Math.min(300, Math.round(Number(value)) || 60))
}

/**
 * The number a value is drawn at, or undefined for a gap: one of the texts a readout shows instead
 * of a Director value (OFFLINE, ERROR, PATH_ERROR, UNSET, PENDING) and anything else that is not a
 * number. A numeric text counts as its number and an on/off value as 1 or 0.
 */
export function sampleOf(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
	if (typeof value === 'boolean') return value ? 1 : 0
	if (typeof value !== 'string' || value.trim() === '' || isSentinel(value)) return undefined
	const numeric = Number(value)
	return Number.isFinite(numeric) ? numeric : undefined
}

/** A bounded history of the values of one variable */
export class ValueHistory {
	private readonly capacity: number
	private values: (number | undefined)[] = []

	constructor(capacity: number) {
		this.capacity = Math.max(2, capacity)
	}

	/**
	 * Keep a value, or a gap for one that is not a number (see sampleOf). A run of gaps is kept as one
	 * break, so an outage the module keeps retrying does not push the values out of the window, and a
	 * history never starts with a gap.
	 */
	push(value: unknown): void {
		const sample = sampleOf(value)
		if (sample === undefined && this.values[this.values.length - 1] === undefined) return
		this.values.push(sample)
		while (this.values.length > this.capacity) this.values.shift()
	}

	resize(capacity: number): void {
		const wanted = Math.max(2, capacity)
		if (wanted === this.capacity) return
		Object.assign(this, { capacity: wanted })
		while (this.values.length > wanted) this.values.shift()
	}

	get samples(): (number | undefined)[] {
		return this.values
	}

	get length(): number {
		return this.values.length
	}
}
