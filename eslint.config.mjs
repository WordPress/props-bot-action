import wordpress from '@wordpress/eslint-plugin';

export default [
	{
		ignores: [ 'dist/' ],
	},
	...wordpress.configs.recommended,
	{
		rules: {
			indent: [ 'error', 'tab' ],
			'one-var': [ 'error', 'never' ],
			'prefer-arrow-callback': [ 'error' ],
		},
	},
];
