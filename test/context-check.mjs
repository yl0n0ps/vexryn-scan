#!/usr/bin/env node
// Claude Code "always loaded" context check, against a FAKE home (VEXRYN_HOME)
// and a temp repo, so the real user setup is never read or touched. Asserts
// what Claude Code documents as loaded at session start
// (https://code.claude.com/docs/en/context-window):
//  - CLAUDE.md at the repo root + ~/.claude/CLAUDE.md, in full; a nested
//    sub/CLAUDE.md is NOT loaded at startup (read on demand)
//  - auto memory MEMORY.md: first 200 lines only
//  - skill descriptions (user + enabled plugins), not disabled plugins, not
//    `disable-model-invocation: true` skills
//  - subagent descriptions (user + enabled plugins)
//  - MCP servers from enabled plugins; tool schemas deferred by default
//    (tool search), loaded up front when ENABLE_TOOL_SEARCH=false
//  - --no-global keeps only what lives in the repo
//  - no invented catalog figures: an unmeasured server says so

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { encode } from "gpt-tokenizer";

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-ctx-")));
const home = path.join(tmp, "home");
const repo = path.join(tmp, "repo");

function put(p, content) {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}
const skill = (name, description, extra = "") =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n\n${"Body text. ".repeat(200)}\n`;

// Repo: root CLAUDE.md (loaded), nested one (not loaded at startup), one server.
const rootClaude = "# Rules\n\n" + "Always write tests first. ".repeat(40);
put(path.join(repo, "CLAUDE.md"), rootClaude);
put(path.join(repo, "sub", "CLAUDE.md"), "nested ".repeat(500));
put(path.join(repo, ".mcp.json"), { mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] } } });

// Home: global CLAUDE.md, auto memory (300 lines, only 200 load), skills, agents.
const claude = path.join(home, ".claude");
put(path.join(claude, "CLAUDE.md"), "Global rule. ".repeat(30));
const memLines = Array.from({ length: 300 }, (_, i) => `- memory note ${i}`);
const encoded = repo.replace(/[^a-zA-Z0-9]/g, "-");
put(path.join(claude, "projects", encoded, "memory", "MEMORY.md"), memLines.join("\n"));
put(path.join(claude, "skills", "userskill", "SKILL.md"), skill("userskill", "Use when the user asks for a user skill."));
put(path.join(claude, "skills", "manual", "SKILL.md"), skill("manual", "Only by hand.", "disable-model-invocation: true\n"));
put(path.join(claude, "skills", "synced", "abc", "docx", "SKILL.md"), skill("docx", ">\n  Use for Word documents,\n  folded over two lines."));
put(path.join(claude, "agents", "README.md"), "# Notes about my agents\n");
put(path.join(claude, "agents", "ops.md"), "---\nname: ops\ndescription: Infra and deploys.\n---\n\nYou are ops.\n");

// Plugins: one enabled (skill + agent + MCP server), one disabled.
const good = path.join(tmp, "plugins", "good");
const off = path.join(tmp, "plugins", "off");
put(path.join(good, "skills", "alpha", "SKILL.md"), skill("alpha", '"Use when alpha things happen."'));
put(path.join(good, "agents", "helper.md"), "---\nname: helper\ndescription: |-\n  Helps with plugin work.\n---\n\nBody.\n");
put(path.join(good, ".mcp.json"), { mcpServers: { "plug-docs": { type: "http", url: "https://example.test/mcp" } } });
put(path.join(off, "skills", "beta", "SKILL.md"), skill("beta", "Disabled plugin skill."));
put(path.join(off, ".mcp.json"), { mcpServers: { "off-server": { type: "http", url: "https://off.test/mcp" } } });
put(path.join(claude, "settings.json"), { enabledPlugins: { "good@mk": true, "off@mk": false } });
put(path.join(claude, "plugins", "installed_plugins.json"), {
  version: 2,
  plugins: { "good@mk": [{ scope: "user", installPath: good }], "off@mk": [{ scope: "user", installPath: off }] },
});

function scan(extraEnv = {}, ...extra) {
  const env = { ...process.env, VEXRYN_HOME: home };
  delete env.ENABLE_TOOL_SEARCH;
  delete env.ANTHROPIC_BASE_URL;
  Object.assign(env, extraEnv);
  const out = execFileSync("node", ["dist/cli.js", "scan", repo, ...extra], { env, encoding: "utf8" });
  return out.replace(/\u001b\[[0-9;]*m/g, "");
}

/** Lines of one agent's section (from its header to the next blank line). */
function section(out, header) {
  const lines = out.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(header));
  assert.ok(start !== -1, `missing section ${header}\n${out}`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === "");
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}
const tok = (s) => encode(s).length;
const tokensOf = (sec, label) => {
  const m = sec.match(new RegExp(`${label}\\s+([\\d,]+) tok`));
  assert.ok(m, `no token figure for ${label}\n${sec}`);
  return Number(m[1].replace(/,/g, ""));
};

try {
  const out = scan();
  const cc = section(out, "CLAUDE CODE");

  assert.equal(tokensOf(cc, "CLAUDE\\.md"), tok(rootClaude), "root CLAUDE.md counted in full");
  assert.ok(!cc.includes("sub/CLAUDE.md"), "nested CLAUDE.md is not loaded at startup");
  assert.ok(tokensOf(cc, "~/\\.claude/CLAUDE\\.md") > 0, "user CLAUDE.md counted");
  assert.equal(tokensOf(cc, "auto memory \\(MEMORY\\.md\\)"), tok(memLines.slice(0, 200).join("\n")), "memory capped at 200 lines");
  assert.match(cc, /3 skill descriptions/, "userskill + synced docx + plugin alpha; not manual, not disabled beta");
  assert.match(cc, /2 subagent descriptions/, "ops + plugin helper");

  assert.match(cc, /plug-docs .*plugin:good/, "enabled plugin's MCP server is listed");
  assert.ok(!out.includes("off-server"), "disabled plugin's MCP server is ignored");
  assert.match(cc, /on demand/, "MCP schemas are deferred by default (tool search)");
  assert.ok(!out.includes("(est.)"), "no invented catalog estimate");
  assert.match(cc, /github\s+no figure/, "unmeasured server says so");

  // The up-front total is exactly what is always loaded (MCP deferred, unmeasured).
  const always = ["CLAUDE\\.md", "~/\\.claude/CLAUDE\\.md", "auto memory \\(MEMORY\\.md\\)", "3 skill descriptions", "2 subagent descriptions"]
    .map((l) => tokensOf(cc, l))
    .reduce((a, b) => a + b, 0);
  const total = Number(cc.match(/~([\d,]+) of 200,000 tokens up front/)[1].replace(/,/g, ""));
  assert.equal(total, always, "header total = always-loaded items");

  const eager = section(scan({ ENABLE_TOOL_SEARCH: "false" }), "CLAUDE CODE");
  assert.ok(!eager.includes("on demand"), "ENABLE_TOOL_SEARCH=false loads schemas up front");

  // A repo inside the home (the usual case): walking its parents reaches the
  // home, whose .claude/CLAUDE.md IS the user file — it must count once.
  const nested = path.join(home, "work", "proj");
  put(path.join(nested, "CLAUDE.md"), "Project rule.");
  const underHome = execFileSync("node", ["dist/cli.js", "scan", nested], {
    env: { ...process.env, VEXRYN_HOME: home },
    encoding: "utf8",
  });
  assert.equal((underHome.match(/~\/\.claude\/CLAUDE\.md/g) ?? []).length, 1, "user CLAUDE.md counted once");

  const repoOnly = section(scan({}, "--no-global"), "CLAUDE CODE");
  assert.equal(tokensOf(repoOnly, "CLAUDE\\.md"), tok(rootClaude));
  assert.ok(!repoOnly.includes("~/.claude/CLAUDE.md"), "--no-global skips the user CLAUDE.md");
  assert.ok(!repoOnly.includes("MEMORY.md"), "--no-global skips auto memory");
  assert.ok(!repoOnly.includes("skill descriptions"), "--no-global skips user/plugin skills");
  assert.ok(!repoOnly.includes("plug-docs"), "--no-global skips plugin servers");

  console.log(out);
  console.log("context-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
