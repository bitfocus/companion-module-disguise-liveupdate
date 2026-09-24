import { CompanionFeedbackDefinitions, combineRgb, splitRgb } from '@companion-module/base'
import type { DisguiseInstance } from './index'
import { drawSparkline, sparklineWindow } from './sparkline'
import { isSentinel } from './variables'

type DisguiseFeedbackDefinitions = CompanionFeedbackDefinitions

export type CompareOperator = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'truthy' | 'contains'

const FALSY_STRINGS = new Set(['', 'false', 'False', '0', 'None', 'null', 'undefined'])

function toNumber(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
	if (typeof value === 'boolean') return value ? 1 : 0
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value)
		return Number.isFinite(n) ? n : undefined
	}
	return undefined
}

function toText(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
	return JSON.stringify(value) ?? ''
}

function isTruthy(value: unknown): boolean {
	if (value === null || value === undefined) return false
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	if (typeof value === 'string') return !FALSY_STRINGS.has(value.trim())
	if (Array.isArray(value)) return value.length > 0
	return true
}

/** The {errorType, message} object the Director sends in place of a value when a property path fails */
export function isDirectorError(value: unknown): value is { errorType: unknown; message?: unknown } {
	return value !== null && typeof value === 'object' && !Array.isArray(value) && 'errorType' in value
}

/**
 * Compare a LiveUpdate value against the text the user entered.
 * Numbers are compared numerically when both sides are numeric, booleans against true/false,
 * everything else as text (objects and arrays as their JSON form).
 *
 * A value whose state is unknown - none yet, null, a Director error or one of the module's own
 * readout markers (OFFLINE, ERROR, PATH_ERROR, UNSET) - satisfies no comparison, including 'ne':
 * the button falls back to its base colour and its text shows the marker.
 */
export function compareValues(actual: unknown, operator: CompareOperator, expected: string): boolean {
	if (actual === null || actual === undefined || isSentinel(actual) || isDirectorError(actual)) return false
	if (operator === 'truthy') return isTruthy(actual)

	const actualNumber = toNumber(actual)
	const expectedNumber = toNumber(expected)
	const numeric = actualNumber !== undefined && expectedNumber !== undefined

	switch (operator) {
		case 'eq':
		case 'ne': {
			let equal: boolean
			if (numeric) equal = actualNumber === expectedNumber
			else if (typeof actual === 'boolean') equal = actual === (expected.trim().toLowerCase() === 'true')
			else equal = toText(actual) === expected
			return operator === 'eq' ? equal : !equal
		}
		case 'lt':
			return numeric && actualNumber < expectedNumber
		case 'le':
			return numeric && actualNumber <= expectedNumber
		case 'gt':
			return numeric && actualNumber > expectedNumber
		case 'ge':
			return numeric && actualNumber >= expectedNumber
		case 'contains':
			return toText(actual).includes(expected)
		default:
			return false
	}
}

export function getFeedbackDefinitions(instance: DisguiseInstance): DisguiseFeedbackDefinitions {
	return {
		connectionState: {
			type: 'boolean',
			name: 'Connection OK',
			description: 'Indicates whether the module is connected to Disguise Designer',
			defaultStyle: {
				bgcolor: combineRgb(0, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => instance.isConnectionReady(),
		},

		liveUpdateVariable: {
			type: 'advanced',
			name: 'LiveUpdate Variable',
			description:
				'Create a live-updating module variable that tracks a Disguise property. The variable is exposed as $(liveupdate:variable_name) and can be used anywhere in Companion.',
			options: [
				{
					type: 'textinput',
					label: 'Variable Name',
					id: 'variableName',
					default: 'my_property',
					useVariables: false,
					tooltip: 'Name for the variable (e.g., "fps", "track_length")',
				},
				{
					type: 'textinput',
					label: 'Object Path',
					id: 'objectPath',
					default: 'track:track_1',
					useVariables: true,
					tooltip: 'Designer expression to find the object (e.g., "track:track_1", "screen2:screen_1")',
				},
				{
					type: 'textinput',
					label: 'Property Path',
					id: 'propertyPath',
					default: 'object.description',
					useVariables: true,
					tooltip: 'Python expression to access property (e.g., "object.description", "object.lengthInBeats")',
				},
				{
					type: 'number',
					label: 'Update Frequency (ms)',
					id: 'updateFrequency',
					default: 0,
					min: 0,
					max: 60000,
					tooltip: 'Minimum time between updates in milliseconds (0 = as fast as possible)',
				},
			],
			callback: async (feedback) => {
				// This callback is called regularly by Companion to evaluate the feedback.
				// We use it to:
				// 1. Ensure subscriptions exist (auto-subscribe when connection becomes ready)
				// 2. Detect option changes and resubscribe if needed (self-healing)
				// The actual variable value is set via setVariableValues() when data arrives from Disguise.

				const variableName = String(feedback.options.variableName || '')
				const objectPath = String(feedback.options.objectPath || '')
				const propertyPath = String(feedback.options.propertyPath || '')
				const updateFrequency = Number(feedback.options.updateFrequency)

				// Check if we need to create or update the subscription
				// This ensures presets work immediately and subscriptions self-heal
				instance.checkAndUpdateSubscription(
					feedback.id,
					variableName,
					objectPath,
					propertyPath,
					updateFrequency > 0 ? updateFrequency : undefined,
				)

				// Return empty object - this feedback doesn't provide visual styling,
				// it just manages the subscription. The variable value is exposed via
				// Companion's module variable system as $(liveupdate:variable_name)
				return {}
			},
			subscribe: async (feedback) => {
				const variableName = String(feedback.options.variableName || '')
				const objectPath = String(feedback.options.objectPath || '')
				const propertyPath = String(feedback.options.propertyPath || '')
				const updateFrequency = Number(feedback.options.updateFrequency)

				// An empty object or property path is refused by subscribeToVariable, which marks the
				// variable UNSET; without a name there is no variable to mark.
				if (!variableName) {
					instance.log('warn', `LiveUpdate Variable feedback ${feedback.id} needs a Variable Name`)
					return
				}

				const existingSubscription = instance.getSubscriptionByFeedbackId(feedback.id)
				if (existingSubscription) {
					const pathsChanged =
						existingSubscription.objectPath !== objectPath || existingSubscription.propertyPath !== propertyPath
					if (pathsChanged) {
						instance.log('info', `Feedback options changed, updating subscription for ${feedback.id}`)
						instance.unsubscribeFromVariable(feedback.id)
					} else {
						return
					}
				}

				instance.subscribeToVariable(
					feedback.id,
					variableName,
					objectPath,
					propertyPath,
					updateFrequency > 0 ? updateFrequency : undefined,
				)
			},
			unsubscribe: async (feedback) => {
				instance.feedbackOptionsCache.delete(feedback.id)
				instance.unsubscribeFromVariable(feedback.id)
			},
		},

		liveUpdateSparkline: {
			type: 'advanced',
			name: 'LiveUpdate Sparkline',
			description:
				'Draws the recent values of a LiveUpdate Variable as a line on the button. Put it on the same button as the LiveUpdate Variable feedback that owns the value. On Companion 5 the line is drawn into an Image layer of the button: add one below the Text layer before adding this feedback (buttons placed from presets have one), so the number stays readable on top of it.',
			options: [
				{
					type: 'textinput',
					label: 'Variable Name',
					id: 'variableName',
					default: '',
					useVariables: false,
					tooltip: 'The variable name of a LiveUpdate Variable feedback (for example "fps")',
				},
				{
					type: 'number',
					label: 'Samples to keep',
					id: 'window',
					default: 60,
					min: 4,
					max: 300,
					tooltip: 'At the feedback\x27s update rate: 60 samples of a 1 s monitor is one minute',
				},
				{
					type: 'checkbox',
					label: 'Scale to the values seen',
					id: 'autoScale',
					default: true,
				},
				{
					type: 'number',
					label: 'Minimum',
					id: 'min',
					default: 0,
					min: -1000000,
					max: 1000000,
					isVisible: (options) => !options.autoScale,
				},
				{
					type: 'number',
					label: 'Maximum',
					id: 'max',
					default: 60,
					min: -1000000,
					max: 1000000,
					isVisible: (options) => !options.autoScale,
				},
				{
					type: 'colorpicker',
					label: 'Line colour',
					id: 'lineColour',
					default: combineRgb(120, 255, 220),
				},
				{
					type: 'checkbox',
					label: 'Fill under the line',
					id: 'fill',
					default: true,
				},
				{
					type: 'checkbox',
					label: 'Draw a threshold line',
					id: 'useThreshold',
					default: false,
				},
				{
					type: 'number',
					label: 'Threshold',
					id: 'threshold',
					default: 0,
					min: -1000000,
					max: 1000000,
					isVisible: (options) => !!options.useThreshold,
				},
			],
			subscribe: (feedback) => {
				instance.registerSparkline(
					feedback.id,
					String(feedback.options.variableName || ''),
					sparklineWindow(feedback.options.window),
				)
			},
			unsubscribe: (feedback) => {
				instance.registerSparkline(feedback.id, undefined, 0)
			},
			callback: (feedback) => {
				const variableName = String(feedback.options.variableName || '')
				const window = sparklineWindow(feedback.options.window)
				instance.registerSparkline(feedback.id, variableName, window)
				const size = feedback.image
				if (!size || !size.width || !size.height) return {}
				// the history is shared by every Sparkline of the variable; this one draws its own window of it
				const samples = instance.getSparklineSamples(variableName, window)
				if (!samples.length) return {}
				const autoScale = feedback.options.autoScale !== false
				const rgb = splitRgb(Number(feedback.options.lineColour ?? combineRgb(120, 255, 220)))
				const line: [number, number, number] = [rgb.r, rgb.g, rgb.b]
				const buffer = drawSparkline({
					width: size.width,
					height: size.height,
					samples,
					min: autoScale ? undefined : Number(feedback.options.min ?? 0),
					max: autoScale ? undefined : Number(feedback.options.max ?? 1),
					line,
					fill: feedback.options.fill === false ? undefined : line,
					threshold: feedback.options.useThreshold ? Number(feedback.options.threshold ?? 0) : undefined,
					thresholdColour: [200, 80, 80],
				})
				return {
					imageBuffer: buffer,
					imageBufferEncoding: { pixelFormat: 'RGBA' },
					imageBufferPosition: { x: 0, y: 0, width: size.width, height: size.height },
				}
			},
		},

		restArmed: {
			type: 'boolean',
			name: 'Command armed',
			description:
				'True while a destructive command on this button is waiting for its confirming press. Put it on the same button as the command so the operator can see the button is armed.',
			defaultStyle: { bgcolor: combineRgb(200, 120, 0), color: combineRgb(0, 0, 0) },
			options: [],
			// the arm belongs to the button that was pressed, so only that button lights up
			callback: (feedback) => instance.isRestArmed(feedback.controlId),
		},

		restLastResult: {
			type: 'boolean',
			name: 'Last command failed',
			description: 'True when the last command this connection sent did not succeed.',
			defaultStyle: { bgcolor: combineRgb(178, 34, 34), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => {
				const status = instance.getVariableValue('rest_last_status')
				return status === 'FAILED' || status === 'UNSUPPORTED'
			},
		},

		liveUpdateCompare: {
			type: 'boolean',
			name: 'LiveUpdate Compare',
			description:
				'True when the current value of a LiveUpdate Variable satisfies the comparison. Used by the presets for state colours; add a LiveUpdate Variable feedback with the same Variable Name on the button (or anywhere) to create the subscription.',
			defaultStyle: {
				bgcolor: combineRgb(0, 100, 0),
				color: combineRgb(220, 220, 220),
			},
			options: [
				{
					type: 'textinput',
					label: 'Variable Name',
					id: 'variableName',
					default: '',
					useVariables: false,
					tooltip: 'The variable name of a LiveUpdate Variable feedback (e.g., "fps")',
				},
				{
					type: 'dropdown',
					label: 'Comparison',
					id: 'operator',
					default: 'eq',
					choices: [
						{ id: 'eq', label: '= equals' },
						{ id: 'ne', label: '≠ not equal' },
						{ id: 'lt', label: '< less than' },
						{ id: 'le', label: '≤ less or equal' },
						{ id: 'gt', label: '> greater than' },
						{ id: 'ge', label: '≥ greater or equal' },
						{ id: 'truthy', label: 'is true / non-zero / non-empty' },
						{ id: 'contains', label: 'contains text' },
					],
				},
				{
					type: 'textinput',
					label: 'Value',
					id: 'value',
					default: '',
					useVariables: true,
					tooltip: 'Number, true/false or text to compare with',
					isVisible: (options) => options.operator !== 'truthy',
				},
			],
			subscribe: (feedback) => {
				instance.registerCompareFeedback(feedback.id, String(feedback.options.variableName || ''))
			},
			unsubscribe: (feedback) => {
				instance.registerCompareFeedback(feedback.id, undefined)
			},
			callback: (feedback) => {
				const variableName = String(feedback.options.variableName || '')
				const operator = String(feedback.options.operator || 'eq') as CompareOperator
				const expected = String(feedback.options.value ?? '')
				instance.registerCompareFeedback(feedback.id, variableName)
				const subscription = instance.getSubscriptionByVariableName(variableName)
				return compareValues(subscription?.value, operator, expected)
			},
		},
	}
}
