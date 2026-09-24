#!/usr/bin/env node
// End-to-end check for the transparent proxy + usage store + trim.
// Runs against a FAKE home (VEXRYN_HOME) so the real ~/.vexryn is never written.
// Records three cases:
//   mock-local : used                  (deep-repo "X of Y used")
//   github     : used                  (trim on sample-repo → keep)
//   sentry     : wired, never called   (trim on sample-repo → drop)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-home-"));
const env = { ...process.env, VEXRYN_HOME: home };

async function session(name, calls) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/cli.js", "wrap", "--name", name, "--", "node", "fixtures/mock-mcp-server.mjs"],
    env,
  });
  const client = new Client({ name: "proxy-check", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 5, "listTools passes through the proxy unchanged");
  for (const c of calls) await client.callTool({ name: c, arguments: {} });
  await client.close();
  await new Promise((r) => setTimeout(r, 300)); // let the proxy flush on shutdown
}

function cli(...args) {
  return execFileSync("node", ["dist/cli.js", ...args], { env, encoding: "utf8" }).replace(
    /\u001b\[[0-9;]*m/g,
    "",
  );
}

try {
  await session("mock-local", ["search_issues", "search_issues", "read_file"]);
  await session("github", ["search_issues", "create_pull_request"]);
  await session("sentry", []);

  const usage = cli("usage");
  assert.match(usage, /mock-local {2}\(2 tools used\)/);
  assert.match(usage, /2 {2}search_issues/);
  assert.match(usage, /sentry {2}\(0 tools used\)/, "wired-but-unused server is recorded");

  const scan = cli("scan", "fixtures/deep-repo", "--deep", "--no-global");
  assert.match(scan, /You actually used 2 of 5 tools\./);

  const trim = cli("trim", "fixtures/sample-repo");
  assert.match(trim, /keep {2}github/);
  assert.match(trim, /drop {2}sentry/);
  assert.match(trim, /frees ~15k tokens/);

  console.log(usage + scan + trim);
  console.log("proxy-check: all assertions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
