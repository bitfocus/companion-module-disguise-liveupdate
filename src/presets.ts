import {
	CompanionButtonPresetDefinition,
	CompanionButtonStepActions,
	CompanionButtonStyleProps,
	CompanionPresetAction,
	CompanionPresetDefinitions,
	CompanionPresetFeedback,
	CompanionTextPresetDefinition,
	combineRgb,
} from '@companion-module/base'
import type { DisguiseInstance } from './index'
import { DisguiseConfig, getPresetInterval } from './config'
import { PRESET_CATALOG, PRESET_TEXTS } from './presetCatalog'
import type { PresetCatalogEntry, PresetCatalogText, RGB } from './presetTypes'

/**
 * Preset library
 *
 * The presets are generated from the catalog in presetCatalog.ts (itself generated from
 * docs/research/phase1-catalog.json, see docs/PRESET_CATALOG.md for the source of every row).
 * Companion sorts categories alphabetically, hence the numeric prefixes; within a category the
 * definition order is kept and a text preset starts a named group, so every category begins with
 * its "Setup" text.
 *
 * - Readouts carry one "LiveUpdate Variable" feedback; controls add the matching "Set to Disguise"
 *   action on the same button so the subscription exists when the action runs.
 * - Rows with a state colour add a "LiveUpdate Compare" feedback on the same variable.
 * - The update interval of each feedback comes from the connection settings (per value class).
 * - Experimental rows (undocumented object paths, read-only) are only emitted when enabled in the
 *   connection settings; they live in "99 Experimental", prefixed "[EXP]", grouped by home category.
 */

const EXPERIMENTAL_CATEGORY = '99 Experimental'
const EXPERIMENTAL_NAME_PREFIX = '[EXP] '
const CONNECTION_STATUS_PRESET_ID = 'conn_status'

const rgb = (colour: RGB): number => combineRgb(colour[0], colour[1], colour[2])

const slug = (text: string): string =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')

function buildTextPreset(text: PresetCatalogText): CompanionTextPresetDefinition {
	return {
		type: 'text',
		category: text.category,
		name: text.name,
		text: text.text,
	}
}

function buildStyle(entry: PresetCatalogEntry): CompanionButtonStyleProps {
	return {
		text: entry.text,
		size: 'auto',
		color: rgb(entry.color),
		bgcolor: rgb(entry.bgcolor),
		textExpression: entry.textExpression,
	}
}

function buildFeedbacks(entry: PresetCatalogEntry, config: DisguiseConfig): CompanionPresetFeedback[] {
	const feedbacks: CompanionPresetFeedback[] = []

	if (entry.objectPath) {
		feedbacks.push({
			feedbackId: 'liveUpdateVariable',
			options: {
				variableName: entry.variableName,
				objectPath: entry.objectPath,
				propertyPath: entry.propertyPath,
				updateFrequency: getPresetInterval(config, entry.freqClass),
			},
		})
	}

	if (entry.stateColour) {
		feedbacks.push({
			feedbackId: 'liveUpdateCompare',
			options: {
				variableName: entry.variableName,
				operator: entry.stateColour.operator,
				value: String(entry.stateColour.value),
			},
			style: {
				bgcolor: rgb(entry.stateColour.bgcolor),
			},
		})
	}

	if (entry.id === CONNECTION_STATUS_PRESET_ID) {
		// Module-native indicator: no LiveUpdate subscription, green while the socket is open
		feedbacks.push({
			feedbackId: 'connectionState',
			options: {},
			style: {
				bgcolor: combineRgb(0, 100, 0),
				color: combineRgb(220, 220, 220),
			},
		})
	}

	return feedbacks
}

function buildSteps(entry: PresetCatalogEntry): { steps: CompanionButtonStepActions[]; rotary: boolean } {
	const step: CompanionButtonStepActions = { down: [], up: [] }
	let rotary = false

	for (const action of entry.actions) {
		const presetAction: CompanionPresetAction = {
			actionId: action.actionId,
			options: { ...action.options },
		}

		switch (action.set) {
			case 'down':
				step.down.push(presetAction)
				break
			case 'up':
				step.up.push(presetAction)
				break
			case 'rotate_left':
				rotary = true
				step.rotate_left = [...(step.rotate_left ?? []), presetAction]
				break
			case 'rotate_right':
				rotary = true
				step.rotate_right = [...(step.rotate_right ?? []), presetAction]
				break
		}
	}

	return { steps: [step], rotary }
}

function buildButtonPreset(entry: PresetCatalogEntry, config: DisguiseConfig): CompanionButtonPresetDefinition {
	const experimental = entry.tier === 'experimental'
	const style = buildStyle(entry)
	const { steps, rotary } = buildSteps(entry)

	const preset: CompanionButtonPresetDefinition = {
		type: 'button',
		category: entry.category,
		name: (experimental ? EXPERIMENTAL_NAME_PREFIX : '') + entry.name,
		style,
		feedbacks: buildFeedbacks(entry, config),
		steps,
	}

	if (entry.previewText) {
		// Shown in the preset browser only; the placed button keeps the live expression
		preset.previewStyle = { ...style, text: entry.previewText, textExpression: false }
	}

	if (rotary) {
		preset.options = { rotaryActions: true }
	}

	return preset
}

export function getPresetDefinitions(instance: DisguiseInstance): CompanionPresetDefinitions {
	const config: DisguiseConfig = instance.config ?? { host: '', port: 80 }
	const showExperimental = !!config.showExperimentalPresets
	const presets: CompanionPresetDefinitions = {}

	// Category headings first: within a category the first text preset opens the group
	for (const text of PRESET_TEXTS) {
		if (text.category !== EXPERIMENTAL_CATEGORY) presets[text.id] = buildTextPreset(text)
	}

	for (const entry of PRESET_CATALOG) {
		if (entry.tier === 'normal') presets[entry.id] = buildButtonPreset(entry, config)
	}

	if (showExperimental) {
		for (const text of PRESET_TEXTS) {
			if (text.category === EXPERIMENTAL_CATEGORY) presets[text.id] = buildTextPreset(text)
		}

		const experimental = PRESET_CATALOG.filter((entry) => entry.tier === 'experimental')
		const homeCategories = [...new Set(experimental.map((entry) => entry.homeCategory))].sort()

		for (const home of homeCategories) {
			presets[`exp_heading_${slug(home)}`] = {
				type: 'text',
				category: EXPERIMENTAL_CATEGORY,
				name: `${home.replace(/^\d+\s+/, '')} (experimental)`,
				text: `Read-only presets whose object path is not documented for LiveUpdate. They belong to "${home}" once verified on a Director.`,
			}
			for (const entry of experimental) {
				if (entry.homeCategory === home) presets[entry.id] = buildButtonPreset(entry, config)
			}
		}
	}

	return presets
}
