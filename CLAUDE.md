# Working on vexryn-scan

- TypeScript/Node, ES modules. Build with `npm run build`, test with `npm test`.
- Every test runs against a fake home (`VEXRYN_HOME`); never read or write the real `~/.vexryn`.
- Never print a secret value; show names only.
- Keep the static path static: nothing from a scanned repo is ever executed.
- Prefer the standard library; no new dependency without a supply-chain check.
