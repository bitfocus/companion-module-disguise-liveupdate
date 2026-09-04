import type { PresetIntervalClass } from './config'
import type { CompareOperator } from './feedbacks'

/** Normal presets ship by default; experimental ones only when enabled in the connection settings */
export type PresetTier = 'normal' | 'experimental'

/** What a preset does (documentation only; the actions array is authoritative) */
export type PresetKind = 'readout' | 'nudge' | 'setValue' | 'onOff' | 'toggle' | 'jsonSet'

export type RGB = readonly [number, number, number]

export type PresetActionSet = 'down' | 'up' | 'rotate_left' | 'rotate_right'

export interface PresetCatalogAction {
	set: PresetActionSet
	actionId: string
	options: Readonly<Record<string, string | number | boolean>>
}

/** State colour applied through the LiveUpdate Compare feedback */
export interface PresetStateColour {
	operator: CompareOperator
	value: string | number | boolean
	bgcolor: RGB
}

/**
 * One button preset of the catalog (docs/PRESET_CATALOG.md), generated into presetCatalog.ts
 * by scripts/gen-presets.mjs.
 */
export interface PresetCatalogEntry {
	id: string
	category: string
	/** Category the row belongs to conceptually (differs from category for experimental rows) */
	homeCategory: string
	tier: PresetTier
	name: string
	kind: PresetKind
	/** Empty for module-native rows that create no LiveUpdate subscription */
	objectPath: string
	propertyPath: string
	variableName: string
	freqClass: PresetIntervalClass
	text: string
	textExpression: boolean
	previewText: string
	bgcolor: RGB
	color: RGB
	stateColour?: PresetStateColour
	actions: readonly PresetCatalogAction[]
	status: 'doc-verified' | 'unverified'
}

/** A text preset used as a heading inside a category */
export interface PresetCatalogText {
	id: string
	category: string
	name: string
	text: string
}
