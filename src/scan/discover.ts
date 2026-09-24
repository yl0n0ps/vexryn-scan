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
];

const MAX_DEPTH = 8;

/** Recursively find agent-config files under `root`. */
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
