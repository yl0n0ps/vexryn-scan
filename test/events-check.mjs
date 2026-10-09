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
