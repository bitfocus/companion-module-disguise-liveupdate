import {
  CompanionActionDefinition,
  CompanionActionDefinitions,
  CompanionActionEvent,
  Regex,
} from '@companion-module/base'
import type { DisguiseInstance } from './index'

export interface DisguiseActionDefinitions extends CompanionActionDefinitions {
  subscribe: CompanionActionDefinition
  unsubscribe: CompanionActionDefinition
  setPropertyString: CompanionActionDefinition
  setPropertyNumber: CompanionActionDefinition
  setPropertyBoolean: CompanionActionDefinition
  setPropertyJSON: CompanionActionDefinition
}

export function getActionDefinitions(instance: DisguiseInstance): DisguiseActionDefinitions {
  return {
    subscribe: {
      name: 'Subscribe to Property',
      description: 'Subscribe to a LiveUpdate property to monitor its value',
      options: [
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
          type: 'textinput',
          label: 'Custom Variable Name (optional)',
          id: 'customVariableName',
          default: '',
          useVariables: false,
          tooltip: 'Optional: Create a variable with this name (e.g., "fps" creates $(disguise-liveupdate:fps))',
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
        {
          type: 'checkbox',
          label: 'Auto-subscribe on connect',
          id: 'autoSubscribe',
          default: false,
          tooltip: 'Automatically subscribe to this property whenever Companion connects or reconnects to Disguise',
        },
      ],
      callback: async (action: CompanionActionEvent) => {
        const objectPathRaw = String(action.options.objectPath || '')
        const propertyPathRaw = String(action.options.propertyPath || '')

        const objectPath = await instance.parseVariablesInString(objectPathRaw)
        const propertyPath = await instance.parseVariablesInString(propertyPathRaw)

        const customVariableName = String(action.options.customVariableName || '')
        const updateFrequency = Number(action.options.updateFrequency)
        const autoSubscribe = Boolean(action.options.autoSubscribe)

        if (!objectPath || !propertyPath) {
          return
        }

        instance.subscribe(
          objectPath,
          [propertyPath],
          customVariableName || undefined,
          updateFrequency > 0 ? updateFrequency : undefined,
          autoSubscribe
        )
      },
    },

    unsubscribe: {
      name: 'Unsubscribe from Property',
      description: 'Unsubscribe from a LiveUpdate property by subscription ID',
      options: [
        {
          type: 'number',
          label: 'Subscription ID',
          id: 'subscriptionId',
          default: 0,
          min: 0,
          max: 999999,
          tooltip: 'The subscription ID to unsubscribe from',
        },
        {
          type: 'checkbox',
          label: 'Remove from auto-subscribe list',
          id: 'removeFromAutoSubscribe',
          default: false,
          tooltip: 'Also remove this subscription from the auto-subscribe list',
        },
      ],
      callback: async (action: CompanionActionEvent) => {
        const subscriptionId = Number(action.options.subscriptionId)
        const removeFromAutoSubscribe = Boolean(action.options.removeFromAutoSubscribe)
        instance.unsubscribe(subscriptionId, removeFromAutoSubscribe)
      },
    },

    setPropertyString: {
      name: 'Set Property (String)',
      description: 'Set a string value for a subscribed property',
      options: [
        {
          type: 'number',
          label: 'Subscription ID',
          id: 'subscriptionId',
          default: 0,
          min: 0,
          max: 999999,
          tooltip: 'The subscription ID of the property to set',
        },
        {
          type: 'textinput',
          label: 'Value',
          id: 'value',
          default: '',
          useVariables: true,
        },
      ],
      callback: async (action: CompanionActionEvent) => {
        const subscriptionId = Number(action.options.subscriptionId)
        const value = String(action.options.value || '')
        instance.setProperty(subscriptionId, value)
      },
    },

    setPropertyNumber: {
      name: 'Set Property (Number)',
      description: 'Set a numeric value for a subscribed property',
      options: [
        {
          type: 'number',
          label: 'Subscription ID',
          id: 'subscriptionId',
          default: 0,
          min: 0,
          max: 999999,
          tooltip: 'The subscription ID of the property to set',
        },
        {
          type: 'textinput',
          label: 'Value',
          id: 'value',
          default: '0',
          useVariables: true,
          regex: Regex.SIGNED_FLOAT,
        },
      ],
      callback: async (action: CompanionActionEvent) => {
        const subscriptionId = Number(action.options.subscriptionId)
        const valueStr = String(action.options.value || '0')
        const value = parseFloat(valueStr)
        
        if (isNaN(value)) {
          instance.log('warn', `Invalid number value: ${valueStr}`)
          return
        }
        
        instance.setProperty(subscriptionId, value)
      },
    },

    setPropertyBoolean: {
      name: 'Set Property (Boolean)',
      description: 'Set a boolean value for a subscribed property',
      options: [
        {
          type: 'number',
          label: 'Subscription ID',
          id: 'subscriptionId',
          default: 0,
          min: 0,
          max: 999999,
          tooltip: 'The subscription ID of the property to set',
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
        },
      ],
      callback: async (action: CompanionActionEvent) => {
        const subscriptionId = Number(action.options.subscriptionId)
        const value = action.options.value === 'true'
        instance.setProperty(subscriptionId, value)
      },
    },

    setPropertyJSON: {
      name: 'Set Property (JSON)',
      description: 'Set a complex JSON value for a subscribed property',
      options: [
        {
          type: 'number',
          label: 'Subscription ID',
          id: 'subscriptionId',
          default: 0,
          min: 0,
          max: 999999,
          tooltip: 'The subscription ID of the property to set',
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
      callback: async (action: CompanionActionEvent) => {
        const subscriptionId = Number(action.options.subscriptionId)
        const valueStr = String(action.options.value || '{}')
        
        try {
          const value = JSON.parse(valueStr)
          instance.setProperty(subscriptionId, value)
        } catch (error) {
          instance.log('error', `Invalid JSON: ${valueStr} - ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    },
  }
}
