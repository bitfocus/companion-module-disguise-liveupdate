import { SomeCompanionConfigField, Regex } from '@companion-module/base'

/**
 * Value classes used by the preset library to pick a default update interval
 */
export type PresetIntervalClass = 'monitoring' | 'playhead' | 'state' | 'static'

export interface DisguiseConfig {
	host: string
	port: number
	reconnectInterval?: number
	pendingSubscriptionTimeout?: number
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
			id: 'usageInfo',
			label: 'How to Use',
			width: 12,
			value: `<strong>This module uses Feedbacks to subscribe to Disguise properties.</strong><br><br>
<strong>To monitor Disguise properties:</strong><br>
1. Add the "LiveUpdate Variable" <strong>feedback</strong> to a button<br>
2. Configure the feedback with a variable name and Disguise object/property paths<br>
3. The module will create a variable (e.g. $(liveupdate:fps)) that updates continuously<br>
4. Use Companion's expression variables to compare values and create visual feedback<br>
5. Use the variable anywhere in Companion (buttons, text, triggers, other modules)<br><br>
<strong>To set Disguise properties:</strong><br>
Use the "Set to Disguise" <strong>actions</strong> to write variable values back to Disguise<br><br>
<strong>Example:</strong><br>
• Add "LiveUpdate Variable" feedback to a button:<br>
&nbsp;&nbsp;- Variable Name: <code>fps</code><br>
&nbsp;&nbsp;- Object: <code>subsystem:MonitoringManager.findLocalMonitor("fps")</code><br>
&nbsp;&nbsp;- Property: <code>object.seriesAverage("Actual", 1)</code><br>
• Use expression variable <code>$(liveupdate:fps) &lt; 30</code> for visual feedback<br>
• No comparison feedbacks needed - use Companion's expression system instead!`,
		},
	]
}
