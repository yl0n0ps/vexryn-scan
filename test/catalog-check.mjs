#!/usr/bin/env node
// The catalogue: produced only by scripts/measure-catalog.mjs (in GitHub Actions),
// holding facts, never tool descriptions. Offline: measures the local mock only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(os.tmpdir(), "vexryn-catalog-"));
const list = path.join(tmp, "servers.json");
const out = path.join(tmp, "catalog.json");
const run = (extraArgs, env = {}) =>
  spawnSync("node", ["scripts/measure-catalog.mjs", "--list", list, "--out", out, ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "", ...env },
  });

/** Every catalogue entry is facts only: no description anywhere, provenance on every version. */
function assertShape(catalog, where) {
  assert.equal(catalog.schema, 1, where);
  assert.ok(!JSON.stringify(catalog).includes('"description"'), `${where}: no tool description is ever stored`);
  for (const [key, entry] of Object.entries(catalog.servers)) {
    assert.match(key, /^(npm|pypi|local):.+/, `${where}: ${key}`);
    assert.ok(entry.versions[entry.latest], `${where}: ${key} latest is measured`);
    for (const [ver, v] of Object.entries(entry.versions)) {
      assert.ok(v.measuredAt && v.by && Array.isArray(v.tools), `${where}: ${key}@${ver}`);
      for (const t of v.tools) assert.ok(typeof t.name === "string" && Number.isInteger(t.tokens) && /^[0-9a-f]{64}$/.test(t.hash), `${where}: ${key}@${ver} ${t.name}`);
    }
  }
}

try {
  writeFileSync(list, JSON.stringify({ "local:mock-local": { command: "node", args: ["fixtures/mock-mcp-server.mjs"], env: ["MOCK_POISON"] } }));

  // Never on a person's machine by accident.
  let r = run([]);
  assert.equal(r.status, 2, "refuses outside GitHub Actions");
  assert.match(r.stderr, /only in GitHub Actions/);

  r = run(["--local-ok"]);
  assert.equal(r.status, 0, r.stderr);
  const cat = JSON.parse(readFileSync(out, "utf8"));
  assertShape(cat, "offline run");
  const v = cat.servers["local:mock-local"].versions["0.0.0-local"];
  assert.equal(v.tools.length, 6, "the mock's 5 tools + the poisoned one (MOCK_POISON set to a dummy value)");
  assert.equal(v.tools.find((t) => t.name === "send_email").power, "external-message.send");
  assert.deepEqual(v.tools.find((t) => t.name === "add").flags.phrases.slice(0, 1), ["<IMPORTANT>"]);
  assert.equal(v.by, "local");
  assert.match(r.stdout, /measured 1, failed 0/);

  // A second run keeps what was measured before (merge, never wipe).
  writeFileSync(list, JSON.stringify({ "local:broken": { command: "node", args: ["-e", "process.exit(1)"] } }));
  r = run(["--local-ok"]);
  assert.equal(r.status, 0, r.stderr);
  const again = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(again.servers["local:mock-local"], "earlier measurements are kept");
  assert.ok(!again.servers["local:broken"], "a server that fails is never listed");
  assert.match(r.stdout, /measured 0, failed 1/);

  // A server that never answers is given up on, stopped, and the run still ends.
  writeFileSync(list, JSON.stringify({ "local:hang": { command: "node", args: ["-e", "setInterval(() => {}, 1000)"] } }));
  const t0 = Date.now();
  r = spawnSync("node", ["scripts/measure-catalog.mjs", "--list", list, "--out", out, "--local-ok", "--timeout-ms", "1500"], { encoding: "utf8", timeout: 20_000, env: { ...process.env, GITHUB_ACTIONS: "" } });
  assert.equal(r.status, 0, `the run ends by itself (${r.error ?? r.stderr})`);
  assert.match(r.stdout, /measured 0, failed 1/);
  assert.ok(Date.now() - t0 < 15_000, "the hung server was stopped at its timeout");

  // The shipped catalogue, when present, follows the same rules.
  if (existsSync("catalog/catalog.json")) {
    const shipped = JSON.parse(readFileSync("catalog/catalog.json", "utf8"));
    assertShape(shipped, "catalog/catalog.json");
    for (const [key, entry] of Object.entries(shipped.servers)) {
      assert.ok(!key.startsWith("local:"), `${key}: no local entry ships`);
      for (const [ver, x] of Object.entries(entry.versions)) assert.match(x.by, /^https:\/\/github\.com\/yl0n0ps\/vexryn-scan\/actions\/runs\/\d+$/, `${key}@${ver} was measured by the public workflow`);
    }
  }
  // The shipped catalogue is found by its default path (as in the npm package) and used by a static scan.
  if (existsSync("catalog/catalog.json")) {
    const repo = path.join(tmp, "repo");
    const home = path.join(tmp, "home");
    mkdirSync(repo);
    mkdirSync(home);
    writeFileSync(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { slack: { command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"] } } }));
    const env = { ...process.env, VEXRYN_HOME: home };
    delete env.VEXRYN_CATALOG;
    const out = spawnSync("node", ["dist/cli.js", "scan", repo, "--no-global"], { encoding: "utf8", env }).stdout.replace(/\u001b\[[0-9;]*m/g, "");
    assert.match(out, /slack\s+\d+ tools · ~\d+ tok .*catalog @modelcontextprotocol\/server-slack@/, out);
    assert.match(out, /can: send messages to external recipients/);
  }
  console.log("catalog-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
