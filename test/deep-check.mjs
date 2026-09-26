#!/usr/bin/env node
// End-to-end: powers, the local measurement store, drift, per-tool trim.
// FAKE home (VEXRYN_HOME); the mock server grows one tool with MOCK_EXTRA_TOOL=1.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { computeTrim, renderTrim } from "../dist/trim/trim.js";

const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-deep-"));
const env = { ...process.env, VEXRYN_HOME: home };
const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");
const cli = (extra, ...args) =>
  strip(execFileSync("node", ["dist/cli.js", ...args], { env: { ...env, ...extra }, encoding: "utf8" }));

try {
  // 1. --deep: real tools → powers
  let out = cli({}, "scan", "fixtures/deep-repo", "--deep", "--no-global");
  assert.match(out, /mock-local\s+5 tools/);
  assert.match(out, /can: send messages to external recipients, read files/);
  assert.ok(!out.includes("since"), "first measurement: nothing to compare with");

  // 2. static scan: remembered, dated, nothing launched
  out = cli({}, "scan", "fixtures/deep-repo", "--no-global");
  assert.match(out, /static read/);
  assert.match(out, /mock-local\s+5 tools · ~\d+ tok/, "real figures from the local measurement");
  assert.match(out, /measured \d{4}-\d{2}-\d{2}/);
  assert.match(out, /can: send messages to external recipients, read files/);
  assert.ok(!out.includes("not measured"), "a measured server is not asked to run --deep again");

  // 3. --deep again, the server changed → drift facts
  out = cli({ MOCK_EXTRA_TOOL: "1" }, "scan", "fixtures/deep-repo", "--deep", "--no-global");
  assert.match(out, /⚠ \+1 tool since \d{4}-\d{2}-\d{2}: delete_record/);
  assert.match(out, /⚠ 1 tool changed its description or schema since \d{4}-\d{2}-\d{2}: read_file/);
  assert.match(out, /can: delete records, send messages to external recipients, read files/);

  // 4. per-tool trim from real usage (2 calls through the proxy)
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/cli.js", "wrap", "--name", "mock-local", "--", "node", "fixtures/mock-mcp-server.mjs"],
    env,
  });
  const client = new Client({ name: "deep-check", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  for (const name of ["search_issues", "read_file"]) await client.callTool({ name, arguments: {} });
  await client.close();
  await new Promise((r) => setTimeout(r, 300));
  out = cli({}, "trim", "fixtures/deep-repo");
  assert.match(out, /keep {2}mock-local\s+2 of 6 tools used/);
  assert.match(out, /never used \(4\): create_pull_request, send_email, run_query, delete_record/);

  // 5. a long never-used list is truncated
  const tools = Array.from({ length: 12 }, (_, i) => ({ name: `t${i}`, description: "", tokens: 1 }));
  const fake = {
    name: "big",
    client: "Cursor",
    scope: "project",
    transport: "stdio",
    target: "x",
    fromRelPath: "f",
    usedToolCount: 1,
    estimate: { toolCount: 12, approxTokens: 12, source: "measured", tools },
  };
  const text = strip(renderTrim(computeTrim([fake], { servers: { big: { tools: { t0: 1 }, updatedAt: "" } } })));
  assert.match(text, /never used \(11\): t1, t2, t3, t4, t5, t6, t7, t8, … \+3 more/);

  // 5b. dropping an unused Claude Code server frees its tool NAMES only (schemas are deferred by tool search)
  const cc = { ...fake, name: "unused", client: "Claude Code", usedToolCount: 0, estimate: { toolCount: 2, approxTokens: 5000, source: "measured", tools: [{ name: "alpha", description: "", tokens: 2500 }, { name: "beta", description: "", tokens: 2500 }] } };
  const cursorTwin = { ...cc, client: "Cursor" };
  assert.ok(computeTrim([cc], { servers: {} }).savedTokens < 10, "names only, not 5,000 tokens of schemas");
  assert.equal(computeTrim([cursorTwin], { servers: {} }).savedTokens, 5000, "other agents load schemas up front");
  assert.equal(computeTrim([cc], { servers: {} }, "upfront").savedTokens, 5000, "tool search off: schemas count");

  // 6. a trap hidden in a tool description: flagged as a fact, the description itself never printed
  const poisonHome = mkdtempSync(path.join(os.tmpdir(), "vexryn-poison-"));
  try {
    out = strip(execFileSync("node", ["dist/cli.js", "scan", "fixtures/deep-repo", "--deep", "--no-global"], { env: { ...process.env, VEXRYN_HOME: poisonHome, MOCK_POISON: "1" }, encoding: "utf8" }));
    assert.match(out, /⚠ tool add — its description contains the phrase "<IMPORTANT>", "Before using this tool", "Do not tell the user"/);
    assert.ok(!out.includes("id_rsa") && !out.includes("sidenote"), "the description itself is never printed");
    out = strip(execFileSync("node", ["dist/cli.js", "scan", "fixtures/deep-repo", "--no-global"], { env: { ...process.env, VEXRYN_HOME: poisonHome }, encoding: "utf8" }));
    assert.match(out, /⚠ tool add — its description contains the phrase/, "remembered with the measurement");
  } finally {
    rmSync(poisonHome, { recursive: true, force: true });
  }

  // 7. a dangerous combination across the agent's tools
  const comboHome = mkdtempSync(path.join(os.tmpdir(), "vexryn-combo-"));
  try {
    out = strip(execFileSync("node", ["dist/cli.js", "scan", "fixtures/deep-repo", "--deep", "--no-global"], { env: { ...process.env, VEXRYN_HOME: comboHome, MOCK_FETCH: "1" }, encoding: "utf8" }));
    assert.match(out, /CLAUDE CODE[^\n]*\n[^\n]*\n  ⚠ Its MCP tools can read web pages, read your files and send them out/);
  } finally {
    rmSync(comboHome, { recursive: true, force: true });
  }

  // 8. the HTML report says what the terminal says (escaped): powers, combinations, traps, subprojects
  const htmlHome = mkdtempSync(path.join(os.tmpdir(), "vexryn-html-"));
  try {
    const run = (dir, extra = {}) => execFileSync("node", ["dist/cli.js", "scan", dir, "--deep", "--no-global", "--html"], { env: { ...process.env, VEXRYN_HOME: htmlHome, ...extra }, encoding: "utf8" });
    run("fixtures/deep-repo", { MOCK_FETCH: "1", MOCK_POISON: "1" });
    const html = readFileSync("fixtures/deep-repo/.vexryn/report.html", "utf8");
    assert.match(html, /can: send messages to external recipients, read files, access the network/);
    assert.match(html, /Its MCP tools can read web pages, read your files and send them out/);
    assert.match(html, /tool add — its description contains the phrase &quot;&lt;IMPORTANT&gt;&quot;/, "escaped, never raw markup");
    assert.ok(!html.includes("<IMPORTANT>") && !html.includes("id_rsa"));
    run(".");
    assert.match(readFileSync(".vexryn/report.html", "utf8"), /Not counted — subprojects[\s\S]*fixtures\/sample-repo\/\.mcp\.json[\s\S]*5 servers/);
  } finally {
    rmSync(htmlHome, { recursive: true, force: true });
  }

  console.log("deep-check: all assertions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
