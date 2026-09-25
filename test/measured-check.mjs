#!/usr/bin/env node
// The local measurement store and the drift facts it enables. Fake home only.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-measured-"));
process.env.VEXRYN_HOME = home;
const { drift, estimateFromMeasured, loadMeasured, saveMeasured, measuredKey } = await import("../dist/scan/measured.js");

const tool = (name, hash, tokens = 10, power = null) => ({ name, description: "", tokens, hash, power });
const prev = { measuredAt: "2026-09-01T10:00:00.000Z", tools: [tool("a", "h1"), tool("b", "h2"), tool("gone", "h3")] };

assert.deepEqual(drift(prev, prev.tools), [], "same tools, same hashes → no drift");
const facts = drift(prev, [tool("a", "h1"), tool("b", "CHANGED"), tool("new\u001b[31m", "h4")]);
assert.deepEqual(
  facts,
  [
    "+1 tool since 2026-09-01: new[31m",
    "1 tool gone since 2026-09-01: gone",
    "1 tool changed its description or schema since 2026-09-01: b",
  ],
  "exact facts, control chars stripped",
);

const est = estimateFromMeasured(prev);
assert.equal(est.toolCount, 3);
assert.equal(est.approxTokens, 30);
assert.equal(est.source, "measured");
assert.equal(est.measuredAt, prev.measuredAt);

assert.equal(measuredKey({ transport: "stdio", target: "node x.js" }), "stdio node x.js");

try {
  assert.deepEqual(await loadMeasured(), {}, "no store yet → empty");
  mkdirSync(path.join(home, ".vexryn"), { recursive: true });
  writeFileSync(path.join(home, ".vexryn", "measured.json"), "{ not json");
  assert.deepEqual(await loadMeasured(), {}, "corrupt store → empty, no crash");
  await saveMeasured({ "stdio node x.js": prev });
  assert.deepEqual(await loadMeasured(), { "stdio node x.js": prev }, "round-trip");
  console.log("measured-check: all assertions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
