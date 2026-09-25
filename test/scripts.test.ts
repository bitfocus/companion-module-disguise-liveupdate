/**
 * The safety rules of the developer scripts under scripts/. The scripts that talk to a Director are
 * never run here: their guards live in scripts/live-safety.cjs and are checked on their own, and a
 * WebSocket close is exercised against a server on 127.0.0.1. build-dev-module.mjs is run for real,
 * but only from a fake checkout inside a temporary folder.
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import { ROOT } from './harness'

/* eslint-disable @typescript-eslint/no-require-imports */
const guard = require(path.join(ROOT, 'scripts/dev-module-guard.cjs'))
const safety = require(path.join(ROOT, 'scripts/live-safety.cjs'))
/* eslint-enable @typescript-eslint/no-require-imports */

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

// ---------- raw output of the live scripts ----------

test('the live scripts write their raw output to the git-ignored .live folder by default', () => {
	assert.equal(safety.liveOutFile(ROOT, undefined, 'x.json'), path.join(ROOT, '.live', 'x.json'))
	assert.equal(safety.liveOutFile(ROOT, true, 'x.json'), path.join(ROOT, '.live', 'x.json'))
	assert.equal(
		safety.liveOutFile(ROOT, 'docs/research/x.json', 'x.json'),
		path.join(ROOT, 'docs', 'research', 'x.json'),
	)

	const ignored = readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/)
	assert.ok(ignored.includes('.live/'), '.live/ is not in .gitignore')
	assert.ok(ignored.includes('scripts/live-verify.config.json'))

	for (const script of ['live-verify.mjs', 'live-write-verify.mjs', 'rest-command-verify.mjs', 'rest-discover.mjs']) {
		const source = readFileSync(path.join(ROOT, 'scripts', script), 'utf8')
		assert.ok(!/args\.out \?\?/.test(source), `${script} still has its own default output path`)
		assert.match(source, /liveOutFile\(root, args\.out, '[a-z-]+\.json'\)/, `${script} does not use liveOutFile`)
		assert.match(source, /siteDataReminder\(root, outFile\)/, `${script} does not print the site data reminder`)
	}
})

test('the live-write e2e writes to .live by default and prints the site data reminder', () => {
	const source = readFileSync(path.join(ROOT, 'test', 'live-write.e2e.ts'), 'utf8')
	assert.ok(!/'docs', 'research'/.test(source), 'the e2e still writes over the scrubbed evidence by default')
	assert.match(source, /liveOutFile\(ROOT, arg\('out'\), 'live-write-e2e\.json'\)/)
	// the reminder follows the last save, which the finally block makes on every way out that saved
	const last = source.lastIndexOf('save()')
	assert.ok(last > source.lastIndexOf('} finally {'), 'the last save is not in the finally block')
	assert.match(source.slice(last), /siteDataReminder\(ROOT, outFile\)/)
})

test('the live-write e2e refuses its writes on the current track or a transport that may be playing', () => {
	const source = readFileSync(path.join(ROOT, 'test', 'live-write.e2e.ts'), 'utf8')
	// the layer step is a neutral write, the brightness and offset steps are output writes
	const guard = source.indexOf('writeRefusal({ neutral: true, output: true, track, currentTrack, playing, force })')
	assert.ok(guard >= 0, 'the e2e does not apply the write guard to both groups')
	assert.ok(guard < source.indexOf('.callback('), 'the write guard must run before the first write')
	assert.match(source, /process\.exitCode = 2/)
	assert.match(source, /handRestoreLine\(items\)/)
	assert.match(source, /readoutValue\(vars\.get\('currentTrack'\), dist\.SENTINELS\)/)
	assert.match(source, /readoutValue\(vars\.get\('playing'\), dist\.SENTINELS\)/)

	// the module's readouts hold '' or a marker until the Director answers: neither is a track or a play state
	const sentinels = ['PENDING', 'OFFLINE', 'ERROR', 'UNSET']
	for (const unknown of ['', 'PENDING', 'OFFLINE']) {
		assert.equal(safety.readoutValue(unknown, sentinels), undefined)
		const refusal = safety.writeRefusal({
			neutral: true,
			output: true,
			track: 'demo',
			currentTrack: safety.readoutValue(unknown, sentinels),
			playing: safety.readoutValue(unknown, sentinels),
			force: false,
		})
		assert.match(refusal ?? '', /could not be read/)
	}
	assert.equal(safety.readoutValue('Show Track', sentinels), 'Show Track')
	assert.equal(safety.readoutValue(false, sentinels), false)
	assert.equal(
		safety.writeRefusal({
			neutral: true,
			output: true,
			track: 'demo',
			currentTrack: 'Show Track',
			playing: false,
			force: false,
		}),
		null,
	)
})

test('the site data reminder warns louder for a file inside the checkout', () => {
	const tracked = safety.siteDataReminder(ROOT, path.join(ROOT, 'docs', 'research', 'x.json'))
	assert.equal(tracked.length, 2)
	assert.match(tracked[0], /site data/)
	assert.match(tracked[1], /not ignored by git/)
	assert.equal(safety.siteDataReminder(ROOT, path.join(ROOT, '.live', 'x.json')).length, 1)
	assert.equal(safety.siteDataReminder(ROOT, path.join(temp, 'x.json')).length, 1)
})

// ---------- live-write-verify ----------

test('live-write-verify refuses the neutral group on the current track or an unknown one', () => {
	const refuse = (o: Record<string, unknown>): string | null =>
		safety.writeRefusal({ neutral: true, output: false, force: false, ...o })
	// a single-track project: the only track is the current one
	assert.match(refuse({ track: 'Track 1', currentTrack: 'Track 1' }) ?? '', /current track/)
	// the current-track read timed out or failed
	assert.match(refuse({ track: 'Track 1', currentTrack: undefined }) ?? '', /could not be read/)
	assert.equal(refuse({ track: 'Track 2', currentTrack: 'Track 1' }), null)
	assert.equal(refuse({ track: undefined, currentTrack: undefined }), null, 'no track means no neutral target')
	assert.equal(refuse({ track: 'Track 1', currentTrack: 'Track 1', force: true }), null)
})

test('live-write-verify refuses the output group unless the transport is known to be stopped', () => {
	const refuse = (playing: unknown, force = false): string | null =>
		safety.writeRefusal({ neutral: false, output: true, playing, force })
	assert.match(refuse(true) ?? '', /is playing/)
	assert.match(refuse(undefined) ?? '', /could not be read/)
	assert.match(refuse('evaluation error') ?? '', /could not be read/)
	assert.equal(refuse(false), null)
	assert.equal(refuse(true, true), null)
})

test('a final read-back that cannot read the value is not confirmed', () => {
	assert.equal(safety.unverifiedLabel({ id: 7, value: 0.5 }), null)
	assert.equal(safety.unverifiedLabel({ id: 7, value: false }), null)
	assert.equal(
		safety.unverifiedLabel({ error: 'timeout waiting for the subscription answer' }),
		'UNVERIFIED: timeout waiting for the subscription answer',
	)
	assert.equal(
		safety.unverifiedLabel({ id: 7, error: 'no value within the timeout' }),
		'UNVERIFIED: no value within the timeout',
	)

	const results = [
		{ object: 'a', property: 'p', result: 'write-accepted-and-restored', finalCheck: 'original value confirmed' },
		{ object: 'b', property: 'p', result: 'write-accepted-and-restored', finalCheck: 'UNVERIFIED: timeout' },
		{ object: 'c', property: 'p', result: 'write-accepted-and-restored', finalCheck: 'DIFFERS: undefined' },
		{
			object: 'd',
			property: 'p',
			result: 'RESTORE FAILED',
			finalCheck: 'original value restored on the second attempt',
		},
		{ object: 'e', property: 'p', result: 'RESTORE FAILED', finalCheck: 'STILL DIFFERS: 0.55' },
		{ object: 'f', property: 'p', result: 'skipped: could not read the current value' },
	]
	const { notRestored, unconfirmed, byHand } = safety.unsettled(results)
	assert.deepEqual(
		notRestored.map((e: any) => e.object),
		['d', 'e'],
	)
	assert.deepEqual(
		unconfirmed.map((e: any) => e.object),
		['b', 'c'],
	)
	assert.deepEqual(byHand.map((e: any) => e.object).sort(), ['b', 'c', 'e'])
	assert.equal(safety.unsettled(results.slice(0, 1)).unconfirmed.length, 0)
})

test('a WebSocket closed by the Director is reported, a close by the script is not', async () => {
	const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
	await new Promise<void>((resolve) => server.once('listening', resolve))
	const { port } = server.address() as { port: number }
	server.on('connection', (socket, request) => {
		if (request.url === '/drop') socket.terminate()
	})
	const connect = async (url: string): Promise<WebSocket> => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${url}`)
		await new Promise((resolve, reject) => {
			ws.once('open', resolve)
			ws.once('error', reject)
		})
		return ws
	}
	const closed = async (ws: WebSocket): Promise<void> =>
		new Promise((resolve) => (ws.readyState === WebSocket.CLOSED ? resolve() : ws.once('close', () => resolve())))
	try {
		const reasons: string[] = []
		const dropped = await connect('/drop')
		safety.watchClose(dropped, (reason: string) => reasons.push(reason))
		await closed(dropped)
		assert.equal(reasons.length, 1)
		assert.match(reasons[0], /closed the connection/)

		const own: string[] = []
		const kept = await connect('/keep')
		const close = safety.watchClose(kept, (reason: string) => own.push(reason))
		close()
		await closed(kept)
		assert.deepEqual(own, [])
	} finally {
		await new Promise((resolve) => server.close(resolve))
	}
})

test('live-write-verify reports a dropped connection and closes only through the watched close', () => {
	const source = readFileSync(path.join(ROOT, 'scripts', 'live-write-verify.mjs'), 'utf8')
	assert.match(source, /watchClose\(this\.ws/)
	assert.match(source, /client\.onUnexpectedClose = \(reason\) => void emergencyRestore\(reason\)/)
	assert.ok(!source.includes('client.ws.close()'), 'a raw close would be reported as an interruption')
	assert.match(source, /writeRefusal\(/)
	assert.match(source, /unverifiedLabel\(check\)/)
	assert.ok(!source.includes("startsWith('STILL DIFFERS')"), 'the verdict still counts only STILL DIFFERS')
})

test('live-write-verify prints the site data reminder on every way out that wrote the results file', () => {
	const source = readFileSync(path.join(ROOT, 'scripts', 'live-write-verify.mjs'), 'utf8')
	const lineOf = (offset: number): number => source.slice(0, offset).split('\n').length
	// the ways out: the emergency restore, a refusal and the normal end (usage errors write nothing)
	let checked = 0
	let previous = 0
	for (const exit of [...source.matchAll(/client\.close\(\)|process\.exit\(/g)].map((m) => m.index)) {
		const save = source.lastIndexOf('saveResults(', exit)
		if (save >= previous) {
			assert.ok(
				source.slice(save, exit).includes('siteDataReminder(root, outFile)'),
				`line ${lineOf(exit)} leaves after writing the results without the site data reminder`,
			)
			checked++
		}
		previous = exit
	}
	assert.ok(checked >= 3, `only ${checked} way(s) out were checked`)
	const refusal = source.indexOf('saveResults({ refused: refusal })')
	assert.ok(refusal >= 0)
	assert.match(source.slice(refusal, source.indexOf('client.close()', refusal)), /siteDataReminder\(root, outFile\)/)
})

// ---------- rest-command-verify ----------

test('rest-command-verify refuses to run while the transport is not stopped', () => {
	assert.equal(safety.playmodeRefusal('Stop', false), null)
	assert.match(safety.playmodeRefusal('Play', false) ?? '', /is Play/)
	assert.match(safety.playmodeRefusal('Loop', false) ?? '', /--force/)
	assert.match(safety.playmodeRefusal(undefined, false) ?? '', /could not be read/)
	assert.equal(safety.playmodeRefusal('Play', true), null)
	assert.deepEqual(safety.RESUME, {
		Play: '/transport/play',
		PlaySection: '/transport/playsection',
		Loop: '/transport/playloopsection',
	})
	const source = readFileSync(path.join(ROOT, 'scripts', 'rest-command-verify.mjs'), 'utf8')
	assert.match(source, /playmode: before\.playmode/)
	assert.ok(
		source.indexOf('playmodeRefusal(origin.playmode, force)') < source.indexOf('await verifyValues(origin)'),
		'the playing guard must run before the first command',
	)
})

test('a refused restore fails its step, a refused command does not', () => {
	const refused = new Error('/transport/speed refused (1000): Transport speed control is disabled.')
	assert.equal(safety.stepStatus(refused), 'refused')
	const restore = safety.restoreError('/transport/brightness', new Error('/transport/brightness refused (1000): '))
	assert.match(restore.message, /refused \(1000\)/, 'the message keeps the Director answer')
	assert.equal(safety.stepStatus(restore), 'failed')
	assert.equal(safety.stepStatus(new Error('fetch failed')), 'failed')

	assert.equal(safety.statusReason({ code: 1000, message: 'said here' }), 'said here')
	assert.equal(
		safety.statusReason({ code: 1000, message: '', details: [{}, { message: 'in a detail' }] }),
		'in a detail',
	)
	assert.equal(safety.statusReason(undefined), '')
})

test('the restore sweep is compared with the start and every difference is named', () => {
	const origin = {
		track: { uid: '0x0123456789abcdef', name: 'Track 1' },
		brightness: 0.5,
		volume: 1,
		speed: 1,
		engaged: true,
		time: 12,
	}
	const same = {
		currentTrack: { uid: '0x0123456789abcdef', name: 'Track 1' },
		brightness: 0.50000001,
		volume: 1,
		speed: 1,
		engaged: true,
	}
	assert.deepEqual(safety.restoreMismatches(origin, same, 12.1), [])

	const left = { ...same, brightness: 0.9, engaged: false, currentTrack: { uid: '0x1', name: 'Other' } }
	assert.deepEqual(
		safety.restoreMismatches(origin, left, 40).map((m: any) => m.field),
		['track', 'brightness', 'engaged', 'time'],
	)
	// the state could not be read after the sweep: nothing is confirmed
	assert.deepEqual(
		safety.restoreMismatches(origin, undefined, undefined).map((m: any) => m.field),
		['track', 'brightness', 'volume', 'speed', 'engaged', 'time'],
	)
	const line = safety.handRestoreLine([{ field: 'brightness', wanted: 0.5, seen: 0.9 }])
	assert.match(line, /^SET THIS BACK BY HAND: brightness = 0\.5 \(the Director reports 0\.9\)$/)

	const source = readFileSync(path.join(ROOT, 'scripts', 'rest-command-verify.mjs'), 'utf8')
	assert.match(source, /report\(unrestored\)/)
	assert.match(source, /handRestoreLine\(unrestored\)/)
})

test('an interrupted rest-command-verify ends like a normal run once a command has gone out', () => {
	const act = (o: Record<string, boolean>): string =>
		safety.interruptAction({ sending: false, settling: false, halted: false, ...o })
	assert.equal(act({}), 'exit', 'nothing was sent: nothing to put back')
	assert.equal(act({ sending: true }), 'sweep')
	assert.equal(act({ sending: true, settling: true }), 'wait', "main's own sweep is running and reports")
	assert.equal(act({ sending: true, halted: true }), 'force', 'a second interrupt leaves at once')
	assert.equal(act({ sending: true, settling: true, halted: true }), 'force')

	// leaving before the sweep confirmed anything names every field, less the ones the Director refused
	const origin = {
		playmode: 'Play',
		track: { uid: '0x0123456789abcdef', name: 'Track 1' },
		brightness: 0.5,
		volume: 1,
		speed: 1,
		engaged: true,
		time: 12,
	}
	assert.deepEqual(
		safety.unsweptFields(origin, ['speed']).map((i: any) => i.field),
		['track', 'brightness', 'volume', 'engaged', 'time', 'playmode'],
	)
	assert.match(safety.handRestoreLine(safety.unsweptFields(origin)), /playmode = "Play"/)

	const source = readFileSync(path.join(ROOT, 'scripts', 'rest-command-verify.mjs'), 'utf8')
	const bail = source.slice(source.indexOf('async function bail('), source.indexOf('async function get('))
	assert.match(bail, /interruptAction\(\{ sending, settling, halted \}\)/)
	assert.ok(
		bail.indexOf('await runRestores()') < bail.indexOf('settleBack(origin)') &&
			bail.indexOf('settleBack(origin)') < bail.indexOf('report(unrestored)'),
		'the interrupt must run the restores, the sweep with its comparison and resume, then the report',
	)
	assert.match(bail, /handRestoreLine\(unsweptFields\(origin, unchanged\)\)/)
	// main hands the end of the run to the interrupt, and sends nothing after it
	assert.match(source, /if \(!halted\) \{\s*settling = true/)
	assert.match(source, /async function step\(id, summary, run\) \{\s*if \(halted \|\|/)
	assert.match(source, /async function popRestore\(entry\) \{[^}]*if \(halted\) return/)
	const steps = source.slice(source.indexOf('// --- the steps'), source.indexOf('// --- plumbing'))
	assert.ok(!steps.includes('await post('), 'a step sends through post(), which an interrupt does not stop')
	// the track restore is queued before the jump, so no interrupt can fall between the two
	assert.ok(
		steps.indexOf("pushRestore('/transport/gototrack'") < steps.indexOf('await send(path, withTransport'),
		'the gototrack restore is queued after the next / previous track jump',
	)
})

test('a probe the Director refused leaves no restore behind, a probe that may have landed does', () => {
	const refused = new Error('/transport/speed refused (1000): Transport speed control is disabled.')
	const other = { path: '/transport/gototime' }
	const speed = { path: '/transport/speed' }
	const restores = [other, speed]
	assert.equal(safety.dropRefusedProbe(restores, speed, refused), true)
	assert.deepEqual(restores, [other], 'the refused probe changed nothing, so its restore is not sent')

	// no answer, or an HTTP error: the probe may have been applied, so the restore stays queued
	for (const error of [new Error('fetch failed'), new Error('POST /transport/speed -> 500 ')]) {
		const queue = [other, speed]
		assert.equal(safety.dropRefusedProbe(queue, speed, error), false)
		assert.deepEqual(queue, [other, speed])
	}

	const source = readFileSync(path.join(ROOT, 'scripts', 'rest-command-verify.mjs'), 'utf8')
	assert.match(source, /if \(dropRefusedProbe\(restores, restore, error\)\) unchanged\.push\(field\)/)
	assert.match(source, /await sendProbe\(field, restore, `\/transport\/\$\{field\}`/)
	assert.match(source, /await sendProbe\('engaged', restore, '\/transport\/engaged'/)
})

test('rest-command-verify refuses an unknown --group before it talks to the Director', () => {
	const groups = ['transport', 'renderstream', 'all']
	assert.equal(safety.groupProblem('transport', groups), null)
	assert.equal(safety.groupProblem('all', groups), null)
	assert.match(safety.groupProblem('renderstrem', groups) ?? '', /unknown --group renderstrem/)
	// a bare --group is parsed as true
	assert.match(safety.groupProblem(String(true), groups) ?? '', /unknown --group true/)

	const source = readFileSync(path.join(ROOT, 'scripts', 'rest-command-verify.mjs'), 'utf8')
	const check = source.indexOf("groupProblem(group, ['transport', 'renderstream', 'all'])")
	assert.ok(check >= 0, 'the group is not checked')
	assert.ok(check < source.indexOf('await main()'), 'the group must be checked before the first request')
	assert.match(source.slice(check, source.indexOf('await main()')), /process\.exit\(2\)/)
})

// ---------- gen-help.mjs ----------

test('HELP renders angle-bracket placeholders literally', () => {
	const help = readFileSync(path.join(ROOT, 'companion/HELP.md'), 'utf8')
	const start = help.indexOf('<!-- PRESETS:START -->') + '<!-- PRESETS:START -->'.length
	const block = help.slice(start, help.indexOf('<!-- PRESETS:END -->'))
	// outside code spans a '<' starts an HTML tag, which GitHub drops and Companion mangles
	const prose = block.replace(/`[^`\n]*`/g, '')
	assert.ok(!prose.includes('<'), `raw '<' in the preset list: ${prose.match(/.{0,30}<.{0,30}/)?.[0]}`)
})

test('the hand-written docs keep angle-bracket placeholders in code', () => {
	for (const file of ['companion/HELP.md', 'README.md', 'CHANGELOG.md']) {
		const prose = readFileSync(path.join(ROOT, file), 'utf8')
			.replace(/```[\s\S]*?```/g, '')
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/`[^`]*`/g, '')
		// '<' before a letter opens an HTML tag; a comparison sign such as '<,' is plain text
		const tag = /.{0,30}<[A-Za-z/].{0,30}/.exec(prose)
		assert.equal(tag, null, `${file}: a placeholder outside code reads as an HTML tag: ${tag?.[0]}`)
	}
})
