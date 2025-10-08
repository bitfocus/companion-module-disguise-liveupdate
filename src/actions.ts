import {
  CompanionActionDefinition,
  CompanionActionDefinitions,
  CompanionActionEvent,
  CompanionActionContext,
  Regex,
} from '@companion-module/base'
import type { DisguiseInstance } from './index'

export interface DisguiseActionDefinitions extends CompanionActionDefinitions {
  setToDisguiseString: CompanionActionDefinition
  setToDisguiseNumber: CompanionActionDefinition
  setToDisguiseBoolean: CompanionActionDefinition
  setToDisguiseJSON: CompanionActionDefinition
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
        
        if (!variableName) {
          instance.log('warn', 'Variable name is required')
          return
        }
        
        const subscription = instance.getSubscriptionByVariableName(variableName)
        if (!subscription) {
          instance.log('warn', `No LiveUpdate Variable found with name '${variableName}'. Add a LiveUpdate Variable feedback first.`)
          return
        }
        
        // Parse variables in the value string
        const value = await context.parseVariablesInString(valueStr)
        
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
        
        if (!variableName) {
          instance.log('warn', 'Variable name is required')
          return
        }
        
        const subscription = instance.getSubscriptionByVariableName(variableName)
        if (!subscription) {
          instance.log('warn', `No LiveUpdate Variable found with name '${variableName}'. Add a LiveUpdate Variable feedback first.`)
          return
        }
        
        // Parse variables in the value string
        const parsedValue = await context.parseVariablesInString(valueStr)
        
        // Evaluate the expression to get a numeric value
        let value: number
        try {
          // Use Function constructor to safely evaluate mathematical expressions
          // This allows expressions like "5+1", "10*2", "$(var)+1" (after variable substitution)
          value = new Function('return ' + parsedValue)() as number
          
          if (typeof value !== 'number' || isNaN(value)) {
            instance.log('warn', `Value is not a valid number: ${parsedValue} (from: ${valueStr})`)
            return
          }
        } catch (error) {
          instance.log('warn', `Could not evaluate expression: ${parsedValue} (from: ${valueStr})`)
          return
        }
        
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
          type: 'dropdown',
          label: 'Value',
          id: 'value',
          default: 'true',
          choices: [
            { id: 'true', label: 'True' },
            { id: 'false', label: 'False' },
          ],
          tooltip: 'The boolean value to set',
        },
      ],
      callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
        const variableName = String(action.options.variableName || '')
        const value = action.options.value === 'true'
        
        if (!variableName) {
          instance.log('warn', 'Variable name is required')
          return
        }
        
        const subscription = instance.getSubscriptionByVariableName(variableName)
        if (!subscription) {
          instance.log('warn', `No LiveUpdate Variable found with name '${variableName}'. Add a LiveUpdate Variable feedback first.`)
          return
        }
        
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
        
        if (!variableName) {
          instance.log('warn', 'Variable name is required')
          return
        }
        
        const subscription = instance.getSubscriptionByVariableName(variableName)
        if (!subscription) {
          instance.log('warn', `No LiveUpdate Variable found with name '${variableName}'. Add a LiveUpdate Variable feedback first.`)
          return
        }
        
        // Parse variables in the JSON string
        const parsedValue = await context.parseVariablesInString(valueStr)
        
        try {
          const value = JSON.parse(parsedValue)
          instance.setProperty(subscription.id, value)
        } catch (error) {
          instance.log('error', `Value is not valid JSON: ${parsedValue} (from: ${valueStr})`)
        }
      },
    },
  }
}
