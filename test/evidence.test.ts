/**
 * The published research files (docs/research, docs/INVENTORY.md). What the live runs recorded must
 * carry no identity of the rig, the show it ran on or the machine the research was done on.
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
const PUBLISHED = [...RESEARCH, 'docs/INVENTORY.md']

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
