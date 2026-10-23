import * as core from '@actions/core';
import * as github from '@actions/github';

/**
 * The fields fetched for the author of a review, comment, or linked issue.
 *
 * @type {string}
 */
const authorFields = 'author { __typename login }';

/**
 * The fields fetched for each author of a commit.
 *
 * @type {string}
 */
const commitAuthorFields = `user { __typename databaseId login name email }
	name
	email`;

/**
 * The fields fetched for each node of the pull request connections that
 * contributors are collected from, keyed by connection field.
 *
 * @type {Object<string, string>}
 */
const pullRequestConnections = {
	commits: `commit {
		id
		${ connectionQuery( 'authors', commitAuthorFields ) }
	}`,
	reviews: authorFields,
	comments: `${ authorFields } body`,
	closingIssuesReferences: `id
		${ authorFields }
		${ connectionQuery( 'comments', authorFields ) }`,
};

/**
 * Builds the query for one page of a connection, including its page info.
 *
 * @param {string}  field         The name of the connection field.
 * @param {string}  nodeFields    The fields to fetch for each node.
 * @param {boolean} [afterCursor] Whether to start after the `$cursor` variable.
 *
 * @return {string} The connection query.
 */
function connectionQuery( field, nodeFields, afterCursor = false ) {
	return `${ field }(first: 100${ afterCursor ? ', after: $cursor' : '' }) {
		nodes { ${ nodeFields } }
		pageInfo { hasNextPage endCursor }
	}`;
}

export default class GitHub {
	constructor() {
		const token =
			core.getInput( 'token' ) || process.env.GITHUB_TOKEN || '';
		this.octokit = github.getOctokit( token );

		const formats = core
			.getInput( 'format' )
			.replace( / /g, '' )
			.split( ',' )
			.filter( ( value ) => {
				return value.trim();
			} );

		if ( formats.length === 0 ) {
			this.format = [ 'git' ];
		} else if ( formats.includes( 'all' ) ) {
			this.format = [ 'git', 'svn' ];
		} else if ( formats.includes( 'svn' ) || formats.includes( 'git' ) ) {
			this.format = formats;
		} else {
			core.error( 'A valid props format was not provided.' );
		}

		/*
		 * `getBooleanInput()` throws on an empty value, which happens when a
		 * caller passes the input explicitly without a value.
		 */
		this.postComment =
			core.getInput( 'post-comment' ) === '' ||
			core.getBooleanInput( 'post-comment' );

		this.failOnError =
			core.getInput( 'fail-on-error' ) !== '' &&
			core.getBooleanInput( 'fail-on-error' );
	}

	/**
	 * Gets the contribution data for a given PR.
	 *
	 * Fetch the following data for the pull request:
	 * - Commits with the details of their authors, including co-authors
	 *   credited through `Co-authored-by` trailers.
	 * - Reviews with author logins and account types.
	 * - Comments with author logins, account types, and bodies.
	 * - Linked issues with author logins and account types.
	 * - Comments on linked issues with author logins and account types.
	 *
	 * Everything fits in a single request for most pull requests. Any list
	 * with more than one page is completed with follow-up requests, keeping
	 * its nodes in order.
	 *
	 * @param {Object} options          The options for getting the contribution data.
	 * @param {string} options.owner    The owner of the repository.
	 * @param {string} options.repo     The name of the repository.
	 * @param {number} options.prNumber The PR number.
	 *
	 * @return {Promise<Object>} The PR contribution data.
	 */
	async getContributorData( { owner, repo, prNumber } ) {
		core.info( 'Gathering contributor list.' );

		const connections = Object.entries( pullRequestConnections )
			.map( ( [ field, nodeFields ] ) =>
				connectionQuery( field, nodeFields )
			)
			.join( '\n' );

		const data = await this.octokit.graphql(
			`query($owner:String!, $name:String!, $prNumber:Int!) {
				repository(owner:$owner, name:$name) {
					pullRequest(number:$prNumber) {
						id
						${ connections }
					}
				}
			}`,
			{ owner, name: repo, prNumber }
		);

		const pullRequest = data?.repository?.pullRequest;
		if ( ! pullRequest ) {
			return pullRequest;
		}

		for ( const [ field, nodeFields ] of Object.entries(
			pullRequestConnections
		) ) {
			await this.fetchRemainingPages( pullRequest[ field ], {
				id: pullRequest.id,
				type: 'PullRequest',
				field,
				nodeFields,
			} );
		}

		// Runs once all commits and linked issues are in, since those on later pages can have more authors or comments too.
		for ( const { commit } of pullRequest.commits.nodes ) {
			await this.fetchRemainingPages( commit.authors, {
				id: commit.id,
				type: 'Commit',
				field: 'authors',
				nodeFields: commitAuthorFields,
			} );
		}

		for ( const issue of pullRequest.closingIssuesReferences.nodes ) {
			await this.fetchRemainingPages( issue.comments, {
				id: issue.id,
				type: 'Issue',
				field: 'comments',
				nodeFields: authorFields,
			} );
		}

		return pullRequest;
	}

	/**
	 * Fetches the remaining pages of a connection and appends their nodes to it.
	 *
	 * @param {Object} connection         The connection, with its first page of nodes and its `pageInfo`.
	 * @param {Object} options            The options for fetching the pages.
	 * @param {string} options.id         The global node ID of the object the connection belongs to.
	 * @param {string} options.type       The GraphQL type of that object.
	 * @param {string} options.field      The name of the connection field.
	 * @param {string} options.nodeFields The fields to fetch for each node.
	 *
	 * @return {Promise<void>} A promise that resolves when every page has been fetched.
	 */
	async fetchRemainingPages( connection, { id, type, field, nodeFields } ) {
		while ( connection.pageInfo?.hasNextPage ) {
			const data = await this.octokit.graphql(
				`query($id:ID!, $cursor:String!) {
					node(id:$id) {
						... on ${ type } {
							${ connectionQuery( field, nodeFields, true ) }
						}
					}
				}`,
				{ id, cursor: connection.pageInfo.endCursor }
			);

			const page = data.node[ field ];
			connection.nodes.push( ...page.nodes );
			connection.pageInfo = page.pageInfo;
		}
	}

	/**
	 * Gets the user data for a single username.
	 *
	 * @param {string} username The username.
	 *
	 * @return {Promise<Object|null>} The user data, or null when there is no such user.
	 */
	async getUser( username ) {
		try {
			const { data } = await this.octokit.rest.users.getByUsername( {
				username,
			} );

			return {
				databaseId: data.id,
				login: data.login,
				name: data.name,
				email: data.email,
				type: data.type,
			};
		} catch ( e ) {
			if ( 404 === e.status ) {
				return null;
			}
			throw e;
		}
	}

	/**
	 * Checks whether a user has write access to a repository.
	 *
	 * @param {Object} options          The options for the check.
	 * @param {string} options.owner    The owner of the repository.
	 * @param {string} options.repo     The name of the repository.
	 * @param {string} options.username The username to check.
	 *
	 * @return {Promise<boolean>} true if the user has write or admin access, false if there is no such user.
	 */
	async hasWriteAccess( { owner, repo, username } ) {
		try {
			const { data } =
				await this.octokit.rest.repos.getCollaboratorPermissionLevel( {
					owner,
					repo,
					username,
				} );

			// `maintain` is reported as `write`.
			return [ 'admin', 'write' ].includes( data.permission );
		} catch ( e ) {
			if ( 404 === e.status ) {
				return false;
			}
			throw e;
		}
	}

	/**
	 * Renders the list of contributors and adds it to a PR as a comment.
	 * - If a comment already exists, it will be updated.
	 * - The rendered message is always exposed through the `comment-body` output.
	 * - When the `post-comment` input is `false`, nothing is posted.
	 *
	 * @param {Object} options                  The options for commenting.
	 * @param {Object} options.context          The context object containing information about the GitHub event.
	 * @param {Object} options.contributorsList The lists of contributors.
	 *
	 * @return {Promise<void>} - A promise that resolves when the comment is posted.
	 */
	async commentProps( { context, contributorsList } ) {
		if ( ! contributorsList ) {
			core.info( 'No contributors were provided.' );
			core.setOutput( 'comment-body', '' );
			return;
		}

		core.debug( 'Contributor list received:' );
		core.debug( contributorsList );

		core.debug( 'Formats requested:' );
		core.debug( this.format );

		let prNumber = context.payload?.pull_request?.number;
		if ( 'issue_comment' === context.eventName ) {
			prNumber = context.payload?.issue?.number;
		}

		let commentId;
		const commentInfo = {
			owner: context.repo.owner,
			repo: context.repo.repo,
			issue_number: prNumber,
		};

		let commentMessage =
			'The following accounts have interacted with this PR and/or linked issues. I will continue to update these lists as activity occurs.\n\n';

		if ( contributorsList.unlinked.length > 0 ) {
			commentMessage +=
				'## Unlinked Accounts\n\n' +
				'The following contributors have not linked their GitHub and WordPress.org accounts: @' +
				contributorsList.unlinked.join( ', @' ) +
				'.\n\n' +
				'Contributors, please [read how to link your accounts](https://make.wordpress.org/core/2020/03/19/associating-github-accounts-with-wordpress-org-profiles/) to ensure your work is properly credited in WordPress releases.\n\n';
		}

		if (
			this.format.includes( 'svn' ) &&
			contributorsList.svn.length > 0
		) {
			if ( this.format.includes( 'git' ) ) {
				commentMessage += '## Core SVN\n\n';
			}

			commentMessage +=
				'Core Committers: Use this line as a base for the props when committing in SVN:\n' +
				'```\n' +
				'Props ' +
				contributorsList.svn.join( ', ' ) +
				'.' +
				'\n```\n\n';
		}

		if ( this.format.includes( 'git' ) ) {
			if ( this.format.includes( 'svn' ) ) {
				commentMessage += '## GitHub Merge commits\n\n';
			}

			commentMessage +=
				"If you're merging code through a pull request on GitHub, copy and paste the following into the bottom of the merge commit message.\n\n" +
				'```\n';

			if ( contributorsList.unlinked.length > 0 ) {
				commentMessage +=
					'Unlinked contributors: ' +
					contributorsList.unlinked.join( ', ' ) +
					'.\n\n';
			}

			if ( contributorsList.coAuthored.length > 0 ) {
				commentMessage += contributorsList.coAuthored.join( '\n' );
			}

			commentMessage += '\n```\n\n';
		}

		// Note that ghosts were detected. Spooky! 👻
		if ( contributorsList.hasGhostActivity ) {
			commentMessage +=
				'At least one `ghost` was discovered. `ghost`s represent deleted GitHub user accounts.\n\n';
		}

		commentMessage +=
			"**To understand the WordPress project's expectations around crediting contributors, please [review the Contributor Attribution page in the Core Handbook](https://make.wordpress.org/core/handbook/best-practices/contributor-attribution-props/).**\n";

		commentMessage +=
			'\n---\n\n<details>\n<summary>Props Bot commands</summary>\n<br />\n\n' +
			'You can trigger Props Bot actions by commenting on this PR:\n\n' +
			'- `@propsbot add <username>` to give props to a GitHub user. Requires write access.\n' +
			'- `@propsbot remove <username>` to leave a user out of the props. Requires write access.\n' +
			'- `@propsbot refresh` to refresh this list. Adding the `props-bot` label works too.\n\n' +
			'</details>\n';

		/*
		 * Set before any API call so consumers receive the message on every
		 * path, including when posting fails.
		 */
		core.setOutput( 'comment-body', commentMessage );

		if ( ! this.postComment ) {
			core.info(
				'Commenting is disabled. The message is available through the `comment-body` output.'
			);
			return;
		}

		const comment = {
			...commentInfo,
			body: commentMessage,
		};

		for await ( const response of this.octokit.paginate.iterator(
			this.octokit.rest.issues.listComments,
			commentInfo
		) ) {
			for ( const currentComment of response.data ) {
				if (
					currentComment.user.type === 'Bot' &&
					currentComment.body.includes(
						'The following accounts have interacted with this PR and/or linked issues.'
					)
				) {
					commentId = currentComment.id;
					break;
				}
			}

			if ( commentId ) {
				break;
			}
		}

		if ( commentId ) {
			core.info( `Updating previous comment #${ commentId }` );

			try {
				await this.octokit.rest.issues.updateComment( {
					...context.repo,
					comment_id: commentId,
					body: comment.body,
				} );
			} catch ( e ) {
				core.info( 'Error editing previous comment: ' + e.message );
				commentId = null;
			}
		}

		// No previous or edit comment failed.
		if ( ! commentId ) {
			core.info( 'No previous comment found. Creating a new one.' );
			try {
				await this.octokit.rest.issues.createComment( comment );
			} catch ( e ) {
				if ( this.failOnError ) {
					throw new Error( `Error creating comment: ${ e.message }` );
				}
				core.error( `Error creating comment: ${ e.message }` );
			}
		}
	}
}
