#!/usr/bin/env node
// Snapshot check: one side of a diff is materialized from git objects into a
// temp dir, agent-config paths only. Asserts:
//  - a commit snapshot holds exactly the config files, byte for byte
//    (not a skill's resources, not source code)
//  - the working-tree snapshot (null) sees uncommitted edits and new
//    unignored files, skips .gitignore'd ones, survives a deleted tracked file
//  - bad refs and non-git dirs fail loudly

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitRoot, isAgentConfigPath, resolveRef, snapshot } from "../dist/diff/snapshot.js";

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-snap-")));
const repo = path.join(tmp, "repo");
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
function put(rel, content) {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), content);
}
const snaps = [];
async function snap(sha) {
  const dir = await snapshot(repo, sha);
  snaps.push(dir);
  return dir;
}
const read = (dir, rel) => readFileSync(path.join(dir, rel), "utf8");

try {
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  put(".mcp.json", '{"mcpServers":{"github":{"command":"npx"}}}\n');
  put("CLAUDE.md", "# Rules\nBe kind.\n");
  put(".claude/skills/a/SKILL.md", "---\nname: a\ndescription: A.\n---\n");
  put(".claude/skills/a/scripts/x.sh", "echo hi\n");
  put("src/app.js", "console.log(1)\n");
  put(".gitignore", ".claude/settings.local.json\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");

  assert.ok(isAgentConfigPath(".cursor/mcp.json") && isAgentConfigPath("pkg/.mcp.json"));
  assert.ok(!isAgentConfigPath(".claude/skills/a/scripts/x.sh") && !isAgentConfigPath("src/app.js"));

  const head = await resolveRef(repo, "HEAD");
  assert.match(head, /^[0-9a-f]{40}$/);
  const committed = await snap(head);
  assert.equal(read(committed, ".mcp.json"), '{"mcpServers":{"github":{"command":"npx"}}}\n');
  assert.equal(read(committed, "CLAUDE.md"), "# Rules\nBe kind.\n");
  assert.ok(existsSync(path.join(committed, ".claude/skills/a/SKILL.md")));
  assert.ok(!existsSync(path.join(committed, ".claude/skills/a/scripts/x.sh")), "skill resources are not copied");
  assert.ok(!existsSync(path.join(committed, "src/app.js")), "source code is not copied");

  // Working tree: an edit, a new unignored file, an ignored file, a deleted tracked file.
  put("CLAUDE.md", "# Rules\nBe kind.\nAnd fast.\n");
  put(".cursor/mcp.json", '{"mcpServers":{}}\n');
  put(".claude/settings.local.json", '{"permissions":{"allow":["Bash(*)"]}}\n');
  unlinkSync(path.join(repo, ".claude/skills/a/SKILL.md"));
  const working = await snap(null);
  assert.equal(read(working, "CLAUDE.md"), "# Rules\nBe kind.\nAnd fast.\n", "uncommitted edit seen");
  assert.ok(existsSync(path.join(working, ".cursor/mcp.json")), "new unignored file seen");
  assert.ok(!existsSync(path.join(working, ".claude/settings.local.json")), "ignored file skipped");
  assert.ok(!existsSync(path.join(working, ".claude/skills/a/SKILL.md")), "deleted file is absent");

  await assert.rejects(resolveRef(repo, "--output=/tmp/pwned"), /invalid ref/);
  await assert.rejects(resolveRef(repo, "nope"), /unknown git ref: nope/);
  await assert.rejects(gitRoot(tmp), /not a git repository/);
  assert.equal(await gitRoot(path.join(repo, "src")), repo);

  console.log("snapshot-check: all assertions passed");
} finally {
  for (const d of snaps) rmSync(d, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
}
