// Core domain types for vexryn-scan.
//
// Two measurement modes:
//   - default (static): derived only from config files on disk, never connects.
//   - --deep (opt-in): connects to the user's OWN configured servers, locally,
//     to read their real tool list and count real tokens. Nothing is sent.
// The default path never executes a server (that is Snyk's mistake); --deep
// does, but only on explicit opt-in, on the user's machine, for their own
// already-configured servers.

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
  /** Launch command + args (stdio only), used by --deep introspection. */
  command?: string;
  args?: string[];
  /** Endpoint URL (http only), used by --deep introspection. */
  url?: string;
  /**
   * Distinct tools of this server actually called, from the local usage store
   * (populated by `vexryn wrap`). `null` = no usage data recorded yet.
   */
  usedToolCount?: number | null;
  /** The config file this server came from. */
  fromRelPath: string;
  /**
   * Tool count + token cost. `null` means we have no figure yet:
   * not in the catalog, and not introspected. Populated by the catalog
   * (static) or by real introspection (--deep).
   */
  estimate: ServerEstimate | null;
}

export interface ServerEstimate {
  toolCount: number;
  /** Tokens the tool definitions add to the context window. */
  approxTokens: number;
  /** How we got the figure: "catalog:<id>", "introspect", or "introspect-failed". */
  source: string;
  /** Whether this is a real measurement (--deep) or an estimate (catalog). */
  measured: boolean;
  /** Per-tool detail, present when measured via introspection. */
  tools?: ToolInfo[];
  /** Set when introspection was attempted but failed, with the reason. */
  error?: string;
}

/** One tool as declared by a server, with its measured token cost. */
export interface ToolInfo {
  name: string;
  description: string;
  /** Real tokens the serialized tool definition adds to context. */
  tokens: number;
}

/** The assembled load report for one repo. */
export interface LoadReport {
  root: string;
  /** True when built with --deep (real introspection). */
  deep: boolean;
  configs: DiscoveredConfig[];
  servers: McpServer[];
  totals: {
    serverCount: number;
    toolCount: number;
    approxTokens: number;
    unmeasuredServers: number;
  };
}
