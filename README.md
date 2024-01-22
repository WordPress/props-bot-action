# WordPress Props - GitHub Action
> A GitHub Action with the goal of ensuring everyone receives the credit they deserve with easily parsable, WordPress.org style attribution. 

## Overview

This GitHub Action Helps with collecting contributors associated with a pull request and lists WordPress.org usernames.

## Configuration

### Required configurations
| Key | Default | Description |
| --- | ------- | ----------- |
| `token` | - | GitHub token to add comment on the pull request. |

## Example Workflow File

To get started, you will want to copy the contents of the given example into `.github/workflows/wordpress-props.yml` and push that to your repository. You are welcome to name the file something else.

```yml
name: Props Bot

on:
  # Gathers all participants for pull requests to assist in giving proper credit.
  pull_request:
  issue_comment:
  pull_request_review:
    types:
      - submitted
  pull_request_review_comment:
    types:
      - created

# Cancels all previous workflow runs for pull requests that have not completed.
concurrency:
  # The concurrency group contains the workflow name and the branch name for pull requests
  # or the commit hash for any other events.
  group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.head_ref || github.sha }}
  cancel-in-progress: true

jobs:
  pull_request_participants:
    name: Collect props
    runs-on: ubuntu-latest
    timeout-minutes: 20

    # Collects a list of contributors for a pull request and shares a list of
    # Co-authored-by: trailers for merging contributors to copy into the commit message.
    steps:
      - name: Compile contributor list and comment on the PR
        uses: WordPress/props-bot@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```
