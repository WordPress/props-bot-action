import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import GitHub, { COMMENT_MARKER } from '../src/github.js';

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
 * The message `contributorsList` renders to with `format: all`, split at the
 * intro. Asserted in full so a change to any part has to be made deliberately.
 */
const intro =
	'The following accounts have interacted with this PR and/or linked issues. I will continue to update these lists as activity occurs. You can also manually ask me to refresh this list by adding the `props-bot` label.\n\n';

const expectedList =
	'## Core SVN\n\n' +
	'Core Committers: Use this line as a base for the props when committing in SVN:\n' +
	'```\nProps dotorguser.\n```\n\n' +
	'## GitHub Merge commits\n\n' +
	"If you're merging code through a pull request on GitHub, copy and paste the following into the bottom of the merge commit message.\n\n" +
	'```\nCo-authored-by: someone <dotorguser@git.wordpress.org>\n```\n\n' +
	"**To understand the WordPress project's expectations around crediting contributors, please [review the Contributor Attribution page in the Core Handbook](https://make.wordpress.org/core/handbook/best-practices/contributor-attribution-props/).**\n";

const expectedMessage = intro + expectedList;

const expectedPostedBody = `${ COMMENT_MARKER }\n${ expectedMessage }`;

let outputDir;
let outputFile;

/**
 * Sets an action input, or unsets it when the value is undefined.
 *
 * @param {string}           name  The input name.
 * @param {string|undefined} value The input value.
 */
function setInput( name, value ) {
	const key = `INPUT_${ name.toUpperCase() }`;

	if ( undefined === value ) {
		delete process.env[ key ];
	} else {
		process.env[ key ] = value;
	}
}

/**
 * Builds a GitHub instance with a stubbed Octokit that records the calls made
 * to the comment endpoints, along with the body they were given.
 *
 * @param {Object} [options]                  Options.
 * @param {string} [options.postComment]      The `post-comment` input. Unset when omitted.
 * @param {string} [options.includeIntro]     The `include-intro` input. Unset when omitted.
 * @param {Array}  [options.existingComments] Comments already on the pull request.
 *
 * @return {Object} The instance and the recorded calls.
 */
function createGitHub( {
	postComment,
	includeIntro,
	existingComments = [],
} = {} ) {
	setInput( 'post-comment', postComment );
	setInput( 'include-intro', includeIntro );

	const gh = new GitHub();
	const calls = {
		listComments: 0,
		createComment: 0,
		updateComment: 0,
		updatedCommentId: undefined,
		postedBody: undefined,
	};

	gh.octokit = {
		paginate: {
			iterator: () => {
				calls.listComments++;
				return [ { data: existingComments } ];
			},
		},
		rest: {
			issues: {
				listComments: () => {},
				createComment: ( { body } ) => {
					calls.createComment++;
					calls.postedBody = body;
				},
				updateComment: ( { comment_id: commentId, body } ) => {
					calls.updateComment++;
					calls.updatedCommentId = commentId;
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
		delete process.env[ 'INPUT_INCLUDE-INTRO' ];
	} );

	it( 'posts the comment with the marker by default and outputs the body without it', async () => {
		const { gh, calls } = createGitHub();

		assert.equal( gh.postComment, true );

		await gh.commentProps( { context, contributorsList } );

		assert.equal( calls.createComment, 1 );
		assert.equal( calls.postedBody, expectedPostedBody );
		assert.equal( getOutput( 'comment-body' ), expectedMessage );
	} );

	it( 'updates a comment identified by the marker', async () => {
		const { gh, calls } = createGitHub( {
			existingComments: [
				{ id: 1, user: { type: 'Bot' }, body: 'Unrelated.' },
				{
					id: 2,
					user: { type: 'Bot' },
					body: `${ COMMENT_MARKER }\nOld.`,
				},
			],
		} );

		await gh.commentProps( { context, contributorsList } );

		assert.equal( calls.createComment, 0 );
		assert.equal( calls.updatedCommentId, 2 );
		assert.equal( calls.postedBody, expectedPostedBody );
	} );

	it( 'updates a comment posted before the marker existed', async () => {
		const { gh, calls } = createGitHub( {
			existingComments: [
				{ id: 3, user: { type: 'Bot' }, body: expectedMessage },
			],
		} );

		await gh.commentProps( { context, contributorsList } );

		assert.equal( calls.createComment, 0 );
		assert.equal( calls.updatedCommentId, 3 );
	} );

	it( 'does not update a comment that only embeds the message', async () => {
		const { gh, calls } = createGitHub( {
			existingComments: [
				{
					id: 4,
					user: { type: 'Bot' },
					body: `## Automation\n\n${ expectedMessage }`,
				},
				{ id: 5, user: { type: 'User' }, body: expectedPostedBody },
			],
		} );

		await gh.commentProps( { context, contributorsList } );

		assert.equal( calls.updateComment, 0 );
		assert.equal( calls.createComment, 1 );
	} );

	it( 'outputs the body without posting when `post-comment` is false', async () => {
		const { gh, calls } = createGitHub( { postComment: 'false' } );

		assert.equal( gh.postComment, false );

		await gh.commentProps( { context, contributorsList } );

		assert.deepEqual( calls, {
			listComments: 0,
			createComment: 0,
			updateComment: 0,
			updatedCommentId: undefined,
			postedBody: undefined,
		} );
		assert.equal( getOutput( 'comment-body' ), expectedMessage );
	} );

	it( 'omits the intro when `include-intro` is false and nothing is posted', async () => {
		const { gh } = createGitHub( {
			postComment: 'false',
			includeIntro: 'false',
		} );

		await gh.commentProps( { context, contributorsList } );

		assert.equal( getOutput( 'comment-body' ), expectedList );
	} );

	it( 'keeps the intro in a posted comment when `include-intro` is false', async () => {
		const { gh, calls } = createGitHub( { includeIntro: 'false' } );

		await gh.commentProps( { context, contributorsList } );

		assert.equal( calls.postedBody, expectedPostedBody );
		assert.equal( getOutput( 'comment-body' ), expectedMessage );
	} );

	it( 'outputs an empty body when there are no contributors', async () => {
		const { gh, calls } = createGitHub();

		await gh.commentProps( { context, contributorsList: undefined } );

		assert.equal( calls.createComment, 0 );
		assert.equal( getOutput( 'comment-body' ), '' );
	} );
} );
