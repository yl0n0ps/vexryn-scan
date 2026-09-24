// Assemble + render the load report (terminal). The .vexryn/report.html
// visual is rendered separately in html.ts.

import type { DiscoveredConfig, McpServer, LoadReport } from "../types.js";

// Rough size of a typical model context window, for the "% of window" figure.
const CONTEXT_WINDOW_TOKENS = 200_000;

export function assembleReport(
  root: string,
  deep: boolean,
  configs: DiscoveredConfig[],
  servers: McpServer[],
): LoadReport {
  let toolCount = 0;
  let approxTokens = 0;
  let unmeasuredServers = 0;
  for (const s of servers) {
    if (s.estimate && s.estimate.source !== "introspect-failed") {
      toolCount += s.estimate.toolCount;
      approxTokens += s.estimate.approxTokens;
    } else {
      unmeasuredServers += 1;
    }
  }
  return {
    root,
    deep,
    configs,
    servers,
    totals: { serverCount: servers.length, toolCount, approxTokens, unmeasuredServers },
  };
}

/** Human-readable terminal report. Dependency-free on purpose. */
export function renderText(report: LoadReport): string {
  const { configs, servers, totals, deep } = report;
  const lines: string[] = [];
  const pct = Math.round((totals.approxTokens / CONTEXT_WINDOW_TOKENS) * 100);
  const mode = deep ? "measured" : "estimated";

  lines.push("");
  lines.push("  vexryn · agent load report");
  lines.push("");

  if (configs.length === 0) {
    lines.push("  No agent configs found. Nothing to scan here.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `  Found ${configs.length} agent config${plural(configs.length)}, ` +
      `${totals.serverCount} MCP server${plural(totals.serverCount)}, ` +
      `${totals.toolCount} tools (${mode})`,
  );
  lines.push("");

  lines.push(`  CONTEXT LOAD  — tool definitions loaded up front (${mode})`);
  lines.push(`  ${bar(pct)}  ~${pct}%`);
  lines.push(
    `  ~${totals.approxTokens.toLocaleString("en-US")} tokens of a ${CONTEXT_WINDOW_TOKENS.toLocaleString("en-US")} window`,
  );
  lines.push("");

  lines.push("  BY SERVER");
  for (const s of servers) {
    lines.push(`    ${padEnd(s.name, 18)} ${renderServerCost(s)}   ${dim(s.fromRelPath)}`);
  }
  lines.push("");

  if (totals.unmeasuredServers > 0) {
    if (deep) {
      lines.push(
        `  ${totals.unmeasuredServers} server${plural(totals.unmeasuredServers)} could not be reached ` +
          "(see the reason above). Nothing was sent.",
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

  lines.push("  Honest note: tool definitions are a fixed cost, but your");
  lines.push("  conversation history also grows — this report measures the tools.");
  lines.push("");
  return lines.join("\n");
}

function renderServerCost(s: McpServer): string {
  if (!s.estimate) return dim("no figure");
  if (s.estimate.source === "introspect-failed") {
    return dim(`unreachable — ${s.estimate.error ?? "failed"}`);
  }
  const tag = s.estimate.measured ? "" : dim(" (est.)");
  return `${s.estimate.toolCount} tools · ~${fmtTokens(s.estimate.approxTokens)} tok${tag}`;
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

function padEnd(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function dim(s: string): string {
  return `\u001b[2m${s}\u001b[0m`;
}
