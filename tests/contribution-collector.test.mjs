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

/**
 * Original `fetch()`, restored after each test.
 *
 * @type {typeof fetch}
 */
const originalFetch = globalThis.fetch;

/**
 * Builds a comment, review, or issue author.
 *
 * @param {string} login        The login.
 * @param {string} [__typename] The GraphQL actor type.
 *
 * @return {Object} The author.
 */
function actor( login, __typename = 'User' ) {
	return { __typename, login };
}

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
	let requestedUsers;

	beforeEach( () => {
		process.env.GITHUB_REPOSITORY = 'WordPress/props-bot-action';
		process.env.INPUT_TOKEN = 'token';

		requestedUsers = [];
		GitHub.prototype.getUsersData = async ( users ) => {
			requestedUsers.push( ...users );
			return Object.fromEntries(
				users.map( ( login ) => [ login, { login } ] )
			);
		};

		globalThis.fetch = async () => ( { json: async () => ( {} ) } );
	} );

	afterEach( () => {
		Object.assign( GitHub.prototype, originalMethods );
		globalThis.fetch = originalFetch;

		delete process.env.GITHUB_REPOSITORY;
		delete process.env.INPUT_TOKEN;
	} );

	it( 'logs the collected contributors in debug mode', async () => {
		globalThis.fetch = async () => ( {
			json: async () => ( { reviewer: { slug: 'reviewer-slug' } } ),
		} );
		GitHub.prototype.getContributorData = async () => ( {
			commits: {
				nodes: [
					{
						commit: {
							author: {
								user: {
									__typename: 'User',
									login: 'committer',
								},
							},
						},
					},
				],
			},
			reviews: {
				nodes: [
					{ author: { __typename: 'User', login: 'reviewer' } },
				],
			},
			comments: {
				nodes: [
					{
						author: { __typename: 'User', login: 'maintainer' },
						body: '@propsbot remove someone',
					},
				],
			},
			closingIssuesReferences: { nodes: [] },
		} );
		GitHub.prototype.hasWriteAccess = async () => true;

		const { getContributorsList } = await importCollector();
		const messages = await captureDebug( getContributorsList );
		/**
		 * Gets the debug message logged right after a label.
		 *
		 * @param {string} label The label.
		 *
		 * @return {string} The message.
		 */
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

	it( 'leaves out authors that are not user accounts', async () => {
		GitHub.prototype.getContributorData = async () => ( {
			commits: {
				nodes: [
					{ commit: { author: { user: actor( 'committer' ) } } },
				],
			},
			reviews: {
				nodes: [
					{ author: actor( 'reviewer' ) },
					{ author: actor( 'some-review-app', 'Bot' ) },
				],
			},
			comments: {
				nodes: [
					{ author: actor( 'commenter' ), body: 'Looks good.' },
					{ author: actor( 'some-ci-app', 'Bot' ), body: 'Passed.' },
				],
			},
			closingIssuesReferences: {
				nodes: [
					{
						author: actor( 'imported-user', 'Mannequin' ),
						comments: {
							nodes: [
								{ author: actor( 'issue-commenter' ) },
								{
									author: actor(
										'WordPress',
										'Organization'
									),
								},
							],
						},
					},
				],
			},
		} );

		const { getContributorsList } = await importCollector();
		const contributorsList = await getContributorsList();

		assert.deepEqual( requestedUsers, [
			'reviewer',
			'commenter',
			'issue-commenter',
		] );
		assert.deepEqual( contributorsList.unlinked, [
			'committer',
			'reviewer',
			'commenter',
			'issue-commenter',
		] );
	} );
} );
