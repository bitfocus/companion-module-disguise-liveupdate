import {
  CompanionActionDefinition,
  CompanionActionDefinitions,
  CompanionActionEvent,
  CompanionActionContext,
  Regex,
} from '@companion-module/base'
import type { DisguiseInstance } from './index'
import type { LiveUpdateSubscription } from './index'

export interface DisguiseActionDefinitions extends CompanionActionDefinitions {
  setToDisguiseString: CompanionActionDefinition
  setToDisguiseNumber: CompanionActionDefinition
  setToDisguiseBoolean: CompanionActionDefinition
  setToDisguiseJSON: CompanionActionDefinition
}

/**
 * Helper function to validate variable name and get subscription
 */
function getSubscriptionForAction(
  instance: DisguiseInstance,
  variableName: string
): LiveUpdateSubscription | null {
  if (!variableName) {
    instance.log('warn', 'Variable name is required')
    return null
  }

  const subscription = instance.getSubscriptionByVariableName(variableName)
  if (!subscription) {
    instance.log('warn', `No LiveUpdate Variable found with name '${variableName}'. Add a LiveUpdate Variable feedback first.`)
    return null
  }

  return subscription
}

/**
 * Process a string value (parse variables)
 */
async function processStringValue(
  context: CompanionActionContext,
  valueStr: string
): Promise<string> {
  return await context.parseVariablesInString(valueStr)
}

/**
 * Process a numeric value (parse variables and evaluate expression)
 */
async function processNumberValue(
  instance: DisguiseInstance,
  context: CompanionActionContext,
  valueStr: string
): Promise<number | null> {
  const parsedValue = await context.parseVariablesInString(valueStr)

  try {
    // Evaluate mathematical expressions like "5+1", "10*2", "$(var)+1"
    const value = new Function('return ' + parsedValue)() as number

    if (typeof value !== 'number' || isNaN(value)) {
      instance.log('warn', `Value is not a valid number: ${parsedValue} (from: ${valueStr})`)
      return null
    }

    return value
  } catch (error) {
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
  valueStr: string
): Promise<any | null> {
  const parsedValue = await context.parseVariablesInString(valueStr)

  try {
    return JSON.parse(parsedValue)
  } catch (error) {
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
          tooltip: 'The numeric value or expression to set (e.g., "5", "$(liveupdate:screen_x)+1", "$(liveupdate:fps)*2")',
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
      callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
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
  }
}
