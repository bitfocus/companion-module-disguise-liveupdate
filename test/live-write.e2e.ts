/**
 * End-to-end write check of the BUILT MODULE against a real Director: the module's own actions
 * (Set Number with an expression, Toggle Boolean, Set JSON with a partial object) are driven the way
 * Companion drives them, and every value is restored afterwards.
 *
 * Not part of `yarn test` (it writes to a show). Run it on purpose, on a track that is NOT the
 * transport's current track:
 *   yarn tsx test/live-write.e2e.ts --host 192.0.2.10 --track demo --layer "Video 6" --screen "surface 1" --yes
 * Without --yes the script connects, reads the values and prints the plan.
 *
 * Safety: every step restores with an ABSOLUTE value (never a second toggle, which would repeat the
 * first write if its echo was late), the restores run in a finally block, and a step whose restore
 * is not confirmed stops the run before the next value is touched.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { installHarness, liveUpdateFeedback, loadDist, tick } from './harness'

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
const track = arg('track')
const layer = arg('layer')
const screen = arg('screen')
const outFile = resolve(__dirname, '..', 'docs', 'research', 'live-write-e2e.json')

const LAYER = `track:"${track}".findLayerByName("${layer}")`
const SCREEN = `screen2:"${screen}"`

type Vector = { x: number; y: number; z: number }

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
		throw new Error(
			'usage: yarn tsx test/live-write.e2e.ts --host <director> --track <name> --layer <name> --screen <name> [--yes]',
		)
	}
	const inst = new dist.DisguiseInstance()
	const hostStub = inst.host
	const results: Record<string, unknown> = { host, port, mode: write ? 'write' : 'dry-run', track, layer, screen }
	const steps: Record<string, { written: boolean; restored: boolean; after: unknown }> = {}
	results.steps = steps
	const save = (): void =>
		writeFileSync(outFile, JSON.stringify({ ...results, date: new Date().toISOString() }, null, 1))

	try {
		const initPromise = inst.init({ host, port, reconnectInterval: 1000, pendingSubscriptionTimeout: 5000 })
		inst.updateFeedbacks({
			br: liveUpdateFeedback('br', 'transportManager:default', 'object.brightness', 'brightness', 100),
			en: liveUpdateFeedback('en', LAYER, 'object.enabled', 'layerEnabled', 100),
			off: liveUpdateFeedback('off', SCREEN, 'object.offset', 'screenOffset', 100),
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
		save()
		if (!write) return

		const actions = dist.getActionDefinitions(inst)
		const context = {
			parseVariablesInString: async (text: string): Promise<string> =>
				text.replace(/\$\(liveupdate:(\w+)\)/g, (_m, name: string) => String(vars.get(name))),
		}
		const stop = (step: string): never => {
			throw new Error(`${step}: the value was NOT restored, stopping before the next write`)
		}

		// 1. Set Number with an expression on the module's own variable; restore with the absolute value
		let written = false
		try {
			await actions.setToDisguiseNumber.callback(
				{ options: { variableName: 'brightness', value: plan.brightness.write } },
				context,
			)
			written = await waitFor(() => near(vars.get('brightness'), brightness1), 3000)
		} finally {
			await actions.setToDisguiseNumber.callback(
				{ options: { variableName: 'brightness', value: String(brightness0) } },
				context,
			)
			const restored = await waitFor(() => near(vars.get('brightness'), brightness0), 3000)
			steps.brightness = { written, restored, after: vars.get('brightness') }
			save()
			console.log('brightness', steps.brightness)
			if (!restored) stop('brightness')
		}

		// 2. Toggle Boolean on the layer; restore with Set Boolean (absolute), never a second toggle
		written = false
		try {
			await actions.setToDisguiseToggle.callback({ options: { variableName: 'layerEnabled' } }, context)
			written = await waitFor(() => vars.get('layerEnabled') === !enabled0, 3000)
		} finally {
			await actions.setToDisguiseBoolean.callback(
				{ options: { variableName: 'layerEnabled', value: enabled0 } },
				context,
			)
			const restored = await waitFor(() => vars.get('layerEnabled') === enabled0, 3000)
			steps.layerEnabled = { written, restored, after: vars.get('layerEnabled') }
			save()
			console.log('layerEnabled', steps.layerEnabled)
			if (!restored) stop('layerEnabled')
		}

		// 3. Set JSON with a partial object; the Director merges it into the vector
		written = false
		try {
			await actions.setToDisguiseJSON.callback(
				{ options: { variableName: 'screenOffset', value: JSON.stringify(plan.screenOffset.write) } },
				context,
			)
			written = await waitFor(() => {
				const v = readOffset()
				return !!v && near(v.x, offset0.x + 0.01) && near(v.y, offset0.y) && near(v.z, offset0.z)
			}, 3000)
		} finally {
			await actions.setToDisguiseJSON.callback(
				{ options: { variableName: 'screenOffset', value: JSON.stringify(plan.screenOffset.restore) } },
				context,
			)
			const restored = await waitFor(() => {
				const v = readOffset()
				return !!v && near(v.x, offset0.x) && near(v.y, offset0.y) && near(v.z, offset0.z)
			}, 3000)
			steps.screenOffset = { written, restored, after: vars.get('screenOffset') }
			save()
			console.log('screenOffset', steps.screenOffset)
			if (!restored) stop('screenOffset')
		}

		results.log = hostStub.logs
			.slice(logStart)
			.filter((l: { level: string }) => l.level === 'error' || l.level === 'warn')
			.map((l: { level: string; message: string }) => `${l.level}: ${l.message}`)
		save()
	} finally {
		save()
		await inst.destroy()
	}

	const notRestored = Object.entries(steps).filter(([, s]) => !s.restored)
	if (notRestored.length) {
		console.error(`A VALUE WAS NOT RESTORED: ${notRestored.map(([k]) => k).join(', ')} - check the Director`)
		process.exitCode = 1
	} else if (write) {
		console.log('every written value was restored')
	}
	console.log('wrote', outFile)
}

main().catch((e: unknown) => {
	console.error(e)
	process.exitCode = 1
})
