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
      description: 'Set a Disguise property from a value (string)',
      options: [
        {
          type: 'textinput',
          label: 'Value',
          id: 'value',
          default: '',
          useVariables: true,
          tooltip: 'The value to set (can use variables like \$(liveupdate:my_var))',
        },
        {
          type: 'textinput',
          label: 'Object Path',
          id: 'objectPath',
          default: 'track:track_1',
          useVariables: true,
          tooltip: 'Designer expression to find the object',
        },
        {
          type: 'textinput',
          label: 'Property Path',
          id: 'propertyPath',
          default: 'object.description',
          useVariables: true,
          tooltip: 'Python expression to access property',
        },
      ],
      callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
        const valueRaw = String(action.options.value || '')
        const objectPathRaw = String(action.options.objectPath || '')
        const propertyPathRaw = String(action.options.propertyPath || '')
        
        const value = await instance.parseVariablesInString(valueRaw)
        const objectPath = await instance.parseVariablesInString(objectPathRaw)
        const propertyPath = await instance.parseVariablesInString(propertyPathRaw)
        
        if (!objectPath || !propertyPath) {
          instance.log('warn', 'Object path and property path are required')
          return
        }
        
        instance.setPropertyByPath(objectPath, propertyPath, value)
      },
    },

    setToDisguiseNumber: {
      name: 'Set to Disguise (Number)',
      description: 'Set a Disguise property from a numeric value',
      options: [
        {
          type: 'textinput',
          label: 'Value',
          id: 'value',
          default: '0',
          useVariables: true,
          regex: Regex.SIGNED_FLOAT,
          tooltip: 'The numeric value to set (can use variables)',
        },
        {
          type: 'textinput',
          label: 'Object Path',
          id: 'objectPath',
          default: 'track:track_1',
          useVariables: true,
          tooltip: 'Designer expression to find the object',
        },
        {
          type: 'textinput',
          label: 'Property Path',
          id: 'propertyPath',
          default: 'object.lengthInBeats',
          useVariables: true,
          tooltip: 'Python expression to access property',
        },
      ],
      callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
        const valueStr = await instance.parseVariablesInString(String(action.options.value || '0'))
        const objectPathRaw = String(action.options.objectPath || '')
        const propertyPathRaw = String(action.options.propertyPath || '')
        
        const objectPath = await instance.parseVariablesInString(objectPathRaw)
        const propertyPath = await instance.parseVariablesInString(propertyPathRaw)
        
        if (!objectPath || !propertyPath) {
          instance.log('warn', 'Object path and property path are required')
          return
        }
        
        const value = parseFloat(valueStr)
        
        if (isNaN(value)) {
          instance.log('warn', `Value is not a valid number: ${valueStr}`)
          return
        }
        
        instance.setPropertyByPath(objectPath, propertyPath, value)
      },
    },

    setToDisguiseBoolean: {
      name: 'Set to Disguise (Boolean)',
      description: 'Set a Disguise property to a boolean value',
      options: [
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
        {
          type: 'textinput',
          label: 'Object Path',
          id: 'objectPath',
          default: 'track:track_1',
          useVariables: true,
          tooltip: 'Designer expression to find the object',
        },
        {
          type: 'textinput',
          label: 'Property Path',
          id: 'propertyPath',
          default: 'object.isEnabled',
          useVariables: true,
          tooltip: 'Python expression to access property',
        },
      ],
      callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
        const value = action.options.value === 'true'
        const objectPathRaw = String(action.options.objectPath || '')
        const propertyPathRaw = String(action.options.propertyPath || '')
        
        const objectPath = await instance.parseVariablesInString(objectPathRaw)
        const propertyPath = await instance.parseVariablesInString(propertyPathRaw)
        
        if (!objectPath || !propertyPath) {
          instance.log('warn', 'Object path and property path are required')
          return
        }
        
        instance.setPropertyByPath(objectPath, propertyPath, value)
      },
    },

    setToDisguiseJSON: {
      name: 'Set to Disguise (JSON)',
      description: 'Set a Disguise property to a JSON value',
      options: [
        {
          type: 'textinput',
          label: 'JSON Value',
          id: 'value',
          default: '{}',
          useVariables: true,
          tooltip: 'Valid JSON object or value (e.g., {"x": 1.0, "y": 2.0, "z": 3.0})',
        },
        {
          type: 'textinput',
          label: 'Object Path',
          id: 'objectPath',
          default: 'screen2:screen_1',
          useVariables: true,
          tooltip: 'Designer expression to find the object',
        },
        {
          type: 'textinput',
          label: 'Property Path',
          id: 'propertyPath',
          default: 'object.offset',
          useVariables: true,
          tooltip: 'Python expression to access property',
        },
      ],
      callback: async (action: CompanionActionEvent, context: CompanionActionContext) => {
        const valueStr = await instance.parseVariablesInString(String(action.options.value || '{}'))
        const objectPathRaw = String(action.options.objectPath || '')
        const propertyPathRaw = String(action.options.propertyPath || '')
        
        const objectPath = await instance.parseVariablesInString(objectPathRaw)
        const propertyPath = await instance.parseVariablesInString(propertyPathRaw)
        
        if (!objectPath || !propertyPath) {
          instance.log('warn', 'Object path and property path are required')
          return
        }
        
        try {
          const value = JSON.parse(valueStr)
          instance.setPropertyByPath(objectPath, propertyPath, value)
        } catch (error) {
          instance.log('error', `Value is not valid JSON: ${valueStr}`)
        }
      },
    },
  }
}
