import { CompanionFeedbackDefinitions, combineRgb } from '@companion-module/base'
import type { DisguiseInstance } from './index'

interface DisguiseFeedbackDefinitions extends CompanionFeedbackDefinitions {}

export function getFeedbackDefinitions(
  instance: DisguiseInstance,
): DisguiseFeedbackDefinitions {
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

    subscriptionValueEquals: {
      type: 'boolean',
      name: 'Subscription Value Equals',
      description: 'Check if a subscription value equals a specific value',
      defaultStyle: {
        bgcolor: combineRgb(255, 0, 0),
        color: combineRgb(255, 255, 255),
      },
      options: [
        {
          type: 'number',
          label: 'Subscription ID',
          id: 'subscriptionId',
          default: 0,
          min: 0,
          max: 999999,
        },
        {
          type: 'textinput',
          label: 'Expected Value',
          id: 'expectedValue',
          default: '',
          useVariables: true,
        },
      ],
      callback: async (feedback) => {
        const subscriptionId = Number(feedback.options.subscriptionId)
        const expectedValue = await instance.parseVariablesInString(String(feedback.options.expectedValue || ''))
        const currentValue = instance.getSubscriptionValue(subscriptionId)
        
        if (currentValue === undefined) return false
        
        const currentStr = typeof currentValue === 'object' ? JSON.stringify(currentValue) : String(currentValue)
        return currentStr === expectedValue
      },
    },

    subscriptionValueGreaterThan: {
      type: 'boolean',
      name: 'Subscription Value Greater Than',
      description: 'Check if a subscription numeric value is greater than a threshold',
      defaultStyle: {
        bgcolor: combineRgb(255, 128, 0),
        color: combineRgb(0, 0, 0),
      },
      options: [
        {
          type: 'number',
          label: 'Subscription ID',
          id: 'subscriptionId',
          default: 0,
          min: 0,
          max: 999999,
        },
        {
          type: 'textinput',
          label: 'Threshold',
          id: 'threshold',
          default: '0',
          useVariables: true,
        },
      ],
      callback: async (feedback) => {
        const subscriptionId = Number(feedback.options.subscriptionId)
        const thresholdStr = await instance.parseVariablesInString(String(feedback.options.threshold || '0'))
        const threshold = parseFloat(thresholdStr)
        const currentValue = instance.getSubscriptionValue(subscriptionId)
        
        if (currentValue === undefined || isNaN(threshold)) return false
        
        const numValue = parseFloat(currentValue)
        return !isNaN(numValue) && numValue > threshold
      },
    },

    subscriptionValueLessThan: {
      type: 'boolean',
      name: 'Subscription Value Less Than',
      description: 'Check if a subscription numeric value is less than a threshold',
      defaultStyle: {
        bgcolor: combineRgb(0, 128, 255),
        color: combineRgb(0, 0, 0),
      },
      options: [
        {
          type: 'number',
          label: 'Subscription ID',
          id: 'subscriptionId',
          default: 0,
          min: 0,
          max: 999999,
        },
        {
          type: 'textinput',
          label: 'Threshold',
          id: 'threshold',
          default: '0',
          useVariables: true,
        },
      ],
      callback: async (feedback) => {
        const subscriptionId = Number(feedback.options.subscriptionId)
        const thresholdStr = await instance.parseVariablesInString(String(feedback.options.threshold || '0'))
        const threshold = parseFloat(thresholdStr)
        const currentValue = instance.getSubscriptionValue(subscriptionId)
        
        if (currentValue === undefined || isNaN(threshold)) return false
        
        const numValue = parseFloat(currentValue)
        return !isNaN(numValue) && numValue < threshold
      },
    },

    subscriptionValueBoolean: {
      type: 'boolean',
      name: 'Subscription Value Boolean',
      description: 'Check if a subscription boolean value matches',
      defaultStyle: {
        bgcolor: combineRgb(128, 0, 255),
        color: combineRgb(255, 255, 255),
      },
      options: [
        {
          type: 'number',
          label: 'Subscription ID',
          id: 'subscriptionId',
          default: 0,
          min: 0,
          max: 999999,
        },
        {
          type: 'dropdown',
          label: 'Expected Value',
          id: 'expectedValue',
          default: 'true',
          choices: [
            { id: 'true', label: 'True' },
            { id: 'false', label: 'False' },
          ],
        },
      ],
      callback: (feedback) => {
        const subscriptionId = Number(feedback.options.subscriptionId)
        const expectedValue = feedback.options.expectedValue === 'true'
        const currentValue = instance.getSubscriptionValue(subscriptionId)
        
        if (currentValue === undefined) return false
        
        return Boolean(currentValue) === expectedValue
      },
    },

    variableValueLessThan: {
      type: 'boolean',
      name: 'Variable Value Less Than',
      description: 'Check if a variable numeric value is less than a threshold',
      defaultStyle: {
        bgcolor: combineRgb(200, 0, 0),
        color: combineRgb(255, 255, 255),
      },
      options: [
        {
          type: 'textinput',
          label: 'Variable Name',
          id: 'variableName',
          default: 'fps',
          useVariables: false,
          tooltip: 'Variable name (e.g., "fps", "track_length")',
        },
        {
          type: 'textinput',
          label: 'Threshold',
          id: 'threshold',
          default: '60',
          useVariables: true,
        },
      ],
      callback: async (feedback) => {
        const variableName = String(feedback.options.variableName || '')
        const thresholdStr = await instance.parseVariablesInString(String(feedback.options.threshold || '0'))
        const threshold = parseFloat(thresholdStr)
        
        const currentValue = instance.getCustomVariableValue(variableName)
        
        if (currentValue === undefined || isNaN(threshold)) return false
        
        const numValue = parseFloat(currentValue)
        return !isNaN(numValue) && numValue < threshold
      },
    },
  }
}
