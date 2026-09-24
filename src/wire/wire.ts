// Auto-wiring: rewrite JSON agent configs so each stdio MCP server is routed
// through `vexryn wrap`, which makes usage collection automatic. Reversible
// (`unwire`) and non-destructive (writes a <file>.vexryn-bak backup once).
//
// A wired entry looks like:
//   "github": { "command": "vexryn",
//               "args": ["wrap","--name","github","--","npx","-y","@mcp/..."] }

import { promises as fs } from "node:fs";
import type { DiscoveredConfig } from "../types.js";

export interface WireChange {
  file: string;
  wired: string[]; // server names newly wired
  already: string[]; // server names already wired
  skipped: string[]; // non-stdio servers we cannot wrap this way
}

const WRAP_CMD = "vexryn";

export async function wireConfigs(configs: DiscoveredConfig[]): Promise<WireChange[]> {
  return transformConfigs(configs, "wire");
}

export async function unwireConfigs(configs: DiscoveredConfig[]): Promise<WireChange[]> {
  return transformConfigs(configs, "unwire");
}

async function transformConfigs(
  configs: DiscoveredConfig[],
  mode: "wire" | "unwire",
): Promise<WireChange[]> {
  const changes: WireChange[] = [];
  for (const cfg of configs) {
    if (!isJsonServerConfig(cfg.kind)) continue;
    const change = await transformOne(cfg, mode);
    if (change) changes.push(change);
  }
  return changes;
}

function isJsonServerConfig(kind: string): boolean {
  return (
    kind === "mcp-json" ||
    kind === "cursor-mcp" ||
    kind === "vscode-mcp" ||
    kind === "claude-settings" ||
    kind === "gemini"
  );
}

async function transformOne(
  cfg: DiscoveredConfig,
  mode: "wire" | "unwire",
): Promise<WireChange | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(cfg.path, "utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const map = (obj.mcpServers ?? obj.servers) as Record<string, unknown> | undefined;
  if (typeof map !== "object" || map === null) return null;

  const change: WireChange = { file: cfg.relPath, wired: [], already: [], skipped: [] };

  for (const [name, def] of Object.entries(map)) {
    if (typeof def !== "object" || def === null) continue;
    const entry = def as Record<string, unknown>;
    const wired = isWired(entry);

    if (mode === "wire") {
      if (wired) {
        change.already.push(name);
      } else if (typeof entry.command === "string") {
        const args = asStringArray(entry.args);
        entry.args = ["wrap", "--name", name, "--", entry.command, ...args];
        entry.command = WRAP_CMD;
        change.wired.push(name);
      } else {
        change.skipped.push(name); // http/unknown — cannot stdio-wrap
      }
    } else {
      if (wired) {
        const args = asStringArray(entry.args);
        const sep = args.indexOf("--");
        const rest = sep === -1 ? [] : args.slice(sep + 1);
        if (rest.length > 0) {
          entry.command = rest[0];
          entry.args = rest.slice(1);
          change.wired.push(name); // "unwired" in unwire mode
        }
      }
    }
  }

  const touched = change.wired.length > 0;
  if (touched) {
    if (mode === "wire") await backupOnce(cfg.path);
    await fs.writeFile(cfg.path, JSON.stringify(raw, null, 2) + "\n", "utf8");
  }
  return change;
}

function isWired(entry: Record<string, unknown>): boolean {
  return (
    entry.command === WRAP_CMD &&
    Array.isArray(entry.args) &&
    entry.args[0] === "wrap"
  );
}

function asStringArray(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string");
}

async function backupOnce(file: string): Promise<void> {
  const bak = `${file}.vexryn-bak`;
  try {
    await fs.access(bak);
  } catch {
    try {
      await fs.copyFile(file, bak);
    } catch {
      // best-effort
    }
  }
}
