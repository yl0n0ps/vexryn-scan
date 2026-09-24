// Assemble + render the load report (terminal). The .vexryn/report.html
// visual is rendered separately in html.ts.
//
// Load is computed PER AGENT: each agent app (Claude Code, Cursor, …) has
// its own context window, so summing across apps would be meaningless.

import type { AgentClient, AgentLoad, DiscoveredConfig, LoadReport, McpServer, Scope } from "../types.js";

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
): LoadReport {
  const deduped = dedupePerAgent(servers);

  const byClient = new Map<AgentClient, McpServer[]>();
  for (const s of deduped) {
    const list = byClient.get(s.client) ?? [];
    list.push(s);
    byClient.set(s.client, list);
  }

  const agents: AgentLoad[] = [];
  for (const [client, list] of byClient) {
    agents.push(agentLoad(client, list));
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
    totals: {
      serverCount: deduped.length,
      unmeasuredServers: agents.reduce((n, a) => n + a.unmeasuredServers, 0),
    },
  };
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

function agentLoad(client: AgentClient, servers: McpServer[]): AgentLoad {
  let toolCount = 0;
  let approxTokens = 0;
  let unmeasuredServers = 0;
  let usedToolCount = 0;
  let hasUsage = false;
  for (const s of servers) {
    if (isMeasurable(s)) {
      toolCount += s.estimate!.toolCount;
      approxTokens += s.estimate!.approxTokens;
    } else {
      unmeasuredServers += 1;
    }
    if (s.usedToolCount != null) {
      hasUsage = true;
      usedToolCount += s.usedToolCount;
    }
  }
  return { client, servers, toolCount, approxTokens, unmeasuredServers, usedToolCount, hasUsage };
}

export function isMeasurable(s: McpServer): boolean {
  return s.estimate != null && s.estimate.source !== "introspect-failed";
}

export function loadPercent(tokens: number): number {
  return Math.round((tokens / CONTEXT_WINDOW_TOKENS) * 100);
}

/** Human-readable terminal report. Dependency-free on purpose. */
export function renderText(report: LoadReport): string {
  const { configs, agents, totals, deep, includesGlobal } = report;
  const lines: string[] = [];
  const mode = deep ? "measured" : "estimated";

  lines.push("");
  lines.push("  vexryn · agent load report");
  lines.push("");

  if (configs.length === 0) {
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
    lines.push("  No MCP servers declared — only rules/instruction files.");
    lines.push("");
  }

  for (const a of agents) {
    const pct = loadPercent(a.approxTokens);
    lines.push(
      `  ${a.client.toUpperCase()}  — ${a.servers.length} server${plural(a.servers.length)}, ` +
        `${a.toolCount} tool${plural(a.toolCount)}`,
    );
    lines.push(
      `  ${bar(pct)}  ~${pct}%   ~${a.approxTokens.toLocaleString("en-US")} of ` +
        `${CONTEXT_WINDOW_TOKENS.toLocaleString("en-US")} tokens up front`,
    );
    if (a.hasUsage && a.toolCount > 0) {
      lines.push(`  You actually used ${a.usedToolCount} of ${a.toolCount} tools.`);
    }
    for (const s of a.servers) {
      lines.push(`    ${padEnd(s.name, 20)} ${padEnd(renderServerCost(s), 34)} ${dim(`${s.fromRelPath} · ${s.scope}`)}`);
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
        `  ${totals.unmeasuredServers} server${plural(totals.unmeasuredServers)} not in the catalog — ` +
          "cost unknown. Run with --deep to measure them for real",
      );
      lines.push("  (connects to your own servers locally; nothing is sent).");
    }
    lines.push("");
  }

  if (includesGlobal) {
    lines.push("  Includes your user-wide agent configs (read-only). --no-global for this repo only.");
  }
  lines.push("  Honest note: tool definitions are a fixed cost, but your");
  lines.push("  conversation history also grows — this report measures the tools.");
  lines.push("");
  return lines.join("\n");
}

function renderServerCost(s: McpServer): string {
  if (!s.estimate) return dim("no figure");
  if (s.estimate.source === "introspect-failed") {
    return dim(`unreachable — ${truncate(s.estimate.error ?? "failed", 40)}`);
  }
  const tag = s.estimate.measured ? "" : dim(" (est.)");
  const used = s.usedToolCount != null ? ` · ${s.usedToolCount} used` : "";
  return `${s.estimate.toolCount} tools · ~${fmtTokens(s.estimate.approxTokens)} tok${tag}${used}`;
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
