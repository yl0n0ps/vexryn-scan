// Parse MCP server entries out of discovered config files.
// Static and defensive: configs are untrusted input, so we never execute
// anything we read and we tolerate malformed files.

import { promises as fs } from "node:fs";
import type { DiscoveredConfig, McpServer, Scope } from "../types.js";

/** Config kinds that can declare MCP servers (rules/markdown files cannot). */
const SERVER_KINDS = new Set([
  "mcp-json",
  "cursor-mcp",
  "vscode-mcp",
  "claude-settings",
  "claude-user",
  "claude-desktop",
  "windsurf-mcp",
  "gemini",
]);

/**
 * Extract MCP servers from every config that can declare them.
 * `root` is the scanned repo: it selects the per-project ("local") section
 * of Claude Code's ~/.claude.json.
 */
export async function parseServers(configs: DiscoveredConfig[], root: string): Promise<McpServer[]> {
  const rootKeys = await projectKeys(root);
  const servers: McpServer[] = [];

  for (const cfg of configs) {
    if (!SERVER_KINDS.has(cfg.kind)) continue;
    const raw = await readJsonLoose(cfg.path);
    if (typeof raw !== "object" || raw === null) continue;
    const obj = raw as Record<string, unknown>;

    const sections: Array<{ map: unknown; scope: Scope }> = [];
    if (cfg.kind === "claude-user") {
      // Claude Code user scope, plus the local scope of THIS repo only.
      sections.push({ map: obj.mcpServers, scope: "global" });
      const projects = obj.projects;
      if (typeof projects === "object" && projects !== null) {
        for (const [key, proj] of Object.entries(projects as Record<string, unknown>)) {
          if (!rootKeys.has(key.normalize("NFC"))) continue;
          if (typeof proj === "object" && proj !== null) {
            sections.push({ map: (proj as Record<string, unknown>).mcpServers, scope: "local" });
          }
        }
      }
    } else {
      sections.push({ map: obj.mcpServers ?? obj.servers, scope: cfg.scope });
    }

    for (const section of sections) {
      for (const s of extractServers(section.map)) {
        servers.push({
          ...s,
          client: cfg.client,
          scope: section.scope,
          fromRelPath: cfg.relPath,
          estimate: null,
        });
      }
    }
  }
  return servers;
}

/** Keys under which ~/.claude.json may record this repo (as-given + real path, NFC). */
async function projectKeys(root: string): Promise<Set<string>> {
  const keys = new Set<string>([root.normalize("NFC")]);
  try {
    keys.add((await fs.realpath(root)).normalize("NFC"));
  } catch {
    // root may not exist — as-given key is enough
  }
  return keys;
}

/** Read JSON, tolerating comments and trailing commas (VS Code files are JSONC). */
export async function readJsonLoose(p: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(stripJsonc(text));
    } catch {
      return null; // malformed — skip quietly
    }
  }
}

/** Remove // and /* *\/ comments outside strings, then trailing commas. */
function stripJsonc(text: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++; // skip the closing '/'
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

type BareServer = Pick<McpServer, "name" | "transport" | "target" | "command" | "args" | "url">;

/** A `{ name: definition }` map → servers. Remote URL keys differ per app. */
export function extractServers(map: unknown): BareServer[] {
  if (typeof map !== "object" || map === null) return [];
  const out: BareServer[] = [];
  for (const [name, def] of Object.entries(map as Record<string, unknown>)) {
    if (typeof def !== "object" || def === null) continue;
    const d = def as Record<string, unknown>;
    // url (most apps), serverUrl (Windsurf), httpUrl (Gemini streamable HTTP)
    const url = [d.url, d.serverUrl, d.httpUrl].find((v): v is string => typeof v === "string");
    if (typeof d.command === "string") {
      const args = (Array.isArray(d.args) ? d.args : []).filter(
        (a): a is string => typeof a === "string",
      );
      out.push({
        name,
        transport: "stdio",
        target: [d.command, ...args].join(" "),
        command: d.command,
        args,
      });
    } else if (url) {
      out.push({ name, transport: "http", target: url, url });
    } else {
      out.push({ name, transport: "unknown", target: "" });
    }
  }
  return out;
}
