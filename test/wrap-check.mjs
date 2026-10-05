#!/usr/bin/env node
// The terminal report fits the terminal: with a known width (a TTY, or COLUMNS),
// no line is longer than the width, words are never cut, and nothing is lost —
// a long location moves to its own line, a long warning wraps with an indent.
// Piped without COLUMNS, the layout is unchanged (tests, MCP, files).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve("dist/cli.js");
const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-wrap-"));
const scan = (extra = {}) => {
  const env = { ...process.env, VEXRYN_HOME: home, ...extra };
  delete env.FORCE_COLOR;
  return spawnSync("node", [cli, "scan", path.resolve("fixtures/demo")], { encoding: "utf8", env }).stdout;
};
const words = (s) => s.replace(/[⚠\s]+/g, " ").trim();

try {
  const wide = scan();
  assert.ok(wide.split("\n").some((l) => l.length > 100), "the demo fixture has lines longer than 100 columns");

  for (const width of [100, 80]) {
    const out = scan({ COLUMNS: String(width) });
    const long = out.split("\n").filter((l) => l.length > width);
    assert.deepEqual(long, [], `no line over ${width} columns`);
    assert.equal(words(out), words(wide), `same words in the same order at ${width} columns — nothing cut or lost`);
  }
  assert.match(scan({ COLUMNS: "100" }), /\n {8}[a-z@"]/, "a wrapped warning continues under its text, indented");

  console.log("wrap-check: all assertions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
