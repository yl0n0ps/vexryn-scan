#!/usr/bin/env node
// What Cursor, Windsurf and Gemini CLI load every session (docs checked 2026-09-26), in the
// load report and in the review. Fake home (VEXRYN_HOME); temp repos only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-instr-")));
const home = path.join(tmp, "home");
const put = (p, text) => {
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
  put(path.join(repo, ".cursor/rules/always.mdc"), "---\nalwaysApply: true\n---\nAlways use tabs. Never commit secrets.\n");
  put(path.join(repo, ".cursor/rules/sql/smart.mdc"), "---\ndescription: Use when writing SQL migrations\nalwaysApply: false\n---\nLong SQL guide. ".repeat(3) + "\n");
  put(path.join(repo, ".cursor/rules/ts.mdc"), "---\nglobs: \"*.ts\"\nalwaysApply: false\n---\nTypeScript only.\n");
  put(path.join(repo, "AGENTS.md"), "# Agents\nRun the tests before pushing.\n");
  put(path.join(repo, ".windsurf/rules/on.md"), "---\ntrigger: always_on\n---\nBe concise.\n");
  put(path.join(repo, ".windsurf/rules/model.md"), "---\ntrigger: model_decision\ndescription: Use for release work\n---\nRelease checklist.\n");
  put(path.join(repo, "GEMINI.md"), "# Gemini\nPrefer small diffs.\n");
  put(path.join(home, ".gemini/GEMINI.md"), "I am a French speaker.\n");
  put(path.join(home, ".codeium/windsurf/memories/global_rules.md"), "Global windsurf rule.\n");

  let out = scan(repo);
  const cursor = section(out, "CURSOR");
  assert.match(cursor, /1 always-apply rule\s+\d+ tok/);
  assert.match(cursor, /1 rule description\s+\d+ tok/);
  assert.match(cursor, /AGENTS\.md\s+\d+ tok/);
  assert.ok(!cursor.includes("ts.mdc"), "a rule attached by file pattern is not loaded every session");
  const windsurf = section(out, "WINDSURF");
  assert.match(windsurf, /1 always-on rule\s+\d+ tok/);
  assert.match(windsurf, /1 rule description\s+\d+ tok/);
  assert.match(windsurf, /AGENTS\.md/);
  assert.match(windsurf, /~\/\.codeium\/windsurf\/memories\/global_rules\.md/);
  const gemini = section(out, "GEMINI CLI");
  assert.match(gemini, /GEMINI\.md\s+\d+ tok/);
  assert.match(gemini, /~\/\.gemini\/GEMINI\.md/);
  assert.ok(!gemini.includes("AGENTS.md"), "Gemini reads AGENTS.md only when context.fileName says so");

  // Gemini's context.fileName can name AGENTS.md.
  put(path.join(repo, ".gemini/settings.json"), JSON.stringify({ context: { fileName: ["AGENTS.md", "GEMINI.md"] } }));
  assert.match(section(scan(repo, "--no-global"), "GEMINI CLI"), /AGENTS\.md/);

  // A Cursor-rules-only repo still gets its own section, with no MCP server.
  const cursorOnly = path.join(tmp, "cursor-only");
  put(path.join(cursorOnly, ".cursor/rules/always.mdc"), "---\nalwaysApply: true\n---\nTabs.\n");
  out = scan(cursorOnly, "--no-global");
  assert.match(section(out, "CURSOR"), /1 always-apply rule/);
  // An agent that isn't there gets no section: a lone AGENTS.md is not "Cursor".
  const bare = path.join(tmp, "bare");
  put(path.join(bare, "AGENTS.md"), "# Agents\n");
  out = scan(bare, "--no-global");
  assert.ok(!out.includes("CURSOR") && !out.includes("WINDSURF"), out);

  // Review: an always-apply rule edit is a load change for Cursor; a pattern rule isn't counted.
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  put(path.join(repo, ".cursor/rules/always.mdc"), "---\nalwaysApply: true\n---\nAlways use tabs. Never commit secrets. " + "Explain every change in detail. ".repeat(20) + "\n");
  put(path.join(repo, ".cursor/rules/ts.mdc"), "---\nglobs: \"*.ts\"\nalwaysApply: false\n---\nTypeScript only, strict mode.\n");
  put(path.join(repo, "GEMINI.md"), "# Gemini\nPrefer small diffs. Write tests first.\n");
  const review = execFileSync("node", [path.resolve("dist/cli.js"), "diff", repo, "--base", "main"], { encoding: "utf8" }).replace(/ <sub>vx-[0-9a-f]{8}<\/sub>/g, "");
  assert.match(review, /^\*\*Loads every session \(Cursor\): [\d,]+ → [\d,]+ tokens \(\+[\d,]+\)\*\*$/m);
  assert.match(review, /^- Always-apply rules: 1 → 1 \(\+[\d,]+ tokens\)$/m);
  assert.match(review, /^\*\*Loads every session \(Gemini CLI\): [\d,]+ → [\d,]+ tokens \(\+[\d,]+\)\*\*$/m);
  assert.match(review, /Changed agent files: .*`\.cursor\/rules\/always\.mdc`/);
  assert.match(review, /Not reviewed yet: `\.cursor\/rules\/ts\.mdc`/);
  console.log("instructions-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
