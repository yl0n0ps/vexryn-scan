#!/usr/bin/env node
// Where `vexryn ci` posts, per forge — against local mock APIs (nothing leaves
// this machine). Every path, field and header comes from the forge's own docs
// (docs/plans/2026-09-27-any-forge.md). Asserts:
//  - detect(): each CI's env → forge, PR, API root, token, base candidates;
//    a non-PR pipeline → skip; an unknown CI → null
//  - each adapter's exact list / create / update requests and auth header
//  - the sticky comment (ported from the old Action test): no sticky + change →
//    create; sticky → update (also to say "no change"); no sticky + no change →
//    nothing; writes refused → failed, no throw; body refused → the sticky gets
//    a short notice; the highest-id marker comment wins; someone else's marker
//    comment (update refused) → Vexryn posts its own
//  - a listing's non-numeric id is ignored; a `next` page on another origin is
//    never followed (the token never leaves for another host)
//  - Bitbucket and Azure DevOps get a markdown-only marker and no HTML

import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const { detect, adapter, publish, MD_MARKER } = await import(path.resolve("dist/ci/forges.js"));
const MARKER = "<!-- vexryn-pr-review -->";
const CHANGE = `${MARKER}\n### Vexryn — agent config review\n\n- ⚠️ New MCP server \`slack\` <sub>vx-0123abcd</sub>\n`;
const NONE = `${MARKER}\n### Vexryn — agent config review\n\nNo agent config file changed.\n`;

/** A mock API: `handler(req, body)` returns [status, json, headers?]; every request is logged. */
async function mock(handler) {
  const log = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      log.push({ method: req.method, url: req.url, headers: req.headers, body });
      const [status, json, headers] = handler(req, body, log) ?? [200, {}];
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, log, close: () => new Promise((r) => server.close(r)) };
}
const writes = (log) => log.filter((r) => r.method !== "GET");

const tmp = mkdtempSync(path.join(os.tmpdir(), "vexryn-forges-"));
const servers = [];
try {
  // ---------------------------------------------------------------- detect
  const ev = path.join(tmp, "event.json");
  writeFileSync(ev, JSON.stringify({ pull_request: { number: 7, base: { sha: "b".repeat(40) }, head: { sha: "c".repeat(40) } } }));
  const gh = detect({ GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: ev, GITHUB_REPOSITORY: "o/r", GITHUB_API_URL: "https://api.github.com", GITHUB_SERVER_URL: "https://github.com", GITHUB_TOKEN: "t1" });
  assert.equal(gh.forge, "github");
  assert.equal(gh.pr, "7");
  assert.equal(gh.root, "https://api.github.com/repos/o/r");
  assert.equal(gh.token, "t1");
  assert.deepEqual(gh.targets, ["b".repeat(40)]);
  assert.equal(gh.prHead, "c".repeat(40));
  assert.equal(gh.label, "github.com");
  assert.equal(detect({ GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: ev, GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "t1", VEXRYN_TOKEN: "v" }).token, "v", "VEXRYN_TOKEN wins");
  writeFileSync(path.join(tmp, "push.json"), JSON.stringify({ ref: "refs/heads/main" }));
  assert.ok(detect({ GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: path.join(tmp, "push.json"), GITHUB_REPOSITORY: "o/r" }).skip, "a push is not a PR");
  const fj = detect({ FORGEJO_ACTIONS: "true", GITHUB_EVENT_PATH: ev, GITHUB_REPOSITORY: "o/r", GITHUB_API_URL: "https://codeberg.org/api/v1", GITHUB_SERVER_URL: "https://codeberg.org", GITHUB_TOKEN: "t2" });
  assert.equal(fj.forge, "github", "Forgejo speaks the same comment API");
  assert.equal(fj.root, "https://codeberg.org/api/v1/repos/o/r");
  assert.equal(fj.label, "codeberg.org");

  const gl = detect({ GITLAB_CI: "true", CI_MERGE_REQUEST_IID: "3", CI_PROJECT_ID: "42", CI_API_V4_URL: "https://gitlab.com/api/v4", CI_MERGE_REQUEST_DIFF_BASE_SHA: "d".repeat(40), VEXRYN_TOKEN: "g" });
  assert.equal(gl.forge, "gitlab");
  assert.equal(gl.root, "https://gitlab.com/api/v4/projects/42/merge_requests/3/notes");
  assert.deepEqual(gl.targets, ["d".repeat(40)]);
  assert.deepEqual(detect({ GITLAB_CI: "true", CI_MERGE_REQUEST_IID: "3", CI_PROJECT_ID: "42", CI_API_V4_URL: "x", CI_MERGE_REQUEST_TARGET_BRANCH_SHA: "e".repeat(40), CI_MERGE_REQUEST_DIFF_BASE_SHA: "d".repeat(40), CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: "f".repeat(40) }).targets, ["e".repeat(40), "d".repeat(40)], "merged results: the target tip first");
  assert.ok(detect({ GITLAB_CI: "true", CI_PROJECT_ID: "42" }).skip, "a branch pipeline is not an MR");
  assert.equal(detect({ GITLAB_CI: "true", CI_MERGE_REQUEST_IID: "3", CI_PROJECT_ID: "42", CI_API_V4_URL: "x", GITLAB_TOKEN: "t" }).token, "t");

  const bb = detect({ BITBUCKET_BUILD_NUMBER: "1", BITBUCKET_PR_ID: "5", BITBUCKET_WORKSPACE: "ws", BITBUCKET_REPO_SLUG: "r", BITBUCKET_PR_DESTINATION_BRANCH: "main", BITBUCKET_COMMIT: "a".repeat(40), VEXRYN_TOKEN: "b" });
  assert.equal(bb.forge, "bitbucket");
  assert.equal(bb.root, "https://api.bitbucket.org/2.0/repositories/ws/r/pullrequests/5/comments");
  assert.deepEqual(bb.targets, ["origin/main"]);
  assert.equal(bb.prHead, "a".repeat(40));
  assert.ok(detect({ BITBUCKET_BUILD_NUMBER: "1" }).skip);

  const azEnv = { TF_BUILD: "True", SYSTEM_PULLREQUEST_PULLREQUESTID: "9", SYSTEM_COLLECTIONURI: "https://dev.azure.com/org/", SYSTEM_TEAMPROJECT: "My Project", BUILD_REPOSITORY_ID: "3411ebc1-d5aa-464f-9615-0b527bc66719", BUILD_REPOSITORY_PROVIDER: "TfsGit", SYSTEM_PULLREQUEST_TARGETBRANCH: "refs/heads/main", SYSTEM_PULLREQUEST_SOURCECOMMITID: "9".repeat(40), SYSTEM_ACCESSTOKEN: "az" };
  const az = detect(azEnv);
  assert.equal(az.forge, "azure");
  assert.equal(az.root, "https://dev.azure.com/org/My%20Project/_apis/git/repositories/3411ebc1-d5aa-464f-9615-0b527bc66719/pullRequests/9/threads");
  assert.deepEqual(az.targets, ["origin/main"]);
  assert.equal(az.token, "az");
  assert.ok(detect({ ...azEnv, BUILD_REPOSITORY_PROVIDER: "GitHub" }).skip, "Azure Pipelines on a GitHub repo: comments belong on GitHub");
  assert.ok(detect({ ...azEnv, SYSTEM_PULLREQUEST_PULLREQUESTID: "9; rm" }).skip, "a PR id must be digits");
  assert.equal(detect({ CI: "true" }), null, "unknown CI");

  // -------------------------------------------------- exact requests per forge
  const ok = (req) => (req.method === "GET" ? [200, []] : [201, { id: 1 }]);
  let m = await mock(ok);
  servers.push(m);
  const at = (ctx) => ({ ...ctx, root: ctx.root.replace(/^https:\/\/[^/]+/, m.url) });
  let a = adapter(at(gh));
  await a.list();
  await a.create(CHANGE);
  await a.update({ id: "55", body: "" }, CHANGE);
  assert.deepEqual(m.log.map((r) => `${r.method} ${r.url}`), ["GET /repos/o/r/issues/7/comments?per_page=100", "POST /repos/o/r/issues/7/comments", "PATCH /repos/o/r/issues/comments/55"]);
  assert.equal(m.log[0].headers.authorization, "token t1");
  assert.deepEqual(m.log[1].body, { body: CHANGE });

  m.log.length = 0;
  a = adapter(at(gl));
  await a.list();
  await a.create(CHANGE);
  await a.update({ id: "77", body: "" }, CHANGE);
  assert.deepEqual(m.log.map((r) => `${r.method} ${r.url}`), ["GET /api/v4/projects/42/merge_requests/3/notes?per_page=100", "POST /api/v4/projects/42/merge_requests/3/notes", "PUT /api/v4/projects/42/merge_requests/3/notes/77"]);
  assert.equal(m.log[0].headers["private-token"], "g");
  assert.deepEqual(m.log[2].body, { body: CHANGE });

  m.log.length = 0;
  await m.close();
  m = await mock((req) => (req.method === "GET" ? [200, { values: [] }] : [201, {}]));
  servers.push(m);
  a = adapter(at(bb));
  await a.list();
  await a.create(CHANGE);
  await a.update({ id: "88", body: "" }, CHANGE);
  assert.deepEqual(m.log.map((r) => `${r.method} ${r.url}`), ["GET /2.0/repositories/ws/r/pullrequests/5/comments?pagelen=100", "POST /2.0/repositories/ws/r/pullrequests/5/comments", "PUT /2.0/repositories/ws/r/pullrequests/5/comments/88"]);
  assert.equal(m.log[0].headers.authorization, "Bearer b");
  const raw = m.log[1].body.content.raw;
  assert.ok(raw.startsWith(MD_MARKER), "Bitbucket: markdown-only marker");
  assert.doesNotMatch(raw, /<!--|<sub>/, "Bitbucket renders no HTML");
  assert.match(raw, /vx-0123abcd/, "the finding id stays readable");

  await m.close();
  m = await mock((req) => (req.method === "GET" ? [200, { value: [], count: 0 }] : [200, {}]));
  servers.push(m);
  a = adapter(at(az));
  await a.list();
  await a.create(CHANGE);
  await a.update({ id: "101", sub: "1", body: "" }, CHANGE);
  const p = "/org/My%20Project/_apis/git/repositories/3411ebc1-d5aa-464f-9615-0b527bc66719/pullRequests/9/threads";
  assert.deepEqual(m.log.map((r) => `${r.method} ${r.url}`), [`GET ${p}?api-version=7.1`, `POST ${p}?api-version=7.1`, `PATCH ${p}/101/comments/1?api-version=7.1`]);
  assert.equal(m.log[0].headers.authorization, "Bearer az");
  assert.deepEqual(Object.keys(m.log[1].body).sort(), ["comments", "status"]);
  assert.equal(m.log[1].body.status, 1);
  assert.equal(m.log[1].body.comments[0].parentCommentId, 0);
  assert.equal(m.log[1].body.comments[0].commentType, 1);
  assert.ok(m.log[1].body.comments[0].content.startsWith(MD_MARKER));
  assert.deepEqual(Object.keys(m.log[2].body), ["content"]);

  // Listings parse to {id, body}: Azure = a thread's first comment; deleted/system ones skipped.
  await m.close();
  m = await mock(() => [200, { value: [
    { id: 140, comments: [{ id: 1, content: "system text", commentType: "system" }] },
    { id: 141, comments: [{ id: 1, content: `${MD_MARKER}\nold` }] },
    { id: 142, isDeleted: true, comments: [{ id: 1, content: `${MD_MARKER}\ngone` }] },
  ] }]);
  servers.push(m);
  assert.deepEqual((await adapter(at(az)).list()).filter((c) => c.body.includes("old")), [{ id: "141", sub: "1", body: `${MD_MARKER}\nold` }]);
  assert.equal((await adapter(at(az)).list()).some((c) => c.body.includes("gone")), false);

  // ----------------------------------------------------- the sticky comment
  /** A stateful GitHub-like API: `comments` listed; writes pass through `write`. */
  async function sticky(comments, write = () => [201, {}]) {
    const s = await mock((req, body, log) => (req.method === "GET" ? [200, comments] : write(req, body, log)));
    servers.push(s);
    return { s, a: adapter({ ...gh, root: `${s.url}/repos/o/r` }) };
  }
  const bot = (id, body = CHANGE) => ({ id, body, user: { type: "Bot" } });

  let { s, a: sa } = await sticky([]);
  assert.deepEqual(await publish(sa, CHANGE, false), { result: "posted" });
  assert.deepEqual(writes(s.log).map((r) => [r.method, r.url, r.body.body]), [["POST", "/repos/o/r/issues/7/comments", CHANGE]]);

  ({ s, a: sa } = await sticky([bot(99)]));
  assert.equal((await publish(sa, NONE, true)).result, "updated", "a sticky says 'no change' now");
  assert.deepEqual(writes(s.log).map((r) => [r.method, r.url, r.body.body]), [["PATCH", "/repos/o/r/issues/comments/99", NONE]]);

  ({ s, a: sa } = await sticky([{ id: 3, body: "LGTM" }]));
  assert.deepEqual(await publish(sa, NONE, true), { result: "skipped" });
  assert.equal(writes(s.log).length, 0, "no sticky + no change → nothing posted");

  ({ s, a: sa } = await sticky([], () => [403, { message: "Resource not accessible by integration" }]));
  const refused = await publish(sa, CHANGE, false);
  assert.equal(refused.result, "failed");
  assert.match(refused.error, /HTTP 403/);
  assert.doesNotMatch(refused.error, /t1/, "the token is never in an error");

  ({ s, a: sa } = await sticky([bot(99)], (req, body) => (body.body.includes("slack") ? [422, {}] : [200, {}])));
  assert.equal((await publish(sa, CHANGE, false)).result, "failed");
  const last = writes(s.log).at(-1);
  assert.deepEqual([last.method, last.url], ["PATCH", "/repos/o/r/issues/comments/99"]);
  assert.match(last.body.body, /^<!-- vexryn-pr-review -->\n### Vexryn — agent config review\n\nThe latest review couldn't be posted/, "a stale sticky becomes a notice");

  ({ s, a: sa } = await sticky([bot(10), { id: 11, body: "hi" }, bot(12)]));
  await publish(sa, CHANGE, false);
  assert.equal(writes(s.log)[0].url, "/repos/o/r/issues/comments/12", "the newest marker comment wins");

  ({ s, a: sa } = await sticky([{ id: 20, body: `${MARKER}\nall good, nothing to see`, user: { type: "User" } }], (req) => (req.method === "PATCH" ? [403, {}] : [201, {}])));
  assert.equal((await publish(sa, CHANGE, false)).result, "posted", "someone else's marker comment can't silence the review");
  assert.deepEqual(writes(s.log).map((r) => r.method), ["PATCH", "POST"]);

  ({ s, a: sa } = await sticky([{ id: "../../x", body: CHANGE }, { id: "abc", body: CHANGE }]));
  await publish(sa, CHANGE, false);
  assert.deepEqual(writes(s.log).map((r) => [r.method, r.url]), [["POST", "/repos/o/r/issues/7/comments"]], "non-numeric ids are ignored");

  s = await mock((req) => (req.method === "GET" ? [500, {}] : [201, {}]));
  servers.push(s);
  assert.equal((await publish(adapter({ ...gh, root: `${s.url}/repos/o/r` }), CHANGE, false)).result, "posted", "a failed listing = no sticky known");

  // ------------------------------------------------------------ pagination
  const evil = await mock(() => [200, []]);
  servers.push(evil);
  s = await mock((req) => {
    if (req.method !== "GET") return [200, {}];
    if (req.url.includes("page=2")) return [200, [bot(31)], { link: `<${evil.url}/steal?page=3>; rel="next"` }];
    return [200, [{ id: 30, body: "hi" }], { link: `<http://127.0.0.1:${new URL(s.url).port}/repos/o/r/issues/7/comments?per_page=100&page=2>; rel="next"` }];
  });
  servers.push(s);
  await publish(adapter({ ...gh, root: `${s.url}/repos/o/r` }), CHANGE, false);
  assert.equal(writes(s.log)[0].url, "/repos/o/r/issues/comments/31", "a same-origin next page is followed");
  assert.equal(evil.log.length, 0, "a next page on another origin is never requested");

  s = await mock((req) => {
    if (req.method !== "GET") return [200, {}];
    if (req.url.includes("page=2")) return [200, { values: [{ id: 41, content: { raw: `${MD_MARKER}\nold` } }] }];
    return [200, { values: [], next: `http://127.0.0.1:${new URL(s.url).port}/2.0/repositories/ws/r/pullrequests/5/comments?pagelen=100&page=2` }];
  });
  servers.push(s);
  await publish(adapter({ ...bb, root: bb.root.replace("https://api.bitbucket.org", s.url) }), CHANGE, false);
  assert.equal(writes(s.log)[0].url, "/2.0/repositories/ws/r/pullrequests/5/comments/41", "Bitbucket: sticky found on page 2 via `next`");

  console.log("ci-forges-check: all assertions passed");
} finally {
  for (const s of servers) await s.close().catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
}
