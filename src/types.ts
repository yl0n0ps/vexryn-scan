// Core domain types for vexryn-scan.
// Everything here is derived STATICALLY from config files on disk.
// We never execute an MCP server to learn its tools (that is Snyk's mistake).

/** A single agent-config file we discovered on disk. */
export interface DiscoveredConfig {
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the scan root, for display. */
  relPath: string;
  /** Which kind of agent surface this file belongs to. */
  kind: ConfigKind;
}

export type ConfigKind =
  | "mcp-json" // .mcp.json (Claude Code, Cursor, generic)
  | "cursor-rules" // .cursor/rules, .cursorrules
  | "claude-md" // CLAUDE.md
  | "claude-settings" // .claude/settings.json, .claude/settings.local.json
  | "vscode-mcp" // .vscode/mcp.json
  | "gemini" // .gemini/settings.json
  | "windsurf" // .windsurf / windsurf config
  | "unknown";

/** An MCP server entry parsed from a config file. */
export interface McpServer {
  /** The name/key the config gives this server. */
  name: string;
  /** How it is launched: a local command, or a remote URL. */
  transport: "stdio" | "http" | "unknown";
  /** The launch command (stdio) or endpoint (http), for display only. */
  target: string;
  /** The config file this server came from. */
  fromRelPath: string;
  /**
   * Tool count + token cost, when we can estimate it from the bundled
   * catalog. `null` means "unknown — this server is not in the catalog yet;
   * measuring it precisely needs an opt-in introspection, never execution."
   */
  estimate: ServerEstimate | null;
}

export interface ServerEstimate {
  toolCount: number;
  /** Approximate tokens the tool definitions add to the context window. */
  approxTokens: number;
  /** Where the estimate came from (catalog id / heuristic). */
  source: string;
}

/** The assembled load report for one repo. */
export interface LoadReport {
  root: string;
  configs: DiscoveredConfig[];
  servers: McpServer[];
  totals: {
    serverCount: number;
    knownToolCount: number;
    approxTokens: number;
    unknownServers: number;
  };
}
