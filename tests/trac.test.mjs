import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { getTracReporter, getTracTickets } from '../src/trac.js';

/**
 * Original `fetch()`, restored after each test.
 *
 * @type {typeof fetch}
 */
const originalFetch = globalThis.fetch;

describe( 'getTracTickets', () => {
	it( 'gets each linked ticket once, in order, from any WordPress.org Trac', () => {
		assert.deepEqual(
			getTracTickets(
				'Fixes https://meta.trac.wordpress.org/ticket/1.\n' +
					'See https://Core.trac.wordpress.org/ticket/62447#comment:3 and ' +
					'http://core.trac.wordpress.org/ticket/62447.'
			),
			[
				{ instance: 'meta', id: 1 },
				{ instance: 'core', id: 62447 },
			]
		);
	} );

	it( 'ignores links that are not to a WordPress.org Trac ticket', () => {
		assert.deepEqual(
			getTracTickets(
				'https://core.trac.wordpress.org/changeset/123 ' +
					'https://core.trac.wordpress.org.example.com/ticket/1 ' +
					'https://example.com/core.trac.wordpress.org/ticket/2 ' +
					'#3'
			),
			[]
		);
	} );

	it( 'handles a pull request without a description', () => {
		assert.deepEqual( getTracTickets( null ), [] );
	} );
} );

describe( 'getTracReporter', () => {
	let requests;

	/**
	 * Answers Trac requests with a response.
	 *
	 * @param {Object} response The response.
	 */
	function respondWith( response ) {
		globalThis.fetch = async ( url, options ) => {
			requests.push( { url, options } );
			return response;
		};
	}

	beforeEach( () => {
		process.env.GITHUB_REPOSITORY = 'WordPress/props-bot-action';
		requests = [];
	} );

	afterEach( () => {
		globalThis.fetch = originalFetch;
		delete process.env.GITHUB_REPOSITORY;
	} );

	it( 'gets the username of the reporter from the ticket query', async () => {
		respondWith( {
			ok: true,
			text: async () => '﻿id,reporter\r\n1,Reporter\r\n',
		} );

		assert.equal(
			await getTracReporter( { instance: 'meta', id: 1 } ),
			'reporter'
		);
		assert.equal(
			requests[ 0 ].url,
			'https://meta.trac.wordpress.org/query?id=1&col=reporter&format=csv'
		);
		assert.equal( requests[ 0 ].options.redirect, 'manual' );
	} );

	it( 'derives the username from a login the way WordPress derives profile slugs', async () => {
		const slugs = {
			'John Doe.Jr': 'john-doe-jr',
			'-john--doe@example-': 'john-doeexample',
			[ 'a'.repeat( 49 ) + '-b' ]: 'a'.repeat( 49 ),
		};

		for ( const [ login, slug ] of Object.entries( slugs ) ) {
			respondWith( {
				ok: true,
				text: async () => `id,reporter\r\n1,${ login }\r\n`,
			} );

			assert.equal(
				await getTracReporter( { instance: 'core', id: 1 } ),
				slug
			);
		}
	} );

	it( 'returns null for anonymous or free-form reporters and missing tickets', async () => {
		for ( const reporter of [ 'anonymous', '"Smith, John"' ] ) {
			respondWith( {
				ok: true,
				text: async () => `id,reporter\r\n1,${ reporter }\r\n`,
			} );
			assert.equal(
				await getTracReporter( { instance: 'core', id: 1 } ),
				null
			);
		}

		respondWith( { ok: true, text: async () => 'id,reporter\r\n' } );
		assert.equal(
			await getTracReporter( { instance: 'core', id: 2 } ),
			null
		);
	} );

	it( 'returns null when Trac does not answer with the ticket', async () => {
		// An unknown Trac instance redirects, and a bot check is a 403.
		respondWith( { ok: false, status: 302 } );
		assert.equal(
			await getTracReporter( { instance: 'nope', id: 1 } ),
			null
		);

		respondWith( { ok: false, status: 403 } );
		assert.equal(
			await getTracReporter( { instance: 'core', id: 1 } ),
			null
		);

		globalThis.fetch = async () => {
			throw new Error( 'network down' );
		};
		assert.equal(
			await getTracReporter( { instance: 'core', id: 1 } ),
			null
		);
	} );
} );
