#!/usr/bin/env bash
# Records the vexryn scan demo (README GIF): the wordmark reveals, then the scan.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; DIST="$ROOT/dist/cli.js"
export VEXRYN_HOME="$(mktemp -d)"; cd "$ROOT/fixtures/demo"
B='\033[38;2;74;144;255m'; F='\033[38;2;86;94;126m'; W='\033[38;2;238;241;250;1m'; M='\033[38;2;139;147;172m'; R='\033[0m'
printf '\n  '
for ch in v e x r y n; do [ "$ch" = x ] && printf "${B}\033[1mx$R" || printf "$W%s$R" "$ch"; sleep .10; done
sleep .15; printf "  ${F}v0.3.0$R   ${M}\xc2\xb7 see what your agent loads, and what it can do$R\n\n"
sleep .5
printf "  ${B}>$R "; sleep .3
cmd="npx vexryn scan"; for ((i=0;i<${#cmd};i++)); do printf '%s' "${cmd:$i:1}"; sleep .05; done; sleep .4; printf '\n'
VEXRYN_NO_BANNER=1 node "$DIST" scan --no-global
sleep 3
