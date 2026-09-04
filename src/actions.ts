import {
	CompanionActionDefinition,
	CompanionActionDefinitions,
	CompanionActionEvent,
	CompanionActionContext,
} from '@companion-module/base'
import type { DisguiseInstance } from './index'
import type { LiveUpdateSubscription } from './index'
import { SELECTIONS } from './selections'

export interface DisguiseActionDefinitions extends CompanionActionDefinitions {
	setToDisguiseString: CompanionActionDefinition
	setToDisguiseNumber: CompanionActionDefinition
	setToDisguiseBoolean: CompanionActionDefinition
	setToDisguiseJSON: CompanionActionDefinition
	setToDisguiseToggle: CompanionActionDefinition
	setSelection: CompanionActionDefinition
}

/**
 * Interpret the current value of a subscription as a boolean (Designer sends real booleans;
 * strings such as "True"/"False" and 0/1 are accepted for robustness). Returns undefined when
 * the value cannot be read as a boolean.
 */
export function readBooleanValue(value: unknown): boolean | undefined {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	if (typeof value === 'string') {
		const normalised = value.trim().toLowerCase()
		if (normalised === 'true' || normalised === '1') return true
		if (normalised === 'false' || normalised === '0') return false
	}
	return undefined
}

/**
 * Helper function to validate variable name and get subscription
 */
function getSubscriptionForAction(instance: DisguiseInstance, variableName: string): LiveUpdateSubscription | null {
	if (!variableName) {
		instance.log('warn', 'Variable name is required')
		return null
	}

	const subscription = instance.getSubscriptionByVariableName(variableName)
	if (!subscription) {
		instance.log(
			'warn',
			`No LiveUpdate Variable found with name '${variableName}'. Add a LiveUpdate Variable feedback first.`,
		)
		return null
	}

	return subscription
}

/**
 * Process a string value (parse variables)
 */
async function processStringValue(context: CompanionActionContext, valueStr: string): Promise<string> {
	return await context.parseVariablesInString(valueStr)
}

/**
 * Process a numeric value (parse variables and evaluate expression)
 */
async function processNumberValue(
	instance: DisguiseInstance,
	context: CompanionActionContext,
	valueStr: string,
): Promise<number | null> {
	const parsedValue = await context.parseVariablesInString(valueStr)

	try {
		// Evaluate mathematical expressions like "5+1", "10*2", "$(var)+1"
		// eslint-disable-next-line @typescript-eslint/no-implied-eval -- existing behaviour: the Number action evaluates the operator's arithmetic expression
		const value = new Function('return ' + parsedValue)() as number

		// Infinity and -Infinity are numbers and are not NaN, but JSON.stringify turns them into
		// null, which would put {"value":null} on the wire and into a live show property.
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			instance.log('warn', `Value is not a finite number: ${parsedValue} (from: ${valueStr})`)
			return null
		}

		return value
	} catch {
		instance.log('warn', `Could not evaluate expression: ${parsedValue} (from: ${valueStr})`)
		return null
	}
}

/**
 * Process a JSON value (parse variables and parse JSON)
 */
async function processJSONValue(
	instance: DisguiseInstance,
	context: CompanionActionContext,
	valueStr: string,
): Promise<any | null> {
	const parsedValue = await context.parseVariablesInString(valueStr)

	try {
		return JSON.parse(parsedValue)
	} catch {
		instance.log('error', `Value is not valid JSON: ${parsedValue} (from: ${valueStr})`)
		return null
	}
}

export function getActionDefinitions(instance: DisguiseInstance): DisguiseActionDefinitions {
	return {
		setToDisguiseString: {
			name: 'Set to Disguise (String)',
			description: 'Set a Disguise property using an existing LiveUpdate Variable',
			options: [
				{
					type: 'textinput',
					label: 'Variable Name',
					id: 'variableName',
					default: '',
					useVariables: false,
					tooltip: 'The variable name from your LiveUpdate Variable feedback (e.g., "fps", "track_length")',
				},
				{
					type: 'textinput',
					label: 'Value',
					id: 'value',
					default: '',
					useVariables: true,
					tooltip: 'The string value to set (can use variables like $(liveupdate:my_var))',
				},
			],
			callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
				const variableName = String(action.options.variableName || '')
				const valueStr = String(action.options.value || '')

				const subscription = getSubscriptionForAction(instance, variableName)
				if (!subscription) return

				const value = await processStringValue(context, valueStr)
				instance.setProperty(subscription.id, value)
			},
		},

		setToDisguiseNumber: {
			name: 'Set to Disguise (Number)',
			description: 'Set a Disguise property using an existing LiveUpdate Variable',
			options: [
				{
					type: 'textinput',
					label: 'Variable Name',
					id: 'variableName',
					default: '',
					useVariables: false,
					tooltip: 'The variable name from your LiveUpdate Variable feedback (e.g., "fps", "track_length")',
				},
				{
					type: 'textinput',
					label: 'Value',
					id: 'value',
					default: '0',
					useVariables: true,
					tooltip:
						'The numeric value or expression to set (e.g., "5", "$(liveupdate:screen_x)+1", "$(liveupdate:fps)*2")',
				},
			],
			callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
				const variableName = String(action.options.variableName || '')
				const valueStr = String(action.options.value || '0')

				const subscription = getSubscriptionForAction(instance, variableName)
				if (!subscription) return

				const value = await processNumberValue(instance, context, valueStr)
				if (value === null) return

				instance.setProperty(subscription.id, value)
			},
		},

		setToDisguiseBoolean: {
			name: 'Set to Disguise (Boolean)',
			description: 'Set a Disguise property using an existing LiveUpdate Variable',
			options: [
				{
					type: 'textinput',
					label: 'Variable Name',
					id: 'variableName',
					default: '',
					useVariables: false,
					tooltip: 'The variable name from your LiveUpdate Variable feedback (e.g., "fps", "track_length")',
				},
				{
					type: 'checkbox',
					label: 'Value',
					id: 'value',
					default: true,
					tooltip: 'The boolean value to set',
				},
			],
			callback: async (action: CompanionActionEvent, _context: CompanionActionContext) => {
				const variableName = String(action.options.variableName || '')
				const value = Boolean(action.options.value)

				const subscription = getSubscriptionForAction(instance, variableName)
				if (!subscription) return

				instance.setProperty(subscription.id, value)
			},
		},

		setToDisguiseJSON: {
			name: 'Set to Disguise (JSON)',
			description: 'Set a Disguise property using an existing LiveUpdate Variable',
			options: [
				{
					type: 'textinput',
					label: 'Variable Name',
					id: 'variableName',
					default: '',
					useVariables: false,
					tooltip: 'The variable name from your LiveUpdate Variable feedback (e.g., "fps", "track_length")',
				},
				{
					type: 'textinput',
					label: 'JSON Value',
					id: 'value',
					default: '{}',
					useVariables: true,
					tooltip: 'Valid JSON object or value (e.g., {"x": 1.0, "y": 2.0, "z": 3.0})',
				},
			],
			callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
				const variableName = String(action.options.variableName || '')
				const valueStr = String(action.options.value || '{}')

				const subscription = getSubscriptionForAction(instance, variableName)
				if (!subscription) return

				const value = await processJSONValue(instance, context, valueStr)
				if (value === null) return

				instance.setProperty(subscription.id, value)
			},
		},

		setToDisguiseToggle: {
			name: 'Toggle Disguise Boolean',
			description: 'Flip a boolean Disguise property using the current value of its LiveUpdate Variable',
			options: [
				{
					type: 'textinput',
					label: 'Variable Name',
					id: 'variableName',
					default: '',
					useVariables: false,
					tooltip: 'The variable name from your LiveUpdate Variable feedback (e.g., "layerEnabled")',
				},
			],
			callback: async (action: CompanionActionEvent, _context: CompanionActionContext) => {
				const variableName = String(action.options.variableName || '')

				const subscription = getSubscriptionForAction(instance, variableName)
				if (!subscription) return

				const current = readBooleanValue(subscription.value)
				if (current === undefined) {
					instance.log(
						'warn',
						`Variable '${variableName}' has no boolean value yet (${JSON.stringify(subscription.value)}), cannot toggle`,
					)
					return
				}

				instance.setProperty(subscription.id, !current)
			},
		},

		setSelection: {
			name: 'Set selection',
			description:
				'Set one of the selection variables (selTrack, selScreen, ...) that the presets embed in their object paths. Every preset built on the selection re-subscribes to the new object.',
			options: [
				{
					type: 'dropdown',
					label: 'Selection',
					id: 'selection',
					default: SELECTIONS[0].id,
					choices: SELECTIONS.map((selection) => ({ id: selection.id, label: selection.label })),
				},
				{
					type: 'textinput',
					label: 'Value',
					id: 'value',
					default: '',
					useVariables: true,
					tooltip: 'New value, used verbatim in the object paths (can use variables such as $(custom:show_track))',
				},
			],
			callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
				const selection = String(action.options.selection || '')
				const value = await context.parseVariablesInString(String(action.options.value ?? ''))
				instance.setSelection(selection, value)
			},
		},
	}
}
