#!/usr/bin/env bash
# Records the vexryn scan demo (README GIF): an animated logo reveal, then the scan.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; DIST="$ROOT/dist/cli.js"
export VEXRYN_HOME="$(mktemp -d)"; cd "$ROOT/fixtures/demo"
B='\033[38;2;74;144;255m'; BB='\033[38;2;74;144;255;1m'; V='\033[38;2;196;107;255m'
F='\033[38;2;86;94;126m'; W='\033[38;2;238;241;250;1m'; M='\033[38;2;139;147;172m'; R='\033[0m'
printf '\n  '
printf "$F╲$R"; sleep .14; printf "$BB╳$R"; sleep .14; printf "$F╱$R  "; sleep .2
for ch in v e x r y n; do [ "$ch" = x ] && printf "${BB}x$R" || printf "$W%s$R" "$ch"; sleep .07; done
sleep .1; printf "  ${F}v0.3.0$R\n  "
for i in $(seq 1 10); do printf "$B─$R"; sleep .012; done
for i in $(seq 1 10); do printf "$V─$R"; sleep .012; done
printf "\n  ${M}see what your agent loads — and what it can do$R\n\n"
sleep .5
printf "  $B❯$R "; sleep .3
cmd="npx vexryn scan"; for ((i=0;i<${#cmd};i++)); do printf '%s' "${cmd:$i:1}"; sleep .05; done; sleep .4; printf '\n'
VEXRYN_NO_BANNER=1 node "$DIST" scan --no-global
sleep 3
