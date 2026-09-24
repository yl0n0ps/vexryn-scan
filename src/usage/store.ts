// Local, per-user usage store. Records how often each tool of each server is
// actually called, so `vexryn scan` can say "you use 11 of 94".
//
// Lives at ~/.vexryn/usage.json. Never leaves the machine. Written by the
// `vexryn wrap` proxy; read by `scan` and `usage`.

import { promises as fs } from "node:fs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface UsageData {
  servers: Record<string, ServerUsage>;
}

export interface ServerUsage {
  tools: Record<string, number>;
  updatedAt: string;
}

function storePath(): string {
  return path.join(os.homedir(), ".vexryn", "usage.json");
}

/** Async read for scan/usage commands. Returns empty data if none. */
export async function loadUsage(): Promise<UsageData> {
  try {
    const text = await fs.readFile(storePath(), "utf8");
    const data = JSON.parse(text) as UsageData;
    if (data && typeof data === "object" && data.servers) return data;
  } catch {
    // no store yet — fine
  }
  return { servers: {} };
}

/** Distinct tools with at least one call, for one server. */
export function usedToolCount(usage: UsageData, serverName: string): number {
  const s = usage.servers[serverName];
  if (!s) return 0;
  return Object.values(s.tools).filter((n) => n > 0).length;
}

// --- Synchronous path used by the long-lived proxy process ---

let cache: UsageData | null = null;

function loadSync(): UsageData {
  if (cache) return cache;
  try {
    if (existsSync(storePath())) {
      cache = JSON.parse(readFileSync(storePath(), "utf8")) as UsageData;
      if (cache && cache.servers) return cache;
    }
  } catch {
    // fall through
  }
  cache = { servers: {} };
  return cache;
}

/** Register a server as active (wired) without recording any call. */
export function touchServer(serverName: string): void {
  const data = loadSync();
  if (!data.servers[serverName]) {
    data.servers[serverName] = { tools: {}, updatedAt: new Date().toISOString() };
  }
}

/** Increment the call count for one tool of one server (in memory). */
export function recordToolCall(serverName: string, toolName: string): void {
  const data = loadSync();
  const server = (data.servers[serverName] ??= { tools: {}, updatedAt: "" });
  server.tools[toolName] = (server.tools[toolName] ?? 0) + 1;
  server.updatedAt = new Date().toISOString();
}

/** Persist the in-memory counts to disk. Safe to call repeatedly. */
export function flush(): void {
  if (!cache) return;
  try {
    mkdirSync(path.dirname(storePath()), { recursive: true });
    writeFileSync(storePath(), JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // best-effort; usage is a convenience, never critical
  }
}
