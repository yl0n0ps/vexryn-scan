// Parse MCP server entries out of discovered config files.
// Static and defensive: configs are untrusted input, so we never execute
// anything we read and we tolerate malformed files.

import { promises as fs } from "node:fs";
import type { DiscoveredConfig, McpServer, Scope } from "../types.js";
import { secretLiteral } from "../diff/rules.js";
import { readToml, readYaml } from "./formats.js";

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
  "codex-toml",
  "copilot-cli",
  "cline",
  "roo-mcp",
  "continue-yaml",
  "zed",
  "kiro",
  "opencode",
  "goose",
]);

/** File extensions that are TOML / YAML rather than JSON, by kind. */
const TOML_KINDS = new Set(["codex-toml"]);
const YAML_KINDS = new Set(["continue-yaml", "goose"]);

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
    const raw = await readConfig(cfg.kind, cfg.path);
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
      sections.push({ map: normalizeServers(cfg.kind, obj), scope: cfg.scope });
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

/** Read a config by its format: TOML and YAML for the newer agents, JSONC otherwise. */
async function readConfig(kind: string, p: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
  if (TOML_KINDS.has(kind)) return readToml(text);
  if (YAML_KINDS.has(kind)) return readYaml(text);
  return readJsonLoose(p);
}

/**
 * Every agent's server shape → the standard `{ name: { command, args, env, url, headers } }`
 * map that `extractServers` understands. Name-only credential channels (Codex
 * `bearer_token_env_var`, Goose `env_keys`) become env entries with an empty value, so
 * their NAME is surfaced under `receives` and never mistaken for a literal secret.
 */
export function normalizeServers(kind: string, obj: Record<string, unknown>): Record<string, unknown> {
  const asObj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const named = (v: unknown): Record<string, unknown> => asObj(v);
  const namesOnly = (v: unknown): Record<string, string> => {
    const names = Array.isArray(v) ? v : [];
    return Object.fromEntries(names.filter((n): n is string => typeof n === "string").map((n) => [n, ""]));
  };
  const out: Record<string, unknown> = {};

  if (kind === "codex-toml") {
    for (const [name, def] of Object.entries(named(obj.mcp_servers))) {
      const d = asObj(def);
      const headers = { ...asObj(d.http_headers), ...namesOnly(d.env_http_headers), ...(typeof d.bearer_token_env_var === "string" ? { [d.bearer_token_env_var]: "" } : {}) };
      out[name] = { command: d.command, args: d.args, env: d.env, url: d.url, headers };
    }
    return out;
  }
  if (kind === "opencode") {
    for (const [name, def] of Object.entries(named(obj.mcp))) {
      const d = asObj(def);
      const cmd = Array.isArray(d.command) ? d.command.filter((x): x is string => typeof x === "string") : [];
      out[name] = { command: cmd[0], args: cmd.slice(1), env: d.environment, url: d.url, headers: d.headers };
    }
    return out;
  }
  if (kind === "zed") return named(obj.context_servers);
  if (kind === "goose") {
    for (const [name, def] of Object.entries(named(obj.extensions))) {
      const d = asObj(def);
      if (d.type === "builtin") continue; // a builtin extension has no launch command to name
      out[name] = { command: d.cmd, args: d.args, env: { ...asObj(d.envs), ...namesOnly(d.env_keys) }, url: d.uri ?? d.url, headers: d.headers };
    }
    return out;
  }
  if (kind === "continue-yaml") {
    const list = Array.isArray(obj.mcpServers) ? obj.mcpServers : [];
    for (const item of list) {
      const d = asObj(item);
      if (typeof d.name === "string") out[d.name] = d;
    }
    return out;
  }
  // The VS Code family (Copilot CLI, Cline, Roo, Kiro) uses a plain `mcpServers` (or `servers`) object.
  return { ...named(obj.mcpServers ?? obj.servers) } as Record<string, unknown>;
}

/** Normalize + extract in one call, for a single already-parsed config object (tests, reuse). */
export function serversFromConfig(kind: string, obj: Record<string, unknown>): BareServer[] {
  return extractServers(normalizeServers(kind, obj));
}

type BareServer = Pick<McpServer, "name" | "transport" | "target" | "command" | "args" | "url" | "receives" | "literalSecrets">;

/** A `{ name: definition }` map → servers. Remote URL keys differ per app. */
export function extractServers(map: unknown): BareServer[] {
  if (typeof map !== "object" || map === null) return [];
  const out: BareServer[] = [];
  for (const [name, def] of Object.entries(map as Record<string, unknown>)) {
    if (typeof def !== "object" || def === null) continue;
    const d = def as Record<string, unknown>;
    // Names only: env/header values are often secrets and are never kept —
    // we only remember WHICH names hold a literal credential.
    const entries = [d.env, d.headers].flatMap((m) => (typeof m === "object" && m !== null ? Object.entries(m) : []));
    const receives = entries.map(([k]) => k);
    const literalSecrets = entries.filter(([k, v]) => typeof v === "string" && secretLiteral(k, v)).map(([k]) => k);
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
        receives,
        literalSecrets,
      });
    } else if (url) {
      out.push({ name, transport: "http", target: url, url, receives, literalSecrets });
    } else {
      out.push({ name, transport: "unknown", target: "", receives, literalSecrets });
    }
  }
  return out;
}
