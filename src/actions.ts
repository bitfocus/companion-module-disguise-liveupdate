import {
	CompanionActionDefinition,
	CompanionActionDefinitions,
	CompanionActionEvent,
	CompanionActionContext,
	InputValue,
} from '@companion-module/base'
import type { DisguiseInstance } from './index'
import type { LiveUpdateSubscription } from './index'
import { SELECTIONS } from './selections'
import { isSentinel } from './variables'

export interface DisguiseActionDefinitions extends CompanionActionDefinitions {
	setToDisguiseString: CompanionActionDefinition
	setToDisguiseNumber: CompanionActionDefinition
	nudgeDisguiseNumber: CompanionActionDefinition
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
 * A Number value that starts with an operator once its variables are substituted: what a step such as
 * `$(liveupdate:brightness)-0.05` becomes while that readout is empty. Companion 5.0.4 substitutes the
 * Value option before the action runs, so the reference itself never reaches the module.
 */
const LEADING_OPERATOR = /^\s*[-+*/%]/

/**
 * Process a numeric value (parse variables and evaluate expression)
 */
async function processNumberValue(
	instance: DisguiseInstance,
	context: CompanionActionContext,
	subscription: LiveUpdateSubscription,
	valueStr: string,
): Promise<number | null> {
	// Companion has substituted the variables already; a host that passes the raw text gets them
	// substituted here, so the check below sees the same text either way
	const parsedValue = await context.parseVariablesInString(valueStr)

	// '-0.05' may be meant as -0.05 or be a step whose base was empty; while the property has no number
	// it cannot be told apart, and writing a step as an absolute value is what must not happen
	const current = subscription.value
	if (LEADING_OPERATOR.test(parsedValue) && !(typeof current === 'number' && Number.isFinite(current))) {
		instance.log(
			'warn',
			`Not writing: '${subscription.variableName}' has no numeric value yet (${JSON.stringify(current)}) and '${parsedValue}' starts with an operator, so it may be a step from an empty readout (Nudge Disguise Number writes steps)`,
		)
		return null
	}

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
 * Read a number option of Nudge Disguise Number: undefined when it is empty, null (logged) when it is
 * not a finite number. A typo is refused rather than read as "no limit" or as a step of 0.
 */
async function readNumberOption(
	instance: DisguiseInstance,
	context: CompanionActionContext,
	variableName: string,
	raw: InputValue | undefined,
	label: string,
): Promise<number | undefined | null> {
	const text = (await context.parseVariablesInString(String(raw ?? ''))).trim()
	if (text === '') return undefined
	const value = Number(text)
	if (!Number.isFinite(value)) {
		instance.log('warn', `Not writing: the ${label} for '${variableName}' is not a number: '${text}'`)
		return null
	}
	return value
}

/**
 * Process a JSON value (parse variables and parse JSON)
 */
async function processJSONValue(
	instance: DisguiseInstance,
	context: CompanionActionContext,
	valueStr: string,
): Promise<any | undefined> {
	const parsedValue = await context.parseVariablesInString(valueStr)

	try {
		// undefined marks a parse failure so a deliberate JSON null is still written
		return JSON.parse(parsedValue)
	} catch {
		instance.log('error', `Value is not valid JSON: ${parsedValue} (from: ${valueStr})`)
		return undefined
	}
}

/** The selections a profile button is most likely to switch together */
const PROFILE_SELECTIONS = SELECTIONS.filter((selection) =>
	['selTrack', 'selLayer', 'selScreen', 'selProjector', 'selMachine', 'selWorkload'].includes(selection.id),
)

/**
 * One action per selection. When the Director has been asked for the list (see the "Refresh
 * selection lists" action) the value is a dropdown of the real names, which is the difference
 * between a working button and a PATH_ERROR from a typo; a name can still be typed by hand.
 */
function getSelectionActions(instance: DisguiseInstance): CompanionActionDefinitions {
	const actions: CompanionActionDefinitions = {}
	for (const selection of SELECTIONS) {
		const choices = instance.discoveryChoices?.get(selection.id) ?? []
		actions[`setSelection_${selection.id}`] = {
			name: `Set selection: ${selection.label}`,
			description: selection.description,
			options: [
				choices.length
					? {
							type: 'dropdown',
							label: 'Value',
							id: 'value',
							default: choices[0],
							choices: choices.map((value) => ({ id: value, label: value })),
							allowCustom: true,
							tooltip: `Read from the Director. Example: ${selection.example}`,
						}
					: {
							type: 'textinput',
							label: 'Value',
							id: 'value',
							default: '',
							useVariables: true,
							tooltip: `Example: ${selection.example}. Use "Refresh selection lists" to pick from the Director instead.`,
						},
			],
			callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
				const value = await context.parseVariablesInString(String(action.options.value ?? ''))
				instance.setSelection(selection.id, value)
			},
		}
	}
	return actions
}

export function getActionDefinitions(instance: DisguiseInstance): DisguiseActionDefinitions {
	return {
		...getSelectionActions(instance),
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
				// A value that is exactly a readout marker came from a readout with no value yet
				// ($(liveupdate:x) while x says PENDING or OFFLINE); writing the word into the show would
				// replace the property with a status text.
				if (isSentinel(value.trim())) {
					instance.log(
						'warn',
						`Set to Disguise (String) for '${variableName}' not sent: '${value.trim()}' is what a readout shows while it has no value`,
					)
					return
				}
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
						'The numeric value or expression to set (e.g., "5", "$(liveupdate:fps)*2"). To step from the current value, use Nudge Disguise Number.',
				},
			],
			callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
				const variableName = String(action.options.variableName || '')
				const valueStr = String(action.options.value || '0')

				const subscription = getSubscriptionForAction(instance, variableName)
				if (!subscription) return

				const value = await processNumberValue(instance, context, subscription, valueStr)
				if (value === null) return

				instance.setProperty(subscription.id, value)
			},
		},

		nudgeDisguiseNumber: {
			name: 'Nudge Disguise Number',
			description:
				'Add a step to the current value of a numeric Disguise property, optionally kept within a minimum and a maximum. Nothing is written while its LiveUpdate Variable has no number.',
			options: [
				{
					type: 'textinput',
					label: 'Variable Name',
					id: 'variableName',
					default: '',
					useVariables: false,
					tooltip: 'The variable name from your LiveUpdate Variable feedback (e.g., "brightness")',
				},
				{
					type: 'textinput',
					label: 'Step',
					id: 'delta',
					default: '1',
					useVariables: true,
					tooltip: 'Added to the current value; negative to go down (e.g., "0.05", "-1")',
				},
				{
					type: 'textinput',
					label: 'Minimum',
					id: 'min',
					default: '',
					useVariables: true,
					tooltip: 'The result is never written below this; leave empty for no minimum',
				},
				{
					type: 'textinput',
					label: 'Maximum',
					id: 'max',
					default: '',
					useVariables: true,
					tooltip: 'The result is never written above this; leave empty for no maximum',
				},
			],
			callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
				const variableName = String(action.options.variableName || '')

				const subscription = getSubscriptionForAction(instance, variableName)
				if (!subscription) return

				const delta = await readNumberOption(instance, context, variableName, action.options.delta, 'Step')
				if (delta === undefined) instance.log('warn', `Not writing: the Step for '${variableName}' is empty`)
				if (delta === undefined || delta === null) return
				const min = await readNumberOption(instance, context, variableName, action.options.min, 'Minimum')
				if (min === null) return
				const max = await readNumberOption(instance, context, variableName, action.options.max, 'Maximum')
				if (max === null) return
				if (min !== undefined && max !== undefined && min > max) {
					instance.log('warn', `Not writing: the Minimum ${min} for '${variableName}' is above the Maximum ${max}`)
					return
				}

				instance.nudgeProperty(subscription.id, delta, min, max)
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
				if (value === undefined) return

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

		checkPresets: {
			name: 'Check presets against this Director',
			description:
				'Subscribes once to every preset property whose selections are filled in, records whether the Director accepted it and releases it again. The counts land in the selfcheck_* variables. It does not touch the subscriptions your buttons already hold: a property a button holds is read from that button.',
			options: [],
			callback: async () => {
				await instance.runSelfCheck()
			},
		},

		refreshSelectionLists: {
			name: 'Refresh selection lists',
			description:
				'Ask the Director for the tracks, layers, surfaces, projectors, machines and other names, so the per-selection actions offer the real ones. Runs once on connect; use this after the show file changes.',
			options: [],
			callback: async () => {
				await instance.refreshDiscovery()
			},
		},

		setSelectionProfile: {
			name: 'Set selection profile',
			description:
				'Apply several selections with one press, so a button re-points a whole page at another part of the show. A field left empty leaves that selection unchanged.',
			options: PROFILE_SELECTIONS.map((selection) => ({
				type: 'textinput' as const,
				label: selection.label,
				id: selection.id,
				default: '',
				useVariables: true,
			})),
			callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
				for (const selection of PROFILE_SELECTIONS) {
					const raw = String(action.options[selection.id] ?? '')
					if (!raw.trim()) continue
					instance.setSelection(selection.id, await context.parseVariablesInString(raw))
				}
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
