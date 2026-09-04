// Live verification of the catalog against a Designer Director (read-only).
//
// Connects to ws://<host>:<port>/api/session/liveupdate, discovers a few selection values from the
// running project, then subscribes to every unique (object path, property path) pair of the catalog
// whose selections are resolvable, records what the Director answers (confirmation, first value,
// error) and unsubscribes again. No `set` is ever sent by this script.
//
// Usage:
//   node scripts/live-verify.mjs --host 192.0.2.10 [--port 80] [--config scripts/live-verify.config.json]
//        [--tier normal|experimental|all] [--timeout 4000] [--out docs/research/live-verification.json]
//
// The config file may provide selection values ({"selections": {"selTrack": "Track 1", ...}});
// discovered values fill in what is missing.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const host = args.host
if (!host) {
	console.error('usage: node scripts/live-verify.mjs --host <director> [--port 80] [--config file] [--tier all]')
	process.exit(2)
}
const port = Number(args.port ?? 80)
const timeout = Number(args.timeout ?? 4000)
const tier = args.tier ?? 'all'
const outFile = resolve(root, args.out ?? 'docs/research/live-verification.json')
const configFile = resolve(root, args.config ?? 'scripts/live-verify.config.json')
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {}
const selections = { ...(config.selections ?? {}) }

const catalog = JSON.parse(readFileSync(resolve(root, 'docs/research/phase1-catalog.json'), 'utf8'))

function parseArgs(argv) {
	const out = {}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a.startsWith('--')) {
			const key = a.slice(2)
			const next = argv[i + 1]
			if (next === undefined || next.startsWith('--')) out[key] = true
			else {
				out[key] = next
				i++
			}
		}
	}
	return out
}

// ---------- LiveUpdate client ----------
class Client {
	constructor(url) {
		this.url = url
		this.ws = null
		this.subscriptions = []
		this.waiters = []
		this.log = []
	}
	async connect() {
		this.ws = new WebSocket(this.url)
		await new Promise((resolve, reject) => {
			this.ws.once('open', resolve)
			this.ws.once('error', reject)
		})
		this.ws.on('message', (data) => this.onMessage(data.toString()))
	}
	onMessage(text) {
		let msg
		try {
			msg = JSON.parse(text)
		} catch {
			return
		}
		this.log.push(msg)
		if (msg.subscriptions) this.subscriptions = msg.subscriptions
		for (const waiter of [...this.waiters]) {
			if (waiter.test(msg)) {
				this.waiters = this.waiters.filter((w) => w !== waiter)
				waiter.resolve(msg)
			}
		}
	}
	send(msg) {
		this.ws.send(JSON.stringify(msg))
	}
	waitFor(test, ms) {
		return new Promise((resolve) => {
			const waiter = { test, resolve }
			this.waiters.push(waiter)
			setTimeout(() => {
				if (this.waiters.includes(waiter)) {
					this.waiters = this.waiters.filter((w) => w !== waiter)
					resolve(null)
				}
			}, ms)
		})
	}
	/**
	 * Subscribe to one pair, wait for confirmation and the first value, then unsubscribe.
	 * Returns { result, id, value, error }.
	 */
	async probe(objectPath, propertyPath, updateFrequencyMs = 500) {
		const before = new Set(this.subscriptions.map((s) => s.id))
		const errorText = `${objectPath} / ${propertyPath}`
		const outcome = this.waitFor(
			(m) =>
				(m.error && String(m.error).includes(errorText)) ||
				(m.subscriptions &&
					m.subscriptions.some((s) => s.objectPath === objectPath && s.propertyPath === propertyPath)),
			timeout,
		)
		this.send({ subscribe: { object: objectPath, properties: [propertyPath], configuration: { updateFrequencyMs } } })
		const answer = await outcome
		if (!answer) return { result: 'timeout' }
		if (answer.error) return { result: 'error', error: String(answer.error) }
		const sub = answer.subscriptions.find((s) => s.objectPath === objectPath && s.propertyPath === propertyPath)
		const isNew = !before.has(sub.id)
		const valueMsg = await this.waitFor((m) => m.valuesChanged && m.valuesChanged.some((v) => v.id === sub.id), timeout)
		let result = 'confirmed-no-value'
		let value
		if (valueMsg) {
			value = valueMsg.valuesChanged.find((v) => v.id === sub.id).value
			result = value && typeof value === 'object' && value.errorType ? 'confirmed-path-error' : 'confirmed-value'
		}
		if (isNew) {
			const released = this.waitFor((m) => m.subscriptions && !m.subscriptions.some((s) => s.id === sub.id), timeout)
			this.send({ unsubscribe: { id: sub.id } })
			await released
		}
		return { result, id: sub.id, value }
	}
}

const truncate = (v, n = 300) => {
	const text = typeof v === 'string' ? v : JSON.stringify(v)
	return text && text.length > n ? text.slice(0, n) + '…' : text
}

// ---------- discovery ----------
const DISCOVERY = [
	{
		sel: 'selTrack',
		object: 'transportManager:default',
		property: 'object.track.description',
		pick: (v) => (typeof v === 'string' && v ? v : undefined),
	},
	{
		sel: 'selLayer',
		object: (s) => `track:"${s.selTrack}"`,
		property: '[l.name for l in object.layers]',
		pick: (v) => (Array.isArray(v) && v.length ? v[0] : undefined),
		needs: ['selTrack'],
	},
	{
		sel: 'selHost',
		object: 'subsystem:MonitoringManager',
		property: 'object.remoteNodes()',
		pick: (v) => (Array.isArray(v) && v.length ? String(v[0]).replace(/:d3$/, '') : undefined),
	},
	{
		sel: 'selMachine',
		object: 'subsystem:D3NetManagerSystem',
		property: 'object.d3NetManager.localMachine.name',
		pick: (v) => (typeof v === 'string' && v ? v : undefined),
	},
	{
		sel: 'selScreen',
		object: 'subsystem:D3NetManagerSystem',
		property: '[s.description for s in resourceManager.allResources(Screen2)]',
		pick: (v) => (Array.isArray(v) && v.length ? v[0] : undefined),
	},
	{
		sel: 'selProjector',
		object: 'subsystem:D3NetManagerSystem',
		property: '[p.description for p in resourceManager.allResources(Projector)]',
		pick: (v) => (Array.isArray(v) && v.length ? v[0] : undefined),
	},
	{
		sel: 'selEvUid',
		object: 'subsystem:D3NetManagerSystem',
		property: '["0x%x" % d.uid for d in resourceManager.allResources(ExpressionVariablesDevice)]',
		pick: (v) => (Array.isArray(v) && v.length ? v[0] : undefined),
	},
	{
		sel: 'selScreenUid',
		object: (s) => `screen2:"${s.selScreen}"`,
		property: '"0x%x" % object.uid',
		pick: (v) => (typeof v === 'string' ? v : undefined),
		needs: ['selScreen'],
	},
]

function substitute(text, sel) {
	return text.replace(/\$\(liveupdate:(sel[A-Za-z0-9_]+)\)/g, (m, id) =>
		sel[id] !== undefined && sel[id] !== '' ? String(sel[id]) : m,
	)
}

async function main() {
	const client = new Client(`ws://${host}:${port}/api/session/liveupdate`)
	console.log(`connecting to ${client.url}`)
	await client.connect()
	console.log('connected')

	const defaults = {
		selLayerIndex: '0',
		selSection: '0',
		selBeat: '0',
		selInstance: '0',
		selEvIndex: '0',
		selRsLayer: '0',
	}
	for (const [k, v] of Object.entries(defaults)) if (selections[k] === undefined) selections[k] = v

	const discovery = []
	for (const d of DISCOVERY) {
		if (selections[d.sel]) continue
		if (d.needs && d.needs.some((n) => !selections[n])) {
			discovery.push({ selection: d.sel, result: 'skipped (needs ' + d.needs.join(', ') + ')' })
			continue
		}
		const objectPath = typeof d.object === 'function' ? d.object(selections) : d.object
		const r = await client.probe(objectPath, d.property, 200)
		const picked = r.result === 'confirmed-value' ? d.pick(r.value) : undefined
		discovery.push({
			selection: d.sel,
			objectPath,
			propertyPath: d.property,
			result: r.result,
			value: truncate(r.value, 200),
			error: r.error,
			picked,
		})
		if (picked !== undefined) selections[d.sel] = picked
		console.log(
			`discovery ${d.sel}: ${r.result} ${picked !== undefined ? '-> ' + picked : r.error ? r.error.slice(0, 120) : ''}`,
		)
	}
	console.log('selections:', selections)

	// unique pairs
	const pairs = new Map()
	for (const row of catalog.rows) {
		if (!row.objectPath) continue
		if (tier !== 'all' && row.tier !== tier) continue
		if (row.category === '11 Templates') continue
		const key = row.objectPath + '\n' + row.propertyPath
		if (!pairs.has(key))
			pairs.set(key, { objectPath: row.objectPath, propertyPath: row.propertyPath, tier: row.tier, presets: [] })
		pairs.get(key).presets.push(row.presetId)
	}

	const results = []
	let i = 0
	for (const pair of pairs.values()) {
		i++
		const objectPath = substitute(pair.objectPath, selections)
		const propertyPath = substitute(pair.propertyPath, selections)
		const unresolved = /\$\(liveupdate:sel/.test(objectPath + propertyPath)
		const entry = { ...pair, resolvedObjectPath: objectPath, resolvedPropertyPath: propertyPath }
		if (unresolved) {
			entry.result = 'skipped-unset-selection'
			results.push(entry)
			continue
		}
		const r = await client.probe(objectPath, propertyPath, 500)
		entry.result = r.result
		if (r.error) entry.error = r.error
		if (r.value !== undefined) entry.value = truncate(r.value)
		results.push(entry)
		console.log(
			`[${i}/${pairs.size}] ${r.result.padEnd(22)} ${objectPath} / ${propertyPath}${r.error ? '  :: ' + r.error.slice(0, 100) : ''}`,
		)
	}

	const summary = {}
	for (const r of results) summary[r.result] = (summary[r.result] || 0) + 1
	const output = { host, port, date: new Date().toISOString(), selections, discovery, summary, results }
	writeFileSync(outFile, JSON.stringify(output, null, 1))
	console.log('summary', summary)
	console.log('wrote', outFile)
	client.ws.close()
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
