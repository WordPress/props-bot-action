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
	 * @param {string} contributorsList The list of contributors.
	 */
	async commentProps({ context, contributorsList }) {
		if (!contributorsList) {
			core.info("No contributors list provided.");
			return;
		}

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

		const commentMessage =
		"Here is a list of everyone that appears to have contributed to this PR and any linked issues:\n\n" +
		"```\n" +
		contributorsList +
		"\n```";

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
