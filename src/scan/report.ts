// Assemble + render the load report. Rendering is plain text for now
// (the .vexryn/report.html visual is the next milestone; see the mockup).

import type { DiscoveredConfig, McpServer, LoadReport } from "../types.js";

// Rough size of a typical model context window, for the "% of window" figure.
const CONTEXT_WINDOW_TOKENS = 200_000;

export function assembleReport(
  root: string,
  configs: DiscoveredConfig[],
  servers: McpServer[],
): LoadReport {
  let knownToolCount = 0;
  let approxTokens = 0;
  let unknownServers = 0;
  for (const s of servers) {
    if (s.estimate) {
      knownToolCount += s.estimate.toolCount;
      approxTokens += s.estimate.approxTokens;
    } else {
      unknownServers += 1;
    }
  }
  return {
    root,
    configs,
    servers,
    totals: { serverCount: servers.length, knownToolCount, approxTokens, unknownServers },
  };
}

/** Human-readable terminal report. Kept dependency-free on purpose. */
export function renderText(report: LoadReport): string {
  const { configs, servers, totals } = report;
  const lines: string[] = [];
  const pct = Math.round((totals.approxTokens / CONTEXT_WINDOW_TOKENS) * 100);

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
      `${totals.serverCount} MCP server${plural(totals.serverCount)}` +
      (totals.knownToolCount ? `, ~${totals.knownToolCount} known tools` : ""),
  );
  lines.push("");

  // Context load (only counts servers we can estimate).
  lines.push("  CONTEXT LOAD  — estimated tool definitions loaded up front");
  lines.push(`  ${bar(pct)}  ~${pct}%`);
  lines.push(
    `  ~${totals.approxTokens.toLocaleString("en-US")} tokens of a ${CONTEXT_WINDOW_TOKENS.toLocaleString("en-US")} window`,
  );
  lines.push("");

  // Per-server breakdown.
  lines.push("  BY SERVER");
  for (const s of servers) {
    lines.push(`    ${padEnd(s.name, 18)} ${renderServerCost(s)}   ${dim(s.fromRelPath)}`);
  }
  lines.push("");

  if (totals.unknownServers > 0) {
    lines.push(
      `  ${totals.unknownServers} server${plural(totals.unknownServers)} not in the catalog yet — ` +
        "cost unknown. We never execute a server to measure it;",
    );
    lines.push("  precise counts come from an opt-in introspection (coming).");
    lines.push("");
  }

  lines.push("  Honest note: tool definitions are a fixed cost, but your");
  lines.push("  conversation history also grows — this report measures the tools.");
  lines.push("");
  return lines.join("\n");
}

function renderServerCost(s: McpServer): string {
  if (!s.estimate) return dim("cost unknown");
  return `${s.estimate.toolCount} tools · ~${Math.round(s.estimate.approxTokens / 1000)}k tok`;
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
  // ANSI dim; harmless if the terminal ignores it.
  return `\u001b[2m${s}\u001b[0m`;
}
