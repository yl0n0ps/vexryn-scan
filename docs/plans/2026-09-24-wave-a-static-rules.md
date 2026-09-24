# Wave A — exact static rules in the PR review: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vexryn diff` (and the load report) flags, from config/text alone, the exact facts the mining study ranked highest: literal secrets, shell pipes in server commands, hidden Unicode, override phrases in added text, sensitive paths, name shadowing, plain `http://` remotes, embedded blobs.

**Architecture:** one pure-function module `src/diff/rules.ts` (no I/O, no dependency, own regexes — public token formats and phrases, no copied rule files, so no NOTICE); `parse.ts` records *which* env/header names hold a literal secret (never the value); `snapshot.ts` materializes unreviewed agent text files too so text rules see them; `review.ts` emits one ⚠️ line per fact on new/changed servers and on *added* text; `report.ts` shows the server facts in the load report.

**Tech Stack:** TypeScript/Node, plain `node:assert` tests under `test/`.

**Spec:** `docs/research/2026-09-24-innovation-mining.md` §2–§3 (the ranked takes) and §5 (Wave A).

## Global Constraints

- Exact facts only; a phrase match is reported as *"contains the phrase …"*, never as "malicious".
- Never print a secret value: rules receive values but findings show names, shapes or `***`.
- Nothing executed, nothing sent, no new dependency, no LLM.
- Text rules apply to *added* lines only (a phrase already present and unchanged is not re-flagged).

## Review Focus

1. Placeholders (`${VAR}`, `your-token-here`, `<paste>`, `xxx`) must not count as literal secrets (Task 1 test).
2. A phrase quoted in security guidance already in the base file must not be re-flagged; only added lines (Task 2 test).
3. `http://localhost` / `127.0.0.1` / `[::1]` are not "plain remote" (Task 1 test).
4. `node server.js` / `python3 server.py` are not "shell with inline code"; `bash -c`, `node -e`, `| sh`, `&&` are (Task 1 test).
5. Text-rule output must itself pass through `code()` so a hostile phrase can't inject markdown (Task 2 test).

---

### Task 1: `rules.ts` + unit test

**Files:** Create `src/diff/rules.ts`; Test `test/rules-check.mjs`.
**Produces:** `hiddenChars(text): number`, `overridePhrases(addedText): string[]`, `blobs(text): number[]`, `shellInline(command, args): boolean`, `sensitivePaths(args): string[]`, `plainHttpRemote(url): boolean`, `secretLiteral(name, value): boolean`, `secretInText(text): boolean`.

- [ ] Step 1: write `test/rules-check.mjs` (table-driven literals, see file). - [ ] Step 2: run → FAIL (module missing). - [ ] Step 3: implement. - [ ] Step 4: run → PASS. - [ ] Step 5: commit `feat(rules): exact static rules for agent configs and text`.

### Task 2: wire into snapshot / parse / review + e2e test

**Files:** Modify `src/types.ts` (`McpServer.literalSecrets?: string[]`), `src/scan/parse.ts` (fill it, values dropped), `src/diff/snapshot.ts` (write unreviewed files into the dir; expose `textFiles` list), `src/diff/review.ts` (server facts, settings dirs, added-text rules); Test `test/diff-rules-check.mjs`.
**Consumes:** Task 1 exports. **Produces:** review lines: `⚠️ … — <NAME> is a literal secret in the file (redacted); use \`${NAME}\``, `⚠️ MCP server \`x\` runs a shell with inline code: …`, `⚠️ \`CLAUDE.md\` adds N invisible character(s) (zero-width/bidi)`, `⚠️ \`file\` adds text containing the phrase \`…\``, `⚠️ MCP server \`fs\` is given \`/\` …`, `⚠️ \`github\` is now defined in both … with different commands`, `⚠️ … connects over plain \`http://\` (unencrypted)`, `⚠️ … adds a N-char base64/hex-looking string`.

- [ ] Step 1: write the e2e test (one temp repo, one commit per scenario, incl. the Review Focus cases). - [ ] Step 2: run → FAIL. - [ ] Step 3: implement. - [ ] Step 4: `npm test` → all PASS. - [ ] Step 5: commit `feat(diff): flag literal secrets, shell pipes, hidden text, override phrases, sensitive paths, shadowing, http`.

### Task 3: load report + docs

**Files:** Modify `src/scan/report.ts` (per-server ⚠️ facts from `shellInline`/`sensitivePaths`/`plainHttpRemote`/`literalSecrets`), `README.md`; Test: extend `test/global-check.mjs` with one flagged server.

- [ ] Step 1: add the assertion → FAIL. - [ ] Step 2: implement. - [ ] Step 3: `npm test` → PASS. - [ ] Step 4: commit `feat(scan): show config facts (secrets, shell, paths, http) in the load report`.
