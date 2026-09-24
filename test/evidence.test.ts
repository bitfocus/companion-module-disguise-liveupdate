/**
 * The published research files (docs/research, docs/INVENTORY.md, docs/PHASE0_CANDIDATES.md). What
 * the live runs recorded must carry no identity of the rig, the show it ran on or the machine the
 * research was done on, must keep Designer's own wording, and must agree with the catalog that cites it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from './harness'

const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8')
const RESEARCH = readdirSync(path.join(ROOT, 'docs/research'))
	.filter((f) => f.endsWith('.json'))
	.map((f) => `docs/research/${f}`)
const PUBLISHED = [...RESEARCH, 'docs/INVENTORY.md', 'docs/PHASE0_CANDIDATES.md']
const EVIDENCE = [
	'docs/research/live-verification.json',
	'docs/research/live-verification-run2.json',
	'docs/research/live-verification-probes.json',
]
const catalog = JSON.parse(read('docs/research/phase1-catalog.json'))

/** Every node of a recorded answer, with the answers the recorder stored as JSON text parsed */
function walk(node: any, visit: (node: any) => void): void {
	if (typeof node === 'string') {
		const text = node.trim()
		let parsed: any
		if (text.startsWith('{') || text.startsWith('[')) {
			try {
				parsed = JSON.parse(text)
			} catch {
				// cut short by the recorder
			}
		}
		if (parsed !== undefined) walk(parsed, visit)
	}
	visit(node)
	if (node && typeof node === 'object') for (const child of Object.values(node)) walk(child, visit)
}

/** All matches of a global regular expression (String.prototype.matchAll is ES2020) */
function allMatches(re: RegExp, text: string): RegExpExecArray[] {
	const found: RegExpExecArray[] = []
	let m: RegExpExecArray | null
	while ((m = re.exec(text))) found.push(m)
	return found
}

test('the research files cite no local path, tool session or workflow run', () => {
	const local =
		/[A-Za-z]:[\\/]+Users[\\/]|AppData[\\/]|scratchpad|Temp[\\/]claude|\bwf_[0-9a-f]{6,}|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/
	for (const file of PUBLISHED) {
		const m = local.exec(read(file))
		assert.equal(m, null, `${file} cites something from the author's machine: ${m?.[0]}`)
	}
})

test('the research files carry only documentation addresses and placeholder uids', () => {
	const documentation = /^(127\.0\.0\.1|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/
	// the getByUID() examples quoted from Designer's own documentation
	const quotedExamples = new Set(['0x123456789012345', '0x123875234'])
	for (const file of PUBLISHED) {
		const text = read(file)
		for (const [address] of allMatches(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, text))
			assert.match(address, documentation, `${file} names the address ${address}`)
		for (const [uid] of allMatches(/\b0x[0-9a-f]{9,}\b/gi, text))
			assert.ok(
				/^0x0123456789abcde[0-9a-f]$/.test(uid) || quotedExamples.has(uid),
				`${file} carries the uid ${uid}, which is not a placeholder`,
			)
	}
})

test('the write runs name no track of the project they ran on', () => {
	const neutral = /^(demo|track \d+|Show Track)$/
	for (const file of [
		'docs/research/live-write-verification.json',
		'docs/research/live-write-verification-output.json',
	]) {
		const run = JSON.parse(read(file))
		for (const track of [...run.tracks, run.currentTrack, run.selections.track])
			assert.match(track, neutral, `${file} names the track ${track}`)
	}
	assert.match(JSON.parse(read('docs/research/live-write-e2e.json')).track, neutral)
})

test("Designer's error texts and type names in the evidence are not redacted", () => {
	let messages = 0
	let references = 0
	for (const file of EVIDENCE)
		walk(JSON.parse(read(file)), (node) => {
			if (!node || typeof node !== 'object' || Array.isArray(node)) return
			if ('errorType' in node) {
				messages++
				assert.ok(!String(node.message).includes('<redacted'), `${file}: a Director error text is redacted`)
			}
			if ('uid' in node && 'path' in node && 'type' in node) {
				references++
				assert.ok(!String(node.type).includes('<redacted'), `${file}: the type of ${node.path} is redacted`)
				assert.match(node.uid, /^0x0123456789abcde[0-9a-f]$/, `${file}: ${node.path} carries a real uid`)
			}
		})
	assert.ok(messages > 0 && references > 0, 'the evidence walk found nothing to check')
})

test('every Director message the catalog quotes from the live runs is recorded in the evidence', () => {
	const lv = catalog.liveVerification
	const cited = [...lv.changes, ...lv.removed.map((r: any) => r.reason)].join('\n')
	// the catalog quotes a Director answer as ("…"), : "…", , "…" or raises "…"
	const quoted = allMatches(/(?:: |\(|, |raises )"([^"]*\s[^"]*)"/g, cited).map((m) => m[1])
	assert.ok(quoted.length >= 4, `only ${quoted.length} quoted Director messages found`)
	const recorded: string[] = []
	for (const file of EVIDENCE)
		walk(JSON.parse(read(file)), (node) => {
			if (typeof node === 'string') recorded.push(node)
		})
	for (const message of quoted)
		assert.ok(
			recorded.some((text) => text.includes(message)),
			`the catalog quotes "${message}", which no evidence file records`,
		)
})

test("the catalog's live values are the evidence values, cut at 80 characters", () => {
	const runs: Record<string, any[]> = {
		sweep: JSON.parse(read('docs/research/live-verification.json')).results,
		sweep2: JSON.parse(read('docs/research/live-verification-run2.json')).results,
	}
	const probes = JSON.parse(read('docs/research/live-verification-probes.json'))
	const cut = (value: any): string => {
		const text = typeof value === 'string' ? value : JSON.stringify(value)
		return text.length > 80 ? text.slice(0, 80) + '…' : text
	}
	let checked = 0
	for (const row of catalog.rows) {
		const live = row.live
		if (!live || live.value === undefined) continue
		let record: any
		if (runs[live.probe]) {
			const own = runs[live.probe].filter((r) => r.presets?.includes(row.presetId))
			record = own.find((r) => r.resolvedPropertyPath === live.propertyPath) ?? own[0]
		} else if (probes[live.probe]) {
			record = probes[live.probe].find((p: any) => p.o === live.objectPath && p.p === live.propertyPath)
		}
		if (!record) continue
		checked++
		assert.equal(live.value, cut(record.value), `${row.presetId}: the catalog and the evidence disagree`)
	}
	assert.ok(checked > 250, `only ${checked} catalog rows were matched to the evidence`)
})
