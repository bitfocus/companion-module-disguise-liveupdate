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
		...SELECTIONS.map((selection): CompanionVariableDefinition => ({
			variableId: selection.id,
			name: `Selection: ${selection.label}`,
		})),
	]
}
