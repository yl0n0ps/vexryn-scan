#!/usr/bin/env bash
# Records the vexryn scan demo (README GIF): type the command, the real CLI does the rest.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; DIST="$ROOT/dist/cli.js"
export VEXRYN_HOME="$(mktemp -d)"; cd "$ROOT/fixtures/demo"
printf '\n  \033[38;2;74;144;255m>\033[0m '; sleep .4
cmd="npx vexryn scan"; for ((i=0;i<${#cmd};i++)); do printf '%s' "${cmd:$i:1}"; sleep .06; done; sleep .5; printf '\n'
node "$DIST" scan --no-global
sleep 3
