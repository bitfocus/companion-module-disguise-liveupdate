import { SomeCompanionConfigField, Regex } from '@companion-module/base'
import { SELECTIONS } from './selections'

/**
 * Value classes used by the preset library to pick a default update interval
 */
export type PresetIntervalClass = 'monitoring' | 'playhead' | 'state' | 'static'

export interface DisguiseConfig {
	host: string
	port: number
	reconnectInterval?: number
	pendingSubscriptionTimeout?: number
	/** Selection variables (selTrack, selScreen, ...) persisted with the connection, see selections.ts */
	[selection: `sel${string}`]: string | undefined
	/** Show the read-only experimental presets (object paths that are not documented for LiveUpdate) */
	showExperimentalPresets?: boolean
	/** Default update interval (ms) written into presets of the "monitoring" class (fps, GPU, CPU, memory, RenderStream counters) */
	presetIntervalMonitoring?: number
	/** Default update interval (ms) written into presets of the "playhead" class (tRender, section remaining) */
	presetIntervalPlayhead?: number
	/** Default update interval (ms) written into presets of the "state" class (booleans, enums, strings, brightness, volume) */
	presetIntervalState?: number
	/** Default update interval (ms) written into presets of the "static" class (names, lengths, lists, versions) */
	presetIntervalStatic?: number
	/** Command channel over the Session REST API (play, stop, section jumps, RenderStream, failover) */
	restEnabled?: boolean
	restAllowDestructive?: boolean
	restArmSeconds?: number
	restTimeout?: number
}

/**
 * Default update intervals per preset value class (see docs/PRESET_CATALOG_RULES.md)
 */
export const PRESET_INTERVAL_DEFAULTS: Readonly<Record<PresetIntervalClass, number>> = {
	monitoring: 1000,
	playhead: 250,
	state: 500,
	static: 5000,
}

const PRESET_INTERVAL_MAX = 60000

/**
 * Resolve the update interval for a preset value class from the connection settings
 */
export function getPresetInterval(config: DisguiseConfig, intervalClass: PresetIntervalClass): number {
	const configured = {
		monitoring: config.presetIntervalMonitoring,
		playhead: config.presetIntervalPlayhead,
		state: config.presetIntervalState,
		static: config.presetIntervalStatic,
	}[intervalClass]

	const value =
		typeof configured === 'number' && Number.isFinite(configured) ? configured : PRESET_INTERVAL_DEFAULTS[intervalClass]
	return Math.min(PRESET_INTERVAL_MAX, Math.max(0, Math.round(value)))
}

export function getConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Connection Settings',
			width: 12,
			value: 'Configure connection to Disguise Designer Director (LiveUpdate API)',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Director IP Address',
			width: 6,
			default: '127.0.0.1',
			regex: Regex.HOSTNAME,
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			width: 3,
			default: 80,
			min: 1,
			max: 65535,
		},
		{
			type: 'number',
			id: 'reconnectInterval',
			label: 'Reconnect Interval (ms)',
			width: 3,
			default: 5000,
			min: 1000,
			max: 60000,
			step: 1000,
		},
		{
			type: 'number',
			id: 'pendingSubscriptionTimeout',
			label: 'Pending Subscription Timeout (ms)',
			width: 6,
			default: 30000,
			min: 5000,
			max: 300000,
			step: 5000,
		},
		{
			type: 'static-text',
			id: 'presetInfo',
			label: 'Preset Settings',
			width: 12,
			value:
				'Presets are generated from these settings. The intervals below are written into the "Update Frequency" of each preset feedback when the preset is placed; they can still be edited per button. 0 means "as fast as possible" (not recommended for monitors).',
		},
		{
			type: 'checkbox',
			id: 'showExperimentalPresets',
			label: 'Show experimental presets',
			width: 12,
			default: false,
			tooltip:
				'Adds the "99 Experimental" preset category: read-only presets built from Designer API members whose LiveUpdate object path is not documented. They may show ERROR / PATH_ERROR.',
		},
		{
			type: 'number',
			id: 'presetIntervalMonitoring',
			label: 'Monitoring interval (ms)',
			width: 3,
			default: PRESET_INTERVAL_DEFAULTS.monitoring,
			min: 0,
			max: PRESET_INTERVAL_MAX,
			step: 50,
			tooltip: 'fps, GPU/CPU profilers, memory, RenderStream counters',
		},
		{
			type: 'number',
			id: 'presetIntervalPlayhead',
			label: 'Playhead interval (ms)',
			width: 3,
			default: PRESET_INTERVAL_DEFAULTS.playhead,
			min: 0,
			max: PRESET_INTERVAL_MAX,
			step: 50,
			tooltip: 'Playhead position and section time readouts',
		},
		{
			type: 'number',
			id: 'presetIntervalState',
			label: 'State interval (ms)',
			width: 3,
			default: PRESET_INTERVAL_DEFAULTS.state,
			min: 0,
			max: PRESET_INTERVAL_MAX,
			step: 50,
			tooltip: 'Booleans, enums, strings, brightness, volume, health',
		},
		{
			type: 'number',
			id: 'presetIntervalStatic',
			label: 'Static interval (ms)',
			width: 3,
			default: PRESET_INTERVAL_DEFAULTS.static,
			min: 0,
			max: PRESET_INTERVAL_MAX,
			step: 50,
			tooltip: 'Names, lengths, lists, versions',
		},
		{
			type: 'static-text',
			id: 'commandInfo',
			label: 'Commands',
			width: 12,
			value:
				'LiveUpdate cannot carry transport commands, so play, stop, section and track jumps, RenderStream workload control and failover are sent over the Designer Session REST API on the same host and port. Commands that change what the audience sees or the shape of the session are refused unless you allow them below, and then need two presses of the same button.',
		},
		{
			type: 'checkbox',
			id: 'restEnabled',
			label: 'Enable commands',
			width: 4,
			default: true,
		},
		{
			type: 'checkbox',
			id: 'restAllowDestructive',
			label: 'Allow destructive commands',
			width: 4,
			default: false,
			tooltip: 'RenderStream start / stop / restart / sync and the failover commands',
		},
		{
			type: 'number',
			id: 'restArmSeconds',
			label: 'Confirm within (s)',
			width: 4,
			default: 5,
			min: 1,
			max: 60,
			isVisible: (options) => !!options.restAllowDestructive,
		},
		{
			type: 'number',
			id: 'restTimeout',
			label: 'Command timeout (ms)',
			width: 4,
			default: 5000,
			min: 1000,
			max: 30000,
			step: 500,
			isVisible: (options) => options.restEnabled !== false,
		},
		{
			type: 'static-text',
			id: 'selectionInfo',
			label: 'Selections',
			width: 12,
			value:
				'The presets address show objects through the module variables below (for example track:"$(liveupdate:selTrack)"). Fill them in here or change them live with the "Set selection" action; every preset built on a selection re-subscribes when it changes. Names are used verbatim (case-sensitive) inside quotes; indices and ids are unquoted numbers.',
		},
		...SELECTIONS.map((selection): SomeCompanionConfigField => ({
			type: 'textinput',
			id: selection.id,
			label: selection.label,
			width: 6,
			default: '',
			tooltip: selection.description,
			description: `e.g. ${selection.example}`,
			isVisible: selection.experimental ? (options) => !!options.showExperimentalPresets : undefined,
		})),
		{
			type: 'static-text',
			id: 'usageInfo',
			label: 'How to Use',
			width: 12,
			value: `<strong>Quickest start:</strong> fill in the Selections above (at least the Track), then drag presets from the preset browser. Each preset subscribes through a "LiveUpdate Variable" <strong>feedback</strong> and colours itself with a "LiveUpdate Compare" feedback on the same Variable Name.<br><br>
<strong>To monitor any other Disguise property:</strong><br>
1. Add the "LiveUpdate Variable" feedback to a button<br>
2. Give it a Variable Name and the Disguise object/property paths<br>
3. The module creates a variable (e.g. $(liveupdate:fps)) that updates continuously<br>
4. Use "LiveUpdate Compare" or Companion expressions for colours; use the variable anywhere in Companion<br><br>
<strong>To set Disguise properties:</strong><br>
Use the "Set to Disguise" / "Toggle Disguise Boolean" <strong>actions</strong>; they write through the subscription of the feedback with the same Variable Name<br><br>
<strong>Example:</strong><br>
• Variable Name: <code>fps</code><br>
• Object: <code>subsystem:MonitoringManager.findLocalMonitor("fps")</code><br>
• Property: <code>object.seriesAverage("Actual", 1)</code><br>
• LiveUpdate Compare: <code>fps &lt; 50</code> → red background`,
		},
	]
}
