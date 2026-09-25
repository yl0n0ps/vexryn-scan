#!/usr/bin/env node
// The catalogue used everywhere, against a FIXTURE catalogue (VEXRYN_CATALOG) and a fake home:
//  - scan: dated catalogue figures, powers, deprecation, traps, combinations; a pinned
//    version the catalogue lacks never borrows another version's figures
//  - review: the same facts on a PR, combinations formed by the change
//  - MCP: mcp_server_lookup (read-only, no description text), and trap PHRASES never relayed to an agent
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-cat-use-")));
const home = path.join(tmp, "home");
const repo = path.join(tmp, "repo");
const catalogPath = path.join(tmp, "catalog.json");
mkdirSync(home);
mkdirSync(repo);
const at = "2026-09-26T10:00:00.000Z";
const by = "https://github.com/yl0n0ps/vexryn-scan/actions/runs/1";
const tool = (name, power, tokens = 100, flags) => ({ name, tokens, power, hash: name.padEnd(64, "0").replace(/[^0-9a-f]/g, "0"), ...(flags && { flags }) });
writeFileSync(catalogPath, JSON.stringify({
  schema: 1,
  servers: {
    "npm:@acme/slack-mcp": {
      deprecated: "Package no longer supported. Use the remote server.",
      latest: "2.0.0",
      versions: {
        "2.0.0": { measuredAt: at, by, tools: [tool("send_message", "external-message.send", 120), tool("list_channels", null, 80)] },
        "1.0.0": { measuredAt: at, by, tools: [tool("list_channels", null, 80)] },
      },
    },
    "npm:@acme/web": {
      deprecated: null,
      latest: "1.0.0",
      versions: { "1.0.0": { measuredAt: at, by, tools: [tool("fetch", "network.fetch"), tool("read_file", "file.read"), tool("note", null, 50, { phrases: ["<IMPORTANT>"], hidden: 0 })] } },
    },
    "pypi:mcp-server-fetch": { deprecated: null, latest: "2026.8.18", versions: { "2026.8.18": { measuredAt: at, by, tools: [tool("fetch", "network.fetch", 200)] } } },
  },
}));
const env = { ...process.env, VEXRYN_HOME: home, VEXRYN_CATALOG: catalogPath };
const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");
const cli = (...args) => strip(execFileSync("node", [path.resolve("dist/cli.js"), ...args], { env, encoding: "utf8", cwd: repo }));
const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" });
const mcpJson = (servers) => writeFileSync(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: servers }, null, 2));

try {
  git("init", "-q", "-b", "main");
  mcpJson({});
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  mcpJson({
    slack: { command: "npx", args: ["-y", "@acme/slack-mcp"] },
    web: { command: "npx", args: ["-y", "@acme/web@1.0.0"] },
    pyfetch: { command: "uvx", args: ["mcp-server-fetch"] },
    old: { command: "npx", args: ["-y", "@acme/slack-mcp@1.5.0"] },
  });

  // --- scan ---------------------------------------------------------------
  const out = cli("scan", ".", "--no-global");
  const row = (name) => out.split("\n").find((l) => l.trimStart().startsWith(name + " ")) ?? "";
  assert.match(row("slack"), /2 tools · ~200 tok/, "figures from the catalogue");
  assert.match(row("slack"), /catalog @acme\/slack-mcp@2\.0\.0 2026-09-26, not pinned/);
  assert.match(row("web"), /3 tools .*catalog @acme\/web@1\.0\.0 2026-09-26$/);
  assert.match(row("pyfetch"), /1 tool .*catalog mcp-server-fetch@2026\.8\.18/, "uvx → PyPI");
  assert.match(row("old"), /no figure/, "a pinned version the catalogue lacks borrows nothing");
  assert.match(out, /⚠ uses @acme\/slack-mcp, marked deprecated by its publisher: "Package no longer supported\. Use the remote server\."/);
  assert.match(out, /⚠ tool note — its description contains the phrase "<IMPORTANT>"/);
  assert.match(out, /⚠ Its MCP tools can read web pages, read your files and send them out/, "combination across servers");
  assert.match(out, /can: send messages to external recipients/);

  // --- review -------------------------------------------------------------
  const review = cli("diff", ".", "--base", "main");
  assert.match(review, /^- ⚠️ MCP server `slack` \(`\.mcp\.json`\) can send messages to external recipients — 2 tools \(Vexryn catalogue: `@acme\/slack-mcp@2\.0\.0`, latest measured — the config isn't pinned, measured 2026-09-26\)/m);
  assert.match(review, /^- ⚠️ MCP server `web` \(`\.mcp\.json`\) can read files, access the network — 3 tools \(Vexryn catalogue: `@acme\/web@1\.0\.0`, measured 2026-09-26\)/m);
  assert.match(review, /^- ⚠️ MCP server `slack` \(`\.mcp\.json`\) uses `@acme\/slack-mcp`, marked deprecated by its publisher: `Package no longer supported\. Use the remote server\.`/m);
  assert.match(review, /^- ⚠️ MCP server `web` \(`\.mcp\.json`\): tool `note`'s description contains the phrase `<IMPORTANT>`/m);
  assert.match(review, /^- ⚠️ Claude Code at the repo root: its MCP tools can read web pages, read your files and send them out/m);
  assert.match(review, /^- MCP server `old` \(`\.mcp\.json`\): version `1\.5\.0` isn't in the Vexryn catalogue \(latest measured: `2\.0\.0`\)/m);
  git("add", "-A");
  git("commit", "-q", "-m", "servers");
  assert.ok(!/at the repo root: its MCP tools/.test(cli("diff", ".", "--base", "HEAD")), "an unchanged combination is not repeated");

  // --- MCP ----------------------------------------------------------------
  const client = new Client({ name: "catalog-use-check", version: "0" }, { capabilities: {} });
  await client.connect(new StdioClientTransport({ command: "node", args: [path.resolve("dist/cli.js"), "mcp"], cwd: repo, env }));
  try {
    const text = (r) => r.content.map((c) => c.text ?? "").join("");
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["agent_config_review", "agent_load_report", "mcp_server_lookup"]);
    let r = await client.callTool({ name: "mcp_server_lookup", arguments: { package: "@acme/web@1.0.0" } });
    assert.ok(!r.isError, text(r));
    assert.match(text(r), /@acme\/web 1\.0\.0 — Vexryn catalogue, measured 2026-09-26/);
    assert.match(text(r), /3 tools/);
    assert.match(text(r), /Can: read files, access the network/);
    assert.match(text(r), /tool note: its description contains 1 instruction-like phrase/);
    assert.ok(!text(r).includes("IMPORTANT"), "trap phrases are never relayed to an agent");
    r = await client.callTool({ name: "mcp_server_lookup", arguments: { package: "npm:@acme/slack-mcp" } });
    assert.match(text(r), /Marked deprecated by its publisher/);
    r = await client.callTool({ name: "mcp_server_lookup", arguments: { package: "pypi:mcp-server-fetch" } });
    assert.match(text(r), /1 tool/);
    r = await client.callTool({ name: "mcp_server_lookup", arguments: { package: "@nobody/nothing" } });
    assert.match(text(r), /not in the Vexryn catalogue/);
    r = await client.callTool({ name: "agent_load_report", arguments: { includeGlobal: false } });
    assert.match(text(r), /tool note — its description contains 1 instruction-like phrase/);
    assert.ok(!text(r).includes("IMPORTANT"), "the load report given to an agent doesn't quote trap phrases either");
  } finally {
    await client.close().catch(() => {});
  }
  console.log("catalog-use-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
