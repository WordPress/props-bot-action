import * as core from '@actions/core';
import * as github from '@actions/github';
import { getPropsOverrides, parseCommands } from './commands.js';
import GitHub from './github.js';
import { getWPOrgData } from './utils.js';

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
	'added',
	'unlinked',
];

/**
 * Lowercased usernames removed from the props through Props Bot commands.
 *
 * @type {Set<string>}
 */
const removedUsers = new Set();

/**
 * Map of user data objects, keyed by contributor identity.
 *
 * Uses a null-prototype object so untrusted keys (e.g. an author email of
 * `length` or `__proto__`) cannot collide with built-in properties.
 *
 * @type {Object}
 */
const userData = Object.create( null );

/**
 * A list of contributors grouped by the type of contribution.
 *
 * @type {Object<string, Set<string>>}
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
 * @return {Promise<Object|undefined>} The lists of contributors, or undefined if there are none.
 * @async
 */
export async function getContributorsList() {
	const contributorData = await gh.getContributorData( {
		owner,
		repo,
		prNumber,
	} );

	core.debug( 'Raw contributor data:' );
	debugValue( contributorData );

	const overrides = await getPropsOverrides(
		contributorData.comments.nodes,
		( username ) => gh.hasWriteAccess( { owner, repo, username } )
	);
	overrides.removed.forEach( ( username ) => removedUsers.add( username ) );

	core.debug( 'Props Bot command overrides:' );
	debugValue( overrides );

	// Keep track of whether the Ghostbusters are needed.
	let hasGhostActivity = false;

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
			const email = commit.commit.author.email;

			if ( ! isWellFormedEmail( email ) ) {
				core.warning(
					`Ignoring an unlinked commit with an untrusted author email: ${ email }`
				);
				hasGhostActivity = true;
				continue;
			}

			contributors.committers.add( email );
			userData[ email ] = {
				name: commit.commit.author.name,
				email,
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
	debugValue( contributors.committers );

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
	debugValue( contributors.reviewers );

	// Process pull request comments.
	contributorData.comments.nodes
		.filter( ( comment ) => {
			if ( ! comment.author ) {
				hasGhostActivity = true;
				return false;
			}

			// Asking Props Bot to change the props is not a contribution in itself.
			if ( parseCommands( comment.body ).isCommandOnly ) {
				return false;
			}

			return ! skipUser( comment.author.login );
		} )
		.forEach( ( comment ) =>
			contributors.commenters.add( comment.author.login )
		);

	core.debug( 'Commenters:' );
	debugValue( contributors.commenters );

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
	debugValue( contributors.reporters );

	core.debug( 'Commenters (including linked issues):' );
	debugValue( contributors.commenters );

	// Process contributors added through Props Bot commands.
	for ( const username of overrides.added ) {
		const user = await gh.getUser( username );

		if ( ! user || 'User' !== user.type ) {
			core.warning(
				`Ignoring the request to add @${ username }, who is not a GitHub user.`
			);
			continue;
		}

		if ( contributorAlreadyPresent( user.login ) ) {
			continue;
		}

		contributors.added.add( user.login );
		userData[ user.login ] = user;
	}

	core.debug( 'Added through Props Bot commands:' );
	debugValue( contributors.added );

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
	debugValue( githubUsers );

	// List to return from the function.
	const contributorLists = {};
	contributorLists.github = [];

	// Collect WordPress.org usernames
	const wpOrgData = await getWPOrgData( githubUsers );
	contributorLists.svn = [];

	core.debug( 'WordPress.org raw data:' );
	debugValue( wpOrgData );

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
		if ( contributors[ priority ].size === 0 ) {
			return;
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

	debugValue( contributorLists );

	return contributorLists;
}

/**
 * Logs a value in debug mode.
 *
 * `core.debug()` serializes non-strings with `JSON.stringify()`, which turns a
 * Set into `{}`.
 *
 * @param {unknown} value The value to log.
 */
function debugValue( value ) {
	core.debug(
		JSON.stringify( value, ( key, item ) =>
			item instanceof Set ? [ ...item ] : item
		)
	);
}

/**
 * Checks whether an unlinked commit author email is a single, well-formed
 * address.
 *
 * @param {string} email The commit author email to validate.
 *
 * @return {boolean} true if the email is a single, well-formed address.
 */
function isWellFormedEmail( email ) {
	return (
		'string' === typeof email &&
		/^[\p{L}\p{M}\p{N}'_%+-]+(?:\.[\p{L}\p{M}\p{N}'_%+-]+)*@(?:[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?\.)+[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}]$/u.test(
			email
		)
	);
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
		'codecov',
		'coderabbitai',
		'copilot-pull-request-reviewer',
		'copilot-swe-agent',
		'dependabot', // Here for backwards compatibility with old pull requests.
		'dependabot[bot]',
		'github-actions',
		'github-advanced-security',
	];

	if (
		-1 === skippedUsers.indexOf( username ) &&
		! removedUsers.has( username.toLowerCase() ) &&
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
