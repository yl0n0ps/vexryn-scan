// Assemble + render the load report (terminal). The .vexryn/report.html
// visual is rendered separately in html.ts.
//
// Load is computed PER AGENT: each agent app (Claude Code, Cursor, …) has
// its own context window, so summing across apps would be meaningless.

import type { AgentClient, AgentLoad, ContextItem, DiscoveredConfig, LoadReport, McpServer, Scope, ToolSearch } from "../types.js";
import { countTokens } from "./tokens.js";
import { plainHttpRemote, secretInText, sensitivePaths, shellInline } from "../diff/rules.js";
import { powerLabels } from "./powers.js";
import { combinations } from "./combos.js";
import { projectDir } from "./discover.js";

// Rough size of a typical model context window, for the "% of window" figure.
export const CONTEXT_WINDOW_TOKENS = 200_000;

/** When the same name is declared twice for one agent, the narrower scope wins. */
const SCOPE_PRECEDENCE: Record<Scope, number> = { local: 0, project: 1, global: 2 };

export function assembleReport(
  root: string,
  deep: boolean,
  includesGlobal: boolean,
  configs: DiscoveredConfig[],
  servers: McpServer[],
  claude: { items: ContextItem[]; toolSearch: ToolSearch } = { items: [], toolSearch: "deferred" },
  others: Partial<Record<AgentClient, ContextItem[]>> = {},
): LoadReport {
  const subproject = servers.filter(inSubproject);
  const deduped = dedupePerAgent(servers.filter((s) => !inSubproject(s)));
  const subprojects = new Map<string, number>();
  for (const s of subproject) subprojects.set(s.fromRelPath, (subprojects.get(s.fromRelPath) ?? 0) + 1);

  const byClient = new Map<AgentClient, McpServer[]>();
  // Claude Code loads its CLAUDE.md/skills even with no MCP server declared.
  if (claude.items.length > 0) byClient.set("Claude Code", []);
  // So do the other agents with always-loaded rules.
  for (const [client, items] of Object.entries(others) as [AgentClient, ContextItem[]][]) if (items.length) byClient.set(client, []);
  for (const s of deduped) {
    const list = byClient.get(s.client) ?? [];
    list.push(s);
    byClient.set(s.client, list);
  }

  const agents: AgentLoad[] = [];
  for (const [client, list] of byClient) {
    agents.push(
      client === "Claude Code" ? agentLoad(client, list, claude.items, claude.toolSearch) : agentLoad(client, list, others[client] ?? [], "upfront"),
    );
  }
  agents.sort(
    (a, b) =>
      b.approxTokens - a.approxTokens ||
      b.servers.length - a.servers.length ||
      a.client.localeCompare(b.client),
  );

  return {
    root,
    deep,
    includesGlobal,
    configs,
    servers: deduped,
    agents,
    subprojects: [...subprojects].map(([file, n]) => ({ file, servers: n })).sort((a, b) => a.file.localeCompare(b.file)),
    totals: {
      serverCount: deduped.length,
      unmeasuredServers: agents.reduce((n, a) => n + a.unmeasuredServers, 0),
    },
  };
}

/** A server from a repo config below the scan root: the agent at the root never loads it. */
export function inSubproject(s: McpServer): boolean {
  return s.scope === "project" && projectDir(s.fromRelPath) !== ".";
}

function dedupePerAgent(servers: McpServer[]): McpServer[] {
  const best = new Map<string, McpServer>();
  for (const s of servers) {
    const key = `${s.client}\u0000${s.name}`;
    const current = best.get(key);
    if (!current || SCOPE_PRECEDENCE[s.scope] < SCOPE_PRECEDENCE[current.scope]) {
      best.set(key, s);
    }
  }
  // Keep the original declaration order.
  return servers.filter((s) => best.get(`${s.client}\u0000${s.name}`) === s);
}

function agentLoad(client: AgentClient, servers: McpServer[], context: ContextItem[], toolSearch: ToolSearch): AgentLoad {
  let toolCount = 0;
  let mcpTokens = 0;
  let nameTokens = 0;
  let unmeasuredServers = 0;
  let usedToolCount = 0;
  let hasUsage = false;
  for (const s of servers) {
    if (isMeasurable(s)) {
      toolCount += s.estimate!.toolCount;
      mcpTokens += s.estimate!.approxTokens;
      nameTokens += (s.estimate!.tools ?? []).reduce((n, t) => n + countTokens(t.name), 0);
    } else {
      unmeasuredServers += 1;
    }
    if (s.usedToolCount != null) {
      hasUsage = true;
      usedToolCount += s.usedToolCount;
    }
  }
  // Deferred (tool search): only tool names load up front; `auto` defers when schemas exceed 10% of the window.
  const mcpDeferred = toolSearch === "deferred" || (toolSearch === "auto" && mcpTokens > CONTEXT_WINDOW_TOKENS / 10);
  const approxTokens = context.reduce((n, c) => n + c.tokens, 0) + (mcpDeferred ? nameTokens : mcpTokens);
  return { client, servers, toolCount, approxTokens, context, mcpDeferred, unmeasuredServers, usedToolCount, hasUsage };
}

export function isMeasurable(s: McpServer): boolean {
  return s.estimate != null && s.estimate.source !== "introspect-failed";
}

export function loadPercent(tokens: number): number {
  return Math.round((tokens / CONTEXT_WINDOW_TOKENS) * 100);
}

/** Human-readable terminal report. Dependency-free on purpose. */
/**
 * `forAgent`: the text goes into an AI agent's context (the MCP tool), so third-party
 * free text — trap phrases, deprecation notices — is replaced by counts.
 */
export function renderText(report: LoadReport, opts: { forAgent?: boolean } = {}): string {
  const { configs, agents, totals, deep, includesGlobal } = report;
  const lines: string[] = [];
  const mode = deep ? "MCP measured live" : "static read";

  lines.push("");
  lines.push("  vexryn · agent load report");
  lines.push("");

  if (configs.length === 0 && agents.length === 0 && report.subprojects.length === 0) {
    lines.push("  No agent configs found. Nothing to scan here.");
    lines.push("");
    return lines.join("\n");
  }

  const globalCount = configs.filter((c) => c.scope === "global").length;
  lines.push(
    `  Found ${configs.length} agent config${plural(configs.length)}` +
      (globalCount ? ` (${globalCount} user-wide)` : "") +
      `, ${totals.serverCount} MCP server${plural(totals.serverCount)}` +
      ` across ${agents.length} agent${plural(agents.length)} (${mode})`,
  );
  lines.push("");

  if (agents.length === 0) {
    lines.push("  No MCP servers declared at this project's root — only rules/instruction files.");
    lines.push("");
  }

  for (const a of agents) {
    const pct = loadPercent(a.approxTokens);
    const nothingMeasured = a.context.length === 0 && a.unmeasuredServers === a.servers.length;
    const tools =
      a.servers.length === 0 ? "" : a.unmeasuredServers === a.servers.length ? ", tools not measured" : `, ${a.toolCount} tool${plural(a.toolCount)}`;
    lines.push(`  ${a.client.toUpperCase()}  — ${a.servers.length} server${plural(a.servers.length)}${tools}`);
    lines.push(
      nothingMeasured
        ? `  ${dim("░".repeat(24))}  load not measured — run --deep`
        : `  ${bar(pct)}  ~${pct}%   ~${a.approxTokens.toLocaleString("en-US")} of ` +
            `${CONTEXT_WINDOW_TOKENS.toLocaleString("en-US")} tokens up front`,
    );
    for (const c of combinations(a.servers.flatMap((s) => (s.estimate?.tools ?? []).map((t) => t.power)))) lines.push(`  ⚠ ${c}`);
    if (a.hasUsage && a.toolCount > 0) {
      lines.push(`  You actually used ${a.usedToolCount} of ${a.toolCount} tools.`);
    }
    if (a.context.length > 0) {
      lines.push("    Always loaded, every session:");
      for (const c of a.context) {
        lines.push(`      ${padEnd(c.label, 34)} ${c.tokens.toLocaleString("en-US").padStart(7)} tok`);
      }
    }
    if (a.servers.length > 0 && (a.context.length > 0 || a.mcpDeferred)) {
      lines.push(
        a.mcpDeferred
          ? "    MCP servers — tool schemas load on demand (tool search); only names count up front:"
          : "    MCP servers:",
      );
    }
    for (const s of a.servers) {
      const where = `${s.fromRelPath} · ${s.scope}` + source(s);
      lines.push(`    ${padEnd(s.name, 20)} ${padEnd(renderServerCost(s), 34)} ${dim(where)}`);
      const can = powerLabels((s.estimate?.tools ?? []).map((t) => t.power));
      if (can.length) lines.push(`      can: ${can.join(", ")}`);
      for (const f of serverFacts(s, opts.forAgent)) lines.push(`      ⚠ ${f}`);
      for (const d of s.estimate?.drift ?? []) lines.push(`      ⚠ ${plain(d)}`);
      for (const f of trapFacts(s, opts.forAgent)) lines.push(`      ⚠ ${f}`);
    }
    lines.push("");
  }

  if (report.subprojects.length > 0) {
    lines.push("  Not counted — subprojects (an agent loads them only when opened there):");
    for (const p of report.subprojects) {
      lines.push(`    ${padEnd(plain(p.file), 40)} ${p.servers} server${plural(p.servers)}`);
    }
    lines.push("");
  }

  if (totals.unmeasuredServers > 0) {
    if (deep) {
      lines.push(
        `  ${totals.unmeasuredServers} server${plural(totals.unmeasuredServers)} could not be reached ` +
          "(reason shown above). Nothing was sent.",
      );
    } else {
      lines.push(
        `  ${totals.unmeasuredServers} MCP server${plural(totals.unmeasuredServers)} not measured. ` +
          "Run with --deep to measure them for real",
      );
      lines.push("  (connects to your own servers locally; nothing is sent).");
    }
    lines.push("");
  }

  if (includesGlobal) {
    lines.push("  Includes your user-wide agent configs (read-only). --no-global for this repo only.");
  }
  lines.push("  Honest note: this counts what your configs make the agent load. Not counted:");
  lines.push("  the agent's own system prompt, hook output, and your conversation as it grows.");
  lines.push("");
  return lines.join("\n");
}

/** Where a server's figures come from, for the location column. */
function source(s: McpServer): string {
  const e = s.estimate;
  if (e?.catalog) return ` · catalog ${plain(e.catalog.package)}@${plain(e.catalog.version)} ${e.measuredAt?.slice(0, 10)}${e.catalog.exact ? "" : ", not pinned"}`;
  return e?.measuredAt ? ` · measured ${e.measuredAt.slice(0, 10)}` : "";
}

/** Exact facts about a server's launch config (rules.ts). Never a secret value. */
export function serverFacts(s: McpServer, forAgent = false): string[] {
  const args = s.args ?? [];
  const facts: string[] = [];
  if (s.command && shellInline(s.command, args)) facts.push("runs a shell with inline code or a pipe");
  const paths = sensitivePaths(args);
  if (paths.length) facts.push(`is given ${paths.map(plain).join(", ")} — a whole filesystem/home or a credential path`);
  if (s.url && plainHttpRemote(s.url)) facts.push(`connects over plain http:// (unencrypted) to ${plain(new URL(s.url).hostname)}`);
  for (const name of s.literalSecrets ?? []) facts.push(`${plain(name)} is a literal secret written in the file (not shown)`);
  if (secretInText(s.target)) facts.push("its command or URL contains a credential (not shown)");
  if (s.deprecated) {
    const note = forAgent ? "" : `: "${plain(s.deprecated.message).slice(0, 120)}"`;
    facts.push(`uses ${plain(s.deprecated.package)}, marked deprecated by its publisher${note}`);
  }
  return facts;
}

/** Traps hidden in the server's tool descriptions — the phrases, never the description. */
export function trapFacts(s: McpServer, forAgent = false): string[] {
  const facts: string[] = [];
  for (const t of s.estimate?.tools ?? []) {
    if (!t.flags) continue;
    const who = `tool ${plain(t.name)} — its description contains`;
    const n = t.flags.phrases.length;
    // Quoting "ignore previous instructions" to an agent would relay the trap itself.
    if (n && forAgent) facts.push(`${who} ${n} instruction-like phrase${plural(n)}`);
    else if (n) facts.push(`${who} the phrase ${t.flags.phrases.map((p) => `"${plain(p)}"`).join(", ")}`);
    if (t.flags.hidden) facts.push(`${who} ${t.flags.hidden} invisible character${plural(t.flags.hidden)}`);
  }
  return facts;
}

/** Strip control characters so a hostile config value can't drive the terminal. */
function plain(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, "");
}

function renderServerCost(s: McpServer): string {
  if (!s.estimate) return dim("no figure");
  if (s.estimate.source === "introspect-failed") {
    return dim(`unreachable — ${truncate(s.estimate.error ?? "failed", 40)}`);
  }
  const used = s.usedToolCount != null ? ` · ${s.usedToolCount} used` : "";
  return `${s.estimate.toolCount} tool${plural(s.estimate.toolCount)} · ~${fmtTokens(s.estimate.approxTokens)} tok${used}`;
}

/** Compact token count: 299 → "299", 52000 → "52k". */
export function fmtTokens(n: number): string {
  return n < 1000 ? `${n}` : `${Math.round(n / 1000)}k`;
}

function bar(pct: number): string {
  const width = 24;
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** Pad by visible width (ANSI escapes don't take columns). */
function padEnd(s: string, n: number): string {
  const visible = s.replace(/\u001b\[[0-9;]*m/g, "").length;
  return visible >= n ? s : s + " ".repeat(n - visible);
}

function dim(s: string): string {
  return `\u001b[2m${s}\u001b[0m`;
}
