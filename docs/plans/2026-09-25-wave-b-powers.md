# Wave B — powers, per-tool trim, local drift: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (founder's choice: no subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Where Vexryn *has* a server's real tool list (`--deep`, or a past local measurement), it says in plain words what those tools can do ("can: send messages to external recipients, read files"), which tools were never used, and what changed since the last measurement — with nothing invented and nothing sent.

**Architecture:** One pure classifier `src/scan/powers.ts` (verb + noun + argument-shape anchors, `null` when unsure — ported from our own Rust `autoconfig.rs`, with its refusal cases as tests, plus four everyday powers). One tiny local store `src/scan/measured.ts` (`~/.vexryn/measured.json`, keyed by how a server is launched): `--deep` writes it and reports drift against it; the static scan, the MCP tool and `trim` read it, so real dated figures appear without launching anything. `trim` gains a per-tool "never used" list from the usage store it already has.

**Tech Stack:** TypeScript/Node, `node:crypto` (sha256), plain `node:assert` tests under `test/`. No new dependency.

**Spec:** `docs/research/2026-09-24-innovation-mining.md` §1 (take 1–2), §2 (take 9), §4 (take 1), §5 (Wave B).

## Global Constraints

- A tool maps to a power only when a verb, a noun and an argument shape agree; otherwise `null`. Never a guess.
- Powers are shown only where tools were really read (`--deep` now, or a past measurement, dated). The static path never launches a server.
- `~/.vexryn/measured.json` honours `VEXRYN_HOME` like `usage.json`; tests never touch the real home.
- Every string from a server (tool names) is rendered through `plain()` (control chars stripped).
- `agent_load_report` stays read-only; its description must not contain `wire`, `trim`, `wrap`, `deep`, `write` (mcp-check).
- No HTML change (ponytail: terminal + MCP tool only; add to `html.ts` when someone asks).

## Review Focus

1. A tool with no `inputSchema`, or `properties` that is not an object → no crash, no args (Task 1 test).
2. A hostile tool name carrying control characters must not drive the terminal via a drift line (Task 2 test on `drift()`).
3. A corrupt or missing `measured.json` → empty store, scan still works (Task 2 test).
4. A server that was measured before and is unreachable now keeps its old measurement (the store is only overwritten by a successful read) — Task 3 code, stated in the plan, no test (needs a failing mock).
5. A long "never used" list is truncated, never a 40-name line (Task 3 unit assert on `renderTrim`).

---

### Task 1: `powers.ts` + unit test

**Files:** Create `src/scan/powers.ts`; Test `test/powers-check.mjs`; Modify `package.json` (`test` script: append `&& node test/powers-check.mjs`).

**Produces:**
```ts
export type Power = "payment.transfer" | "credential.change" | "data.delete" | "file.share" | "permission.escalate"
  | "schedule.create" | "memory.write" | "external-message.send" | "file.read" | "file.write" | "shell.exec" | "network.fetch";
export const POWER_LABEL: Record<Power, string>;           // plain English, in display order
export interface ToolShape { name: string; description?: string; inputSchema?: unknown }
export function argNames(inputSchema: unknown): string[];  // keys of schema.properties, or []
export function classifyTool(tool: ToolShape): Power | null;
export function powerLabels(powers: (Power | null | undefined)[]): string[]; // distinct, display order
```

- [ ] **Step 1: write `test/powers-check.mjs`** — table-driven:

```js
#!/usr/bin/env node
// The power classifier: a tool maps to a power only when verb + noun + argument
// shape agree; otherwise null. Refusal cases come first — they are the point.
import assert from "node:assert/strict";
import { classifyTool, argNames, powerLabels } from "../dist/scan/powers.js";

const t = (name, description, args) => ({ name, description, inputSchema: { type: "object", properties: Object.fromEntries(args.map((a) => [a, { type: "string" }])) } });

// Refused (from Ferrum's tests + everyday look-alikes)
for (const tool of [
  t("org.secretary.schedule", "Assign a secretary to update the meeting notes", ["attendee"]),
  t("search.tokenizer.update", "Update the text tokenizer used for search indexing", ["text"]),
  t("cache.invalidate", "Remove a cached entry by id", ["id"]),
  t("sys.webadm", "Administer the web admin panel", ["to"]),
  t("weather.lookup", "Get the current weather", ["city"]),
  t("agent.memory.read", "Read previously persisted content from the agent's memory/notes store.", ["key"]),
  t("agent.memory.act", "Take an action whose content is sourced from the agent's memory/notes store.", ["recipient", "content"]),
  t("cron.tasks.fire", "Fire a previously scheduled task, performing its action.", ["scheduleId", "recipient", "content"]),
  t("run_query", "Run a read-only SQL query against the configured database and return rows.", ["sql"]),
  t("search_issues", "Search issues in a repository by text query, labels, author, and state.", ["query", "state"]),
  t("create_pull_request", "Open a pull request from a head branch into a base branch with a title and body.", ["title", "body", "head", "base"]),
  t("list_commits", "Get list of commits of a branch, one page at a time", ["page", "perPage"]),
  t("get_issue", "Get details of an issue", ["issue_number"]),
]) assert.equal(classifyTool(tool), null, `${tool.name} must not classify`);

// Mapped
const cases = [
  [t("wise.transfers.send", "Send money to a recipient", ["destination", "amount"]), "payment.transfer"],
  [t("zendesk.tickets.reply", "Reply to a customer support ticket", ["to", "body"]), "external-message.send"],
  [t("send_email", "Send an email notification to a recipient address with a subject and message body.", ["to", "subject", "body"]), "external-message.send"],
  [t("auth.password.reset", "Reset a user account password", ["account", "new_password"]), "credential.change"],
  [t("crm.records.delete", "Delete a customer record permanently", ["record_id"]), "data.delete"],
  [t("crm.records.delete", "Permanently delete a stored record by id", ["recordId"]), "data.delete"],
  [t("drive.files.share", "Share a file's contents with a recipient.", ["recipient", "content"]), "file.share"],
  [t("iam.roles.grant", "Grant the agent a scope.", ["scope"]), "permission.escalate"],
  [t("cron.tasks.create", "Schedule a task to run later on a trigger.", ["scheduleId", "trigger", "recipient", "payload"]), "schedule.create"],
  [t("agent.memory.write", "Persist content into the agent's persistent memory/notes store.", ["key", "content"]), "memory.write"],
  [t("read_file", "Read the contents of a file at a path within the repository.", ["path"]), "file.read"],
  [t("list_directory", "List the contents of a directory", ["path"]), "file.read"],
  [t("get_file_contents", "Get the contents of a file or directory from a GitHub repository", ["owner", "repo", "path"]), "file.read"],
  [t("write_file", "Create a new file or overwrite an existing file", ["path", "content"]), "file.write"],
  [t("edit_file", "Make line-based edits to a text file", ["path", "edits"]), "file.write"],
  [t("move_file", "Move or rename files and directories", ["source", "destination"]), "file.write"],
  [t("execute_command", "Execute a shell command", ["command"]), "shell.exec"],
  [t("bash", "Executes a given bash command in a persistent shell session", ["command", "timeout"]), "shell.exec"],
  [t("fetch", "Fetches a URL from the internet and extracts its contents as markdown", ["url"]), "network.fetch"],
  [t("web_search", "Search the web for a query", ["query"]), "network.fetch"],
  [t("browser_navigate", "Navigate the browser to a URL", ["url"]), "network.fetch"],
];
for (const [tool, power] of cases) assert.equal(classifyTool(tool), power, `wrong power for ${tool.name}`);

// Robustness: no schema / odd schema → no args, no crash
assert.deepEqual(argNames(undefined), []);
assert.deepEqual(argNames({ type: "object", properties: "nope" }), []);
assert.equal(classifyTool({ name: "read_file", description: "Read a file at a path" }), null, "no args → no anchor → null");

// Labels: distinct, display order, nulls dropped
assert.deepEqual(powerLabels(["file.read", null, "external-message.send", "file.read"]), ["send messages to external recipients", "read files"]);
console.log("powers-check: all assertions passed");
```

- [ ] **Step 2: run → FAIL** `npm run build && node test/powers-check.mjs` (module missing).
- [ ] **Step 3: implement `src/scan/powers.ts`**:

```ts
// Deterministic power classifier: a tool's name + description + argument names
// → ONE power, only when a verb, a noun and an argument shape all agree;
// otherwise null. No model, no guess. Ported from our own Rust autoconfig.rs
// (Ferrum) with the same discipline and refusal cases, plus four everyday
// powers a developer reads at a glance.

export type Power =
  | "payment.transfer" | "credential.change" | "data.delete" | "file.share" | "permission.escalate"
  | "schedule.create" | "memory.write" | "external-message.send"
  | "file.read" | "file.write" | "shell.exec" | "network.fetch";

/** Plain-English labels, in display order (the eight prohibited effects first). */
export const POWER_LABEL: Record<Power, string> = {
  "payment.transfer": "move money",
  "credential.change": "change passwords or credentials",
  "data.delete": "delete records",
  "file.share": "share files with a recipient",
  "permission.escalate": "grant permissions",
  "schedule.create": "schedule tasks to run later",
  "memory.write": "write to the agent's memory",
  "external-message.send": "send messages to external recipients",
  "file.read": "read files",
  "file.write": "create, edit or delete files",
  "shell.exec": "run shell commands",
  "network.fetch": "access the network",
};

export interface ToolShape { name: string; description?: string; inputSchema?: unknown }

/** Argument names = keys of the schema's `properties`, or [] for anything odd. */
export function argNames(inputSchema: unknown): string[] {
  const props = (inputSchema as { properties?: unknown } | null | undefined)?.properties;
  return props && typeof props === "object" && !Array.isArray(props) ? Object.keys(props) : [];
}

export function classifyTool(tool: ToolShape): Power | null {
  const text = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
  const args = argNames(tool.inputSchema).map((a) => a.toLowerCase());
  const has = (...words: string[]) => words.some((w) => text.includes(w));
  const arg = (...names: string[]) => names.some((n) => args.includes(n));

  // — the eight prohibited effects, verbatim from autoconfig.rs —
  if (has("transfer", "send money", "payment", "payout") && arg("amount", "value", "sum")) return "payment.transfer";
  if (has("password", "credential", "secret", "api key", "token") && has("reset", "change", "rotate", "update") &&
      arg("account", "user", "username", "login", "newsecret", "new_secret", "new_password", "password", "secret")) return "credential.change";
  // a bare `id` is NOT enough: cache/session/temp cleanups "remove by id" too
  if (has("delete", "remove", "purge", "erase") && arg("recordid", "record_id", "record", "resource_id")) return "data.delete";
  if (has("share", "attach") && has("file", "document", "attachment") && arg("recipient", "to", "content")) return "file.share";
  if (has("grant", "escalate", "elevate") && (has("scope", "permission", "privilege", "role") || arg("scope"))) return "permission.escalate";
  if (has("schedule", "cron") && arg("scheduleid", "schedule_id") && (has("create", "later", "defer") || arg("trigger", "payload"))) return "schedule.create";
  if (has("memory", "notes") && arg("key") && arg("content", "value") && has("save", "store", "persist", "write", "remember")) return "memory.write";
  if (has("send", "reply", "message", "email", "notify") && arg("to", "recipient", "body", "message", "text")) return "external-message.send";

  // — everyday powers, same discipline —
  const pathArg = arg("path", "file", "files", "filepath", "file_path", "filename", "file_name", "directory", "dir", "source", "destination");
  const fileNoun = has("file", "directory", "directories", "folder", "path");
  if (has("run", "execute", "exec", "launch", "spawn", "start") && has("command", "shell", "bash", "terminal", "script", "process") &&
      arg("command", "cmd", "script", "args", "argv")) return "shell.exec";
  if (has("write", "create", "edit", "save", "move", "copy", "rename", "delete", "remove", "append", "overwrite") && fileNoun && pathArg) return "file.write";
  if (has("read", "get", "list", "cat", "open", "view", "show", "search") && fileNoun && pathArg) return "file.read";
  if (has("fetch", "download", "open", "navigate", "browse", "request", "crawl", "scrape", "search", "visit", "load") &&
      has("url", "web", "internet", "http", "website", "browser") && arg("url", "uri", "link", "href", "endpoint", "query")) return "network.fetch";
  return null;
}

/** Distinct plain-English labels of a set of powers, in display order. */
export function powerLabels(powers: (Power | null | undefined)[]): string[] {
  const set = new Set(powers.filter((p): p is Power => !!p));
  return (Object.keys(POWER_LABEL) as Power[]).filter((p) => set.has(p)).map((p) => POWER_LABEL[p]);
}
```

- [ ] **Step 4: run → PASS.** Add `&& node test/powers-check.mjs` to `package.json` `test`.
- [ ] **Step 5: commit** `feat(powers): deterministic power classifier for measured tools`.

### Task 2: `measured.ts` (local store + drift) + types

**Files:** Create `src/scan/measured.ts`; Modify `src/types.ts` (`ToolInfo.power?`, `ToolInfo.hash?`, `ServerEstimate.measuredAt?`, `ServerEstimate.drift?`), `src/scan/introspect.ts` (fill `power` + `hash`); Test: `test/measured-check.mjs` (pure functions + store round-trip in a temp `VEXRYN_HOME`); `package.json` test script.

**Produces:**
```ts
export interface Measured { measuredAt: string; tools: ToolInfo[] }
export type MeasuredStore = Record<string, Measured>;
export function measuredKey(s: { transport: string; target: string }): string; // `${transport} ${target}`
export async function loadMeasured(): Promise<MeasuredStore>;                   // {} on missing/corrupt
export async function saveMeasured(store: MeasuredStore): Promise<void>;
export function estimateFromMeasured(m: Measured): ServerEstimate;              // source "measured", measuredAt
export function drift(prev: Measured, now: ToolInfo[]): string[];              // exact facts, control chars stripped
```

- [ ] **Step 1: write `test/measured-check.mjs`**:

```js
#!/usr/bin/env node
// The local measurement store and the drift facts it enables. Fake home only.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-measured-"));
process.env.VEXRYN_HOME = home;
const { drift, estimateFromMeasured, loadMeasured, saveMeasured, measuredKey } = await import("../dist/scan/measured.js");

const tool = (name, hash, tokens = 10, power = null) => ({ name, description: "", tokens, hash, power });
const prev = { measuredAt: "2026-09-01T10:00:00.000Z", tools: [tool("a", "h1"), tool("b", "h2"), tool("gone", "h3")] };

assert.deepEqual(drift(prev, prev.tools), [], "same tools, same hashes → no drift");
const facts = drift(prev, [tool("a", "h1"), tool("b", "CHANGED"), tool("new\u001b[31m", "h4")]);
assert.deepEqual(facts, [
  "+1 tool since 2026-09-01: new[31m",
  "1 tool gone since 2026-09-01: gone",
  "1 tool changed its description or schema since 2026-09-01: b",
], "exact facts, control chars stripped");

const est = estimateFromMeasured(prev);
assert.equal(est.toolCount, 3); assert.equal(est.approxTokens, 30); assert.equal(est.source, "measured"); assert.equal(est.measuredAt, prev.measuredAt);

assert.equal(measuredKey({ transport: "stdio", target: "node x.js" }), "stdio node x.js");

try {
  assert.deepEqual(await loadMeasured(), {}, "no store yet → empty");
  mkdirSync(path.join(home, ".vexryn"), { recursive: true });
  writeFileSync(path.join(home, ".vexryn", "measured.json"), "{ not json");
  assert.deepEqual(await loadMeasured(), {}, "corrupt store → empty, no crash");
  await saveMeasured({ "stdio node x.js": prev });
  assert.deepEqual(await loadMeasured(), { "stdio node x.js": prev }, "round-trip");
  console.log("measured-check: all assertions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
```

- [ ] **Step 2: run → FAIL** (module missing).
- [ ] **Step 3: implement.** `src/types.ts`:

```ts
import type { Power } from "./scan/powers.js";
// ServerEstimate: add
  /** ISO date of the local measurement this estimate was rebuilt from (static scan). */
  measuredAt?: string;
  /** What changed since the previous local measurement (--deep only). */
  drift?: string[];
// ToolInfo: add
  /** What the tool can do, or null when the classifier is not sure. */
  power?: Power | null;
  /** sha256 of description + input schema, to notice a change next time. */
  hash?: string;
```

`src/scan/introspect.ts` (in `introspectServer`):
```ts
import { createHash } from "node:crypto";
import { classifyTool } from "./powers.js";
    const detailed: ToolInfo[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      tokens: countToolTokens(t),
      power: classifyTool(t),
      hash: createHash("sha256").update(JSON.stringify({ d: t.description ?? "", s: t.inputSchema ?? {} })).digest("hex"),
    }));
```

`src/scan/measured.ts`:
```ts
// What --deep measured on THIS machine, remembered locally: the static scan,
// the MCP tool and trim show real, dated figures without launching anything,
// and the next --deep says what changed (drift) — no remote service, nothing
// sent. Lives at ~/.vexryn/measured.json (VEXRYN_HOME in tests), keyed by how
// the server is launched, so the same server declared for two agents is one entry.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerEstimate, ToolInfo } from "../types.js";

export interface Measured { measuredAt: string; tools: ToolInfo[] }
export type MeasuredStore = Record<string, Measured>;

export function measuredKey(s: { transport: string; target: string }): string {
  return `${s.transport} ${s.target}`;
}

function storePath(): string {
  return path.join(process.env.VEXRYN_HOME || os.homedir(), ".vexryn", "measured.json");
}

export async function loadMeasured(): Promise<MeasuredStore> {
  try {
    const data = JSON.parse(await fs.readFile(storePath(), "utf8")) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) return data as MeasuredStore;
  } catch { /* no store yet, or unreadable — fine */ }
  return {};
}

export async function saveMeasured(store: MeasuredStore): Promise<void> {
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify(store, null, 2), "utf8");
}

/** A dated estimate rebuilt from a past measurement — nothing launched. */
export function estimateFromMeasured(m: Measured): ServerEstimate {
  return { toolCount: m.tools.length, approxTokens: m.tools.reduce((n, t) => n + t.tokens, 0), source: "measured", tools: m.tools, measuredAt: m.measuredAt };
}

/** Exact facts about what changed since `prev`; [] when nothing did. */
export function drift(prev: Measured, now: ToolInfo[]): string[] {
  const date = prev.measuredAt.slice(0, 10);
  const before = new Map(prev.tools.map((t) => [t.name, t]));
  const after = new Set(now.map((t) => t.name));
  const added = now.filter((t) => !before.has(t.name)).map((t) => t.name);
  const gone = prev.tools.filter((t) => !after.has(t.name)).map((t) => t.name);
  const changed = now.filter((t) => before.has(t.name) && before.get(t.name)!.hash !== t.hash).map((t) => t.name);
  const list = (names: string[]) => names.map((n) => n.replace(/[\u0000-\u001f\u007f]/g, "")).join(", ");
  const n = (k: number) => `${k} tool${k === 1 ? "" : "s"}`;
  const facts: string[] = [];
  if (added.length) facts.push(`+${n(added.length)} since ${date}: ${list(added)}`);
  if (gone.length) facts.push(`${n(gone.length)} gone since ${date}: ${list(gone)}`);
  if (changed.length) facts.push(`${n(changed.length)} changed ${changed.length === 1 ? "its" : "their"} description or schema since ${date}: ${list(changed)}`);
  return facts;
}
```

- [ ] **Step 4: `npm test` → PASS** (add `&& node test/measured-check.mjs`).
- [ ] **Step 5: commit** `feat(measured): remember --deep measurements locally; drift facts`.

### Task 3: wire in — scan (deep + static), MCP tool, trim — + e2e test

**Files:** Modify `src/cli.ts` (`runScan` deep loop; `runTrim`), `src/scan/collect.ts` (`attachLocal`), `src/scan/report.ts` (`can:` line, drift lines, `measured <date>`), `src/trim/trim.ts` (`computeTrim(servers, usage?)`, `unused`, real `fmtTokens`), `src/mcp/server.ts` (tool description), `fixtures/mock-mcp-server.mjs` (`MOCK_EXTRA_TOOL`); Test `test/deep-check.mjs`; `package.json`.

**Consumes:** Task 1 `powerLabels`; Task 2 `loadMeasured/saveMeasured/measuredKey/estimateFromMeasured/drift`.
**Produces:** report lines `      can: <labels>`, `      ⚠ +1 tool since <date>: …`; location column ` · measured <date>`; trim line `keep  <name>  N of M tools used` + `never used (K): a, b, …`.

- [ ] **Step 1: write `test/deep-check.mjs`**:

```js
#!/usr/bin/env node
// End-to-end: powers, the local measurement store, drift, per-tool trim.
// FAKE home (VEXRYN_HOME); the mock server grows one tool with MOCK_EXTRA_TOOL=1.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { computeTrim, renderTrim } from "../dist/trim/trim.js";

const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-deep-"));
const env = { ...process.env, VEXRYN_HOME: home };
const cli = (extra, ...args) => execFileSync("node", ["dist/cli.js", ...args], { env: { ...env, ...extra }, encoding: "utf8" }).replace(/\u001b\[[0-9;]*m/g, "");

try {
  // 1. --deep: real tools → powers
  let out = cli({}, "scan", "fixtures/deep-repo", "--deep", "--no-global");
  assert.match(out, /mock-local\s+5 tools/);
  assert.match(out, /can: send messages to external recipients, read files/);
  assert.ok(!out.includes("since"), "first measurement: nothing to compare with");

  // 2. static scan: remembered, dated, nothing launched
  out = cli({}, "scan", "fixtures/deep-repo", "--no-global");
  assert.match(out, /static read/);
  assert.match(out, /mock-local\s+5 tools · ~\d+ tok/, "real figures from the local measurement");
  assert.match(out, /measured \d{4}-\d{2}-\d{2}/);
  assert.match(out, /can: send messages to external recipients, read files/);
  assert.ok(!out.includes("not measured"), "a measured server is not asked to run --deep again");

  // 3. --deep again, the server changed → drift facts
  out = cli({ MOCK_EXTRA_TOOL: "1" }, "scan", "fixtures/deep-repo", "--deep", "--no-global");
  assert.match(out, /⚠ \+1 tool since \d{4}-\d{2}-\d{2}: delete_record/);
  assert.match(out, /⚠ 1 tool changed its description or schema since \d{4}-\d{2}-\d{2}: read_file/);
  assert.match(out, /can: delete records, send messages to external recipients, read files/);

  // 4. per-tool trim from real usage (2 calls through the proxy)
  const transport = new StdioClientTransport({ command: "node", args: ["dist/cli.js", "wrap", "--name", "mock-local", "--", "node", "fixtures/mock-mcp-server.mjs"], env });
  const client = new Client({ name: "deep-check", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  for (const name of ["search_issues", "read_file"]) await client.callTool({ name, arguments: {} });
  await client.close();
  await new Promise((r) => setTimeout(r, 300));
  out = cli({}, "trim", "fixtures/deep-repo");
  assert.match(out, /keep {2}mock-local\s+2 of 6 tools used/);
  assert.match(out, /never used \(4\): create_pull_request, send_email, run_query, delete_record/);

  // 5. a long never-used list is truncated
  const tools = Array.from({ length: 12 }, (_, i) => ({ name: `t${i}`, description: "", tokens: 1 }));
  const fake = { name: "big", client: "Cursor", scope: "project", transport: "stdio", target: "x", fromRelPath: "f", usedToolCount: 1, estimate: { toolCount: 12, approxTokens: 12, source: "measured", tools } };
  const text = renderTrim(computeTrim([fake], { servers: { big: { tools: { t0: 1 }, updatedAt: "" } } })).replace(/\u001b\[[0-9;]*m/g, "");
  assert.match(text, /never used \(11\): t1, t2, t3, t4, t5, t6, t7, t8, … \+3 more/);

  console.log("deep-check: all assertions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
```

- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement.**

`fixtures/mock-mcp-server.mjs` — after the `tools` array:
```js
// Simulate a server that changed since the last measurement (drift tests).
if (process.env.MOCK_EXTRA_TOOL) {
  tools[2].description = "Read the contents of a file at a path, following symlinks.";
  tools.push({
    name: "delete_record",
    description: "Delete a customer record permanently.",
    inputSchema: { type: "object", properties: { record_id: { type: "string" } }, required: ["record_id"] },
  });
}
```

`src/scan/collect.ts` — replace the usage loop with a shared helper:
```ts
import { estimateFromMeasured, loadMeasured, measuredKey } from "./measured.js";
/** Attach what THIS machine recorded locally: real usage (wrap) and past measurements (--deep). */
export async function attachLocal(servers: McpServer[]): Promise<void> {
  const usage = await loadUsage();
  const measured = await loadMeasured();
  for (const s of servers) {
    s.usedToolCount = usage.servers[s.name] ? usedToolCount(usage, s.name) : null;
    const m = measured[measuredKey(s)];
    if (m && !s.estimate) s.estimate = estimateFromMeasured(m);
  }
}
// in collectStatic:  await attachLocal(servers);
```

`src/cli.ts` `runScan` deep loop:
```ts
import { drift, loadMeasured, measuredKey, saveMeasured } from "./scan/measured.js";
    const unique = new Map<string, McpServer>();
    for (const s of reachable) unique.set(measuredKey(s), s);
    ...
    const store = await loadMeasured();
    const measured = new Map<string, ServerEstimate>();
    for (const [key, server] of unique) {
      process.stderr.write(`  · introspecting ${server.name}…\n`);
      const est = await introspectServer(server);
      if (est.source === "introspect" && est.tools) {
        // Only a successful read replaces the remembered measurement.
        if (store[key]) est.drift = drift(store[key], est.tools);
        store[key] = { measuredAt: new Date().toISOString(), tools: est.tools };
      }
      measured.set(key, est);
    }
    await saveMeasured(store);
    for (const s of reachable) s.estimate = measured.get(measuredKey(s)) ?? s.estimate;
```
`runTrim`: replace the usage loop with `await attachLocal(servers); const usage = await loadUsage(); const result = computeTrim(servers, usage);`

`src/scan/report.ts`:
```ts
import { powerLabels } from "./powers.js";
// in the server loop:
      const where = `${s.fromRelPath} · ${s.scope}` + (s.estimate?.measuredAt ? ` · measured ${s.estimate.measuredAt.slice(0, 10)}` : "");
      lines.push(`    ${padEnd(s.name, 20)} ${padEnd(renderServerCost(s), 34)} ${dim(where)}`);
      const can = powerLabels((s.estimate?.tools ?? []).map((t) => t.power));
      if (can.length) lines.push(`      can: ${can.join(", ")}`);
      for (const f of serverFacts(s)) lines.push(`      ⚠ ${f}`);
      for (const d of s.estimate?.drift ?? []) lines.push(`      ⚠ ${plain(d)}`);
```

`src/trim/trim.ts`:
```ts
import type { UsageData } from "../usage/store.js";
import { fmtTokens } from "../scan/report.js";
export interface TrimRec { server: McpServer; verdict: Verdict; reason: string; unused?: string[] }
export function computeTrim(servers: McpServer[], usage?: UsageData): TrimResult {
  ...
    } else if (used != null && used > 0) {
      const tools = s.estimate?.tools;
      const called = usage?.servers[s.name]?.tools ?? {};
      const unused = tools?.filter((t) => !(called[t.name] > 0)).map((t) => t.name);
      recs.push({ server: s, verdict: "keep", reason: tools ? `${used} of ${tools.length} tools used` : `${used} tool(s) used`, unused });
    }
// renderTrim, after each rec line:
    if (r.unused?.length) lines.push(`          ${dim(`never used (${r.unused.length}): ${shortList(r.unused)}`)}`);
// savings line:
    lines.push(`  Dropping the unused servers frees ~${fmtTokens(savedTokens)} tokens of context.`);
// helper:
function shortList(names: string[], max = 8): string {
  const shown = names.slice(0, max).map((n) => n.replace(/[\u0000-\u001f\u007f]/g, ""));
  return names.length > max ? `${shown.join(", ")}, … +${names.length - max} more` : shown.join(", ");
}
```

`src/mcp/server.ts` `agent_load_report` description — append: `" When a server was measured locally before, shows its real tool count and what those tools can do (read files, run shell commands, send messages…), dated."` (no forbidden words).

- [ ] **Step 4: `npm test` → all PASS** (add `&& node test/deep-check.mjs`). Check `proxy-check` still passes (its `sample-repo` servers are never measured).
- [ ] **Step 5: commit** `feat(scan): powers, dated local measurements, drift; per-tool trim`.

### Task 4: README + help

**Files:** Modify `README.md` (Status: powers / remembered measurements / drift / per-tool trim; "Not built yet" keeps honest limits), `src/cli.ts` `printHelp` (`--deep` line: "…measure real tool cost and powers; remembered locally").

- [ ] **Step 1: edit README Status** — add after the `--deep` bullet:

```md
- **Powers (`--deep`, exact):** from a server's real tool list, Vexryn says in
  plain words what its tools can do — *can: send messages to external
  recipients, read files, run shell commands* — with a deterministic
  classifier (a verb, a noun and an argument shape must agree; unsure = not
  listed). Never from a package name alone.
- **Remembered measurements + drift:** `--deep` results are kept locally
  (`~/.vexryn/measured.json`); the static `scan`, the MCP tool and `trim` then
  show real, dated figures without launching anything, and the next `--deep`
  says what changed: *+1 tool since 2026-09-25: `delete_record` · 1 tool
  changed its description or schema*.
- **Per-tool trim:** with usage and a measurement, `trim` says *keep `github`
  — 12 of 46 tools used; never used (34): …*.
```
And in "Not built yet": `- **Powers in the PR review** — needs a measured catalogue (package@version → tools); Wave C, founder decision pending.`

- [ ] **Step 2: `npm test` → PASS; commit** `docs: wave B — powers, remembered measurements, drift, per-tool trim`.
