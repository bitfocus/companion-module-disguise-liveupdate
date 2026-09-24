// Safety checks for scripts/build-dev-module.mjs, kept in their own file so test/scripts.test.ts can
// run them without building anything.
//
// The script deletes its output folder before it copies the new build in. The folder name is the
// name of this repository, which is also the folder a clone gets by default, so an --out that holds
// the checkout would make the script delete the checkout, .git included. These checks make sure it
// only ever deletes a folder that looks like one of its own earlier builds.

'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** The output folder name inside --out; Companion does not care, the name only has to be stable */
const BUILD_FOLDER = 'companion-module-disguise-liveupdate'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * The real path of `p` (symlinks and junctions followed, the case of an existing path as the file
 * system has it), or of its nearest existing ancestor with the rest appended.
 */
function realish(p) {
	const rest = []
	let at = path.resolve(p)
	while (!fs.existsSync(at)) {
		const parent = path.dirname(at)
		if (parent === at) break
		rest.unshift(path.basename(at))
		at = parent
	}
	let real = at
	try {
		real = fs.realpathSync.native(at)
	} catch {
		// keep the resolved path
	}
	return path.join(real, ...rest)
}

/** true when `inner` is `outer` or lies inside it (path.relative ignores case on Windows) */
function within(inner, outer) {
	const rel = path.relative(outer, inner)
	return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))
}

/**
 * Why --out must not be used, or null. Refuses a filesystem root, the home folder or one of its
 * parents, and the checkout or any folder that contains it.
 * @param {{ root: string, outRoot: string, home?: string }} where
 */
function outRootProblem({ root, outRoot, home }) {
	const out = realish(outRoot)
	if (path.parse(out).root === out) return `--out ${out} is the root of a drive or file system`
	if (home && within(realish(home), out)) return `--out ${out} is the home folder or contains it`
	if (within(realish(root), out)) return `--out ${out} is the checkout or contains it`
	return null
}

/**
 * Why the existing build folder must not be deleted, or null when it is absent, empty or looks like
 * an earlier build of this script: a companion/manifest.json with this module's id and no .git or
 * src/ folder, which a checkout always has.
 * @param {string} outDir
 * @param {string} moduleId the id in the repository's companion/manifest.json
 */
function previousBuildProblem(outDir, moduleId) {
	if (!fs.existsSync(outDir)) return null
	if (!fs.statSync(outDir).isDirectory()) return `${outDir} exists and is not a folder`
	if (fs.readdirSync(outDir).length === 0) return null
	for (const entry of ['.git', 'src']) {
		if (fs.existsSync(path.join(outDir, entry)))
			return `${outDir} has a ${entry} folder: it is a checkout, not a build of this script`
	}
	let manifest
	try {
		manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'companion', 'manifest.json'), 'utf8'))
	} catch {
		return `${outDir} has no readable companion/manifest.json, so it is not a build of this script`
	}
	if (manifest?.id !== moduleId) return `${outDir} holds the module "${manifest?.id}", not "${moduleId}"`
	return null
}

/**
 * Delete an earlier build. A running Companion that has the dev module loaded keeps files in it
 * open, and Windows then refuses the delete; that is reported as the error code and the caller
 * overwrites the files in place instead. Any other error is thrown.
 * @returns {string | null} the error code when the folder could not be removed
 */
function removePreviousBuild(outDir, rm = fs.rmSync) {
	try {
		rm(outDir, { recursive: true, force: true })
		return null
	} catch (error) {
		if (['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error?.code)) return error.code
		throw error
	}
}

/**
 * The version to stamp: --version when it is a semver string, the repository's package.json
 * version when the flag is absent. A bare --version or anything else is an error.
 * @returns {{ version: string } | { error: string }}
 */
function buildVersion(arg, packageVersion) {
	if (arg === undefined) return { version: packageVersion }
	if (arg === true || !SEMVER.test(String(arg)))
		return { error: `--version needs a semver value such as ${packageVersion}-inhouse.1 (got ${String(arg)})` }
	return { version: String(arg) }
}

module.exports = { BUILD_FOLDER, outRootProblem, previousBuildProblem, removePreviousBuild, buildVersion, within }
