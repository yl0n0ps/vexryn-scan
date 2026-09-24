#!/usr/bin/env node
// Snapshot check: one side of a diff is materialized from git objects into a
// temp dir, agent-config paths only. Asserts:
//  - a commit snapshot holds exactly the config files, byte for byte
//    (not a skill's resources, not source code)
//  - the working-tree snapshot (null) sees uncommitted edits and new
//    unignored files, skips .gitignore'd ones, survives a deleted tracked file
//  - bad refs and non-git dirs fail loudly
//  - a symlinked CLAUDE.md is read through its in-repo target (one hop);
//    a link leaving the repo is not followed and is reported
//  - every agent file (reviewed or not, e.g. AGENTS.md) gets a content hash

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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
  const side = await snapshot(repo, sha);
  snaps.push(side.dir);
  return side;
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
  const committedSide = await snap(head);
  const committed = committedSide.dir;
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
  const working = (await snap(null)).dir;
  assert.equal(read(working, "CLAUDE.md"), "# Rules\nBe kind.\nAnd fast.\n", "uncommitted edit seen");
  assert.ok(existsSync(path.join(working, ".cursor/mcp.json")), "new unignored file seen");
  assert.ok(!existsSync(path.join(working, ".claude/settings.local.json")), "ignored file skipped");
  assert.ok(!existsSync(path.join(working, ".claude/skills/a/SKILL.md")), "deleted file is absent");

  // Hashes: every agent file, reviewed or not; never source code.
  assert.ok(committedSide.hashes["CLAUDE.md"] && committedSide.hashes[".mcp.json"]);
  assert.ok(!("src/app.js" in committedSide.hashes));

  // Symlinks: CLAUDE.md -> AGENTS.md (in repo) is read through; a link out of the repo is not.
  put("AGENTS.md", "# Shared agent rules\nUse pnpm.\n");
  unlinkSync(path.join(repo, "CLAUDE.md"));
  symlinkSync("AGENTS.md", path.join(repo, "CLAUDE.md"));
  put("outside.txt", "secret stuff\n");
  mkdirSync(path.join(repo, "pkg"), { recursive: true });
  symlinkSync("../../outside.txt", path.join(repo, "pkg", "CLAUDE.md"));
  git("add", "-A");
  git("commit", "-q", "-m", "links");
  for (const sha of [await resolveRef(repo, "HEAD"), null]) {
    const side = await snap(sha);
    assert.equal(read(side.dir, "CLAUDE.md"), "# Shared agent rules\nUse pnpm.\n", `symlink read through its target (${sha ? "commit" : "working tree"})`);
    assert.ok(!existsSync(path.join(side.dir, "pkg/CLAUDE.md")), "a link leaving the repo is not followed");
    assert.deepEqual(side.unresolved, ["pkg/CLAUDE.md"]);
    assert.ok(side.hashes["AGENTS.md"], "unreviewed agent files are hashed for change detection");
  }

  await assert.rejects(resolveRef(repo, "--output=/tmp/pwned"), /invalid ref/);
  await assert.rejects(resolveRef(repo, "nope"), /unknown git ref: nope/);
  await assert.rejects(gitRoot(tmp), /not a git repository/);
  assert.equal(await gitRoot(path.join(repo, "src")), repo);

  console.log("snapshot-check: all assertions passed");
} finally {
  for (const d of snaps) rmSync(d, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
}
