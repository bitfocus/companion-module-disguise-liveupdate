/**
 * Every command action against the Director's own description of its request bodies.
 *
 * docs/research/rest-api.json holds the body of each POST command as the Director's OpenAPI document
 * (d3 API 2.0.3, /docs/session/d3api.swagger.json) describes it. This test presses every REST action
 * once, catches the request on a local server and checks the body against that description: no field
 * the Director does not know, every field of the right type, enum values from the list, and every
 * object reference carrying a uid or a name. It is the offline guard for the mistake a live run found
 * only by accident, a body built for one command sent to another.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { installHarness, loadDist, ROOT } from './harness'

installHarness({ fakeSocket: true })
const dist = loadDist()
/* eslint-disable @typescript-eslint/no-require-imports */
const rest = require(path.join(ROOT, 'dist/rest.js')) as { REST_ENDPOINTS: Record<string, { path: string }> }
/* eslint-enable @typescript-eslint/no-require-imports */

type Schema =
	| { kind: 'object'; fields: Record<string, Schema> }
	| { kind: 'array'; item: Schema }
	| { kind: 'string'; values?: string[] }
	| { kind: 'number' }
	| { kind: 'integer' }
	| { kind: 'boolean' }
	| { kind: 'none' }
	| { kind: 'free' }

/** Parse the compact body notation of rest-api.json: {a:string, b:[{c:integer}], d:string ["X","Y"]} */
function parseSchema(text: string): Schema {
	if (text.trim() === 'none') return { kind: 'none' }
	let i = 0
	const ws = (): void => {
		while (/\s/.test(text[i] ?? '')) i++
	}
	const expect = (c: string): void => {
		ws()
		if (text[i] !== c) throw new Error(`expected '${c}' at ${i} in ${text}`)
		i++
	}
	const value = (): Schema => {
		ws()
		if (text[i] === '{') {
			i++
			const fields: Record<string, Schema> = {}
			ws()
			while (text[i] !== '}') {
				const start = i
				while (/[A-Za-z0-9_]/.test(text[i] ?? '')) i++
				const key = text.slice(start, i)
				expect(':')
				fields[key] = value()
				ws()
				if (text[i] === ',') i++
				ws()
			}
			i++
			return { kind: 'object', fields }
		}
		if (text[i] === '[') {
			i++
			const item = value()
			expect(']')
			return { kind: 'array', item }
		}
		const start = i
		while (/[a-z]/.test(text[i] ?? '')) i++
		const name = text.slice(start, i)
		if (name === 'string') {
			// an enum follows as ["A","B"]
			const save = i
			ws()
			if (
				text[i] === '[' &&
				text
					.slice(i + 1)
					.trimStart()
					.startsWith('"')
			) {
				const end = text.indexOf(']', i)
				const values = JSON.parse(text.slice(i, end + 1)) as string[]
				i = end + 1
				return { kind: 'string', values }
			}
			i = save
			return { kind: 'string' }
		}
		if (name === 'number' || name === 'integer' || name === 'boolean') return { kind: name }
		// a free-form object (the OmniCal commands); no command of this module uses one
		if (name === 'object') return { kind: 'free' }
		throw new Error(`unknown type '${name}' at ${start} in ${text}`)
	}
	const schema = value()
	ws()
	if (i !== text.length) throw new Error(`trailing text at ${i} in ${text}`)
	return schema
}

/** Every way the body departs from the schema, as readable paths */
function validate(body: unknown, schema: Schema, where = 'body'): string[] {
	switch (schema.kind) {
		case 'none':
			return body === undefined || body === null || (typeof body === 'object' && Object.keys(body).length === 0)
				? []
				: [`${where}: the command takes no body`]
		case 'object': {
			if (typeof body !== 'object' || body === null || Array.isArray(body)) return [`${where}: not an object`]
			const problems: string[] = []
			for (const [key, v] of Object.entries(body)) {
				const field = schema.fields[key]
				if (!field) problems.push(`${where}.${key}: the Director has no such field`)
				else problems.push(...validate(v, field, `${where}.${key}`))
			}
			// an object reference is found by uid or by name, so it needs one of them
			const keys = Object.keys(schema.fields).sort().join(',')
			if (keys === 'name,uid') {
				const ref = body as { uid?: unknown; name?: unknown }
				if (!ref.uid && !ref.name) problems.push(`${where}: an object reference with neither uid nor name`)
			}
			return problems
		}
		case 'array':
			if (!Array.isArray(body)) return [`${where}: not an array`]
			if (body.length === 0) return [`${where}: empty`]
			return body.flatMap((item, n) => validate(item, schema.item, `${where}[${n}]`))
		case 'string':
			if (typeof body !== 'string') return [`${where}: not a string`]
			if (schema.values && !schema.values.includes(body)) return [`${where}: '${body}' is not one of the values`]
			return []
		case 'number':
			return typeof body === 'number' && Number.isFinite(body) ? [] : [`${where}: not a number`]
		case 'integer':
			return Number.isInteger(body) ? [] : [`${where}: not an integer`]
		case 'boolean':
			return typeof body === 'boolean' ? [] : [`${where}: not a boolean`]
		case 'free':
			return typeof body === 'object' && body !== null ? [] : [`${where}: not an object`]
	}
}

const spec = JSON.parse(readFileSync(path.join(ROOT, 'docs/research/rest-api.json'), 'utf8')) as {
	commands: { path: string; body: string }[]
}
const bodies = new Map(spec.commands.map((c) => [c.path, parseSchema(c.body)]))

/** Values for every text option a command action has; the rest keep their defaults */
const SAMPLES: Record<string, string> = {
	transport: 'default',
	track: 'Track 1',
	section: '2',
	note: 'Intro',
	value: '12',
	timecode: '00:00:10:00',
	time: '10',
	brightness: '0.5',
	volume: '0.5',
	speed: '1',
	layers: 'Layer A, uid:1234567',
	machine: 'ACTOR01',
}

const received: { path: string; body: unknown }[] = []
let server: Server
let port = 0

before(async () => {
	server = createServer((req, res) => {
		const chunks: Buffer[] = []
		req.on('data', (c: Buffer) => chunks.push(c))
		req.on('end', () => {
			const text = Buffer.concat(chunks).toString('utf8')
			received.push({ path: req.url ?? '', body: text ? JSON.parse(text) : undefined })
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ status: { code: 0, message: '', details: [] } }))
		})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	port = (server.address() as AddressInfo).port
})

after(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('the body notation of rest-api.json parses for every command', () => {
	assert.ok(bodies.size > 40, `${bodies.size} commands`)
	for (const endpoint of Object.values(rest.REST_ENDPOINTS))
		assert.ok(bodies.has(endpoint.path), `rest-api.json describes ${endpoint.path}`)
})

test('the validator rejects the mistakes it is there to catch', () => {
	const step = bodies.get('/transport/gotonextsection')!
	// the play/stop body sent to a step command: the reference sits one level too high
	assert.notDeepEqual(validate({ transports: [{ name: 'default' }] }, step), [])
	assert.deepEqual(validate({ transports: [{ transport: { name: 'default' }, playmode: 'NotSet' }] }, step), [])
	assert.notDeepEqual(validate({ transports: [{ transport: { name: 'default' }, playmode: 'Paused' }] }, step), [])
	assert.notDeepEqual(validate({ transports: [{ transport: {}, playmode: 'Play' }] }, step), [])
	const brightness = bodies.get('/transport/brightness')!
	assert.notDeepEqual(validate({ transports: [{ transport: { name: 'default' }, brightness: '0.5' }] }, brightness), [])
})

for (const uidTarget of [false, true]) {
	test(`every command action sends a body the Director describes (${uidTarget ? 'uid' : 'name'} references)`, async () => {
		const inst = new dist.DisguiseInstance()
		await inst.init({
			host: '127.0.0.1',
			port,
			reconnectInterval: 1000,
			pendingSubscriptionTimeout: 5000,
			restAllowDestructive: true,
		})
		// a failed assertion must not leave the instance (and its timers) keeping the run alive
		try {
			const actions = dist.getActionDefinitions(inst)
			const context = { parseVariablesInString: async (text: string) => text }
			const seen = new Set<string>()

			for (const [actionId, definition] of Object.entries(actions)) {
				if (!actionId.startsWith('rest') || actionId === 'restRescan') continue
				const options: Record<string, unknown> = {}
				for (const option of definition.options as { id: string; type: string; default?: unknown }[]) {
					options[option.id] = SAMPLES[option.id] ?? option.default
					if (uidTarget && ['transport', 'track', 'machine'].includes(option.id)) options[option.id] = 'uid:1234567'
				}
				received.length = 0
				// a destructive command fires on the second press of the same button
				for (let press = 0; press < 2 && received.length === 0; press++) {
					await definition.callback({ actionId, options, controlId: `ctl_${actionId}` }, context)
				}
				assert.equal(received.length, 1, `${actionId} sent exactly one request`)
				const sent = received[0]
				const commandPath = sent.path.replace(/^\/api\/session/, '')
				const schema = bodies.get(commandPath)
				assert.ok(schema, `${actionId} posts ${commandPath}, which the Director describes`)
				assert.deepEqual(validate(sent.body, schema), [], `${actionId} -> ${commandPath} ${JSON.stringify(sent.body)}`)
				seen.add(commandPath)
			}

			const offered = new Set(Object.values(rest.REST_ENDPOINTS).map((e) => e.path))
			for (const p of offered) assert.ok(seen.has(p), `an action sends ${p}`)
		} finally {
			await inst.destroy()
		}
	})
}
