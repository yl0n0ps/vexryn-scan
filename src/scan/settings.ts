// Claude Code project settings that change what the agent may do: permission
// rules, the default permission mode, extra directories, hooks and enabled
// plugins. Read from the repo's .claude/settings.json and
// .claude/settings.local.json as data — a hook is listed, never run.
// Reference: https://code.claude.com/docs/en/settings, /en/hooks

import path from "node:path";
import { readJsonLoose } from "./parse.js";

export interface Hook {
  /** Event, plus the matcher when there is one: "PreToolUse Bash". */
  on: string;
  action: "runs" | "calls" | "calls MCP tool" | "asks the model" | "runs a subagent with" | "has unknown type";
  /** What it runs/calls — untrusted text from the repo. */
  what: string;
}

export interface ClaudeSettings {
  allow: string[];
  ask: string[];
  deny: string[];
  additionalDirectories: string[];
  defaultMode: string | null;
  hooks: Hook[];
  /** Plugin ids switched on (true) or off (false). */
  plugins: Record<string, boolean>;
}

type Obj = Record<string, unknown>;

export async function readClaudeSettings(root: string): Promise<ClaudeSettings> {
  const out: ClaudeSettings = { allow: [], ask: [], deny: [], additionalDirectories: [], defaultMode: null, hooks: [], plugins: {} };
  // Shared file first, local second: the local one wins for single values.
  for (const name of ["settings.json", "settings.local.json"]) {
    const raw = await readJsonLoose(path.join(root, ".claude", name));
    if (!isObj(raw)) continue;
    const perms = isObj(raw.permissions) ? raw.permissions : {};
    out.allow.push(...strings(perms.allow));
    out.ask.push(...strings(perms.ask));
    out.deny.push(...strings(perms.deny));
    out.additionalDirectories.push(...strings(perms.additionalDirectories));
    if (typeof perms.defaultMode === "string") out.defaultMode = perms.defaultMode;
    out.hooks.push(...hooks(raw.hooks));
    for (const [id, on] of Object.entries(isObj(raw.enabledPlugins) ? raw.enabledPlugins : {})) {
      if (typeof on === "boolean") out.plugins[id] = on;
    }
  }
  return out;
}

/** hooks → event → [{ matcher, hooks: [handler] }] flattened to one entry per handler. */
function hooks(map: unknown): Hook[] {
  const out: Hook[] = [];
  for (const [event, groups] of Object.entries(isObj(map) ? map : {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      if (!isObj(group)) continue;
      const on = typeof group.matcher === "string" && group.matcher !== "" ? `${event} ${group.matcher}` : event;
      for (const h of Array.isArray(group.hooks) ? group.hooks : []) {
        if (isObj(h)) out.push({ on, ...handler(h) });
      }
    }
  }
  return out;
}

function handler(h: Obj): Pick<Hook, "action" | "what"> {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (h.type) {
    case "command":
      return { action: "runs", what: [s(h.command), ...strings(h.args)].join(" ") };
    case "http":
      return { action: "calls", what: s(h.url) };
    case "mcp_tool":
      return { action: "calls MCP tool", what: `${s(h.server)}/${s(h.tool)}` };
    case "prompt":
      return { action: "asks the model", what: s(h.prompt) };
    case "agent":
      return { action: "runs a subagent with", what: s(h.prompt) };
    default:
      return { action: "has unknown type", what: String(h.type) };
  }
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
