import { CompanionFeedbackDefinitions, CompanionFeedbackContext, combineRgb } from '@companion-module/base'
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

    subscribeToProperty: {
      type: 'boolean',
      name: 'Subscribe to Disguise Property',
      description: 'Subscribe to a Disguise property and expose it as a module variable. Use Companion expression variables for comparisons.',
      defaultStyle: {
        bgcolor: combineRgb(0, 0, 0),
        color: combineRgb(255, 255, 255),
      },
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
        // Always return false - this feedback is just for subscribing, not for visual feedback
        // Users should use expression variables to create visual feedback based on the module variable value
        
        // Check if options have changed since last evaluation and ensure subscription is active
        const variableName = String(feedback.options.variableName || '')
        const objectPathRaw = String(feedback.options.objectPath || '')
        const propertyPathRaw = String(feedback.options.propertyPath || '')
        const updateFrequency = Number(feedback.options.updateFrequency)
        
        const objectPath = await instance.parseVariablesInString(objectPathRaw)
        const propertyPath = await instance.parseVariablesInString(propertyPathRaw)
        
        // Check if these differ from what we have subscribed, or if subscription was dropped
        // This provides self-healing behavior
        instance.checkAndUpdateSubscription(
          feedback.id, 
          variableName, 
          objectPath, 
          propertyPath,
          updateFrequency > 0 ? updateFrequency : undefined
        )
        
        return false
      },
      subscribe: async (feedback) => {
        const variableName = String(feedback.options.variableName || '')
        const objectPathRaw = String(feedback.options.objectPath || '')
        const propertyPathRaw = String(feedback.options.propertyPath || '')
        
        const objectPath = await instance.parseVariablesInString(objectPathRaw)
        const propertyPath = await instance.parseVariablesInString(propertyPathRaw)
        const updateFrequency = Number(feedback.options.updateFrequency)
        
        if (!variableName || !objectPath || !propertyPath) {
          instance.log('warn', 'Variable name, object path, and property path are required')
          return
        }
        
        // Check if we already have a subscription for this feedback with different paths
        // This handles the case where user changes options but Companion doesn't call unsubscribe first
        const existingSubscription = instance.getSubscriptionByFeedbackId(feedback.id)
        if (existingSubscription) {
          const pathsChanged = existingSubscription.objectPath !== objectPath || existingSubscription.propertyPath !== propertyPath
          if (pathsChanged) {
            instance.log('info', `Feedback options changed, updating subscription for ${feedback.id}`)
            // Unsubscribe old one first
            instance.unsubscribeFromVariable(feedback.id)
          } else {
            // Subscription already exists with same paths, skip
            return
          }
        }
        
        instance.subscribeToVariable(
          feedback.id,
          variableName,
          objectPath,
          propertyPath,
          updateFrequency > 0 ? updateFrequency : undefined
        )
      },
      unsubscribe: async (feedback) => {
        instance.feedbackOptionsCache.delete(feedback.id)
        instance.unsubscribeFromVariable(feedback.id)
      },
    },
  }
}
