// What Claude Code loads into context at every session start, read from disk
// only — nothing is executed. Source: https://code.claude.com/docs/en/context-window
//  - CLAUDE.md files of the repo root and its parents + ~/.claude/CLAUDE.md,
//    in full. Nested CLAUDE.md files load on demand, so they are not counted.
//  - auto memory MEMORY.md: the first 200 lines or 25KB.
//  - one line per skill (name + description). `disable-model-invocation: true`
//    skills are not listed.
//  - subagent descriptions.
//  - MCP tool NAMES only: full schemas are deferred (tool search) unless
//    ENABLE_TOOL_SEARCH=false or a custom ANTHROPIC_BASE_URL.
// Not readable statically, so not counted: the built-in system prompt, hook output.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ContextItem, McpServer, ToolSearch } from "../types.js";
import { homeDir, tildify } from "./discover.js";
import { extractServers, readJsonLoose } from "./parse.js";
import { countTokens } from "./tokens.js";

export interface ClaudeContext {
  items: ContextItem[];
  pluginServers: McpServer[];
  toolSearch: ToolSearch;
}

const MEMORY_MAX_LINES = 200;
const MEMORY_MAX_BYTES = 25 * 1024;

/**
 * `includesGlobal` = false (e.g. CI) keeps only what lives in the repo: its
 * CLAUDE.md files, .claude/skills and .claude/agents.
 */
export async function claudeCodeContext(root: string, includesGlobal: boolean): Promise<ClaudeContext> {
  const claude = path.join(homeDir(), ".claude");
  const items: ContextItem[] = [];
  const add = (label: string, text: string | null, key = label, names?: string[]) => {
    if (text) items.push({ key, label, tokens: countTokens(text), ...(names && { names }) });
  };
  // A file reached twice (~/.claude/CLAUDE.md is also the home dir's .claude/CLAUDE.md) counts once.
  const seen = new Set<string>();
  const addFile = async (label: string, p: string) => {
    if (!seen.has(p)) add(label, await readText(p));
    seen.add(p);
  };

  // CLAUDE.md: the repo root, then (machine-specific) its parents and the user file.
  const dirs = [root];
  if (includesGlobal) {
    for (let d = path.dirname(root); d !== path.dirname(d); d = path.dirname(d)) dirs.push(d);
  }
  for (const dir of dirs) {
    for (const name of ["CLAUDE.md", path.join(".claude", "CLAUDE.md"), "CLAUDE.local.md"]) {
      const p = path.join(dir, name);
      await addFile(dir === root ? name : tildify(p), p);
    }
  }

  const plugins = includesGlobal ? await enabledPlugins(claude, root) : [];
  const skillDirs = [path.join(root, ".claude", "skills")];
  const agentDirs = [path.join(root, ".claude", "agents")];
  if (includesGlobal) {
    await addFile("~/.claude/CLAUDE.md", path.join(claude, "CLAUDE.md"));
    const memory = await readText(path.join(claude, "projects", root.replace(/[^a-zA-Z0-9]/g, "-"), "memory", "MEMORY.md"));
    add("auto memory (MEMORY.md)", memory && capMemory(memory), "memory");
    skillDirs.push(path.join(claude, "skills"), ...plugins.map((p) => path.join(p.dir, "skills")));
    agentDirs.push(path.join(claude, "agents"), ...plugins.map((p) => path.join(p.dir, "agents")));
  }

  // ponytail: plugin/user `commands/*.md` not counted — add once their startup loading is documented.
  const skills: string[] = [];
  const skillNames: string[] = [];
  for (const dir of skillDirs) {
    for (const file of await findFiles(dir, "SKILL.md", 3)) {
      const fm = frontmatter((await readText(file)) ?? "");
      if (fm["disable-model-invocation"] === "true") continue;
      const name = fm.name ?? path.basename(path.dirname(file));
      skillNames.push(name);
      skills.push(`${name}: ${fm.description ?? ""}`);
    }
  }
  if (skills.length) add(`${skills.length} skill description${plural(skills.length)}`, skills.join("\n"), "skills", skillNames);

  const agents: string[] = [];
  const agentNames: string[] = [];
  for (const dir of agentDirs) {
    for (const file of await findFiles(dir, ".md", 0)) {
      const fm = frontmatter((await readText(file)) ?? "");
      if (!fm.name) continue; // a subagent file declares its name; README.md etc. are not agents
      agentNames.push(fm.name);
      agents.push(`${fm.name}: ${fm.description ?? ""}`);
    }
  }
  if (agents.length) add(`${agents.length} subagent description${plural(agents.length)}`, agents.join("\n"), "agents", agentNames);

  const pluginServers: McpServer[] = [];
  for (const p of plugins) {
    const manifest = (await readJsonLoose(path.join(p.dir, ".claude-plugin", "plugin.json"))) as Record<string, unknown> | null;
    const dotMcp = (await readJsonLoose(path.join(p.dir, ".mcp.json"))) as Record<string, unknown> | null;
    // ponytail: a string `mcpServers` (path to another file) is skipped — rare; read it if plugins adopt it.
    for (const map of [dotMcp?.mcpServers, manifest?.mcpServers]) {
      for (const s of extractServers(map)) {
        pluginServers.push({ ...s, client: "Claude Code", scope: "global", fromRelPath: `plugin:${p.name}`, estimate: null });
      }
    }
  }

  return { items, pluginServers, toolSearch: await toolSearchMode(claude, root, includesGlobal) };
}

/** Enabled plugins (user settings + this repo's settings) → their install dirs. */
async function enabledPlugins(claude: string, root: string): Promise<Array<{ name: string; dir: string }>> {
  const enabled: Record<string, unknown> = {};
  for (const f of [path.join(claude, "settings.json"), path.join(root, ".claude", "settings.json"), path.join(root, ".claude", "settings.local.json")]) {
    Object.assign(enabled, (await readSettings(f)).enabledPlugins);
  }
  const installed = (await readJsonLoose(path.join(claude, "plugins", "installed_plugins.json"))) as {
    plugins?: Record<string, Array<{ installPath?: string }>>;
  } | null;
  const out: Array<{ name: string; dir: string }> = [];
  for (const [id, on] of Object.entries(enabled)) {
    // ponytail: first install entry wins; per-project installs of the same plugin aren't distinguished.
    const dir = installed?.plugins?.[id]?.[0]?.installPath;
    if (on === true && dir) out.push({ name: id.split("@")[0], dir });
  }
  return out;
}

/** Tool search is on by default; settings env (narrowest first) or the shell can turn it off. */
async function toolSearchMode(claude: string, root: string, includesGlobal: boolean): Promise<ToolSearch> {
  const files = [path.join(root, ".claude", "settings.local.json"), path.join(root, ".claude", "settings.json")];
  if (includesGlobal) files.push(path.join(claude, "settings.json"));
  const envs = [...(await Promise.all(files.map(readSettings))).map((s) => s.env ?? {}), process.env];
  const pick = (k: string) => envs.map((e) => e[k]).find((v): v is string => typeof v === "string" && v !== "");

  const flag = pick("ENABLE_TOOL_SEARCH");
  const baseUrl = pick("ANTHROPIC_BASE_URL");
  if (flag === "false" || (baseUrl && !baseUrl.startsWith("https://api.anthropic.com"))) return "upfront";
  return flag === "auto" ? "auto" : "deferred";
}

async function readSettings(p: string): Promise<{ env?: Record<string, unknown>; enabledPlugins?: Record<string, unknown> }> {
  const raw = await readJsonLoose(p);
  return typeof raw === "object" && raw !== null ? (raw as { env?: Record<string, unknown>; enabledPlugins?: Record<string, unknown> }) : {};
}

function capMemory(text: string): string {
  const lines = text.split("\n").slice(0, MEMORY_MAX_LINES).join("\n");
  const bytes = Buffer.from(lines, "utf8");
  return bytes.length <= MEMORY_MAX_BYTES ? lines : bytes.subarray(0, MEMORY_MAX_BYTES).toString("utf8");
}

/**
 * Top-level `key: value` pairs of a markdown file's YAML frontmatter.
 * Handles plain, quoted and block-scalar (`>`, `|-`) values — enough for
 * skill/agent names and descriptions, without a YAML dependency.
 */
export function frontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return out;
  let key = "";
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      out[key] = /^[>|][-+]?$/.test(kv[2]) ? "" : kv[2].replace(/^(["'])(.*)\1$/, "$2");
    } else if (key && /^\s/.test(line)) {
      out[key] = `${out[key]} ${line.trim()}`.trim();
    }
  }
  return out;
}

/**
 * Files named `name` (or ending with it, e.g. ".md") under `dir`, up to `depth`
 * levels deep. A directory holding a match is a leaf (a skill's subfolders are
 * its resources, not more skills). Follows symlinks.
 */
async function findFiles(dir: string, name: string, depth: number): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  const subdirs: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    const st = e.isSymbolicLink() ? await fs.stat(p).catch(() => null) : e;
    if (st?.isFile() && e.name.endsWith(name)) files.push(p);
    else if (st?.isDirectory()) subdirs.push(p);
  }
  if (files.length > 0 || depth === 0) return files;
  for (const d of subdirs) files.push(...(await findFiles(d, name, depth - 1)));
  return files;
}

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}
