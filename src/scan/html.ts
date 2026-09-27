// Render a LoadReport to a self-contained HTML file (.vexryn/report.html).
// No external assets — it opens offline. One section per agent app, since
// each has its own context window.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentLoad, ContextItem, LoadReport, McpServer } from "../types.js";
import { CONTEXT_WINDOW_TOKENS, agentWarnings, fmtTokens, loadPercent, serverNotes, source } from "./report.js";

/** Write the report and return the file path. */
export async function writeHtml(report: LoadReport, root: string): Promise<string> {
  const dir = path.join(root, ".vexryn");
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, "report.html");
  await fs.writeFile(out, renderHtml(report), "utf8");
  return out;
}

export function renderHtml(report: LoadReport): string {
  const { totals, configs, deep, agents, includesGlobal } = report;
  const mode = deep ? "MCP measured live" : "static read";
  const heaviest = agents[0];
  const heaviestPct = heaviest ? loadPercent(heaviest.approxTokens) : 0;
  const sections = agents.map(agentSection).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vexryn — agent load report</title>
<link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0IiBmaWxsPSJub25lIiByb2xlPSJpbWciIGFyaWEtbGFiZWw9IlZleHJ5biI+CiAgPCEtLSBGYXZpY29uOiBuYXZ5IGdyb3VuZCBmb3IgdGFiIGNvbnRyYXN0LCB0aGlja2VyIHN0cm9rZXMgZm9yIHRpbnkgc2l6ZXMuIC0tPgogIDxyZWN0IHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgcng9IjE0IiBmaWxsPSIjMEEwRTI3Ii8+CiAgPHBhdGggZD0iTTUwIDE0IEwzOS41IDI0LjUgTTI0LjUgMzkuNSBMMTQgNTAiIHN0cm9rZT0iI0VFRjFGQSIgc3Ryb2tlLXdpZHRoPSIxMCIvPgogIDxwYXRoIGQ9Ik0xNCAxNCBMNTAgNTAiIHN0cm9rZT0iIzRBOTBGRiIgc3Ryb2tlLXdpZHRoPSIxMCIvPgo8L3N2Zz4K">
<style>
  :root{--bg:#0A0E27;--surface:#141A33;--elevated:#1A2140;--line:#262E4D;--ink:#EEF1FA;--muted:#8B93AC;--faint:#565E7E;
    --brand:#4A90FF;--violet:#C46BFF;--warn:#E6B23C;--crit:#FF5A4E;--green:#37C98B;--mono:ui-monospace,SFMono-Regular,Menlo,monospace;
    --sans:'Space Grotesk',system-ui,-apple-system,Segoe UI,sans-serif;color-scheme:dark;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
  .wrap{max-width:900px;margin:0 auto;padding:32px 20px 64px}
  .brand{font-family:var(--mono);font-weight:600;display:flex;align-items:center;gap:9px;font-size:16px}
  .dot{width:9px;height:9px;border-radius:2px;background:linear-gradient(135deg,var(--brand),var(--violet));transform:rotate(45deg)}
  h1{font-size:26px;letter-spacing:-.02em;margin:20px 0 4px}
  h2{font-size:17px;margin:0 0 2px}
  .sub{color:var(--muted);margin:0 0 24px;font-size:14px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px}
  @media(max-width:640px){.stats{grid-template-columns:1fr}}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px}
  .agent{margin-bottom:18px}
  .k{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0}
  .v{font-size:32px;font-weight:700;letter-spacing:-.02em;margin:8px 0 0;font-variant-numeric:tabular-nums}
  .v small{font-size:15px;color:var(--muted);font-weight:600}
  .track{height:14px;border-radius:7px;background:#0f151c;border:1px solid var(--line);margin:12px 0 6px;overflow:hidden}
  .fill{height:100%;background:linear-gradient(90deg,var(--brand),var(--violet))}
  .meta{color:var(--muted);font-size:13px;margin:0}
  .used{color:var(--brand);font-size:13px;margin:4px 0 0}
  .table-wrap{overflow-x:auto;margin-top:10px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
  th{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  td.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
  .srv{font-family:var(--mono);font-size:13px}
  .src{color:var(--muted);font-size:11px;font-family:var(--mono)}
  .bad{color:var(--crit)}
  .foot{color:var(--muted);font-size:12px;font-family:var(--mono);margin-top:28px}
  .note td{padding-top:0;border-bottom:1px solid var(--line);font-size:12px}
  tr.has-note td{border-bottom:none}
  .can{color:var(--violet);font-family:var(--mono);margin:0}
  .warn{color:var(--warn);margin:2px 0 0}
  .pill{display:inline-block;font-family:var(--mono);font-size:11px;padding:3px 9px;border-radius:100px;
    background:rgba(74,144,255,0.14);color:var(--brand)}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><span class="dot"></span>ve<span style="color:var(--brand)">x</span>ryn</div>
  <h1>Agent load report</h1>
  <p class="sub">${configs.length} config${plural(configs.length)} · ${totals.serverCount} MCP server${plural(totals.serverCount)} · ${agents.length} agent${plural(agents.length)} · <span class="pill">${mode}</span></p>

  <div class="stats">
    <div class="card"><p class="k">Agents</p><div class="v">${agents.length}</div></div>
    <div class="card"><p class="k">MCP servers</p><div class="v">${totals.serverCount}</div></div>
    <div class="card"><p class="k">Heaviest load</p><div class="v">${heaviestPct}<small>%</small></div>
      <p class="meta">${heaviest ? escapeHtml(heaviest.client) : "—"}</p></div>
  </div>

${sections || '  <p class="meta">No MCP servers declared at this project\'s root — only rules/instruction files.</p>'}
${subprojects(report)}

  <p class="foot">100% local — nothing was sent. Each agent has its own context window, so load is shown per agent.
  ${includesGlobal ? "Includes your user-wide agent configs (read-only)." : ""}
  ${deep ? "MCP servers measured by connecting to your own servers." : "MCP servers not measured — run --deep for real numbers."}
  Not counted: the agent's own system prompt, hook output, and your conversation as it grows.</p>
</div>
</body>
</html>`;
}

function agentSection(a: AgentLoad): string {
  const pct = loadPercent(a.approxTokens);
  const rows = [...a.context.map(contextRow), ...a.servers.map(serverRow)].join("\n");
  const deferred = a.mcpDeferred
    ? `<p class="meta">MCP tool schemas load on demand (tool search): only their names count up front.</p>`
    : "";
  const used =
    a.hasUsage && a.toolCount > 0
      ? `<p class="used">You actually used ${a.usedToolCount} of ${a.toolCount} tools.</p>`
      : "";
  return `  <section class="card agent">
    <h2>${escapeHtml(a.client)}</h2>
    ${
      a.context.length === 0 && a.unmeasuredServers === a.servers.length
        ? `<p class="meta">${a.servers.length} server${plural(a.servers.length)} · load not measured — run --deep</p>`
        : `<p class="meta">${a.servers.length} server${plural(a.servers.length)} · ${a.toolCount} tool${plural(a.toolCount)} · ~${a.approxTokens.toLocaleString("en-US")} of ${CONTEXT_WINDOW_TOKENS.toLocaleString("en-US")} tokens up front (${pct}%)</p>
    <div class="track"><div class="fill" style="width:${Math.min(100, pct)}%"></div></div>`
    }
    ${agentWarnings(a).map((w) => `<p class="warn">⚠ ${escapeHtml(w)}</p>`).join("\n    ")}
    ${used}
    ${deferred}
    <div class="table-wrap"><table>
      <thead><tr><th>Loaded</th><th style="text-align:right">Tools</th><th style="text-align:right">Context</th><th>Declared in</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table></div>
  </section>`;
}

function contextRow(c: ContextItem): string {
  return `        <tr><td class="srv">${escapeHtml(c.label)}</td><td class="num">—</td><td class="num">${c.tokens.toLocaleString(
    "en-US",
  )}</td><td class="src">always loaded</td></tr>`;
}

/** Repo configs of subprojects: listed, never counted in an agent's load. */
function subprojects(report: LoadReport): string {
  if (report.subprojects.length === 0) return "";
  const rows = report.subprojects
    .map((p) => `        <tr><td class="srv">${escapeHtml(p.file)}</td><td class="num">${p.servers} server${plural(p.servers)}</td></tr>`)
    .join("\n");
  return `  <section class="card agent">
    <h2>Not counted — subprojects</h2>
    <p class="meta">An agent loads these only when it is opened there.</p>
    <div class="table-wrap"><table><tbody>
${rows}
    </tbody></table></div>
  </section>`;
}

/** A server row, then its powers and warnings — the same sentences as the terminal report. */
function serverRow(s: McpServer): string {
  const notes = serverNotes(s);
  const lines = [
    ...(notes.can.length ? [`<p class="can">can: ${escapeHtml(notes.can.join(", "))}</p>`] : []),
    ...notes.warnings.map((w) => `<p class="warn">⚠ ${escapeHtml(w)}</p>`),
  ];
  const note = lines.length ? `\n        <tr class="note"><td colspan="4">${lines.join("")}</td></tr>` : "";
  return serverCells(s, lines.length > 0) + note;
}

function serverCells(s: McpServer, hasNote: boolean): string {
  const cls = hasNote ? ' class="has-note"' : "";
  const from = `${escapeHtml(s.fromRelPath)} · ${s.scope}${escapeHtml(source(s))}`;
  const name = escapeHtml(s.name);
  if (!s.estimate || s.estimate.source === "introspect-failed") {
    const reason = s.estimate?.error ? "unreachable" : "cost unknown";
    return `        <tr${cls}><td class="srv">${name}</td><td class="num bad">${reason}</td><td class="num">—</td><td class="src">${from}</td></tr>`;
  }
  const used = s.usedToolCount != null ? ` · ${s.usedToolCount} used` : "";
  return `        <tr${cls}><td class="srv">${name}</td><td class="num">${s.estimate.toolCount}${used}</td><td class="num">~${fmtTokens(
    s.estimate.approxTokens,
  )}</td><td class="src">${from}</td></tr>`;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
