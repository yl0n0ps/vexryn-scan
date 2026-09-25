// What --deep measured on THIS machine, remembered locally: the static scan,
// the MCP tool and trim show real, dated figures without launching anything,
// and the next --deep says what changed (drift) — no remote service, nothing
// sent. Lives at ~/.vexryn/measured.json (VEXRYN_HOME in tests), keyed by how
// the server is launched, so the same server declared for two agents is one entry.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerEstimate, ToolInfo } from "../types.js";

export interface Measured {
  measuredAt: string;
  tools: ToolInfo[];
}
export type MeasuredStore = Record<string, Measured>;

/** A digest of how the server is launched: a credential written inline in a command or URL never reaches the store. */
export function measuredKey(s: { transport: string; target: string }): string {
  return createHash("sha256").update(`${s.transport} ${s.target}`).digest("hex");
}

/** sha256 of a tool's description + input schema, key order ignored: the same schema serialized differently is not a change. */
export function toolHash(description: string, inputSchema: unknown): string {
  return createHash("sha256").update(JSON.stringify({ d: description, s: canonical(inputSchema ?? {}) })).digest("hex");
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonical(o[k])]));
  }
  return v;
}

// ponytail: 90-day ageing — a server gone from every config is forgotten; make it a flag if someone needs longer memory.
const MAX_AGE_MS = 90 * 86_400_000;

function storePath(): string {
  return path.join(process.env.VEXRYN_HOME || os.homedir(), ".vexryn", "measured.json");
}

export async function loadMeasured(): Promise<MeasuredStore> {
  try {
    const data = JSON.parse(await fs.readFile(storePath(), "utf8")) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      // Keep only well-formed, recent entries: one bad one must never break the scan.
      const store: MeasuredStore = {};
      const cutoff = Date.now() - MAX_AGE_MS;
      for (const [key, m] of Object.entries(data as Record<string, unknown>)) {
        const e = m as Partial<Measured> | null;
        if (e && typeof e.measuredAt === "string" && Array.isArray(e.tools) && Date.parse(e.measuredAt) >= cutoff) store[key] = e as Measured;
      }
      return store;
    }
  } catch {
    // no store yet, or unreadable — fine
  }
  return {};
}

export async function saveMeasured(store: MeasuredStore): Promise<void> {
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify(store, null, 2), "utf8");
}

/** A dated estimate rebuilt from a past measurement — nothing launched. */
export function estimateFromMeasured(m: Measured): ServerEstimate {
  return {
    toolCount: m.tools.length,
    approxTokens: m.tools.reduce((n, t) => n + t.tokens, 0),
    source: "measured",
    tools: m.tools,
    measuredAt: m.measuredAt,
  };
}

/** Exact facts about what changed since `prev`; [] when nothing did. */
export function drift(prev: Measured, now: ToolInfo[]): string[] {
  const date = prev.measuredAt.slice(0, 10);
  const before = new Map(prev.tools.map((t) => [t.name, t]));
  const after = new Set(now.map((t) => t.name));
  const added = now.filter((t) => !before.has(t.name)).map((t) => t.name);
  const gone = prev.tools.filter((t) => !after.has(t.name)).map((t) => t.name);
  const changed = now.filter((t) => before.has(t.name) && before.get(t.name)!.hash !== t.hash).map((t) => t.name);
  const list = (names: string[]) => names.map((n) => n.replace(/[\u0000-\u001f\u007f]/g, "")).join(", ");
  const n = (k: number) => `${k} tool${k === 1 ? "" : "s"}`;
  const facts: string[] = [];
  if (added.length) facts.push(`+${n(added.length)} since ${date}: ${list(added)}`);
  if (gone.length) facts.push(`${n(gone.length)} gone since ${date}: ${list(gone)}`);
  if (changed.length)
    facts.push(`${n(changed.length)} changed ${changed.length === 1 ? "its" : "their"} description or schema since ${date}: ${list(changed)}`);
  return facts;
}
