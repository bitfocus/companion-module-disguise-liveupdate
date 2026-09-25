/**
 * End-to-end write check of the BUILT MODULE against a real Director: the module's own actions
 * (Set Number with an expression, Toggle Boolean, Set JSON with a partial object) are driven the way
 * Companion drives them, and every value is restored afterwards.
 *
 * Not part of `yarn test` (it writes to a show). Run it on purpose, on a track that is NOT the
 * transport's current track, while the transport is stopped:
 *   yarn tsx test/live-write.e2e.ts --host 192.0.2.10 --track demo --layer "Video 6" --screen "surface 1" --yes
 * Without --yes the script connects, reads the values and prints the plan.
 *
 * Guards (the ones of scripts/live-write-verify.mjs, from scripts/live-safety.cjs): the layer step
 * changes --track, and the master brightness and surface offset steps change the live output, so --yes
 * is refused (exit 2) when --track is the transport's current track or the current track cannot be
 * read, and when the transport is playing or its playing state cannot be read. --force skips them.
 *
 * Safety: every step restores with an ABSOLUTE value (never a second toggle, which would repeat the
 * first write if its echo was late), the restores run in a finally block, and a step whose restore
 * is not confirmed stops the run before the next value is touched. A value that did not come back is
 * printed as "SET THIS BACK BY HAND" and the run exits 1. Ctrl+C lets the step in flight restore and
 * stops before the next write; a second Ctrl+C leaves at once.
 *
 * The results file is raw site data (the Director's address, track, layer and screen names): it goes
 * to the git-ignored .live/live-write-e2e.json unless --out names another file. The committed
 * docs/research/live-write-e2e.json is scrubbed evidence: write there only with an explicit --out, and
 * scrub the file before it is committed.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT, installHarness, liveUpdateFeedback, loadDist, tick } from './harness'

/* eslint-disable @typescript-eslint/no-require-imports */
const { handRestoreLine, liveOutFile, readoutValue, siteDataReminder, writeRefusal } = require(
	path.join(ROOT, 'scripts/live-safety.cjs'),
)
/* eslint-enable @typescript-eslint/no-require-imports */

installHarness({ fakeSocket: false })
const dist = loadDist()

const argv = process.argv.slice(2)
const arg = (name: string): string | undefined => {
	const i = argv.indexOf(`--${name}`)
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined
}
const host = arg('host')
const port = Number(arg('port') ?? 80)
const write = argv.includes('--yes')
const force = argv.includes('--force')
const track = arg('track')
const layer = arg('layer')
const screen = arg('screen')
const outFile: string = liveOutFile(ROOT, arg('out'), 'live-write-e2e.json')

const LAYER = `track:"${track}".findLayerByName("${layer}")`
const SCREEN = `screen2:"${screen}"`

type Vector = { x: number; y: number; z: number }
/** One write step: the value it changes, the value to put back and what the Director showed last */
type Step = { field: string; wanted: unknown; written: boolean; restored: boolean; after: unknown }

const steps: Record<string, Step> = {}
/** The signal that asked the run to stop: the step in flight still restores, the next one never starts */
let interrupted: string | undefined

/** What a step changed and did not see come back, as items of the SET THIS BACK BY HAND line */
const byHand = (): { field: string; wanted: unknown; seen: unknown }[] =>
	Object.values(steps)
		.filter((s) => !s.restored)
		.map((s) => ({ field: s.field, wanted: s.wanted, seen: s.after }))

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		if (interrupted) {
			// a second signal: leave now, naming what may still be changed
			const items = byHand()
			if (items.length) console.error(`!! ${handRestoreLine(items)}`)
			// eslint-disable-next-line n/no-process-exit -- the operator asked twice: nothing may keep the run going
			process.exit(1)
		}
		interrupted = signal
		console.error(`\n${signal}: the step in flight restores its value, then the run stops (again to leave at once)`)
	})
}

async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms
	while (Date.now() < deadline) {
		try {
			if (predicate()) return true
		} catch {
			// a sentinel value ('ERROR' / 'PATH_ERROR') in the variable: keep waiting
		}
		await tick(20)
	}
	try {
		return predicate()
	} catch {
		return false
	}
}

const near = (a: unknown, b: number): boolean =>
	typeof a === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))

async function main(): Promise<void> {
	if (!host || !track || !layer || !screen) {
		console.error(
			'usage: yarn tsx test/live-write.e2e.ts --host <director> --track <name> --layer <name> --screen <name> ' +
				'[--yes] [--force] [--out <file, default .live/live-write-e2e.json>]',
		)
		process.exitCode = 2
		return
	}
	const inst = new dist.DisguiseInstance()
	const hostStub = inst.host
	const results: Record<string, unknown> = { host, port, mode: write ? 'write' : 'dry-run', track, layer, screen }
	results.steps = steps
	const save = (): void => {
		mkdirSync(path.dirname(outFile), { recursive: true })
		writeFileSync(outFile, JSON.stringify({ ...results, date: new Date().toISOString() }, null, 1))
	}

	try {
		const initPromise = inst.init({ host, port, reconnectInterval: 1000, pendingSubscriptionTimeout: 5000 })
		inst.updateFeedbacks({
			br: liveUpdateFeedback('br', 'transportManager:default', 'object.brightness', 'brightness', 100),
			en: liveUpdateFeedback('en', LAYER, 'object.enabled', 'layerEnabled', 100),
			off: liveUpdateFeedback('off', SCREEN, 'object.offset', 'screenOffset', 100),
			// what the guards need: the transport's current track and whether it plays
			cur: liveUpdateFeedback('cur', 'transportManager:default', 'object.track.description', 'currentTrack', 100),
			play: liveUpdateFeedback('play', 'transportManager:default', 'object.player.playing', 'playing', 100),
		})
		await initPromise
		if (!(await waitFor(() => inst.isConnectionReady(), 5000))) throw new Error('not connected')
		const vars = hostStub.variables
		const readOffset = (): Vector | undefined => {
			const raw = vars.get('screenOffset')
			if (typeof raw !== 'string') return undefined
			try {
				const v = JSON.parse(raw) as Vector
				return typeof v?.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number' ? v : undefined
			} catch {
				return undefined
			}
		}
		const ready = await waitFor(
			() =>
				typeof vars.get('brightness') === 'number' &&
				typeof vars.get('layerEnabled') === 'boolean' &&
				readOffset() !== undefined,
			5000,
		)
		if (!ready) {
			throw new Error(
				`values not received (brightness=${JSON.stringify(vars.get('brightness'))}, layerEnabled=${JSON.stringify(
					vars.get('layerEnabled'),
				)}, screenOffset=${JSON.stringify(vars.get('screenOffset'))}) - check --track / --layer / --screen`,
			)
		}
		// a guard value that has not arrived by now counts as unknown, and an unknown one refuses the write
		await waitFor(
			() =>
				typeof readoutValue(vars.get('currentTrack'), dist.SENTINELS) === 'string' &&
				typeof vars.get('playing') === 'boolean',
			3000,
		)
		const currentTrack: unknown = readoutValue(vars.get('currentTrack'), dist.SENTINELS)
		const playing: unknown = readoutValue(vars.get('playing'), dist.SENTINELS)
		results.transport = { currentTrack: currentTrack ?? null, playing: playing ?? null }
		// only the log lines produced from here on belong to the test itself
		const logStart = hostStub.logs.length

		const brightness0 = vars.get('brightness') as number
		const enabled0 = vars.get('layerEnabled') as boolean
		const offset0 = readOffset() as Vector
		const brightness1 = brightness0 > 0.5 ? brightness0 - 0.05 : brightness0 + 0.05
		const plan = {
			brightness: {
				before: brightness0,
				write: `$(liveupdate:brightness)${brightness0 > 0.5 ? '-' : '+'}0.05`,
				restore: brightness0,
			},
			layerEnabled: { before: enabled0, write: 'Toggle Disguise Boolean', restore: `Set Boolean ${String(enabled0)}` },
			screenOffset: {
				before: offset0,
				write: { x: offset0.x + 0.01 },
				restore: { x: offset0.x, y: offset0.y, z: offset0.z },
			},
		}
		results.plan = plan
		console.log('plan', JSON.stringify(plan, null, 1))
		console.log(
			`transport: track ${JSON.stringify(currentTrack) ?? 'unknown'}, playing=${JSON.stringify(playing) ?? 'unknown'}`,
		)

		// the layer step changes --track (neutral), the brightness and offset steps the live output (output)
		const refusal: string | null = writeRefusal({ neutral: true, output: true, track, currentTrack, playing, force })
		if (refusal) {
			results.refused = refusal
			if (write) {
				console.error(`refusing to write: ${refusal}`)
				process.exitCode = 2
				return
			}
			console.log(`note: with --yes the script would stop here - ${refusal}`)
		}
		if (!write) return

		const actions = dist.getActionDefinitions(inst)
		const context = {
			parseVariablesInString: async (text: string): Promise<string> =>
				text.replace(/\$\(liveupdate:(\w+)\)/g, (_m, name: string) => String(vars.get(name))),
		}
		const stop = (step: string): never => {
			throw new Error(`${step}: the value was NOT restored, stopping before the next write`)
		}
		/** Start a step: refused once a signal asked the run to stop */
		const begin = (name: string, field: string, wanted: unknown): Step => {
			if (interrupted) throw new Error(`${interrupted}: stopped before ${name}`)
			steps[name] = { field, wanted, written: false, restored: false, after: undefined }
			return steps[name]
		}

		// 1. Set Number with an expression on the module's own variable; restore with the absolute value
		const brightness = begin('brightness', 'transportManager:default object.brightness', brightness0)
		try {
			await actions.setToDisguiseNumber.callback(
				{ options: { variableName: 'brightness', value: plan.brightness.write } },
				context,
			)
			brightness.written = await waitFor(() => near(vars.get('brightness'), brightness1), 3000)
			brightness.after = vars.get('brightness')
		} finally {
			await actions.setToDisguiseNumber.callback(
				{ options: { variableName: 'brightness', value: String(brightness0) } },
				context,
			)
			brightness.restored = await waitFor(() => near(vars.get('brightness'), brightness0), 3000)
			brightness.after = vars.get('brightness')
			save()
			console.log('brightness', brightness)
			if (!brightness.restored) stop('brightness')
		}

		// 2. Toggle Boolean on the layer; restore with Set Boolean (absolute), never a second toggle
		const enabled = begin('layerEnabled', `${LAYER} object.enabled`, enabled0)
		try {
			await actions.setToDisguiseToggle.callback({ options: { variableName: 'layerEnabled' } }, context)
			enabled.written = await waitFor(() => vars.get('layerEnabled') === !enabled0, 3000)
			enabled.after = vars.get('layerEnabled')
		} finally {
			await actions.setToDisguiseBoolean.callback(
				{ options: { variableName: 'layerEnabled', value: enabled0 } },
				context,
			)
			enabled.restored = await waitFor(() => vars.get('layerEnabled') === enabled0, 3000)
			enabled.after = vars.get('layerEnabled')
			save()
			console.log('layerEnabled', enabled)
			if (!enabled.restored) stop('layerEnabled')
		}

		// 3. Set JSON with a partial object; the Director merges it into the vector
		const offset = begin('screenOffset', `${SCREEN} object.offset`, plan.screenOffset.restore)
		try {
			await actions.setToDisguiseJSON.callback(
				{ options: { variableName: 'screenOffset', value: JSON.stringify(plan.screenOffset.write) } },
				context,
			)
			offset.written = await waitFor(() => {
				const v = readOffset()
				return !!v && near(v.x, offset0.x + 0.01) && near(v.y, offset0.y) && near(v.z, offset0.z)
			}, 3000)
			offset.after = vars.get('screenOffset')
		} finally {
			await actions.setToDisguiseJSON.callback(
				{ options: { variableName: 'screenOffset', value: JSON.stringify(plan.screenOffset.restore) } },
				context,
			)
			offset.restored = await waitFor(() => {
				const v = readOffset()
				return !!v && near(v.x, offset0.x) && near(v.y, offset0.y) && near(v.z, offset0.z)
			}, 3000)
			offset.after = vars.get('screenOffset')
			save()
			console.log('screenOffset', offset)
			if (!offset.restored) stop('screenOffset')
		}

		results.log = hostStub.logs
			.slice(logStart)
			.filter((l: { level: string }) => l.level === 'error' || l.level === 'warn')
			.map((l: { level: string; message: string }) => `${l.level}: ${l.message}`)
	} finally {
		// before the values were read there is nothing to record but the arguments
		if (results.plan) save()
		await inst.destroy()
		const items = byHand()
		if (items.length) {
			console.error(`!! ${handRestoreLine(items)}`)
			process.exitCode = 1
		} else if (Object.keys(steps).length) {
			console.log('every written value was restored')
		}
		if (results.plan) {
			console.log('wrote', outFile)
			for (const line of siteDataReminder(ROOT, outFile)) console.log(line)
		}
	}
}

main().catch((e: unknown) => {
	console.error(e)
	process.exitCode = 1
})
