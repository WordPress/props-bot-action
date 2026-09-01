# WordPress Props - GitHub Action
> A GitHub Action with the goal of ensuring everyone receives the credit they deserve with easily parsable, WordPress.org style attribution. 

## Overview

This GitHub Action Helps with collecting contributors associated with a pull request by commenting with a formatted list of contributors.

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

## Example Workflow File

To get started, copy and commit the [`example-props-bot.yml` file](https://github.com/WordPress/props-bot-action/blob/trunk/example-props-bot.yml) into the `.github/workflows` directory of your project's repository.

The example file is generously documented so it can be implemented and adjusted to suit the needs of your project.

If you need help implementing, you [can fill out a request for help](https://github.com/WordPress/props-bot-action/issues/new?assignees=desrosj&labels=%5BType%5D+Help+Request&projects=&template=3-request-to-help-implement.yml).
