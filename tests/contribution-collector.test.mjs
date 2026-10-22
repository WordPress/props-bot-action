import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import GitHub from '../src/github.js';

/**
 * Original GitHub methods, restored after each test.
 *
 * @type {Object}
 */
const originalMethods = {
	getContributorData: GitHub.prototype.getContributorData,
	getUsersData: GitHub.prototype.getUsersData,
	hasWriteAccess: GitHub.prototype.hasWriteAccess,
};

const originalFetch = globalThis.fetch;

/**
 * Number of times the collector was imported, used to bust the module cache.
 *
 * @type {number}
 */
let importCount = 0;

/**
 * Imports a fresh copy of the collector, since it keeps the contributors it
 * gathered in module state.
 *
 * @return {Promise<Object>} The module.
 */
function importCollector() {
	return import( `../src/contribution-collector.js?test=${ ++importCount }` );
}

/**
 * Runs a callback and captures the debug messages it logs.
 *
 * @param {() => Promise<void>} callback The callback to run.
 *
 * @return {Promise<string[]>} The debug messages, in order.
 */
async function captureDebug( callback ) {
	const messages = [];
	const originalWrite = process.stdout.write;

	process.stdout.write = ( chunk, ...args ) => {
		const match = String( chunk ).match( /^::debug::(.*)/ );
		if ( match ) {
			messages.push( match[ 1 ] );
			return true;
		}
		return originalWrite.call( process.stdout, chunk, ...args );
	};

	try {
		await callback();
	} finally {
		process.stdout.write = originalWrite;
	}

	return messages;
}

describe( 'getContributorsList', () => {
	beforeEach( () => {
		process.env.GITHUB_REPOSITORY = 'WordPress/props-bot-action';
		process.env.INPUT_TOKEN = 'token';

		GitHub.prototype.getUsersData = async ( users ) =>
			Object.fromEntries(
				users.map( ( login ) => [ login, { login } ] )
			);

		globalThis.fetch = async () => ( {
			json: async () => ( { reviewer: { slug: 'reviewer-slug' } } ),
		} );
	} );

	afterEach( () => {
		Object.assign( GitHub.prototype, originalMethods );
		globalThis.fetch = originalFetch;

		delete process.env.GITHUB_REPOSITORY;
		delete process.env.INPUT_TOKEN;
	} );

	it( 'logs the collected contributors in debug mode', async () => {
		GitHub.prototype.getContributorData = async () => ( {
			commits: {
				nodes: [
					{
						commit: {
							author: { user: { login: 'committer' } },
						},
					},
				],
			},
			reviews: { nodes: [ { author: { login: 'reviewer' } } ] },
			comments: {
				nodes: [
					{
						author: { login: 'maintainer' },
						body: '@propsbot remove someone',
					},
				],
			},
			closingIssuesReferences: { nodes: [] },
		} );
		GitHub.prototype.hasWriteAccess = async () => true;

		const { getContributorsList } = await importCollector();
		const messages = await captureDebug( getContributorsList );
		const after = ( label ) => messages[ messages.indexOf( label ) + 1 ];

		assert.equal( after( 'Committers:' ), '["committer"]' );
		assert.equal( after( 'Reviewers:' ), '["reviewer"]' );
		assert.equal(
			after( 'Props Bot command overrides:' ),
			'{"added":[],"removed":["someone"]}'
		);
		assert.deepEqual( JSON.parse( messages.at( -1 ) ), {
			github: [],
			svn: [ 'reviewer-slug' ],
			coAuthored: [
				'Co-authored-by: reviewer <reviewer-slug@git.wordpress.org>',
			],
			unlinked: [ 'committer' ],
			hasGhostActivity: false,
		} );
	} );
} );
