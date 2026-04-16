import * as github from '@actions/github';
import fetch from 'node-fetch';

/**
 * Get WordPress.org user data for a list of GitHub usernames.
 *
 * @param {Array} githubUsers
 * @return {Promise<Array>} The WordPress.org user data.
 */
export async function getWPOrgData( githubUsers ) {
	// Collect WordPress.org usernames
	const dotorgGHApi =
		'https://profiles.wordpress.org/wp-json/wporg-github/v1/lookup/';

	return fetch( dotorgGHApi, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'User-Agent':
				'Props Bot: ' +
				github.context.repo.owner +
				'/' +
				github.context.repo.repo,
		},
		body: JSON.stringify( { github_user: githubUsers } ),
	} ).then( ( response ) => response.json() );
}

/**
 * Parses `Co-authored-by: Name <email>` trailers from a commit message.
 *
 * Matches the trailer on any line, case-insensitively. Per the
 * git-interpret-trailers convention trailers live at the end of the message,
 * but GitHub's squash-merge flow and many commit tools write them elsewhere,
 * so the full message is scanned.
 *
 * @param {string} message The commit message.
 * @return {Array<{name: string, email: string}>} The parsed trailers.
 */
export function parseCoAuthorTrailers( message ) {
	if ( ! message ) {
		return [];
	}

	const trailerRegex = /^\s*Co-authored-by:\s*(.+?)\s*<([^<>\s]+)>\s*$/gim;
	const trailers = [];

	let match;
	while ( ( match = trailerRegex.exec( message ) ) !== null ) {
		trailers.push( {
			name: match[ 1 ].trim(),
			email: match[ 2 ].trim().toLowerCase(),
		} );
	}

	return trailers;
}
