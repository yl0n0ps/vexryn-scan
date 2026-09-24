# vexryn

**See what your AI agent actually loads — any repo, any stack, no config.**

```bash
npx vexryn scan
```

Vexryn reads the agent configs scattered across your repo (MCP servers, Cursor
rules, `CLAUDE.md`, Gemini, Windsurf…) and tells you, in plain terms, what your
agent loads and why it might be slow. **Read-only, 100% local — nothing is sent.**
Vexryn reads configs, not your code.

## Why

Connect a few MCP servers and their tool definitions quietly eat your agent's
context window before you type a single word — the agent gets slower and picks
the wrong tools. Today those configs are scattered and unreadable. Vexryn makes
them legible.

## The road (perf → review → proof)

1. **Load report (here).** `vexryn scan` — a lean, faster agent in one command.
2. **PR review (next).** A GitHub App that turns an unreadable `.mcp.json` diff
   into a sentence: *"+12 tools, can now send email and delete files."*
3. **Proof on demand (moat).** When a capability is genuinely dangerous, prove
   it's exploitable in a sandbox — never just flag it.

## Status

Working skeleton. What's real today:

- **Discovery (agnostic):** finds agent configs across any repo/stack and multiple
  agents (MCP, Cursor, Claude, Gemini, Windsurf). Read-only.
- **User-wide configs (default):** also reads each agent app's global config —
  Claude Code `~/.claude.json` (user scope + this repo's local scope), Claude
  Desktop, Cursor `~/.cursor/mcp.json`, Windsurf, Gemini CLI, VS Code user
  `mcp.json` (JSONC ok). That's usually where most of an agent's load lives.
  Read-only; `--no-global` restricts to the repo (e.g. in CI).
- **Per-agent load:** each agent app has its own context window, so load is
  reported per agent, never summed across apps. A server declared at several
  scopes of one agent is counted once (narrowest scope wins, like Claude Code).
- **Static measurement (default):** estimates context cost from a small bundled
  catalog of well-known servers. Servers not in the catalog show *cost unknown*.
  The default path **never executes a server** — safe for CI / untrusted repos.
- **Real measurement (`--deep`, agnostic):** connects to your OWN configured
  servers locally, reads their real tool list, and counts real tokens with
  `gpt-tokenizer`. Works for ANY server, not just catalog ones. Opt-in, launches
  the servers' commands on your machine, nothing is sent.
- **HTML report (`--html`):** writes a shareable `.vexryn/report.html`.

- **Real usage (`vexryn wrap`, agnostic):** a transparent MCP proxy. Route a
  server through it and Vexryn counts the tool calls the agent actually makes —
  any agent, any server, precise, local. `vexryn scan` then shows *"you used 2
  of 5 tools"*. See it with `vexryn usage`.

- **Auto-wiring (`vexryn wire` / `unwire`):** routes a repo's stdio servers
  through the proxy, reversible, with a backup.
- **Trim (`vexryn trim [--write]`):** uses real usage to suggest what to cut and
  writes a lean config under `.vexryn/suggested/` (originals untouched).

Not built yet (honest): **wiring user-wide configs** — they're read-only for now
(Claude Code rewrites `~/.claude.json` while it runs, so writing it safely needs
care), so usage/trim only cover repo-level servers. The **catalog** numbers are
rough seeds, not measurements — `--deep` is the source of truth; the catalog
should be refilled from real measurements and grow into a community **open
feed** (OSV format).

## Test

```bash
npm test   # global configs, wire round-trip, proxy + usage + trim — all against
           # a temporary fake home (VEXRYN_HOME); your real configs are never touched
```

## Develop

```bash
npm install
npm run build
node dist/cli.js scan ./fixtures/sample-repo            # static (catalog)
node dist/cli.js scan ./fixtures/deep-repo --deep       # real introspection
node dist/cli.js scan ./fixtures/sample-repo --html     # + .vexryn/report.html

# Wire a real server through the proxy in your own .mcp.json:
#   "command": "vexryn", "args": ["wrap", "--name", "github", "--",
#                                  "npx", "-y", "@modelcontextprotocol/server-github"]
```

## Architecture (decided by the bricks, not habit)

- **Front: TypeScript/Node** — where the bricks live (official MCP SDK,
  token counting, Probot for the GitHub App) and where `npx` distribution is
  frictionless.
- **Depth (later): external subprocesses** — Semgrep (rules), microsandbox
  (safe proof), and the existing Rust proof engine, invoked only for the rare
  "prove it" path. Open feed on OSV, provenance via Sigstore.

See the design doc: *Vexryn — Conception produit*.
