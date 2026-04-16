import * as core from '@actions/core';
import * as github from '@actions/github';
import GitHub from './github.js';
import { getWPOrgData, parseCoAuthorTrailers } from './utils.js';

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
const contributorTypes = [
	'committers',
	'reviewers',
	'commenters',
	'reporters',
	'unlinked',
];

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
const contributors = contributorTypes.reduce( ( acc, type ) => {
	acc[ type ] = new Set();
	return acc;
}, {} );

export async function run() {
	// Get a list of contributors.
	const contributorsList = await getContributorsList();

	// Comment on the pull request.
	await gh.commentProps( {
		context,
		contributorsList,
	} );
}

/**
 * Prepares a list of contributors for a pull request.
 * - Collects user data from GitHub.
 * - Collects user data from WordPress.org.
 * - Generates a list of contributors.
 *
 * @return {Promise<null|string>} null if no contributors, otherwise an object with lists of contributors.
 * @async
 */
export async function getContributorsList() {
	const contributorData = await gh.getContributorData( {
		owner,
		repo,
		prNumber,
	} );

	core.debug( 'Raw contributor data:' );
	core.debug( contributorData );

	// Keep track of whether the Ghostbusters are needed.
	let hasGhostActivity = false;

	// `Co-authored-by:` trailers whose email did not resolve to a GitHub user.
	const unlinkedCoAuthors = [];

	// Process pull request commits.
	for ( const commit of contributorData?.commits?.nodes || [] ) {
		// Set a trap for some ghosts.
		if ( ! commit.commit.author ) {
			hasGhostActivity = true;
			continue;
		}

		/*
		 * Commits are sometimes made by an email that is not associated with a GitHub account.
		 * For these, info that may help us guess later.
		 */
		if ( null === commit.commit.author.user ) {
			contributors.committers.add( commit.commit.author.email );
			userData[ commit.commit.author.email ] = {
				name: commit.commit.author.name,
				email: commit.commit.author.email,
			};
		} else {
			if ( skipUser( commit.commit.author.user.login ) ) {
				continue;
			}

			contributors.committers.add( commit.commit.author.user.login );
			userData[ commit.commit.author.user.login ] =
				commit.commit.author.user;
		}
	}

	core.debug( 'Committers:' );
	core.debug( contributors.committers );

	// Collect Co-authored-by trailers from commit messages (#86).
	const committerEmails = new Set();
	for ( const commit of contributorData?.commits?.nodes || [] ) {
		const authorEmail =
			commit.commit.author?.user?.email ||
			commit.commit.author?.email ||
			'';
		if ( authorEmail ) {
			committerEmails.add( authorEmail.toLowerCase() );
		}
	}

	const trailersByEmail = new Map();
	for ( const commit of contributorData?.commits?.nodes || [] ) {
		const parsed = parseCoAuthorTrailers( commit.commit?.message || '' );
		for ( const trailer of parsed ) {
			if ( committerEmails.has( trailer.email ) ) {
				continue;
			}
			if ( ! trailersByEmail.has( trailer.email ) ) {
				trailersByEmail.set( trailer.email, trailer );
			}
		}
	}

	if ( trailersByEmail.size > 0 ) {
		core.debug( 'Co-authored-by trailers:' );
		core.debug( [ ...trailersByEmail.values() ] );

		const emailToUser = await gh.getUsersByEmails( [
			...trailersByEmail.keys(),
		] );

		for ( const [ email, trailer ] of trailersByEmail ) {
			const user = emailToUser[ email ];
			if ( user?.login && ! skipUser( user.login ) ) {
				contributors.committers.add( user.login );
				userData[ user.login ] = user;
			} else {
				unlinkedCoAuthors.push( trailer );
			}
		}

		core.debug( 'Committers (incl. co-author trailers):' );
		core.debug( contributors.committers );
	}

	// Process pull request reviews.
	contributorData.reviews.nodes
		.filter( ( review ) => {
			if ( ! review.author ) {
				hasGhostActivity = true;
				return false;
			}
			return ! skipUser( review.author.login );
		} )
		.forEach( ( review ) =>
			contributors.reviewers.add( review.author.login )
		);

	core.debug( 'Reviewers:' );
	core.debug( contributors.reviewers );

	// Process pull request comments.
	contributorData.comments.nodes
		.filter( ( comment ) => {
			if ( ! comment.author ) {
				hasGhostActivity = true;
				return false;
			}
			return ! skipUser( comment.author.login );
		} )
		.forEach( ( comment ) =>
			contributors.commenters.add( comment.author.login )
		);

	core.debug( 'Commenters:' );
	core.debug( contributors.commenters );

	// Process reporters and commenters for linked issues.
	for ( const linkedIssue of contributorData.closingIssuesReferences.nodes ) {
		// Lay a proton trap for any more ghosts.
		if ( ! linkedIssue.author ) {
			hasGhostActivity = true;
		} else if ( ! skipUser( linkedIssue.author.login ) ) {
			contributors.reporters.add( linkedIssue.author.login );
		}

		for ( const issueComment of linkedIssue.comments.nodes ) {
			if (
				! issueComment.author ||
				skipUser( issueComment.author.login )
			) {
				continue;
			}

			contributors.commenters.add( issueComment.author.login );
		}
	}

	core.debug( 'Reporters:' );
	core.debug( contributors.reporters );

	core.debug( 'Commenters (including linked issues):' );
	core.debug( contributors.commenters );

	// We already have user info for committers, we need to grab it for everyone else.
	if (
		[
			...contributors.reviewers,
			...contributors.commenters,
			...contributors.reporters,
		].length > 0
	) {
		const otherContributorData = await gh.getUsersData( [
			...contributors.reviewers,
			...contributors.commenters,
			...contributors.reporters,
		] );

		Object.values( otherContributorData ).forEach( ( user ) => {
			userData[ user.login ] = user;
		} );
	}

	const githubUsers = [];
	Object.keys( contributors ).forEach( ( key ) => {
		contributors[ key ].forEach( ( contributor ) => {
			githubUsers.push( contributor );
		} );
	} );

	// No contributors were gathered.
	if ( githubUsers.length === 0 ) {
		core.info( 'No contributors found.' );
		return;
	}

	core.debug( 'GitHub contributor usernames:' );
	core.debug( githubUsers );

	// List to return from the function.
	const contributorLists = [];
	contributorLists.github = [];

	// Collect WordPress.org usernames
	const wpOrgData = await getWPOrgData( githubUsers );
	contributorLists.svn = [];

	core.debug( 'WordPress.org raw data:' );
	core.debug( wpOrgData );

	// Add each contributor's wp.org username to their user data.
	Object.keys( userData ).forEach( ( contributor ) => {
		if (
			Object.prototype.hasOwnProperty.call( wpOrgData, contributor ) &&
			wpOrgData[ contributor ] !== false
		) {
			userData[ contributor ].dotOrg = wpOrgData[ contributor ].slug;
			contributorLists.svn.push( wpOrgData[ contributor ].slug );
		}
	} );

	contributorLists.coAuthored = [];
	contributorLists.unlinked = [];

	contributorTypes.forEach( ( priority ) => {
		// Skip an empty set of contributors.
		if ( contributors[ priority ].length === 0 ) {
			return [];
		}

		[ ...contributors[ priority ] ]
			.map( ( username ) => {
				if ( 'unlinked' === priority ) {
					core.debug( 'Unlinked contributor: ' + username );
					return null;
				}

				const { dotOrg } = userData[ username ];
				if (
					! Object.prototype.hasOwnProperty.call(
						userData[ username ],
						'dotOrg'
					)
				) {
					contributorLists.unlinked.push( username );
					return null;
				}

				return contributorLists.coAuthored.push(
					`Co-authored-by: ${ username } <${ dotOrg }@git.wordpress.org>`
				);
			} )
			.filter( ( el ) => el );
	} );

	// Include findings so Ghostbuster HQ can be notified.
	contributorLists.hasGhostActivity = hasGhostActivity;

	// Surface co-author trailers that couldn't be matched to a GitHub user.
	contributorLists.unlinkedCoAuthors = unlinkedCoAuthors;

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
function skipUser( username ) {
	const skippedUsers = [
		'github-actions',
		'dependabot[bot]',
		'dependabot', // Here for backwards compatibility with old pull requests.
		'github-advanced-security',
		'codecov',
		'copilot-pull-request-reviewer',
		'copilot-swe-agent',
	];

	if (
		-1 === skippedUsers.indexOf( username ) &&
		! contributorAlreadyPresent( username )
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
function contributorAlreadyPresent( username ) {
	for ( const contributorType of contributorTypes ) {
		if ( contributors[ contributorType ].has( username ) ) {
			return true;
		}
	}
	return false;
}
