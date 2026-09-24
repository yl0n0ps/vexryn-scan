#!/usr/bin/env bash
# Post or update the ONE Vexryn review comment on a pull request. The sticky
# comment is found by its hidden marker, among bot comments only.
#   usage: pr-comment.sh <review.md>    env: REPO (owner/name), PR (number), GH_TOKEN
# Non-blocking: when commenting is refused (a fork PR gets a read-only token),
# the review goes to the job summary and the step still succeeds.
set -euo pipefail

review=$1
marker='<!-- vexryn-pr-review -->'

if [ -z "${PR:-}" ]; then
  echo "vexryn: not a pull_request event — nothing to review."
  exit 0
fi

existing=$(gh api "repos/$REPO/issues/$PR/comments" --paginate \
  --jq ".[] | select(.user.type == \"Bot\" and (.body | startswith(\"$marker\"))) | .id" 2>/dev/null | head -n 1) || existing=""
[[ "$existing" =~ ^[0-9]+$ ]] || existing=""

if [ -z "$existing" ] && grep -qxF 'No agent config change.' "$review"; then
  echo "vexryn: no agent config change — nothing to post."
  exit 0
fi

if [ -n "$existing" ]; then
  target=(-X PATCH "repos/$REPO/issues/comments/$existing")
else
  target=("repos/$REPO/issues/$PR/comments")
fi

body=$(node -e 'process.stdout.write(JSON.stringify({ body: require("fs").readFileSync(process.argv[1], "utf8") }))' "$review")
if printf '%s' "$body" | gh api "${target[@]}" --input - >/dev/null; then
  echo "vexryn: review comment posted."
else
  echo "vexryn: could not comment (read-only token, e.g. a fork PR) — review written to the job summary." >&2
  cat "$review" >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"
fi
