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
]
