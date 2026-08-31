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

let outputDir;
let outputFile;

/**
 * Builds a GitHub instance with a stubbed Octokit that records the calls made
 * to the comment endpoints.
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
	const calls = { listComments: 0, createComment: 0, updateComment: 0 };

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
				createComment: () => {
					calls.createComment++;
				},
				updateComment: () => {
					calls.updateComment++;
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

	it( 'posts the comment by default', async () => {
		const { gh, calls } = createGitHub();

		assert.equal( gh.postComment, true );

		await gh.commentProps( { context, contributorsList } );

		assert.equal( calls.createComment, 1 );
		assert.match( getOutput( 'comment-body' ), /Props dotorguser\./ );
	} );

	it( 'sets the output without posting when `post-comment` is false', async () => {
		const { gh, calls } = createGitHub( 'false' );

		assert.equal( gh.postComment, false );

		await gh.commentProps( { context, contributorsList } );

		assert.deepEqual( calls, {
			listComments: 0,
			createComment: 0,
			updateComment: 0,
		} );
		assert.match( getOutput( 'comment-body' ), /Props dotorguser\./ );
	} );

	it( 'sets an empty output when there are no contributors', async () => {
		const { gh, calls } = createGitHub();

		await gh.commentProps( { context, contributorsList: undefined } );

		assert.equal( calls.createComment, 0 );
		assert.equal( getOutput( 'comment-body' ), '' );
	} );
} );
