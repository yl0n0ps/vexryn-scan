# Vexryn for teams — plan 1 of 4: cloud core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (founder's choice: inline, no subagents; final review = `/code-review high` in session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** A team's `vexryn ci` runs post their review to Vexryn Cloud, where the organisation sees a timeline of every agent-config change, the inventory that follows from it, and can export both — with nothing but facts ever leaving the CI.

**Architecture:** Two repositories. The public CLI (`vexryn-scan`) gains a *review event* — a closed, data-minimised JSON built from the review and the head side's servers — and `vexryn ci` posts it when an org token is set. A new **private** repository `vexryn-cloud` holds one small Node 22 service (`node:http`, server-rendered HTML, Postgres via `postgres`) that validates events with the CLI package's own validator, stores them, derives the inventory, and serves the dashboard. Hosted on Scaleway (Paris): Serverless Containers + Managed Database.

**Tech Stack:** TypeScript / Node ≥ 22 (`fetch`, `node:http`, `node:crypto`), `postgres` 3.4 (zero transitive deps, audited 2026-10-09: no advisories, no install scripts), `node:assert` tests against a local Postgres, Docker, Scaleway CLI.

**Spec:** `docs/specs/2026-10-09-vexryn-enterprise-design.md` (sections 3 v1, 4, 5, 10 pages 1–2 and 6, 11, 15).

## Global Constraints

- The CLI sends **facts only**; never code, file contents, diffs, env/header *values*, secrets, tokens, tool descriptions, prompts (spec §5 table). Enforced by tests, client and server.
- Event schemas are **closed**: unknown keys are rejected server-side (spec §5, §11).
- The CLI's `scan` uploads nothing; `ci` posts only when `VEXRYN_ORG_TOKEN` is set; without it behaviour is unchanged (spec §6, §8).
- Org tokens: random, shown once, stored hashed with a per-token salt, scoped to one organisation, revocable, machine-only (spec §5, §11).
- Hosting in an EU region (spec §5); HTTPS only; no third-party analytics; closed schemas; oversize payloads rejected; per-token rate limits (spec §11).
- Dashboard: server-rendered HTML, brand tokens of `docs/design-system.md` (navy `#0A0E27`, panel `#141A33`, blue `#4A90FF`, violet `#C46BFF`, coral `#FF5A4E`, amber `#E6B23C`, green `#37C98B`, muted `#8B93AC`, faint `#565E7E`, fg `#EEF1FA`), every repo-sourced string escaped (spec §10, §15).
- The cloud repository is private; the CLI stays Apache-2.0 (spec §1, §12). Creating the private repo, the Scaleway account and the GitHub OAuth app are founder actions.
- No new dependency beyond `postgres` and `vexryn` in the cloud; none in the CLI.
- Test strings must never look like real credentials (the repo's bash guard and GitHub push protection both scan): no `gho_`, `ghp_`, `xoxb-`, `sk-` prefixes, even in fixtures.

## Review Focus

1. A server named `<img src=x onerror=alert(1)>` in a posted event must render as text in the timeline and inventory, never as HTML — Task 9 test.
2. The same PR re-run posts a second event for the same head sha: both stay in the timeline, the inventory uses the latest — Task 8 test.
3. A 2 MB body on `POST /v1/reviews` is refused with 413 before any parsing and nothing is stored — Task 8 test.
4. A revoked token gets 401 and nothing is stored; a token of org A can never write into org B — Task 8 test.
5. The cloud being down during CI must not change the PR comment, the exit code, or print a stack trace: one warning line — Task 3 test.

---

## Part A — the public CLI (`vexryn-scan`)

### Task 1: the review event — facts, builder, closed-schema validator

**Files:**
- Create: `src/cloud/events.ts`
- Test: `test/events-check.mjs`

**Interfaces:**
- Consumes: `McpServer` (`src/types.ts`), `Review` (`src/diff/review.ts`), `packageSpec`, `lookup`, `isExactVersion` (`src/scan/catalog.ts`).
- Produces:
  ```ts
  export interface ServerFact { name: string; client: string; scope: string; transport: string; file: string; package?: string; version?: string; eco?: "npm" | "pypi"; pinned?: boolean; known: boolean; deprecated: boolean; receives: string[]; literalSecrets: string[]; powers: string[]; tools?: number }
  export interface ReviewEvent { schema: "vexryn.review/1"; sentAt: string; cli: string; forge: "github" | "gitlab" | "bitbucket" | "azure"; forgeHost: string; repo: string; pr: string; baseSha: string; headSha: string; runUrl?: string; outcome: "clean" | "warn" | "block"; review: Review; servers: ServerFact[] }
  export function serverFacts(servers: McpServer[]): ServerFact[]
  export function buildReviewEvent(input: Omit<ReviewEvent, "schema" | "sentAt" | "servers"> & { headServers: McpServer[] }): ReviewEvent
  export function validateReviewEvent(json: unknown): { ok: true; event: ReviewEvent } | { ok: false; error: string }
  export const LIMITS: { strings: 2000; lines: 500; servers: 500; names: 100 }
  ```

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// The review event is the ONLY thing `vexryn ci` ever sends to the cloud. Asserts:
//  - it carries facts (server names, packages, versions, powers, the NAMES of
//    env vars) and never a value: a literal secret in the config is absent
//  - never a tool description, never file contents
//  - the validator accepts what the builder makes, and rejects an unknown key
//    (top level and inside a server), a wrong type, a wrong schema id, and
//    oversized arrays/strings — closed schema, both ways
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const { buildReviewEvent, serverFacts, validateReviewEvent, LIMITS } = await import(path.resolve("dist/cloud/events.js"));
const { discoverConfigs } = await import(path.resolve("dist/scan/discover.js"));
const { parseServers } = await import(path.resolve("dist/scan/parse.js"));

const tmp = mkdtempSync(path.join(os.tmpdir(), "vexryn-events-"));
const SECRET = "s3cr3t-value-never-sent-7f3a";
try {
  mkdirSync(path.join(tmp, "repo"));
  writeFileSync(path.join(tmp, "repo", ".mcp.json"), JSON.stringify({ mcpServers: {
    slack: { command: "npx", args: ["-y", "@modelcontextprotocol/server-slack@2025.4.25"], env: { SLACK_BOT_TOKEN: SECRET } },
    files: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/"] },
    docs: { url: "https://docs.internal.example.com/mcp", headers: { Authorization: `Bearer ${SECRET}` } },
  } }));
  const servers = await parseServers(await discoverConfigs(path.join(tmp, "repo")), path.join(tmp, "repo"));
  const facts = serverFacts(servers);
  const slack = facts.find((f) => f.name === "slack");
  assert.equal(slack.package, "@modelcontextprotocol/server-slack");
  assert.equal(slack.version, "2025.4.25");
  assert.equal(slack.pinned, true);
  assert.deepEqual(slack.receives, ["SLACK_BOT_TOKEN"]);
  assert.deepEqual(slack.literalSecrets, ["SLACK_BOT_TOKEN"], "the NAME of a literal secret is a fact");
  assert.equal(facts.find((f) => f.name === "files").pinned, false);
  assert.equal(facts.find((f) => f.name === "docs").transport, "http");

  const review = { powers: ["⚠️ New MCP server `slack` <sub>vx-01234567</sub>"], accepted: 0, loads: [], changed: [".mcp.json"], unreviewed: [], open: 1 };
  const event = buildReviewEvent({ cli: "0.5.0", forge: "github", forgeHost: "github.com", repo: "o/r", pr: "7", baseSha: "a".repeat(40), headSha: "b".repeat(40), runUrl: "https://github.com/o/r/actions/runs/1", outcome: "warn", review, headServers: servers });
  const json = JSON.stringify(event);
  assert.equal(event.schema, "vexryn.review/1");
  assert.doesNotMatch(json, new RegExp(SECRET), "a secret value is never in the event");
  assert.doesNotMatch(json, /"description"|"inputSchema"|"raw"|"texts"|"env"|"headers"/, "no descriptions, schemas, env or header objects");
  assert.ok(Date.parse(event.sentAt) > 0);

  // --- closed schema, both ways
  const ok = validateReviewEvent(JSON.parse(json));
  assert.equal(ok.ok, true, ok.error);
  const bad = (mutate) => { const e = JSON.parse(json); mutate(e); return validateReviewEvent(e); };
  assert.equal(bad((e) => (e.extra = 1)).ok, false, "unknown top-level key");
  assert.equal(bad((e) => (e.servers[0].env = { A: "b" })).ok, false, "unknown server key");
  assert.equal(bad((e) => (e.pr = 7)).ok, false, "wrong type");
  assert.equal(bad((e) => (e.schema = "vexryn.review/2")).ok, false, "wrong schema");
  assert.equal(bad((e) => (e.review.powers = Array(LIMITS.lines + 1).fill("x"))).ok, false, "too many lines");
  assert.equal(bad((e) => (e.repo = "x".repeat(LIMITS.strings + 1))).ok, false, "string too long");
  assert.equal(bad((e) => (e.outcome = "panic")).ok, false, "enum");
  assert.equal(validateReviewEvent(null).ok, false);
  assert.equal(validateReviewEvent("{}").ok, false);
  console.log("events-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && node test/events-check.mjs`
Expected: FAIL — `Cannot find module '.../dist/cloud/events.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/cloud/events.ts
// The review event: the ONLY thing `vexryn ci` sends to Vexryn Cloud. Facts
// only — names, packages, versions, powers, finding lines (already redacted by
// review.ts). Never a value, a description, a file body. The schema is closed:
// `validateReviewEvent` is used by the CLI (before sending) and by the cloud
// (on receipt) — the same code, so the contract can't drift.
import type { McpServer } from "../types.js";
import type { Review } from "../diff/review.js";
import { isExactVersion, lookup, packageSpec } from "../scan/catalog.js";

export const LIMITS = { strings: 2000, lines: 500, servers: 500, names: 100 } as const;

export interface ServerFact {
  name: string; client: string; scope: string; transport: string; file: string;
  package?: string; version?: string; eco?: "npm" | "pypi"; pinned?: boolean;
  known: boolean; deprecated: boolean;
  /** NAMES of env vars / headers the server receives — never values. */
  receives: string[];
  /** Of those, the names whose value is written literally in the file. */
  literalSecrets: string[];
  powers: string[];
  tools?: number;
}

export interface ReviewEvent {
  schema: "vexryn.review/1";
  sentAt: string;
  cli: string;
  forge: "github" | "gitlab" | "bitbucket" | "azure";
  forgeHost: string;
  repo: string;
  pr: string;
  baseSha: string;
  headSha: string;
  runUrl?: string;
  outcome: "clean" | "warn" | "block";
  review: Review;
  servers: ServerFact[];
}

export function serverFacts(servers: McpServer[]): ServerFact[] {
  return servers.map((s) => {
    const spec = s.command ? packageSpec(s.command, s.args ?? []) : null;
    const hit = lookup(spec);
    const fact: ServerFact = {
      name: s.name, client: s.client, scope: s.scope, transport: s.transport, file: s.fromRelPath,
      known: !!hit?.measured,
      deprecated: !!(hit?.deprecated && hit.version === hit.latest),
      receives: s.receives ?? [],
      literalSecrets: s.literalSecrets ?? [],
      powers: hit?.measured ? [...new Set(hit.measured.tools.map((t) => t.power).filter((p): p is NonNullable<typeof p> => !!p))] : [],
    };
    if (spec) {
      fact.package = spec.name;
      fact.eco = spec.eco;
      if (spec.version) fact.version = spec.version;
      fact.pinned = isExactVersion(spec.version);
    }
    if (hit?.measured) fact.tools = hit.measured.tools.length;
    return fact;
  });
}

export function buildReviewEvent(input: Omit<ReviewEvent, "schema" | "sentAt" | "servers"> & { headServers: McpServer[] }): ReviewEvent {
  const { headServers, ...rest } = input;
  return { schema: "vexryn.review/1", sentAt: new Date().toISOString(), ...rest, servers: serverFacts(headServers) };
}

// --- closed-schema validation (no library: the shape is small and must be exact)
type Shape = Record<string, (v: unknown) => string | null>;
const str = (max = LIMITS.strings) => (v: unknown) => (typeof v === "string" && v.length <= max ? null : `expected a string ≤ ${max}`);
const bool = (v: unknown) => (typeof v === "boolean" ? null : "expected a boolean");
const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? null : "expected a non-negative integer");
const oneOf = (...vals: string[]) => (v: unknown) => (typeof v === "string" && vals.includes(v) ? null : `expected one of ${vals.join(", ")}`);
const strs = (max: number) => (v: unknown) => (Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length <= LIMITS.strings) ? null : `expected ≤ ${max} strings`);
const optional = (f: (v: unknown) => string | null) => (v: unknown) => (v === undefined ? null : f(v));
const obj = (shape: Shape, required: string[]) => (v: unknown): string | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "expected an object";
  for (const k of Object.keys(v)) if (!(k in shape)) return `unknown key "${k}"`;
  for (const k of required) if (!(k in v)) return `missing "${k}"`;
  for (const [k, f] of Object.entries(shape)) {
    const err = f((v as Record<string, unknown>)[k]);
    if (err) return `${k}: ${err}`;
  }
  return null;
};
const list = (f: (v: unknown) => string | null, max: number) => (v: unknown) => {
  if (!Array.isArray(v) || v.length > max) return `expected an array of ≤ ${max}`;
  for (const [i, x] of v.entries()) { const err = f(x); if (err) return `[${i}] ${err}`; }
  return null;
};

const server = obj({
  name: str(), client: str(), scope: str(), transport: str(), file: str(),
  package: optional(str()), version: optional(str()), eco: optional(oneOf("npm", "pypi")), pinned: optional(bool),
  known: bool, deprecated: bool, receives: strs(LIMITS.names), literalSecrets: strs(LIMITS.names), powers: strs(LIMITS.names), tools: optional(int),
}, ["name", "client", "scope", "transport", "file", "known", "deprecated", "receives", "literalSecrets", "powers"]);
const load = obj({ header: str(), lines: strs(LIMITS.lines) }, ["header", "lines"]);
const review = obj({ powers: strs(LIMITS.lines), accepted: int, loads: list(load, LIMITS.lines), changed: strs(LIMITS.lines), unreviewed: strs(LIMITS.lines), open: int },
  ["powers", "accepted", "loads", "changed", "unreviewed", "open"]);
const event = obj({
  schema: oneOf("vexryn.review/1"), sentAt: str(64), cli: str(64), forge: oneOf("github", "gitlab", "bitbucket", "azure"), forgeHost: str(255),
  repo: str(), pr: str(64), baseSha: str(64), headSha: str(64), runUrl: optional(str()), outcome: oneOf("clean", "warn", "block"),
  review, servers: list(server, LIMITS.servers),
}, ["schema", "sentAt", "cli", "forge", "forgeHost", "repo", "pr", "baseSha", "headSha", "outcome", "review", "servers"]);

export function validateReviewEvent(json: unknown): { ok: true; event: ReviewEvent } | { ok: false; error: string } {
  const error = event(json);
  return error ? { ok: false, error } : { ok: true, event: json as ReviewEvent };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node test/events-check.mjs`
Expected: `events-check: all assertions passed`

- [ ] **Step 5: Register and commit**

Append `&& node test/events-check.mjs` to the `test` script in `package.json`, then:

```bash
git add src/cloud/events.ts test/events-check.mjs package.json
git commit -m "feat(cloud): the review event — facts only, closed schema, one validator for CLI and cloud"
```

### Task 2: `reviewAndHead` — the review plus the head side's servers

**Files:**
- Modify: `src/diff/review.ts:73-91` (`reviewRepo`, `reviewOf`)
- Test: `test/events-check.mjs` (append)

**Interfaces:**
- Produces: `export async function reviewAndHead(dir: string, base: string, head?: string): Promise<{ review: Review; headServers: McpServer[] }>`; `reviewOf` becomes `(await reviewAndHead(...)).review`.

- [ ] **Step 1: Append the failing test** (before the final `console.log` in `test/events-check.mjs`)

```js
  // --- reviewAndHead: the review AND the head side's servers, from a git repo
  const { reviewAndHead } = await import(path.resolve("dist/diff/review.js"));
  const { execFileSync } = await import("node:child_process");
  const repo = path.join(tmp, "repo");
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("add", "-A"); git("commit", "-q", "-m", "head");
  const base = git("rev-parse", "HEAD");
  const { review: r2, headServers } = await reviewAndHead(repo, base);
  assert.equal(r2.open, 0, "no change between HEAD and the working tree");
  assert.deepEqual(headServers.map((s) => s.name).sort(), ["docs", "files", "slack"], "the head side's servers come back");
  assert.equal(headServers.find((s) => s.name === "slack").literalSecrets?.[0], "SLACK_BOT_TOKEN");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && node test/events-check.mjs`
Expected: FAIL — `reviewAndHead is not a function`

- [ ] **Step 3: Implement** — replace `reviewOf` in `src/diff/review.ts`:

```ts
/** The review as data (what `--json` and `--strict` read). */
export async function reviewOf(dir: string, base: string, head?: string): Promise<Review> {
  return (await reviewAndHead(dir, base, head)).review;
}

/** The review plus the head side's servers (what the cloud event is built from). */
export async function reviewAndHead(dir: string, base: string, head?: string): Promise<{ review: Review; headServers: McpServer[] }> {
  const root = await gitRoot(dir);
  const baseSha = await resolveRef(root, base);
  const headSha = head ? await resolveRef(root, head) : null;
  const sides: Side[] = [];
  try {
    sides.push(await snapshot(root, baseSha));
    sides.push(await snapshot(root, headSha));
    const [b, h] = [await readSnapshot(sides[0]), await readSnapshot(sides[1])];
    return { review: compare(b, h), headServers: h.servers };
  } finally {
    for (const s of sides) await fs.rm(s.dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run tests** — `npm test` → every suite passes, including `events-check`.

- [ ] **Step 5: Commit**

```bash
git add src/diff/review.ts test/events-check.mjs
git commit -m "feat(diff): reviewAndHead returns the head side's servers for the cloud event"
```

### Task 3: `vexryn ci` posts the event when an org token is set

**Files:**
- Create: `src/cloud/client.ts`
- Modify: `src/ci/forges.ts` (`CiContext` gains `repo` and `runUrl`; `detect` fills them), `src/ci/run.ts`, `src/cli.ts` (help text)
- Test: `test/ci-cloud-check.mjs`

**Interfaces:**
- Consumes: `buildReviewEvent`, `validateReviewEvent` (Task 1); `reviewAndHead` (Task 2).
- Produces: `export const DEFAULT_CLOUD_URL = "https://app.vexryn.com"` (founder confirms the domain before 0.5.0); `export async function postReview(event: ReviewEvent, opts: { url: string; token: string }, fetchImpl = fetch): Promise<{ ok: true } | { ok: false; error: string }>`; `CiContext.repo: string`, `CiContext.runUrl?: string`.
- Env read by `ci`: `VEXRYN_ORG_TOKEN` (post when set), `VEXRYN_CLOUD_URL` (override).

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// `vexryn ci` → Vexryn Cloud, against a local mock cloud (nothing leaves this
// machine). Asserts: one POST /v1/reviews with the org token as a Bearer, a
// body the shared validator accepts, repo/pr/shas from the CI env, no secret
// value; no token → no request; cloud down → one warning line, same PR
// comment, same exit code, no stack trace.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import http from "node:http";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve("dist/cli.js");
const { validateReviewEvent } = await import(path.resolve("dist/cloud/events.js"));
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-cicloud-")));
const repo = path.join(tmp, "repo");
const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" }).trim();
const SECRET = "s3cr3t-value-never-sent-91ab";

const got = [];
const forge = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { res.writeHead(req.method === "GET" ? 200 : 201, { "content-type": "application/json" }); res.end(req.method === "GET" ? "[]" : "{}"); }); });
const cloud = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); res.writeHead(202, { "content-type": "application/json" }); res.end('{"ok":true}'); }); });
await new Promise((r) => forge.listen(0, "127.0.0.1", r));
await new Promise((r) => cloud.listen(0, "127.0.0.1", r));
const FORGE = `http://127.0.0.1:${forge.address().port}`;
const CLOUD = `http://127.0.0.1:${cloud.address().port}`;

try {
  mkdirSync(repo); mkdirSync(path.join(tmp, "home"));
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
  git("add", "-A"); git("commit", "-q", "-m", "base"); const c0 = git("rev-parse", "HEAD");
  git("checkout", "-q", "-b", "feature");
  writeFileSync(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { slack: { command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"], env: { SLACK_BOT_TOKEN: SECRET } } } }));
  git("add", "-A"); git("commit", "-q", "-m", "pr"); const f1 = git("rev-parse", "HEAD");
  git("checkout", "-q", "main"); git("merge", "-q", "--no-ff", "feature", "-m", "merge");
  const ev = path.join(tmp, "event.json");
  writeFileSync(ev, JSON.stringify({ pull_request: { number: 7, base: { sha: c0 }, head: { sha: f1 } } }));
  const env = (extra) => ({ PATH: process.env.PATH, VEXRYN_HOME: path.join(tmp, "home"), VEXRYN_CATALOG: path.join(tmp, "none.json"), GITHUB_ACTIONS: "true", GITHUB_API_URL: FORGE, GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "42", GITHUB_EVENT_PATH: ev, VEXRYN_TOKEN: "forge-tok", ...extra });
  const run = (extra) => spawnSync("node", [cli, "ci", repo], { encoding: "utf8", env: env(extra) });

  let r = run({ VEXRYN_ORG_TOKEN: "vx_test_org_token", VEXRYN_CLOUD_URL: CLOUD });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(got.length, 1, "exactly one event posted");
  assert.equal(got[0].method, "POST"); assert.equal(got[0].url, "/v1/reviews");
  assert.equal(got[0].auth, "Bearer vx_test_org_token");
  const v = validateReviewEvent(got[0].body); assert.equal(v.ok, true, v.error);
  assert.equal(got[0].body.repo, "o/r"); assert.equal(got[0].body.pr, "7");
  assert.equal(got[0].body.baseSha, c0); assert.equal(got[0].body.headSha, f1);
  assert.equal(got[0].body.runUrl, "https://github.com/o/r/actions/runs/42");
  assert.equal(got[0].body.outcome, "warn"); assert.ok(got[0].body.review.open >= 1);
  assert.doesNotMatch(JSON.stringify(got[0].body), new RegExp(SECRET));
  assert.match(r.stdout, /review sent to Vexryn Cloud/);

  got.length = 0;
  r = run({});
  assert.equal(got.length, 0, "no org token → nothing posted");
  assert.doesNotMatch(r.stdout + r.stderr, /Vexryn Cloud/);

  r = run({ VEXRYN_ORG_TOKEN: "vx_x", VEXRYN_CLOUD_URL: "http://127.0.0.1:1" });
  assert.equal(r.status, 0, "cloud down: exit code unchanged");
  assert.match(r.stderr, /could not send the review to Vexryn Cloud/);
  assert.doesNotMatch(r.stderr, /at .*\.js:\d+/, "no stack trace");
  assert.match(r.stdout, /### Vexryn — agent config review/, "the PR comment path still ran");
  console.log("ci-cloud-check: all assertions passed");
} finally {
  forge.close(); cloud.close();
  rmSync(tmp, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && node test/ci-cloud-check.mjs`
Expected: FAIL — `exactly one event posted` (0 ≠ 1)

- [ ] **Step 3: Implement**

`src/cloud/client.ts`:

```ts
// Posting the review event to Vexryn Cloud. Only when VEXRYN_ORG_TOKEN is set;
// the token goes in the Authorization header, never in the URL or the body.
import type { ReviewEvent } from "./events.js";

export const DEFAULT_CLOUD_URL = "https://app.vexryn.com"; // founder confirms the domain before 0.5.0 ships

export async function postReview(event: ReviewEvent, opts: { url: string; token: string }, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(`${opts.url.replace(/\/$/, "")}/v1/reviews`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json", "user-agent": `vexryn/${event.cli}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}
```

`src/ci/forges.ts` — add to `CiContext`:

```ts
  /** The repository as the forge names it (owner/name, workspace/slug, project path). */
  repo: string;
  /** This CI run's page, when the CI says it. */
  runUrl?: string;
```

and in `detect`, per forge (inside each returned object):

```ts
// github / forgejo / gitea
      repo: env.GITHUB_REPOSITORY ?? "",
      runUrl: env.GITHUB_RUN_ID ? `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined,
// gitlab
      repo: env.CI_PROJECT_PATH ?? env.CI_PROJECT_ID ?? "",
      runUrl: env.CI_JOB_URL || undefined,
// bitbucket
      repo: `${env.BITBUCKET_WORKSPACE ?? ""}/${env.BITBUCKET_REPO_SLUG ?? ""}`,
// azure
      repo: env.BUILD_REPOSITORY_NAME ?? env.BUILD_REPOSITORY_ID ?? "",
```

`src/ci/run.ts` — replace the review line and add the cloud step after the forge comment:

```ts
import { reviewAndHead } from "../diff/review.js";          // alongside the existing imports from review.js
import { buildReviewEvent } from "../cloud/events.js";
import { DEFAULT_CLOUD_URL, postReview } from "../cloud/client.js";
// …
  const { review, headServers } = await reviewAndHead(root, base.sha, "HEAD");
  const markdown = renderReview(review);
  process.stdout.write(markdown);
  // … (the forge comment block, unchanged) …
  if (env.VEXRYN_ORG_TOKEN) {
    const event = buildReviewEvent({
      cli: version, forge: ctx.forge, forgeHost: ctx.label, repo: ctx.repo, pr: ctx.pr,
      baseSha: base.sha, headSha: ctx.prHead ?? (await git(root, ["rev-parse", "HEAD"])), runUrl: ctx.runUrl,
      outcome: review.open === 0 ? "clean" : strict ? "block" : "warn", review, headServers,
    });
    const sent = await postReview(event, { url: env.VEXRYN_CLOUD_URL || DEFAULT_CLOUD_URL, token: env.VEXRYN_ORG_TOKEN });
    if (sent.ok) say("review sent to Vexryn Cloud.");
    else warn(`could not send the review to Vexryn Cloud (${sent.error}) — the comment above is unaffected.`);
  }
  return strictExit(strict, review.open);
```

`runCi` gains a `version: string` parameter: `export async function runCi(dir, env, strict, version)`; `src/cli.ts` passes `VERSION`. In `printHelp`, under `ci`, add the line `"      VEXRYN_ORG_TOKEN  Also send the review to Vexryn Cloud (facts only, never code or secrets)"`.

- [ ] **Step 4: Run tests** — `npm run build && node test/ci-cloud-check.mjs` → passes; then `npm test` (register `&& node test/ci-cloud-check.mjs` in `package.json`) → all green.

- [ ] **Step 5: Commit**

```bash
git add src/cloud/client.ts src/ci/forges.ts src/ci/run.ts src/cli.ts test/ci-cloud-check.mjs package.json
git commit -m "feat(ci): send the review to Vexryn Cloud when VEXRYN_ORG_TOKEN is set"
```

### Task 4: package exports, docs, 0.5.0

**Files:**
- Modify: `package.json` (version `0.5.0`, `exports`), `package-lock.json`, `src/cli.ts` (`VERSION`), `README.md` (one paragraph), `docs/integrations.md` (one paragraph)
- Test: `test/exports-check.mjs`

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// The package exposes the event validator to the cloud (and to anyone) at
// `vexryn/events`, and nothing else beyond the CLI binary.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = mkdtempSync(path.join(os.tmpdir(), "vexryn-exports-"));
try {
  const tgz = execFileSync("npm", ["pack", "--silent", "--pack-destination", tmp], { encoding: "utf8" }).trim();
  writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
  execFileSync("npm", ["install", "--silent", "--no-audit", "--no-fund", path.join(tmp, tgz)], { cwd: tmp });
  writeFileSync(path.join(tmp, "t.mjs"), 'import { validateReviewEvent } from "vexryn/events"; console.log(JSON.stringify(validateReviewEvent({})));');
  const out = execFileSync("node", ["t.mjs"], { cwd: tmp, encoding: "utf8" });
  assert.match(out, /"ok":false/, "the validator is importable from the installed package");
  assert.throws(() => execFileSync("node", ["--input-type=module", "-e", 'import "vexryn/diff/review.js"'], { cwd: tmp, stdio: "pipe" }), "internals are not exported");
  console.log("exports-check: all assertions passed");
} finally { rmSync(tmp, { recursive: true, force: true }); }
```

- [ ] **Step 2: Run it to verify it fails** — `npm run build && node test/exports-check.mjs` → FAIL: `Package subpath './events' is not defined by "exports"` (or module not found).

- [ ] **Step 3: Implement** — in `package.json`:

```json
  "version": "0.5.0",
  "exports": {
    "./events": { "types": "./dist/cloud/events.d.ts", "default": "./dist/cloud/events.js" },
    "./package.json": "./package.json"
  },
```

`src/cli.ts`: `const VERSION = "0.5.0";`. `package-lock.json`: set both `version` fields to `0.5.0`. README, after the `vexryn ci` paragraph: *"Teams: set `VEXRYN_ORG_TOKEN` in CI and `vexryn ci` also sends the review — facts only, never code or secrets — to Vexryn Cloud, where your organisation sees every agent-config change and the inventory it implies."* Same paragraph in `docs/integrations.md` under *One line in your CI*.

- [ ] **Step 4: Run tests** — register `&& node test/exports-check.mjs`; `npm test` → all green.

- [ ] **Step 5: Commit, tag, publish (founder confirms the domain in `DEFAULT_CLOUD_URL` and the publish in the browser)**

```bash
git add -A && git commit -m "feat: vexryn 0.5.0 — vexryn/events export; ci sends the review to Vexryn Cloud"
git push origin main && git tag -a v0.5.0 -m "vexryn 0.5.0" && git push origin v0.5.0
npm publish   # in the founder's terminal; browser confirmation
```

---

## Part B — the private cloud (`vexryn-cloud`)

Repository `~/Developer/vexryn-cloud`, GitHub `yl0n0ps/vexryn-cloud` **private** (`gh repo create yl0n0ps/vexryn-cloud --private --source . --push` — founder confirms before this runs). Local Postgres for tests: `brew install postgresql@17 && brew services start postgresql@17 && createdb vexryn_test`; `TEST_DATABASE_URL=postgres://localhost/vexryn_test`. In CI a `postgres:17` service (Task 10).

### Task 5: scaffold, database client, migrations

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `migrations/001_init.sql`, `src/db.ts`
- Test: `test/db-check.mjs`, `test/helpers.mjs`

**Interfaces:**
- Produces: `export const sql: postgres.Sql` (from `DATABASE_URL`), `export async function migrate(): Promise<string[]>` (applied file names), `export async function resetForTests(): Promise<void>` (drops and recreates the public schema; refuses unless `DATABASE_URL` contains `_test`), `export const newId = (): string` (16 bytes, base64url).

- [ ] **Step 1: Scaffold**

`package.json`:

```json
{
  "name": "vexryn-cloud", "version": "0.1.0", "private": true, "type": "module", "license": "UNLICENSED",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "node -e \"fs.rmSync('dist',{recursive:true,force:true})\" && tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "npm run build && node test/db-check.mjs && node test/auth-check.mjs && node test/orgs-check.mjs && node test/ingest-check.mjs && node test/pages-check.mjs"
  },
  "dependencies": { "postgres": "^3.4.9", "vexryn": "^0.5.0" },
  "devDependencies": { "typescript": "^5.6.0", "@types/node": "^22.0.0" }
}
```

`tsconfig.json`: copy `vexryn-scan/tsconfig.json` (ES2022, NodeNext, strict, `outDir: dist`, `rootDir: src`, declaration off). `.gitignore`: `node_modules`, `dist`, `.env`.

`migrations/001_init.sql`:

```sql
create table if not exists migrations (name text primary key, applied_at timestamptz not null default now());
create table orgs (id text primary key, name text not null, created_at timestamptz not null default now());
create table users (id text primary key, github_id bigint unique not null, login text not null, email text, created_at timestamptz not null default now());
create table members (org_id text not null references orgs(id) on delete cascade, user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('admin','approver','viewer')), primary key (org_id, user_id));
create table sessions (id text primary key, user_id text not null references users(id) on delete cascade, csrf text not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null);
create table org_tokens (id text primary key, org_id text not null references orgs(id) on delete cascade, label text not null,
  salt text not null, hash text not null, prefix text not null, created_by text references users(id),
  created_at timestamptz not null default now(), last_used_at timestamptz, revoked_at timestamptz);
create index on org_tokens (prefix);
create table review_events (id bigserial primary key, org_id text not null references orgs(id) on delete cascade,
  token_id text references org_tokens(id), received_at timestamptz not null default now(), sent_at timestamptz, cli text,
  forge text not null, forge_host text not null, repo text not null, pr text not null, base_sha text not null, head_sha text not null,
  run_url text, outcome text not null, open int not null, event jsonb not null);
create index on review_events (org_id, received_at desc);
create index on review_events (org_id, repo, received_at desc);
create table servers (event_id bigint not null references review_events(id) on delete cascade, org_id text not null, repo text not null,
  name text not null, client text not null, scope text not null, transport text not null, file text not null,
  package text, version text, eco text, pinned boolean, known boolean not null, deprecated boolean not null,
  powers text[] not null, receives text[] not null, literal_secrets text[] not null, tools int);
create index on servers (org_id, repo);
create table audit (id bigserial primary key, org_id text references orgs(id) on delete cascade, actor text, action text not null,
  detail jsonb, at timestamptz not null default now());
```

`src/db.ts`:

```ts
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
export const sql = postgres(url, { max: 10, idle_timeout: 20, onnotice: () => {} });
export const newId = (): string => randomBytes(16).toString("base64url");

/** Apply every migrations/*.sql not yet in the `migrations` table, in name order. */
export async function migrate(): Promise<string[]> {
  await sql.unsafe("create table if not exists migrations (name text primary key, applied_at timestamptz not null default now())");
  const files = (await readdir(new URL("../migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await sql`select name from migrations`).map((r) => r.name as string));
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const text = await readFile(new URL(`../migrations/${f}`, import.meta.url), "utf8");
    await sql.begin(async (tx) => { await tx.unsafe(text); await tx`insert into migrations (name) values (${f})`; });
    applied.push(f);
  }
  return applied;
}

/** Tests only: wipe the database. Refuses to run against anything not named *_test. */
export async function resetForTests(): Promise<void> {
  if (!/_test\b/.test(url!)) throw new Error("resetForTests refuses a database not named *_test");
  await sql.unsafe("drop schema public cascade; create schema public");
  await migrate();
}
```

- [ ] **Step 2: Write the failing test**

`test/helpers.mjs`:

```js
import { spawn } from "node:child_process";
import path from "node:path";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost/vexryn_test";
export const db = await import(path.resolve("dist/db.js"));

/** Start the server on a free port with env overrides; returns { url, stop }. */
export async function startServer(env = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn("node", [path.resolve("dist/server.js")], { env: { ...process.env, PORT: String(port), BASE_URL: `http://127.0.0.1:${port}`, GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 50)); }
  return { url: `http://127.0.0.1:${port}`, log: () => log, stop: () => child.kill() };
}
```

`test/db-check.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { db } from "./helpers.mjs";
await db.resetForTests();
assert.deepEqual(await db.migrate(), [], "a second migrate applies nothing");
const tables = (await db.sql`select tablename from pg_tables where schemaname = 'public' order by 1`).map((r) => r.tablename);
assert.deepEqual(tables, ["audit", "members", "migrations", "org_tokens", "orgs", "review_events", "servers", "sessions", "users"]);
assert.match(db.newId(), /^[A-Za-z0-9_-]{22}$/);
await assert.rejects(async () => { process.env.DATABASE_URL = "postgres://localhost/vexryn"; const m = await import("../dist/db.js?prod"); await m.resetForTests(); }, /refuses/);
await db.sql.end();
console.log("db-check: all assertions passed");
```

- [ ] **Step 3: Run it to verify it fails** — `npm install && npm run build && node test/db-check.mjs` → FAIL on the first `import` (no `dist/db.js`) until Step 1's `src/db.ts` compiles; then PASS. (Step 1 and the test are one deliverable: a schema that applies once.)

- [ ] **Step 4: Run** `node test/db-check.mjs` → `db-check: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git init -b main && git add -A && git commit -m "feat(cloud): scaffold, Postgres client, migrations, test harness"
```

### Task 6: HTTP server, pages, sessions, GitHub sign-in

**Files:**
- Create: `src/server.ts`, `src/http.ts`, `src/pages.ts`, `src/auth.ts`
- Test: `test/auth-check.mjs`

**Interfaces:**
- `src/http.ts` produces: `export interface Req { method: string; url: URL; headers: IncomingHttpHeaders; cookies: Record<string, string>; body(): Promise<string>; form(): Promise<URLSearchParams> }`, `export type Handler = (req: Req, params: Record<string, string>) => Promise<Res>`, `export type Res = { status: number; headers?: Record<string, string>; body: string }`, `export const html = (body: string, status = 200, headers = {}) => Res`, `export const redirect = (to: string, headers = {}) => Res`, `export const json = (data: unknown, status = 200, headers = {}) => Res`, `export class Router { on(method: string, pattern: string, h: Handler): this; handle(req: Req): Promise<Res> }` (pattern `/o/:org/settings` → params), `export const MAX_BODY = 1_000_000`, `export function cookie(name, value, opts: { maxAge?: number; clear?: boolean }): string`.
- `src/pages.ts` produces: `export const esc = (s: unknown) => string`, `export function layout(title: string, body: string, user?: { login: string } | null, csrf?: string): string` (brand CSS inline, nav).
- `src/auth.ts` produces: `export interface User { id: string; login: string; csrf: string }`, `export async function currentUser(req: Req): Promise<User | null>`, `export function csrfOk(user: User, form: URLSearchParams): boolean`, routes `GET /login`, `GET /auth/callback`, `POST /logout` mounted by `export function mountAuth(router: Router)`. OAuth endpoints come from `GITHUB_OAUTH_BASE` (default `https://github.com`) and `GITHUB_API_BASE` (default `https://api.github.com`) so tests can mock them.
- `src/server.ts`: builds the router, `GET /healthz` → `{ok:true}`, listens on `PORT`; runs `migrate()` first.

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// Sign-in with GitHub against a mock GitHub; sessions; CSRF; logout.
import assert from "node:assert/strict";
import http from "node:http";
import { db, startServer } from "./helpers.mjs";

const ACCESS = "oauth-access-test"; // a mock access token — deliberately not shaped like a real one
const gh = http.createServer((req, res) => {
  if (req.url.startsWith("/login/oauth/authorize")) { res.writeHead(200); return res.end("authorize page"); }
  if (req.url === "/login/oauth/access_token") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ access_token: ACCESS, token_type: "bearer" })); }
  if (req.url === "/user") { assert.equal(req.headers.authorization, `Bearer ${ACCESS}`); res.writeHead(200, { "content-type": "application/json" }); return res.end('{"id":12345,"login":"ana","email":"ana@example.com"}'); }
  res.writeHead(404); res.end();
});
await new Promise((r) => gh.listen(0, "127.0.0.1", r));
const GH = `http://127.0.0.1:${gh.address().port}`;
await db.resetForTests();
const s = await startServer({ GITHUB_OAUTH_BASE: GH, GITHUB_API_BASE: GH });
const noFollow = { redirect: "manual" };
try {
  let r = await fetch(`${s.url}/healthz`); assert.equal((await r.json()).ok, true);
  r = await fetch(`${s.url}/`, noFollow); assert.equal(r.status, 200); assert.match(await r.text(), /Sign in with GitHub/);
  r = await fetch(`${s.url}/login`, noFollow);
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get("location"));
  assert.equal(to.origin + to.pathname, `${GH}/login/oauth/authorize`);
  assert.equal(to.searchParams.get("client_id"), "cid");
  const state = to.searchParams.get("state"); assert.ok(state.length >= 16);
  const stateCookie = r.headers.get("set-cookie"); assert.match(stateCookie, /vx_state=.*HttpOnly/);
  r = await fetch(`${s.url}/auth/callback?code=abc&state=WRONG`, { ...noFollow, headers: { cookie: stateCookie.split(";")[0] } });
  assert.equal(r.status, 400, "a wrong state is refused");
  r = await fetch(`${s.url}/auth/callback?code=abc&state=${state}`, { ...noFollow, headers: { cookie: stateCookie.split(";")[0] } });
  assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/");
  const cookies = r.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith("vx_session=")).split(";")[0];
  assert.match(cookies.join("\n"), /vx_session=.*HttpOnly/);
  r = await fetch(`${s.url}/`, { headers: { cookie: session } }); const home = await r.text();
  assert.match(home, /ana/, "signed in"); assert.match(home, /New organisation/);
  const [u] = await db.sql`select login, github_id, email from users`; assert.deepEqual({ ...u, github_id: String(u.github_id) }, { login: "ana", github_id: "12345", email: "ana@example.com" });
  r = await fetch(`${s.url}/logout`, { method: "POST", headers: { cookie: session, "content-type": "application/x-www-form-urlencoded" }, body: "csrf=nope", ...noFollow });
  assert.equal(r.status, 403, "CSRF token required");
  const csrf = /name="csrf" value="([^"]+)"/.exec(home)[1];
  r = await fetch(`${s.url}/logout`, { method: "POST", headers: { cookie: session, "content-type": "application/x-www-form-urlencoded" }, body: `csrf=${csrf}`, ...noFollow });
  assert.equal(r.status, 302);
  r = await fetch(`${s.url}/`, { headers: { cookie: session } }); assert.match(await r.text(), /Sign in with GitHub/, "session gone");
  r = await fetch(`${s.url}/nope`); assert.equal(r.status, 404);
  console.log("auth-check: all assertions passed");
} finally { s.stop(); gh.close(); await db.sql.end(); }
```

- [ ] **Step 2: Run it to verify it fails** — `npm run build && node test/auth-check.mjs` → FAIL (no `dist/server.js`; `startServer` never sees `/healthz`).

- [ ] **Step 3: Implement**

`src/http.ts`:

```ts
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
export const MAX_BODY = 1_000_000;
export interface Req { method: string; url: URL; headers: IncomingHttpHeaders; cookies: Record<string, string>; body(): Promise<string>; form(): Promise<URLSearchParams> }
export type Res = { status: number; headers?: Record<string, string | string[]>; body: string };
export type Handler = (req: Req, params: Record<string, string>) => Promise<Res>;
export class TooLarge extends Error {}

export function wrap(raw: IncomingMessage, base: string): Req {
  const cookies: Record<string, string> = {};
  for (const part of (raw.headers.cookie ?? "").split(";")) { const i = part.indexOf("="); if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  let cached: Promise<string> | undefined;
  const body = () => (cached ??= new Promise<string>((resolve, reject) => {
    const declared = Number(raw.headers["content-length"] ?? 0);
    if (declared > MAX_BODY) return reject(new TooLarge());
    let size = 0; const chunks: Buffer[] = [];
    raw.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { raw.destroy(); reject(new TooLarge()); } else chunks.push(c); });
    raw.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    raw.on("error", reject);
  }));
  return { method: raw.method ?? "GET", url: new URL(raw.url ?? "/", base), headers: raw.headers, cookies, body, form: async () => new URLSearchParams(await body()) };
}
export const html = (body: string, status = 200, headers: Record<string, string | string[]> = {}): Res => ({ status, headers: { "content-type": "text/html; charset=utf-8", ...headers }, body });
export const json = (data: unknown, status = 200, headers: Record<string, string | string[]> = {}): Res => ({ status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });
export const redirect = (to: string, headers: Record<string, string | string[]> = {}): Res => ({ status: 302, headers: { location: to, ...headers }, body: "" });
export function cookie(name: string, value: string, opts: { maxAge?: number; clear?: boolean } = {}): string {
  const secure = process.env.BASE_URL?.startsWith("https") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${opts.clear ? 0 : opts.maxAge ?? 60 * 60 * 24 * 30}`;
}
export class Router {
  private routes: Array<{ method: string; re: RegExp; keys: string[]; h: Handler }> = [];
  on(method: string, pattern: string, h: Handler): this {
    const keys: string[] = [];
    const re = new RegExp("^" + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
    this.routes.push({ method, re, keys, h }); return this;
  }
  async handle(req: Req): Promise<Res> {
    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(req.url.pathname); if (!m) continue;
      return r.h(req, Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])));
    }
    return html("<h1>Not found</h1>", 404);
  }
}
export function send(res: ServerResponse, r: Res): void {
  res.writeHead(r.status, { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; img-src data:", ...r.headers });
  res.end(r.body);
}
```

`src/pages.ts`:

```ts
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const CSS = `:root{--navy:#0A0E27;--panel:#141A33;--blue:#4A90FF;--violet:#C46BFF;--coral:#FF5A4E;--amber:#E6B23C;--green:#37C98B;--muted:#8B93AC;--faint:#565E7E;--fg:#EEF1FA}
*{box-sizing:border-box}body{margin:0;background:var(--navy);color:var(--fg);font:15px/1.5 -apple-system,Segoe UI,Inter,sans-serif}
a{color:var(--blue)}nav{display:flex;gap:16px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--panel)}nav .brand{font-weight:700;letter-spacing:.02em;text-decoration:none;color:var(--fg)}nav .brand b{color:var(--blue)}
main{max-width:1100px;margin:0 auto;padding:16px}h1,h2{font-weight:600}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--panel);vertical-align:top}th{color:var(--muted);font-weight:500}
.card{background:var(--panel);border-radius:10px;padding:16px;margin:12px 0}.warn{color:var(--coral)}.ok{color:var(--green)}.muted{color:var(--muted)}.pill{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--navy);color:var(--violet);font-size:12px;margin:0 4px 2px 0}
input,button,select{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid var(--faint);background:var(--navy);color:var(--fg)}button{background:var(--blue);border-color:var(--blue);color:#fff;cursor:pointer}code{color:var(--amber)}
@media(max-width:700px){td,th{font-size:13px}}`;
export function layout(title: string, body: string, user?: { login: string } | null, csrf?: string): string {
  const who = user ? `<span class="muted">${esc(user.login)}</span><form method="post" action="/logout" style="display:inline"><input type="hidden" name="csrf" value="${esc(csrf)}"><button>Sign out</button></form>` : `<a href="/login">Sign in with GitHub</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Vexryn</title><style>${CSS}</style></head><body><nav><a class="brand" href="/">ve<b>x</b>ryn</a><span class="muted">cloud</span><span style="flex:1"></span>${who}</nav><main>${body}</main></body></html>`;
}
```

`src/auth.ts`:

```ts
import { randomBytes } from "node:crypto";
import { sql, newId } from "./db.js";
import { cookie, html, redirect, type Req, type Router } from "./http.js";
const OAUTH = () => (process.env.GITHUB_OAUTH_BASE ?? "https://github.com").replace(/\/$/, "");
const API = () => (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/$/, "");
export interface User { id: string; login: string; csrf: string }

export async function currentUser(req: Req): Promise<User | null> {
  const sid = req.cookies.vx_session; if (!sid) return null;
  const [row] = await sql`select u.id, u.login, s.csrf from sessions s join users u on u.id = s.user_id where s.id = ${sid} and s.expires_at > now()`;
  return row ? { id: row.id as string, login: row.login as string, csrf: row.csrf as string } : null;
}
/** Every state-changing form carries the session's CSRF token. */
export function csrfOk(user: User, form: URLSearchParams): boolean { return form.get("csrf") === user.csrf; }

export function mountAuth(r: Router): void {
  r.on("GET", "/login", async () => {
    const state = randomBytes(16).toString("base64url");
    const u = new URL(`${OAUTH()}/login/oauth/authorize`);
    u.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID ?? ""); u.searchParams.set("redirect_uri", `${process.env.BASE_URL}/auth/callback`);
    u.searchParams.set("scope", "read:user user:email"); u.searchParams.set("state", state);
    return redirect(u.href, { "set-cookie": cookie("vx_state", state, { maxAge: 600 }) });
  });
  r.on("GET", "/auth/callback", async (req) => {
    const code = req.url.searchParams.get("code"), state = req.url.searchParams.get("state");
    if (!code || !state || state !== req.cookies.vx_state) return html("<h1>Sign-in failed (state)</h1>", 400);
    const tok = await fetch(`${OAUTH()}/login/oauth/access_token`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${process.env.BASE_URL}/auth/callback` }) }).then((x) => x.json() as Promise<{ access_token?: string }>);
    if (!tok.access_token) return html("<h1>Sign-in failed (token)</h1>", 400);
    const gh = await fetch(`${API()}/user`, { headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json", "user-agent": "vexryn-cloud" } }).then((x) => x.json() as Promise<{ id: number; login: string; email?: string | null }>);
    if (!gh.id || !gh.login) return html("<h1>Sign-in failed (user)</h1>", 400);
    const [u] = await sql`insert into users (id, github_id, login, email) values (${newId()}, ${gh.id}, ${gh.login}, ${gh.email ?? null})
      on conflict (github_id) do update set login = excluded.login, email = coalesce(excluded.email, users.email) returning id`;
    const sid = newId();
    await sql`insert into sessions (id, user_id, csrf, expires_at) values (${sid}, ${u.id}, ${randomBytes(16).toString("base64url")}, now() + interval '30 days')`;
    return redirect("/", { "set-cookie": [cookie("vx_session", sid), cookie("vx_state", "", { clear: true })] });
  });
  r.on("POST", "/logout", async (req) => {
    const user = await currentUser(req); if (!user) return redirect("/");
    if (!csrfOk(user, await req.form())) return html("<h1>Forbidden</h1>", 403);
    await sql`delete from sessions where id = ${req.cookies.vx_session}`;
    return redirect("/", { "set-cookie": cookie("vx_session", "", { clear: true }) });
  });
}
```

`src/server.ts`:

```ts
import http from "node:http";
import { migrate } from "./db.js";
import { Router, TooLarge, html, json, send, wrap } from "./http.js";
import { currentUser, mountAuth } from "./auth.js";
import { layout } from "./pages.js";

export const router = new Router();
router.on("GET", "/healthz", async () => json({ ok: true }));
mountAuth(router);
router.on("GET", "/", async (req) => {
  const user = await currentUser(req);
  if (!user) return html(layout("Sign in", `<div class="card"><h1>Vexryn Cloud</h1><p>No AI coding agent gains a power in your company without it being seen, checked and traced.</p><p><a href="/login">Sign in with GitHub</a></p></div>`));
  const { homeFor } = await import("./orgs.js").catch(() => ({ homeFor: async () => `<p class="muted">New organisation — coming in the next task.</p>` }));
  return html(layout("Home", await homeFor(user), user, user.csrf));
});

export async function start(): Promise<http.Server> {
  await migrate();
  const base = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  const server = http.createServer(async (raw, res) => {
    try { send(res, await router.handle(wrap(raw, base))); }
    catch (e) { send(res, e instanceof TooLarge ? json({ error: "payload too large" }, 413) : (console.error(e), json({ error: "internal error" }, 500))); }
  });
  return server.listen(Number(process.env.PORT ?? 3000));
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, "/"))) start().then((s) => console.log(`vexryn-cloud listening on ${(s.address() as { port: number }).port}`));
```

The placeholder import of `./orgs.js` keeps Task 6 shippable; Task 7 replaces it with a real import.

- [ ] **Step 4: Run** — `npm run build && node test/auth-check.mjs` → `auth-check: all assertions passed`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cloud): http server, pages, sessions, GitHub sign-in"`

### Task 7: organisations, members, org tokens, settings page

**Files:**
- Create: `src/orgs.ts`, `src/tokens.ts`
- Modify: `src/server.ts` (replace the placeholder import with `import { homeFor, mountOrgs } from "./orgs.js"; mountOrgs(router);`)
- Test: `test/orgs-check.mjs`

**Interfaces:**
- `src/tokens.ts` produces: `export async function createToken(orgId: string, label: string, by: string | null): Promise<{ id: string; plaintext: string }>` (plaintext = `vx_` + 32 random bytes base64url; stored `salt` 16 bytes hex + `hash` = sha256(salt + plaintext) hex + `prefix` = first 10 chars), `export async function orgForToken(authorization: string | undefined): Promise<{ orgId: string; tokenId: string } | null>` (constant-time compare; updates `last_used_at`; null when revoked/unknown), `export async function revokeToken(orgId: string, tokenId: string): Promise<boolean>`.
- `src/orgs.ts` produces: `export async function homeFor(user: User): Promise<string>` (list of orgs + "New organisation" form), `export async function membership(user: User, orgId: string): Promise<Role | null>`, `export async function guard(req, orgId, minimum?)`, `export async function audit(orgId, actor, action, detail)`, `export function mountOrgs(router)`: `POST /orgs` (create; creator = admin), `GET /o/:org/settings` (members, tokens; admin sees forms), `POST /o/:org/tokens` (admin), `POST /o/:org/tokens/:tid/revoke` (admin), `POST /o/:org/members` (admin; by GitHub login of a user who has signed in; role), `POST /o/:org/members/:uid/remove` (admin). Every action → `audit` row.

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// Organisations, roles, org tokens (shown once, hashed, revocable, org-scoped).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { db, startServer } from "./helpers.mjs";
await db.resetForTests();
const s = await startServer();
const tokens = await import("../dist/tokens.js");
// two signed-in users, made directly (sign-in is covered by auth-check)
async function signIn(login, ghId) {
  const id = db.newId(); await db.sql`insert into users (id, github_id, login) values (${id}, ${ghId}, ${login})`;
  const sid = db.newId(); await db.sql`insert into sessions (id, user_id, csrf, expires_at) values (${sid}, ${id}, ${"csrf-" + login}, now() + interval '1 day')`;
  return { id, cookie: `vx_session=${sid}`, csrf: "csrf-" + login };
}
const post = (u, path, fields) => fetch(`${s.url}${path}`, { method: "POST", redirect: "manual", headers: { cookie: u.cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf: u.csrf, ...fields }) });
const get = (u, path) => fetch(`${s.url}${path}`, { headers: { cookie: u.cookie } }).then(async (r) => ({ status: r.status, text: await r.text() }));
try {
  const ana = await signIn("ana", 1), bob = await signIn("bob", 2);
  let r = await post(ana, "/orgs", { name: "Acme" }); assert.equal(r.status, 302);
  const orgId = r.headers.get("location").match(/^\/o\/([^/]+)/)[1];
  assert.equal((await db.sql`select role from members where org_id = ${orgId}`)[0].role, "admin", "the creator is admin");
  assert.equal((await get(bob, `/o/${orgId}/settings`)).status, 403, "not a member → 403");
  r = await post(ana, `/o/${orgId}/tokens`, { label: "ci" }); assert.equal(r.status, 200);
  const page = await r.text(); const plaintext = /vx_[A-Za-z0-9_-]{43}/.exec(page)[0];
  assert.match(page, /shown once/i);
  const [row] = await db.sql`select salt, hash, prefix, label from org_tokens where org_id = ${orgId}`;
  assert.equal(row.label, "ci"); assert.equal(row.prefix, plaintext.slice(0, 10));
  assert.equal(row.hash, createHash("sha256").update(row.salt + plaintext).digest("hex"), "stored hashed with a per-token salt");
  assert.doesNotMatch((await get(ana, `/o/${orgId}/settings`)).text, new RegExp(plaintext), "never shown again");
  assert.deepEqual((await tokens.orgForToken(`Bearer ${plaintext}`))?.orgId, orgId);
  assert.equal(await tokens.orgForToken("Bearer vx_nope"), null); assert.equal(await tokens.orgForToken(undefined), null);
  r = await post(ana, `/o/${orgId}/members`, { login: "bob", role: "viewer" }); assert.equal(r.status, 302);
  assert.equal((await get(bob, `/o/${orgId}/settings`)).status, 200, "viewer can read settings");
  const tid = (await db.sql`select id from org_tokens`)[0].id;
  assert.equal((await post(bob, `/o/${orgId}/tokens/${tid}/revoke`, {})).status, 403, "a viewer can't revoke");
  assert.equal((await post(bob, `/o/${orgId}/tokens`, { label: "x" })).status, 403, "a viewer can't create tokens");
  assert.equal((await post(ana, `/o/${orgId}/tokens/${tid}/revoke`, {})).status, 302);
  assert.equal(await tokens.orgForToken(`Bearer ${plaintext}`), null, "revoked → unusable");
  r = await post(ana, `/o/${orgId}/members`, { login: "zed", role: "viewer" }); assert.equal(r.status, 400, "unknown login: ask them to sign in first");
  assert.equal((await db.sql`select count(*)::int as n from audit where org_id = ${orgId}`)[0].n, 4, "create org, create token, add member, revoke token");
  assert.match((await get(ana, "/")).text, /Acme/);
  console.log("orgs-check: all assertions passed");
} finally { s.stop(); await db.sql.end(); }
```

- [ ] **Step 2: Run it to verify it fails** — `npm run build && node test/orgs-check.mjs` → FAIL: `Cannot find module '../dist/tokens.js'`.

- [ ] **Step 3: Implement**

`src/tokens.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql, newId } from "./db.js";
const digest = (salt: string, plaintext: string) => createHash("sha256").update(salt + plaintext).digest("hex");

export async function createToken(orgId: string, label: string, by: string | null): Promise<{ id: string; plaintext: string }> {
  const plaintext = "vx_" + randomBytes(32).toString("base64url");
  const salt = randomBytes(16).toString("hex"); const id = newId();
  await sql`insert into org_tokens (id, org_id, label, salt, hash, prefix, created_by) values (${id}, ${orgId}, ${label.slice(0, 80)}, ${salt}, ${digest(salt, plaintext)}, ${plaintext.slice(0, 10)}, ${by})`;
  return { id, plaintext };
}
export async function orgForToken(authorization: string | undefined): Promise<{ orgId: string; tokenId: string } | null> {
  const m = /^Bearer (vx_[A-Za-z0-9_-]{43})$/.exec(authorization ?? ""); if (!m) return null;
  const rows = await sql`select id, org_id, salt, hash from org_tokens where prefix = ${m[1].slice(0, 10)} and revoked_at is null`;
  for (const r of rows) {
    const a = Buffer.from(digest(r.salt as string, m[1]), "hex"), b = Buffer.from(r.hash as string, "hex");
    if (a.length === b.length && timingSafeEqual(a, b)) { await sql`update org_tokens set last_used_at = now() where id = ${r.id}`; return { orgId: r.org_id as string, tokenId: r.id as string }; }
  }
  return null;
}
export async function revokeToken(orgId: string, tokenId: string): Promise<boolean> {
  return (await sql`update org_tokens set revoked_at = now() where id = ${tokenId} and org_id = ${orgId} and revoked_at is null returning id`).length === 1;
}
```

`src/orgs.ts`:

```ts
import { sql, newId } from "./db.js";
import { html, redirect, type Req, type Res, type Router } from "./http.js";
import { currentUser, csrfOk, type User } from "./auth.js";
import { esc, layout } from "./pages.js";
import { createToken, revokeToken } from "./tokens.js";
export type Role = "admin" | "approver" | "viewer";
type Org = { id: string; name: string };

export async function membership(user: User, orgId: string): Promise<Role | null> {
  const [m] = await sql`select role from members where org_id = ${orgId} and user_id = ${user.id}`; return (m?.role as Role) ?? null;
}
export async function audit(orgId: string, actor: string, action: string, detail: unknown): Promise<void> { await sql`insert into audit (org_id, actor, action, detail) values (${orgId}, ${actor}, ${action}, ${sql.json(detail as never)})`; }

/** Resolve user + org + role for a `/o/:org/...` route, or the response to send instead. */
export async function guard(req: Req, orgId: string, minimum: Role = "viewer"): Promise<{ user: User; role: Role; org: Org } | { res: Res }> {
  const user = await currentUser(req); if (!user) return { res: redirect("/login") };
  const [org] = await sql`select id, name from orgs where id = ${orgId}`; if (!org) return { res: html("<h1>Not found</h1>", 404) };
  const role = await membership(user, orgId); const rank = { viewer: 0, approver: 1, admin: 2 };
  if (!role || rank[role] < rank[minimum]) return { res: html(layout("Forbidden", "<h1>Forbidden</h1>", user, user.csrf), 403) };
  return { user, role, org: { id: org.id as string, name: org.name as string } };
}
export async function homeFor(user: User): Promise<string> {
  const orgs = await sql`select o.id, o.name, m.role from orgs o join members m on m.org_id = o.id where m.user_id = ${user.id} order by o.name`;
  return `<div class="card"><h1>Your organisations</h1>${orgs.length ? `<ul>${orgs.map((o) => `<li><a href="/o/${esc(o.id)}">${esc(o.name)}</a> <span class="muted">${esc(o.role)}</span></li>`).join("")}</ul>` : `<p class="muted">None yet.</p>`}
  <form method="post" action="/orgs"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><input name="name" placeholder="Organisation name" required maxlength="80"> <button>New organisation</button></form></div>`;
}
const settingsPage = async (g: { user: User; role: Role; org: Org }, extra = "") => {
  const members = await sql`select u.id, u.login, m.role from members m join users u on u.id = m.user_id where m.org_id = ${g.org.id} order by u.login`;
  const tokens = await sql`select id, label, prefix, created_at, last_used_at, revoked_at from org_tokens where org_id = ${g.org.id} order by created_at desc`;
  const admin = g.role === "admin"; const csrf = `<input type="hidden" name="csrf" value="${esc(g.user.csrf)}">`;
  return layout(`${g.org.name} · settings`, `<h1>${esc(g.org.name)} <span class="muted">settings</span></h1><p><a href="/o/${esc(g.org.id)}">Timeline</a> · <a href="/o/${esc(g.org.id)}/inventory">Inventory</a></p>${extra}
  <div class="card"><h2>Org tokens <span class="muted">for CI and laptops — set as <code>VEXRYN_ORG_TOKEN</code></span></h2><table><tr><th>Label</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th></tr>
  ${tokens.map((t) => `<tr><td>${esc(t.label)}</td><td><code>${esc(t.prefix)}…</code></td><td>${esc(String(t.created_at).slice(0, 10))}</td><td>${t.revoked_at ? '<span class="warn">revoked</span>' : esc(t.last_used_at ? String(t.last_used_at).slice(0, 16) : "never")}</td><td>${admin && !t.revoked_at ? `<form method="post" action="/o/${esc(g.org.id)}/tokens/${esc(t.id)}/revoke">${csrf}<button>Revoke</button></form>` : ""}</td></tr>`).join("")}</table>
  ${admin ? `<form method="post" action="/o/${esc(g.org.id)}/tokens">${csrf}<input name="label" placeholder="Label (e.g. ci)" required maxlength="80"> <button>Create token</button></form>` : ""}</div>
  <div class="card"><h2>Members</h2><table><tr><th>GitHub login</th><th>Role</th><th></th></tr>${members.map((m) => `<tr><td>${esc(m.login)}</td><td>${esc(m.role)}</td><td>${admin && m.id !== g.user.id ? `<form method="post" action="/o/${esc(g.org.id)}/members/${esc(m.id)}/remove">${csrf}<button>Remove</button></form>` : ""}</td></tr>`).join("")}</table>
  ${admin ? `<form method="post" action="/o/${esc(g.org.id)}/members">${csrf}<input name="login" placeholder="GitHub login (must have signed in once)" required> <select name="role"><option>viewer</option><option>approver</option><option>admin</option></select> <button>Add member</button></form>` : ""}</div>`, g.user, g.user.csrf);
};
export function mountOrgs(r: Router): void {
  r.on("POST", "/orgs", async (req) => {
    const user = await currentUser(req); if (!user) return redirect("/login");
    const form = await req.form(); if (!csrfOk(user, form)) return html("<h1>Forbidden</h1>", 403);
    const name = (form.get("name") ?? "").trim().slice(0, 80); if (!name) return html("<h1>A name is required</h1>", 400);
    const id = newId();
    await sql.begin(async (tx) => { await tx`insert into orgs (id, name) values (${id}, ${name})`; await tx`insert into members (org_id, user_id, role) values (${id}, ${user.id}, 'admin')`; });
    await audit(id, user.login, "org.create", { name });
    return redirect(`/o/${id}/settings`);
  });
  r.on("GET", "/o/:org/settings", async (req, p) => { const g = await guard(req, p.org); return "res" in g ? g.res : html(await settingsPage(g)); });
  r.on("POST", "/o/:org/tokens", async (req, p) => {
    const g = await guard(req, p.org, "admin"); if ("res" in g) return g.res;
    const form = await req.form(); if (!csrfOk(g.user, form)) return html("<h1>Forbidden</h1>", 403);
    const label = (form.get("label") ?? "ci").trim() || "ci";
    const t = await createToken(g.org.id, label, g.user.id); await audit(g.org.id, g.user.login, "token.create", { label, prefix: t.plaintext.slice(0, 10) });
    return html(await settingsPage(g, `<div class="card"><h2 class="ok">Token created — shown once</h2><p>Copy it now into your CI secrets as <code>VEXRYN_ORG_TOKEN</code>:</p><p><code>${esc(t.plaintext)}</code></p></div>`));
  });
  r.on("POST", "/o/:org/tokens/:tid/revoke", async (req, p) => {
    const g = await guard(req, p.org, "admin"); if ("res" in g) return g.res;
    if (!csrfOk(g.user, await req.form())) return html("<h1>Forbidden</h1>", 403);
    if (await revokeToken(g.org.id, p.tid)) await audit(g.org.id, g.user.login, "token.revoke", { id: p.tid });
    return redirect(`/o/${g.org.id}/settings`);
  });
  r.on("POST", "/o/:org/members", async (req, p) => {
    const g = await guard(req, p.org, "admin"); if ("res" in g) return g.res;
    const form = await req.form(); if (!csrfOk(g.user, form)) return html("<h1>Forbidden</h1>", 403);
    const role = form.get("role") as Role; if (!["admin", "approver", "viewer"].includes(role)) return html("<h1>Bad role</h1>", 400);
    const [u] = await sql`select id from users where login = ${(form.get("login") ?? "").trim()}`;
    if (!u) return html(layout("Unknown user", `<h1>Unknown GitHub login</h1><p>Ask them to sign in to Vexryn Cloud once, then add them.</p>`, g.user, g.user.csrf), 400);
    await sql`insert into members (org_id, user_id, role) values (${g.org.id}, ${u.id}, ${role}) on conflict (org_id, user_id) do update set role = excluded.role`;
    await audit(g.org.id, g.user.login, "member.add", { login: form.get("login"), role });
    return redirect(`/o/${g.org.id}/settings`);
  });
  r.on("POST", "/o/:org/members/:uid/remove", async (req, p) => {
    const g = await guard(req, p.org, "admin"); if ("res" in g) return g.res;
    if (!csrfOk(g.user, await req.form())) return html("<h1>Forbidden</h1>", 403);
    if (p.uid !== g.user.id) { await sql`delete from members where org_id = ${g.org.id} and user_id = ${p.uid}`; await audit(g.org.id, g.user.login, "member.remove", { userId: p.uid }); }
    return redirect(`/o/${g.org.id}/settings`);
  });
}
```

- [ ] **Step 4: Run** — `npm run build && node test/orgs-check.mjs` → passes; `node test/auth-check.mjs` still passes.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cloud): organisations, roles, org tokens (shown once, hashed, revocable), settings"`

### Task 8: ingest — `POST /v1/reviews`, storage, derived inventory

**Files:**
- Create: `src/ingest.ts`
- Modify: `src/server.ts` (`mountIngest(router)`)
- Test: `test/ingest-check.mjs`

**Interfaces:**
- Produces: `POST /v1/reviews` (Bearer org token; body ≤ 1 MB; `validateReviewEvent` from `vexryn/events`; 401 bad/revoked token, 413 too large, 400 invalid with `{error}`, 429 over 600 events/token/hour, 202 `{ok:true,id}`); `export async function store(orgId, tokenId, event): Promise<number>`; `export async function inventory(orgId: string): Promise<InventoryRow[]>` where `InventoryRow = { repo: string; name: string; client: string; file: string; package: string | null; version: string | null; pinned: boolean | null; known: boolean; deprecated: boolean; powers: string[]; literalSecrets: string[]; lastSeen: string; lastPr: string }` (from the latest event per `(org, repo)`), `export async function timeline(orgId, opts: { repo?: string; from?: string; to?: string; limit?: number })`.

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// The ingest endpoint and what the cloud derives from events.
import assert from "node:assert/strict";
import { db, startServer } from "./helpers.mjs";
await db.resetForTests();
const s = await startServer();
const tokens = await import("../dist/tokens.js"); const ingest = await import("../dist/ingest.js");
const orgA = db.newId(), orgB = db.newId();
await db.sql`insert into orgs (id, name) values (${orgA}, 'A'), (${orgB}, 'B')`;
const tA = await tokens.createToken(orgA, "ci", null), tB = await tokens.createToken(orgB, "ci", null);
const event = (over = {}) => ({ schema: "vexryn.review/1", sentAt: new Date().toISOString(), cli: "0.5.0", forge: "github", forgeHost: "github.com", repo: "acme/app", pr: "7", baseSha: "a".repeat(40), headSha: "b".repeat(40), outcome: "warn",
  review: { powers: ["⚠️ New MCP server `slack` <sub>vx-01234567</sub>"], accepted: 0, loads: [], changed: [".mcp.json"], unreviewed: [], open: 1 },
  servers: [{ name: "slack", client: "Claude Code", scope: "project", transport: "stdio", file: ".mcp.json", package: "@modelcontextprotocol/server-slack", version: "2025.4.25", eco: "npm", pinned: true, known: true, deprecated: true, receives: ["SLACK_BOT_TOKEN"], literalSecrets: [], powers: ["external-message.send"], tools: 8 }], ...over });
const post = (body, token = tA.plaintext, headers = {}) => fetch(`${s.url}/v1/reviews`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
try {
  let r = await post(event()); assert.equal(r.status, 202, await r.text());
  assert.equal((await db.sql`select count(*)::int as n from review_events where org_id = ${orgA}`)[0].n, 1);
  assert.equal((await db.sql`select count(*)::int as n from servers where org_id = ${orgA}`)[0].n, 1);
  r = await post(event(), "vx_" + "x".repeat(43)); assert.equal(r.status, 401);
  r = await post(event({ extra: 1 })); assert.equal(r.status, 400); assert.match((await r.json()).error, /unknown key "extra"/);
  r = await post("{not json"); assert.equal(r.status, 400);
  r = await post("x".repeat(2_000_000)); assert.equal(r.status, 413, "too large, refused before parsing");
  assert.equal((await db.sql`select count(*)::int as n from review_events`)[0].n, 1, "nothing stored by the refused requests");
  // a re-run of the same PR: both events kept; inventory = latest
  r = await post(event({ servers: [{ ...event().servers[0], name: "slack", version: "2025.5.1" }, { name: "files", client: "Claude Code", scope: "project", transport: "stdio", file: ".mcp.json", known: false, deprecated: false, receives: [], literalSecrets: [], powers: [] }] }));
  assert.equal(r.status, 202);
  const tl = await ingest.timeline(orgA, {}); assert.equal(tl.length, 2, "both events in the timeline");
  const inv = await ingest.inventory(orgA);
  assert.deepEqual(inv.map((x) => [x.repo, x.name, x.version]).sort(), [["acme/app", "files", null], ["acme/app", "slack", "2025.5.1"]], "inventory = latest event per repo");
  assert.equal(inv.find((x) => x.name === "slack").lastPr, "7");
  // org B's token can't write into A, and B sees nothing of A
  r = await post(event({ repo: "acme/other" }), tB.plaintext); assert.equal(r.status, 202);
  assert.equal((await ingest.inventory(orgB)).length, 1); assert.equal((await ingest.inventory(orgA)).length, 2);
  assert.equal((await db.sql`select count(*)::int as n from review_events where org_id = ${orgB}`)[0].n, 1);
  // revoked → 401, nothing stored
  await tokens.revokeToken(orgB, tB.id); r = await post(event(), tB.plaintext); assert.equal(r.status, 401);
  assert.equal((await db.sql`select count(*)::int as n from review_events where org_id = ${orgB}`)[0].n, 1);
  // rate limit: 600 per token per hour
  for (let i = 0; i < 598; i++) await db.sql`insert into review_events (org_id, token_id, forge, forge_host, repo, pr, base_sha, head_sha, outcome, open, event) values (${orgA}, ${tA.id}, 'github', 'github.com', 'r', '1', 'a', 'b', 'clean', 0, '{}')`;
  r = await post(event()); assert.equal(r.status, 429);
  console.log("ingest-check: all assertions passed");
} finally { s.stop(); await db.sql.end(); }
```

- [ ] **Step 2: Run it to verify it fails** — `npm run build && node test/ingest-check.mjs` → FAIL: `Cannot find module '../dist/ingest.js'`.

- [ ] **Step 3: Implement**

`src/ingest.ts`:

```ts
import { validateReviewEvent, type ReviewEvent } from "vexryn/events";
import { sql } from "./db.js";
import { json, type Router } from "./http.js";
import { orgForToken } from "./tokens.js";
const PER_HOUR = 600;

export function mountIngest(r: Router): void {
  r.on("POST", "/v1/reviews", async (req) => {
    const who = await orgForToken(req.headers.authorization); if (!who) return json({ error: "unauthorized" }, 401);
    const [{ n }] = await sql`select count(*)::int as n from review_events where token_id = ${who.tokenId} and received_at > now() - interval '1 hour'`;
    if (n >= PER_HOUR) return json({ error: "rate limited" }, 429, { "retry-after": "3600" });
    let parsed: unknown; try { parsed = JSON.parse(await req.body()); } catch (e) { if (e instanceof Error && e.name === "SyntaxError") return json({ error: "invalid JSON" }, 400); throw e; }
    const v = validateReviewEvent(parsed); if (!v.ok) return json({ error: v.error }, 400);
    const id = await store(who.orgId, who.tokenId, v.event);
    return json({ ok: true, id }, 202);
  });
}
export async function store(orgId: string, tokenId: string, e: ReviewEvent): Promise<number> {
  return sql.begin(async (tx) => {
    const [row] = await tx`insert into review_events (org_id, token_id, sent_at, cli, forge, forge_host, repo, pr, base_sha, head_sha, run_url, outcome, open, event)
      values (${orgId}, ${tokenId}, ${e.sentAt}, ${e.cli}, ${e.forge}, ${e.forgeHost}, ${e.repo}, ${e.pr}, ${e.baseSha}, ${e.headSha}, ${e.runUrl ?? null}, ${e.outcome}, ${e.review.open}, ${tx.json(e as never)}) returning id`;
    for (const s of e.servers) await tx`insert into servers (event_id, org_id, repo, name, client, scope, transport, file, package, version, eco, pinned, known, deprecated, powers, receives, literal_secrets, tools)
      values (${row.id}, ${orgId}, ${e.repo}, ${s.name}, ${s.client}, ${s.scope}, ${s.transport}, ${s.file}, ${s.package ?? null}, ${s.version ?? null}, ${s.eco ?? null}, ${s.pinned ?? null}, ${s.known}, ${s.deprecated}, ${s.powers}, ${s.receives}, ${s.literalSecrets}, ${s.tools ?? null})`;
    return Number(row.id);
  });
}
export interface InventoryRow { repo: string; name: string; client: string; file: string; package: string | null; version: string | null; pinned: boolean | null; known: boolean; deprecated: boolean; powers: string[]; literalSecrets: string[]; lastSeen: string; lastPr: string }
/** The servers of the latest event per repository. */
export async function inventory(orgId: string): Promise<InventoryRow[]> {
  const rows = await sql`with latest as (select distinct on (repo) id, repo, pr, received_at from review_events where org_id = ${orgId} order by repo, received_at desc)
    select s.repo, s.name, s.client, s.file, s.package, s.version, s.pinned, s.known, s.deprecated, s.powers, s.literal_secrets, l.received_at, l.pr
    from servers s join latest l on l.id = s.event_id order by s.repo, s.name`;
  return rows.map((r) => ({ repo: r.repo, name: r.name, client: r.client, file: r.file, package: r.package, version: r.version, pinned: r.pinned, known: r.known, deprecated: r.deprecated, powers: r.powers, literalSecrets: r.literal_secrets, lastSeen: new Date(r.received_at).toISOString(), lastPr: r.pr }));
}
export async function timeline(orgId: string, o: { repo?: string; from?: string; to?: string; limit?: number }) {
  const limit = Math.min(o.limit ?? 200, 1000);
  return sql`select id, received_at, forge, forge_host, repo, pr, head_sha, run_url, outcome, open, event from review_events where org_id = ${orgId}
    ${o.repo ? sql`and repo = ${o.repo}` : sql``} ${o.from ? sql`and received_at >= ${o.from}` : sql``} ${o.to ? sql`and received_at < ${o.to}` : sql``}
    order by received_at desc limit ${limit}`;
}
```

In `src/server.ts`: `import { mountIngest } from "./ingest.js"; mountIngest(router);`. A `TooLarge` thrown by `req.body()` propagates to `start()`'s catch → 413 before any parsing.

Deferred to plan 4 (dashboard + settings), on purpose: the 13-month retention job and "delete my organisation" (spec §11) — both need the settings page's data-deletion flow, which plan 4 owns.

- [ ] **Step 4: Run** — `npm run build && node test/ingest-check.mjs` → passes.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cloud): POST /v1/reviews — validated, org-scoped, rate-limited; derived inventory and timeline"`

### Task 9: timeline, inventory, CSV export

**Files:**
- Create: `src/views.ts`
- Modify: `src/server.ts` (`mountViews(router)`)
- Test: `test/pages-check.mjs`

**Interfaces:**
- Routes: `GET /o/:org` (timeline; `?repo=&from=&to=`), `GET /o/:org/inventory`, `GET /o/:org/export/timeline.csv?from=&to=`, `GET /o/:org/export/inventory.csv`. All members. CSV cells quoted (`"` doubled); a cell starting with `=`, `+`, `-`, `@` is prefixed with `'` (spreadsheet formula injection).

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// The pages show what was posted — as text, never as HTML — and the CSV is safe.
import assert from "node:assert/strict";
import { db, startServer } from "./helpers.mjs";
await db.resetForTests();
const s = await startServer();
const tokens = await import("../dist/tokens.js"); const ingest = await import("../dist/ingest.js");
const org = db.newId(); await db.sql`insert into orgs (id, name) values (${org}, 'Acme')`;
const uid = db.newId(); await db.sql`insert into users (id, github_id, login) values (${uid}, 9, 'ana')`; await db.sql`insert into members values (${org}, ${uid}, 'viewer')`;
const sid = db.newId(); await db.sql`insert into sessions (id, user_id, csrf, expires_at) values (${sid}, ${uid}, 'c', now() + interval '1 day')`;
const t = await tokens.createToken(org, "ci", null);
const HOSTILE = '<img src=x onerror=alert(1)>';
await ingest.store(org, t.id, { schema: "vexryn.review/1", sentAt: new Date().toISOString(), cli: "0.5.0", forge: "gitlab", forgeHost: "GitLab", repo: "acme/app", pr: "3", baseSha: "a".repeat(40), headSha: "b".repeat(40), runUrl: "https://gitlab.com/acme/app/-/jobs/1", outcome: "block",
  review: { powers: [`⚠️ New MCP server \`${HOSTILE}\` <sub>vx-deadbeef</sub>`], accepted: 0, loads: [], changed: [".mcp.json"], unreviewed: [], open: 1 },
  servers: [{ name: HOSTILE, client: "Cursor", scope: "project", transport: "stdio", file: ".cursor/mcp.json", package: "=HYPERLINK(\"x\")", known: false, deprecated: false, receives: [], literalSecrets: ["API_KEY"], powers: ["file.read"] }] });
const get = (p) => fetch(`${s.url}${p}`, { headers: { cookie: `vx_session=${sid}` }, redirect: "manual" });
try {
  let r = await get(`/o/${org}`); assert.equal(r.status, 200); let page = await r.text();
  assert.match(page, /acme\/app/); assert.match(page, /#3/); assert.match(page, /block/); assert.match(page, /vx-deadbeef/);
  assert.doesNotMatch(page, /<img src=x/, "hostile name is escaped"); assert.match(page, /&lt;img src=x/);
  assert.match(page, /href="https:\/\/gitlab\.com\/acme\/app\/-\/jobs\/1"/, "the run link is a link");
  r = await get(`/o/${org}/inventory`); page = await r.text();
  assert.doesNotMatch(page, /<img src=x/); assert.match(page, /Cursor/); assert.match(page, /read files/); assert.match(page, /API_KEY/, "the NAME of a literal secret is shown");
  assert.match(page, /unknown in the catalogue/, "not in the catalogue is said");
  r = await get(`/o/${org}/export/inventory.csv`); assert.equal(r.headers.get("content-type"), "text/csv; charset=utf-8");
  const csv = await r.text(); assert.match(csv, /^repo,name,client,file,package,version,pinned,known,deprecated,powers,literal_secrets,last_seen,last_pr\r\n/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/, "formula-looking cells are neutralised and quotes doubled");
  r = await get(`/o/${org}/export/timeline.csv?from=2020-01-01&to=2100-01-01`); assert.match(await r.text(), /"gitlab","GitLab","acme\/app","3",/);
  r = await fetch(`${s.url}/o/${org}`, { redirect: "manual" }); assert.equal(r.status, 302, "anonymous → login");
  console.log("pages-check: all assertions passed");
} finally { s.stop(); await db.sql.end(); }
```

- [ ] **Step 2: Run it to verify it fails** — `npm run build && node test/pages-check.mjs` → FAIL: 404 on `/o/:org`.

- [ ] **Step 3: Implement** — `src/views.ts`:

```ts
import { html, type Router, type Res } from "./http.js";
import { esc, layout } from "./pages.js";
import { guard } from "./orgs.js";
import { inventory, timeline } from "./ingest.js";
const LABEL: Record<string, string> = { "payment.transfer": "move money", "credential.change": "change credentials", "data.delete": "delete records", "file.share": "share files", "permission.escalate": "escalate permissions", "schedule.create": "schedule actions", "memory.write": "write memory", "external-message.send": "send messages to external recipients", "file.read": "read files", "file.write": "create, edit or delete files", "shell.exec": "run commands or code", "network.fetch": "access the network" };
const pills = (ps: string[]) => ps.map((p) => `<span class="pill">${esc(LABEL[p] ?? p)}</span>`).join("");
const nav = (id: string, name: string, here: string) => `<h1>${esc(name)} <span class="muted">${here}</span></h1><p><a href="/o/${esc(id)}">Timeline</a> · <a href="/o/${esc(id)}/inventory">Inventory</a> · <a href="/o/${esc(id)}/settings">Settings</a></p>`;
const csvCell = (v: unknown) => { let s = Array.isArray(v) ? v.join(" ") : v == null ? "" : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
const csv = (header: string[], rows: unknown[][]): Res => ({ status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment" }, body: [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n" });

export function mountViews(r: Router): void {
  r.on("GET", "/o/:org", async (req, p) => {
    const g = await guard(req, p.org); if ("res" in g) return g.res;
    const q = req.url.searchParams; const rows = await timeline(g.org.id, { repo: q.get("repo") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    const body = rows.length ? `<table><tr><th>When</th><th>Repository</th><th>PR</th><th>Outcome</th><th>What the agent may now do</th></tr>${rows.map((e) => {
      const lines: string[] = e.event?.review?.powers ?? [];
      const out = e.outcome === "block" ? '<span class="warn">block</span>' : e.outcome === "warn" ? '<span style="color:var(--amber)">warn</span>' : '<span class="ok">clean</span>';
      return `<tr><td class="muted">${esc(new Date(e.received_at).toISOString().slice(0, 16).replace("T", " "))}</td><td>${esc(e.repo)}</td><td>${e.run_url ? `<a href="${esc(e.run_url)}">#${esc(e.pr)}</a>` : `#${esc(e.pr)}`}<br><span class="muted">${esc(e.forge_host)}</span></td><td>${out}<br><span class="muted">${esc(e.open)} open</span></td><td>${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l.replace(/<\/?sub>/g, ""))}</li>`).join("")}</ul>` : '<span class="muted">no change in powers</span>'}</td></tr>`; }).join("")}</table>`
      : `<div class="card"><p>No review yet. Set <code>VEXRYN_ORG_TOKEN</code> in CI (Settings → Org tokens) and open a pull request that touches an agent config.</p></div>`;
    return html(layout(`${g.org.name} · timeline`, `${nav(g.org.id, g.org.name, "timeline")}<form method="get"><input name="repo" placeholder="repository" value="${esc(q.get("repo"))}"> <input name="from" type="date" value="${esc(q.get("from"))}"> <input name="to" type="date" value="${esc(q.get("to"))}"> <button>Filter</button> <a href="/o/${esc(g.org.id)}/export/timeline.csv?${esc(q.toString())}">Export CSV</a></form>${body}`, g.user, g.user.csrf));
  });
  r.on("GET", "/o/:org/inventory", async (req, p) => {
    const g = await guard(req, p.org); if ("res" in g) return g.res;
    const rows = await inventory(g.org.id);
    const body = `<table><tr><th>Repository</th><th>Server</th><th>Agent</th><th>Package</th><th>Can</th><th>Flags</th><th>Last seen</th></tr>${rows.map((x) => `<tr><td>${esc(x.repo)}</td><td>${esc(x.name)}<br><span class="muted">${esc(x.file)}</span></td><td>${esc(x.client)}</td><td>${x.package ? `${esc(x.package)}${x.version ? "@" + esc(x.version) : ""}${x.pinned === false ? ' <span class="warn">not pinned</span>' : ""}` : '<span class="muted">—</span>'}${x.known ? "" : ' <span class="muted">(unknown in the catalogue)</span>'}</td><td>${pills(x.powers)}</td><td>${x.deprecated ? '<span class="warn">deprecated</span> ' : ""}${x.literalSecrets.length ? `<span class="warn">secret in file: ${esc(x.literalSecrets.join(", "))}</span>` : ""}</td><td class="muted">${esc(x.lastSeen.slice(0, 10))} · #${esc(x.lastPr)}</td></tr>`).join("")}</table>`;
    return html(layout(`${g.org.name} · inventory`, `${nav(g.org.id, g.org.name, "inventory")}<p><a href="/o/${esc(g.org.id)}/export/inventory.csv">Export CSV</a></p>${rows.length ? body : '<div class="card"><p class="muted">Nothing yet.</p></div>'}`, g.user, g.user.csrf));
  });
  r.on("GET", "/o/:org/export/inventory.csv", async (req, p) => {
    const g = await guard(req, p.org); if ("res" in g) return g.res;
    return csv(["repo", "name", "client", "file", "package", "version", "pinned", "known", "deprecated", "powers", "literal_secrets", "last_seen", "last_pr"], (await inventory(g.org.id)).map((x) => [x.repo, x.name, x.client, x.file, x.package, x.version, x.pinned, x.known, x.deprecated, x.powers, x.literalSecrets, x.lastSeen, x.lastPr]));
  });
  r.on("GET", "/o/:org/export/timeline.csv", async (req, p) => {
    const g = await guard(req, p.org); if ("res" in g) return g.res; const q = req.url.searchParams;
    const rows = await timeline(g.org.id, { repo: q.get("repo") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, limit: 1000 });
    return csv(["received_at", "forge", "forge_host", "repo", "pr", "head_sha", "outcome", "open", "run_url", "findings"], rows.map((e) => [new Date(e.received_at).toISOString(), e.forge, e.forge_host, e.repo, e.pr, e.head_sha, e.outcome, e.open, e.run_url, (e.event?.review?.powers ?? []).join(" | ")]));
  });
}
```

In `src/server.ts`: `import { mountViews } from "./views.js"; mountViews(router);`. Patterns are exact-match regexes, so `/o/:org` and `/o/:org/settings` never collide whatever the order.

- [ ] **Step 4: Run** — `npm test` → all five cloud suites pass.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cloud): timeline, inventory, CSV export — every repo string escaped"`

### Task 10: container, CI, deployment on Scaleway (Paris)

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `docs/deploy.md`

- [ ] **Step 1: Dockerfile and ignore**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY migrations ./migrations
RUN npm run build && npm prune --omit=dev
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

`.dockerignore`: `node_modules`, `dist`, `test`, `.git`, `.env`.

- [ ] **Step 2: CI workflow** — `.github/workflows/ci.yml`:

```yaml
on: [push, pull_request]
permissions: { contents: read }
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_USER: vexryn, POSTGRES_PASSWORD: vexryn, POSTGRES_DB: vexryn_test }
        ports: ["5432:5432"]
        options: --health-cmd "pg_isready -U vexryn" --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af # v4
        with: { node-version: 22 }
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm test
        env: { TEST_DATABASE_URL: postgres://vexryn:vexryn@localhost:5432/vexryn_test }
      - run: docker build -t vexryn-cloud .
```

- [ ] **Step 3: Deployment runbook** — `docs/deploy.md` (founder creates the Scaleway account and the GitHub OAuth app; the keys never enter the repo):

```markdown
# Deploy — Scaleway, Paris (fr-par)
1. Founder: Scaleway account + project "vexryn"; API key → `scw init`. GitHub OAuth App (Settings → Developer settings → OAuth Apps): homepage `https://<domain>`, callback `https://<domain>/auth/callback` → client id + secret.
2. Database: `scw rdb instance create name=vexryn-db engine=PostgreSQL-16 node-type=DB-DEV-S is-ha-cluster=false user-name=vexryn password=<generated> region=fr-par` → note the endpoint; create db `vexryn`. Backups: enabled by default (daily, 7 days).
3. Registry: `scw registry namespace create name=vexryn region=fr-par`; `docker build -t rg.fr-par.scw.cloud/vexryn/cloud:$(git rev-parse --short HEAD) . && docker push rg.fr-par.scw.cloud/vexryn/cloud:<tag>`.
4. Container: `scw container namespace create name=vexryn region=fr-par`; `scw container container create namespace-id=<ns> name=app registry-image=rg.fr-par.scw.cloud/vexryn/cloud:<tag> port=8080 min-scale=1 max-scale=2 memory-limit=512 cpu-limit=500 http-option=redirected` with secret environment variables `DATABASE_URL` (`postgres://vexryn:<pw>@<endpoint>:5432/vexryn?sslmode=require`), `GITHUB_CLIENT_SECRET`, and environment variables `BASE_URL` (`https://<domain>`), `GITHUB_CLIENT_ID`; then `scw container container deploy <id>`.
5. Domain: `scw container domain create container-id=<id> hostname=<domain>` + CNAME at the registrar; TLS is issued by Scaleway.
6. Check: `curl https://<domain>/healthz` → `{"ok":true}`; sign in; create the first organisation and token.
7. Release: tag → build → push → `scw container container update <id> registry-image=<image>:<tag>` → `deploy`. Rollback = the previous tag.
Cost: DEV-S ≈ €11/month + container ≈ €5–10/month.
```

- [ ] **Step 4: Verify locally** — `docker build -t vexryn-cloud . && docker run --rm -e DATABASE_URL=postgres://host.docker.internal/vexryn_test -e BASE_URL=http://localhost:8080 -e GITHUB_CLIENT_ID=x -e GITHUB_CLIENT_SECRET=y -p 8080:8080 vexryn-cloud` → `curl localhost:8080/healthz` → `{"ok":true}`.
- [ ] **Step 5: Commit, create the private repo (founder confirms), push, watch CI**

```bash
git add -A && git commit -m "ops(cloud): container, CI with Postgres, Scaleway deployment runbook"
gh repo create yl0n0ps/vexryn-cloud --private --source . --push
```

### Task 11: dogfood — this repository's own PRs feed the cloud

**Files (in `vexryn-scan`):**
- Modify: `.github/workflows/vexryn.yml` (add `VEXRYN_ORG_TOKEN: ${{ secrets.VEXRYN_ORG_TOKEN }}` and `VEXRYN_CLOUD_URL` to the step's env)

- [ ] **Step 1:** After the cloud is deployed (Task 10 step 6), the founder creates the organisation "Vexryn" and a token labelled `vexryn-scan ci`, and adds it as the repository secret `VEXRYN_ORG_TOKEN` (`gh secret set VEXRYN_ORG_TOKEN --repo yl0n0ps/vexryn-scan`, pasted from the clipboard, never from a file in the repo).
- [ ] **Step 2:** Update the workflow:

```yaml
      - uses: ./
        env:
          VEXRYN_ORG_TOKEN: ${{ secrets.VEXRYN_ORG_TOKEN }}
          VEXRYN_CLOUD_URL: https://<domain>
```

(`action.yml`'s step inherits the job env; the composite step passes `env` through.) For the demo PR #1: push an empty commit on `demo/agent-config-review` → the timeline shows it, with its three ⚠ lines and `outcome: warn`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/vexryn.yml && git commit -m "ci: this repo's reviews feed Vexryn Cloud (dogfood)" && git push origin main
```

- [ ] **Step 4:** `/code-review high` on both repositories; fix Critical/Important RED→GREEN; record the first timeline screenshot in `docs/` of the cloud repo for the due-diligence package.
