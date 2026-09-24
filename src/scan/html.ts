// Render a LoadReport to a self-contained HTML file (.vexryn/report.html).
// No external assets — it opens offline. Mirrors the product mockup.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { LoadReport, McpServer } from "../types.js";
import { fmtTokens } from "./report.js";

const CONTEXT_WINDOW_TOKENS = 200_000;

/** Write the report and return the file path. */
export async function writeHtml(report: LoadReport, root: string): Promise<string> {
  const dir = path.join(root, ".vexryn");
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, "report.html");
  await fs.writeFile(out, renderHtml(report), "utf8");
  return out;
}

export function renderHtml(report: LoadReport): string {
  const { totals, servers, configs, deep } = report;
  const pct = Math.round((totals.approxTokens / CONTEXT_WINDOW_TOKENS) * 100);
  const mode = deep ? "measured" : "estimated";
  const rows = servers.map(serverRow).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vexryn Load Report</title>
<style>
  :root{--bg:#0b0f14;--surface:#121922;--line:#233040;--ink:#e7ecf2;--muted:#8695a6;
    --brand:#37d7c4;--warn:#f0b23e;--crit:#f0656b;--mono:ui-monospace,SFMono-Regular,Menlo,monospace;
    --sans:system-ui,-apple-system,Segoe UI,sans-serif;color-scheme:dark;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
  .wrap{max-width:900px;margin:0 auto;padding:32px 20px 64px}
  .brand{font-family:var(--mono);font-weight:600;display:flex;align-items:center;gap:9px;font-size:16px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--brand)}
  h1{font-size:26px;letter-spacing:-.02em;margin:20px 0 4px}
  .sub{color:var(--muted);margin:0 0 24px;font-size:14px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px}
  @media(max-width:640px){.stats{grid-template-columns:1fr}}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px}
  .k{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0}
  .v{font-size:32px;font-weight:700;letter-spacing:-.02em;margin:8px 0 0;font-variant-numeric:tabular-nums}
  .v small{font-size:15px;color:var(--muted);font-weight:600}
  .track{height:16px;border-radius:8px;background:#0f151c;border:1px solid var(--line);margin:14px 0 8px;overflow:hidden}
  .fill{height:100%;background:var(--warn)}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
  th,td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--line)}
  th{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  td.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
  .srv{font-family:var(--mono);font-size:13px}
  .src{color:var(--muted);font-size:11px}
  .bad{color:var(--crit)}
  .foot{color:var(--muted);font-size:12px;font-family:var(--mono);margin-top:28px}
  .pill{display:inline-block;font-family:var(--mono);font-size:11px;padding:3px 9px;border-radius:100px;
    background:#123028;color:var(--brand)}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><span class="dot"></span>vexryn</div>
  <h1>Agent load report</h1>
  <p class="sub">${configs.length} config${plural(configs.length)} · ${totals.serverCount} MCP server${plural(totals.serverCount)} · <span class="pill">${mode}</span></p>

  <div class="stats">
    <div class="card"><p class="k">Tools loaded</p><div class="v">${totals.toolCount}</div></div>
    <div class="card"><p class="k">Context eaten</p><div class="v">${pct}<small>%</small></div></div>
    <div class="card"><p class="k">Tokens up front</p><div class="v">~${fmtTokens(totals.approxTokens)}</div></div>
  </div>

  <div class="card">
    <p class="k">Context load (${mode})</p>
    <div class="track"><div class="fill" style="width:${Math.min(100, pct)}%"></div></div>
    <p class="sub" style="margin:0">~${totals.approxTokens.toLocaleString("en-US")} tokens of a ${CONTEXT_WINDOW_TOKENS.toLocaleString("en-US")} window</p>
  </div>

  <table>
    <thead><tr><th>Server</th><th style="text-align:right">Tools</th><th style="text-align:right">Context</th><th>From</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <p class="foot">100% local — nothing was sent. Tool definitions are a fixed cost; conversation history also grows. ${deep ? "Measured by connecting to your own servers." : "Estimated from the bundled catalog — run --deep for real numbers."}</p>
</div>
</body>
</html>`;
}

function serverRow(s: McpServer): string {
  const from = escapeHtml(s.fromRelPath);
  const name = escapeHtml(s.name);
  if (!s.estimate || s.estimate.source === "introspect-failed") {
    const reason = s.estimate?.error ? `unreachable` : `cost unknown`;
    return `      <tr><td class="srv">${name}</td><td class="num bad">${reason}</td><td class="num">—</td><td class="src">${from}</td></tr>`;
  }
  const est = s.estimate.measured ? "" : " (est.)";
  return `      <tr><td class="srv">${name}</td><td class="num">${s.estimate.toolCount}</td><td class="num">~${fmtTokens(
    s.estimate.approxTokens,
  )}${est}</td><td class="src">${from}</td></tr>`;
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
