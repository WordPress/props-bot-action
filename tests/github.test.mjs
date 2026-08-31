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
	'The following accounts have interacted with this PR and/or linked issues. I will continue to update these lists as activity occurs. You can also manually ask me to refresh this list by adding the `props-bot` label.\n\n' +
	'## Core SVN\n\n' +
	'Core Committers: Use this line as a base for the props when committing in SVN:\n' +
	'```\nProps dotorguser.\n```\n\n' +
	'## GitHub Merge commits\n\n' +
	"If you're merging code through a pull request on GitHub, copy and paste the following into the bottom of the merge commit message.\n\n" +
	'```\nCo-authored-by: someone <dotorguser@git.wordpress.org>\n```\n\n' +
	"**To understand the WordPress project's expectations around crediting contributors, please [review the Contributor Attribution page in the Core Handbook](https://make.wordpress.org/core/handbook/best-practices/contributor-attribution-props/).**\n";

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
} );
