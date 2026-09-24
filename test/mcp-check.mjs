#!/usr/bin/env node
// `vexryn mcp` through a REAL MCP client (the official SDK), against a FAKE
// home (VEXRYN_HOME) so the real user configs are never read. Asserts:
//  - exactly two tools, both read-only: the load report and the config review;
//    nothing that edits configs (wire/trim/wrap) or launches servers (--deep)
//  - the load report reads the repo and, by default, the user's own configs
//  - the review compares a base ref to the working tree, as `vexryn diff`
//  - a path outside the directory the agent launched Vexryn in is refused
//  - a bad ref is an error result, never a crash
//  - output is plain text: no terminal colour codes in the model's context

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-mcp-home-"));
// A repo the agent may review: inside the launch directory (gitignored .vexryn/).
const repo = path.join(process.cwd(), ".vexryn", "mcp-check", "repo");
const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" });

writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "home-srv": { command: "node", args: ["h.js"] } } }));
rmSync(path.join(process.cwd(), ".vexryn", "mcp-check"), { recursive: true, force: true });
mkdirSync(repo, { recursive: true });
git("init", "-q", "-b", "main");
writeFileSync(path.join(repo, "CLAUDE.md"), "# Rules\n");
git("add", "-A");
git("commit", "-q", "-m", "base");
writeFileSync(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { slack: { command: "npx", args: ["-y", "server-slack"], env: { SLACK_TOKEN: "xoxb-SECRET" } } } }));

const transport = new StdioClientTransport({ command: "node", args: ["dist/cli.js", "mcp"], env: { ...process.env, VEXRYN_HOME: home } });
const client = new Client({ name: "mcp-check", version: "0.0.1" }, { capabilities: {} });
const text = (res) => res.content.map((c) => (c.type === "text" ? c.text : "")).join("");

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["agent_config_review", "agent_load_report"], "two tools, no more");
  const spec = JSON.stringify(tools);
  for (const forbidden of ["wire", "trim", "wrap", "deep", "write"]) assert.ok(!spec.includes(forbidden), `nothing named ${forbidden} exposed`);
  for (const t of tools) assert.match(t.description, /read-only/i, `${t.name} says it is read-only`);

  let res = await client.callTool({ name: "agent_load_report", arguments: { path: "fixtures/sample-repo", includeGlobal: false } });
  assert.ok(!res.isError, text(res));
  assert.match(text(res), /CLAUDE CODE/);
  assert.match(text(res), /github/);
  assert.ok(!text(res).includes("home-srv"), "includeGlobal=false skips the user's configs");
  assert.ok(!/\u001b\[/.test(text(res)), "no colour codes");

  res = await client.callTool({ name: "agent_load_report", arguments: { path: "fixtures/sample-repo" } });
  assert.match(text(res), /home-srv/, "user-wide configs read by default (read-only)");

  res = await client.callTool({ name: "agent_config_review", arguments: { path: ".vexryn/mcp-check/repo", base: "HEAD" } });
  assert.ok(!res.isError, text(res));
  assert.match(text(res), /New MCP server `slack`.*receives `SLACK_TOKEN`/);
  assert.ok(!text(res).includes("xoxb-SECRET"), "secret values never returned");

  res = await client.callTool({ name: "agent_config_review", arguments: { path: ".vexryn/mcp-check/repo", base: "--output=x" } });
  assert.ok(res.isError, "bad ref is an error result");
  assert.match(text(res), /invalid ref/);

  for (const outside of ["/", "..", "../other", path.join(os.tmpdir(), "x")]) {
    res = await client.callTool({ name: "agent_load_report", arguments: { path: outside } });
    assert.ok(res.isError, `${outside} refused`);
    assert.match(text(res), /inside the directory Vexryn was started in/);
  }

  console.log("mcp-check: all assertions passed");
} finally {
  await client.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
  rmSync(path.join(process.cwd(), ".vexryn", "mcp-check"), { recursive: true, force: true });
}
