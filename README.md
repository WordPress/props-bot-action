# WordPress Props - GitHub Action
> A GitHub Action with the goal of ensuring everyone receives the credit they deserve with easily parsable, WordPress.org style attribution. 

## Overview

This GitHub Action Helps with collecting contributors associated with a pull request by commenting with a formatted list of contributors.

For a full breakdown of the WordPress project's Props best practices, please consult the [Making WordPress Core Handbook](https://make.wordpress.org/core/handbook/best-practices/contributor-attribution-props/).

## Configuration

### Required configurations
| Key      | Default         | Description                                                                         |
|----------|-----------------|-------------------------------------------------------------------------------------|
| `token`  | `$GITHUB_TOKEN` | GitHub token with permission to comment on the pull request.                        |
| `format` | `git`           | The style of contributor lists to include. Valid values are `svn`, `git`, or `all`. |

## Example Workflow File

To get started, copy and commit the [`example-props-bot.yml` file](https://github.com/WordPress/props-bot-action/blob/trunk/example-props-bot.yml) into the `.github/workflows` directory of your project's repository.

The example file is generously documented so it can be implemented and adjusted to suit the needs of your project.

If you need help implementing, you [can fill out a request for help](https://github.com/WordPress/props-bot-action/issues/new?assignees=desrosj&labels=%5BType%5D+Help+Request&projects=&template=3-request-to-help-implement.yml).
