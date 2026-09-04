import { CompanionFeedbackDefinitions, combineRgb } from '@companion-module/base'
import type { DisguiseInstance } from './index'

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

/**
 * Compare a LiveUpdate value against the text the user entered.
 * Numbers are compared numerically when both sides are numeric, booleans against true/false,
 * everything else as text (objects and arrays as their JSON form).
 */
export function compareValues(actual: unknown, operator: CompareOperator, expected: string): boolean {
	if (operator === 'truthy') return isTruthy(actual)
	if (actual === null || actual === undefined) return false

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

				if (!variableName || !objectPath || !propertyPath) {
					instance.log('warn', 'Variable name, object path, and property path are required')
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
			callback: (feedback) => {
				const variableName = String(feedback.options.variableName || '')
				const operator = String(feedback.options.operator || 'eq') as CompareOperator
				const expected = String(feedback.options.value ?? '')
				const subscription = instance.getSubscriptionByVariableName(variableName)
				return compareValues(subscription?.value, operator, expected)
			},
		},
	}
}
