/**
 * Command actions over Designer's Session REST API.
 *
 * LiveUpdate is a property protocol: it cannot play, stop, jump to a section, restart a
 * RenderStream workload or fail a machine over. These actions do, against the same Director the
 * WebSocket is connected to.
 *
 * A command that changes what the audience sees or the shape of the session is marked destructive:
 * it is refused unless the connection setting allows it, and it has to be pressed twice within a
 * few seconds, the first press only arming it. Arming is per button and per target, so a button
 * cannot fire at a target the operator did not see armed.
 */
import { CompanionActionDefinition, CompanionActionDefinitions, CompanionActionEvent } from '@companion-module/base'
import type { DisguiseInstance } from './index'
import {
	layersBody,
	machineBody,
	parseTarget,
	PLAYMODES,
	REST_ENDPOINTS,
	RestCommand,
	transportsBody,
	transportsWith,
} from './rest'

const TRANSPORT_OPTION = {
	type: 'textinput' as const,
	label: 'Transport',
	id: 'transport',
	default: 'default',
	useVariables: true,
	tooltip: 'Transport manager name (or its uid). "default" is the one every preset reads.',
}

const PLAYMODE_OPTION = {
	type: 'dropdown' as const,
	label: 'Play mode after the jump',
	id: 'playmode',
	default: 'NotSet',
	choices: PLAYMODES.map((id) => ({ id, label: id === 'NotSet' ? 'Leave unchanged' : id })),
}

const target = async (
	instance: DisguiseInstance,
	action: CompanionActionEvent,
	context: { parseVariablesInString: (text: string) => Promise<string> },
	id = 'transport',
): Promise<{ uid?: string; name?: string } | null> => {
	const raw = await context.parseVariablesInString(String(action.options[id] ?? ''))
	const text = raw.trim()
	if (!text || text === '$NA' || text.includes('$(')) {
		instance.log('warn', `${String(action.actionId)}: '${id}' is empty or unresolved, nothing was sent`)
		return null
	}
	return parseTarget(text)
}

const num = async (
	action: CompanionActionEvent,
	context: { parseVariablesInString: (text: string) => Promise<string> },
	id: string,
): Promise<number | null> => {
	const text = await context.parseVariablesInString(String(action.options[id] ?? ''))
	const value = Number(text)
	return Number.isFinite(value) ? value : null
}

export function getRestActionDefinitions(instance: DisguiseInstance): CompanionActionDefinitions {
	/** Wrap a command so the destructive gate, the arm/confirm and the reporting are in one place. */
	const command = (
		name: string,
		key: RestCommand,
		options: CompanionActionDefinition['options'],
		build: (
			action: CompanionActionEvent,
			context: { parseVariablesInString: (text: string) => Promise<string> },
		) => Promise<{ body: unknown; describe: string } | null>,
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

	const simpleTransport = (name: string, key: RestCommand): CompanionActionDefinition =>
		command(name, key, [TRANSPORT_OPTION], async (action, context) => {
			const transport = await target(instance, action, context)
			if (!transport) return null
			return {
				body: transportsBody(transport),
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
				const value = await num(action, context, field)
				if (value === null) {
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
		restNextSection: simpleTransport('Transport: Next section', 'nextSection'),
		restPrevSection: simpleTransport('Transport: Previous section', 'prevSection'),
		restNextTrack: simpleTransport('Transport: Next track', 'nextTrack'),
		restPrevTrack: simpleTransport('Transport: Previous track', 'prevTrack'),

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
				const section = (await context.parseVariablesInString(String(action.options.section ?? ''))).trim()
				if (!section) return null
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
				const note = (await context.parseVariablesInString(String(action.options.note ?? ''))).trim()
				if (!note) return null
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
				const value = (await context.parseVariablesInString(String(action.options.value ?? ''))).trim()
				if (!value) return null
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
				{ type: 'textinput', label: 'Track name or uid', id: 'track', default: '', useVariables: true },
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
				const timecode = (await context.parseVariablesInString(String(action.options.timecode ?? ''))).trim()
				if (!timecode) return null
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
		// message is surfaced on $(…:rest_message) when it does.
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
						},
					],
					async (action, context) => {
						const raw = (await context.parseVariablesInString(String(action.options.layers ?? ''))).trim()
						if (!raw || raw.includes('$(')) {
							instance.log('warn', `${name}: no layer given, nothing was sent`)
							return null
						}
						const targets = raw
							.split(',')
							.map((part) => part.trim())
							.filter(Boolean)
							.map(parseTarget)
						if (!targets.length) return null
						return { body: layersBody(targets), describe: `${name} (${raw})` }
					},
				),
			]),
		),

		// ---- failover ----
		restFailoverMachine: command(
			'Failover: Fail over machine',
			'failoverMachine',
			[{ type: 'textinput', label: 'Machine name or uid', id: 'machine', default: '', useVariables: true }],
			async (action, context) => {
				const machine = await target(instance, action, context, 'machine')
				if (!machine) return null
				return { body: machineBody(machine), describe: `fail over ${machine.name ?? machine.uid}` }
			},
		),
		restRestoreMachine: command(
			'Failover: Restore machine',
			'restoreMachine',
			[{ type: 'textinput', label: 'Machine name or uid', id: 'machine', default: '', useVariables: true }],
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
