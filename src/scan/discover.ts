// Agnostic discovery: find every agent-config file, whatever the stack.
//  - discoverConfigs(root): files inside the scanned repo (project scope).
//  - discoverGlobalConfigs(): the user-wide configs of each agent app.
// No config, no network, read-only.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentClient, ConfigKind, DiscoveredConfig } from "../types.js";

/** Directories we never descend into. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  "vendor",
  ".venv",
  "__pycache__",
  ".vexryn",
]);

type Rule = {
  match: (rel: string, base: string) => boolean;
  kind: ConfigKind;
  client: AgentClient;
};

/** Repo files (matched anywhere in the tree) → kind + the agent that loads them. */
const PROJECT_RULES: Rule[] = [
  { match: (_r, b) => b === ".mcp.json", kind: "mcp-json", client: "Claude Code" },
  { match: (r) => r.endsWith(".cursor/mcp.json"), kind: "cursor-mcp", client: "Cursor" },
  { match: (r) => r.endsWith(".vscode/mcp.json"), kind: "vscode-mcp", client: "VS Code" },
  { match: (_r, b) => b === ".cursorrules", kind: "cursor-rules", client: "Cursor" },
  { match: (r) => r.includes(".cursor/rules"), kind: "cursor-rules", client: "Cursor" },
  { match: (_r, b) => b === "CLAUDE.md", kind: "claude-md", client: "Claude Code" },
  {
    match: (r) => r.includes(".claude/") && r.endsWith(".json"),
    kind: "claude-settings",
    client: "Claude Code",
  },
  { match: (r) => r.includes(".gemini/") && r.endsWith(".json"), kind: "gemini", client: "Gemini CLI" },
  { match: (r) => r.includes(".windsurf"), kind: "windsurf", client: "Windsurf" },
  // The newer agents (matched anywhere in the tree, like the others).
  { match: (r) => r.endsWith(".codex/config.toml"), kind: "codex-toml", client: "Codex" },
  { match: (r) => r.endsWith(".copilot/mcp-config.json"), kind: "copilot-cli", client: "GitHub Copilot CLI" },
  { match: (r) => r.endsWith(".roo/mcp.json"), kind: "roo-mcp", client: "Roo Code" },
  { match: (r) => /(^|\/)\.continue\/mcpServers\/[^/]+\.(ya?ml|json)$/.test(r), kind: "continue-yaml", client: "Continue" },
  { match: (r) => r.endsWith(".zed/settings.json"), kind: "zed", client: "Zed" },
  { match: (r) => r.endsWith(".kiro/settings/mcp.json"), kind: "kiro", client: "Kiro" },
  { match: (_r, b) => b === "opencode.json" || b === "opencode.jsonc", kind: "opencode", client: "OpenCode" },
];

const MAX_DEPTH = 8;

/** Recursively find agent-config files under `root`. */
/**
 * The project directory a repo config file belongs to, "/"-separated and relative to the scan root:
 * `.mcp.json` → its folder, `.claude/settings.json` → the folder above. An agent loads the config
 * at its project root only, never a subproject's (Claude Code docs: ".mcp.json at your project's root").
 */
export function projectDir(relPath: string): string {
  const parts = path.posix.dirname(relPath.split(path.sep).join("/")).split("/");
  // A file lives inside an agent-config directory (.claude, .roo, .kiro/settings…):
  // its project is whatever contains that directory, never the agent dir itself.
  const i = parts.findIndex((p) => /^\.(claude|cursor|vscode|gemini|codex|roo|zed|kiro|continue|copilot|windsurf|devin)$/.test(p));
  return (i === -1 ? parts.join("/") : parts.slice(0, i).join("/")) || ".";
}

export async function discoverConfigs(root: string): Promise<DiscoveredConfig[]> {
  const found: DiscoveredConfig[] = [];
  await walk(root, root, 0, found);
  found.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return found;
}

async function walk(
  root: string,
  dir: string,
  depth: number,
  out: DiscoveredConfig[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip quietly
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(root, abs, depth + 1, out);
    } else if (entry.isFile()) {
      const rule = classify(rel, entry.name);
      if (rule) out.push({ path: abs, relPath: rel, kind: rule.kind, client: rule.client, scope: "project" });
    }
  }
}

function classify(rel: string, base: string): Rule | null {
  const norm = rel.split(path.sep).join("/");
  for (const rule of PROJECT_RULES) {
    if (rule.match(norm, base)) return rule;
  }
  return null;
}

// --- Global (user-wide) configs ------------------------------------------

/**
 * The user's home. `VEXRYN_HOME` overrides it (tests, or scanning another
 * user's setup) so a scan never has to touch the real home to be verified.
 */
export function homeDir(): string {
  return process.env.VEXRYN_HOME || os.homedir();
}

/** Where each agent app keeps its user-wide MCP config, per platform. */
function globalCandidates(home: string): Array<{ path: string; kind: ConfigKind; client: AgentClient }> {
  const appSupport =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? process.env.VEXRYN_HOME
          ? path.join(home, "AppData", "Roaming")
          : process.env.APPDATA || path.join(home, "AppData", "Roaming")
        : path.join(home, ".config");
  const xdg = process.env.XDG_CONFIG_HOME && !process.env.VEXRYN_HOME ? process.env.XDG_CONFIG_HOME : path.join(home, ".config");

  return [
    { path: path.join(home, ".claude.json"), kind: "claude-user", client: "Claude Code" },
    {
      path: path.join(appSupport, "Claude", "claude_desktop_config.json"),
      kind: "claude-desktop",
      client: "Claude Desktop",
    },
    { path: path.join(home, ".cursor", "mcp.json"), kind: "cursor-mcp", client: "Cursor" },
    {
      path: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
      kind: "windsurf-mcp",
      client: "Windsurf",
    },
    { path: path.join(home, ".gemini", "settings.json"), kind: "gemini", client: "Gemini CLI" },
    { path: path.join(appSupport, "Code", "User", "mcp.json"), kind: "vscode-mcp", client: "VS Code" },
    { path: path.join(home, ".codex", "config.toml"), kind: "codex-toml", client: "Codex" },
    { path: path.join(home, ".copilot", "mcp-config.json"), kind: "copilot-cli", client: "GitHub Copilot CLI" },
    { path: path.join(home, ".kiro", "settings", "mcp.json"), kind: "kiro", client: "Kiro" },
    { path: path.join(home, ".continue", "config.yaml"), kind: "continue-yaml", client: "Continue" },
    // Zed, OpenCode and Goose use ~/.config on every platform, not the OS app-data dir.
    { path: path.join(xdg, "goose", "config.yaml"), kind: "goose", client: "Goose" },
    // Goose on Windows keeps its config under %APPDATA%\\Block\\goose\\config.
    ...(process.platform === "win32" ? [{ path: path.join(appSupport, "Block", "goose", "config", "config.yaml"), kind: "goose" as ConfigKind, client: "Goose" as AgentClient }] : []),
    { path: path.join(xdg, "zed", "settings.json"), kind: "zed", client: "Zed" },
    { path: path.join(xdg, "opencode", "opencode.json"), kind: "opencode", client: "OpenCode" },
    // Cline and Roo Code (VS Code extensions) keep their MCP settings in the editor's globalStorage.
    { path: path.join(appSupport, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"), kind: "cline", client: "Cline" },
    { path: path.join(appSupport, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"), kind: "roo-mcp", client: "Roo Code" },
  ];
}

/** Find the user-wide agent configs that exist on this machine. */
export async function discoverGlobalConfigs(): Promise<DiscoveredConfig[]> {
  const home = homeDir();
  const found: DiscoveredConfig[] = [];
  for (const c of globalCandidates(home)) {
    try {
      const st = await fs.stat(c.path);
      if (!st.isFile()) continue;
    } catch {
      continue; // not installed / not configured
    }
    found.push({ path: c.path, relPath: tildify(c.path, home), kind: c.kind, client: c.client, scope: "global" });
  }
  return found;
}

/** Display a path under the home as ~/… */
export function tildify(p: string, home: string = homeDir()): string {
  return p === home || p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}
