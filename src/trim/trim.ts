// `vexryn trim`: use the real usage signal to recommend what to keep vs cut,
// and optionally write a lean suggested config. Non-destructive — it never
// edits the original files; --write emits a suggestion under .vexryn/suggested/.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { McpServer } from "../types.js";
import type { UsageData } from "../usage/store.js";
import { fmtTokens } from "../scan/report.js";

export type Verdict = "keep" | "drop" | "unknown";

export interface TrimRec {
  server: McpServer;
  verdict: Verdict;
  reason: string;
  /** Measured tools this server has that were never called (keep verdict only). */
  unused?: string[];
}

export interface TrimResult {
  recs: TrimRec[];
  savedTokens: number;
  hasUsage: boolean;
}

export function computeTrim(servers: McpServer[], usage?: UsageData): TrimResult {
  const recs: TrimRec[] = [];
  let savedTokens = 0;
  let hasUsage = false;

  for (const s of servers) {
    const used = s.usedToolCount; // number | null | undefined
    if (used != null) hasUsage = true;

    if (used != null && used === 0) {
      recs.push({ server: s, verdict: "drop", reason: "recorded, never used" });
      savedTokens += s.estimate?.approxTokens ?? 0;
    } else if (used != null && used > 0) {
      const tools = s.estimate?.tools;
      const called = usage?.servers[s.name]?.tools ?? {};
      const unused = tools?.filter((t) => !(called[t.name] > 0)).map((t) => t.name);
      recs.push({ server: s, verdict: "keep", reason: tools ? `${used} of ${tools.length} tools used` : `${used} tool(s) used`, unused });
    } else {
      recs.push({ server: s, verdict: "unknown", reason: "no usage yet — wire + use to judge" });
    }
  }
  return { recs, savedTokens, hasUsage };
}

export function renderTrim(result: TrimResult): string {
  const { recs, savedTokens, hasUsage } = result;
  const lines: string[] = ["", "  vexryn · trim suggestions", ""];

  if (recs.length === 0) {
    lines.push("  No MCP servers found.");
    lines.push("");
    return lines.join("\n");
  }
  if (!hasUsage) {
    lines.push("  No usage recorded yet, so trim can't judge what you use.");
    lines.push("  Wire your servers and work for a bit, then run trim again:");
    lines.push("    vexryn wire");
    lines.push("");
    return lines.join("\n");
  }

  for (const r of recs) {
    lines.push(`    ${mark(r.verdict)}  ${pad(r.server.name, 18)} ${dim(r.reason)}`);
    if (r.unused?.length) lines.push(`          ${dim(`never used (${r.unused.length}): ${shortList(r.unused)}`)}`);
  }
  lines.push("");
  const drops = recs.filter((r) => r.verdict === "drop").length;
  if (savedTokens > 0) {
    lines.push(`  Dropping the unused servers frees ~${fmtTokens(savedTokens)} tokens of context.`);
  } else if (drops > 0) {
    lines.push(`  Dropping ${drops} unused server${drops === 1 ? "" : "s"} shrinks the tool list your agent picks from.`);
    lines.push("  (Context saved not measured — run `vexryn scan --deep` for real numbers.)");
  } else {
    lines.push("  Nothing to drop — everything with usage data is in use.");
  }
  lines.push("  Use --write to emit a lean config under .vexryn/suggested/ (originals untouched).");
  lines.push("");
  return lines.join("\n");
}

/** Write a suggested lean config per source file, keeping non-dropped servers. */
export async function writeTrimmed(
  root: string,
  configs: { path: string; relPath: string; kind: string }[],
  drop: Set<string>,
): Promise<string[]> {
  const outDir = path.join(root, ".vexryn", "suggested");
  await fs.mkdir(outDir, { recursive: true });
  const written: string[] = [];

  for (const cfg of configs) {
    if (!isJsonServerConfig(cfg.kind)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(cfg.path, "utf8"));
    } catch {
      continue;
    }
    if (typeof raw !== "object" || raw === null) continue;
    const obj = raw as Record<string, unknown>;
    const key = obj.mcpServers ? "mcpServers" : obj.servers ? "servers" : null;
    if (!key) continue;
    const map = obj[key] as Record<string, unknown>;

    let removed = 0;
    for (const name of Object.keys(map)) {
      if (drop.has(name)) {
        delete map[name];
        removed += 1;
      }
    }
    if (removed === 0) continue;

    const outName = cfg.relPath.split(path.sep).join("__");
    const out = path.join(outDir, outName);
    await fs.writeFile(out, JSON.stringify(raw, null, 2) + "\n", "utf8");
    written.push(path.relative(root, out));
  }
  return written;
}

function isJsonServerConfig(kind: string): boolean {
  return (
    kind === "mcp-json" ||
    kind === "cursor-mcp" ||
    kind === "vscode-mcp" ||
    kind === "claude-settings" ||
    kind === "gemini"
  );
}

function mark(v: Verdict): string {
  if (v === "keep") return "\u001b[32mkeep\u001b[0m";
  if (v === "drop") return "\u001b[31mdrop\u001b[0m";
  return "\u001b[2m????\u001b[0m";
}

/** The first names, control characters stripped, then "… +N more". */
function shortList(names: string[], max = 8): string {
  const shown = names.slice(0, max).map((n) => n.replace(/[\u0000-\u001f\u007f]/g, ""));
  return names.length > max ? `${shown.join(", ")}, … +${names.length - max} more` : shown.join(", ");
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function dim(s: string): string {
  return `\u001b[2m${s}\u001b[0m`;
}
