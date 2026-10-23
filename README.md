# WordPress Props - GitHub Action
> A GitHub Action with the goal of ensuring everyone receives the credit they deserve with easily parsable, WordPress.org style attribution. 

## Overview

This GitHub Action Helps with collecting contributors associated with a pull request by commenting with a formatted list of contributors.

Contributors are collected from the pull request's commits, including people credited in `Co-authored-by` trailers, its reviews and comments, and the issues it closes and their comments. Bots and coding agents are left out.

For a full breakdown of the WordPress project's Props best practices, please consult the [Making WordPress Core Handbook](https://make.wordpress.org/core/handbook/best-practices/contributor-attribution-props/).

## Configuration

### Required configurations

| Key     | Default         | Description                                                                                                                                                             |
|---------|-----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `token` | `$GITHUB_TOKEN` | GitHub token with permission to comment on the pull request. When `post-comment` is `false`, only `pull-requests: read` is required, plus `issues: read` on a private repository. |

### Optional configurations

| Key            | Default | Description                                                                                                                            |
|----------------|---------|------------------------------------------------------------------------------------------------------------------------------------------|
| `format`       | `git`   | The style of contributor lists to include. Accepted values are `svn`, `git`, or `all`, or any combination of those separated by commas. |
| `post-comment` | `true`  | Whether to post the props in a comment. When `false`, the generated message is only returned through the `comment-body` output.        |

## Outputs

| Key            | Description                                                                                        |
|----------------|------------------------------------------------------------------------------------------------------|
| `comment-body` | The fully rendered props message in the `format` specified. Empty when no contributors were found. |

## Permissions

The calling workflow must grant the following permissions to `GITHUB_TOKEN`:

### Public repos

```yaml
permissions:
  pull-requests: write # Needed to post the props comment to the PR.
```

### Private repos

```yaml
permissions:
  pull-requests: write # Needed to post the props comment to the PR.
  issues: read         # Needed to read comments on issues linked to the PR.
```

### Collecting props without a PR comment

When `post-comment` is set to `false`, the action will not post a comment to the pull request and only returns the generated message through the `comment-body` output.

Because no comments are posted, the `pull-requests` permission can be downgraded from `write` to `read`.

```yaml
permissions:
  pull-requests: read # Needed to read the PR's commits, reviews, and comments.
  issues: read        # Private repos only. Needed to read comments on issues linked to the PR.
```

## Commands

Anyone with write access to the repository can adjust the props by commenting on the pull request:

| Command                        | Description                                                                         |
|--------------------------------|---------------------------------------------------------------------------------------|
| `@propsbot add <username>`     | Gives props to a GitHub user who would not have been picked up from the PR activity. |
| `@propsbot remove <username>`  | Leaves a GitHub user out of the props, even if they interacted with the PR.          |

A co-author who is only credited through a `Co-authored-by: <name> <username@git.wordpress.org>` trailer, without a matching GitHub account, is removed by their WordPress.org username.

Anyone can comment `@propsbot refresh` to refresh the props list, as an alternative to adding the `props-bot` label.

Each command must be on a line of its own, and a comment can contain several of them. Commands in code blocks are ignored. When there are several commands for the same user, the most recent one wins, so a removal can be undone with `@propsbot add <username>`.

Comments that consist only of commands do not earn their author props.

The commands are read from the comments on the pull request itself every time the action runs. To change an earlier command, post a new one. Edited or deleted commands take effect the next time the action runs.

## Example Workflow File

To get started, copy and commit the [`example-props-bot.yml` file](https://github.com/WordPress/props-bot-action/blob/trunk/example-props-bot.yml) into the `.github/workflows` directory of your project's repository.

The example file is generously documented so it can be implemented and adjusted to suit the needs of your project.

If you need help implementing, you [can fill out a request for help](https://github.com/WordPress/props-bot-action/issues/new?assignees=desrosj&labels=%5BType%5D+Help+Request&projects=&template=3-request-to-help-implement.yml).
