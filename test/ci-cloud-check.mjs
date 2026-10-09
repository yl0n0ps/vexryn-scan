#!/usr/bin/env node
// `vexryn ci` → Vexryn Cloud, against a local mock cloud (nothing leaves this
// machine). Asserts: one POST /v1/reviews with the org token as a Bearer, a
// body the shared validator accepts, repo/pr/shas from the CI env, no secret
// value; no token → no request; cloud down → one warning line, same PR
// comment, same exit code, no stack trace.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
  // async, so the mock servers in this process can answer while the CLI runs
  const run = (extra) => new Promise((resolve) => {
    const p = spawn("node", [cli, "ci", repo], { env: env(extra) });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => (stdout += d)); p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
  });

  let r = await run({ VEXRYN_ORG_TOKEN: "vx_test_org_token", VEXRYN_CLOUD_URL: CLOUD });
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
  r = await run({});
  assert.equal(got.length, 0, "no org token → nothing posted");
  assert.doesNotMatch(r.stdout + r.stderr, /Vexryn Cloud/);

  r = await run({ VEXRYN_ORG_TOKEN: "vx_x", VEXRYN_CLOUD_URL: "http://127.0.0.1:1" });
  assert.equal(r.status, 0, "cloud down: exit code unchanged");
  assert.match(r.stderr, /could not send the review to Vexryn Cloud/);
  assert.doesNotMatch(r.stderr, /at .*\.js:\d+/, "no stack trace");
  assert.match(r.stdout, /### Vexryn — agent config review/, "the PR comment path still ran");
  console.log("ci-cloud-check: all assertions passed");
} finally {
  forge.close(); cloud.close();
  rmSync(tmp, { recursive: true, force: true });
}
