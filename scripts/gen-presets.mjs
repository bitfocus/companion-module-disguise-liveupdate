// Generates src/presetCatalog.ts from docs/research/phase1-catalog.json.
//
// The JSON is the machine-readable form of docs/PRESET_CATALOG.md (the design document that
// traces every row to a verified Designer API candidate). Only the fields the runtime needs are
// copied; sources, verification notes and live-test priorities stay in the docs.
//
// Usage: node scripts/gen-presets.mjs   (then `yarn format`)

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { markerProblems, readMarkers } = require('./companion-expression.cjs')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const input = resolve(root, 'docs/research/phase1-catalog.json')
const output = resolve(root, 'src/presetCatalog.ts')

const catalog = JSON.parse(readFileSync(input, 'utf8'))
// What the module writes into a readout instead of a Director value (SENTINELS in src/variables.ts)
const markers = readMarkers(readFileSync(resolve(root, 'src/variables.ts'), 'utf8'))
const hidingTexts = []

const OPERATORS = {
	'==': 'eq',
	'=': 'eq',
	eq: 'eq',
	'!=': 'ne',
	ne: 'ne',
	'<': 'lt',
	lt: 'lt',
	'<=': 'le',
	le: 'le',
	'>': 'gt',
	gt: 'gt',
	'>=': 'ge',
	ge: 'ge',
	truthy: 'truthy',
	contains: 'contains',
}

const ACTION_SETS = new Set(['down', 'up', 'rotate_left', 'rotate_right'])
const FREQ_CLASSES = new Set(['monitoring', 'playhead', 'state', 'static'])

function parseRgb(text, context) {
	const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(String(text ?? '').trim())
	if (!match) throw new Error(`${context}: bad colour "${text}"`)
	return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function convertRow(row) {
	const id = row.presetId
	if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`bad preset id ${id}`)
	if (!FREQ_CLASSES.has(row.freqClass)) throw new Error(`${id}: bad freqClass ${row.freqClass}`)

	const actions = (row.actions ?? []).map((action) => {
		if (!ACTION_SETS.has(action.set)) throw new Error(`${id}: bad action set ${action.set}`)
		for (const [key, value] of Object.entries(action.options)) {
			if (!['string', 'number', 'boolean'].includes(typeof value))
				throw new Error(`${id}: option ${key} has type ${typeof value}`)
		}
		// A step written as '$(liveupdate:x)+0.05' reaches the Director as the absolute value 0.05 while
		// the readout is empty: Companion substitutes the readout before the action runs. The nudge
		// action adds the step in the module and refuses while there is no number to add it to.
		if (action.actionId === 'setToDisguiseNumber' && String(action.options.value).includes('$('))
			throw new Error(`${id}: a Number value that reads a variable; a step belongs on nudgeDisguiseNumber`)
		if (row.controlKind === 'nudge' && action.actionId !== 'nudgeDisguiseNumber')
			throw new Error(`${id}: a nudge row writes through nudgeDisguiseNumber, not ${action.actionId}`)
		if (action.actionId === 'nudgeDisguiseNumber') {
			const isNumber = (text) => String(text).trim() !== '' && Number.isFinite(Number(text))
			if (!isNumber(action.options.delta) || Number(action.options.delta) === 0)
				throw new Error(`${id}: the nudge step must be a number other than 0`)
			for (const limit of ['min', 'max'])
				if (action.options[limit] !== '' && !isNumber(action.options[limit]))
					throw new Error(`${id}: the nudge ${limit} must be empty or a number`)
		}
		return { set: action.set, actionId: action.actionId, options: action.options }
	})
	if (row.tier === 'experimental' && actions.length) throw new Error(`${id}: experimental row with actions`)
	// Expression-mode button text must be a template literal (`...${...}...`); a bare string with a
	// newline does not parse in Companion's expression engine.
	if (row.textExpression && !/^`[\s\S]*`$/.test(row.textTemplate ?? ''))
		throw new Error(`${id}: textExpression is set but the text is not a template literal`)
	if (/\$\((?!liveupdate:)[a-z]+:/.test(`${row.textTemplate} ${row.objectPath} ${row.propertyPath}`))
		throw new Error(`${id}: references a variable of another connection; presets may only use $(liveupdate:...)`)
	// A readout holds PENDING, OFFLINE, ERROR, PATH_ERROR or UNSET, an empty value (a Director '' or
	// None) or nothing at all as often as a value: the button has to show that, not format it into NaN
	// or a healthy-looking word (rendered the way Companion 5.0.4 does, see companion-expression.cjs)
	if (row.textExpression) {
		const problems = markerProblems(row.textTemplate, markers)
		if (problems.length) hidingTexts.push(`${id}:\n    ${problems.join('\n    ')}`)
	}
	if (/<redacted/.test(JSON.stringify([row.textTemplate, row.previewText, row.actions])))
		throw new Error(`${id}: preset content carries a redaction placeholder`)

	const entry = {
		id,
		category: row.category,
		homeCategory: row.homeCategory,
		tier: row.tier,
		name: row.name,
		kind: row.controlKind,
		objectPath: row.objectPath ?? '',
		propertyPath: row.propertyPath ?? '',
		variableName: row.variableName,
		freqClass: row.freqClass,
		text: row.textTemplate ?? '',
		textExpression: !!row.textExpression,
		previewText: row.previewText ?? '',
		bgcolor: parseRgb(row.bgcolor, id),
		color: parseRgb(row.color, id),
		actions,
		status: row.status,
	}

	if (row.stateColour) {
		const operator = OPERATORS[String(row.stateColour.operator)]
		if (!operator) throw new Error(`${id}: unknown comparison operator ${row.stateColour.operator}`)
		entry.stateColour = {
			operator,
			value: row.stateColour.value,
			bgcolor: parseRgb(row.stateColour.bgcolor, id + ' stateColour'),
		}
	}

	return entry
}

const entries = catalog.rows.map(convertRow)
if (hidingTexts.length)
	throw new Error(
		`${hidingTexts.length} button texts hide what the module writes into a readout:\n  ${hidingTexts.join('\n  ')}`,
	)
const texts = catalog.textPresets.map((text) => ({
	id: text.presetId,
	category: text.category,
	name: text.name,
	text: text.text,
}))

const ids = new Set()
for (const item of [...entries, ...texts]) {
	if (ids.has(item.id)) throw new Error(`duplicate preset id ${item.id}`)
	ids.add(item.id)
}

const header = `// GENERATED FILE - do not edit by hand.
// Source: docs/research/phase1-catalog.json (see docs/PRESET_CATALOG.md for the sources of every row).
// Regenerate with: node scripts/gen-presets.mjs && yarn format
`

const body = `${header}
import type { PresetCatalogEntry, PresetCatalogText } from './presetTypes'

export const PRESET_TEXTS: readonly PresetCatalogText[] = ${JSON.stringify(texts, null, '\t')}

export const PRESET_CATALOG: readonly PresetCatalogEntry[] = ${JSON.stringify(entries, null, '\t')}
`

writeFileSync(output, body)
console.log(
	`wrote ${output}: ${entries.length} presets (${entries.filter((e) => e.tier === 'normal').length} normal, ${entries.filter((e) => e.tier === 'experimental').length} experimental), ${texts.length} text presets`,
)
