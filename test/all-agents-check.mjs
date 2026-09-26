#!/usr/bin/env node
// Depth test: one fixture repo carrying a config for every agent Vexryn covers.
// The scan reports each agent with its own load; the review names each changed
// file. A guarded smoke (VEXRYN_SMOKE=1) runs scan over the real machine.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");
const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-all-home-"));
const env = { ...process.env, VEXRYN_HOME: home };

try {
  // --- scan: every agent gets its own section --------------------------------
  const out = strip(execFileSync("node", ["dist/cli.js", "scan", "fixtures/all-agents", "--no-global"], { env, encoding: "utf8" }));
  for (const h of ["CLAUDE CODE", "CODEX", "GITHUB COPILOT CLI", "ROO CODE", "CONTINUE", "ZED", "KIRO", "OPENCODE", "VS CODE", "CURSOR", "WINDSURF", "GEMINI CLI"]) {
    assert.ok(out.includes(h), `scan is missing the ${h} section:\n${out}`);
  }
  // catalogue powers, deprecation, and the config-fact rules all fire across agents
  assert.match(out, /CODEX[\s\S]*is given \/ — a whole filesystem\/home/);
  assert.match(out, /CODEX[\s\S]*connects over plain http:\/\/ \(unencrypted\)/);
  assert.match(out, /CONTINUE[\s\S]*BRAVE_API_KEY is a literal secret/);
  assert.match(out, /GITHUB COPILOT CLI[\s\S]*marked deprecated by its publisher/);
  assert.match(out, /OPENCODE[\s\S]*can: .*run commands or code/);

  // --- review: a change to each agent's file is named ------------------------
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-all-repo-")));
  cpSync("fixtures/all-agents", repo, { recursive: true });
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  // touch one config of every format so each agent file shows as changed
  for (const [rel, add] of [
    [".codex/config.toml", '\n[mcp_servers.extra]\ncommand = "node"\n'],
    ["opencode.json", ""],
    [".continue/mcpServers/search.yaml", "\n  - name: extra\n    command: node\n"],
    [".zed/settings.json", ""],
    [".roo/mcp.json", ""],
    ["AGENTS.md", "\nAlways write a test first.\n"],
  ]) {
    const p = path.join(repo, rel);
    writeFileSync(p, execFileSync("cat", [p], { encoding: "utf8" }) + add);
  }
  const review = execFileSync("node", [path.resolve("dist/cli.js"), "diff", repo, "--base", "main"], { env, encoding: "utf8" });
  for (const f of [".codex/config.toml", ".continue/mcpServers/search.yaml", "AGENTS.md"]) {
    assert.ok(review.includes(`\`${f}\``), `review does not name ${f}:\n${review}`);
  }
  assert.match(review, /New MCP server `extra`.*Codex/, "the new Codex server is reviewed");
  rmSync(repo, { recursive: true, force: true });

  // --- smoke: scan the real machine, opt-in ---------------------------------
  if (process.env.VEXRYN_SMOKE === "1") {
    const real = strip(execFileSync("node", ["dist/cli.js", "scan", "."], { encoding: "utf8", timeout: 60_000 }));
    assert.match(real, /vexryn · agent load report/, "real scan produced a report");
  }

  console.log("all-agents-check: all assertions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
