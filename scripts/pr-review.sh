#!/usr/bin/env bash
# The Action's step: review the pull request's agent-config changes and post
# the comment. Runs in the checked-out repo. On `pull_request`, the checkout is
# GitHub's merge commit (parent 1 = base branch, parent 2 = the PR), so
# HEAD^1 -> HEAD is exactly what the PR changes. Any other checkout (a branch
# tip, `pull_request_target`, fetch-depth 1) would review the wrong range: skip.
#   env: GITHUB_ACTION_PATH (built vexryn), RUNNER_TEMP, + pr-comment.sh's env
set -euo pipefail

if ! git rev-parse -q --verify 'HEAD^2' >/dev/null; then
  echo "vexryn: the checkout is not a pull_request merge commit — skipping (use 'on: pull_request' with fetch-depth: 2)."
  exit 0
fi

review="${RUNNER_TEMP:-/tmp}/vexryn-review.md"
node "$GITHUB_ACTION_PATH/dist/cli.js" diff . --base 'HEAD^1' --head HEAD > "$review"
cat "$review"
bash "$GITHUB_ACTION_PATH/scripts/pr-comment.sh" "$review"
