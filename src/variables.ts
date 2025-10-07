import { CompanionVariableDefinition } from '@companion-module/base'

export function getVariableDefinitions(): CompanionVariableDefinition[] {
  return [
    {
      variableId: 'connection_status',
      name: 'Connection Status',
    },
  ]
}

/**
 * Note: Dynamic variables for subscription values are created automatically
 * when subscriptions are made. They follow the format: sub_<id>
 * where <id> is the subscription ID from the LiveUpdate API.
 * 
 * Example: sub_123 would contain the value for subscription ID 123
 */
