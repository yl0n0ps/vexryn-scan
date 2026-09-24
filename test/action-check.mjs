#!/usr/bin/env node
// The Action's comment script against a FAKE `gh` on PATH (nothing reaches
// GitHub). Asserts the sticky-comment logic:
//  - no sticky yet + a change → one POST whose body is the review
//  - a sticky exists → PATCH that comment (also to say "no change" now)
//  - no sticky + no change → nothing posted
//  - write refused (fork PR, read-only token) → job summary, still exit 0
//  - a non-numeric id from the listing is ignored; no PR number → skip
//  - a refused write with a sticky in place → the sticky is replaced by a short
//    "see the run summary" notice, so a stale review never stays up
//  - the step script reviews only a pull_request merge commit (HEAD^2 exists),
//    diffing HEAD^1 → HEAD, and skips any other checkout

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const writes = fs.readFileSync(process.env.FAKE_GH_LOG, "utf8").split("\\n").filter((l) => l && !l.includes('"--jq"')).length;
if (process.env.FAKE_FAIL_FIRST && writes === 1) process.exit(1);
process.exit(Number(process.env.FAKE_WRITE_EXIT ?? 0));
`,
);
spawnSync("mkdir", ["-p", bin]);
writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nexec node "${path.join(tmp, "gh.mjs")}" "$@"\n`);
chmodSync(path.join(bin, "gh"), 0o755);

const CHANGE = "<!-- vexryn-pr-review -->\n### Vexryn — agent config review\n\n- ⚠️ New MCP server `slack`\n";
const NONE = "<!-- vexryn-pr-review -->\n### Vexryn — agent config review\n\nNo agent config file changed.\n";

function run(review, env = {}, cmd = [script]) {
  for (const f of [log, summary]) rmSync(f, { force: true });
  const file = path.join(tmp, "review.md");
  writeFileSync(file, review);
  const r = spawnSync("bash", cmd[0] === script ? [script, file] : cmd, {
    encoding: "utf8",
    cwd: env.CWD ?? process.cwd(),
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

  r = run(CHANGE, { FAKE_EXISTING: "42\n", FAKE_FAIL_FIRST: "1" });
  assert.equal(r.code, 0);
  assert.equal(r.writes.length, 2);
  assert.match(JSON.parse(r.writes[1].stdin).body, /^<!-- vexryn-pr-review -->[\s\S]*couldn't be posted[\s\S]*run summary/, "stale sticky replaced by a notice");
  assert.equal(readFileSync(summary, "utf8"), CHANGE);

  // The step script: only on a pull_request merge commit.
  const repo = path.join(tmp, "repo");
  mkdirSync(repo);
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(repo, "CLAUDE.md"), "# Rules\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const step = [path.resolve("scripts/pr-review.sh")];
  const stepEnv = { CWD: repo, GITHUB_ACTION_PATH: path.resolve("."), RUNNER_TEMP: tmp };
  r = run("", stepEnv, step);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /not a pull_request merge commit/);
  assert.equal(r.calls.length, 0, "a plain checkout is never reviewed");

  git("checkout", "-q", "-b", "pr");
  writeFileSync(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { slack: { command: "npx", args: ["-y", "server-slack"] } } }));
  git("add", "-A");
  git("commit", "-q", "-m", "pr");
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-ff", "-m", "merge", "pr");
  r = run("", stepEnv, step);
  assert.equal(r.code, 0, r.err);
  assert.match(JSON.parse(r.writes[0].stdin).body, /New MCP server `slack`/, "reviews HEAD^1 → HEAD of the merge commit");

  r = run(CHANGE, { PR: "" });
  assert.equal(r.code, 0);
  assert.equal(r.calls.length, 0, "not a pull request: skip");

  console.log("action-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
