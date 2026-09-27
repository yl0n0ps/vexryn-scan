#!/usr/bin/env node
// Machine entry points, for any CI or tool:
//  - `diff --strict` exits 1 while a ⚠️ finding is open, 0 otherwise
//  - a finding accepted in the BASE side's .vexryn.json doesn't block; an
//    acceptance added by the change itself doesn't silence it (still exit 1)
//  - `diff --json` prints the review as data, with `open` = unaccepted ⚠️ count
//  - `scan --json` prints the load report as data

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve("dist/cli.js");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-entries-")));
const repo = path.join(tmp, "repo");
const env = { ...process.env, VEXRYN_HOME: path.join(tmp, "home"), VEXRYN_CATALOG: path.join(tmp, "none.json") };
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim();
const put = (rel, obj) => writeFileSync(path.join(repo, rel), JSON.stringify(obj, null, 2));
const commit = (msg) => (git("add", "-A"), git("commit", "-q", "--allow-empty", "-m", msg), git("rev-parse", "HEAD"));
const vx = (...args) => spawnSync("node", [cli, ...args], { encoding: "utf8", env });
const RISKY = { mcpServers: { files: { command: "npx", args: ["-y", "some-fs-server", "/"] } } };

try {
  mkdirSync(repo);
  mkdirSync(env.VEXRYN_HOME);
  git("init", "-q", "-b", "main");
  put(".mcp.json", { mcpServers: {} });
  const c0 = commit("base");
  put(".mcp.json", RISKY);
  const c2 = commit("add a risky server");

  // --- diff --json: the review as data
  let r = vx("diff", repo, "--base", c0, "--head", c2, "--json");
  assert.equal(r.status, 0, r.stderr);
  const review = JSON.parse(r.stdout);
  for (const k of ["powers", "accepted", "loads", "changed", "unreviewed", "open"]) assert.ok(k in review, `json has ${k}`);
  assert.ok(review.open >= 1, "a new unpinned server is an open finding");
  const ids = review.powers.flatMap((l) => l.match(/vx-[0-9a-f]{8}/g) ?? []);
  assert.equal(ids.length, review.open, "every open finding carries its id");

  // --- --strict: exit 1 on open findings, 0 without --strict
  assert.equal(vx("diff", repo, "--base", c0, "--head", c2).status, 0, "non-blocking by default");
  r = vx("diff", repo, "--base", c0, "--head", c2, "--strict");
  assert.equal(r.status, 1, "strict blocks an open finding");
  assert.match(r.stdout, /### Vexryn — agent config review/, "strict still prints the review");
  assert.match(r.stderr, /open finding/, "strict says why it fails");

  // --- accepted on the base branch → not blocking
  git("checkout", "-q", "-b", "accepted", c0);
  put(".vexryn.json", { accept: ids.map((id) => ({ id, reason: "reviewed" })) });
  const c1 = commit("accept on base");
  put(".mcp.json", RISKY);
  const c3 = commit("risky, already accepted");
  r = vx("diff", repo, "--base", c1, "--head", c3, "--strict");
  assert.equal(r.status, 0, `accepted on base → passes\n${r.stdout}${r.stderr}`);

  // --- accepted only by the change itself → still blocking
  git("checkout", "-q", "-b", "self", c2);
  put(".vexryn.json", { accept: ids.map((id) => ({ id, reason: "trust me" })) });
  const c4 = commit("self-accept");
  r = vx("diff", repo, "--base", c0, "--head", c4, "--strict");
  assert.equal(r.status, 1, "a change can't accept its own findings");

  // --- no change → exit 0 even with --strict; empty json
  r = vx("diff", repo, "--base", c2, "--head", c2, "--strict", "--json");
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).open, 0);

  // --- scan --json
  r = vx("scan", repo, "--json", "--no-global");
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(Array.isArray(report.agents) && report.agents.length >= 1, "scan json lists agents");
  assert.doesNotMatch(r.stdout, /\u001b/, "no terminal colors in json");
  r = vx("scan", repo, "--json", "--html", "--no-global");
  JSON.parse(r.stdout);
  assert.ok(existsSync(path.join(repo, ".vexryn/report.html")), "--json --html still writes the html report");

  console.log("entries-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
