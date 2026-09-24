// Offline renderer for the preset button texts, with the semantics of the expression engine that
// Companion 5.0.4 bundles (@companion-app/expressions in resources/main.js):
//
// - a variable reaches the expression as it is (a number stays a number, OFFLINE stays a string);
// - a ternary, || and && test plain JavaScript truthiness, and both sides of || and && are evaluated;
// - '+' is numeric ('$.' + 'x' is NaN): Companion resolves expressions with stringConcatenation off;
// - a template slot that ends up undefined renders as $NA (unknownVariableValue);
// - the quasis of a template literal are taken raw (processTemplateEscapes is off).
//
// Only the builtin functions the catalog uses are implemented, each copied from Companion's function
// table; any other call is refused, so a text can only use functions that exist in Companion 5.0.4.
// The texts are parsed with the TypeScript parser once every $(label:name) is replaced by an
// identifier: Companion parses them with acorn (ecmaVersion latest) and a plugin that reads
// $(label:name) as a variable, so the grammar and the precedence are those of JavaScript.
//
// Used by scripts/gen-presets.mjs, which refuses to generate a catalog whose button text hides a
// readout marker or shows an empty value as anything but empty, and by test/catalog.test.ts, which
// checks the generated catalog the same way.

'use strict'

const ts = require('typescript')

/** What Companion renders for a template slot that is undefined */
const UNKNOWN_VALUE = '$NA'

const VARIABLE_PATTERN = /\$\(([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)\)/g

const rn = (value) => (value === undefined ? '' : value + '')

// --- jsonpath-plus, as far as the catalog uses it: $, .name and [*], called with wrap: false ---

function toPathArray(path) {
	const list = path
		.replaceAll(/['"]?\.['"]?(?![^[]*\])|\[['"]?/gu, ';')
		.replaceAll(/;$|'?\]|'$/gu, '')
		.split(';')
	for (const segment of list) {
		if (!/^(?:\$|\*|[\w -]+)$/.test(segment))
			throw new Error(`jsonpath "${path}": the checker only follows $, .name and [*]`)
	}
	return list
}

function trace(path, value, hasArrExpr, literalPriority) {
	if (!path.length) return [{ value, hasArrExpr }]
	const [loc, ...rest] = path
	const found = []
	if (literalPriority && value && Object.hasOwn(value, loc)) {
		found.push(...trace(rest, value[loc], hasArrExpr, false))
	} else if (loc === '*') {
		const keys = Array.isArray(value)
			? value.map((_, index) => index)
			: value && typeof value === 'object'
				? Object.keys(value)
				: []
		for (const key of keys) found.push(...trace(rest, value[key], true, true))
	} else if (loc === '$') {
		found.push(...trace(rest, value, hasArrExpr, false))
	} else if (!literalPriority && value && Object.hasOwn(value, loc)) {
		found.push(...trace(rest, value[loc], hasArrExpr, true))
	}
	return found
}

function jsonpathPlus(json, path) {
	if (!json) return undefined
	const list = toPathArray(path)
	if (list[0] === '$' && list.length > 1) list.shift()
	const found = trace(list, json, false, false)
	if (!found.length) return undefined
	if (found.length === 1 && !found[0].hasArrExpr) return found[0].value
	return found.map((entry) => entry.value)
}

// --- secondsToTimestamp: Companion's timestamp formatter ---

function pad(value, fill, width) {
	let text = value + ''
	while (text.length < width) text = fill + text
	return text
}

function timestampParts(ms) {
	const sign = ms < 0 ? '-' : ''
	ms = Math.abs(ms)
	const s = Math.floor(ms / 1e3)
	const m = Math.floor(ms / 6e4)
	const h = Math.floor(ms / 3.6e6)
	return {
		n: sign,
		S: ms % 1e3,
		s: (largest) => (largest ? s : s % 60),
		m: (largest) => (largest ? m : m % 60),
		H: (largest) => (largest ? h : h % 24),
		h: (largest) => (largest ? h : h % 12 === 0 ? 12 : h % 12),
		d: () => Math.floor(ms / 8.64e7),
		a: h % 24 >= 12 ? 'PM' : 'AM',
	}
}

function formatTimestamp(ms, format) {
	if (/[[\]]/.test(format)) throw new Error('secondsToTimestamp: the checker does not support [ ] in the format')
	const parts = timestampParts(ms)
	const out = []
	let unit = ''
	let run = ''
	const flush = (next) => {
		if (next !== unit) {
			if ('SsmHhdna'.includes(unit) && unit !== '') {
				if (unit === 'n' || unit === 'a') out.push(parts[unit])
				else if (unit === 'S') out.push(pad(Math.trunc(parts.S / [100, 10, 1][run.length - 1]), '0', run.length))
				else out.push(pad(parts[unit](false), '0', run.length))
			} else out.push(run)
			run = ''
		}
		run += next
		unit = next
	}
	for (const char of format) flush(char)
	flush('')
	return out.join('')
}

// --- the builtin functions the catalog uses, copied from Companion 5.0.4 ---

const FUNCTIONS = {
	length: (t) => {
		if (t == null) return 0
		if (Array.isArray(t)) return t.length
		if (typeof t === 'number') return (t + '').length
		if (typeof t === 'bigint') return t.toString().length
		if (typeof t === 'string') return [...new Intl.Segmenter().segment(t)].length
		if (t instanceof RegExp) return t.toString().length
		if (typeof t === 'object') return Object.keys(t).length
		return NaN
	},
	round: (t) => Math.round(t),
	toFixed: (t, e) => Number(t).toFixed(Math.min(100, Math.max(0, e || 0))),
	isNumber: (t) =>
		typeof t === 'number' || typeof t === 'bigint'
			? !Number.isNaN(t)
			: typeof t === 'string'
				? t.trim() !== '' && !isNaN(Number(t))
				: false,
	concat: (...t) => ''.concat(...t.map(rn)),
	bool: (t) => {
		if (typeof t === 'string') t = t.toLowerCase()
		return !!t && t !== 'false' && t !== '0'
	},
	jsonpath: (t, e) => {
		const wasString = typeof t === 'string'
		if (wasString) {
			try {
				t = JSON.parse(t)
			} catch {
				// Companion keeps the raw string
			}
		}
		const found = jsonpathPlus(t, rn(e))
		if (wasString && typeof found !== 'number' && typeof found !== 'string' && found) {
			try {
				return JSON.stringify(found)
			} catch {
				// Companion returns the value itself
			}
		}
		return found
	},
	jsonparse: (t) => {
		try {
			return JSON.parse(rn(t))
		} catch {
			return null
		}
	},
	secondsToTimestamp: (t, e) => formatTimestamp(t * 1e3, e || 'nHH:mm:ss'),
}

/** Property names Companion refuses to read or write in an expression */
const BANNED_PROPS = new Set([
	'__proto__',
	'constructor',
	'prototype',
	'__defineGetter__',
	'__defineSetter__',
	'__lookupGetter__',
	'__lookupSetter__',
])

// --- parsing and evaluation ---

/** The $(label:name) ids an expression text reads, in order of first use */
function referencedVariables(text) {
	return [...new Set([...String(text).matchAll(VARIABLE_PATTERN)].map((match) => `${match[1]}:${match[2]}`))]
}

function parse(text) {
	const ids = referencedVariables(text)
	const source = String(text).replace(
		VARIABLE_PATTERN,
		(_, label, name) => `__variable${ids.indexOf(`${label}:${name}`)}`,
	)
	const file = ts.createSourceFile('button-text.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const syntax = file.parseDiagnostics ?? []
	if (syntax.length) throw new Error(`does not parse: ${ts.flattenDiagnosticMessageText(syntax[0].messageText, ' ')}`)
	if (file.statements.length !== 1 || !ts.isExpressionStatement(file.statements[0]))
		throw new Error('is not a single expression')
	return { expression: file.statements[0].expression, ids }
}

function evaluate(node, variables) {
	const run = (child) => evaluate(child, variables)
	if (ts.isParenthesizedExpression(node)) return run(node.expression)
	if (ts.isNoSubstitutionTemplateLiteral(node)) return node.rawText ?? node.text
	if (ts.isTemplateExpression(node)) {
		let text = node.head.rawText ?? node.head.text
		for (const span of node.templateSpans) {
			let value = run(span.expression)
			if (value === undefined) value = UNKNOWN_VALUE
			text += String(value) + (span.literal.rawText ?? span.literal.text)
		}
		return text
	}
	if (ts.isStringLiteral(node)) return node.text
	if (ts.isNumericLiteral(node)) return Number(node.text)
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false
	if (node.kind === ts.SyntaxKind.NullKeyword) return null
	if (ts.isIdentifier(node)) {
		const match = /^__variable(\d+)$/.exec(node.text)
		if (!match) throw new Error(`uses the identifier "${node.text}", which Companion does not define`)
		return structuredClone(variables[Number(match[1])])
	}
	if (ts.isConditionalExpression(node)) return run(node.condition) ? run(node.whenTrue) : run(node.whenFalse)
	if (ts.isPrefixUnaryExpression(node)) {
		const value = run(node.operand)
		switch (node.operator) {
			case ts.SyntaxKind.MinusToken:
				return -value
			case ts.SyntaxKind.PlusToken:
				return +value
			case ts.SyntaxKind.ExclamationToken:
				return !value
			case ts.SyntaxKind.TildeToken:
				return ~value
		}
		throw new Error(`uses the unary operator ${ts.tokenToString(node.operator)}`)
	}
	if (ts.isBinaryExpression(node)) {
		const left = run(node.left)
		const right = run(node.right)
		const operator = ts.tokenToString(node.operatorToken.kind)
		switch (operator) {
			case '+':
				return Number(left) + Number(right)
			case '-':
				return Number(left) - Number(right)
			case '*':
				return Number(left) * Number(right)
			case '/':
				return Number(left) / Number(right)
			case '%':
				return Number(left) % Number(right)
			case '>=':
				return Number(left) >= Number(right)
			case '<=':
				return Number(left) <= Number(right)
			case '>':
				return Number(left) > Number(right)
			case '<':
				return Number(left) < Number(right)
			case '==':
				return left == right
			case '!=':
				return left != right
			case '===':
				return left === right
			case '!==':
				return left !== right
			case '||':
				return left || right
			case '&&':
				return left && right
			case '??':
				return left ?? right
		}
		throw new Error(`uses the operator ${operator}, which the checker does not implement`)
	}
	if (ts.isCallExpression(node)) {
		if (!ts.isIdentifier(node.expression)) throw new Error('calls something other than a builtin function')
		const name = node.expression.text
		const fn = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined
		if (!fn) throw new Error(`calls ${name}(), which is not one of the checked Companion 5.0.4 functions`)
		return fn(...node.arguments.map(run))
	}
	if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
		const object = run(node.expression)
		const key = ts.isPropertyAccessExpression(node) ? node.name.text : run(node.argumentExpression)
		if (object == null) return node.questionDotToken ? undefined : object
		if (BANNED_PROPS.has(String(key))) throw new Error(`reads the property ${String(key)}`)
		return Object.prototype.propertyIsEnumerable.call(object, key) ? object[key] : undefined
	}
	throw new Error(`uses ${ts.SyntaxKind[node.kind]}, which the checker does not implement`)
}

/**
 * Render an expression text the way Companion 5.0.4 does. `values` maps 'label:name' to the value
 * of the variable; a missing entry is an undefined variable.
 */
function renderExpression(text, values = {}) {
	const { expression, ids } = parse(text)
	const result = evaluate(
		expression,
		ids.map((id) => values[id]),
	)
	return result === undefined ? UNKNOWN_VALUE : String(result)
}

/**
 * Why an expression text would hide what the module writes into a readout. For each variable the
 * text reads, the text is rendered with that variable holding each marker and undefined, once with
 * the other variables undefined and once with all of them holding the same value. The marker, or
 * $NA for undefined, has to reach the button, and nothing may be formatted into NaN.
 *
 * An empty value ('', which is also what an empty string or a None from the Director becomes) is
 * rendered the same two ways and has to come out exactly as a marker does with the marker's own
 * words left out: shown as it is, never turned into NaN, a formatted 0, a true / false word or an
 * enum word (`'' == 0` is true in Companion's loose equality, `isNumber('')` is false).
 */
function markerProblems(text, markers) {
	const problems = []
	const ids = referencedVariables(text)
	const render = (context, values) => {
		try {
			return renderExpression(text, values)
		} catch (error) {
			problems.push(`${context}: ${error.message}`)
			return undefined
		}
	}
	for (const id of ids) {
		for (const probe of [...markers, undefined]) {
			for (const othersToo of ids.length > 1 ? [false, true] : [false]) {
				const values = {}
				for (const other of ids) values[other] = othersToo ? probe : undefined
				values[id] = probe
				const shown = probe === undefined ? UNKNOWN_VALUE : probe
				const context = `${id} = ${probe === undefined ? 'undefined' : JSON.stringify(probe)}${othersToo ? ' (all variables)' : ''}`
				const output = render(context, values)
				if (output === undefined) continue
				if (!output.includes(shown)) problems.push(`${context} renders ${JSON.stringify(output)}, not ${shown}`)
				else if (output.includes('NaN')) problems.push(`${context} renders ${JSON.stringify(output)}`)
			}
		}
	}
	// the marker an empty value is compared with: one whose words the text does not contain itself
	const reference = markers.find((marker) => !String(text).includes(marker))
	if (ids.length && reference === undefined) problems.push('contains every marker, so an empty value cannot be checked')
	if (reference === undefined) return problems
	for (const id of ids) {
		for (const othersToo of ids.length > 1 ? [false, true] : [false]) {
			const empty = {}
			const marked = {}
			for (const other of ids) {
				empty[other] = othersToo ? '' : undefined
				marked[other] = othersToo ? reference : undefined
			}
			empty[id] = ''
			marked[id] = reference
			const context = `${id} = ""${othersToo ? ' (all variables)' : ''}`
			const output = render(context, empty)
			const expected = render(`${context} (compared with ${reference})`, marked)
			if (output === undefined || expected === undefined) continue
			const shown = expected.replaceAll(reference, '')
			if (output !== shown || output.includes('NaN'))
				problems.push(
					`${context} renders ${JSON.stringify(output)}, not the empty value as it is (${JSON.stringify(shown)})`,
				)
		}
	}
	return problems
}

/**
 * The readout markers as src/variables.ts declares them (the SENTINELS list), read from the source
 * so the generator does not need a build.
 */
function readMarkers(sourceText) {
	const file = ts.createSourceFile('variables.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const constants = new Map()
	let list
	for (const statement of file.statements) {
		if (!ts.isVariableStatement(statement)) continue
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
			if (ts.isStringLiteral(declaration.initializer))
				constants.set(declaration.name.text, declaration.initializer.text)
			if (declaration.name.text === 'SENTINELS' && ts.isArrayLiteralExpression(declaration.initializer))
				list = declaration.initializer.elements
		}
	}
	if (!list) throw new Error('src/variables.ts declares no SENTINELS list')
	return list.map((element) => {
		if (ts.isStringLiteral(element)) return element.text
		if (ts.isIdentifier(element) && constants.has(element.text)) return constants.get(element.text)
		throw new Error(`SENTINELS entry ${element.getText(file)} is not a string constant of src/variables.ts`)
	})
}

module.exports = { UNKNOWN_VALUE, renderExpression, referencedVariables, markerProblems, readMarkers }
