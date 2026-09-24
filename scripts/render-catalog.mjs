// Renders docs/PRESET_CATALOG.md from docs/research/phase1-catalog.json.
//
// The JSON is the single source of truth for the preset library (rows, text presets, the lead's
// merge decisions, the drafter/verifier notes and the cross-category critique). Edit the JSON,
// then run: node scripts/render-catalog.mjs && node scripts/gen-presets.mjs && node scripts/gen-help.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(readFileSync(resolve(root, 'docs/research/phase1-catalog.json'), 'utf8'))
const outMd = resolve(root, 'docs/PRESET_CATALOG.md')

const esc = (s) =>
	String(s ?? '')
		.replace(/\r?\n/g, ' ')
		.replace(/\|/g, '\\|')
		.trim()
const code = (s) => {
	s = String(s ?? '')
		.replace(/\r?\n/g, '\\n')
		.trim()
	if (!s) return ''
	return s.includes('`') ? '`` ' + s.replace(/\|/g, '\\|') + ' ``' : '`' + s.replace(/\|/g, '\\|') + '`'
}
const liveCell = (x) =>
	x.live
		? esc(x.live.status) +
			(x.live.note
				? ': ' + esc(x.live.note)
				: x.live.message
					? ': ' + esc(x.live.message)
					: x.live.value !== undefined
						? ' (' + code(x.live.value) + ')'
						: '')
		: 'not run'
const writeCell = (x) => {
	if (!x.write) return x.writable === 'yes' ? 'not written' : 'read-only'
	const e2e = x.write.e2e
		? `; module action ${x.write.e2e.written ? 'applied' : 'NOT applied'}/${x.write.e2e.restored ? 'restored' : 'NOT restored'}`
		: ''
	return esc(
		`${x.write.status} (${JSON.stringify(x.write.before)} → ${JSON.stringify(x.write.wrote)} → restored)${e2e}`,
	)
}
const FREQ = { monitoring: 1000, playhead: 250, state: 500, static: 5000 }
const FREQ_WHY = {
	monitoring: 'Director pushes every frame when unthrottled; a button needs ≤ 1–2 Hz',
	playhead: '4 Hz keeps a time readout smooth without flooding Companion',
	state: 'change-driven value; 500 ms caps bursts',
	static: 'changes only on edit; the Director still delivers a change within one cycle',
}
const CAT_ORDER = [
	'01 Connection',
	'02 Monitoring Local',
	'03 Monitoring Remote',
	'04 Transport State',
	'05 Track & Layer',
	'06 Layer Control',
	'07 Stage & Screen',
	'08 Expression Variables',
	'09 RenderStream',
	'10 Failover & d3Net',
	'11 Templates',
	'99 Experimental',
]
const SEL_DEFS = {
	selTrack: 'track name as shown in Designer, e.g. Track 1 (quoted by the paths)',
	selLayer: 'layer name inside the selected track, e.g. Video 1',
	selLayerIndex:
		'0-based position in the track layer list, track.layers (unquoted integer), for the "(by index)" presets',
	selSection: '0-based section index (unquoted integer)',
	selBeat: 'a track beat as a number, e.g. 32',
	selScreen: 'Surface (screen2) name',
	selProjector: 'projector name',
	selScreenUid: 'UID of any display, hex with 0x prefix (right-click the editor title bar > Copy UID)',
	selMachine: 'Machine resource name as listed in d3Net Manager',
	selHost: 'hostname of the remote machine WITHOUT the :d3 suffix (the presets append it)',
	selWorkload:
		'RenderStream workload id as unquoted decimal digits (uint64; the [EXP] RS Layer Workload ID preset shows it as text, or Cluster Workload widget > Copy UID / REST layerstatus)',
	selInstance: '0-based RenderStream instance index (unquoted integer)',
	selEvUid: 'UID of the Expression Variables device, hex with 0x prefix',
	selEvIndex: '0-based row index of the variable inside the device (unquoted integer)',
	selTransport: '[Experimental] transport manager name other than default',
	selLedScreen: 'LED screen name',
	selDmxScreen: '[Experimental] DMX screen name',
	selStageUid: 'Stage UID, hex with 0x prefix',
	selEvDevice:
		'[Experimental] Expression Variables device name (file name part of objects/ExpressionVariablesDevice/<name>.apx)',
	selEvName: '[Experimental] expression variable name, case-sensitive',
	selEvLayer: '[Experimental] Expression Variables layer name (module: prefix)',
	selRsLayer: "0-based index among the track's RenderStream leaf layers",
}

const allRows = catalog.rows
const allText = catalog.textPresets
const usedSel = new Set()
for (const x of allRows)
	for (const m of (x.objectPath + ' ' + x.propertyPath).matchAll(/\$\(liveupdate:(sel[A-Za-z0-9_]+)\)/g))
		usedSel.add(m[1])

const md = []
md.push('# Preset catalog — companion-module-disguise-liveupdate (Phase 1 design)')
md.push('')
md.push(
	'Design rules: [PRESET_CATALOG_RULES.md](PRESET_CATALOG_RULES.md). Source candidates with citations: [PHASE0_CANDIDATES.md](PHASE0_CANDIDATES.md). Every button row was drafted from Phase 0 candidates (column *source* lists the candidate ids), checked by an adversarial verifier against the candidate JSON and the rules, reviewed by a cross-category critic, and then merged by the lead (decisions listed at the end). Verifier corrections applied in place are marked ✎; rows the verifier still flagged carry ⚠ with the problem listed under the table. This file is rendered from `docs/research/phase1-catalog.json` by `scripts/render-catalog.mjs`; `scripts/gen-presets.mjs` turns the same JSON into `src/presetCatalog.ts`.',
)
md.push('')
md.push(
	"**Commands** (play, stop, section and track jumps, RenderStream workload control, failover) are not reachable through LiveUpdate; the module sends them over the Designer Session REST API as its 'Transport:', 'RenderStream:' and 'Failover:' actions (see *Commands* in the HELP). This catalog lists the LiveUpdate readouts and property knobs around them.",
)
md.push('')
md.push(
	'Status values: `doc-verified` (normal tier, shipped by default), `unverified` (Experimental tier: read-only, shown only when the connection setting *Show experimental presets* is on), `doc-verified` rows inside 99 Experimental are documented comprehensions kept there by rule. `live-verified` = the exact object/property pair returned a value from a Designer r34.0.3 Director on 2026-09-04 (Phase 3; evidence in `docs/research/live-verification.json` and `docs/research/live-verification-probes.json`). The *live* column shows the per-row result: `confirmed-value`, `confirmed-path-error` (subscription accepted, the Director reported an evaluation error, in every remaining case a project-specific one), `confirmed-no-value` (accepted, no value within the timeout), `not-run` (a selection had no value in the test project) or `n/a` (templates). Live-confirmed experimental rows were promoted to their home categories on 2026-09-04 (user decision; the JSON key `promotion` lists them).',
)
md.push('')
md.push('## Summary')
md.push('')
md.push('| category | button presets | text headings | unique subscriptions |')
md.push('|---|---|---|---|')
let totalRows = 0
const uniquePairs = new Set()
for (const catName of CAT_ORDER) {
	const rows = allRows.filter((x) => x.category === catName)
	const texts = allText.filter((t) => t.category === catName)
	if (!rows.length && !texts.length) continue
	const pairs = new Set(rows.filter((x) => x.objectPath).map((x) => x.objectPath + ' ' + x.propertyPath))
	for (const p of pairs) uniquePairs.add(p)
	totalRows += rows.length
	md.push(`| ${catName} | ${rows.length} | ${texts.length} | ${pairs.size} |`)
}
md.push(`| **total** | **${totalRows}** | ${allText.length} | ${uniquePairs.size} |`)
md.push('')
md.push(
	'Placing every normal-tier preset once creates one Director subscription per unique pair; presets that share a pair share the subscription (same variable name, same interval).',
)
md.push('')
md.push('## Selection variables (module variables, set in the connection settings or with the Set selection action)')
md.push('')
md.push(
	"Presets cannot ship `$(custom:...)` references: Companion rewrites every `$(label:var)` in an imported preset to the connection label except `$(local:...)` (`Definitions.ts` → `replaceAllVariables`), so a shipped `$(custom:d3_track)` would arrive as `$(<connection>:d3_track)`. References to the module's own variables survive the rewrite, so the presets use the selection variables below. The host parses them before the feedback runs and re-evaluates the feedback when they change, which makes every preset built on a selection re-subscribe when the operator changes it. An unset selection is published as `$NA`, which the module never sends to the Director.",
)
md.push('')
md.push('| selection variable | meaning | rows using it |')
md.push('|---|---|---|')
for (const v of [...usedSel].sort())
	md.push(
		`| \`$(liveupdate:${v})\` | ${esc(SEL_DEFS[v] || '')} | ${allRows.filter((x) => (x.objectPath + ' ' + x.propertyPath).includes('$(liveupdate:' + v + ')')).length} |`,
	)
md.push('')
md.push('## Validation')
md.push('')
if ((catalog.issues || []).length) {
	for (const i of catalog.issues) md.push('- ⚠ ' + esc(i))
} else {
	md.push(
		'- No id collisions, variable/pair conflicts, foreign text references, experimental writes or unknown candidates (checked at merge time).',
	)
}
md.push('')

if (catalog.writeVerification) {
	const wv = catalog.writeVerification
	md.push('## Write verification (Phase 3)')
	md.push('')
	md.push(esc(wv.method))
	md.push('')
	md.push(
		`Date: ${wv.date}. Environment: ${esc(JSON.stringify(wv.environment))}. Evidence: ${wv.files.map((f) => '`' + f + '`').join(', ')}.`,
	)
	md.push('')
	md.push('| run | result |')
	md.push('|---|---|')
	for (const [k, v] of Object.entries(wv.results)) md.push(`| ${k} | ${esc(JSON.stringify(v))} |`)
	md.push('')
	md.push(esc(wv.note))
	md.push('')
	md.push('Writable rows that were NOT exercised:')
	md.push('')
	for (const x of wv.notReached) md.push('- ' + esc(x))
	md.push('')
}

if (catalog.liveVerification) {
	const lv = catalog.liveVerification
	md.push('## Live verification (Phase 3)')
	md.push('')
	md.push(esc(lv.method))
	md.push('')
	md.push(`Environment: ${esc(lv.env)}. Date: ${lv.date}. Evidence: ${lv.files.map((f) => '`' + f + '`').join(', ')}.`)
	md.push('')
	md.push('| live result | normal | experimental |')
	md.push('|---|---|---|')
	for (const [k, v] of Object.entries(lv.summary)) md.push(`| ${k} | ${v.normal ?? 0} | ${v.experimental ?? 0} |`)
	md.push('')
	md.push('Changes applied to the catalog after the live run:')
	md.push('')
	for (const c of lv.changes) md.push('- ' + esc(c))
	md.push('')
	if (lv.removed.length) {
		md.push('Rows removed after the live run:')
		md.push('')
		for (const x of lv.removed)
			md.push(`- \`${x.presetId}\` ${code(x.objectPath)} / ${code(x.propertyPath)}: ${esc(x.reason)}`)
		md.push('')
	}
}

for (const catName of CAT_ORDER) {
	const rows = allRows.filter((x) => x.category === catName)
	const texts = allText.filter((t) => t.category === catName)
	if (!rows.length && !texts.length) continue
	md.push(`## ${catName}`)
	md.push('')
	for (const t of texts) {
		md.push(`> **${esc(t.name)}** (\`${t.presetId}\`, text preset): ${esc(t.text)}`)
		md.push('')
	}
	const groups = catName === '99 Experimental' ? [...new Set(rows.map((x) => x.homeCategory))].sort() : [null]
	for (const g of groups) {
		const grows = g ? rows.filter((x) => x.homeCategory === g) : rows
		if (g) {
			md.push(`### from ${g} (generated heading: "${g.replace(/^\d+ /, '')} (experimental)")`)
			md.push('')
		}
		md.push(
			'| preset id | name | purpose | kind / actions | object path | property path | variable | value type / range | writable | update freq (class → default ms) and rationale | source | status | live (r34.0.3, 2026-09-04) | write |',
		)
		md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
		for (const x of grows) {
			const acts = (x.actions || [])
				.map((a) => `${a.set}: \`${a.actionId}\` ${code(JSON.stringify(a.options))}`)
				.join('<br>')
			const kind =
				esc(x.controlKind) +
				(acts ? '<br>' + acts : '') +
				(x.stateColour ? `<br>colour: ${code(JSON.stringify(x.stateColour))}` : '') +
				(x.fallbackIds?.length ? `<br>fallback: ${x.fallbackIds.map(esc).join(', ')}` : '')
			const freq = `${x.freqClass} → ${FREQ[x.freqClass] ?? '?'} ms; ${esc(x.freqRationale || FREQ_WHY[x.freqClass] || '')}`
			const src =
				(x.sources || []).map(esc).join('<br>') +
				(x.candidateIds?.length ? `<br>candidates: ${x.candidateIds.map(esc).join(', ')}` : '')
			const flag = ((x.corrected || []).length ? ' ✎' : '') + (x.verifierOk === false ? ' ⚠' : '')
			const typ = [x.valueType, x.range].filter(Boolean).map(esc).join('; ')
			const nm = (x.tier === 'experimental' ? '[EXP] ' : '') + x.name
			md.push(
				`| \`${x.presetId}\`${flag} | ${esc(nm)} | ${esc(x.purpose)} | ${kind} | ${code(x.objectPath)} | ${code(x.propertyPath)} | \`${esc(x.variableName)}\` | ${typ} | ${esc(x.writable)} | ${freq} | ${src} | ${esc(x.status)}${x.designerVersion ? ' (' + esc(x.designerVersion) + ')' : ''} | ${liveCell(x)} | ${writeCell(x)} |`,
			)
		}
		md.push('')
		const flagged = grows.filter((x) => x.verifierOk === false || (x.corrected || []).length || x.notes)
		if (flagged.length) {
			md.push('<details><summary>Notes, verifier corrections and flags</summary>')
			md.push('')
			for (const x of flagged)
				md.push(
					`- \`${x.presetId}\`: ${(x.corrected || []).length ? 'corrected ' + x.corrected.join(', ') + '. ' : ''}${(x.verifierProblems || []).map(esc).join(' / ')}${x.notes ? ' ' + esc(x.notes) : ''}`,
				)
			md.push('')
			md.push('</details>')
			md.push('')
		}
		const withText = grows.filter((x) => x.textTemplate)
		if (withText.length) {
			md.push('<details><summary>Button text templates and preview text</summary>')
			md.push('')
			md.push('| preset id | textExpression | text | preview |')
			md.push('|---|---|---|---|')
			for (const x of withText)
				md.push(
					`| \`${x.presetId}\` | ${x.textExpression ? 'yes' : 'no'} | ${code(x.textTemplate)} | ${code(x.previewText)} |`,
				)
			md.push('')
			md.push('</details>')
			md.push('')
		}
	}
}

md.push('## Lead decisions applied at merge')
md.push('')
for (const d of catalog.decisions || []) md.push('- ' + esc(d))
md.push('')
md.push('## Drafter and verifier notes per dimension')
md.push('')
md.push(
	'_The notes and the critique below are the Phase 1 review records, kept as written. They describe the drafts, not the shipped module: gaps they name may have been closed since, for example the transport commands, which the module now sends as its Transport: actions (see the HELP)._',
)
md.push('')
for (const d of catalog.perDim || []) {
	md.push(`### ${d.key}`)
	md.push('')
	md.push('**Drafter summary.** ' + esc(d.summary))
	md.push('')
	md.push('**Verifier summary.** ' + esc(d.verifySummary))
	md.push('')
	if ((d.missingRows || []).length) {
		md.push('**Candidates the verifier thought should be added (lead decision in the merge list above):**')
		md.push('')
		for (const m of d.missingRows) md.push('- ' + esc(m))
		md.push('')
	}
	if ((d.skipped || []).length) {
		md.push('<details><summary>Skipped candidates</summary>')
		md.push('')
		for (const s of d.skipped) md.push(`- \`${esc(s.candidateId)}\`: ${esc(s.reason)}`)
		md.push('')
		md.push('</details>')
		md.push('')
	}
	if ((d.openQuestions || []).length) {
		md.push('**Open questions:**')
		md.push('')
		for (const q of d.openQuestions) md.push('- ' + esc(q))
		md.push('')
	}
}
const c = catalog.critic || {}
md.push('## Cross-category critic (pre-merge)')
md.push('')
md.push(esc(c.summary))
md.push('')
if (c.oscParity?.length) {
	md.push('### OSC parity')
	md.push('')
	md.push('| disguise-osc variable | LiveUpdate preset | tier | note |')
	md.push('|---|---|---|---|')
	for (const o of c.oscParity) {
		const rowX = allRows.find((x) => x.presetId === o.presetId)
		md.push(
			`| \`${esc(o.oscVariable)}\` | \`${esc(o.presetId)}\` | ${rowX ? rowX.tier : esc(o.tier)} | ${esc(String(o.tier).includes('BEATS') ? 'value in beats, the OSC module reports seconds' : '')} |`,
		)
	}
	md.push('')
}
for (const [title, key] of [
	['Variable-name conflicts (pre-merge)', 'variableConflicts'],
	['Missing essentials (pre-merge)', 'missingEssentials'],
	['Rule violations (pre-merge)', 'ruleViolations'],
	['Recommendations', 'recommendations'],
]) {
	if (c[key]?.length) {
		md.push(`### ${title}`)
		md.push('')
		for (const s of c[key]) md.push('- ' + esc(s))
		md.push('')
	}
}
md.push('## Module extensions required by the catalog')
md.push('')
md.push(
	'See [PRESET_CATALOG_RULES.md §11](PRESET_CATALOG_RULES.md). Rows with `stateColour` use the `liveUpdateCompare` feedback; rows of kind `toggle` use the `setToDisguiseToggle` action and list their on/off siblings.',
)
md.push('')
md.push('## Live-test plan (Phase 3 input)')
md.push('')
md.push('| priority | preset id | object path | property path | what the test decides |')
md.push('|---|---|---|---|---|')
for (const p of ['high', 'medium'])
	for (const x of allRows.filter((y) => y.liveTestPriority === p && y.objectPath && !y.objectPath.startsWith('<')))
		md.push(
			`| ${p} | \`${x.presetId}\` | ${code(x.objectPath)} | ${code(x.propertyPath)} | ${esc((x.notes || '').slice(0, 220))} |`,
		)
md.push('')
writeFileSync(outMd, md.join('\n'))
console.log(`wrote ${outMd}: ${allRows.length} rows, ${allText.length} text presets`)
