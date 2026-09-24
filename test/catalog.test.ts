/**
 * Catalog <-> implementation consistency: the generated presets must match the catalog JSON
 * (docs/research/phase1-catalog.json) row for row, and every preset must reference only defined
 * actions, feedbacks and option ids with values of the declared types.
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { destroyInstances, FakeDirector, loadDist, newInstance, ROOT } from './harness'

afterEach(destroyInstances)

const dist = loadDist()
const catalogText = readFileSync(path.join(ROOT, 'docs/research/phase1-catalog.json'), 'utf8')
const catalog = JSON.parse(catalogText)
const help = readFileSync(path.join(ROOT, 'companion/HELP.md'), 'utf8')
/** Companion 5.0.4's expression semantics, shared with scripts/gen-presets.mjs */
/* eslint-disable @typescript-eslint/no-require-imports */
const expression = require(path.join(ROOT, 'scripts/companion-expression.cjs'))
const distConfig = require(path.join(ROOT, 'dist/config.js'))
const distVariables = require(path.join(ROOT, 'dist/variables.js'))
/* eslint-enable @typescript-eslint/no-require-imports */

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

test('HELP and README name every setting, feedback, action and module variable', () => {
	const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8')
	// Markdown wraps lines, so a name can be split across two of them
	const flat = (text: string): string => text.replace(/\s+/g, ' ')
	const helpText = flat(help)
	const readmeText = flat(readme)
	for (const field of distConfig.getConfigFields()) {
		if (field.type === 'static-text' || SELECTION_IDS.has(field.id) || field.id.startsWith('presetInterval')) continue
		assert.ok(helpText.includes(field.label), `HELP lacks the setting '${field.label}'`)
	}
	for (const feedback of Object.values(feedbackDefs)) {
		assert.ok(helpText.includes(`### ${feedback.name}`), `HELP has no section for the feedback '${feedback.name}'`)
		assert.ok(readmeText.includes(`**${feedback.name}**`), `README lacks the feedback '${feedback.name}'`)
	}
	for (const action of Object.values(actionDefs)) {
		const name = String(action.name)
		if (name.startsWith('Set selection: ')) continue
		const command = /^(?:Transport|RenderStream|Failover): (.+)$/.exec(name)
		if (command) assert.ok(helpText.includes(`*${command[1]}*`), `HELP lacks the command '${name}'`)
		else if (/^Set to Disguise \(/.test(name))
			assert.ok(helpText.includes('Set to Disguise (String / Number / Boolean / JSON)'), `HELP lacks '${name}'`)
		else assert.ok(helpText.includes(name), `HELP lacks the action '${name}'`)
	}
	for (const { variableId } of distVariables.getVariableDefinitions()) {
		if (SELECTION_IDS.has(variableId)) continue
		assert.ok(helpText.includes(`\`${variableId}\``), `HELP lacks the variable ${variableId}`)
		assert.ok(readmeText.includes(`\`${variableId}\``), `README lacks the variable ${variableId}`)
	}
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

test('write verification: recorded rows are writable, restored, and use known actions', () => {
	const actionIds = new Set(Object.keys(actionDefs))
	let recorded = 0
	for (const row of catalog.rows) {
		if (!row.write) continue
		recorded++
		assert.equal(row.writable, 'yes', `${row.presetId}: write result on a read-only row`)
		assert.ok(String(row.write.status).startsWith('write-'), `${row.presetId}: status ${row.write.status}`)
		assert.ok(
			row.write.restored === 'restored' || String(row.write.restored).startsWith('original value'),
			`${row.presetId}: not restored (${row.write.restored})`,
		)
		if (row.write.e2e) assert.equal(row.write.e2e.restored, true, `${row.presetId}: e2e step not restored`)
		assert.equal(row.status, 'live-verified', `${row.presetId}: written but not live-verified`)
		for (const action of row.actions ?? [])
			assert.ok(actionIds.has(action.actionId), `${row.presetId}: unknown action ${action.actionId}`)
	}
	assert.ok(recorded > 0, 'at least one row carries a write result')
	assert.ok(catalog.writeVerification?.date, 'catalog carries the write verification summary')
})

test('expression button text keeps every variable reference inside a substitution', () => {
	for (const [id, preset] of Object.entries(presets)) {
		const p = preset
		if (p.type === 'text' || !p.style?.textExpression) continue
		const literal = String(p.style.text).replace(/\$\{[^}]*\}/g, '')
		assert.ok(
			!/\$\(liveupdate:/.test(literal),
			`${id}: a $(liveupdate:...) reference outside \${ } renders as literal text: ${p.style.text}`,
		)
	}
})

test('preset previews carry no address or hostname from a real installation', () => {
	const forbidden = /\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/
	for (const [id, preset] of Object.entries(presets)) {
		const p = preset
		const text = `${p.previewStyle?.text ?? ''} ${p.style?.text ?? ''} ${p.text ?? ''}`
		const match = forbidden.exec(text)
		// RFC 5737 documentation ranges are fine
		if (match && !/^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(match[0]))
			assert.fail(`${id}: preview contains the address ${match[0]}`)
	}
})

test('each Templates preset ships its own variable name', () => {
	const templates = catalog.rows.filter((r: any) => r.category === '11 Templates')
	const names = templates.map((r: any) => r.variableName)
	assert.equal(new Set(names).size, names.length, `template variable names collide: ${names.join(', ')}`)
	for (const row of templates)
		assert.ok(/^[A-Za-z0-9_-]{1,40}$/.test(row.variableName), `${row.presetId}: bad variable ${row.variableName}`)
})

const liveupdate = (values: Record<string, unknown>): Record<string, unknown> =>
	Object.fromEntries(Object.entries(values).map(([name, value]) => [`liveupdate:${name}`, value]))

test('the offline renderer reproduces what Companion 5.0.4 shows', () => {
	const render = expression.renderExpression
	const v = (value: unknown) => liveupdate({ v: value })
	// a ternary tests truthiness and bool() is true for any other word: a marker took the true branch
	assert.equal(render("`${$(liveupdate:v) ? 'YES' : 'no'}`", v('OFFLINE')), 'YES')
	assert.equal(render("`${bool($(liveupdate:v)) ? 'RUNNING' : 'STOPPED'}`", v('PATH_ERROR')), 'RUNNING')
	// formatting turns a marker into NaN, a count into the length of the word
	assert.equal(render('`${toFixed($(liveupdate:v), 1)}`', v('OFFLINE')), 'NaN')
	assert.equal(render('`${secondsToTimestamp($(liveupdate:v))}`', v('ERROR')), 'NaN:NaN:NaN')
	assert.equal(render("`${jsonpath($(liveupdate:v), '$.length')}`", v('OFFLINE')), '7')
	assert.equal(render('`${length(jsonparse($(liveupdate:v)))}`', v('ERROR')), '0')
	// '+' is numeric: Companion resolves expressions with stringConcatenation off
	assert.equal(render("`${'$.' + $(liveupdate:v)}`", v('speed')), 'NaN')
	// an undefined slot renders $NA; normal values format as usual
	assert.equal(render('`x ${$(liveupdate:v)}`', {}), 'x $NA')
	assert.equal(render('`${secondsToTimestamp($(liveupdate:v))}`', v(3725)), '01:02:05')
	assert.equal(render('`${isNumber($(liveupdate:v))} ${isNumber("")} ${isNumber("2.5")}`', v(true)), 'false false true')
	assert.throws(() => render('`${notAFunction(1)}`'), /notAFunction/)
})

test('every expression text shows a readout marker or an undefined value as it is', () => {
	// the generator reads the markers from the source; they must be the ones the module writes
	const fromSource = expression.readMarkers(readFileSync(path.join(ROOT, 'src/variables.ts'), 'utf8'))
	assert.deepEqual(fromSource, [...dist.SENTINELS])
	const failures: string[] = []
	for (const entry of dist.PRESET_CATALOG) {
		if (!entry.textExpression) continue
		const problems: string[] = expression.markerProblems(entry.text, dist.SENTINELS)
		if (problems.length) failures.push(`${entry.id}: ${problems[0]}`)
	}
	assert.deepEqual(failures, [])

	const text = (id: string) => dist.PRESET_CATALOG.find((e: any) => e.id === id).text
	const render = expression.renderExpression
	assert.equal(render(text('tr_playing'), liveupdate({ isPlaying: 'OFFLINE' })), 'Playing\\nOFFLINE')
	assert.equal(
		render(text('rs_inst_running'), liveupdate({ rsInstanceProcessRunning: 'PATH_ERROR' })),
		'Process\\nPATH_ERROR',
	)
	assert.equal(render(text('monl_gpu_total'), liveupdate({ gpuTotalMs: 'UNSET' })), 'GPU total\\nUNSET')
	assert.equal(render(text('trk_layer_names'), liveupdate({ trackLayerNames: 'ERROR' })), 'Layers\\nERROR')
	assert.equal(render(text('fo_targets'), liveupdate({ understudyTargets: 'OFFLINE' })), 'Targets\\nOFFLINE')
	assert.equal(render(text('rs_layer_framerate'), liveupdate({})), 'FPS Fraction\\n$NA')
	assert.equal(render(text('stg_screen_offset'), liveupdate({ screenOffset: 'OFFLINE' })), 'Offset (m)\\nOFFLINE')
})

/** Normal values render exactly as the unguarded texts did (outputs recorded from those texts) */
const NORMAL_RENDERINGS: [string, Record<string, unknown>, string][] = [
	['monl_fps', { fps: 59.94269478380189 }, 'FPS\\n59.9'],
	['monl_gpu_total', { gpuTotalMs: 3.5404800000000005 }, 'GPU total\\n3.5 ms'],
	['monl_gpu_mem', { gpuMemMb: 1110 }, 'GPU mem MB\\n1110'],
	['monl_proc_mem', { processMemMb: 2625.26171875 }, 'Proc mem\\n2625 MB'],
	['monl_machine_cpu_time', { machineCpuPct: 55.99219799041748 }, 'CPU time\\n56%'],
	['monr_fps', { selHost: 'RX1', remoteFps: 59.94089827432126 }, 'RX1 FPS\\n59.9'],
	['monl_fps_minmax', { fpsMinMax: '{"Actual":{"latest":59.9,"min":58.2,"max":60.1}}' }, 'FPS min\\n58.2'],
	['tr_playing', { isPlaying: true }, 'Playing\\nYES'],
	['tr_playing', { isPlaying: false }, 'Playing\\nno'],
	['tr_brightness', { brightness: 0.95 }, 'Brightness\\n95%'],
	['tr_speed', { speed: 1 }, 'Speed\\n1.00x'],
	['tr_trackposition', { trackposition: 3210.8333333333335 }, 'Position\\n00:53:30'],
	['tr_section_index', { sectionIndex: 32 }, 'Section\\n33'],
	['trk_section_start', { selSection: '2', sectionStartBeats: 64 }, 'Sec 2 start\\n64.0 b'],
	['trk_layer_names', { trackLayerNames: '["Video 1","Audio"]' }, 'Layers\\n2'],
	['trk_layer_keytimes', { layerKeyTimes: '[]' }, 'Key beats\\n0'],
	[
		'trk_layer_extents',
		{ selLayer: 'Colour Layer', layerExtents: '{"start":0,"length":4500,"end":4500,"name":"Colour Layer"}' },
		'Colour Layer\\n0.0-4500.0',
	],
	[
		'trk_key_video',
		{ keyVideo: '{"uid":"0x1","path":"objects/videofile/sample.mov"}' },
		'Clip\\nobjects/videofile/sample.mov',
	],
	[
		'stg_screen_offset',
		{ screenOffset: '{"x":0,"y":3.619999885559082,"z":2.450000047683716}' },
		'Offset (m)\\n0.00 3.62 2.45',
	],
	['stg_screen_render_layer', { screenRenderLayer: 1 }, 'Layer\\nOn stage'],
	['stg_screen_render_layer', { screenRenderLayer: 9 }, 'Layer\\n9'],
	['stg_screen_off_stage', { screenRenderLayer: 0 }, 'Off stage\\nOFF'],
	['stg_screen_off_stage', { screenRenderLayer: 3 }, 'Off stage\\non'],
	['stg_stage_dyn_blend', { stageDynBlend: 0 }, 'Dyn blend\\nOff'],
	['ev_uid_type', { evType: 1 }, 'Type\nString'],
	['rs_inst_running', { rsInstanceProcessRunning: true }, 'Process\\nRUNNING'],
	['rs_inst_running', { rsInstanceProcessRunning: false }, 'Process\\nSTOPPED'],
	['rs_licensing', { rsLicensingState: 2 }, 'RS License\\nFULL'],
	[
		'rs_workload_instances',
		{ rsWorkloadInstances: '[{"machineName":"RX1"},{"machineName":"RX2"}]' },
		'Nodes\\nRX1,RX2',
	],
	['rs_status_msgs', { rsReceiveStatusMessages: '["Receiving","Receiving"]' }, 'Stream Status\\nReceiving,Receiving'],
	['rs_layer_health', { rsLayerClusterHealth: '{"status":0,"message":"Not started"}' }, 'Cluster\\nNot started'],
	['rs_layer_framerate', { rsLayerFramerateFraction: 2 }, 'FPS Fraction\\n1/3'],
	['fo_role', { machineRole: 3 }, 'Role\\nActor (3)'],
	['fo_role', { machineRole: 9 }, 'Role\\n? (9)'],
	['fo_targets', { understudyTargets: '[{"uid":"0x1"},{"uid":"0x2"}]' }, 'Targets\\n2'],
	['fo_d3net_ref', { d3NetManagerRef: '{"uid":"0x0123456789abcdef"}' }, 'd3Net uid\\n0x0123456789abcdef'],
	['fo_taken_over', { machineTakenOver: false }, 'Taken over\\nno'],
	['fo_failover_timeout', { failoverTimeout: 0 }, 'Failover t/o\\nOFF (0)'],
	['tpl_watch_json', { tplJson: '{"x":0.5,"y":1}' }, 'x\\n0.5'],
]

test('guarded expression texts render normal values exactly as before', () => {
	for (const [id, values, expected] of NORMAL_RENDERINGS) {
		const entry = dist.PRESET_CATALOG.find((e: any) => e.id === id)
		assert.equal(expression.renderExpression(entry.text, liveupdate(values)), expected, id)
	}
	// the dictionary lookup builds its path with concat(): '$.' + name was NaN, so it always showed $NA
	const dictionary = dist.PRESET_CATALOG.find((e: any) => e.id === 'ev_dev_all_dict')
	assert.equal(
		expression.renderExpression(dictionary.text, liveupdate({ selEvName: 'speed', evDevAllDict: '{"speed":0.5}' })),
		'speed\n0.5',
	)
})

test('preset feedback paths carry the label of the connection they are built for', () => {
	// Companion 5.0.4 relabels $(liveupdate:...) in a preset's text and actions but not in its feedbacks
	const config = { host: '192.0.2.10', port: 80, showExperimentalPresets: true }
	const labelled = dist.getPresetDefinitions({ label: 'd3_b', config })
	const carrier = (all: Record<string, any>, id: string) =>
		all[id].feedbacks.find((f: any) => f.feedbackId === 'liveUpdateVariable').options
	assert.equal(carrier(labelled, 'trk_track_name').objectPath, 'track:"$(d3_b:selTrack)"')
	assert.equal(
		carrier(labelled, 'rs_inst_running').propertyPath,
		'object.getWorkloadInstance($(d3_b:selWorkload), $(d3_b:selInstance)).isProcessRunning',
	)
	for (const [id, preset] of Object.entries(labelled)) {
		for (const feedback of preset.feedbacks ?? [])
			assert.ok(!JSON.stringify(feedback.options).includes('$(liveupdate:'), `${id}: feedback keeps $(liveupdate:`)
	}
	// the catalog's own label, and a connection without one, keep the paths as they are
	assert.equal(carrier(presets, 'trk_track_name').objectPath, 'track:"$(liveupdate:selTrack)"')
	const unlabelled = dist.getPresetDefinitions({ label: '', config })
	assert.equal(carrier(unlabelled, 'trk_track_name').objectPath, 'track:"$(liveupdate:selTrack)"')
})

test('renaming the connection publishes presets with the new label', async () => {
	const { inst, host } = await newInstance(new FakeDirector())
	const objectPath = () => {
		const preset = host.presetDefinitions.trk_track_name as any
		return preset.feedbacks.find((f: any) => f.feedbackId === 'liveUpdateVariable').options.objectPath
	}
	assert.equal(objectPath(), 'track:"$(liveupdate:selTrack)"')
	// module-base sets the new label and calls configUpdated with the unchanged config
	inst.label = 'd3_b'
	await inst.configUpdated({ ...inst.config })
	assert.equal(objectPath(), 'track:"$(d3_b:selTrack)"')
})

test("setup texts send commands to this module's REST actions, not to another module", () => {
	const actionNames = Object.values(actionDefs).map((a: any) => String(a.name))
	for (const id of ['conn_setup', 'tr_setup', 'rs_setup', 'fo_setup']) {
		const text: string = dist.PRESET_TEXTS.find((t: any) => t.id === id).text
		assert.ok(
			!/companion-module-disguise-osc|cannot issue transport|only available through the REST/.test(text),
			`${id} still sends commands elsewhere`,
		)
		const named = text.match(/'(?:Transport|RenderStream|Failover):'/g) ?? []
		assert.ok(named.length > 0, `${id} names no command action`)
		for (const prefix of named)
			assert.ok(
				actionNames.some((name) => name.startsWith(prefix.slice(1, -1))),
				`${id} names ${prefix}, which no action has`,
			)
	}
	const connection: string = dist.PRESET_TEXTS.find((t: any) => t.id === 'conn_setup').text
	for (const prefix of ['Transport:', 'RenderStream:', 'Failover:'])
		assert.ok(connection.includes(`'${prefix}'`), `conn_setup does not name the ${prefix} actions`)
})

test('no preset carries a redaction placeholder and the catalog cites no local file', () => {
	for (const [id, preset] of Object.entries(presets))
		assert.ok(!JSON.stringify(preset).includes('<redacted'), `${id} carries a redaction placeholder`)
	const local = /[A-Za-z]:[\\/]+Users[\\/]|scratchpad|AppData|[\\/]Desktop[\\/]/i.exec(catalogText)
	assert.equal(local, null, `the catalog cites a path on the author's machine: ${local?.[0]}`)
})
