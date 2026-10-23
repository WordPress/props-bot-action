import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import GitHub from '../src/github.js';

const context = {
	eventName: 'pull_request_target',
	payload: { pull_request: { number: 123 } },
	repo: { owner: 'WordPress', repo: 'props-bot-action' },
};

const contributorsList = {
	unlinked: [],
	svn: [ 'dotorguser' ],
	coAuthored: [ 'Co-authored-by: someone <dotorguser@git.wordpress.org>' ],
	hasGhostActivity: false,
};

/**
 * The message `contributorsList` renders to with `format: all`.
 *
 * Asserted in full so a change to the intro, either props section, or the
 * footer has to be made deliberately.
 *
 * @type {string}
 */
const expectedMessage =
	'The following accounts have interacted with this PR and/or linked issues. I will continue to update these lists as activity occurs.\n\n' +
	'## Core SVN\n\n' +
	'Core Committers: Use this line as a base for the props when committing in SVN:\n' +
	'```\nProps dotorguser.\n```\n\n' +
	'## GitHub Merge commits\n\n' +
	"If you're merging code through a pull request on GitHub, copy and paste the following into the bottom of the merge commit message.\n\n" +
	'```\nCo-authored-by: someone <dotorguser@git.wordpress.org>\n```\n\n' +
	"**To understand the WordPress project's expectations around crediting contributors, please [review the Contributor Attribution page in the Core Handbook](https://make.wordpress.org/core/handbook/best-practices/contributor-attribution-props/).**\n" +
	'\n---\n\n<details>\n<summary>Props Bot commands</summary>\n<br />\n\n' +
	'You can trigger Props Bot actions by commenting on this PR:\n\n' +
	'- `@propsbot add <username>` to give props to a GitHub user. Requires write access.\n' +
	'- `@propsbot remove <username>` to leave a user out of the props. Requires write access.\n' +
	'- `@propsbot refresh` to refresh this list. Adding the `props-bot` label works too.\n\n' +
	'</details>\n';

let outputDir;
let outputFile;

/**
 * Builds a GitHub instance with a stubbed Octokit that records the calls made
 * to the comment endpoints, along with the body they were given.
 *
 * @param {string} [postComment] The value of the `post-comment` input. The
 *                               input is left unset when omitted.
 *
 * @return {Object} The instance and the recorded calls.
 */
function createGitHub( postComment ) {
	if ( undefined === postComment ) {
		delete process.env[ 'INPUT_POST-COMMENT' ];
	} else {
		process.env[ 'INPUT_POST-COMMENT' ] = postComment;
	}

	const gh = new GitHub();
	const calls = {
		listComments: 0,
		createComment: 0,
		updateComment: 0,
		postedBody: undefined,
	};

	gh.octokit = {
		paginate: {
			iterator: () => {
				calls.listComments++;
				return [ { data: [] } ];
			},
		},
		rest: {
			issues: {
				listComments: () => {},
				createComment: ( { body } ) => {
					calls.createComment++;
					calls.postedBody = body;
				},
				updateComment: ( { body } ) => {
					calls.updateComment++;
					calls.postedBody = body;
				},
			},
		},
	};

	return { gh, calls };
}

/**
 * Reads an output value written by `@actions/core`.
 *
 * @param {string} name The output name.
 *
 * @return {string|undefined} The value, or undefined when the output was not set.
 */
function getOutput( name ) {
	const match = fs
		.readFileSync( outputFile, 'utf8' )
		.match( new RegExp( `^${ name }<<(\\S+)\\n([\\s\\S]*?)\\n\\1$`, 'm' ) );

	return match ? match[ 2 ] : undefined;
}

describe( 'commentProps', () => {
	beforeEach( () => {
		outputDir = fs.mkdtempSync( path.join( os.tmpdir(), 'props-bot-' ) );
		outputFile = path.join( outputDir, 'output' );
		fs.writeFileSync( outputFile, '' );

		process.env.GITHUB_OUTPUT = outputFile;
		process.env.INPUT_TOKEN = 'token';
		process.env.INPUT_FORMAT = 'all';
	} );

	afterEach( () => {
		fs.rmSync( outputDir, { recursive: true, force: true } );

		delete process.env.GITHUB_OUTPUT;
		delete process.env.INPUT_TOKEN;
		delete process.env.INPUT_FORMAT;
		delete process.env[ 'INPUT_POST-COMMENT' ];
		delete process.env[ 'INPUT_FAIL-ON-ERROR' ];
	} );

	it( 'posts the comment by default and outputs the body it posted', async () => {
		const { gh, calls } = createGitHub();

		assert.equal( gh.postComment, true );

		await gh.commentProps( { context, contributorsList } );

		assert.equal( calls.createComment, 1 );
		assert.equal( calls.postedBody, expectedMessage );
		assert.equal( getOutput( 'comment-body' ), calls.postedBody );
	} );

	it( 'outputs the same body without posting when `post-comment` is false', async () => {
		const { gh, calls } = createGitHub( 'false' );

		assert.equal( gh.postComment, false );

		await gh.commentProps( { context, contributorsList } );

		assert.deepEqual( calls, {
			listComments: 0,
			createComment: 0,
			updateComment: 0,
			postedBody: undefined,
		} );
		assert.equal( getOutput( 'comment-body' ), expectedMessage );
	} );

	it( 'outputs an empty body when there are no contributors', async () => {
		const { gh, calls } = createGitHub();

		await gh.commentProps( { context, contributorsList: undefined } );

		assert.equal( calls.createComment, 0 );
		assert.equal( getOutput( 'comment-body' ), '' );
	} );

	it( 'fails when the comment cannot be posted and `fail-on-error` is true', async () => {
		process.env[ 'INPUT_FAIL-ON-ERROR' ] = 'true';
		const { gh } = createGitHub();
		gh.octokit.rest.issues.createComment = () => {
			throw new Error( 'Resource not accessible by integration' );
		};

		await assert.rejects(
			gh.commentProps( { context, contributorsList } ),
			{
				message:
					'Error creating comment: Resource not accessible by integration',
			}
		);
	} );

	it( 'does not fail when the comment cannot be posted by default', async () => {
		const { gh } = createGitHub();
		gh.octokit.rest.issues.createComment = () => {
			throw new Error( 'Resource not accessible by integration' );
		};

		await gh.commentProps( { context, contributorsList } );

		assert.equal( getOutput( 'comment-body' ), expectedMessage );
	} );
} );

describe( 'getContributorData', () => {
	beforeEach( () => {
		process.env.INPUT_TOKEN = 'token';
	} );

	afterEach( () => {
		delete process.env.INPUT_TOKEN;
	} );

	const options = {
		owner: 'WordPress',
		repo: 'props-bot-action',
		prNumber: 1,
	};

	/**
	 * Builds a connection page as returned by the API.
	 *
	 * @param {Object[]} nodes        The nodes on the page.
	 * @param {string}   [nextCursor] The cursor of the next page. The page is the last one when omitted.
	 *
	 * @return {Object} The connection page.
	 */
	function page( nodes, nextCursor ) {
		return {
			nodes,
			pageInfo: {
				hasNextPage: undefined !== nextCursor,
				endCursor: nextCursor ?? null,
			},
		};
	}

	/**
	 * Builds a linked issue with a page of comments.
	 *
	 * @param {string}   id           The issue's node ID.
	 * @param {Object[]} comments     The comments on the first page.
	 * @param {string}   [nextCursor] The cursor of the next page of comments.
	 *
	 * @return {Object} The linked issue.
	 */
	function issue( id, comments, nextCursor ) {
		return {
			id,
			author: { __typename: 'User', login: `${ id }-reporter` },
			comments: page( comments, nextCursor ),
		};
	}

	/**
	 * Builds a pull request commit with a page of authors.
	 *
	 * @param {string}   id           The commit's node ID.
	 * @param {Object[]} authors      The authors on the first page.
	 * @param {string}   [nextCursor] The cursor of the next page of authors.
	 *
	 * @return {Object} The pull request commit.
	 */
	function commit( id, authors, nextCursor ) {
		return { commit: { id, authors: page( authors, nextCursor ) } };
	}

	/**
	 * Builds a GitHub instance whose GraphQL requests are answered from a map of
	 * follow-up pages, and records each request made.
	 *
	 * @param {Object} pullRequest The pull request returned by the first request.
	 * @param {Object} pages       Follow-up pages, keyed by `<node ID> <field> <cursor>`.
	 *
	 * @return {Object} The instance and the recorded requests.
	 */
	function createGitHubWithPages( pullRequest, pages = {} ) {
		const gh = new GitHub();
		const requests = [];

		gh.octokit = {
			graphql: async ( query, variables ) => {
				if ( undefined !== variables.prNumber ) {
					requests.push( 'pull request' );
					return { repository: { pullRequest } };
				}

				const [ , type, field ] = query.match(
					/\.\.\. on (\w+) \{\s*(\w+)\(first: 100, after: \$cursor\)/
				);
				const key = `${ variables.id } ${ field } ${ variables.cursor }`;
				requests.push( `${ type } ${ key }` );

				return { node: { [ field ]: pages[ key ] } };
			},
		};

		return { gh, requests };
	}

	/**
	 * Builds a pull request whose connections each fit on one page.
	 *
	 * @param {Object} [connections] Connections to use instead of the empty ones.
	 *
	 * @return {Object} The pull request.
	 */
	function buildPullRequest( connections = {} ) {
		return {
			id: 'PR',
			commits: page( [] ),
			reviews: page( [] ),
			comments: page( [] ),
			closingIssuesReferences: page( [] ),
			...connections,
		};
	}

	it( 'makes a single request when everything fits on one page', async () => {
		const data = buildPullRequest( {
			comments: page( [ { body: 'one' } ] ),
			closingIssuesReferences: page( [
				issue( 'I1', [ { body: 'a' } ] ),
			] ),
		} );
		const { gh, requests } = createGitHubWithPages( data );

		assert.equal( await gh.getContributorData( options ), data );
		assert.deepEqual( requests, [ 'pull request' ] );
	} );

	it( 'fetches the remaining pages of each pull request list in order', async () => {
		const { gh, requests } = createGitHubWithPages(
			buildPullRequest( {
				commits: page( [ commit( 'C1', [] ) ], 'c1' ),
				comments: page( [ 'comment 1' ], 'm1' ),
			} ),
			{
				'PR commits c1': page( [ commit( 'C2', [] ) ] ),
				'PR comments m1': page( [ 'comment 2' ], 'm2' ),
				'PR comments m2': page( [ 'comment 3' ] ),
			}
		);

		const data = await gh.getContributorData( options );

		assert.deepEqual(
			data.commits.nodes.map( ( node ) => node.commit.id ),
			[ 'C1', 'C2' ]
		);
		assert.deepEqual( data.comments.nodes, [
			'comment 1',
			'comment 2',
			'comment 3',
		] );
		assert.deepEqual( requests, [
			'pull request',
			'PullRequest PR commits c1',
			'PullRequest PR comments m1',
			'PullRequest PR comments m2',
		] );
	} );

	it( 'fetches the remaining comments of linked issues, including issues on later pages', async () => {
		const { gh, requests } = createGitHubWithPages(
			buildPullRequest( {
				closingIssuesReferences: page(
					[ issue( 'I1', [ 'I1 comment 1' ], 'a1' ) ],
					'i1'
				),
			} ),
			{
				'PR closingIssuesReferences i1': page( [
					issue( 'I2', [ 'I2 comment 1' ], 'b1' ),
				] ),
				'I1 comments a1': page( [ 'I1 comment 2' ] ),
				'I2 comments b1': page( [ 'I2 comment 2' ] ),
			}
		);

		const data = await gh.getContributorData( options );

		assert.deepEqual(
			data.closingIssuesReferences.nodes.map(
				( { comments } ) => comments.nodes
			),
			[
				[ 'I1 comment 1', 'I1 comment 2' ],
				[ 'I2 comment 1', 'I2 comment 2' ],
			]
		);
		assert.deepEqual( requests, [
			'pull request',
			'PullRequest PR closingIssuesReferences i1',
			'Issue I1 comments a1',
			'Issue I2 comments b1',
		] );
	} );

	it( 'fetches the remaining authors of commits, including commits on later pages', async () => {
		const { gh, requests } = createGitHubWithPages(
			buildPullRequest( {
				commits: page(
					[ commit( 'C1', [ 'C1 author 1' ], 'a1' ) ],
					'c1'
				),
			} ),
			{
				'PR commits c1': page( [
					commit( 'C2', [ 'C2 author 1' ], 'b1' ),
				] ),
				'C1 authors a1': page( [ 'C1 author 2' ] ),
				'C2 authors b1': page( [ 'C2 author 2' ] ),
			}
		);

		const data = await gh.getContributorData( options );

		assert.deepEqual(
			data.commits.nodes.map( ( node ) => node.commit.authors.nodes ),
			[
				[ 'C1 author 1', 'C1 author 2' ],
				[ 'C2 author 1', 'C2 author 2' ],
			]
		);
		assert.deepEqual( requests, [
			'pull request',
			'PullRequest PR commits c1',
			'Commit C1 authors a1',
			'Commit C2 authors b1',
		] );
	} );
} );

describe( 'hasWriteAccess', () => {
	beforeEach( () => {
		process.env.INPUT_TOKEN = 'token';
	} );

	afterEach( () => {
		delete process.env.INPUT_TOKEN;
	} );

	/**
	 * Builds a GitHub instance whose permission lookup resolves or rejects as given.
	 *
	 * @param {() => Promise<Object>} getCollaboratorPermissionLevel The stubbed lookup.
	 *
	 * @return {GitHub} The instance.
	 */
	function createGitHubWithPermission( getCollaboratorPermissionLevel ) {
		const gh = new GitHub();
		gh.octokit = { rest: { repos: { getCollaboratorPermissionLevel } } };
		return gh;
	}

	const options = {
		owner: 'WordPress',
		repo: 'props-bot-action',
		username: 'someone',
	};

	it( 'grants access for write and admin permission only', async () => {
		for ( const [ permission, expected ] of [
			[ 'admin', true ],
			[ 'write', true ],
			[ 'read', false ],
			[ 'none', false ],
		] ) {
			const gh = createGitHubWithPermission( async () => ( {
				data: { permission },
			} ) );

			assert.equal(
				await gh.hasWriteAccess( options ),
				expected,
				permission
			);
		}
	} );

	it( 'denies access when there is no such user', async () => {
		const gh = createGitHubWithPermission( async () => {
			throw Object.assign( new Error( 'Not Found' ), { status: 404 } );
		} );

		assert.equal( await gh.hasWriteAccess( options ), false );
	} );

	it( 'fails instead of dropping commands when the check errors', async () => {
		const gh = createGitHubWithPermission( async () => {
			throw Object.assign( new Error( 'Server Error' ), { status: 502 } );
		} );

		await assert.rejects( gh.hasWriteAccess( options ), /Server Error/ );
	} );
} );
