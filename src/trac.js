import * as core from '@actions/core';
import * as github from '@actions/github';

/**
 * Matches links to WordPress.org Trac tickets, capturing the Trac instance and
 * the ticket number.
 *
 * @type {RegExp}
 */
const ticketLinkPattern =
	/https?:\/\/([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)\.trac\.wordpress\.org\/ticket\/(\d+)/gi;

/**
 * Gets the Trac tickets linked in a text, such as a pull request description.
 *
 * @param {string|null|undefined} text The text.
 *
 * @return {Array<{instance: string, id: number}>} The tickets, once each, in the order they are first linked.
 */
export function getTracTickets( text ) {
	const tickets = new Map();

	for ( const [ , instance, id ] of ( text ?? '' ).matchAll(
		ticketLinkPattern
	) ) {
		const ticket = { instance: instance.toLowerCase(), id: Number( id ) };
		tickets.set( `${ ticket.instance }#${ ticket.id }`, ticket );
	}

	return [ ...tickets.values() ];
}

/**
 * Gets the WordPress.org username of the reporter of a Trac ticket.
 *
 * Trac shows the reporter's login, which the username is derived from the
 * same way WordPress derives the profile slug from a login.
 *
 * @param {Object} ticket          The ticket.
 * @param {string} ticket.instance The Trac instance, such as `core` or `meta`.
 * @param {number} ticket.id       The ticket number.
 *
 * @return {Promise<string|null>} The lowercased username, or null when there is none or the lookup fails.
 */
export async function getTracReporter( { instance, id } ) {
	const ticketUrl = `https://${ instance }.trac.wordpress.org/ticket/${ id }`;

	try {
		const response = await fetch(
			`https://${ instance }.trac.wordpress.org/query?id=${ id }&col=reporter&format=csv`,
			{
				headers: {
					'User-Agent':
						'Props Bot: ' +
						github.context.repo.owner +
						'/' +
						github.context.repo.repo,
				},
				// Unknown Trac instances redirect to Core Trac, whose ticket with the same number is a different one.
				redirect: 'manual',
			}
		);

		if ( ! response.ok ) {
			core.warning(
				`Could not get the reporter of ${ ticketUrl }: HTTP ${ response.status }`
			);
			return null;
		}

		const [ header = '', row = '' ] = ( await response.text() )
			.trimStart()
			.split( /\r?\n/ );
		const reporter =
			row.split( ',' )[ header.split( ',' ).indexOf( 'reporter' ) ];

		// Tickets from before Trac required logging in can have an anonymous reporter.
		if ( ! reporter || 'anonymous' === reporter ) {
			return null;
		}

		// Mirrors `sanitize_title( mb_substr( $user_login, 0, 50 ) )` in `wp_insert_user()`.
		return reporter
			.slice( 0, 50 )
			.toLowerCase()
			.replaceAll( '.', '-' )
			.replace( /[^a-z0-9 _-]/g, '' )
			.replace( /\s+/g, '-' )
			.replace( /-+/g, '-' )
			.replace( /^-|-$/g, '' );
	} catch ( e ) {
		core.warning(
			`Could not get the reporter of ${ ticketUrl }: ${ e.message }`
		);
		return null;
	}
}
