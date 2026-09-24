// Core domain types for vexryn-scan.
//
// Two measurement modes:
//   - default (static): derived only from config files on disk, never connects.
//   - --deep (opt-in): connects to the user's OWN configured servers, locally,
//     to read their real tool list and count real tokens. Nothing is sent.
// The default path never executes a server (that is Snyk's mistake); --deep
// does, but only on explicit opt-in, on the user's machine, for their own
// already-configured servers.
//
// Configs come from two places: the scanned repo (project scope) and the
// user's home (global configs of each agent app). Each agent app has its own
// context window, so load is always reported PER AGENT, never summed across.

/** The agent app that loads a config (each has its own context window). */
export type AgentClient =
  | "Claude Code"
  | "Claude Desktop"
  | "Cursor"
  | "VS Code"
  | "Windsurf"
  | "Gemini CLI"
  | "Unknown";

/**
 * Where a server is declared:
 *  - project: a file inside the scanned repo
 *  - local:   per-project section of a global file (Claude Code ~/.claude.json)
 *  - global:  the user-wide config of an agent app
 */
export type Scope = "project" | "local" | "global";

/** A single agent-config file we discovered on disk. */
export interface DiscoveredConfig {
  /** Absolute path on disk. */
  path: string;
  /** Display path: relative to the scan root, or ~/… for global files. */
  relPath: string;
  /** Which kind of file this is. */
  kind: ConfigKind;
  /** Which agent app loads it. */
  client: AgentClient;
  /** Repo file or user-wide file. */
  scope: "project" | "global";
}

export type ConfigKind =
  | "mcp-json" // .mcp.json (Claude Code project scope)
  | "cursor-mcp" // .cursor/mcp.json (project or ~/.cursor/mcp.json)
  | "cursor-rules" // .cursor/rules, .cursorrules
  | "claude-md" // CLAUDE.md
  | "claude-settings" // .claude/settings.json, .claude/settings.local.json
  | "claude-user" // ~/.claude.json (Claude Code user + local scopes)
  | "claude-desktop" // claude_desktop_config.json
  | "vscode-mcp" // .vscode/mcp.json or VS Code user mcp.json
  | "gemini" // .gemini/settings.json (project or global)
  | "windsurf" // .windsurf rules (project)
  | "windsurf-mcp" // ~/.codeium/windsurf/mcp_config.json
  | "unknown";

/** An MCP server entry parsed from a config file. */
export interface McpServer {
  /** The name/key the config gives this server. */
  name: string;
  /** Which agent app loads this server. */
  client: AgentClient;
  /** Where it is declared (project / local / global). */
  scope: Scope;
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
  /** The config file this server came from (display path). */
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

/** The load of ONE agent app: its servers share one context window. */
export interface AgentLoad {
  client: AgentClient;
  servers: McpServer[];
  toolCount: number;
  approxTokens: number;
  unmeasuredServers: number;
  /** Distinct tools used, summed over servers that have usage data. */
  usedToolCount: number;
  /** True when at least one server of this agent has usage data. */
  hasUsage: boolean;
}

/** The assembled load report for one repo (+ the user's global configs). */
export interface LoadReport {
  root: string;
  /** True when built with --deep (real introspection). */
  deep: boolean;
  /** True when global (user-wide) configs were included. */
  includesGlobal: boolean;
  configs: DiscoveredConfig[];
  servers: McpServer[];
  /** Load per agent app, heaviest first. */
  agents: AgentLoad[];
  totals: {
    serverCount: number;
    unmeasuredServers: number;
  };
}
