import * as core from '@actions/core';

/**
 * Matches a single `@propsbot add|remove <username>` or `@propsbot refresh`
 * command line.
 *
 * The username can be a GitHub login or a WordPress.org username, and its
 * characters keep it safe to interpolate into GraphQL queries and render into
 * the props comment. As a `<username>@git.wordpress.org` email it names the
 * WordPress.org user only, for when the same username is someone else on
 * GitHub. Lines indented by four or more spaces are code in Markdown, so they
 * don't match.
 *
 * @type {RegExp}
 */
const commandPattern =
	/^ {0,3}@propsbot\s+(?:(add|remove)\s+@?([a-z\d_](?:[a-z\d_]|-(?=[a-z\d_])){0,49}(?:@git\.wordpress\.org)?)|refresh)\s*$/i;

/**
 * Matches a code fence line, capturing the fence and anything after it.
 *
 * @type {RegExp}
 */
const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Parses the Props Bot commands out of a comment body.
 *
 * Commands must be on a line of their own. Lines inside code blocks are
 * ignored so that commands can be quoted without being run. As in Markdown, a
 * fenced code block only ends at a fence of the same character that is at
 * least as long as the opening one and has nothing after it.
 *
 * @param {string} body The comment body.
 *
 * @return {{commands: {action: string, username?: string}[], isCommandOnly: boolean}}
 *         The commands found, in order, and whether the comment consists of nothing else.
 *         `refresh` commands have no username.
 */
export function parseCommands( body ) {
	const commands = [];
	let hasOtherContent = false;
	let openFence = null;

	if ( 'string' !== typeof body ) {
		return { commands, isCommandOnly: false };
	}

	for ( const line of body.split( /\r?\n/ ) ) {
		const fence = line.match( fencePattern );
		if ( fence ) {
			if ( ! openFence ) {
				openFence = fence[ 1 ];
			} else if (
				fence[ 1 ][ 0 ] === openFence[ 0 ] &&
				fence[ 1 ].length >= openFence.length &&
				'' === fence[ 2 ].trim()
			) {
				openFence = null;
			}

			hasOtherContent = true;
			continue;
		}

		if ( '' === line.trim() ) {
			continue;
		}

		const match = openFence ? null : line.match( commandPattern );
		if ( ! match ) {
			hasOtherContent = true;
			continue;
		}

		commands.push(
			match[ 1 ]
				? { action: match[ 1 ].toLowerCase(), username: match[ 2 ] }
				: { action: 'refresh' }
		);
	}

	return {
		commands,
		isCommandOnly: commands.length > 0 && ! hasOtherContent,
	};
}

/**
 * Replays the Props Bot commands in a list of comments.
 *
 * Comments are processed in the order given, so a later command for a user
 * replaces an earlier one. A username alone stands for both the GitHub user
 * and the WordPress.org user of that name, and a `@git.wordpress.org` email
 * for the WordPress.org user only. Commands from bots and other accounts that
 * aren't users, and from users without write access to the repository, are
 * ignored. `refresh` commands are skipped, since the comment itself already
 * triggered the run.
 *
 * @param {Object[]}                               comments       The comments, oldest first.
 * @param {(username: string) => Promise<boolean>} hasWriteAccess Resolves to whether a username may run commands.
 *
 * @return {Promise<{added: string[], removed: Set<string>}>} The usernames to add,
 *         and the lowercased usernames to remove, where an email is a WordPress.org user.
 */
export async function getPropsOverrides( comments, hasWriteAccess ) {
	const added = new Map();
	const removed = new Set();
	const access = new Map();

	for ( const comment of comments ) {
		const commands = parseCommands( comment.body ).commands.filter(
			( { action } ) => 'refresh' !== action
		);
		if (
			0 === commands.length ||
			! comment.author ||
			'User' !== comment.author.__typename
		) {
			continue;
		}

		const author = comment.author.login;
		if ( ! access.has( author ) ) {
			access.set( author, await hasWriteAccess( author ) );
		}

		if ( ! access.get( author ) ) {
			core.info(
				`Ignoring Props Bot commands from @${ author }, who does not have write access.`
			);
			continue;
		}

		for ( const { action, username } of commands ) {
			const key = username.toLowerCase();
			const keys = key.includes( '@' )
				? [ key ]
				: [ key, `${ key }@git.wordpress.org` ];

			if ( 'add' === action ) {
				added.set( key, username );
				keys.forEach( ( user ) => removed.delete( user ) );
			} else {
				keys.forEach( ( user ) => {
					added.delete( user );
					removed.add( user );
				} );
			}
		}
	}

	return { added: [ ...added.values() ], removed };
}
