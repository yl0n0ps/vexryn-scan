#!/usr/bin/env node
// Global-config discovery check, against a FAKE home (VEXRYN_HOME) so the real
// user configs are never read or touched. Asserts:
//  - each agent app gets its own section (never summed across apps)
//  - Claude Code merges user + project + local scopes, local scope of THIS
//    repo only, and dedupes a name declared twice (narrowest scope wins)
//  - Windsurf `serverUrl` and VS Code JSONC (comments, trailing commas) parse
//  - --no-global restricts to the repo

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = realpathSync("fixtures/sample-repo");
const home = mkdtempSync(path.join(os.tmpdir(), "vexryn-home-"));

const appSupport =
  process.platform === "darwin"
    ? path.join(home, "Library", "Application Support")
    : process.platform === "win32"
      ? path.join(home, "AppData", "Roaming")
      : path.join(home, ".config");

function put(p, content) {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

// Claude Code: user scope + per-project local scopes (+ unrelated noise).
put(path.join(home, ".claude.json"), {
  numStartups: 42,
  mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] } },
  projects: {
    [repo]: {
      mcpServers: {
        "local-only": { command: "node", args: ["local.js"] },
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      },
    },
    "/some/other/project": { mcpServers: { "other-project-server": { command: "node", args: ["o.js"] } } },
  },
});
put(path.join(appSupport, "Claude", "claude_desktop_config.json"), {
  mcpServers: {
    filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
    risky: { command: "bash", args: ["-c", "echo setup"], env: { API_KEY: "sk-abcdefghijklmnop1234567890" } },
    rootfs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/"] },
  },
});
put(path.join(home, ".codeium", "windsurf", "mcp_config.json"), {
  mcpServers: { "remote-docs": { serverUrl: "https://mcp.example.com/docs" } },
});
put(
  path.join(appSupport, "Code", "User", "mcp.json"),
  `{
  // VS Code allows comments here
  "servers": {
    "notion": { "type": "stdio", "command": "npx", "args": ["-y", "@notionhq/notion-mcp-server"], },
  },
}`,
);

function scan(...extra) {
  const out = execFileSync("node", ["dist/cli.js", "scan", repo, ...extra], {
    env: { ...process.env, VEXRYN_HOME: home },
    encoding: "utf8",
  });
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

try {
  const out = scan();

  const cc = section(out, "CLAUDE CODE");
  assert.match(cc, /local-only .*local/, "local scope of this repo is read");
  assert.equal((cc.match(/^\s+github\s/gm) ?? []).length, 1, "github declared 3x is counted once");
  assert.match(cc, /github .*~\/\.claude\.json · local/, "narrowest scope (local) wins");
  assert.match(cc, /sentry .*\.mcp\.json · project/, "project .mcp.json still included");
  assert.ok(!out.includes("other-project-server"), "another project's local scope is ignored");

  const desktop = section(out, "CLAUDE DESKTOP");
  assert.match(desktop, /filesystem/);
  // Exact config facts shown under the server; values never printed.
  assert.match(desktop, /risky[\s\S]*⚠ runs a shell with inline code or a pipe/);
  assert.match(desktop, /⚠ API_KEY is a literal secret written in the file \(not shown\)/);
  assert.match(desktop, /rootfs[\s\S]*⚠ is given \/ — a whole filesystem\/home or a credential path/);
  assert.ok(!out.includes("sk-abcdefghijklmnop"), "a secret value is never printed");
  assert.ok(!/filesystem[^\n]*\n\s+⚠/.test(desktop), "a server rooted at /tmp has no fact line");
  assert.match(section(out, "WINDSURF"), /remote-docs/, "Windsurf serverUrl parsed");
  assert.match(section(out, "WINDSURF"), /not measured/, "an unmeasured agent says so");
  assert.ok(!/~0%/.test(section(out, "WINDSURF")), "an unmeasured agent never shows a fake 0%");
  assert.match(section(out, "VS CODE"), /notion/, "VS Code JSONC parsed");
  assert.match(out, /\(4 user-wide\)/);

  const repoOnly = scan("--no-global");
  assert.ok(!repoOnly.includes("CLAUDE DESKTOP"), "--no-global skips user-wide configs");
  assert.ok(!repoOnly.includes("local-only"), "--no-global skips ~/.claude.json");
  assert.match(repoOnly, /CLAUDE CODE/);

  // A subproject's .mcp.json is loaded only when the agent is opened there: listed, never counted at the root.
  const mono = mkdtempSync(path.join(os.tmpdir(), "vexryn-mono-"));
  put(path.join(mono, ".mcp.json"), { mcpServers: { "root-srv": { command: "node", args: ["r.js"] } } });
  put(path.join(mono, "packages", "api", ".mcp.json"), { mcpServers: { "api-a": { command: "node", args: ["a.js"] }, "api-b": { command: "node", args: ["b.js"] } } });
  try {
    const m = execFileSync("node", ["dist/cli.js", "scan", mono, "--no-global"], { env: { ...process.env, VEXRYN_HOME: home }, encoding: "utf8" }).replace(/\u001b\[[0-9;]*m/g, "");
    assert.match(m, /1 MCP server across 1 agent/, "only the root's server counts");
    const monoCc = section(m, "CLAUDE CODE");
    assert.match(monoCc, /root-srv/);
    assert.ok(!/api-a|api-b/.test(monoCc), "subproject servers are not in the root agent's load");
    assert.match(m, /Not counted — subprojects \(an agent loads them only when opened there\):\n\s+packages\/api\/\.mcp\.json\s+2 servers/);
  } finally {
    rmSync(mono, { recursive: true, force: true });
  }

  console.log(out);
  console.log("global-check: all assertions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
