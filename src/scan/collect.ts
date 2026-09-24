// The static scan's inputs, shared by the CLI and the MCP server: discovered
// configs, their MCP servers (+ enabled plugins' servers), real usage from the
// local store, and Claude Code's always-loaded context. Never executes anything.

import type { DiscoveredConfig, LoadReport, McpServer } from "../types.js";
import { discoverConfigs, discoverGlobalConfigs } from "./discover.js";
import { parseServers } from "./parse.js";
import { claudeCodeContext, type ClaudeContext } from "./claude.js";
import { assembleReport } from "./report.js";
import { loadUsage, usedToolCount } from "../usage/store.js";

export interface Collected {
  configs: DiscoveredConfig[];
  servers: McpServer[];
  claude: ClaudeContext;
}

export async function collectStatic(root: string, includesGlobal: boolean): Promise<Collected> {
  const configs = [...(await discoverConfigs(root)), ...(includesGlobal ? await discoverGlobalConfigs() : [])];
  const claude = await claudeCodeContext(root, includesGlobal);
  const servers = [...(await parseServers(configs, root)), ...claude.pluginServers];
  // Attach real usage from the local store (populated by `vexryn wrap`).
  const usage = await loadUsage();
  for (const s of servers) s.usedToolCount = usage.servers[s.name] ? usedToolCount(usage, s.name) : null;
  return { configs, servers, claude };
}

/** The static load report (no --deep): read-only, nothing launched. */
export async function staticReport(root: string, includesGlobal: boolean): Promise<LoadReport> {
  const { configs, servers, claude } = await collectStatic(root, includesGlobal);
  return assembleReport(root, false, includesGlobal, configs, servers, claude);
}
