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
		core.debug( contributorsList.svn );
		console.debug( contributorsList );

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

		let commentMessage = "Hello contributors!\n\n" +
		"I've collected a list of people who have interacted in some way with this pull request or any linked issues. I'll continue to update this list as activity occurs.\n\n";

		if ( contributorsList['unlinked'].length > 0 ) {
			commentMessage += "## Unlinked Accounts\n\n" +
				"It appears there are some GitHub contributors participating here that have not linked their WordPress.org accounts.\n\n" +
				"@" + contributorsList['unlinked'].join(', @') + ": Thank you for your contribution to this repository!\n\n" +
				"The WordPress project gives contributors attribution through the [WordPress.org Credits API](https://api.wordpress.org/core/credits/1.1/). However, attribution can only be given to a WordPress.org account." +
				"Please take a moment to connect your GitHub and WordPress.org accounts when you have a moment so that your contribution can be properly recognized. You'll find [step by step instructions on the Making WordPress Core blog](https://make.wordpress.org/core/2020/03/19/associating-github-accounts-with-wordpress-org-profiles/).\n\n";
		}

		commentMessage += "**Reminder: giving props is mandatory for any repository under the WordPress organization if you are a project maintainer or committer**.\n\n" +
		"Here is a contributor list formatted in a few ways.:\n\n" +
		"## Core SVN\n\n" +
		"If you're a Core Committer, use this list when committing to `wordpress-develop` in SVN:\n" +
		"```\n" +
		"Props: " + contributorsList['svn'].join(', ') + "." +
		"\n```\n\n" +
		"## GitHub Merge commits\n\n" +
		"If you're merging code through a pull request on GitHub, copy and paste the following into the bottom of the merge commit message.\n\n" +
		"```\n" +
		"Unlinked contributors: " + contributorsList['unlinked'].join(', ') + ".\n\n" +
		contributorsList['coAuthored'].join("\n") +
		"\n```\n\n" +
		"**Important notes**:" +
			"- The list of `Co-Authored-By:` trailers must be preceded by a blank line.\n" +
			"- Usernames must not start with an `@`.\n" +
			"- Nothing can come after the `Co-Authored-By:` trailers.\n" +
			"- Please include the list of unlinked contributors. If they do connect their GitHub and WordPress.org accounts in the future, this contribution can be credited to them later.\n" +
			"- Merging contributors should remove themselves from the list. As the merging contributor, props will be given for being the author of the merge commit.\n" +
			"- As always, please manually review this list. [Give props liberally](https://make.wordpress.org/core/handbook/best-practices/commit-messages/#props), but remove anyone users who spammed or did not contribute positively.\n" +
			"- If you're unsure, please ask in the [#core-committers channel in Slack](https://wordpress.slack.com/archives/C18723MQ8).\n";

		const comment = {
			...commentInfo,
			body: commentMessage + "\n\n<sub>props-bot-action</sub>",
		};

		const comments = (await this.octokit.rest.issues.listComments(commentInfo))
			.data;
		for (const currentComment of comments) {
			if (
				currentComment.user.type === "Bot" &&
				/<sub>[\s\n]*props-bot-action/.test(currentComment.body)
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
