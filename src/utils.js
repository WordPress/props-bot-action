import * as core from '@actions/core';
import * as github from '@actions/github';

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
 * Checks whether a WordPress.org account exists.
 *
 * @param {string} slug The WordPress.org username.
 *
 * @return {Promise<boolean>} true if the account exists, false if it doesn't or the check fails.
 */
export async function wpOrgUserExists( slug ) {
	try {
		const response = await fetch(
			`https://profiles.wordpress.org/${ encodeURIComponent( slug ) }/`,
			{
				method: 'HEAD',
				headers: {
					'User-Agent':
						'Props Bot: ' +
						github.context.repo.owner +
						'/' +
						github.context.repo.repo,
				},
			}
		);

		if ( ! response.ok && 404 !== response.status ) {
			core.warning(
				`Could not check the WordPress.org account ${ slug }: HTTP ${ response.status }`
			);
		}

		return response.ok;
	} catch ( e ) {
		core.warning(
			`Could not check the WordPress.org account ${ slug }: ${ e.message }`
		);
		return false;
	}
}
