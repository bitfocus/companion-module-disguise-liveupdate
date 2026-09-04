/**
 * A trend line drawn on the button.
 *
 * A frame rate or a latency printed as a number tells you what it is now; a line tells you where it
 * is going, which during a show is the thing you actually want to see. module-base lets an advanced
 * feedback return a raw pixel buffer for the button, so the module draws the line itself: no drawing
 * dependency, a few hundred bytes of history per feedback.
 */

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
		// a flat line still deserves to be visible: give it a band around the value
		const centre = high
		low = centre - 1
		high = centre + 1
	}

	const plot = (x: number, y: number, colour: [number, number, number], alpha = 255): void => {
		if (x < 0 || y < 0 || x >= width || y >= height) return
		const index = (y * width + x) * 4
		buffer[index] = colour[0]
		buffer[index + 1] = colour[1]
		buffer[index + 2] = colour[2]
		buffer[index + 3] = alpha
	}

	const toY = (value: number): number => {
		const ratio = (value - low) / (high - low)
		const y = Math.round((1 - ratio) * (height - 1))
		return Math.min(height - 1, Math.max(0, y))
	}

	if (options.threshold !== undefined && options.thresholdColour) {
		const y = toY(options.threshold)
		for (let x = 0; x < width; x += 2) plot(x, y, options.thresholdColour, 160)
	}

	// one column per sample, oldest on the left
	const count = samples.length
	const columnX = (index: number): number => (count <= 1 ? width - 1 : Math.round((index / (count - 1)) * (width - 1)))

	let previous: { x: number; y: number } | undefined
	for (let index = 0; index < count; index++) {
		const value = samples[index]
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			previous = undefined
			continue
		}
		const x = columnX(index)
		const y = toY(value)
		if (options.fill) {
			for (let fillY = y; fillY < height; fillY++) plot(x, fillY, options.fill, 90)
		}
		if (previous && x !== previous.x) {
			// straight segment between the two samples so the line reads as continuous
			const steps = Math.abs(x - previous.x)
			for (let step = 1; step < steps; step++) {
				const interpolatedX = previous.x + Math.sign(x - previous.x) * step
				const interpolatedY = Math.round(previous.y + ((y - previous.y) * step) / steps)
				plot(interpolatedX, interpolatedY, options.line)
			}
		}
		plot(x, y, options.line)
		previous = { x, y }
	}
	return buffer
}

/** A bounded history of the values of one variable */
export class ValueHistory {
	private readonly capacity: number
	private values: (number | undefined)[] = []

	constructor(capacity: number) {
		this.capacity = Math.max(2, capacity)
	}

	push(value: unknown): void {
		const numeric = typeof value === 'number' ? value : Number(value)
		this.values.push(Number.isFinite(numeric) ? numeric : undefined)
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
