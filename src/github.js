import * as core from "@actions/core";
import * as github from "@actions/github";

export default class GitHub {
	constructor() {
		const token = core.getInput("token") || process.env.GITHUB_TOKEN || "";
		this.octokit = github.getOctokit(token);
	}

	/**
   * Sanitizes a string for a GraphQL query.
   *
   * @param string
   * @returns string
   */
	escapeForGql(string) {
		return "_" + string.replace(/[./-]/g, "_");
	}

	/**
	 * Gets the contribution data for a given PR.
	 * Fetch the following data for the pull request:* - Commits with author details.
	 * - Reviews with author logins.
	 * - Comments with author logins.
	 * - Linked issues with author logins.
	 * - Comments on linked issues with author logins.
	 *
	 * @param {string} owner The owner of the repository.
	 * @param {string} repo The name of the repository.
	 * @param {number} prNumber The PR number.
	 *
	 * @returns {Promise<Object>} The PR contribution data.
	 */
	async getContributorData({ owner, repo, prNumber }) {
		core.info('Gathering contributor list.');

		const data = await this.octokit.graphql(
			`query($owner:String!, $name:String!, $prNumber:Int!) {
				repository(owner:$owner, name:$name) {
					pullRequest(number:$prNumber) {
						commits(first: 100) {
							nodes {
								commit {
									author {
										user {
											databaseId
											login
											name
											email
										}
										name
										email
									}
								}
							}
						}
						reviews(first: 100) {
							nodes {
								author {
									login
								}
							}
						}
						comments(first: 100) {
							nodes {
								author {
									login
								}
							}
						}
						closingIssuesReferences(first:100){
							nodes {
								author {
									login
								}
								comments(first:100) {
									nodes {
										author {
											login
										}
									}
								}
							}
						}
					}
				}
			}`,
			{ owner, name: repo, prNumber }
		);

		return data?.repository?.pullRequest;
	}

	/**
	 * Gets the user data for a given array of usernames.
	 *
	 * @param {string[]} users The array of usernames.
	 * @returns {Promise<Object>} The user data.
	 */
	async getUsersData(users = []) {
		const userData = await this.octokit.graphql(
			"{" +
			users.map(
				(user) => this.escapeForGql(user) + `: user(login: "${user}") {databaseId, login, name, email}`
			) +
			"}"
		);
		return userData;
	}

	/**
	 * Adds a comment to a PR with the list of contributors.
	 * - If a comment already exists, it will be updated.
	 *
	 * @param {Object} context The GitHub context.
	 * @param {array} contributorsList The list of contributors.
	 */
	async commentProps({ context, contributorsList }) {
		if (!contributorsList) {
			core.info("No contributors were provided.");
			return;
		}

		core.debug( "Contributor list received:" );
		core.debug( contributorsList );

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

		let commentMessage = "The following accounts have interacted with this PR and/or linked issues. I will continue to update these lists as activity occurs. You can also manually ask me to refresh this list by adding the `props-bot` label.\n\n";

		if ( contributorsList['unlinked'].length > 0 ) {
			commentMessage += "## Unlinked Accounts\n\n" +
				"The following contributors have not linked their GitHub and WordPress.org accounts: @" + contributorsList['unlinked'].join(', @') + ".\n\n" +
				"Contributors, please [read how to link your accounts](https://make.wordpress.org/core/2020/03/19/associating-github-accounts-with-wordpress-org-profiles/) to ensure your work is properly credited in WordPress releases.\n\n";
		}

		commentMessage += "## Core SVN\n\n" +
		"If you're a Core Committer, use this list when committing to `wordpress-develop` in SVN:\n" +
		"```\n" +
		"Props: " + contributorsList['svn'].join(', ') + "." +
		"\n```\n\n" +
		"## GitHub Merge commits\n\n" +
		"If you're merging code through a pull request on GitHub, copy and paste the following into the bottom of the merge commit message.\n\n" +
		"```\n";

		if ( contributorsList['unlinked'].length > 0 ) {
			commentMessage += "Unlinked contributors: " + contributorsList['unlinked'].join(', ') + ".\n\n";
		}

		commentMessage += contributorsList['coAuthored'].join("\n") +
		"\n```\n\n" +
		"**To understand the WordPress project's expectations around crediting contributors, please [review the core handbook](https://make.wordpress.org/core/handbook/).**\n";

		const comment = {
			...commentInfo,
			body: commentMessage,
		};

		const comments = (await this.octokit.rest.issues.listComments(commentInfo))
			.data;
		for (const currentComment of comments) {
			if (
				currentComment.user.type === "Bot" &&
				currentComment.body.includes( 'The following accounts have interacted with this PR and/or linked issues.' )
			) {
				commentId = currentComment.id;
				break;
			}
		}

		if (commentId) {
			core.info(`Updating previous comment #${commentId}`);
			try {
				await this.octokit.rest.issues.updateComment({
					...context.repo,
					comment_id: commentId,
					body: comment.body,
				});
			} catch (e) {
				core.info("Error editing previous comment: " + e.message);
				commentId = null;
			}
		}

		// No previous or edit comment failed.
		if (!commentId) {
			core.info("Creating new comment");
			try {
				await this.octokit.rest.issues.createComment(comment);
			} catch (e) {
				core.error(`Error creating comment: ${e.message}`);
			}
		}
	}
}
