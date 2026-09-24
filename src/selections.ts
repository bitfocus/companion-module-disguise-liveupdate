/**
 * Selection variables
 *
 * The preset library addresses show objects through module variables such as
 * `track:"$(liveupdate:selTrack)"`. Companion parses those references before the
 * feedback runs and re-evaluates the feedback whenever the variable changes, so
 * changing a selection re-points every preset built on it. Selections are edited in
 * the connection settings or with the "Set selection" action and are persisted in
 * the connection config under their variable id.
 *
 * Selection values are spliced into Designer expressions and Python property paths on
 * the Director, so they are validated by kind before use: names must not contain
 * quotes or line breaks, indices must be plain decimal integers (Python 2.7 would read
 * a leading zero as octal) and UIDs must be decimal or 0x-hex integers.
 */

/** How a selection value is embedded in the paths, which decides what it may contain */
export type SelectionKind = 'name' | 'host' | 'int' | 'number' | 'uid'

export interface SelectionDefinition {
	/** Variable id (also the connection config key) */
	id: string
	/** Short label used in the settings and the action dropdown */
	label: string
	/** What the operator should enter */
	description: string
	/** Example value shown as a placeholder */
	example: string
	kind: SelectionKind
	/** Only used by experimental presets */
	experimental: boolean
}

/**
 * Value published for an unset selection. `$NA` is what Companion itself shows for an unknown
 * variable and the module never subscribes to a path containing it, so an empty selection keeps
 * every preset built on it quiet instead of sending a broken path to the Director.
 */
export const UNSET_SELECTION = '$NA'

export const SELECTIONS: readonly SelectionDefinition[] = [
	{
		id: 'selTrack',
		label: 'Track',
		description: 'Track name as shown in Designer (the presets quote it)',
		example: 'Track 1',
		kind: 'name',
		experimental: false,
	},
	{
		id: 'selLayer',
		label: 'Layer',
		description: 'Layer name inside the selected track',
		example: 'Video 1',
		kind: 'name',
		experimental: false,
	},
	{
		id: 'selLayerIndex',
		label: 'Layer index',
		description: '0-based position in the track layer list (track.layers) used by the "(by index)" presets',
		example: '0',
		kind: 'int',
		experimental: false,
	},
	{
		id: 'selSection',
		label: 'Section index',
		description: '0-based section index of the selected track',
		example: '0',
		kind: 'int',
		experimental: false,
	},
	{
		id: 'selBeat',
		label: 'Beat',
		description: 'Track beat (number) used by the beat-based readouts',
		example: '32',
		kind: 'number',
		experimental: false,
	},
	{
		id: 'selScreen',
		label: 'Surface (screen2)',
		description: 'Surface name as shown in the Stage',
		example: 'Surface 1',
		kind: 'name',
		experimental: false,
	},
	{
		id: 'selProjector',
		label: 'Projector',
		description: 'Projector name as shown in the Stage',
		example: 'Projector 1',
		kind: 'name',
		experimental: false,
	},
	{
		id: 'selScreenUid',
		label: 'Display UID',
		description: 'UID of any display, hex with 0x prefix (right-click the editor title bar > Copy UID)',
		example: '0x0123456789abcdef',
		kind: 'uid',
		experimental: false,
	},
	{
		id: 'selMachine',
		label: 'Machine',
		description: 'Machine resource name as listed in d3Net Manager',
		example: 'Director',
		kind: 'name',
		experimental: false,
	},
	{
		id: 'selHost',
		label: 'Remote host',
		description: 'Hostname of the remote machine WITHOUT the :d3 suffix (the presets append it)',
		example: 'ACTOR01',
		kind: 'host',
		experimental: false,
	},
	{
		id: 'selWorkload',
		label: 'RenderStream workload id',
		description:
			'Workload id as decimal digits (the [EXP] RS Layer Workload ID preset shows it as text; also Cluster Workload widget > Copy UID or REST GET /api/session/renderstream/layerstatus)',
		example: '1234',
		kind: 'uid',
		experimental: false,
	},
	{
		id: 'selInstance',
		label: 'RenderStream instance index',
		description: '0-based instance index inside the workload',
		example: '0',
		kind: 'int',
		experimental: false,
	},
	{
		id: 'selEvUid',
		label: 'Expression Variables device UID',
		description: 'UID of the Expression Variables device, hex with 0x prefix',
		example: '0x0123456789abcdef',
		kind: 'uid',
		experimental: false,
	},
	{
		id: 'selEvIndex',
		label: 'Expression variable index',
		description: '0-based row index of the variable inside the device',
		example: '0',
		kind: 'int',
		experimental: false,
	},
	{
		id: 'selTransport',
		label: 'Transport manager (experimental)',
		description: 'Transport manager name other than default',
		example: 'default',
		kind: 'name',
		experimental: true,
	},
	{
		id: 'selLedScreen',
		label: 'LED screen',
		description: 'LED screen name',
		example: 'LED 1',
		kind: 'name',
		experimental: false,
	},
	{
		id: 'selDmxScreen',
		label: 'DMX screen (experimental)',
		description: 'DMX screen name',
		example: 'DMX 1',
		kind: 'name',
		experimental: true,
	},
	{
		id: 'selStageUid',
		label: 'Stage UID',
		description: 'Stage UID, hex with 0x prefix',
		example: '0x0123456789abcdef',
		kind: 'uid',
		experimental: false,
	},
	{
		id: 'selEvDevice',
		label: 'Expression Variables device (experimental)',
		description: 'Device name (file name part of objects/ExpressionVariablesDevice/<name>.apx)',
		example: 'ShowVars',
		kind: 'name',
		experimental: true,
	},
	{
		id: 'selEvName',
		label: 'Expression variable name (experimental)',
		description: 'Variable name, case-sensitive',
		example: 'master_level',
		kind: 'name',
		experimental: true,
	},
	{
		id: 'selEvLayer',
		label: 'Expression Variables layer (experimental)',
		description: 'Expression Variables layer name (module: prefix)',
		example: 'Vars',
		kind: 'name',
		experimental: true,
	},
	{
		id: 'selRsLayer',
		label: 'RenderStream layer index',
		description: "0-based index among the selected track's RenderStream leaf layers",
		example: '0',
		kind: 'int',
		experimental: false,
	},
]

export const SELECTION_IDS: readonly string[] = SELECTIONS.map((s) => s.id)

const SELECTION_BY_ID: ReadonlyMap<string, SelectionDefinition> = new Map(SELECTIONS.map((s) => [s.id, s]))

export function isSelectionId(id: string): boolean {
	return SELECTION_BY_ID.has(id)
}

const KIND_RULES: Readonly<Record<SelectionKind, { pattern: RegExp; hint: string }>> = {
	// Names are placed inside double quotes of a Designer expression; quotes, backslashes and
	// line breaks would end or corrupt the expression (the escape rules are undocumented).
	name: { pattern: /^[^"\\\r\n]+$/, hint: 'must not contain quotes, backslashes or line breaks' },
	host: { pattern: /^[A-Za-z0-9._-]+$/, hint: 'hostname characters only (letters, digits, ".", "_" and "-")' },
	int: {
		pattern: /^(0|[1-9][0-9]*)$/,
		hint: 'must be a plain decimal integer (no leading zero, Python would read it as octal)',
	},
	number: { pattern: /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/, hint: 'must be a plain decimal number' },
	uid: { pattern: /^(0x[0-9a-fA-F]+|0|[1-9][0-9]*)$/, hint: 'must be a decimal integer or a 0x hex id' },
}

/**
 * Validate a selection value for its kind. Returns undefined when the value is acceptable
 * (an empty value is always acceptable and means "unset"), otherwise a message for the log.
 */
export function validateSelection(id: string, value: string): string | undefined {
	const definition = SELECTION_BY_ID.get(id)
	if (!definition) return `unknown selection '${id}'`
	const trimmed = value.trim()
	if (trimmed === '') return undefined
	// Companion resolves a variable reference recursively when the value is used, so a selection
	// holding one would smuggle unvalidated text into the Python expression of every preset built
	// on it. The presets already substitute the selection; its value must be literal.
	if (trimmed.includes('$(')) return `${definition.label}: '${value}' must be a literal value, not a variable reference`
	const rule = KIND_RULES[definition.kind]
	if (!rule.pattern.test(trimmed)) return `${definition.label}: '${value}' ${rule.hint}`
	return undefined
}

/**
 * Read the selection values stored in a config object for publishing as variables.
 * Values are trimmed; unset or invalid values become UNSET_SELECTION and invalid ones are
 * reported through `onInvalid`.
 */
export function readSelections(
	config: Record<string, unknown>,
	onInvalid?: (id: string, message: string) => void,
): Record<string, string> {
	const values: Record<string, string> = {}
	for (const selection of SELECTIONS) {
		const raw = config[selection.id]
		const text = typeof raw === 'string' ? raw : typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : ''
		const trimmed = text.trim()
		if (trimmed === '') {
			values[selection.id] = UNSET_SELECTION
			continue
		}
		const problem = validateSelection(selection.id, trimmed)
		if (problem) {
			onInvalid?.(selection.id, problem)
			values[selection.id] = UNSET_SELECTION
		} else {
			values[selection.id] = trimmed
		}
	}
	return values
}
