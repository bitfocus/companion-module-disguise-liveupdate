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

    liveUpdateVariable: {
      type: 'advanced',
      name: 'LiveUpdate Variable',
      description: 'Create a live-updating module variable that tracks a Disguise property. The variable is exposed as $(liveupdate:variable_name) and can be used anywhere in Companion.',
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
          updateFrequency > 0 ? updateFrequency : undefined
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
          const pathsChanged = existingSubscription.objectPath !== objectPath || existingSubscription.propertyPath !== propertyPath
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
