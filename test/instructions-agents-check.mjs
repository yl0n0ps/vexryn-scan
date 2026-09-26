#!/usr/bin/env node
// Always-loaded instructions of the newer agents (Codex, OpenCode, Zed, Kiro,
// Cline, Roo), per the matrix doc. Each is counted only when the agent is
// present. Fake home (VEXRYN_HOME); temp repos only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-instr2-")));
const home = path.join(tmp, "home");
const put = (base, rel, text) => {
  const p = path.join(base, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
};
const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");
const scan = (dir, ...extra) => strip(execFileSync("node", ["dist/cli.js", "scan", dir, ...extra], { env: { ...process.env, VEXRYN_HOME: home }, encoding: "utf8" }));
function section(out, header) {
  const lines = out.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(header));
  assert.ok(start !== -1, `missing section ${header}\n${out}`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === "");
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

try {
  const repo = path.join(tmp, "repo");
  // Each agent made "present" by its own dir/file, plus the instruction files it reads.
  put(repo, "AGENTS.md", "# Agents\nRun the tests before pushing.\n");
  put(repo, ".codex/config.toml", "[mcp_servers.x]\ncommand='node'\n");
  put(repo, "opencode.json", "{}\n");
  put(repo, ".kiro/settings/mcp.json", "{}\n");
  put(repo, ".kiro/steering/product.md", "---\ninclusion: always\n---\nShip weekly.\n");
  put(repo, ".kiro/steering/api.md", "---\ninclusion: fileMatch\nfileMatchPattern: '*.ts'\n---\nUse zod.\n");
  put(repo, ".clinerules", "Be terse.\n");
  put(repo, ".roo/mcp.json", "{}\n");
  put(repo, ".roo/rules/style.md", "Two-space indent.\n");

  const out = scan(repo, "--no-global");
  // Codex: reads root AGENTS.md.
  assert.match(section(out, "CODEX"), /AGENTS\.md\s+\d+ tok/);
  // OpenCode: AGENTS.md (would fall back to CLAUDE.md only if AGENTS.md were absent).
  assert.match(section(out, "OPENCODE"), /AGENTS\.md\s+\d+ tok/);
  // Kiro: an always-inclusion steering file counts; a fileMatch one does not.
  const kiro = section(out, "KIRO");
  assert.match(kiro, /1 always steering file\s+\d+ tok/);
  assert.match(kiro, /AGENTS\.md/);
  assert.ok(!kiro.includes("api.md"), "a fileMatch steering file is not always loaded");
  // Cline: the .clinerules file + AGENTS.md.
  const cline = section(out, "CLINE");
  assert.match(cline, /\.clinerules\s+\d+ tok/);
  assert.match(cline, /AGENTS\.md/);
  // Roo: the rules folder + AGENTS.md.
  const roo = section(out, "ROO CODE");
  assert.match(roo, /1 rule file\s+\d+ tok/);
  assert.match(roo, /AGENTS\.md/);

  // OpenCode falls back to CLAUDE.md only when there is no AGENTS.md.
  const oc = path.join(tmp, "oc");
  put(oc, "opencode.json", "{}\n");
  put(oc, "CLAUDE.md", "# Rules\nBe concise.\n");
  assert.match(section(scan(oc, "--no-global"), "OPENCODE"), /CLAUDE\.md\s+\d+ tok/);
  const oc2 = path.join(tmp, "oc2");
  put(oc2, "opencode.json", "{}\n");
  put(oc2, "AGENTS.md", "# Agents\nX.\n");
  put(oc2, "CLAUDE.md", "# Rules\nY.\n");
  assert.ok(!section(scan(oc2, "--no-global"), "OPENCODE").includes("CLAUDE.md"), "with AGENTS.md, OpenCode ignores CLAUDE.md");

  // Zed: first match of the 9-name list wins and shadows the rest.
  const zed = path.join(tmp, "zed");
  put(zed, ".zed/settings.json", "{}\n");
  put(zed, ".cursorrules", "Old cursor rules.\n");
  put(zed, "AGENTS.md", "# Agents\nThe good rules.\n");
  const zedOut = section(scan(zed, "--no-global"), "ZED");
  assert.match(zedOut, /\.cursorrules/, "Zed takes the first match");
  assert.match(zedOut, /shadows|ignore/i, "and says it shadows the rest");
  assert.ok(!/AGENTS\.md\s+\d+ tok/.test(zedOut), "Zed does not also count AGENTS.md");

  // An agent that isn't present gets no section from a lone AGENTS.md.
  const bare = path.join(tmp, "bare");
  put(bare, "AGENTS.md", "# Agents\n");
  const bareOut = scan(bare, "--no-global");
  for (const h of ["CODEX", "ZED", "KIRO", "CLINE", "ROO CODE", "OPENCODE"]) assert.ok(!bareOut.includes(h), `${h} must not appear for a lone AGENTS.md`);

  console.log("instructions-agents-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
