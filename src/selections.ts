/**
 * Selection variables
 *
 * The preset library addresses show objects through module variables such as
 * `track:"$(liveupdate:selTrack)"`. Companion parses those references before the
 * feedback runs and re-evaluates the feedback whenever the variable changes, so
 * changing a selection re-points every preset built on it. Selections are edited in
 * the connection settings or with the "Set selection" action and are persisted in
 * the connection config under their variable id.
 */
export interface SelectionDefinition {
	/** Variable id (also the connection config key) */
	id: string
	/** Short label used in the settings and the action dropdown */
	label: string
	/** What the operator should enter */
	description: string
	/** Example value shown as a placeholder */
	example: string
	/** Only used by experimental presets */
	experimental: boolean
}

export const SELECTIONS: readonly SelectionDefinition[] = [
	{
		id: 'selTrack',
		label: 'Track',
		description: 'Track name as shown in Designer (the presets quote it)',
		example: 'Track 1',
		experimental: false,
	},
	{
		id: 'selLayer',
		label: 'Layer',
		description: 'Layer name inside the selected track',
		example: 'Video 1',
		experimental: false,
	},
	{
		id: 'selLayerIndex',
		label: 'Layer index',
		description: '0-based leaf-layer index used by the index-based layer probes',
		example: '0',
		experimental: false,
	},
	{
		id: 'selSection',
		label: 'Section index',
		description: '0-based section index of the selected track',
		example: '0',
		experimental: false,
	},
	{
		id: 'selBeat',
		label: 'Beat',
		description: 'Track beat (number) used by the beat-based readouts',
		example: '32',
		experimental: false,
	},
	{
		id: 'selScreen',
		label: 'Surface (screen2)',
		description: 'Surface name as shown in the Stage',
		example: 'Surface 1',
		experimental: false,
	},
	{
		id: 'selProjector',
		label: 'Projector',
		description: 'Projector name as shown in the Stage',
		example: 'Projector 1',
		experimental: false,
	},
	{
		id: 'selScreenUid',
		label: 'Display UID',
		description: 'UID of any display, hex with 0x prefix (right-click the editor title bar > Copy UID)',
		example: '0x0123456789abcdef',
		experimental: false,
	},
	{
		id: 'selMachine',
		label: 'Machine',
		description: 'Machine resource name as listed in d3Net Manager',
		example: 'Director',
		experimental: false,
	},
	{
		id: 'selHost',
		label: 'Remote host',
		description: 'Hostname of the remote machine WITHOUT the :d3 suffix (the presets append it)',
		example: 'ACTOR01',
		experimental: false,
	},
	{
		id: 'selWorkload',
		label: 'RenderStream workload id',
		description:
			'Workload id as an integer (REST GET /api/session/renderstream/layerstatus or the Cluster Workload widget > Copy UID)',
		example: '1234',
		experimental: false,
	},
	{
		id: 'selInstance',
		label: 'RenderStream instance index',
		description: '0-based instance index inside the workload',
		example: '0',
		experimental: false,
	},
	{
		id: 'selEvUid',
		label: 'Expression Variables device UID',
		description: 'UID of the Expression Variables device, hex with 0x prefix',
		example: '0x0123456789abcdef',
		experimental: false,
	},
	{
		id: 'selEvIndex',
		label: 'Expression variable index',
		description: '0-based row index of the variable inside the device',
		example: '0',
		experimental: false,
	},
	{
		id: 'selTransport',
		label: 'Transport manager (experimental)',
		description: 'Transport manager name other than default',
		example: 'default',
		experimental: true,
	},
	{
		id: 'selLedScreen',
		label: 'LED screen (experimental)',
		description: 'LED screen name',
		example: 'LED 1',
		experimental: true,
	},
	{
		id: 'selDmxScreen',
		label: 'DMX screen (experimental)',
		description: 'DMX screen name',
		example: 'DMX 1',
		experimental: true,
	},
	{
		id: 'selStageUid',
		label: 'Stage UID (experimental)',
		description: 'Stage UID, hex with 0x prefix',
		example: '0x0123456789abcdef',
		experimental: true,
	},
	{
		id: 'selEvDevice',
		label: 'Expression Variables device (experimental)',
		description: 'Device name (file name part of objects/ExpressionVariablesDevice/<name>.apx)',
		example: 'ShowVars',
		experimental: true,
	},
	{
		id: 'selEvName',
		label: 'Expression variable name (experimental)',
		description: 'Variable name, case-sensitive',
		example: 'master_level',
		experimental: true,
	},
	{
		id: 'selEvLayer',
		label: 'Expression Variables layer (experimental)',
		description: 'Expression Variables layer name (module: prefix)',
		example: 'Vars',
		experimental: true,
	},
	{
		id: 'selRsLayer',
		label: 'RenderStream layer index (experimental)',
		description: "0-based index among the selected track's RenderStream leaf layers",
		example: '0',
		experimental: true,
	},
]

export const SELECTION_IDS: readonly string[] = SELECTIONS.map((s) => s.id)

export function isSelectionId(id: string): boolean {
	return SELECTION_IDS.includes(id)
}

/**
 * Read the selection values stored in a config object (unset selections are empty strings)
 */
export function readSelections(config: Record<string, unknown>): Record<string, string> {
	const values: Record<string, string> = {}
	for (const selection of SELECTIONS) {
		const raw = config[selection.id]
		values[selection.id] =
			typeof raw === 'string' ? raw : typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : ''
	}
	return values
}
