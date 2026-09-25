// The static scan's inputs, shared by the CLI and the MCP server: discovered
// configs, their MCP servers (+ enabled plugins' servers), real usage from the
// local store, and Claude Code's always-loaded context. Never executes anything.

import type { DiscoveredConfig, LoadReport, McpServer } from "../types.js";
import type { UsageData } from "../usage/store.js";
import { discoverConfigs, discoverGlobalConfigs } from "./discover.js";
import { parseServers } from "./parse.js";
import { claudeCodeContext, type ClaudeContext } from "./claude.js";
import { agentContexts, type AgentContexts } from "./instructions.js";
import { assembleReport } from "./report.js";
import { loadUsage, usedToolCount } from "../usage/store.js";
import { estimateFromMeasured, loadMeasured, measuredKey } from "./measured.js";
import { estimateFromCatalog, lookup, packageSpec } from "./catalog.js";

export interface Collected {
  configs: DiscoveredConfig[];
  servers: McpServer[];
  claude: ClaudeContext;
  /** Always-loaded context of the other agents (Cursor, Windsurf, Gemini CLI). */
  others: AgentContexts;
}

export async function collectStatic(root: string, includesGlobal: boolean): Promise<Collected> {
  const configs = [...(await discoverConfigs(root)), ...(includesGlobal ? await discoverGlobalConfigs() : [])];
  const claude = await claudeCodeContext(root, includesGlobal);
  const servers = [...(await parseServers(configs, root)), ...claude.pluginServers];
  await attachLocal(servers);
  return { configs, servers, claude, others: await agentContexts(root, includesGlobal) };
}

/**
 * Attach what is known without launching anything: real usage (wrap), this machine's
 * past measurements (--deep) and, failing those, the Vexryn catalogue. Returns the usage read.
 */
export async function attachLocal(servers: McpServer[]): Promise<UsageData> {
  const usage = await loadUsage();
  const measured = await loadMeasured();
  for (const s of servers) {
    s.usedToolCount = usage.servers[s.name] ? usedToolCount(usage, s.name) : null;
    const m = measured[measuredKey(s)];
    const hit = s.command ? lookup(packageSpec(s.command, s.args ?? [])) : null;
    if (!s.estimate) {
      if (m) s.estimate = estimateFromMeasured(m);
      else if (hit?.measured) s.estimate = estimateFromCatalog({ ...hit, measured: hit.measured });
    }
    // The notice is recorded for the latest version: claimed only for a config running that one.
    if (hit?.deprecated && hit.version === hit.latest) s.deprecated = { package: hit.package, message: hit.deprecated };
  }
  return usage;
}

/** The static load report (no --deep): read-only, nothing launched. */
export async function staticReport(root: string, includesGlobal: boolean): Promise<LoadReport> {
  const { configs, servers, claude, others } = await collectStatic(root, includesGlobal);
  return assembleReport(root, false, includesGlobal, configs, servers, claude, others);
}
