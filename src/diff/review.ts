// Compare two snapshots of a repo's agent configs and render the PR comment:
// what the agent may now DO (MCP servers, Claude Code permissions, hooks,
// plugins) and what it now LOADS every session (Claude Code context).
// Exact facts only. Every string that came from the repo goes through
// `code()`, so a hostile name can't inject markdown, links or @mentions.

import path from "node:path";
import type { ContextItem, McpServer } from "../types.js";
import { discoverConfigs } from "../scan/discover.js";
import { parseServers, readJsonLoose } from "../scan/parse.js";
import { claudeCodeContext } from "../scan/claude.js";
import { readClaudeSettings, type ClaudeSettings, type Hook } from "../scan/settings.js";

export const MARKER = "<!-- vexryn-pr-review -->";
export const NO_CHANGE = "No agent config change.";

/** Lines per section; keeps a comment well under GitHub's 65,536-char limit. */
const MAX_LINES = 40;
const WARN = "⚠️ ";

export interface Snapshot {
  servers: McpServer[];
  context: ContextItem[];
  settings: ClaudeSettings;
  /** Config files present but not valid JSON. */
  unreadable: string[];
}

export interface Review {
  /** What the agent may do — increases first (prefixed ⚠️). */
  powers: string[];
  /** What Claude Code loads every session. */
  loadHeader: string | null;
  load: string[];
}

/** Read a snapshot dir with the static scan, repo scope only. */
export async function readSnapshot(dir: string): Promise<Snapshot> {
  const configs = await discoverConfigs(dir);
  const unreadable: string[] = [];
  for (const c of configs) {
    if (c.relPath.endsWith(".json") && (await readJsonLoose(c.path)) === null) unreadable.push(c.relPath);
  }
  return {
    servers: await parseServers(configs, dir),
    context: (await claudeCodeContext(dir, false)).items,
    settings: await readClaudeSettings(dir),
    unreadable,
  };
}

export function compare(base: Snapshot, head: Snapshot): Review {
  const powers = [
    ...unreadableLines(base, head),
    ...serverLines(base, head),
    ...permissionLines(base.settings, head.settings),
    ...hookLines(base.settings.hooks, head.settings.hooks),
    ...pluginLines(base.settings.plugins, head.settings.plugins),
  ];
  // Increases first, keeping each group's order.
  powers.sort((x, y) => Number(y.startsWith(WARN)) - Number(x.startsWith(WARN)));
  return { powers, ...loadLines(base.context, head.context) };
}

export function renderReview(r: Review): string {
  const out = [MARKER, "### Vexryn — agent config review", ""];
  if (r.powers.length === 0 && r.load.length === 0) {
    out.push(NO_CHANGE);
    return out.join("\n") + "\n";
  }
  out.push("This PR changes what your AI agent may do or what it loads.", "");
  if (r.powers.length > 0) out.push("**What the agent may do**", ...bullets(r.powers), "");
  if (r.loadHeader) out.push(r.loadHeader, ...bullets(r.load), "");
  out.push(
    "<sub>Static read of the config files in this PR: nothing was executed, nothing was sent. " +
      "An MCP server's tool list can't be known without running it — run `vexryn scan --deep` " +
      "locally on servers you trust.</sub>",
  );
  return out.join("\n") + "\n";
}

/** Inline code span for untrusted text: flattened, truncated, backtick-safe. */
export function code(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (!flat) return "(empty)";
  const text = flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  return longest > 0 ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

// --- MCP servers -----------------------------------------------------------

function unreadableLines(base: Snapshot, head: Snapshot): string[] {
  return head.unreadable
    .filter((f) => !base.unreadable.includes(f))
    .map((f) => `${WARN}${code(f)} is not valid JSON — its MCP servers can't be reviewed`);
}

function serverLines(base: Snapshot, head: Snapshot): string[] {
  const key = (s: McpServer) => `${s.fromRelPath}\u0000${s.name}`;
  const before = new Map(base.servers.map((s) => [key(s), s]));
  const after = new Map(head.servers.map((s) => [key(s), s]));
  const lines: string[] = [];
  for (const [k, s] of after) {
    const was = before.get(k);
    if (!was) {
      lines.push(`${WARN}New MCP server ${code(s.name)} for ${s.client} in ${code(s.fromRelPath)}: ${describe(s)}`);
    } else if (describe(was) !== describe(s)) {
      lines.push(
        `${WARN}MCP server ${code(s.name)} changed in ${code(s.fromRelPath)} (${s.client}): now ${describe(s)} (before: ${describe(was)})`,
      );
    }
  }
  for (const [k, s] of before) {
    // A file that stopped parsing is reported once, not as N removals.
    if (!after.has(k) && !head.unreadable.includes(s.fromRelPath)) {
      lines.push(`MCP server ${code(s.name)} removed from ${code(s.fromRelPath)} (${s.client})`);
    }
  }
  return lines;
}

function describe(s: McpServer): string {
  const how =
    s.transport === "stdio"
      ? `runs ${code(s.target)}${unpinned(s) ? " — version not pinned" : ""}`
      : s.transport === "http"
        ? `connects to ${code(s.target)}`
        : "unrecognized launch config";
  const receives = s.receives?.length ? `, receives ${s.receives.map(code).join(", ")}` : "";
  return how + receives;
}

const RUNNERS = new Set(["npx", "bunx", "pnpx", "uvx"]);

/** A package runner fetching a package with no version (or `latest`): what runs can change any day. */
function unpinned(s: McpServer): boolean {
  const runner = path.basename(s.command ?? "").replace(/\.(cmd|exe)$/i, "");
  if (!RUNNERS.has(runner)) return false;
  const pkg = (s.args ?? []).find((a) => !a.startsWith("-"));
  if (!pkg) return false;
  // npm: name@version (skip a scope's leading @); uv: name==version or name@version.
  const version = runner === "uvx" ? pkg.split(/==|@/)[1] : pkg.slice(1).split("@")[1];
  return !version || version === "latest";
}

// --- Claude Code settings --------------------------------------------------

/** Modes Claude Code ignores when set in a project file (docs: settings). */
const IGNORED_FROM_PROJECT = new Set(["auto", "bypassPermissions"]);

function permissionLines(base: ClaudeSettings, head: ClaudeSettings): string[] {
  const lines: string[] = [];
  const delta = (a: string[], b: string[]) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });

  const allow = delta(base.allow, head.allow);
  for (const r of allow.added) lines.push(`${WARN}Claude Code may use ${code(r)} without asking (once the folder is trusted)`);
  for (const r of allow.removed) lines.push(`Claude Code no longer auto-approved for ${code(r)}`);
  const deny = delta(base.deny, head.deny);
  for (const r of deny.added) lines.push(`Claude Code is now blocked from ${code(r)}`);
  for (const r of deny.removed) lines.push(`${WARN}Claude Code no longer blocked from ${code(r)}`);
  const ask = delta(base.ask, head.ask);
  for (const r of ask.added) lines.push(`Claude Code now asks before ${code(r)}`);
  for (const r of ask.removed) lines.push(`${WARN}Claude Code no longer forced to ask before ${code(r)}`);
  const dirs = delta(base.additionalDirectories, head.additionalDirectories);
  for (const d of dirs.added) lines.push(`${WARN}Claude Code may access directory ${code(d)}`);
  for (const d of dirs.removed) lines.push(`Claude Code no longer has access to directory ${code(d)}`);

  if (base.defaultMode !== head.defaultMode) {
    const to = head.defaultMode ?? "default";
    const ignored = IGNORED_FROM_PROJECT.has(to);
    const loosens = !ignored && !["default", "plan"].includes(to);
    lines.push(
      `${loosens ? WARN : ""}Permission mode: ${code(base.defaultMode ?? "default")} → ${code(to)}` +
        (ignored ? " — ignored by Claude Code when set in a project file" : ""),
    );
  }
  return lines;
}

function hookLines(base: Hook[], head: Hook[]): string[] {
  const id = (h: Hook) => `${h.on}\u0000${h.action}\u0000${h.what}`;
  const was = new Set(base.map(id));
  const is = new Set(head.map(id));
  const show = (h: Hook) => `on ${code(h.on)}: ${h.action} ${code(h.what)}`;
  return [
    ...head.filter((h) => !was.has(id(h))).map((h) => `${WARN}New hook ${show(h)}`),
    ...base.filter((h) => !is.has(id(h))).map((h) => `Hook removed ${show(h)}`),
  ];
}

function pluginLines(base: Record<string, boolean>, head: Record<string, boolean>): string[] {
  const lines: string[] = [];
  for (const id of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (head[id] === true && base[id] !== true) lines.push(`${WARN}Enables Claude Code plugin ${code(id)}`);
    if (base[id] === true && head[id] !== true) lines.push(`Stops enabling Claude Code plugin ${code(id)}`);
  }
  return lines;
}

// --- Always-loaded context -------------------------------------------------

const AGGREGATES: Record<string, string> = { skills: "Skill descriptions", agents: "Subagent descriptions" };

function loadLines(base: ContextItem[], head: ContextItem[]): Pick<Review, "loadHeader" | "load"> {
  const before = new Map(base.map((c) => [c.key, c]));
  const after = new Map(head.map((c) => [c.key, c]));
  const load: string[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key);
    const a = after.get(key);
    const [bt, at] = [b?.tokens ?? 0, a?.tokens ?? 0];
    const [bn, an] = [b?.names ?? [], a?.names ?? []];
    if (bt === at && bn.join("\u0000") === an.join("\u0000")) continue;
    if (AGGREGATES[key]) {
      const added = an.filter((n) => !bn.includes(n));
      const removed = bn.filter((n) => !an.includes(n));
      load.push(
        `${AGGREGATES[key]}: ${bn.length} → ${an.length} (${signed(at - bt)} tokens)` +
          (added.length ? ` — adds ${added.map(code).join(", ")}` : "") +
          (removed.length ? ` — removes ${removed.map(code).join(", ")}` : ""),
      );
    } else {
      load.push(`${code(key)}: ${fmt(bt)} → ${fmt(at)} tokens (${signed(at - bt)})`);
    }
  }
  if (load.length === 0) return { loadHeader: null, load };
  const [tb, ta] = [sum(base), sum(head)];
  return { loadHeader: `**Loads every session (Claude Code): ${fmt(tb)} → ${fmt(ta)} tokens (${signed(ta - tb)})**`, load };
}

function sum(items: ContextItem[]): number {
  return items.reduce((n, c) => n + c.tokens, 0);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${fmt(n)}`;
}

function bullets(lines: string[]): string[] {
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `…and ${lines.length - MAX_LINES} more`] : lines;
  return shown.map((l) => `- ${l}`);
}
