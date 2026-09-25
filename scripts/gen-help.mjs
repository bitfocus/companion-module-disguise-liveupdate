// Refreshes the generated preset list inside companion/HELP.md from docs/research/phase1-catalog.json.
// The list sits between the markers <!-- PRESETS:START --> and <!-- PRESETS:END -->.
//
// Usage: node scripts/gen-help.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(readFileSync(resolve(root, 'docs/research/phase1-catalog.json'), 'utf8'))
const helpPath = resolve(root, 'companion/HELP.md')
const help = readFileSync(helpPath, 'utf8')

const START = '<!-- PRESETS:START -->'
const END = '<!-- PRESETS:END -->'
const startIndex = help.indexOf(START)
const endIndex = help.indexOf(END)
if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) throw new Error('HELP.md markers not found')

const KIND_LABEL = {
	readout: 'readout',
	nudge: 'nudge (Nudge Disguise Number)',
	setValue: 'set value',
	onOff: 'set on/off',
	toggle: 'toggle',
	jsonSet: 'set JSON',
}

const code = (text) => (text ? '`' + String(text).replace(/\|/g, '\\|') + '`' : '')
const truncate = (text, max) => {
	const t = String(text ?? '')
	if (t.length <= max) return t
	const cut = t.slice(0, max)
	return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trimEnd() + '…'
}

// Text outside code spans: a placeholder such as <name> or <layer uid> would be read as an HTML tag
// (GitHub drops it, Companion's help modal keeps only the tag name), so '<' and its closing '>' are
// written as entities and render literally. A lone '>' (settings > Selections) is plain text already.
const plain = (text) =>
	String(text ?? '')
		.replace(/\r?\n/g, ' ')
		.replace(/\|/g, '\\|')
		.replace(/<([^<>]*)>/g, '&lt;$1&gt;')
		.replace(/</g, '&lt;')
		.trim()

const categories = [...new Set(catalog.rows.map((row) => row.category))].sort()
const lines = []
lines.push('')
lines.push(
	`_${catalog.rows.filter((r) => r.tier === 'normal').length} presets ship by default; ${catalog.rows.filter((r) => r.tier === 'experimental').length} experimental presets appear when "Show experimental presets" is enabled. Object paths use the selection variables described above._`,
)
lines.push('')

for (const category of categories) {
	const rows = catalog.rows.filter((row) => row.category === category)
	lines.push(`### ${category}`)
	lines.push('')
	const setup = catalog.textPresets.find((text) => text.category === category)
	if (setup) {
		lines.push(`> ${plain(setup.text)}`)
		lines.push('')
	}
	lines.push('| Preset | What it does | Object path | Property path | Variable | Kind |')
	lines.push('|---|---|---|---|---|---|')
	for (const row of rows) {
		const name = (row.tier === 'experimental' ? '[EXP] ' : '') + row.name
		lines.push(
			`| ${plain(name)} | ${plain(truncate(row.purpose, 140))} | ${code(row.objectPath)} | ${code(row.propertyPath)} | ${code(row.variableName)} | ${KIND_LABEL[row.controlKind] ?? row.controlKind} |`,
		)
	}
	lines.push('')
}

const updated = help.slice(0, startIndex + START.length) + '\n' + lines.join('\n') + help.slice(endIndex)
writeFileSync(helpPath, updated)
console.log(`updated ${helpPath}: ${catalog.rows.length} presets in ${categories.length} categories`)
