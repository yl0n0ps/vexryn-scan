#!/usr/bin/env node
// The Action's comment script against a FAKE `gh` on PATH (nothing reaches
// GitHub). Asserts the sticky-comment logic:
//  - no sticky yet + a change → one POST whose body is the review
//  - a sticky exists → PATCH that comment (also to say "no change" now)
//  - no sticky + no change → nothing posted
//  - write refused (fork PR, read-only token) → job summary, still exit 0
//  - a non-numeric id from the listing is ignored; no PR number → skip

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve("scripts/pr-comment.sh");
const tmp = mkdtempSync(path.join(os.tmpdir(), "vexryn-action-"));
const bin = path.join(tmp, "bin");
const log = path.join(tmp, "gh.log");
const summary = path.join(tmp, "summary.md");

// Fake gh: logs each call (args + stdin); the listing call prints FAKE_EXISTING.
writeFileSync(
  path.join(tmp, "gh.mjs"),
  `import fs from "node:fs";
const args = process.argv.slice(2);
const stdin = args.includes("--input") ? fs.readFileSync(0, "utf8") : "";
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, stdin }) + "\\n");
if (args.includes("--jq")) { process.stdout.write(process.env.FAKE_EXISTING ?? ""); process.exit(0); }
process.exit(Number(process.env.FAKE_WRITE_EXIT ?? 0));
`,
);
spawnSync("mkdir", ["-p", bin]);
writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nexec node "${path.join(tmp, "gh.mjs")}" "$@"\n`);
chmodSync(path.join(bin, "gh"), 0o755);

const CHANGE = "<!-- vexryn-pr-review -->\n### Vexryn — agent config review\n\n- ⚠️ New MCP server `slack`\n";
const NONE = "<!-- vexryn-pr-review -->\n### Vexryn — agent config review\n\nNo agent config change.\n";

function run(review, env = {}) {
  for (const f of [log, summary]) rmSync(f, { force: true });
  const file = path.join(tmp, "review.md");
  writeFileSync(file, review);
  const r = spawnSync("bash", [script, file], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_GH_LOG: log, GITHUB_STEP_SUMMARY: summary, REPO: "o/r", PR: "7", ...env },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  return { code: r.status, out: r.stdout, err: r.stderr, calls, writes: calls.filter((c) => !c.args.includes("--jq")) };
}

try {
  let r = run(CHANGE);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.writes.length, 1);
  assert.deepEqual(r.writes[0].args, ["api", "repos/o/r/issues/7/comments", "--input", "-"]);
  assert.equal(JSON.parse(r.writes[0].stdin).body, CHANGE, "the review is the comment body, verbatim");
  assert.match(r.calls[0].args.join(" "), /select\(\.user\.type == "Bot"/, "only a bot's comment can be the sticky");

  r = run(CHANGE, { FAKE_EXISTING: "42\n" });
  assert.deepEqual(r.writes[0].args, ["api", "-X", "PATCH", "repos/o/r/issues/comments/42", "--input", "-"]);

  r = run(NONE, { FAKE_EXISTING: "42\n" });
  assert.equal(JSON.parse(r.writes[0].stdin).body, NONE, "a stale sticky is updated to 'no change'");

  r = run(NONE);
  assert.equal(r.code, 0);
  assert.equal(r.writes.length, 0, "nothing posted when nothing changed");

  r = run(CHANGE, { FAKE_WRITE_EXIT: "1" });
  assert.equal(r.code, 0, "non-blocking even when commenting is refused");
  assert.equal(readFileSync(summary, "utf8"), CHANGE, "review lands in the job summary");

  r = run(CHANGE, { FAKE_EXISTING: "abc\n" });
  assert.deepEqual(r.writes[0].args, ["api", "repos/o/r/issues/7/comments", "--input", "-"], "garbage id ignored");

  r = run(CHANGE, { PR: "" });
  assert.equal(r.code, 0);
  assert.equal(r.calls.length, 0, "not a pull request: skip");

  console.log("action-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
