#!/usr/bin/env node
// The package exposes the event validator to the cloud (and to anyone) at
// `vexryn/events`, and nothing else beyond the CLI binary. Checked on the
// packed tarball, i.e. exactly what npm would publish.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = mkdtempSync(path.join(os.tmpdir(), "vexryn-exports-"));
try {
  const tgz = execFileSync("npm", ["pack", "--silent", "--pack-destination", tmp], { encoding: "utf8" }).trim();
  writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
  execFileSync("npm", ["install", "--silent", "--no-audit", "--no-fund", path.join(tmp, tgz)], { cwd: tmp });
  writeFileSync(path.join(tmp, "t.mjs"), 'import { validateReviewEvent } from "vexryn/events"; console.log(JSON.stringify(validateReviewEvent({})));');
  const out = execFileSync("node", ["t.mjs"], { cwd: tmp, encoding: "utf8" });
  assert.match(out, /"ok":false/, "the validator is importable from the installed package");
  assert.throws(() => execFileSync("node", ["--input-type=module", "-e", 'import "vexryn/diff/review.js"'], { cwd: tmp, stdio: "pipe" }), "internals are not exported");
  console.log("exports-check: all assertions passed");
} finally { rmSync(tmp, { recursive: true, force: true }); }
