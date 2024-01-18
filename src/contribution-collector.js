import * as core from "@actions/core";
import * as github from "@actions/github";
import GitHub from "./github.js";
import { getWPOrgData } from "./utils.js";

const { context } = github;
const gh = new GitHub();
const owner = context.repo.owner;
const repo = context.repo.repo;
let prNumber = context.payload?.pull_request?.number;
if ( 'issue_comment' === context.eventName ) {
	prNumber = context.payload?.issue?.number;
}

/**
 * Types of contributions collected.
 *
 * @type {string[]}
 */
const contributorTypes = ["committers", "reviewers", "commenters", "reporters", "unlinked"];

/**
 * List of user data objects.
 *
 * @type {*[]}
 */
const userData = [];

/**
 * A list of contributors grouped by the type of contribution.
 *
 * @type {*[]}
 */
const contributors = contributorTypes.reduce((acc, type) => {
	acc[type] = new Set();
	return acc;
}, {});

export async function run() {
	// Get a list of contributors.
	const contributorsList = await getContributorsList();

	// Comment on the pull request.
	await gh.commentProps({
		context,
		contributorsList,
	});
}

/**
 * Prepares a list of contributors for a pull request.
 * - Collects user data from GitHub.
 * - Collects user data from WordPress.org.
 * - Generates a list of contributors.
 *
 * @returns {Promise<string>}
 */
export async function getContributorsList() {
	const contributorData = await gh.getContributorData({
		owner,
		repo,
		prNumber,
	});

	core.debug('Raw contributor data:');
	core.debug(contributorData);

	// Process pull request commits.
	for (const commit of contributorData?.commits?.nodes || []) {
		/*
		 * Commits are sometimes made by an email that is not associated with a GitHub account.
		 * For these, info that may help us guess later.
		 */
		if (null === commit.commit.author.user) {
			contributors.committers.add(commit.commit.author.email);
			userData[commit.commit.author.email] = {
				name: commit.commit.author.name,
				email: commit.commit.author.email,
			};
		} else {
			if (skipUser(commit.commit.author.user.login)) {
				continue;
			}

			contributors.committers.add(commit.commit.author.user.login);
			userData[commit.commit.author.user.login] = commit.commit.author.user;
		}
	}

	core.debug('Committers:');
	core.debug(contributors.committers);

	// Process pull request reviews.
	contributorData.reviews.nodes
		.filter((review) => !skipUser(review.author.login))
		.forEach((review) => contributors.reviewers.add(review.author.login));

	core.debug('Reviewers:');
	core.debug(contributors.reviewers);

	// Process pull request comments.
	contributorData.comments.nodes
		.filter((comment) => !skipUser(comment.author.login))
		.forEach((comment) => contributors.commenters.add(comment.author.login));

	core.debug('Commenters:');
	core.debug(contributors);
	core.debug(contributors.commenters);

	// Process reporters and commenters for linked issues.
	for (const linkedIssue of contributorData.closingIssuesReferences.nodes) {
		if (!skipUser(linkedIssue.author.login)) {
			contributors.reporters.add(linkedIssue.author.login);
		}

		for (const issueComment of linkedIssue.comments.nodes) {
			if (skipUser(issueComment.author.login)) {
				continue;
			}

			contributors.commenters.add(issueComment.author.login);
		}
	}

	core.debug('Reporters:');
	core.debug(contributors.reporters);

	core.debug('Commenters (including linked issues):');
	core.debug(contributors.commenters);

	// We already have user info for committers, we need to grab it for everyone else.
	if (
		[
			...contributors.reviewers,
			...contributors.commenters,
			...contributors.reporters,
		].length > 0
	) {
		const contributorData = await gh.getUsersData([
			...contributors.reviewers,
			...contributors.commenters,
			...contributors.reporters,
		]);

		Object.values(contributorData).forEach((user) => {
			userData[user.login] = user;
		});
	}

	const githubUsers = [];
	Object.keys(contributors).forEach((key) => {
		contributors[key].forEach((contributor) => {
			githubUsers.push(contributor);
		});
	});

	// No contributors were gathered.
	if (githubUsers.length == 0) {
		core.info('No contributors found.');
		return;
	} else {
		core.debug('GitHub contributor usernames:');
		core.debug(githubUsers);
	}

	// List to return from the function.
	const contributorLists = [];
	contributorLists['github'] = [];

	// Collect WordPress.org usernames
	const wpOrgData = await getWPOrgData(githubUsers);
	contributorLists['svn'] = [];

	core.debug('WordPress.org raw data:');
	core.debug(wpOrgData);

	// Add each contributor's wp.org username to their user data.
	Object.keys(userData).forEach((contributor) => {
		if (
			Object.prototype.hasOwnProperty.call(wpOrgData, contributor) &&
			wpOrgData[contributor] !== false
		) {
			userData[contributor].dotOrg = wpOrgData[contributor].slug;
			contributorLists['svn'].push(wpOrgData[contributor].slug);
		}
	});

	contributorLists['coAuthored'] = [];
	contributorLists['unlinked'] = [];

	contributorTypes
		.map((priority) => {
			// Skip an empty set of contributors.
			if (contributors[priority].length === 0) {
				return [];
			}

			[...contributors[priority]]
				.map((username) => {
					if ('unlinked' == priority) {
						core.debug( 'Unlinked contributor: ' + username );
						return;
					}

					const { dotOrg } = userData[username];
					if (
						!Object.prototype.hasOwnProperty.call(
							userData[username],
							"dotOrg"
						)
					) {
						contributorLists['unlinked'].push(username);
						return;
					}

					return contributorLists['coAuthored'].push( `Co-Authored-By: ${username} <${dotOrg}@git.wordpress.org>` );
				})
				.filter((el) => el);
		});

	core.debug( contributorLists );

	return contributorLists;
}

/**
 * Checks if a user should be skipped.
 *
 * @param {string} username Username to check.
 *
 * @return {boolean} true if the username should be skipped. false otherwise.
 */
function skipUser(username) {
	const skippedUsers = ["github-actions"];

	if (
		-1 === skippedUsers.indexOf(username) &&
       !contributorAlreadyPresent(username)
	) {
		return false;
	}

	return true;
}

/**
 * Checks if a user has already been added to the list of contributors to receive props.
 *
 * Contributors should only appear in the props list once, even when contributing in multiple ways.
 *
 * @param {string} username The username to check.
 *
 * @return {boolean} true if the username is already in the list. false otherwise.
 */
function contributorAlreadyPresent(username) {
	for (const contributorType of contributorTypes) {
		if (contributors[contributorType].has(username)) {
			return true;
		}
	}
}
