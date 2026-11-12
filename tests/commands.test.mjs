import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getPropsOverrides, parseCommands } from '../src/commands.js';

/**
 * Builds a comment as returned by the contributor data query.
 *
 * @param {string} login        The author's login.
 * @param {string} body         The comment body.
 * @param {string} [__typename] The author's GraphQL actor type.
 *
 * @return {Object} The comment.
 */
function comment( login, body, __typename = 'User' ) {
	return { author: { __typename, login }, body };
}

describe( 'parseCommands', () => {
	it( 'parses add and remove commands on their own lines', () => {
		assert.deepEqual(
			parseCommands(
				'@propsbot add alice\r\n  @PropsBot REMOVE @bob-smith  '
			),
			{
				commands: [
					{ action: 'add', username: 'alice' },
					{ action: 'remove', username: 'bob-smith' },
				],
				isCommandOnly: true,
			}
		);
	} );

	it( 'parses a refresh command, which takes no username', () => {
		assert.deepEqual( parseCommands( '@PropsBot Refresh ' ), {
			commands: [ { action: 'refresh' } ],
			isCommandOnly: true,
		} );
		assert.deepEqual(
			parseCommands( '@propsbot refresh alice' ).commands,
			[]
		);
	} );

	it( 'runs commands next to other content without making it command-only', () => {
		assert.deepEqual(
			parseCommands( 'Thanks for the help!\n\n@propsbot add alice' ),
			{
				commands: [ { action: 'add', username: 'alice' } ],
				isCommandOnly: false,
			}
		);
	} );

	it( 'ignores commands that are quoted, inline, or fenced', () => {
		assert.deepEqual(
			parseCommands(
				[
					'> @propsbot add alice',
					'Use `@propsbot add bob` to add someone.',
					'```',
					'@propsbot add carol',
					'```',
				].join( '\n' )
			),
			{ commands: [], isCommandOnly: false }
		);
	} );

	it( 'only ends a fenced code block at a matching fence', () => {
		assert.deepEqual(
			parseCommands(
				[
					'````',
					'```',
					'@propsbot add alice',
					'```',
					'````',
					'~~~',
					'```js',
					'@propsbot add bob',
					'~~~',
					'@propsbot add carol',
				].join( '\n' )
			).commands,
			[ { action: 'add', username: 'carol' } ]
		);
	} );

	it( 'ignores commands indented as code', () => {
		assert.deepEqual(
			parseCommands(
				'Example:\n\n    @propsbot remove bob\n\n   @propsbot add alice'
			).commands,
			[ { action: 'add', username: 'alice' } ]
		);
	} );

	it( 'ignores usernames neither GitHub nor WordPress.org would allow', () => {
		for ( const body of [
			'@propsbot add -alice',
			'@propsbot add alice-',
			'@propsbot add al--ice',
			'@propsbot add ' + 'a'.repeat( 51 ),
			'@propsbot add alice") { id }',
			'@propsbot add alice bob',
			'@propsbot invite alice',
		] ) {
			assert.deepEqual( parseCommands( body ).commands, [], body );
		}
	} );

	it( 'takes a WordPress.org username, and its email for the WordPress.org user only', () => {
		assert.deepEqual(
			parseCommands(
				'@propsbot add Some_User@git.wordpress.org\n' +
					'@propsbot remove @some_user@git.wordpress.org\n' +
					'@propsbot remove some_user'
			).commands,
			[
				{ action: 'add', username: 'Some_User@git.wordpress.org' },
				{ action: 'remove', username: 'some_user@git.wordpress.org' },
				{ action: 'remove', username: 'some_user' },
			]
		);

		for ( const body of [
			'@propsbot add alice@wordpress.org',
			'@propsbot add alice@git.wordpress.org.example.com',
			'@propsbot add al.ice@git.wordpress.org',
			'@propsbot add ' + 'a'.repeat( 51 ) + '@git.wordpress.org',
		] ) {
			assert.deepEqual( parseCommands( body ).commands, [], body );
		}
	} );

	it( 'handles a missing body', () => {
		assert.deepEqual( parseCommands( undefined ), {
			commands: [],
			isCommandOnly: false,
		} );
	} );
} );

describe( 'getPropsOverrides', () => {
	it( 'lets the most recent command for a user win, regardless of case', async () => {
		const overrides = await getPropsOverrides(
			[
				comment(
					'maintainer',
					'@propsbot remove Alice\n@propsbot add bob'
				),
				comment(
					'maintainer',
					'@propsbot add alice\n@propsbot remove BOB'
				),
			],
			async () => true
		);

		assert.deepEqual( overrides, {
			added: [ 'alice' ],
			removed: new Set( [ 'bob', 'bob@git.wordpress.org' ] ),
		} );
	} );

	it( 'replays commands for the GitHub and the WordPress.org user of a name in order', async () => {
		const wpOrg = '@git.wordpress.org';

		for ( const [ commands, added, removed ] of [
			[
				[ 'remove paul', `add paul${ wpOrg }` ],
				[ `paul${ wpOrg }` ],
				[ 'paul' ],
			],
			[
				[ `add paul${ wpOrg }`, 'remove paul' ],
				[],
				[ 'paul', `paul${ wpOrg }` ],
			],
			[
				[ `add paul${ wpOrg }`, 'remove paul', 'add paul' ],
				[ 'paul' ],
				[],
			],
			[
				[ 'add paul', `remove paul${ wpOrg }` ],
				[ 'paul' ],
				[ `paul${ wpOrg }` ],
			],
			[
				[ `add paul${ wpOrg }`, 'add paul' ],
				[ `paul${ wpOrg }`, 'paul' ],
				[],
			],
			[
				[ `remove paul${ wpOrg }`, `add Paul${ wpOrg }` ],
				[ `Paul${ wpOrg }` ],
				[],
			],
		] ) {
			assert.deepEqual(
				await getPropsOverrides(
					commands.map( ( command ) =>
						comment( 'maintainer', `@propsbot ${ command }` )
					),
					async () => true
				),
				{ added, removed: new Set( removed ) },
				commands.join( ', ' )
			);
		}
	} );

	it( 'ignores commands from users without write access, checking each user once', async () => {
		const checked = [];
		const overrides = await getPropsOverrides(
			[
				comment( 'drive-by', '@propsbot add drive-by' ),
				comment( 'maintainer', '@propsbot remove carol' ),
				comment( 'drive-by', '@propsbot remove maintainer' ),
				{ author: null, body: '@propsbot add ghost' },
				comment( 'chatty', 'No commands here.' ),
			],
			async ( username ) => {
				checked.push( username );
				return 'maintainer' === username;
			}
		);

		assert.deepEqual( overrides, {
			added: [],
			removed: new Set( [ 'carol', 'carol@git.wordpress.org' ] ),
		} );
		assert.deepEqual( checked, [ 'drive-by', 'maintainer' ] );
	} );

	it( 'ignores commands from authors that are not user accounts, without checking access', async () => {
		const checked = [];
		const overrides = await getPropsOverrides(
			[ comment( 'maintainer', '@propsbot remove carol', 'Bot' ) ],
			async ( username ) => {
				checked.push( username );
				return true;
			}
		);

		assert.deepEqual( overrides, { added: [], removed: new Set() } );
		assert.deepEqual( checked, [] );
	} );

	it( 'skips refresh commands without checking access', async () => {
		const checked = [];
		const overrides = await getPropsOverrides(
			[ comment( 'anyone', '@propsbot refresh' ) ],
			async ( username ) => {
				checked.push( username );
				return false;
			}
		);

		assert.deepEqual( overrides, { added: [], removed: new Set() } );
		assert.deepEqual( checked, [] );
	} );
} );
