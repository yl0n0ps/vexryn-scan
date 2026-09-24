#!/usr/bin/env node
// wire/unwire round-trip on a TEMP copy of a repo (fixtures are never modified),
// with a fake home so user-wide configs are real-but-fake. Asserts:
//  - wire routes stdio servers through `vexryn wrap`, keeps a backup
//  - unwire restores the original servers exactly
//  - wire reports (and leaves untouched) servers in user-wide configs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(os.tmpdir(), "vexryn-wire-"));
const repo = path.join(tmp, "repo");
const home = path.join(tmp, "home");
cpSync("fixtures/sample-repo", repo, { recursive: true });
mkdirSync(home, { recursive: true });
const globalCfg = path.join(home, ".claude.json");
writeFileSync(globalCfg, JSON.stringify({ mcpServers: { linear: { command: "npx", args: ["linear-mcp"] } } }));
const globalBefore = readFileSync(globalCfg, "utf8");

const env = { ...process.env, VEXRYN_HOME: home };
const cli = (...a) =>
  execFileSync("node", ["dist/cli.js", ...a], { env, encoding: "utf8" }).replace(/\u001b\[[0-9;]*m/g, "");
const servers = () => JSON.parse(readFileSync(path.join(repo, ".mcp.json"), "utf8")).mcpServers;

try {
  const original = servers();

  const wired = cli("wire", repo);
  assert.match(wired, /Wired: github, sentry, slack, postgres/);
  assert.match(wired, /skipped \(not stdio\): internal-billing/);
  assert.match(wired, /1 server in your user-wide configs \(~\/\.claude\.json\) were left untouched/);
  assert.equal(servers().github.command, "vexryn");
  assert.deepEqual(servers().github.args.slice(0, 4), ["wrap", "--name", "github", "--"]);
  assert.ok(existsSync(path.join(repo, ".mcp.json.vexryn-bak")), "backup written");
  assert.equal(readFileSync(globalCfg, "utf8"), globalBefore, "user-wide config untouched");

  assert.match(cli("wire", repo), /already wired: github, sentry, slack, postgres/, "idempotent");

  cli("unwire", repo);
  assert.deepEqual(servers(), original, "unwire restores the original exactly");

  console.log("wire-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
