// Safety rules shared by the scripts that talk to a real Director (live-verify, live-write-verify,
// rest-command-verify, rest-discover, and test/live-write.e2e.ts). They live here so
// test/scripts.test.ts can check them without a Director: the scripts themselves are never run by the
// tests.
//
// Every guard fails closed: a state the script could not read counts as the unsafe one.

'use strict'

const path = require('node:path')

// ---------- arguments ----------

/**
 * The usage error for a --group that is not one of `groups`, or null. A typo must not run another
 * group than the one asked for, and a bare --group (parsed as true) names none.
 */
function groupProblem(group, groups) {
	return groups.includes(group) ? null : `unknown --group ${group}; use ${groups.join(', ')}`
}

// ---------- output files ----------

/** Raw output goes here unless --out says otherwise; the folder is in .gitignore */
const LIVE_DIR = '.live'

/**
 * The results file: --out (relative to the checkout) when given, else .live/<name>. The committed
 * evidence under docs/research is scrubbed by hand, so a script must never overwrite it by default.
 */
function liveOutFile(root, out, name) {
	return path.resolve(root, typeof out === 'string' && out ? out : path.join(LIVE_DIR, name))
}

/** The reminder a script prints next to the path it wrote */
function siteDataReminder(root, file) {
	const lines = [
		`note: ${file} is raw output. It holds site data (the Director's address, project, track, layer, ` +
			'screen and machine names, uids); scrub it before any of it goes into docs/research.',
	]
	const rel = path.relative(root, file)
	const inside = rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
	if (inside && rel.split(path.sep)[0] !== LIVE_DIR)
		lines.push(`note: ${rel} is inside the checkout and not ignored by git; do not commit it unscrubbed.`)
	return lines
}

// ---------- live-write-verify ----------

/**
 * Why live-write-verify must not write, or null. `neutral` / `output` say whether the planned targets
 * include that group, `track` is the track the layer tests use, `currentTrack` and `playing` what the
 * Director reported (undefined when the read failed). --force skips every check.
 */
function writeRefusal({ neutral, output, track, currentTrack, playing, force }) {
	if (force) return null
	if (neutral && track !== undefined) {
		if (typeof currentTrack !== 'string')
			return (
				"the transport's current track could not be read, so the neutral group cannot prove that " +
				`track "${track}" is off air; re-run with --force or when the Director answers`
			)
		if (track === currentTrack)
			return (
				`track "${track}" is the transport's current track, so the neutral group would change what is on ` +
				'air; pass --track with a track that is not current, or re-run with --force'
			)
	}
	if (output) {
		if (playing === true)
			return 'the transport is playing and this group changes the live output; re-run with --force or stop playback'
		if (playing !== false)
			return (
				'the playing state of the transport could not be read and this group changes the live output; ' +
				're-run with --force or when the Director answers'
			)
	}
	return null
}

/**
 * A readout of the built module as a value for writeRefusal (test/live-write.e2e.ts reads the current
 * track and the playing state through the module): undefined while it holds no Director value, that
 * is the '' a defined variable starts with or a readout marker (`sentinels`, the module's SENTINELS),
 * so a guard never takes PENDING or OFFLINE for a track name.
 */
function readoutValue(value, sentinels) {
	return value === '' || (typeof value === 'string' && sentinels.includes(value)) ? undefined : value
}

const FINAL_OK = ['original value confirmed', 'original value restored on the second attempt']

/**
 * The final read-back label for a check whose value could not be read ({error} or no value), or null
 * when there is a value to compare.
 */
function unverifiedLabel(check) {
	if (check && check.id !== undefined && check.error === undefined && check.value !== undefined) return null
	return `UNVERIFIED: ${check?.error ?? 'no value'}`
}

/**
 * The entries a run must not call good: a restore that failed during the run, and a final read-back
 * that did not confirm the original value (it differs, or it could not be read). `byHand` are the
 * ones whose original value was never confirmed afterwards.
 */
function unsettled(results) {
	const notRestored = results.filter((e) => e.result === 'RESTORE FAILED')
	const unconfirmed = results.filter(
		(e) => e.result !== 'RESTORE FAILED' && e.finalCheck !== undefined && !FINAL_OK.includes(e.finalCheck),
	)
	const byHand = [...notRestored, ...unconfirmed].filter((e) => !FINAL_OK.includes(e.finalCheck))
	return { notRestored, unconfirmed, byHand }
}

/**
 * Report a WebSocket close the script did not ask for: without it a Director that drops the
 * connection mid-run lets Node drain its event loop and exit 0 in the middle of a write. Returns the
 * close function the script uses for its own closes, which are not reported.
 */
function watchClose(ws, onUnexpected) {
	let closing = false
	ws.on('close', (code, reason) => {
		if (closing) return
		const why = reason && reason.length ? `, ${String(reason)}` : ''
		onUnexpected(`the Director closed the connection (code ${code}${why})`)
	})
	return () => {
		closing = true
		ws.close()
	}
}

// ---------- rest-command-verify ----------

/** The command that resumes a playmode after the restore sweep stopped the transport */
const RESUME = {
	Play: '/transport/play',
	PlaySection: '/transport/playsection',
	Loop: '/transport/playloopsection',
}

/** Why rest-command-verify must not send commands, or null (the transport must be stopped) */
function playmodeRefusal(playmode, force) {
	if (force || playmode === 'Stop') return null
	const state = playmode === undefined ? 'could not be read' : `is ${playmode}`
	return (
		`the transport playmode ${state}; these commands change the live output and stop and rewind the ` +
		'transport. Stop playback or re-run with --force'
	)
}

/** The reason a Director gives for a refusal: status.message, or the first detail that has one */
function statusReason(status) {
	return status?.message || status?.details?.find((d) => d?.message)?.message || ''
}

/** An error from a restore: a step that throws it failed, whatever the Director's answer was */
function restoreError(path, error) {
	const wrapped = new Error(`restore ${path} failed: ${String(error?.message ?? error)}`)
	wrapped.restore = true
	return wrapped
}

/**
 * The status of a step that threw. "refused (N)" is the Director declining a command for a reason it
 * names (a Designer option that is off, a tag that does not exist): the command reached it and was
 * understood. A refused restore is different: the state stays changed, so it is a failure.
 */
function stepStatus(error) {
	if (error?.restore) return 'failed'
	return /refused \(\d+\)/.test(String(error?.message ?? error)) ? 'refused' : 'failed'
}

const close = (seen, wanted, tolerance = 1e-3) =>
	typeof seen === 'number' && Number.isFinite(seen) && Math.abs(seen - wanted) <= tolerance

/**
 * What the restore sweep did not put back, compared with the state at the start: [{field, wanted,
 * seen}]. `after` is the transport state read after the sweep (undefined when the read failed),
 * `time` the settled playhead. Playmode is checked by the caller, after it resumes playback.
 */
function restoreMismatches(origin, after, time) {
	const out = []
	const check = (field, wanted, seen, same) => {
		if (!same) out.push({ field, wanted, seen })
	}
	if (origin.track?.uid !== undefined)
		check(
			'track',
			origin.track.name ?? origin.track.uid,
			after?.currentTrack?.name ?? after?.currentTrack?.uid,
			after?.currentTrack?.uid === origin.track.uid,
		)
	for (const field of ['brightness', 'volume', 'speed'])
		if (typeof origin[field] === 'number')
			check(field, origin[field], after?.[field], close(after?.[field], origin[field]))
	if (typeof origin.engaged === 'boolean')
		check('engaged', origin.engaged, after?.engaged, after?.engaged === origin.engaged)
	if (typeof origin.time === 'number') check('time', origin.time, time, close(time, origin.time, 0.25))
	return out
}

/** The line that tells the operator what to put back by hand */
function handRestoreLine(items) {
	const text = items.map(
		(i) => `${i.field} = ${JSON.stringify(i.wanted)} (the Director reports ${JSON.stringify(i.seen)})`,
	)
	return `SET THIS BACK BY HAND: ${text.join('; ')}`
}

/**
 * A probe the Director refused ("refused (N)", a non-zero status.code) changed nothing, so its restore
 * comes off the queue unsent: sent later it is refused as well (speed while transport speed control is
 * off) and would read as a failed restore. Any other error leaves the restore queued, because the probe
 * may have been applied with its answer lost. Returns whether the restore was taken off.
 */
function dropRefusedProbe(restores, entry, error) {
	if (stepStatus(error) !== 'refused') return false
	const at = restores.lastIndexOf(entry)
	if (at >= 0) restores.splice(at, 1)
	return at >= 0
}

/**
 * What an interrupt (a signal, or a crash) does, from where the run is: 'exit' when no command has been
 * sent, 'sweep' to stop the steps and end like a normal run (queued restores, sweep, comparison with
 * the start, resume), 'wait' when the run's own sweep is already under way and will report, and
 * 'force' for a second interrupt, which leaves at once.
 */
function interruptAction({ sending, settling, halted }) {
	if (!sending) return 'exit'
	if (halted) return 'force'
	return settling ? 'wait' : 'sweep'
}

/**
 * The hand-restore items of a run that left before its sweep could compare anything: every field the
 * sweep checks, and the playmode. `unchanged` are the fields the Director refused to change, which the
 * run never moved.
 */
function unsweptFields(origin, unchanged = []) {
	return [
		...restoreMismatches(origin, undefined, undefined),
		{ field: 'playmode', wanted: origin.playmode, seen: undefined },
	].filter((i) => !unchanged.includes(i.field))
}

module.exports = {
	groupProblem,
	LIVE_DIR,
	liveOutFile,
	siteDataReminder,
	writeRefusal,
	readoutValue,
	FINAL_OK,
	unverifiedLabel,
	unsettled,
	watchClose,
	RESUME,
	playmodeRefusal,
	statusReason,
	restoreError,
	stepStatus,
	restoreMismatches,
	handRestoreLine,
	dropRefusedProbe,
	interruptAction,
	unsweptFields,
}
