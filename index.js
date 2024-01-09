import * as core from "@actions/core";

import { run as runContributorCollector } from './src/contribution-collector.js';

async function run() {
	try {
		await runContributorCollector();
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error.message);
		}
	}
}

run();
