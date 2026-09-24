// Agnostic discovery: walk a repo and find every agent-config file,
// whatever the stack. No config, no network, read-only.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { DiscoveredConfig, ConfigKind } from "../types.js";

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

/** Exact filenames (matched anywhere) → the surface they belong to. */
const FILE_MAP: Array<{ match: (rel: string, base: string) => boolean; kind: ConfigKind }> = [
  { match: (_r, b) => b === ".mcp.json", kind: "mcp-json" },
  { match: (r) => r.endsWith(".vscode/mcp.json"), kind: "vscode-mcp" },
  { match: (_r, b) => b === ".cursorrules", kind: "cursor-rules" },
  { match: (r) => r.includes(".cursor/rules"), kind: "cursor-rules" },
  { match: (_r, b) => b === "CLAUDE.md", kind: "claude-md" },
  { match: (r) => r.includes(".claude/") && r.endsWith(".json"), kind: "claude-settings" },
  { match: (r) => r.includes(".gemini/") && r.endsWith(".json"), kind: "gemini" },
  { match: (r) => r.includes(".windsurf"), kind: "windsurf" },
];

const MAX_DEPTH = 8;

/** Recursively find agent-config files under `root`. */
export async function discoverConfigs(root: string): Promise<DiscoveredConfig[]> {
  const found: DiscoveredConfig[] = [];
  await walk(root, root, 0, found);
  // Stable, readable order.
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
      const kind = classify(rel, entry.name);
      if (kind) out.push({ path: abs, relPath: rel, kind });
    }
  }
}

function classify(rel: string, base: string): ConfigKind | null {
  const norm = rel.split(path.sep).join("/");
  for (const rule of FILE_MAP) {
    if (rule.match(norm, base)) return rule.kind;
  }
  return null;
}
