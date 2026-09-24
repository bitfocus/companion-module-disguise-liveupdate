// Build a self-contained folder to drop into Companion's "Developer modules path".
//
// The folder contains only what Companion needs at runtime: companion/manifest.json,
// companion/HELP.md, dist/ and the production node_modules. Nothing else (no tests, no research
// data, no TypeScript sources) is copied.
//
// Usage:
//   yarn build && node scripts/build-dev-module.mjs [--out <dir>] [--label <name>] [--version <semver>]
//
// The build goes to <out>/companion-module-disguise-liveupdate (--out is relative to the checkout,
// default ../dev-module-build). The manifest of the copy gets the custom label and version (default:
// the version in package.json); the repository keeps its own. The module id and shortname are never
// changed: the id keeps existing connections working and the shortname is the variable prefix every
// preset references ($(liveupdate:...)).
//
// The script only ever deletes its own earlier build: it refuses an --out that is a drive root, the
// home folder, the checkout or a folder that contains the checkout, and an existing output folder
// that does not look like an earlier build (see dev-module-guard.cjs).

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const {
	BUILD_FOLDER,
	buildVersion,
	outRootProblem,
	previousBuildProblem,
	removePreviousBuild,
} = require('./dev-module-guard.cjs')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = {}
for (let i = 2; i < process.argv.length; i++) {
	const a = process.argv[i]
	if (!a.startsWith('--')) continue
	const next = process.argv[i + 1]
	args[a.slice(2)] = next && !next.startsWith('--') ? (i++, next) : true
}

const fail = (message) => {
	console.error(message)
	process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const repoManifest = JSON.parse(readFileSync(join(root, 'companion', 'manifest.json'), 'utf8'))
const label = args.label === undefined || args.label === true ? '' : String(args.label)
const stamped = buildVersion(args.version, pkg.version)
if (stamped.error) fail(stamped.error)
const version = stamped.version
if (args.out === true) fail('--out needs a folder')
const outRoot = resolve(root, String(args.out ?? '../dev-module-build'))
const outDir = join(outRoot, BUILD_FOLDER)

if (!existsSync(join(root, 'dist', 'index.js'))) fail('dist/index.js is missing - run "yarn build" first')

const outProblem = outRootProblem({ root, outRoot, home: homedir() })
if (outProblem) fail(`refusing to build: ${outProblem}. Pick an empty folder outside the checkout.`)
const buildProblem = previousBuildProblem(outDir, repoManifest.id)
if (buildProblem) fail(`refusing to delete ${outDir}: ${buildProblem}. Pick another --out or move that folder.`)

console.log(`building the dev module folder in ${outDir}`)
const locked = removePreviousBuild(outDir)
if (locked) {
	console.log(
		`could not remove the earlier build (${locked}); a running Companion probably has it loaded. ` +
			'Overwriting its files in place instead: files the new build no longer has stay behind until ' +
			'the folder can be deleted.',
	)
}
mkdirSync(outDir, { recursive: true })

for (const entry of ['dist', 'companion', 'LICENSE', 'README.md']) {
	const from = join(root, entry)
	if (!existsSync(from)) continue
	cpSync(from, join(outDir, entry), { recursive: true })
}

// package.json without the dev dependencies and scripts: the copy is not a development checkout
const slim = {
	name: pkg.name,
	version,
	main: pkg.main,
	license: pkg.license,
	repository: pkg.repository,
	engines: pkg.engines,
	dependencies: pkg.dependencies,
}
writeFileSync(join(outDir, 'package.json'), JSON.stringify(slim, null, 2) + '\n')

// manifest: custom version and a visible label, id and shortname untouched
const manifestPath = join(outDir, 'companion', 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.version = version
if (label) {
	if (!manifest.name.includes(label)) manifest.name = `${manifest.name} (${label})`
	manifest.description = `${manifest.description} - ${label} build ${version}, not the Bitfocus store release`
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n')

// production dependencies, from the local cache when possible
console.log('installing the production dependencies')
try {
	execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
		cwd: outDir,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	})
} catch {
	console.log('npm install failed, copying the dependencies from the checkout instead')
	const seen = new Set()
	const copyDep = (name) => {
		if (seen.has(name)) return
		seen.add(name)
		const from = join(root, 'node_modules', name)
		if (!existsSync(from)) return
		cpSync(from, join(outDir, 'node_modules', name), { recursive: true })
		const depPkgPath = join(from, 'package.json')
		if (!existsSync(depPkgPath)) return
		const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf8'))
		for (const dep of Object.keys(depPkg.dependencies ?? {})) copyDep(dep)
	}
	for (const dep of Object.keys(pkg.dependencies ?? {})) copyDep(dep)
}

// the copy must resolve everything dist/index.js requires
const check = execFileSync(
	process.execPath,
	['-e', "require.resolve('@companion-module/base'); require.resolve('ws'); console.log('resolved')"],
	{ cwd: outDir, encoding: 'utf8' },
)
if (!check.includes('resolved')) throw new Error('the production dependencies did not resolve in the copy')

const finalManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
console.log('')
console.log(`done: ${outDir}`)
console.log(`  id        ${finalManifest.id}`)
console.log(`  name      ${finalManifest.name}`)
console.log(`  version   ${finalManifest.version}`)
console.log(`  shortname ${finalManifest.shortname}  (variable prefix, unchanged)`)
console.log('')
console.log('Copy that folder into the Companion "Developer modules path".')
