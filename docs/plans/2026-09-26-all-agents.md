# Vexryn — cover every coding agent, and test it in depth: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (founder's choice: inline, no subagents; final review = `/code-review high` in session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Vexryn reads the MCP servers and always-loaded instructions of every coding agent a developer is likely to have — not the six it reads today, but also Codex, GitHub Copilot (VS Code + CLI), Cline, Roo Code, Continue, Zed, Kiro, OpenCode, Goose — from each agent's own config format (JSON, JSONC, TOML, YAML). And it is tested in depth: a fixture repo that exercises every agent, plus a smoke pass over the real machine's configs.

**Architecture:** Discovery already tags each file with a `kind` + `client`; `parse.ts` dispatches on `kind`. Extend both. One new reader per format: `smol-toml` for Codex, `yaml` for Continue/Goose (both audited clean, zero transitive deps, no install scripts). Instruction loading stays in `instructions.ts`, one block per agent, gated on the agent being present. Nothing new is executed; the static path stays static.

**Tech Stack:** TypeScript/Node; new deps `smol-toml` (BSD-3) and `yaml` (ISC); `node:assert` tests.

**Spec:** `docs/research/2026-09-26-agent-matrix.md` (every path + format, with sources).

## Global Constraints

- A path is claimed only when verified in the matrix doc; an unverified path is used to FIND a file, never asserted as a load.
- Secrets: env/header values are never kept; only the NAMES, and which names hold a literal secret (existing `extractServers`/`secretLiteral`).
- Read-only, nothing executed, nothing sent. Malformed TOML/YAML tolerated like malformed JSON (skip, never throw).
- Per-agent load and per-agent dedup unchanged: each agent app is its own context window.
- MCP tool `agent_load_report` stays read-only; its schema must not contain wire/trim/wrap/deep/write.

## Review Focus

1. A `.roo/mcp.json` that also matches a broad `.roo/` rule glob must be parsed once as MCP, not double-counted (Task 2 test).
2. Codex TOML with `[mcp_servers.x]` AND an unrelated `[history]` table must yield exactly one server, no crash on the extra table (Task 1 test).
3. A YAML file that is a list, a scalar, or invalid must yield no servers and not throw (Task 1 test).
4. An agent config present only in the repo (e.g. `.kiro/settings/mcp.json`) with `--no-global` must still be found (Task 2 test).
5. OpenCode's `command` is an ARRAY (`["npx","-y","pkg"]`), not a string+args — the first element is the command, the rest are args (Task 1 test).

---

### Task 1: format readers + server extraction for the new shapes

**Files:** Create `src/scan/formats.ts` (readToml, readYaml, both tolerant); Modify `src/scan/parse.ts` (read by kind, new `extractServers` entry points for TOML/OpenCode/Zed shapes), `src/types.ts` (`ConfigKind` additions, `AgentClient` additions), `package.json` (deps); Test `test/formats-check.mjs`.

**New `ConfigKind`s:** `codex-toml`, `copilot-cli`, `cline`, `roo-mcp`, `continue-yaml`, `zed`, `kiro`, `opencode`, `goose`.
**New `AgentClient`s:** `Codex`, `GitHub Copilot CLI`, `Cline`, `Roo Code`, `Continue`, `Zed`, `Kiro`, `OpenCode`, `Goose`.

**Produces:**
```ts
export function readToml(text: string): unknown | null;   // null on parse error
export function readYaml(text: string): unknown | null;
```
Server extraction per kind (in parse.ts):
- `codex-toml`: `mcp_servers.<name>` → command/args/env; url + `bearer_token_env_var`/`http_headers` names as `receives`.
- `opencode`: `mcp.<name>` → `command` array (head = command, tail = args), `environment` names; remote `url`/`headers`.
- `zed`: `context_servers.<name>` → command/args/env; url/headers.
- `goose`: `extensions.<name>` type stdio → `cmd`/`args`/`envs`+`env_keys`; streamable_http → `uri`/`headers`.
- `continue-yaml`: `mcpServers` list of `{name,command,args,env,url,type}`.
- `copilot-cli`, `cline`, `roo-mcp`, `kiro`: `mcpServers` object (existing `extractServers`).

- [ ] RED: `test/formats-check.mjs` — table of one fixture per format asserting the parsed servers (name, transport, target, receives, literalSecrets), plus: TOML with extra tables → 1 server; YAML list/scalar/invalid → []; OpenCode command array → command+args split; a literal secret in Codex `env` flagged.
- [ ] GREEN, commit `feat(scan): read Codex TOML, OpenCode/Zed/Goose/Continue and the VS Code-family MCP configs`.

### Task 2: discovery — project + global locations for every agent

**Files:** Modify `src/scan/discover.ts` (`PROJECT_RULES` + `globalCandidates`), `src/diff/snapshot.ts` (`isAgentConfigPath` for the new project files); Test `test/discover-agents-check.mjs`.

**Project files** (matched anywhere in the tree, like today): `.codex/config.toml`, `.copilot/mcp-config.json`, `.roo/mcp.json`, `.continue/mcpServers/*.{yaml,json}`, `.zed/settings.json`, `.kiro/settings/mcp.json`, `opencode.json`/`opencode.jsonc`.
**Global files:** `~/.codex/config.toml`, `~/.copilot/mcp-config.json`, `~/.config/goose/config.yaml`, `~/.config/zed/settings.json`, `~/.config/opencode/opencode.json`, `~/.continue/config.yaml`, `~/.kiro/settings/mcp.json`, Cline + Roo VS Code `globalStorage/.../settings/*.json` (best-effort; found-or-absent).

- [ ] RED: `test/discover-agents-check.mjs` — a fake home + a repo with one file per agent; assert each is discovered with the right kind/client/scope; `--no-global` keeps the repo ones; `.roo/mcp.json` is MCP, not a rule.
- [ ] GREEN, commit `feat(scan): discover every coding agent's config (repo + user-wide)`.

### Task 3: always-loaded instructions for the new agents

**Files:** Modify `src/scan/instructions.ts` (Codex, Copilot, Cline, Roo, Kiro, OpenCode, Zed blocks), `src/diff/snapshot.ts` (these files reviewed); Test extend `test/instructions-check.mjs`.

Rules from the matrix (each gated on the agent being present):
- Codex: `~/.codex/AGENTS.md`/override, repo root→cwd `AGENTS.md`, 32 KiB cap.
- Copilot: `.github/copilot-instructions.md`, root `AGENTS.md`.
- Cline: `.clinerules` file or `.clinerules/`/`.cline/rules/` dir, root `AGENTS.md`.
- Roo: `.roo/rules/` (else `.roorules`), root `AGENTS.md`.
- Kiro: `.kiro/steering/*.md` with `inclusion: always` or none, root `AGENTS.md`.
- OpenCode: `AGENTS.md` (else `CLAUDE.md`), `opencode.json` `instructions`.
- Zed: FIRST match of the 9-name list → one entry, note it shadows the rest.

- [ ] RED: extend `test/instructions-check.mjs` — a repo with each agent's instruction file; assert each agent's "Loads every session" section; Zed first-match picks `.rules` and ignores a sibling `AGENTS.md`; OpenCode falls back to `CLAUDE.md` only without `AGENTS.md`.
- [ ] GREEN, commit `feat(scan): always-loaded instructions for Codex, Copilot, Cline, Roo, Kiro, OpenCode, Zed`.

### Task 4: depth test — one fixture repo, every agent; real-machine smoke

**Files:** Create `fixtures/all-agents/` (a repo with a config for each agent, at least one literal secret, one `/`-rooted filesystem server, one unpinned catalogued server, one Zed first-match trap); Test `test/all-agents-check.mjs` (scan the fixture → assert one section per agent, counts and facts; diff base→head with a change to each → every agent's file named); a guarded smoke that runs `scan` over the real `VEXRYN_HOME=~` and asserts exit 0, only when `VEXRYN_SMOKE=1`.

- [ ] RED: write the fixture + test; run → FAIL.
- [ ] GREEN, commit `test: full-agent fixture repo + real-machine smoke`.

### Task 5: README + agent list + version

**Files:** `README.md` (the agent table, honest coverage), `src/cli.ts` help, version bump `0.3.0`.
- [ ] `/code-review high`, fix Critical/Important RED→GREEN.
- [ ] Merge, push, tag `v0.3.0`, publish (founder confirms in browser). Refresh the demo PR.
