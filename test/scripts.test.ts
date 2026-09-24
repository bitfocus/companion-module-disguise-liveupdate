/**
 * The safety rules of the developer scripts under scripts/. build-dev-module.mjs is run for real,
 * but only from a fake checkout inside a temporary folder.
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { ROOT } from './harness'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const guard = require(path.join(ROOT, 'scripts/dev-module-guard.cjs'))

const temp = mkdtempSync(path.join(tmpdir(), 'liveupdate-scripts-'))
after(() => rmSync(temp, { recursive: true, force: true }))

let caseNumber = 0
/** A fresh folder for one test case, inside the temporary folder */
function caseDir(): string {
	const dir = path.join(temp, `case${++caseNumber}`)
	mkdirSync(dir, { recursive: true })
	return dir
}

const write = (file: string, text: string): void => {
	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, text)
}

// ---------- build-dev-module.mjs ----------

/**
 * A checkout with uncommitted work, named like a default clone of this repository, holding copies of
 * build-dev-module.mjs and its guard. The package.json version is deliberately not 1.0.0.
 */
function fakeCheckout(parent: string): string {
	const dir = path.join(parent, guard.BUILD_FOLDER)
	write(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
	write(path.join(dir, 'src', 'wip.ts'), '// uncommitted work\n')
	write(path.join(dir, 'dist', 'index.js'), '')
	write(
		path.join(dir, 'companion', 'manifest.json'),
		JSON.stringify({ id: 'disguise-liveupdate', name: 'disguise: LiveUpdate', description: 'test', version: '9.8.7' }),
	)
	write(
		path.join(dir, 'package.json'),
		JSON.stringify({ name: '@companion-module/liveupdate', version: '9.8.7', main: 'dist/index.js', dependencies: {} }),
	)
	for (const file of ['build-dev-module.mjs', 'dev-module-guard.cjs']) {
		mkdirSync(path.join(dir, 'scripts'), { recursive: true })
		copyFileSync(path.join(ROOT, 'scripts', file), path.join(dir, 'scripts', file))
	}
	return dir
}

/**
 * Run the copied script from the folder that holds the checkout: Windows refuses to delete the working
 * directory of a process, which would hide the deletion. npm stays offline so no registry is reached.
 */
function runBuild(checkout: string, args: string[]): { status: number | null; output: string } {
	const run = spawnSync(process.execPath, [path.join(checkout, 'scripts', 'build-dev-module.mjs'), ...args], {
		cwd: path.dirname(checkout),
		encoding: 'utf8',
		env: { ...process.env, npm_config_offline: 'true' },
		timeout: 120000,
	})
	return { status: run.status, output: `${run.stdout}\n${run.stderr}` }
}

test('build-dev-module refuses an --out that holds the checkout and leaves the checkout alone', () => {
	const checkout = fakeCheckout(caseDir())
	// the folder that holds a default clone: <out>/companion-module-disguise-liveupdate IS the checkout
	const run = runBuild(checkout, ['--out', '..'])
	assert.equal(run.status, 1, run.output)
	assert.match(run.output, /is the checkout or contains it/)
	assert.ok(existsSync(path.join(checkout, '.git', 'HEAD')), 'the .git folder was deleted')
	assert.ok(existsSync(path.join(checkout, 'src', 'wip.ts')), 'uncommitted work was deleted')

	// the checkout itself as --out is refused too
	assert.equal(runBuild(checkout, ['--out', '.']).status, 1)
	assert.ok(existsSync(path.join(checkout, 'src', 'wip.ts')))
})

test('build-dev-module never deletes an output folder that is not one of its own builds', () => {
	const dir = caseDir()
	const checkout = fakeCheckout(path.join(dir, 'repo'))
	// a Developer modules path that already holds another clone of this repository
	const devModules = path.join(dir, 'devmodules')
	const clone = fakeCheckout(devModules)
	let run = runBuild(checkout, ['--out', devModules])
	assert.equal(run.status, 1, run.output)
	assert.match(run.output, /has a \.git folder/)
	assert.ok(existsSync(path.join(clone, '.git', 'HEAD')))

	// a folder of the same name without .git or a manifest of this module
	const other = path.join(dir, 'other')
	write(path.join(other, guard.BUILD_FOLDER, 'notes.txt'), 'keep me\n')
	run = runBuild(checkout, ['--out', other])
	assert.equal(run.status, 1, run.output)
	assert.ok(existsSync(path.join(other, guard.BUILD_FOLDER, 'notes.txt')))
})

test('build-dev-module stamps the package.json version, refuses a bare --version and replaces its own build', () => {
	const dir = caseDir()
	const checkout = fakeCheckout(path.join(dir, 'repo'))
	const out = path.join(dir, 'build')
	const built = path.join(out, guard.BUILD_FOLDER)

	const bare = runBuild(checkout, ['--out', out, '--version'])
	assert.equal(bare.status, 1, bare.output)
	assert.match(bare.output, /--version needs a semver value/)
	assert.ok(!existsSync(built), 'a refused run must not create the output folder')

	// an earlier build of this script, with a file the new build does not have
	write(path.join(built, 'companion', 'manifest.json'), JSON.stringify({ id: 'disguise-liveupdate', version: '0.0.1' }))
	write(path.join(built, 'stale.txt'), 'from an earlier build\n')
	// the copy must resolve these two; stubs one level up stand in for the production dependencies
	for (const name of ['@companion-module/base', 'ws']) {
		write(path.join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
		write(path.join(dir, 'node_modules', name, 'index.js'), 'module.exports = {}\n')
	}
	const run = runBuild(checkout, ['--out', out])
	assert.equal(run.status, 0, run.output)
	assert.ok(!existsSync(path.join(built, 'stale.txt')), 'the earlier build was not replaced')
	assert.equal(JSON.parse(readFileSync(path.join(built, 'companion', 'manifest.json'), 'utf8')).version, '9.8.7')
	assert.equal(JSON.parse(readFileSync(path.join(built, 'package.json'), 'utf8')).version, '9.8.7')
	assert.ok(existsSync(path.join(checkout, 'src', 'wip.ts')))
})

test('the dev module guard refuses drive roots, the home folder and its parents, and the checkout', () => {
	const dir = caseDir()
	const root = path.join(dir, 'repo')
	mkdirSync(root)
	const home = homedir()
	const problem = (outRoot: string): string | null => guard.outRootProblem({ root, outRoot, home })
	assert.match(problem(path.parse(dir).root) ?? '', /root of a drive/)
	assert.match(problem(home) ?? '', /home folder/)
	assert.ok(problem(path.dirname(home)), 'a parent of the home folder')
	assert.match(problem(root) ?? '', /checkout/)
	assert.match(problem(dir) ?? '', /checkout/)
	assert.equal(problem(path.join(dir, 'build')), null)
	assert.equal(problem(path.join(root, 'build')), null, 'a folder inside the checkout holds nothing but the build')
	if (process.platform === 'win32') assert.match(problem(dir.toUpperCase()) ?? '', /checkout/, 'case must not matter')
})

test('the dev module guard only accepts an absent, empty or earlier build folder', () => {
	const dir = caseDir()
	const id = 'disguise-liveupdate'
	const folder = (name: string): string => path.join(dir, name, guard.BUILD_FOLDER)
	assert.equal(guard.previousBuildProblem(folder('absent'), id), null)
	mkdirSync(folder('empty'), { recursive: true })
	assert.equal(guard.previousBuildProblem(folder('empty'), id), null)
	write(path.join(folder('build'), 'companion', 'manifest.json'), JSON.stringify({ id }))
	write(path.join(folder('build'), 'dist', 'index.js'), '')
	assert.equal(guard.previousBuildProblem(folder('build'), id), null)

	write(path.join(folder('clone'), 'companion', 'manifest.json'), JSON.stringify({ id }))
	write(path.join(folder('clone'), '.git', 'HEAD'), '')
	assert.match(guard.previousBuildProblem(folder('clone'), id), /\.git/)
	write(path.join(folder('zip'), 'companion', 'manifest.json'), JSON.stringify({ id }))
	write(path.join(folder('zip'), 'src', 'index.ts'), '')
	assert.match(guard.previousBuildProblem(folder('zip'), id), /src/)
	write(path.join(folder('foreign'), 'companion', 'manifest.json'), JSON.stringify({ id: 'someone-else' }))
	assert.match(guard.previousBuildProblem(folder('foreign'), id), /someone-else/)
	write(path.join(folder('unknown'), 'readme.txt'), '')
	assert.match(guard.previousBuildProblem(folder('unknown'), id), /manifest/)
})

test('a locked earlier build is reported for an in-place overwrite, other errors still throw', () => {
	const busy = (): never => {
		throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
	}
	assert.equal(guard.removePreviousBuild('ignored', busy), 'EBUSY')
	const broken = (): never => {
		throw Object.assign(new Error('bad path'), { code: 'EINVAL' })
	}
	assert.throws(() => guard.removePreviousBuild('ignored', broken), /bad path/)
	const dir = path.join(caseDir(), 'old')
	write(path.join(dir, 'a.txt'), '')
	assert.equal(guard.removePreviousBuild(dir), null)
	assert.ok(!existsSync(dir))
})

test('the dev build version defaults to package.json and must be semver', () => {
	assert.deepEqual(guard.buildVersion(undefined, '1.1.0'), { version: '1.1.0' })
	assert.deepEqual(guard.buildVersion('1.1.0-inhouse.1', '1.1.0'), { version: '1.1.0-inhouse.1' })
	assert.ok(guard.buildVersion(true, '1.1.0').error)
	assert.ok(guard.buildVersion('latest', '1.1.0').error)
	assert.ok(guard.buildVersion('1.1', '1.1.0').error)
})
