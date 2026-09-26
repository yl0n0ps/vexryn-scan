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

import type { Power } from "./scan/powers.js";

/** The agent app that loads a config (each has its own context window). */
export type AgentClient =
  | "Claude Code"
  | "Claude Desktop"
  | "Cursor"
  | "VS Code"
  | "Windsurf"
  | "Gemini CLI"
  | "Codex"
  | "GitHub Copilot CLI"
  | "Cline"
  | "Roo Code"
  | "Continue"
  | "Zed"
  | "Kiro"
  | "OpenCode"
  | "Goose"
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
  | "codex-toml" // .codex/config.toml, ~/.codex/config.toml
  | "copilot-cli" // .copilot/mcp-config.json, ~/.copilot/mcp-config.json
  | "cline" // Cline mcp settings (VS Code globalStorage / ~/.cline)
  | "roo-mcp" // .roo/mcp.json, Roo mcp_settings.json
  | "continue-yaml" // .continue/mcpServers/*.{yaml,json}, ~/.continue/config.yaml
  | "zed" // .zed/settings.json, ~/.config/zed/settings.json (context_servers)
  | "kiro" // .kiro/settings/mcp.json, ~/.kiro/settings/mcp.json
  | "opencode" // opencode.json(c), ~/.config/opencode/opencode.json (mcp)
  | "goose" // ~/.config/goose/config.yaml (extensions)
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
  /** NAMES of the env vars / headers the server receives — never their values. */
  receives?: string[];
  /** Of those, the names whose value is a credential written in the file (value never kept). */
  literalSecrets?: string[];
  /**
   * Distinct tools of this server actually called, from the local usage store
   * (populated by `vexryn wrap`). `null` = no usage data recorded yet.
   */
  usedToolCount?: number | null;
  /** The config file this server came from (display path). */
  fromRelPath: string;
  /** Its package is marked deprecated by its publisher (Vexryn catalogue, latest version). */
  deprecated?: { package: string; message: string } | null;
  /**
   * Tool count + token cost, from real introspection (--deep). `null` means
   * not measured: the static scan never executes a server, and never invents a figure.
   */
  estimate: ServerEstimate | null;
}

export interface ServerEstimate {
  toolCount: number;
  /** Tokens the tool definitions add to the context window. */
  approxTokens: number;
  /** How we got the figure: "introspect" or "introspect-failed". */
  source: string;
  /** Per-tool detail, present when measured via introspection. */
  tools?: ToolInfo[];
  /** Set when introspection was attempted but failed, with the reason. */
  error?: string;
  /** ISO date of the local measurement this estimate was rebuilt from (static scan). */
  measuredAt?: string;
  /** What changed since the previous local measurement (--deep only). */
  drift?: string[];
  /** The tool list as the server sent it (live measurement only; never stored or displayed). */
  raw?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  /** Set when the figures come from the Vexryn catalogue: which package version they are for. */
  catalog?: { package: string; version: string; exact: boolean };
}

/** One tool as declared by a server, with its measured token cost. */
export interface ToolInfo {
  name: string;
  description?: string;
  /** Real tokens the serialized tool definition adds to context. */
  tokens: number;
  /** What the tool can do, or null when the classifier is not sure. */
  power?: Power | null;
  /** sha256 of description + input schema, to notice a change next time. */
  hash?: string;
  /** Traps hidden in its description (instruction phrases, invisible characters); the description itself is never shown. */
  flags?: ToolFlags | null;
}

/** What a tool description hides: instruction-override phrases (as matched) and invisible characters. */
export interface ToolFlags {
  phrases: string[];
  hidden: number;
}

/** Something an agent loads into context at every session start (read from disk). */
export interface ContextItem {
  /** Stable identity across two scans: the file label, or "memory" / "skills" / "agents". */
  key: string;
  /** What it is: a file path, or e.g. "12 skill descriptions". */
  label: string;
  tokens: number;
  /** Skill / subagent names, for the aggregated items. */
  names?: string[];
}

/**
 * How Claude Code loads MCP tool schemas: deferred (tool search, the default —
 * only names up front), upfront (all schemas), or auto (upfront if they fit in
 * 10% of the window).
 */
export type ToolSearch = "deferred" | "upfront" | "auto";

/** The load of ONE agent app: its servers share one context window. */
export interface AgentLoad {
  client: AgentClient;
  servers: McpServer[];
  toolCount: number;
  /** Tokens loaded up front: always-loaded context + MCP tools (names only when deferred). */
  approxTokens: number;
  /** Always-loaded instructions: CLAUDE.md, memory, skill/subagent descriptions. */
  context: ContextItem[];
  /** True when MCP tool schemas load on demand (Claude Code tool search). */
  mcpDeferred: boolean;
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
  /** Servers declared in a subproject's config: loaded only when the agent is opened there, never counted here. */
  subprojects: { file: string; servers: number }[];
  totals: {
    serverCount: number;
    unmeasuredServers: number;
  };
}
