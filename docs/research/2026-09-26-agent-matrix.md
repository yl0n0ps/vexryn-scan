# Coding agents — where each one reads MCP servers and always-loaded instructions (checked 2026-09-26)

Every row comes from the agent's own docs or source code (links below). Vexryn only
claims what is written here; a path we could not verify is marked *(unverified)* and
is only used to FIND a file, never to claim a load.

A file can be read by several agents: `.mcp.json` (Claude Code, VS Code), root
`AGENTS.md` (Codex, Cursor, Windsurf, Copilot, Cline, Roo, Kiro, OpenCode, Zed…).

## MCP servers

| Agent | Project file(s) | User file(s) | Format · key | Server shape |
|---|---|---|---|---|
| Claude Code | `.mcp.json`, `.claude/settings*.json` | `~/.claude.json` (user + per-project local) | JSON · `mcpServers` | command/args/env · url/headers |
| Claude Desktop | — | `<AppSupport>/Claude/claude_desktop_config.json` | JSON · `mcpServers` | same |
| Cursor | `.cursor/mcp.json` | `~/.cursor/mcp.json` | JSON · `mcpServers` | same |
| VS Code (Copilot) | `.vscode/mcp.json` (`servers`), **`.mcp.json` (`mcpServers`, portable)** | `<AppSupport>/Code/User/mcp.json` | JSONC · `servers` / `mcpServers` | type/command/args/env/envFile · url/headers |
| GitHub Copilot CLI | `.copilot/mcp-config.json` | `~/.copilot/mcp-config.json` (`COPILOT_HOME`) | JSON · `mcpServers` | type/command/args/env · url/headers |
| Codex (CLI + IDE) | `.codex/config.toml` (trusted projects only) | `~/.codex/config.toml` | **TOML** · `[mcp_servers.<name>]` | command/args/env/env_vars/cwd · url/bearer_token_env_var/http_headers; `enabled` |
| Gemini CLI | `.gemini/settings.json` | `~/.gemini/settings.json` | JSON · `mcpServers` | command/args/env · url/httpUrl |
| Windsurf | — | `~/.codeium/windsurf/mcp_config.json` | JSON · `mcpServers` | command/args/env · serverUrl |
| Cline | — | VS Code `globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`; CLI `~/.cline/mcp.json` | JSON · `mcpServers` | command/args/env · url/headers; `disabled` |
| Roo Code | `.roo/mcp.json` (wins over global) | VS Code `globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` *(folder unverified)* | JSON · `mcpServers` | command/args/env · url/headers; `disabled` |
| Continue | `.continue/mcpServers/*.yaml` or `*.json` | `~/.continue/config.yaml` (`mcpServers` list) | **YAML**/JSON | name/command/args/env · type/url |
| Zed | `.zed/settings.json` | `~/.config/zed/settings.json` | JSONC · `context_servers` | command/args/env · url/headers |
| Kiro | `.kiro/settings/mcp.json` (wins) | `~/.kiro/settings/mcp.json` | JSON · `mcpServers` | command/args/env · url/headers; `disabled` |
| OpenCode | `opencode.json` / `opencode.jsonc` | `~/.config/opencode/opencode.json` | JSONC · `mcp` | type local: `command` **array**, `environment`; remote: url/headers; `enabled` |
| Goose | — | `~/.config/goose/config.yaml` | **YAML** · `extensions` | type stdio: cmd/args/envs; streamable_http: uri/headers; `enabled` |

## Instructions loaded into every request

| Agent | Always loaded |
|---|---|
| Claude Code | CLAUDE.md (root + parents + `~/.claude/CLAUDE.md`), MEMORY.md cap, skill + subagent descriptions *(already in Vexryn)* |
| Cursor | `.cursor/rules/**/*.mdc` `alwaysApply: true`; described rules' descriptions; root `AGENTS.md` *(already)* |
| Windsurf | `global_rules.md`; `.devin`/`.windsurf/rules` `always_on` + `model_decision` descriptions; `.windsurfrules`; root `AGENTS.md` *(already)* |
| Gemini CLI | `GEMINI.md` or `context.fileName`, repo + parents + `~/.gemini` *(already)* |
| Codex | `~/.codex/AGENTS.override.md` else `AGENTS.md`; then from the repo root down to the working dir, per folder `AGENTS.override.md` else `AGENTS.md` else `project_doc_fallback_filenames`; total capped by `project_doc_max_bytes` (default 32 KiB) |
| VS Code (Copilot) | `.github/copilot-instructions.md`; root `AGENTS.md` (`chat.useAgentsMdFile`). `.github/instructions/*.instructions.md` only when `applyTo` matches — not counted |
| Cline | `.clinerules` file or `.clinerules/` / `.cline/rules/` folder; global `~/Documents/Cline/Rules`; also `.cursorrules`, `.windsurfrules`, `AGENTS.md`. Conditional rules (by path) not counted |
| Roo Code | `.roo/rules/` (else `.roorules`), global `~/.roo/rules/`, root `AGENTS.md` (`roo-cline.useAgentRules`, default on). Mode-specific rules not counted |
| Kiro | `.kiro/steering/*.md` with `inclusion: always` **or no inclusion (default always)**; `~/.kiro/steering/`; `AGENTS.md` (always) |
| OpenCode | `AGENTS.md` walking up from the working dir, **else `CLAUDE.md`**; `~/.config/opencode/AGENTS.md`, else `~/.claude/CLAUDE.md`; `instructions` in opencode.json (paths/globs) |
| Zed | **the first** of `.rules`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` at the project root — first match wins, the rest is ignored |
| Continue, Goose, Copilot CLI | MCP only in Vexryn for now (instruction loading not verified) |

## Facts this makes possible (cross-agent)

- **Zed first-match:** "Zed loads `.cursorrules` and ignores your `AGENTS.md`."
- **OpenCode fallback:** with no `AGENTS.md`, OpenCode reads `CLAUDE.md`; with one, it ignores `CLAUDE.md`.
- **Codex cap:** instructions beyond 32 KiB are silently cut.
- **One file, many agents:** a `.mcp.json` change is a change for Claude Code **and** VS Code.

## Sources

- Codex MCP: https://learn.chatgpt.com/docs/extend/mcp?surface=cli · AGENTS.md: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- VS Code MCP: https://code.visualstudio.com/docs/copilot/customization/mcp-servers · instructions: https://code.visualstudio.com/docs/copilot/customization/custom-instructions
- Copilot CLI MCP: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
- Cline MCP: https://docs.cline.bot/mcp/configuring-mcp-servers · rules: https://docs.cline.bot/features/cline-rules · source `apps/vscode/src/core/storage/disk.ts` (settings dir + `cline_mcp_settings.json`)
- Roo Code MCP: https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo · rules: https://roocodeinc.github.io/Roo-Code/features/custom-instructions · source `src/shared/globalFileNames.ts`
- Continue MCP: https://docs.continue.dev/customize/deep-dives/mcp
- Zed MCP: https://zed.dev/docs/ai/mcp · rules: https://zed.dev/docs/ai/rules
- Kiro MCP: https://kiro.dev/docs/mcp/configuration/ · steering: https://kiro.dev/docs/steering/
- OpenCode MCP: https://opencode.ai/docs/mcp-servers/ · rules: https://opencode.ai/docs/rules/
- Goose config: https://goose-docs.ai/docs/guides/config-files/
- Cursor, Windsurf, Gemini CLI, Claude Code: see `src/scan/instructions.ts` and `src/scan/claude.ts` headers.
