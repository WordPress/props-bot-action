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
 * Builds a pull request commit with its git author and co-authors.
 *
 * @param {...Object} authors The commit's authors, git author first.
 *
 * @return {Object} The commit.
 */
function commit( ...authors ) {
	return { commit: { authors: { nodes: authors } } };
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
	let lookedUpUsers;

	beforeEach( () => {
		process.env.GITHUB_REPOSITORY = 'WordPress/props-bot-action';
		process.env.INPUT_TOKEN = 'token';

		lookedUpUsers = [];
		globalThis.fetch = async ( url, { body } ) => {
			lookedUpUsers.push( ...JSON.parse( body ).github_user );
			return { json: async () => ( {} ) };
		};
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
				nodes: [ commit( { user: actor( 'committer' ) } ) ],
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
				nodes: [ commit( { user: actor( 'committer' ) } ) ],
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

		assert.deepEqual( lookedUpUsers, [
			'committer',
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

	it( 'credits co-authors from Co-authored-by trailers once, leaving out bots and coding agents', async () => {
		GitHub.prototype.getContributorData = async () => ( {
			commits: {
				nodes: [
					commit(
						{ user: actor( 'committer' ) },
						{ user: actor( 'co-author' ) },
						{ user: actor( 'claude' ) }
					),
					commit(
						{ user: actor( 'co-author' ) },
						{ user: actor( 'committer' ) },
						{ user: actor( 'Copilot' ) },
						{ user: actor( 'pre-commit-ci[bot]' ) },
						{
							user: null,
							name: 'Unlinked',
							email: 'unlinked@example.com',
						}
					),
				],
			},
			reviews: { nodes: [ { author: actor( 'co-author' ) } ] },
			comments: { nodes: [] },
			closingIssuesReferences: { nodes: [] },
		} );

		const { getContributorsList } = await importCollector();
		const contributorsList = await getContributorsList();

		assert.deepEqual( lookedUpUsers, [
			'committer',
			'co-author',
			'unlinked@example.com',
		] );
		assert.deepEqual( contributorsList.unlinked, lookedUpUsers );
	} );

	it( 'credits unmatched authors with a WordPress.org email by that username, once, if it exists and is not removed', async () => {
		const checkedProfiles = [];
		globalThis.fetch = async ( url, { method } ) => {
			if ( 'HEAD' === method ) {
				checkedProfiles.push( url );
				return { ok: ! url.includes( '/missing/' ) };
			}
			return {
				json: async () => ( { reviewer: { slug: 'reviewer-slug' } } ),
			};
		};
		GitHub.prototype.getContributorData = async () => ( {
			commits: {
				nodes: [
					commit(
						{
							user: null,
							name: 'Co-Author',
							email: 'co-author@git.wordpress.org',
						},
						{
							user: null,
							name: 'Co-Author Again',
							email: 'Co-Author@git.wordpress.org',
						},
						{
							user: null,
							name: 'Reviewer',
							email: 'reviewer-slug@git.wordpress.org',
						},
						{
							user: null,
							name: 'Removed',
							email: 'removed@git.wordpress.org',
						},
						{
							user: null,
							name: 'Missing',
							email: 'missing@git.wordpress.org',
						}
					),
				],
			},
			reviews: { nodes: [ { author: actor( 'reviewer' ) } ] },
			comments: {
				nodes: [
					{
						author: actor( 'maintainer' ),
						body: '@propsbot remove removed',
					},
				],
			},
			closingIssuesReferences: { nodes: [] },
		} );
		GitHub.prototype.hasWriteAccess = async () => true;

		const { getContributorsList } = await importCollector();
		const contributorsList = await getContributorsList();

		assert.deepEqual( contributorsList.svn, [
			'reviewer-slug',
			'co-author',
		] );
		assert.deepEqual( contributorsList.coAuthored, [
			'Co-authored-by: co-author <co-author@git.wordpress.org>',
			'Co-authored-by: reviewer <reviewer-slug@git.wordpress.org>',
		] );
		assert.deepEqual( contributorsList.unlinked, [
			'missing@git.wordpress.org',
		] );
		assert.deepEqual( checkedProfiles, [
			'https://profiles.wordpress.org/co-author/',
			'https://profiles.wordpress.org/missing/',
		] );
	} );
} );
