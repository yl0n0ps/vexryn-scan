#!/usr/bin/env bash
# Post or update the ONE Vexryn review comment on a pull request. The sticky
# comment is found by its hidden marker, among bot comments only.
#   usage: pr-comment.sh <review.md>    env: REPO (owner/name), PR (number), GH_TOKEN
# Non-blocking: when commenting fails (a fork PR's read-only token, a body
# GitHub rejects…), the review goes to the job summary and the step succeeds;
# a sticky already in place is replaced by a short notice, never left stale.
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

if [ -z "$existing" ] && grep -qxF 'No agent config file changed.' "$review"; then
  echo "vexryn: no agent config change — nothing to post."
  exit 0
fi

if [ -n "$existing" ]; then
  target=(-X PATCH "repos/$REPO/issues/comments/$existing")
else
  target=("repos/$REPO/issues/$PR/comments")
fi

post() { # $1 = file whose content becomes the comment body
  node -e 'process.stdout.write(JSON.stringify({ body: require("fs").readFileSync(process.argv[1], "utf8") }))' "$1" |
    gh api "${target[@]}" --input - >/dev/null
}

if post "$review"; then
  echo "vexryn: review comment posted."
  exit 0
fi
echo "vexryn: could not post the review comment — it is in the job summary instead." >&2
cat "$review" >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"
if [ -n "$existing" ]; then
  notice=$(mktemp)
  printf '%s\n### Vexryn — agent config review\n\nThe latest review couldn'"'"'t be posted as a comment — see the workflow run summary.\n' "$marker" > "$notice"
  post "$notice" || true
  rm -f "$notice"
fi
