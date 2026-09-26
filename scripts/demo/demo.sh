#!/usr/bin/env bash
# Records the vexryn scan demo for the README GIF. Deterministic, offline.
set -e
DIST="$(cd "$(dirname "$0")/../.." && pwd)/dist/cli.js"
export VEXRYN_HOME="$(mktemp -d)"
cd "$(cd "$(dirname "$0")/../.." && pwd)/fixtures/demo"
printf '\033[38;5;44m❯\033[0m '
sleep 0.5
cmd="npx vexryn scan"
for ((i=0; i<${#cmd}; i++)); do printf '%s' "${cmd:$i:1}"; sleep 0.05; done
sleep 0.5
printf '\n'
node "$DIST" scan --no-global
sleep 3
