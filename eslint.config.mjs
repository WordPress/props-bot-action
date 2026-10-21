import wordpress from '@wordpress/eslint-plugin';
import globals from 'globals';

export default [
	{
		ignores: [ 'dist/' ],
	},
	...wordpress.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.node,
				...globals.commonjs,
			},
		},
		rules: {
			indent: [ 'error', 'tab' ],
			'one-var': [ 'error', 'never' ],
			'prefer-arrow-callback': [ 'error' ],
		},
	},
];
