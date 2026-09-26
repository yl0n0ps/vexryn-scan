#!/usr/bin/env node
// Discovery finds every agent's config, in the repo and user-wide, with the right
// kind/client/scope. Fake home (VEXRYN_HOME) + a temp repo; nothing real is touched.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverConfigs, discoverGlobalConfigs, projectDir } from "../dist/scan/discover.js";

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vexryn-disc-")));
const repo = path.join(tmp, "repo");
const home = path.join(tmp, "home");
const put = (base, rel, text = "{}") => {
  const p = path.join(base, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
};

try {
  // One project config per agent that has a project-scoped MCP file.
  put(repo, ".codex/config.toml", "[mcp_servers.x]\ncommand='node'\n");
  put(repo, ".copilot/mcp-config.json");
  put(repo, ".roo/mcp.json");
  put(repo, ".continue/mcpServers/search.yaml", "mcpServers: []\n");
  put(repo, ".zed/settings.json");
  put(repo, ".kiro/settings/mcp.json");
  put(repo, "opencode.json");
  // and the ones already covered, to be sure order didn't break them
  put(repo, ".mcp.json");
  put(repo, ".vscode/mcp.json");

  const byRel = Object.fromEntries((await discoverConfigs(repo)).map((c) => [c.relPath.split(path.sep).join("/"), c]));
  const expect = {
    ".codex/config.toml": ["codex-toml", "Codex"],
    ".copilot/mcp-config.json": ["copilot-cli", "GitHub Copilot CLI"],
    ".roo/mcp.json": ["roo-mcp", "Roo Code"],
    ".continue/mcpServers/search.yaml": ["continue-yaml", "Continue"],
    ".zed/settings.json": ["zed", "Zed"],
    ".kiro/settings/mcp.json": ["kiro", "Kiro"],
    "opencode.json": ["opencode", "OpenCode"],
    ".mcp.json": ["mcp-json", "Claude Code"],
    ".vscode/mcp.json": ["vscode-mcp", "VS Code"],
  };
  for (const [rel, [kind, client]] of Object.entries(expect)) {
    assert.ok(byRel[rel], `missing ${rel}`);
    assert.equal(byRel[rel].kind, kind, `${rel} kind`);
    assert.equal(byRel[rel].client, client, `${rel} client`);
    assert.equal(byRel[rel].scope, "project", `${rel} scope`);
  }
  assert.equal(byRel[".roo/mcp.json"].kind, "roo-mcp", ".roo/mcp.json is an MCP config, not a rule");

  // projectDir strips the agent dir: repo-root configs belong to the root, a subproject's to it.
  assert.equal(projectDir(".kiro/settings/mcp.json"), ".");
  assert.equal(projectDir(".codex/config.toml"), ".");
  assert.equal(projectDir("opencode.json"), ".");
  assert.equal(projectDir(path.join("packages", "api", ".roo", "mcp.json")), "packages/api");

  // User-wide configs.
  put(home, ".codex/config.toml", "[mcp_servers.x]\ncommand='node'\n");
  put(home, ".copilot/mcp-config.json");
  put(home, ".config/goose/config.yaml", "extensions: {}\n");
  put(home, ".config/zed/settings.json");
  put(home, ".config/opencode/opencode.json");
  put(home, ".continue/config.yaml", "mcpServers: []\n");
  put(home, ".kiro/settings/mcp.json");
  const appSupport = process.platform === "darwin" ? path.join(home, "Library", "Application Support") : path.join(home, ".config");
  put(home, path.relative(home, path.join(appSupport, "Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json")));
  put(home, path.relative(home, path.join(appSupport, "Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json")));

  process.env.VEXRYN_HOME = home;
  const globals = Object.fromEntries((await discoverGlobalConfigs()).map((c) => [c.kind, c]));
  for (const kind of ["codex-toml", "copilot-cli", "goose", "zed", "opencode", "continue-yaml", "kiro", "cline", "roo-mcp"]) {
    assert.ok(globals[kind], `global ${kind} not discovered`);
    assert.equal(globals[kind].scope, "global", `${kind} scope`);
  }
  assert.equal(globals["codex-toml"].client, "Codex");
  assert.equal(globals["goose"].client, "Goose");
  assert.equal(globals["cline"].client, "Cline");

  console.log("discover-agents-check: all assertions passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
