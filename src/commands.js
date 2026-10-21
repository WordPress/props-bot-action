import * as core from '@actions/core';

/**
 * Matches a single `@propsbot add|remove <username>` command line.
 *
 * The username follows GitHub's login rules, which also keeps it safe to
 * interpolate into GraphQL queries and render into the props comment.
 *
 * @type {RegExp}
 */
const commandPattern =
	/^\s*@propsbot\s+(add|remove)\s+@?([a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})\s*$/i;

/**
 * Matches the opening or closing line of a fenced code block.
 *
 * @type {RegExp}
 */
const fencePattern = /^\s*(```|~~~)/;

/**
 * Parses the Props Bot commands out of a comment body.
 *
 * Commands must be on a line of their own. Lines inside fenced code blocks are
 * ignored so that commands can be quoted without being run.
 *
 * @param {string} body The comment body.
 *
 * @return {{commands: {action: string, username: string}[], isCommandOnly: boolean}}
 *         The commands found, in order, and whether the comment consists of nothing else.
 */
export function parseCommands( body ) {
	const commands = [];
	let hasOtherContent = false;
	let inFence = false;

	if ( 'string' !== typeof body ) {
		return { commands, isCommandOnly: false };
	}

	for ( const line of body.split( /\r?\n/ ) ) {
		if ( fencePattern.test( line ) ) {
			inFence = ! inFence;
			hasOtherContent = true;
			continue;
		}

		if ( '' === line.trim() ) {
			continue;
		}

		const match = inFence ? null : line.match( commandPattern );
		if ( ! match ) {
			hasOtherContent = true;
			continue;
		}

		commands.push( {
			action: match[ 1 ].toLowerCase(),
			username: match[ 2 ],
		} );
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
 * replaces an earlier one. Commands from users without write access to the
 * repository are ignored.
 *
 * @param {Object[]} comments       The comments, oldest first.
 * @param {Function} hasWriteAccess Resolves to whether a username may run commands.
 *
 * @return {Promise<{added: string[], removed: Set<string>}>} The usernames to add,
 *         and the lowercased usernames to remove.
 */
export async function getPropsOverrides( comments, hasWriteAccess ) {
	const overrides = new Map();
	const access = new Map();

	for ( const comment of comments ) {
		const { commands } = parseCommands( comment.body );
		if ( 0 === commands.length || ! comment.author ) {
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
