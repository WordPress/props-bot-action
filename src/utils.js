import * as github from "@actions/github";
import fetch from "node-fetch";

/**
 * Get WordPress.org user data for a list of GitHub usernames.
 *
 * @param {array} githubUsers
 * @returns {Promise<array>}
 */
export async function getWPOrgData(githubUsers) {
	// Collect WordPress.org usernames
	const dotorgGHApi =
    "https://profiles.wordpress.org/wp-json/wporg-github/v1/lookup/";

	return fetch(dotorgGHApi, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent":
        "Props Bot: " +
        github.context.repo.owner +
        "/" +
        github.context.repo.repo,
		},
		body: JSON.stringify({ github_user: githubUsers }),
	}).then((response) => response.json());
}
