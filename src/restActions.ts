/**
 * Command actions over Designer's Session REST API.
 *
 * LiveUpdate is a property protocol: it cannot play, stop, jump to a section, restart a
 * RenderStream workload or fail a machine over. These actions do, against the same Director the
 * WebSocket is connected to.
 *
 * A command that changes the shape of the session (RenderStream workloads, failover) is marked
 * destructive: it is refused unless the connection setting allows it, and it has to be pressed twice
 * within a few seconds, the first press only arming it. Arming is per button and per target, so a
 * button cannot fire at a target the operator did not see armed. Transport commands fire on one press.
 */
import { CompanionActionDefinition, CompanionActionDefinitions, CompanionActionEvent } from '@companion-module/base'
import type { DisguiseInstance } from './index'
import {
	isUnresolvedText,
	layersBody,
	machineBody,
	parseTarget,
	PLAYMODES,
	REST_ENDPOINTS,
	RestCommand,
	RestTarget,
	transportsBody,
	transportsWith,
} from './rest'

/** How a free-text object reference is read; shown on every option that takes one */
const TARGET_RULE =
	'A value of 6 or more digits only is sent as a uid, anything else as a name. ' +
	'Prefix name: or uid: to choose, e.g. name:20250914.'

const TRANSPORT_OPTION = {
	type: 'textinput' as const,
	label: 'Transport',
	id: 'transport',
	default: 'default',
	useVariables: true,
	tooltip: `Transport manager name (or its uid). "default" is the one every preset reads. ${TARGET_RULE}`,
}

const PLAYMODE_OPTION = {
	type: 'dropdown' as const,
	label: 'Play mode after the jump',
	id: 'playmode',
	default: 'NotSet',
	choices: PLAYMODES.map((id) => ({ id, label: id === 'NotSet' ? 'Leave unchanged' : id })),
}

type ParseContext = { parseVariablesInString: (text: string) => Promise<string> }

const refuse = (
	instance: DisguiseInstance,
	action: CompanionActionEvent,
	label: string,
	why = 'is empty or unresolved',
): null => {
	instance.log('warn', `${String(action.actionId)}: '${label}' ${why}, nothing was sent`)
	return null
}

/**
 * A free-text option after variable parsing. Empty text, the host's '$NA' and a reference left
 * unparsed are refused with one warning, so a button whose variable or selection is not set yet
 * sends nothing rather than a literal '$NA' or an empty value.
 */
const text = async (
	instance: DisguiseInstance,
	action: CompanionActionEvent,
	context: ParseContext,
	id: string,
	label = id,
): Promise<string | null> => {
	const value = (await context.parseVariablesInString(String(action.options[id] ?? ''))).trim()
	return isUnresolvedText(value) ? refuse(instance, action, label) : value
}

const target = async (
	instance: DisguiseInstance,
	action: CompanionActionEvent,
	context: ParseContext,
	id = 'transport',
): Promise<RestTarget | null> => {
	const value = await text(instance, action, context, id)
	if (value === null) return null
	return parseTarget(value) ?? refuse(instance, action, id, 'is neither a name nor a decimal uid')
}

export function getRestActionDefinitions(instance: DisguiseInstance): CompanionActionDefinitions {
	/** Wrap a command so the destructive gate, the arm/confirm and the reporting are in one place. */
	const command = (
		name: string,
		key: RestCommand,
		options: CompanionActionDefinition['options'],
		build: (action: CompanionActionEvent, context: ParseContext) => Promise<{ body: unknown; describe: string } | null>,
	): CompanionActionDefinition => ({
		name,
		description: REST_ENDPOINTS[key].destructive
			? 'Sent over the Designer REST API. Destructive: enable "Allow destructive commands" and press twice.'
			: 'Sent over the Designer REST API (LiveUpdate cannot carry transport commands).',
		options,
		callback: async (action, context) => {
			const built = await build(action, context)
			if (!built) return
			await instance.runRestCommand(key, built.body, built.describe, String(action.controlId ?? action.id ?? name))
		},
	})

	/** Play, stop, play/loop section and return to start: the body only names the transport */
	const simpleTransport = (name: string, key: RestCommand): CompanionActionDefinition =>
		command(name, key, [TRANSPORT_OPTION], async (action, context) => {
			const transport = await target(instance, action, context)
			if (!transport) return null
			return {
				body: transportsBody(transport),
				describe: `${REST_ENDPOINTS[key].summary} on ${transport.name ?? transport.uid}`,
			}
		})

	/**
	 * Next / previous section and track: the OpenAPI body wraps the transport and carries the play
	 * mode after the step, like the goto commands. A button saved before the option existed has no
	 * playmode and sends 'NotSet', which leaves the play state as it is.
	 */
	const stepTransport = (name: string, key: RestCommand): CompanionActionDefinition =>
		command(name, key, [TRANSPORT_OPTION, PLAYMODE_OPTION], async (action, context) => {
			const transport = await target(instance, action, context)
			if (!transport) return null
			return {
				body: transportsWith(transport, { playmode: String(action.options.playmode ?? 'NotSet') }),
				describe: `${REST_ENDPOINTS[key].summary} on ${transport.name ?? transport.uid}`,
			}
		})

	const withNumber = (
		name: string,
		key: RestCommand,
		field: string,
		label: string,
		def: string,
	): CompanionActionDefinition =>
		command(
			name,
			key,
			[TRANSPORT_OPTION, { type: 'textinput', label, id: field, default: def, useVariables: true }],
			async (action, context) => {
				const transport = await target(instance, action, context)
				if (!transport) return null
				// An empty field must not become 0 (Number('') is 0): black, silence or a jump to 0 s.
				const raw = await text(instance, action, context, field, label)
				if (raw === null) return null
				const value = Number(raw)
				if (!Number.isFinite(value)) {
					instance.log('warn', `${name}: '${label}' is not a number, nothing was sent`)
					return null
				}
				return { body: transportsWith(transport, { [field]: value }), describe: `${label} ${value}` }
			},
		)

	return {
		// ---- transport ----
		restPlay: simpleTransport('Transport: Play', 'play'),
		restStop: simpleTransport('Transport: Stop', 'stop'),
		restPlaySection: simpleTransport('Transport: Play to end of section', 'playSection'),
		restLoopSection: simpleTransport('Transport: Loop section', 'loopSection'),
		restReturnToStart: simpleTransport('Transport: Return to start', 'returnToStart'),
		restNextSection: stepTransport('Transport: Next section', 'nextSection'),
		restPrevSection: stepTransport('Transport: Previous section', 'prevSection'),
		restNextTrack: stepTransport('Transport: Next track', 'nextTrack'),
		restPrevTrack: stepTransport('Transport: Previous track', 'prevTrack'),

		restGotoSection: command(
			'Transport: Go to section',
			'gotoSection',
			[
				TRANSPORT_OPTION,
				{
					type: 'textinput',
					label: 'Section number',
					id: 'section',
					default: '0',
					useVariables: true,
					tooltip:
						'The section index, counted from 0. Designer parses this field as a number even though the ' +
						'published API describes it as a string: a section name is refused. To jump by name, use ' +
						'"Transport: Go to note".',
				},
				PLAYMODE_OPTION,
			],
			async (action, context) => {
				const transport = await target(instance, action, context)
				if (!transport) return null
				const section = await text(instance, action, context, 'section', 'Section number')
				if (section === null) return null
				return {
					body: transportsWith(transport, { section, playmode: String(action.options.playmode ?? 'NotSet') }),
					describe: `go to section ${section}`,
				}
			},
		),

		restGotoNote: command(
			'Transport: Go to note',
			'gotoNote',
			[
				TRANSPORT_OPTION,
				{
					type: 'textinput',
					label: 'Note (section or cue name)',
					id: 'note',
					default: '',
					useVariables: true,
					tooltip: 'The name shown on the section or cue in the timeline, matched exactly.',
				},
				PLAYMODE_OPTION,
			],
			async (action, context) => {
				const transport = await target(instance, action, context)
				if (!transport) return null
				const note = await text(instance, action, context, 'note', 'Note')
				if (note === null) return null
				return {
					body: transportsWith(transport, { note, playmode: String(action.options.playmode ?? 'NotSet') }),
					describe: `go to note ${note}`,
				}
			},
		),

		restGotoTag: command(
			'Transport: Go to tag',
			'gotoTag',
			[
				TRANSPORT_OPTION,
				{
					type: 'dropdown',
					label: 'Tag type',
					id: 'tagType',
					default: 'CUE',
					choices: (['TagType_Unknown', 'TC', 'MIDI', 'CUE'] as const).map((id) => ({ id, label: id })),
				},
				{ type: 'textinput', label: 'Tag value', id: 'value', default: '', useVariables: true },
				{
					type: 'checkbox',
					label: 'Search every track',
					id: 'allowGlobalJump',
					default: false,
					tooltip: 'Off: only the current track is searched. The Director refuses the jump if no tag matches.',
				},
				PLAYMODE_OPTION,
			],
			async (action, context) => {
				const transport = await target(instance, action, context)
				if (!transport) return null
				const value = await text(instance, action, context, 'value', 'Tag value')
				if (value === null) return null
				return {
					body: transportsWith(transport, {
						type: String(action.options.tagType ?? 'CUE'),
						value,
						allowGlobalJump: Boolean(action.options.allowGlobalJump),
						playmode: String(action.options.playmode ?? 'NotSet'),
					}),
					describe: `go to ${String(action.options.tagType ?? 'CUE')} tag ${value}`,
				}
			},
		),

		restGotoTrack: command(
			'Transport: Go to track',
			'gotoTrack',
			[
				TRANSPORT_OPTION,
				{
					type: 'textinput',
					label: 'Track name or uid',
					id: 'track',
					default: '',
					useVariables: true,
					tooltip: TARGET_RULE,
				},
				PLAYMODE_OPTION,
			],
			async (action, context) => {
				const transport = await target(instance, action, context)
				if (!transport) return null
				const track = await target(instance, action, context, 'track')
				if (!track) return null
				return {
					body: transportsWith(transport, { track, playmode: String(action.options.playmode ?? 'NotSet') }),
					describe: `go to track ${track.name ?? track.uid}`,
				}
			},
		),

		restGotoTimecode: command(
			'Transport: Go to timecode',
			'gotoTimecode',
			[
				TRANSPORT_OPTION,
				{
					type: 'textinput',
					label: 'Timecode (hh:mm:ss:ff)',
					id: 'timecode',
					default: '00:00:00:00',
					useVariables: true,
					tooltip:
						'hh:mm:ss:ff. The dotted form hh:mm:ss.ff that the timecode variables report is accepted too, ' +
						'so a variable can be pasted in as it stands.',
				},
				{ type: 'checkbox', label: 'Ignore tags', id: 'ignoreTags', default: false },
				PLAYMODE_OPTION,
			],
			async (action, context) => {
				const transport = await target(instance, action, context)
				if (!transport) return null
				const timecode = await text(instance, action, context, 'timecode', 'Timecode')
				if (timecode === null) return null
				return {
					body: transportsWith(transport, {
						timecode,
						ignoreTags: Boolean(action.options.ignoreTags),
						playmode: String(action.options.playmode ?? 'NotSet'),
					}),
					describe: `go to ${timecode}`,
				}
			},
		),

		restGotoTime: withNumber('Transport: Go to time (seconds)', 'gotoTime', 'time', 'Time in seconds', '0'),
		restBrightness: withNumber('Transport: Set brightness', 'brightness', 'brightness', 'Brightness 0..1', '1'),
		restVolume: withNumber('Transport: Set volume', 'volume', 'volume', 'Volume 0..1', '1'),
		// Designer refuses this one unless "enableTransportSpeedControl" is on; the Director's own
		// message is surfaced on $(…:rest_last_message) when it does.
		restSpeed: withNumber('Transport: Set speed', 'speed', 'speed', 'Speed (1 = normal)', '1'),

		restEngaged: command(
			'Transport: Set engaged',
			'engaged',
			[TRANSPORT_OPTION, { type: 'checkbox', label: 'Engaged', id: 'engaged', default: true }],
			async (action, context) => {
				const transport = await target(instance, action, context)
				if (!transport) return null
				const engaged = Boolean(action.options.engaged)
				return { body: transportsWith(transport, { engaged }), describe: `engaged ${engaged}` }
			},
		),

		// ---- RenderStream ----
		...Object.fromEntries(
			(
				[
					['restRsStart', 'rsStart', 'RenderStream: Start layers'],
					['restRsStop', 'rsStop', 'RenderStream: Stop layers'],
					['restRsRestart', 'rsRestart', 'RenderStream: Restart layers'],
					['restRsSync', 'rsSync', 'RenderStream: Sync layers'],
				] as [string, RestCommand, string][]
			).map(([actionId, key, name]) => [
				actionId,
				command(
					name,
					key,
					[
						{
							type: 'textinput',
							label: 'Layer name or uid (comma separated for several)',
							id: 'layers',
							default: '',
							useVariables: true,
							tooltip: `${TARGET_RULE} Every entry must resolve, or nothing is sent.`,
						},
					],
					async (action, context) => {
						const raw = (await context.parseVariablesInString(String(action.options.layers ?? ''))).trim()
						// Each entry is checked on its own: 'Layer A,$(sel)' with the selection empty must not
						// go out as Layer A alone, nor with a layer literally named '$NA'.
						const targets: RestTarget[] = []
						for (const part of raw.split(',')) {
							const layer = isUnresolvedText(part) ? null : parseTarget(part)
							if (!layer) {
								instance.log(
									'warn',
									`${name}: a layer in '${raw}' is empty, unresolved or neither a name nor a decimal uid, nothing was sent`,
								)
								return null
							}
							targets.push(layer)
						}
						return { body: layersBody(targets), describe: `${name} (${raw})` }
					},
				),
			]),
		),

		// ---- failover ----
		restFailoverMachine: command(
			'Failover: Fail over machine',
			'failoverMachine',
			[
				{
					type: 'textinput',
					label: 'Machine name or uid',
					id: 'machine',
					default: '',
					useVariables: true,
					tooltip: TARGET_RULE,
				},
			],
			async (action, context) => {
				const machine = await target(instance, action, context, 'machine')
				if (!machine) return null
				return { body: machineBody(machine), describe: `fail over ${machine.name ?? machine.uid}` }
			},
		),
		restRestoreMachine: command(
			'Failover: Restore machine',
			'restoreMachine',
			[
				{
					type: 'textinput',
					label: 'Machine name or uid',
					id: 'machine',
					default: '',
					useVariables: true,
					tooltip: TARGET_RULE,
				},
			],
			async (action, context) => {
				const machine = await target(instance, action, context, 'machine')
				if (!machine) return null
				return { body: machineBody(machine), describe: `restore ${machine.name ?? machine.uid}` }
			},
		),
		restRescan: {
			name: 'Command: rescan the command API',
			description:
				'Forget which commands this Director answered 404 for. Use it after a Designer upgrade instead of restarting the connection.',
			options: [],
			callback: async () => {
				instance.rescanRestCommands()
			},
		},

		restDefaultRouting: command('Failover: Apply default routing', 'defaultRouting', [], async () => ({
			body: {},
			describe: 'apply default routing',
		})),
	}
}
