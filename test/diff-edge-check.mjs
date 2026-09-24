#!/usr/bin/env node
// `vexryn diff` edge cases from the final review — each one used to print a
// false fact. One temp repo, one commit per scenario, each diffed against the
// previous commit. Asserts:
//  - a server change hidden past the display cut is still reported (args delta)
//  - a changed agent file with nothing this review reads is never "no change";
//    unreviewed agent files (AGENTS.md) are named
//  - CLAUDE.md turned into a symlink to AGENTS.md: no fake token drop, and
//    AGENTS.md growth shows as CLAUDE.md growth
//  - a broken settings file yields no fake permission/hook/plugin lines;
//    a config fixed from broken to valid isn't reported as "all servers new"
//  - a CLAUDE.md symlink leaving the repo: named as not followed, no fake drop
//  - secrets in URLs, args, env assignments and hook commands are masked
//  - a huge env list keeps the comment under GitHub's limit
//  - "version not pinned": exact versions only, --package= parsed, no claim on paths
//  - permission modes: dontAsk/manual never warn, acceptEdits does
//  - an agent hook says it runs a subagent; the intro doesn't say "This PR" locally;
//    a flag without its value is a usage error

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve("dist/cli.js");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-edge-")));
const repo = path.join(tmp, "repo");
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim();
function put(rel, content) {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), typeof content === "string" ? content : JSON.stringify(content, null, 2));
}
let prev;
/** Commit the working tree and return the review of this commit vs the previous one. */
function step(msg) {
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", msg);
  const head = git("rev-parse", "HEAD");
  const r = spawnSync("node", [cli, "diff", repo, "--base", prev, "--head", head], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  prev = head;
  return r.stdout;
}
const mcp = (servers) => put(".mcp.json", { mcpServers: servers });
const dirs = Array.from({ length: 6 }, (_, i) => `/Users/dev/projects/client-number-${i}/workspace`);

try {
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  mcp({ fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@0.6.2", ...dirs] } });
  put("AGENTS.md", "# Shared rules\n" + "Use pnpm, never npm. ".repeat(50));
  put("CLAUDE.md", "# Shared rules\n" + "Use pnpm, never npm. ".repeat(50));
  put(".claude/settings.json", {
    permissions: { deny: ["Read(./.env)"] },
    hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
    enabledPlugins: { "foo@mk": true },
  });
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  prev = git("rev-parse", "HEAD");

  // C1 — the widening is past the 120-char display cut.
  mcp({ fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@0.6.2", ...dirs, "/"] } });
  let out = step("widen fs");
  assert.match(out, /MCP server `fs` changed .* — args added: `\/`/, out);
  assert.doesNotMatch(out, /No agent config/);

  // I1 — a settings field this review doesn't read, and an unreviewed agent file.
  put(".claude/settings.json", {
    permissions: { deny: ["Read(./.env)"] },
    hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
    enabledPlugins: { "foo@mk": true },
    statusLine: { type: "command", command: "~/bin/status.sh" },
  });
  out = step("status line");
  assert.doesNotMatch(out, /No agent config/, "a changed agent file is never 'no change'");
  assert.match(out, /not in any field this review reads/);
  assert.match(out, /Changed agent files: `\.claude\/settings\.json`/);
  put("AGENTS.md", "# Shared rules\n" + "Use pnpm, never npm. ".repeat(50) + "Deploy on Fridays.\n");
  out = step("agents.md");
  assert.match(out, /Not reviewed yet: `AGENTS\.md`/);

  // I2 — CLAUDE.md becomes a symlink to AGENTS.md (same content): no fake drop.
  unlinkSync(path.join(repo, "CLAUDE.md"));
  put("AGENTS.md", "# Shared rules\n" + "Use pnpm, never npm. ".repeat(50));
  symlinkSync("AGENTS.md", path.join(repo, "CLAUDE.md"));
  out = step("symlink");
  assert.doesNotMatch(out, /`CLAUDE\.md`: [\d,]+ → [\d,]+ tokens \(-/, "no fake token drop");
  put("AGENTS.md", "# Shared rules\n" + "Use pnpm, never npm. ".repeat(500));
  out = step("agents grows");
  assert.match(out, /^- `CLAUDE\.md`: [\d,]+ → [\d,]+ tokens \(\+[\d,]+\)$/m, "growth through the link is counted");

  // I3 — a broken settings file: one unreadable line, no fake removals.
  put(".claude/settings.json", "{ broken");
  out = step("broken settings");
  assert.match(out, /`\.claude\/settings\.json` is not valid JSON — its settings can't be reviewed/);
  assert.doesNotMatch(out, /no longer blocked|Hook removed|Stops enabling/, out);

  // Fixed from broken → valid: the servers were there before, just unreadable.
  put(".mcp.json", "{ broken");
  step("break mcp");
  mcp({ fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@0.6.2", ...dirs, "/"] } });
  out = step("fix mcp");
  assert.match(out, /`\.mcp\.json` was not valid JSON before — changes to its MCP servers can't be compared/);
  assert.doesNotMatch(out, /New MCP server/, "a fixed file doesn't make every server 'new'");

  // A CLAUDE.md link leaving the repo: not followed, not counted, never a fake drop.
  unlinkSync(path.join(repo, "CLAUDE.md"));
  writeFileSync(path.join(tmp, "outside.md"), "# Outside rules\n");
  symlinkSync("../outside.md", path.join(repo, "CLAUDE.md"));
  out = step("link outside");
  assert.match(out, /`CLAUDE\.md` is a symlink the review won't follow .* — not counted/);
  assert.doesNotMatch(out, /`CLAUDE\.md`: [\d,]+ → 0 tokens/, "no fake drop to zero");
  unlinkSync(path.join(repo, "CLAUDE.md"));
  symlinkSync("AGENTS.md", path.join(repo, "CLAUDE.md"));
  step("link back");

  // I4 — secrets in URLs, args, env assignments, hook commands.
  put(".claude/settings.json", {
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: 'curl -H "Authorization: Bearer ghp_HOOKSECRET123" https://x.test' }] }] },
  });
  mcp({
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@0.6.2", ...dirs, "/"] },
    zap: { url: "https://mcp.zapier.com/api/mcp/s/Zk9x2Lq8Wm4Tn7Rp3Vb6Yc1Hd5/sse?api_key=QUERYSECRET#frag" },
    pg: { command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres@0.6.2", "postgresql://admin:DBPASSWORD@db.test/app"] },
    tool: { command: "node", args: ["srv.js", "--api-key", "sk-ARGSECRET", "--token=FLAGSECRET", "OPENAI_API_KEY=ENVSECRET"] },
  });
  out = step("secrets");
  for (const secret of ["ghp_HOOKSECRET123", "Zk9x2Lq8Wm4Tn7Rp3Vb6Yc1Hd5", "QUERYSECRET", "DBPASSWORD", "sk-ARGSECRET", "FLAGSECRET", "ENVSECRET"]) {
    assert.ok(!out.includes(secret), `secret leaked: ${secret}\n${out}`);
  }
  assert.match(out, /New MCP server `zap`.*connects to `https:\/\/mcp\.zapier\.com\/api\/mcp\/s\/\*\*\*\/sse\?…`/, "URL shape kept, secret parts masked");

  // I5 — a huge env list stays under the comment size limit.
  const env = Object.fromEntries(Array.from({ length: 800 }, (_, i) => [`SOME_VERY_LONG_ENVIRONMENT_VARIABLE_NAME_NUMBER_${i}`, "x"]));
  mcp({ big: { command: "node", args: ["big.js"], env } });
  out = step("huge env");
  assert.ok(out.length < 65_536, `comment too long: ${out.length}`);
  assert.match(out, /\+790 more/);

  // M1 — pinning.
  mcp({
    a: { command: "npx", args: ["--package=foo@1.2.3", "foo-cli"] },
    b: { command: "npx", args: ["-y", "foo@next"] },
    c: { command: "npx", args: ["-y", "foo@^1.0.0"] },
    d: { command: "npx", args: ["./local-server"] },
    e: { command: "uvx", args: ["mcp-server-git==1.2.3"] },
  });
  out = step("pinning");
  const srv = (n) => out.split("\n").find((l) => l.includes(`server \`${n}\``));
  assert.doesNotMatch(srv("a"), /not pinned/, "--package=foo@1.2.3 is pinned");
  assert.match(srv("b"), /not pinned/, "a dist-tag is not a pin");
  assert.match(srv("c"), /not pinned/, "a range is not a pin");
  assert.doesNotMatch(srv("d"), /not pinned/, "no claim on a local path");
  assert.doesNotMatch(srv("e"), /not pinned/, "uvx ==1.2.3 is pinned");

  // M2 — permission modes.
  const mode = (m) => put(".claude/settings.json", m ? { permissions: { defaultMode: m } } : {});
  mode(null);
  step("reset mode");
  mode("dontAsk");
  assert.match(out = step("dontAsk"), /^- Permission mode: `default` → `dontAsk`/m);
  mode("manual");
  out = step("manual");
  assert.doesNotMatch(out, /⚠️ Permission mode/, "manual is an alias of default");
  mode("acceptEdits");
  assert.match(step("acceptEdits"), /^- ⚠️ Permission mode: `manual` → `acceptEdits`/m);

  // M8 — agent hook wording, local intro, flag without value.
  put(".claude/settings.json", { hooks: { Stop: [{ hooks: [{ type: "agent", prompt: "Check the tests" }] }] } });
  out = step("agent hook");
  assert.match(out, /New hook on `Stop`: runs a subagent with `Check the tests`/);
  assert.doesNotMatch(out, /This PR/, "the same text serves local runs");
  const noValue = spawnSync("node", [cli, "diff", repo, "--base", "HEAD", "--head"], { encoding: "utf8" });
  assert.equal(noValue.status, 2, "--head without a value is a usage error");

  console.log("diff-edge-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
