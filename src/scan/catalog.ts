// A tiny bundled catalog of well-known MCP servers → approximate tool count
// and context cost. This is the seed of the future OPEN FEED (OSV-format):
// today a hardcoded stub, tomorrow a community-maintained, versioned feed.
//
// Honesty: these are ESTIMATES for popular servers. A server not in the
// catalog resolves to `null` — we say "unknown", we never execute it to find
// out. Precise counts for unknown servers will come from an opt-in
// introspection path, not from running the server during a scan.

import type { ServerEstimate } from "../types.js";

interface CatalogEntry {
  toolCount: number;
  approxTokens: number;
}

// Keyed by a normalized server identity (lowercased name or package hint).
const CATALOG: Record<string, CatalogEntry> = {
  github: { toolCount: 43, approxTokens: 52000 },
  slack: { toolCount: 18, approxTokens: 22000 },
  sentry: { toolCount: 12, approxTokens: 15000 },
  postgres: { toolCount: 9, approxTokens: 11000 },
  filesystem: { toolCount: 8, approxTokens: 9000 },
  notion: { toolCount: 15, approxTokens: 12000 },
  puppeteer: { toolCount: 7, approxTokens: 8000 },
  "brave-search": { toolCount: 2, approxTokens: 3000 },
  gitlab: { toolCount: 20, approxTokens: 24000 },
  linear: { toolCount: 14, approxTokens: 13000 },
};

/**
 * Estimate a server's cost from its name/command. Returns null when the
 * server is not in the catalog (unknown — measure via opt-in introspection).
 */
export function estimateServer(name: string, target: string): ServerEstimate | null {
  const hay = `${name} ${target}`.toLowerCase();
  for (const key of Object.keys(CATALOG)) {
    if (hay.includes(key)) {
      const e = CATALOG[key];
      return { toolCount: e.toolCount, approxTokens: e.approxTokens, source: `catalog:${key}` };
    }
  }
  return null;
}
