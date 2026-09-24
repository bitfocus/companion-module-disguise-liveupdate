import { CompanionVariableDefinition } from '@companion-module/base'
import { SELECTIONS } from './selections'

/** Written into every readout variable while the Director is not connected */
export const OFFLINE_VALUE = 'OFFLINE'
/** The Director refused the object path of the subscription */
export const ERROR_VALUE = 'ERROR'
/** The Director answered the property path with an error */
export const PATH_ERROR_VALUE = 'PATH_ERROR'
/** The property path failed three times in a row; the subscription is retried with a back-off */
export const PATH_ERROR_UNSUBSCRIBED_VALUE = 'PATH_ERROR (unsubscribed)'
/** The path cannot be resolved yet: an empty selection, $NA or an unparsed $(...) reference */
export const UNSET_VALUE = 'UNSET'

/**
 * Every text the module writes into a readout variable instead of a Director value. A button shows
 * these verbatim, so the list is the one place that says what an operator can see besides a value.
 */
export const SENTINELS: readonly string[] = [
	OFFLINE_VALUE,
	ERROR_VALUE,
	PATH_ERROR_VALUE,
	PATH_ERROR_UNSUBSCRIBED_VALUE,
	UNSET_VALUE,
]

const SENTINEL_SET: ReadonlySet<string> = new Set(SENTINELS)

/** True for one of the SENTINELS */
export function isSentinel(value: unknown): value is string {
	return typeof value === 'string' && SENTINEL_SET.has(value)
}

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
		{ variableId: 'designer_version', name: 'Designer version of the connected Director' },
		{ variableId: 'selfcheck_progress', name: 'Preset check: progress (distinct properties checked / to check)' },
		{ variableId: 'selfcheck_ok', name: 'Preset check: properties that answered' },
		{ variableId: 'selfcheck_failed', name: 'Preset check: properties that did not' },
		{
			variableId: 'selfcheck_skipped',
			name: 'Preset check: properties skipped because a selection they need is empty',
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

let reserved: ReadonlySet<string> | undefined

/**
 * Variable ids the module defines itself (connection status, Designer version, the preset check,
 * the command channel and every selection); a LiveUpdate Variable feedback must not reuse them.
 */
export function isReservedVariableName(name: string): boolean {
	reserved ??= new Set(getVariableDefinitions().map((definition) => definition.variableId))
	return reserved.has(name)
}
