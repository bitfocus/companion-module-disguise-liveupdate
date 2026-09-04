/**
 * Catalog <-> implementation consistency: the generated presets must match the catalog JSON
 * (docs/research/phase1-catalog.json) row for row, and every preset must reference only defined
 * actions, feedbacks and option ids with values of the declared types.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadDist, ROOT } from './harness'

const dist = loadDist()
const catalog = JSON.parse(readFileSync(path.join(ROOT, 'docs/research/phase1-catalog.json'), 'utf8'))
const help = readFileSync(path.join(ROOT, 'companion/HELP.md'), 'utf8')

const fakeInstance = { config: { host: '10.0.0.1', port: 80, showExperimentalPresets: true } }
const presets = dist.getPresetDefinitions(fakeInstance)
const normalOnly = dist.getPresetDefinitions({ config: { host: '10.0.0.1', port: 80 } })
const actionDefs = dist.getActionDefinitions({})
const feedbackDefs = dist.getFeedbackDefinitions({})

const EXPERIMENTAL = '99 Experimental'
const TEMPLATES = '11 Templates'
const RESERVED = new Set(['connection_status', ...dist.SELECTIONS.map((s: any) => s.id)])
const SELECTION_IDS = new Set(dist.SELECTIONS.map((s: any) => s.id))

const buttonIds = Object.entries(presets)
	.filter(([, p]: [string, any]) => p.type === 'button')
	.map(([id]) => id)

test('preset ids are unique, stable and match the catalog in both directions', () => {
	const rowIds = catalog.rows.map((r: any) => r.presetId)
	const textIds = catalog.textPresets.map((t: any) => t.presetId)
	assert.equal(new Set(rowIds).size, rowIds.length, 'duplicate row ids in the catalog')
	assert.equal(new Set([...rowIds, ...textIds]).size, rowIds.length + textIds.length, 'text/button id clash')
	for (const id of [...rowIds, ...textIds]) assert.ok(/^[a-z][a-z0-9_]*$/.test(id), `bad id ${id}`)

	for (const id of rowIds) assert.ok(id in presets, `catalog row ${id} has no preset`)
	for (const id of textIds) assert.ok(id in presets, `catalog text ${id} has no preset`)
	const known = new Set([...rowIds, ...textIds])
	for (const id of Object.keys(presets)) {
		if (id.startsWith('exp_heading_')) continue
		assert.ok(known.has(id), `preset ${id} is not in the catalog`)
	}
	assert.equal(catalog.rows.length, dist.PRESET_CATALOG.length)
	assert.equal(catalog.textPresets.length, dist.PRESET_TEXTS.length)
})

test('generated presetCatalog.ts equals the catalog JSON field by field', () => {
	const rowsById = new Map(catalog.rows.map((r: any) => [r.presetId, r]))
	for (const entry of dist.PRESET_CATALOG) {
		const row: any = rowsById.get(entry.id)
		assert.ok(row, `no catalog row for ${entry.id}`)
		assert.equal(entry.category, row.category, entry.id)
		assert.equal(entry.homeCategory, row.homeCategory, entry.id)
		assert.equal(entry.tier, row.tier, entry.id)
		assert.equal(entry.name, row.name, entry.id)
		assert.equal(entry.kind, row.controlKind, entry.id)
		assert.equal(entry.objectPath, row.objectPath ?? '', entry.id)
		assert.equal(entry.propertyPath, row.propertyPath ?? '', entry.id)
		assert.equal(entry.variableName, row.variableName, entry.id)
		assert.equal(entry.freqClass, row.freqClass, entry.id)
		assert.equal(entry.text, row.textTemplate ?? '', entry.id)
		assert.equal(entry.textExpression, !!row.textExpression, entry.id)
		assert.equal(entry.status, row.status, entry.id)
		assert.deepEqual(
			entry.actions.map((a: any) => [a.set, a.actionId, a.options]),
			(row.actions ?? []).map((a: any) => [a.set, a.actionId, a.options]),
			entry.id,
		)
		assert.equal(!!entry.stateColour, !!row.stateColour, entry.id)
	}
})

test('every preset references defined actions and feedbacks with complete, well-typed options', () => {
	const checkOptions = (presetId: string, kind: string, definition: any, options: Record<string, unknown>) => {
		const fields = (definition.options ?? []).filter((f: any) => f.type !== 'static-text')
		for (const field of fields) {
			assert.ok(field.id in options, `${presetId}: ${kind} option ${field.id} missing (presets get no defaults)`)
			const value = options[field.id]
			switch (field.type) {
				case 'textinput':
					assert.equal(typeof value, 'string', `${presetId}: ${kind} option ${field.id} must be a string`)
					break
				case 'number':
					assert.equal(typeof value, 'number', `${presetId}: ${kind} option ${field.id} must be a number`)
					if (field.min !== undefined) assert.ok((value as number) >= field.min, `${presetId}: ${field.id} below min`)
					if (field.max !== undefined) assert.ok((value as number) <= field.max, `${presetId}: ${field.id} above max`)
					break
				case 'checkbox':
					assert.equal(typeof value, 'boolean', `${presetId}: ${kind} option ${field.id} must be a boolean`)
					break
				case 'dropdown':
					assert.ok(
						field.choices.some((c: any) => c.id === value),
						`${presetId}: ${kind} option ${field.id} value ${String(value)} is not a choice`,
					)
					break
			}
		}
		for (const key of Object.keys(options)) {
			assert.ok(
				fields.some((f: any) => f.id === key),
				`${presetId}: ${kind} option ${key} is not defined on ${definition.name}`,
			)
		}
	}

	for (const id of buttonIds) {
		const preset: any = presets[id]
		for (const feedback of preset.feedbacks) {
			const definition = feedbackDefs[feedback.feedbackId]
			assert.ok(definition, `${id}: feedback ${feedback.feedbackId} is not defined`)
			checkOptions(id, `feedback ${feedback.feedbackId}`, definition, feedback.options)
			if (feedback.style) assert.equal(definition.type, 'boolean', `${id}: style on a non-boolean feedback`)
		}
		for (const step of preset.steps) {
			for (const set of ['down', 'up', 'rotate_left', 'rotate_right']) {
				for (const action of step[set] ?? []) {
					const definition = actionDefs[action.actionId]
					assert.ok(definition, `${id}: action ${action.actionId} is not defined`)
					checkOptions(id, `action ${action.actionId}`, definition, action.options)
				}
			}
			const rotary = (step.rotate_left?.length ?? 0) + (step.rotate_right?.length ?? 0) > 0
			assert.equal(!!preset.options?.rotaryActions, rotary, `${id}: rotaryActions flag`)
		}
	}
})

test('control presets carry the LiveUpdate Variable feedback of the variable they write', () => {
	for (const id of buttonIds) {
		const preset: any = presets[id]
		const carrier = preset.feedbacks.find((f: any) => f.feedbackId === 'liveUpdateVariable')
		for (const step of preset.steps) {
			for (const set of ['down', 'up', 'rotate_left', 'rotate_right']) {
				for (const action of step[set] ?? []) {
					if (action.actionId === 'setSelection') continue
					assert.ok(carrier, `${id}: action without a LiveUpdate Variable feedback`)
					assert.equal(action.options.variableName, carrier.options.variableName, `${id}: action variable mismatch`)
					if (action.actionId === 'setToDisguiseNumber') {
						const expression = String(action.options.value).replace(/\$\(liveupdate:[A-Za-z0-9_]+\)/g, '1')
						// eslint-disable-next-line @typescript-eslint/no-implied-eval
						assert.equal(typeof new Function('return ' + expression)(), 'number', `${id}: number expression`)
					}
					if (action.actionId === 'setToDisguiseJSON') JSON.parse(String(action.options.value))
					if (action.actionId === 'setToDisguiseBoolean') assert.equal(typeof action.options.value, 'boolean')
				}
			}
		}
		const compare = preset.feedbacks.find((f: any) => f.feedbackId === 'liveUpdateCompare')
		if (compare) {
			assert.ok(carrier, `${id}: compare feedback without a carrier`)
			assert.equal(compare.options.variableName, carrier.options.variableName, `${id}: compare variable mismatch`)
		}
	}
})

test('variable names are valid, not reserved, and unique per object/property pair', () => {
	const pairToVariable = new Map<string, string>()
	const variableToPair = new Map<string, string>()
	for (const row of catalog.rows) {
		assert.ok(/^[A-Za-z0-9_-]{1,40}$/.test(row.variableName), `${row.presetId}: bad variable ${row.variableName}`)
		// module-native rows (no object path) may point at the module's own variables
		if (row.objectPath)
			assert.ok(!RESERVED.has(row.variableName), `${row.presetId}: reserved variable ${row.variableName}`)
		if (row.category === TEMPLATES || !row.objectPath) continue
		const pair = `${row.objectPath}\n${row.propertyPath}`
		const seenVariable = pairToVariable.get(pair)
		if (seenVariable) assert.equal(seenVariable, row.variableName, `${row.presetId}: pair has two variable names`)
		else pairToVariable.set(pair, row.variableName)
		const seenPair = variableToPair.get(row.variableName)
		if (seenPair) assert.equal(seenPair, pair, `${row.presetId}: variable ${row.variableName} used for two pairs`)
		else variableToPair.set(row.variableName, pair)
	}
})

test('placeholders and variable references follow the naming rules', () => {
	for (const row of catalog.rows) {
		const paths = `${row.objectPath} ${row.propertyPath}`
		const placeholders = paths.match(/<[A-Z][A-Z0-9_]*>/g) ?? []
		if (row.category === TEMPLATES) assert.ok(placeholders.length > 0, `${row.presetId}: template without placeholder`)
		else assert.equal(placeholders.length, 0, `${row.presetId}: placeholder outside Templates`)

		for (const match of paths.matchAll(/\$\(([a-z]+):([A-Za-z0-9_]+)\)/g)) {
			assert.equal(match[1], 'liveupdate', `${row.presetId}: foreign variable ${match[0]} in a path`)
			assert.ok(SELECTION_IDS.has(match[2]), `${row.presetId}: unknown selection ${match[2]}`)
		}
		for (const match of String(row.textTemplate ?? '').matchAll(/\$\(([a-z]+):([A-Za-z0-9_]+)\)/g)) {
			assert.equal(match[1], 'liveupdate', `${row.presetId}: foreign variable ${match[0]} in text`)
			assert.ok(
				match[2] === row.variableName || SELECTION_IDS.has(match[2]),
				`${row.presetId}: text references ${match[2]}`,
			)
		}
		if (row.textExpression)
			assert.ok(/^`[\s\S]*`$/.test(row.textTemplate), `${row.presetId}: expression text not a template`)
	}
	// every selection the presets use exists, and experimental-only selections are used only by experimental rows
	for (const selection of dist.SELECTIONS) {
		const users = catalog.rows.filter((r: any) =>
			`${r.objectPath} ${r.propertyPath}`.includes(`$(liveupdate:${selection.id})`),
		)
		assert.ok(users.length > 0, `selection ${selection.id} is unused`)
		if (selection.experimental) {
			for (const row of users)
				assert.equal(row.tier, 'experimental', `${row.presetId}: normal row uses experimental selection`)
		}
	}
})

test('tiers: experimental rows are read-only, gated by the setting and grouped by home category', () => {
	for (const row of catalog.rows) {
		const preset: any = presets[row.presetId]
		if (row.tier === 'experimental') {
			assert.equal(row.category, EXPERIMENTAL, row.presetId)
			assert.equal(preset.category, EXPERIMENTAL, row.presetId)
			assert.ok(preset.name.startsWith('[EXP] '), row.presetId)
			assert.ok(preset.name.length <= 46, `${row.presetId}: name too long`)
			for (const step of preset.steps)
				for (const set of ['down', 'up', 'rotate_left', 'rotate_right'])
					assert.equal((step[set] ?? []).length, 0, `${row.presetId}: experimental row with actions`)
			assert.ok(!(row.presetId in normalOnly), `${row.presetId}: experimental preset visible by default`)
		} else {
			assert.ok(['doc-verified', 'live-verified'].includes(row.status), `${row.presetId}: normal row not verified`)
			assert.notEqual(row.category, EXPERIMENTAL, row.presetId)
			assert.ok(row.presetId in normalOnly, `${row.presetId}: normal preset missing`)
			assert.ok(preset.name.length <= 40, `${row.presetId}: name too long`)
		}
	}
	const homes = new Set(catalog.rows.filter((r: any) => r.tier === 'experimental').map((r: any) => r.homeCategory))
	const headings = Object.entries(presets).filter(
		([id, p]: [string, any]) => id.startsWith('exp_heading_') && p.type === 'text',
	)
	assert.equal(headings.length, homes.size, 'one generated heading per home category')
})

test('every category is numbered and starts with its text preset; intervals come from the settings', () => {
	const firstOfCategory = new Map<string, any>()
	for (const [id, preset] of Object.entries(presets)) {
		assert.ok(/^\d{2} /.test(preset.category), `${id}: category ${preset.category} has no numeric prefix`)
		if (!firstOfCategory.has(preset.category)) firstOfCategory.set(preset.category, { id, preset })
	}
	for (const [category, first] of firstOfCategory)
		assert.equal(first.preset.type, 'text', `${category} starts with ${first.id}`)

	const custom = dist.getPresetDefinitions({
		config: {
			host: 'x',
			port: 80,
			presetIntervalMonitoring: 2000,
			presetIntervalPlayhead: 100,
			presetIntervalState: 50,
			presetIntervalStatic: 9000,
		},
	})
	const expected: Record<string, number> = { monitoring: 2000, playhead: 100, state: 50, static: 9000 }
	for (const row of catalog.rows) {
		if (row.tier !== 'normal' || !row.objectPath) continue
		const preset: any = custom[row.presetId]
		const carrier = preset.feedbacks.find((f: any) => f.feedbackId === 'liveUpdateVariable')
		assert.equal(
			carrier.options.updateFrequency,
			expected[row.freqClass],
			`${row.presetId}: interval class ${row.freqClass}`,
		)
	}
})

test('conn_status is the module-native indicator', () => {
	const preset: any = presets.conn_status
	assert.ok(preset)
	assert.ok(!preset.feedbacks.some((f: any) => f.feedbackId === 'liveUpdateVariable'))
	assert.ok(preset.feedbacks.some((f: any) => f.feedbackId === 'connectionState' && f.style))
})

test('HELP lists every preset and every selection', () => {
	const block = help.slice(help.indexOf('<!-- PRESETS:START -->'), help.indexOf('<!-- PRESETS:END -->'))
	for (const row of catalog.rows) {
		const name = (row.tier === 'experimental' ? '[EXP] ' : '') + row.name
		assert.ok(block.includes(`| ${name.replace(/\|/g, '\\|')} |`), `HELP preset list lacks ${row.presetId}`)
	}
	for (const selection of dist.SELECTIONS)
		assert.ok(help.includes(selection.id), `HELP lacks selection ${selection.id}`)
})

test('live verification results: every row carries one and no row is left on a rejected subscription', () => {
	const allowed = new Set(['confirmed-value', 'confirmed-path-error', 'confirmed-no-value', 'not-run', 'n/a'])
	for (const row of catalog.rows) {
		assert.ok(row.live && allowed.has(row.live.status), `${row.presetId}: live status ${row.live?.status}`)
		if (row.status === 'live-verified')
			assert.equal(row.live.status, 'confirmed-value', `${row.presetId}: live-verified without a confirmed value`)
		if (row.live.status === 'confirmed-value' && row.tier === 'normal' && !row.live.note)
			assert.equal(row.status, 'live-verified', `${row.presetId}: confirmed live but not promoted to live-verified`)
	}
	assert.ok(catalog.liveVerification?.date, 'catalog carries the live verification summary')
	for (const removed of catalog.liveVerification.removed)
		assert.ok(!catalog.rows.some((r: any) => r.presetId === removed.presetId), `${removed.presetId} still present`)
})
