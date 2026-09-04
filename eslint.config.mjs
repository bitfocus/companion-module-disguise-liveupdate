import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
	ignores: ['scripts/**'],
})

export default [
	...baseConfig,
	{
		// This module is compiled to CommonJS with extension-less relative imports;
		// let eslint-plugin-n resolve them against the TypeScript sources.
		settings: {
			n: {
				tryExtensions: ['.ts', '.js', '.json'],
			},
		},
	},
	{
		// Tests use node:test (Node 20+, the package is only built and tested on Node 22) and
		// node:test's top-level test() returns a promise that the runner itself awaits.
		files: ['test/**/*.ts'],
		rules: {
			'@typescript-eslint/no-floating-promises': 'off',
			'n/no-unsupported-features/node-builtins': 'off',
		},
	},
]
