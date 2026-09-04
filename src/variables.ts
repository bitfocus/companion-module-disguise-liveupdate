import { CompanionVariableDefinition } from '@companion-module/base'
import { SELECTIONS } from './selections'

/**
 * Static variable definitions. Dynamic variables for LiveUpdate subscriptions are appended
 * by the instance (one per active subscription, named after the feedback's Variable Name).
 */
export function getVariableDefinitions(): CompanionVariableDefinition[] {
	return [
		{
			variableId: 'connection_status',
			name: 'Connection Status',
		},
		{ variableId: 'rest_last_command', name: 'Command: last command sent' },
		{ variableId: 'rest_last_status', name: 'Command: last result (OK / FAILED / UNSUPPORTED)' },
		{ variableId: 'rest_last_message', name: 'Command: last message from the Director' },
		{ variableId: 'rest_armed', name: 'Command: destructive command waiting for confirmation' },
		...SELECTIONS.map((selection): CompanionVariableDefinition => ({
			variableId: selection.id,
			name: `Selection: ${selection.label}`,
		})),
	]
}
