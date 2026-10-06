#!/usr/bin/env node
// The live experience in a real terminal: the logo first, then a checklist whose
// every result is real, then the report — paced, not dumped at once. Piped, in CI,
// or as JSON, nothing changes: no checklist, instant.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-live-"));
process.env.VEXRYN_HOME = home;
const demo = path.resolve("fixtures/demo");
const cli = path.resolve("dist/cli.js");
const plain = (s) => s.replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, "").replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n");

try {
  // --- the checklist says what the scan really found
  const { collectStatic } = await import(path.resolve("dist/scan/collect.js"));
  const { assembleReport, scanSteps } = await import(path.resolve("dist/scan/report.js"));
  const c = await collectStatic(demo, true);
  const steps = scanSteps(assembleReport(demo, false, true, c.configs, c.servers, c.claude, c.others));
  const results = steps.map((st) => st.found).join("\n");
  assert.match(results, /4 MCP servers, 4 in the Vexryn catalogue/);
  assert.match(results, /1 dangerous combination/);
  assert.match(results, /1 secret written in plain text/);
  assert.match(results, /2 deprecated packages/);
  for (const st of steps) assert.ok(st.doing.endsWith("…"), `a step says what it is doing: ${st.doing}`);
  assert.deepEqual(steps.map((st) => !!st.alert), [false, false, true], "only a step that found a risk is an alert");

  // --- piped: no checklist, unchanged
  const piped = spawnSync("node", [cli, "scan", demo], { encoding: "utf8", env: { ...process.env } });
  assert.doesNotMatch(piped.stdout + piped.stderr, /✓/, "no checklist when piped");

  // --- a real terminal (a pty via `script`): logo → checklist → report, paced
  const cmd = `stty cols 120 rows 60; node ${cli} scan ${demo}`;
  const args = process.platform === "darwin" ? ["-q", "/dev/null", "/bin/sh", "-c", cmd] : ["-qec", cmd, "/dev/null"];
  const t0 = Date.now();
  const tty = spawnSync("script", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TERM: "xterm-256color", CI: "" } });
  const ms = Date.now() - t0;
  const out = plain(tty.stdout);
  const at = (re) => out.search(re);
  assert.ok(at(/██╗/) >= 0, `the logo shows in a terminal\n${out.slice(0, 400)}`);
  assert.ok(at(/✓ Read 3 agent configs/) > at(/██╗/), "the logo comes first, then the checklist");
  assert.ok(at(/✓ 4 MCP servers/) > at(/✓ Read 3 agent configs/), "checks in order");
  assert.ok(at(/⚠ 1 dangerous combination/) > at(/✓ 4 MCP servers/), "a risk found is marked ⚠, not ✓");
  assert.doesNotMatch(out, /✓ 1 dangerous/, "never a green check on a risk");
  assert.ok(at(/CLAUDE CODE/) > at(/⚠ 1 dangerous combination/), "the report comes after the checklist");
  assert.match(out, /dangerous combination[^\n]*\n\s*\n\s*Found 3 agent configs/, "a blank line between the checklist and the report");
  assert.ok(ms >= 1200, `paced, not dumped at once (${ms} ms)`);
  assert.ok(ms < 6000, `but short (${ms} ms)`);

  // --- CI or JSON in a terminal: instant, no checklist
  const ci = spawnSync("script", process.platform === "darwin" ? ["-q", "/dev/null", "/bin/sh", "-c", cmd] : ["-qec", cmd, "/dev/null"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TERM: "xterm-256color", CI: "true" } });
  assert.doesNotMatch(plain(ci.stdout), /✓ Read/, "CI: no checklist");

  console.log("live-check: all assertions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
