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

/**
 * Extracts the GitHub login (and numeric ID, when present) from a
 * `users.noreply.github.com` email.
 *
 * Two formats exist:
 * - `123456+login@users.noreply.github.com` (post-2017 default)
 * - `login@users.noreply.github.com` (pre-2017)
 *
 * Returns null for any other email, letting the caller fall back to a
 * GitHub user-search lookup.
 *
 * @param {string} email
 * @return {{ login: string, databaseId: number|null }|null}
 */
export function parseNoreplyEmail( email ) {
	if ( ! email ) {
		return null;
	}

	const match = String( email )
		.toLowerCase()
		.match( /^(?:(\d+)\+)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)@users\.noreply\.github\.com$/ );

	if ( ! match ) {
		return null;
	}

	return {
		databaseId: match[ 1 ] ? parseInt( match[ 1 ], 10 ) : null,
		login: match[ 2 ],
	};
}

/**
 * Escapes GitHub Flavored Markdown special characters in user-controlled text.
 *
 * Used when interpolating commit-trailer names/emails into the bot comment so
 * they cannot inject links, `@`-mentions, or other markdown into a bot-authored
 * PR comment.
 *
 * @param {string} text The text to escape.
 * @return {string} The escaped text.
 */
export function escapeMarkdown( text ) {
	return String( text ?? '' ).replace(
		/([\\`*_{}[\]()<>#+\-.!|@~])/g,
		'\\$1'
	);
}
