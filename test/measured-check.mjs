#!/usr/bin/env node
// The local measurement store and the drift facts it enables. Fake home only.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-measured-"));
process.env.VEXRYN_HOME = home;
const { drift, estimateFromMeasured, loadMeasured, saveMeasured, measuredKey, toolHash } = await import("../dist/scan/measured.js");

// The drift hash ignores key order: the same schema serialized differently is not a change.
assert.equal(
  toolHash("Read a file", { type: "object", properties: { path: { type: "string" }, mode: { enum: ["a", "b"] } } }),
  toolHash("Read a file", { properties: { mode: { enum: ["a", "b"] }, path: { type: "string" } }, type: "object" }),
  "key order does not change the hash",
);
assert.notEqual(toolHash("Read a file", { properties: { path: {} } }), toolHash("Read a file", { properties: { file: {} } }), "a real change does");
assert.notEqual(toolHash("Read a file", {}), toolHash("Read any file", {}), "a description change does");
assert.equal(toolHash("x", { a: [{ b: 1, a: 2 }] }), toolHash("x", { a: [{ a: 2, b: 1 }] }), "objects inside arrays are canonicalized too");

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

// The key is a digest: a credential written inline in a command or URL must never be copied into the store.
const key = measuredKey({ transport: "stdio", target: "npx foo --token ghp_SECRET" });
assert.match(key, /^[0-9a-f]{64}$/, "key is a sha256 digest");
assert.ok(!key.includes("ghp_SECRET"));
assert.notEqual(key, measuredKey({ transport: "http", target: "npx foo --token ghp_SECRET" }), "transport is part of the key");

try {
  assert.deepEqual(await loadMeasured(), {}, "no store yet → empty");
  mkdirSync(path.join(home, ".vexryn"), { recursive: true });
  writeFileSync(path.join(home, ".vexryn", "measured.json"), "{ not json");
  assert.deepEqual(await loadMeasured(), {}, "corrupt store → empty, no crash");
  writeFileSync(
    path.join(home, ".vexryn", "measured.json"),
    JSON.stringify({ bad1: { measuredAt: "2026-09-01" }, bad2: { measuredAt: "2026-09-01", tools: "nope" }, bad3: null, ok: prev }),
  );
  assert.deepEqual(await loadMeasured(), { ok: prev }, "malformed entries are dropped, good ones kept");
  // A measurement older than 90 days is forgotten: a server gone from every config does not linger forever.
  const fresh = { ...prev, measuredAt: new Date().toISOString() };
  const stale = { ...prev, measuredAt: new Date(Date.now() - 91 * 86_400_000).toISOString() };
  writeFileSync(path.join(home, ".vexryn", "measured.json"), JSON.stringify({ fresh, stale }));
  assert.deepEqual(await loadMeasured(), { fresh }, "entries older than 90 days are dropped on load");
  await saveMeasured({ "stdio node x.js": prev });
  assert.deepEqual(await loadMeasured(), { "stdio node x.js": prev }, "round-trip");
  console.log("measured-check: all assertions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
