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
- **Static measurement (default):** estimates context cost from a small bundled
  catalog of well-known servers. Servers not in the catalog show *cost unknown*.
  The default path **never executes a server** — safe for CI / untrusted repos.
- **Real measurement (`--deep`, agnostic):** connects to your OWN configured
  servers locally, reads their real tool list, and counts real tokens with
  `gpt-tokenizer`. Works for ANY server, not just catalog ones. Opt-in, launches
  the servers' commands on your machine, nothing is sent.
- **HTML report (`--html`):** writes a shareable `.vexryn/report.html`.

Not built yet (honest): **real usage** ("you use 11 of 94") needs per-agent log
adapters and isn't agnostic yet; **`vexryn trim`** depends on that usage signal.
The catalog is the seed of a future community **open feed** (OSV format).

## Develop

```bash
npm install
npm run build
node dist/cli.js scan ./fixtures/sample-repo            # static (catalog)
node dist/cli.js scan ./fixtures/deep-repo --deep       # real introspection
node dist/cli.js scan ./fixtures/sample-repo --html     # + .vexryn/report.html
```

## Architecture (decided by the bricks, not habit)

- **Front: TypeScript/Node** — where the bricks live (official MCP SDK,
  token counting, Probot for the GitHub App) and where `npx` distribution is
  frictionless.
- **Depth (later): external subprocesses** — Semgrep (rules), microsandbox
  (safe proof), and the existing Rust proof engine, invoked only for the rare
  "prove it" path. Open feed on OSV, provenance via Sigstore.

See the design doc: *Vexryn — Conception produit*.
