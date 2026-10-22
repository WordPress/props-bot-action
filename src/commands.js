import * as core from '@actions/core';

/**
 * Matches a single `@propsbot add|remove <username>` or `@propsbot refresh`
 * command line.
 *
 * The username follows GitHub's login rules, which also keeps it safe to
 * interpolate into GraphQL queries and render into the props comment. Lines
 * indented by four or more spaces are code in Markdown, so they don't match.
 *
 * @type {RegExp}
 */
const commandPattern =
	/^ {0,3}@propsbot\s+(?:(add|remove)\s+@?([a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})|refresh)\s*$/i;

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
 * replaces an earlier one. Commands from bots and other accounts that aren't
 * users, and from users without write access to the repository, are ignored.
 * `refresh` commands are skipped, since the comment
 * itself already triggered the run.
 *
 * @param {Object[]}                               comments       The comments, oldest first.
 * @param {(username: string) => Promise<boolean>} hasWriteAccess Resolves to whether a username may run commands.
 *
 * @return {Promise<{added: string[], removed: Set<string>}>} The usernames to add,
 *         and the lowercased usernames to remove.
 */
export async function getPropsOverrides( comments, hasWriteAccess ) {
	const overrides = new Map();
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
			overrides.set( username.toLowerCase(), { action, username } );
		}
	}

	const added = [];
	const removed = new Set();
	for ( const [ key, { action, username } ] of overrides ) {
		if ( 'add' === action ) {
			added.push( username );
		} else {
			removed.add( key );
		}
	}

	return { added, removed };
}
