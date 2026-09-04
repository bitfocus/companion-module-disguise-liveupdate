/**
 * Reading the lists a selection can be chosen from.
 *
 * Every selection used to be free text, and a name that differs from Designer's by one character is
 * the most common reason a preset shows PATH_ERROR. The Director can list its own objects, so the
 * "Set selection" action offers the real names in a dropdown instead.
 *
 * These are the same expressions scripts/live-verify.mjs uses to discover a rig, kept here so the
 * runtime and the script cannot drift apart.
 */

export interface DiscoverySource {
	/** The selection this list fills */
	selection: string
	objectPath: string
	propertyPath: string
	/** Selections whose current value the paths above interpolate */
	needs?: string[]
	/** Turn the Director's answer into a list of choices */
	pick?: (value: unknown) => string[]
}

const names = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry !== '') : []

const stripD3 = (value: unknown): string[] => names(value).map((entry) => entry.replace(/:d3$/, ''))

const indices = (value: unknown): string[] => (Array.isArray(value) ? value.map((_entry, index) => String(index)) : [])

/**
 * `$(liveupdate:selTrack)` in a path is substituted by the module before the subscription is made,
 * exactly as it is for a preset.
 */
export const DISCOVERY_SOURCES: DiscoverySource[] = [
	{
		selection: 'selTrack',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '[t.description for t in resourceManager.allResources(Track)]',
	},
	{
		selection: 'selLayer',
		objectPath: 'track:"$(liveupdate:selTrack)"',
		propertyPath: '[l.name for l in object.layers]',
		needs: ['selTrack'],
	},
	{
		selection: 'selLayerIndex',
		objectPath: 'track:"$(liveupdate:selTrack)"',
		propertyPath: '[l.name for l in object.layers]',
		needs: ['selTrack'],
		pick: indices,
	},
	{
		selection: 'selScreen',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '[s.description for s in resourceManager.allResources(Screen2)]',
	},
	{
		selection: 'selProjector',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '[p.description for p in resourceManager.allResources(Projector)]',
	},
	{
		selection: 'selLedScreen',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '[d.description for d in resourceManager.allResources(LedScreen)]',
	},
	{
		selection: 'selDmxScreen',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '[d.description for d in resourceManager.allResources(DmxScreen)]',
	},
	{
		selection: 'selTransport',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '[d.description for d in resourceManager.allResources(TransportManager)]',
	},
	{
		selection: 'selEvDevice',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '[d.description for d in resourceManager.allResources(ExpressionVariablesDevice)]',
	},
	{
		selection: 'selMachine',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '[m.name for m in object.d3NetManager.machines]',
	},
	{
		selection: 'selHost',
		objectPath: 'subsystem:MonitoringManager',
		propertyPath: 'object.remoteNodes()',
		pick: stripD3,
	},
	{
		selection: 'selScreenUid',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '["0x%x" % s.uid for s in resourceManager.allResources(Screen2)]',
	},
	{
		selection: 'selStageUid',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '["0x%x" % s.uid for s in resourceManager.allResources(Stage)]',
	},
	{
		selection: 'selEvUid',
		objectPath: 'subsystem:D3NetManagerSystem',
		propertyPath: '["0x%x" % d.uid for d in resourceManager.allResources(ExpressionVariablesDevice)]',
	},
	{
		selection: 'selRsLayer',
		objectPath: 'track:"$(liveupdate:selTrack)"',
		propertyPath: '[l.name for l in object.getLeafLayers(RenderStreamModule)]',
		needs: ['selTrack'],
		pick: indices,
	},
	{
		// the uint64 ids lose precision as JSON numbers, so the Director is asked for them as text
		selection: 'selWorkload',
		objectPath: 'track:"$(liveupdate:selTrack)"',
		propertyPath: '[str(l.moduleConfig.workloadId) for l in object.getLeafLayers(RenderStreamModule)]',
		needs: ['selTrack'],
	},
]

/** Choices for one selection from the Director's answer */
export function choicesFrom(source: DiscoverySource, value: unknown): string[] {
	const picked = source.pick ? source.pick(value) : names(value)
	// a name may legitimately repeat between object types; the dropdown should not
	return [...new Set(picked)].slice(0, 500)
}
