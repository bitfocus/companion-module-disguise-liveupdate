// Read-only discovery of Designer's Session REST API.
//
// The Director serves its own OpenAPI document; this script fetches it and prints every command the
// module could send, so the endpoint table in src/rest.ts can be checked against a real build
// instead of being taken on trust. Every request is a GET: nothing here changes the session.
//
// Usage:
//   node scripts/rest-discover.mjs --host 192.0.2.10 [--port 80] [--out docs/research/rest-api.json]

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = {}
for (let i = 2; i < process.argv.length; i++) {
	const a = process.argv[i]
	if (!a.startsWith('--')) continue
	const next = process.argv[i + 1]
	args[a.slice(2)] = next && !next.startsWith('--') ? (i++, next) : true
}
if (!args.host) {
	console.error('usage: node scripts/rest-discover.mjs --host <director> [--port 80] [--out <file>]')
	process.exit(2)
}
const base = `http://${args.host}:${args.port ?? 80}`

async function get(path) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), 5000)
	try {
		const response = await fetch(base + path, { method: 'GET', signal: controller.signal })
		const type = (response.headers.get('content-type') ?? '').split(';')[0]
		const text = await response.text()
		return { status: response.status, type, text }
	} catch (error) {
		return { status: 0, type: '', text: String(error.message ?? error) }
	} finally {
		clearTimeout(timer)
	}
}

// The Swagger UI page names the document; this is where every Director tested so far serves it.
const SPEC_PATHS = ['/docs/session/d3api.swagger.json', '/docs/d3api.swagger.json', '/specs/session.swagger.json']

let spec = null
let specPath = ''
for (const path of SPEC_PATHS) {
	const answer = await get(path)
	console.log(`${String(answer.status).padEnd(3)} ${path}`)
	if (answer.status === 200 && answer.type.includes('json')) {
		try {
			spec = JSON.parse(answer.text)
			specPath = path
			break
		} catch {
			/* not the document */
		}
	}
}

if (!spec) {
	console.error('no OpenAPI document found; the module keeps the endpoint table in src/rest.ts as it is')
	process.exit(1)
}

console.log(`\n${spec.info?.title ?? 'API'} ${spec.info?.version ?? ''} from ${specPath}`)
const resolveRef = (schema, depth = 0) => {
	if (!schema || depth > 6) return schema
	if (schema.$ref) return resolveRef(spec.definitions?.[schema.$ref.split('/').pop()], depth + 1)
	return schema
}
const describe = (schema, depth = 0) => {
	const node = resolveRef(schema, depth)
	if (!node || depth > 6) return '?'
	if (node.type === 'array') return `[${describe(node.items, depth + 1)}]`
	if (node.properties)
		return `{${Object.entries(node.properties)
			.map(([key, value]) => `${key}:${describe(value, depth + 1)}`)
			.join(', ')}}`
	return (node.type ?? 'obj') + (node.enum ? ` ${JSON.stringify(node.enum)}` : '')
}

const commands = []
for (const [path, operations] of Object.entries(spec.paths ?? {})) {
	for (const [method, operation] of Object.entries(operations)) {
		if (method !== 'post') continue
		const body = (operation.parameters ?? []).find((parameter) => parameter.in === 'body')
		commands.push({ path, summary: operation.summary ?? '', body: body ? describe(body.schema) : 'none' })
	}
}
commands.sort((a, b) => a.path.localeCompare(b.path))
console.log(`\n${commands.length} POST commands:`)
for (const command of commands) {
	console.log(`  POST /api/session${command.path}  ${command.summary}`)
	console.log(`      ${command.body}`)
}

const outFile = resolve(root, args.out ?? 'docs/research/rest-api.json')
writeFileSync(
	outFile,
	JSON.stringify(
		{ host: args.host, specPath, title: spec.info?.title, version: spec.info?.version, commands },
		null,
		1,
	),
)
console.log(`\nwrote ${outFile}`)
