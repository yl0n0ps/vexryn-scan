// Parse MCP server entries out of discovered config files.
// Static and defensive: configs are untrusted input, so we never execute
// anything we read and we tolerate malformed files.

import { promises as fs } from "node:fs";
import type { DiscoveredConfig, McpServer } from "../types.js";
import { estimateServer } from "./catalog.js";

/** Extract MCP servers from every config that can declare them. */
export async function parseServers(configs: DiscoveredConfig[]): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  for (const cfg of configs) {
    if (!isJsonServerConfig(cfg)) continue; // rules/markdown files carry no servers
    const raw = await readJson(cfg.path);
    if (!raw) continue;
    for (const s of extractServers(raw)) {
      servers.push({
        ...s,
        fromRelPath: cfg.relPath,
        estimate: estimateServer(s.name, s.target),
      });
    }
  }
  return servers;
}

function isJsonServerConfig(cfg: DiscoveredConfig): boolean {
  return (
    cfg.kind === "mcp-json" ||
    cfg.kind === "vscode-mcp" ||
    cfg.kind === "claude-settings" ||
    cfg.kind === "gemini"
  );
}

async function readJson(p: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(p, "utf8");
    return JSON.parse(text);
  } catch {
    return null; // missing or malformed — skip quietly
  }
}

type BareServer = Pick<McpServer, "name" | "transport" | "target">;

/** Both `{ mcpServers: {...} }` and `{ servers: {...} }` shapes are used in the wild. */
function extractServers(raw: unknown): BareServer[] {
  if (typeof raw !== "object" || raw === null) return [];
  const obj = raw as Record<string, unknown>;
  const map =
    (obj.mcpServers as Record<string, unknown> | undefined) ??
    (obj.servers as Record<string, unknown> | undefined);
  if (typeof map !== "object" || map === null) return [];

  const out: BareServer[] = [];
  for (const [name, def] of Object.entries(map)) {
    if (typeof def !== "object" || def === null) continue;
    const d = def as Record<string, unknown>;
    if (typeof d.url === "string") {
      out.push({ name, transport: "http", target: d.url });
    } else if (typeof d.command === "string") {
      const args = Array.isArray(d.args) ? d.args.filter((a) => typeof a === "string") : [];
      out.push({ name, transport: "stdio", target: [d.command, ...args].join(" ") });
    } else {
      out.push({ name, transport: "unknown", target: "" });
    }
  }
  return out;
}
