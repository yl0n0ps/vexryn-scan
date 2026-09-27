#!/usr/bin/env node
// `vexryn ci` end to end: a temp git repo, each CI's env simulated, a local
// mock API (nothing leaves this machine). Asserts:
//  - the review covers ONLY the PR: a server added on main after the fork
//    ("upstream") never shows, whether the CI checks out a merge commit
//    (GitHub, Azure: base = the merge's other parent) or the PR tip
//    (GitLab: MR diff base; Bitbucket: merge-base with origin/<dest>)
//  - the comment is posted to the right forge API
//  - a checkout that isn't the PR's code (pull_request_target) → skipped
//  - history too shallow → a message with this CI's fix, exit 0
//  - no token → the review is printed, the hint says what to set, exit 0
//  - not a PR → skip; unknown CI → exit 2; no change → nothing posted
//  - --strict → exit 1 on an open finding, after posting
//  - a refused write → the review lands in the job summary, exit 0, no token printed

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve("dist/cli.js");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-ci-")));
const repo = path.join(tmp, "repo");
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim();
const put = (rel, obj) => writeFileSync(path.join(repo, rel), typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
const commit = (msg) => (git("add", "-A"), git("commit", "-q", "--allow-empty", "-m", msg), git("rev-parse", "HEAD"));
const base = { PATH: process.env.PATH, VEXRYN_HOME: path.join(tmp, "home"), VEXRYN_CATALOG: path.join(tmp, "none.json") };

function vx(env, ...args) {
  return new Promise((resolve) => {
    const p = spawn("node", [cli, "ci", repo, ...args], { env: { ...base, ...env } });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

const log = [];
let refuse = false; // true → every write is refused (a fork PR's read-only token)
const api = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    log.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? req.headers["private-token"], body: raw ? JSON.parse(raw) : undefined });
    res.writeHead(req.method === "GET" ? 200 : refuse ? 403 : 201, { "content-type": "application/json" });
    res.end(req.method === "GET" ? (req.url.includes("/threads") ? '{"value":[]}' : "[]") : "{}");
  });
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const API = `http://127.0.0.1:${api.address().port}`;
const posted = () => log.filter((r) => r.method !== "GET");
const text = (r) => JSON.stringify(r.body);

try {
  mkdirSync(repo);
  mkdirSync(base.VEXRYN_HOME);
  git("init", "-q", "-b", "main");
  put(".mcp.json", { mcpServers: {} });
  put("README.md", "hello\n");
  const c0 = commit("base");
  git("checkout", "-q", "-b", "feature");
  put(".mcp.json", { mcpServers: { files: { command: "npx", args: ["-y", "some-fs-server", "/"] } } });
  const f1 = commit("PR: add a server");
  git("checkout", "-q", "main");
  put(".vscode.txt", "x");
  mkdirSync(path.join(repo, ".cursor"));
  put(".cursor/mcp.json", { mcpServers: { upstream: { command: "npx", args: ["-y", "upstream-server"] } } });
  const m1 = commit("main moved on after the fork");
  git("merge", "-q", "--no-ff", "feature", "-m", "merge PR into main");
  const M = git("rev-parse", "HEAD");
  git("checkout", "-q", "feature");
  put("README.md", "docs only\n");
  const f2 = commit("docs only");

  const ev = (o) => {
    const f = path.join(tmp, `ev-${Math.random()}.json`);
    writeFileSync(f, JSON.stringify(o));
    return f;
  };
  const gh = (headSha, baseSha, extra = {}) => ({
    GITHUB_ACTIONS: "true",
    GITHUB_API_URL: API,
    GITHUB_REPOSITORY: "o/r",
    VEXRYN_TOKEN: "tok",
    GITHUB_EVENT_PATH: ev({ pull_request: { number: 7, base: { sha: baseSha }, head: { sha: headSha } } }),
    ...extra,
  });
  const onlyPr = (s) => {
    assert.match(s, /`files`/, "the PR's server is reviewed");
    assert.doesNotMatch(s, /upstream/, "main's own change is never attributed to the PR");
  };

  // --- GitHub: merge-commit checkout, even with a stale base sha in the event
  git("checkout", "-q", M);
  let r = await vx(gh(f1, c0));
  assert.equal(r.code, 0, r.err);
  onlyPr(r.out);
  assert.deepEqual(posted().map((p) => `${p.method} ${p.url}`), ["POST /repos/o/r/issues/7/comments"]);
  assert.equal(posted()[0].auth, "token tok");
  onlyPr(text(posted()[0]));
  assert.match(r.out, /posted/);

  log.length = 0;
  r = await vx(gh(f1, m1), "--strict");
  assert.equal(r.code, 1, "strict blocks an open finding");
  assert.equal(posted().length, 1, "…after posting the review");
  assert.match(r.err, /open finding/);

  // --- write refused (fork PR) → the review goes to the job summary, exit 0
  log.length = 0;
  refuse = true;
  const summary = path.join(tmp, "summary.md");
  r = await vx(gh(f1, m1, { GITHUB_STEP_SUMMARY: summary }));
  refuse = false;
  assert.equal(r.code, 0, "non-blocking");
  assert.match(r.err, /could not post the review on .*HTTP 403/);
  assert.doesNotMatch(r.err + r.out, /tok\b/, "the token is never printed");
  onlyPr(readFileSync(summary, "utf8"));

  // --- pull_request_target: the checkout is the base branch, not the PR
  log.length = 0;
  git("checkout", "-q", m1);
  r = await vx(gh(f1, m1, { GITHUB_EVENT_NAME: "pull_request_target" }));
  assert.equal(r.code, 0);
  assert.match(r.out + r.err, /isn't the pull request's code/);
  assert.equal(log.length, 0, "nothing reviewed, nothing posted");

  // --- too shallow: the PR head isn't in the checkout
  r = await vx(gh("1".repeat(40), m1));
  assert.equal(r.code, 0);
  assert.match(r.out + r.err, /fetch-depth: 2/);
  assert.equal(log.length, 0);

  // --- not a PR / unknown CI
  r = await vx({ GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: ev({ ref: "refs/heads/main" }) });
  assert.equal(r.code, 0);
  assert.match(r.out, /not a pull request/);
  r = await vx({ CI: "true" });
  assert.equal(r.code, 2);
  assert.match(r.err, /vexryn diff --base/, "points to the generic command");

  // --- no token: printed, not posted
  git("checkout", "-q", M);
  r = await vx({ ...gh(f1, m1), VEXRYN_TOKEN: "" });
  assert.equal(r.code, 0);
  onlyPr(r.out);
  assert.match(r.err, /VEXRYN_TOKEN/);
  assert.equal(log.length, 0);

  // --- GitLab: the MR's source tip, base = the MR diff base
  git("checkout", "-q", f1);
  const glEnv = { GITLAB_CI: "true", CI_MERGE_REQUEST_IID: "3", CI_PROJECT_ID: "42", CI_API_V4_URL: `${API}/api/v4`, CI_MERGE_REQUEST_DIFF_BASE_SHA: c0, VEXRYN_TOKEN: "gl" };
  r = await vx(glEnv);
  assert.equal(r.code, 0, r.err);
  onlyPr(r.out);
  assert.deepEqual(posted().map((p) => `${p.method} ${p.url}`), ["POST /api/v4/projects/42/merge_requests/3/notes"]);
  assert.equal(posted()[0].auth, "gl");

  log.length = 0;
  r = await vx({ ...glEnv, CI_MERGE_REQUEST_DIFF_BASE_SHA: "2".repeat(40) });
  assert.equal(r.code, 0);
  assert.match(r.out + r.err, /GIT_DEPTH: 0/, "names this CI's fix");
  assert.equal(log.length, 0);

  // --- Bitbucket: merge-base with origin/<destination>; no token → printed
  git("update-ref", "refs/remotes/origin/main", m1);
  r = await vx({ BITBUCKET_BUILD_NUMBER: "1", BITBUCKET_PR_ID: "5", BITBUCKET_WORKSPACE: "ws", BITBUCKET_REPO_SLUG: "r", BITBUCKET_PR_DESTINATION_BRANCH: "main", BITBUCKET_COMMIT: f1 });
  assert.equal(r.code, 0, r.err);
  onlyPr(r.out);
  assert.match(r.err, /repository access token/);

  // --- Azure DevOps: merge commit; base = the parent that isn't the PR source
  log.length = 0;
  git("checkout", "-q", M);
  r = await vx({ TF_BUILD: "True", SYSTEM_PULLREQUEST_PULLREQUESTID: "9", SYSTEM_COLLECTIONURI: `${API}/org/`, SYSTEM_TEAMPROJECT: "P", BUILD_REPOSITORY_ID: "rid", BUILD_REPOSITORY_PROVIDER: "TfsGit", SYSTEM_PULLREQUEST_TARGETBRANCH: "refs/heads/main", SYSTEM_PULLREQUEST_SOURCECOMMITID: f1, SYSTEM_ACCESSTOKEN: "az" });
  assert.equal(r.code, 0, r.err);
  onlyPr(r.out);
  assert.deepEqual(posted().map((p) => `${p.method} ${p.url}`), ["POST /org/P/_apis/git/repositories/rid/pullRequests/9/threads?api-version=7.1"]);
  assert.match(posted()[0].body.comments[0].content, /^\[\/\/\]: # \(vexryn-pr-review\)/);

  // --- no agent config change → nothing posted
  log.length = 0;
  git("checkout", "-q", f2);
  r = await vx({ ...glEnv, CI_MERGE_REQUEST_DIFF_BASE_SHA: f1 });
  assert.equal(r.code, 0);
  assert.match(r.out, /No agent config file changed/);
  assert.equal(posted().length, 0, "no sticky + no change → nothing posted");

  console.log("ci-check: all assertions passed");
} finally {
  await new Promise((r) => api.close(r));
  rmSync(tmp, { recursive: true, force: true });
}
