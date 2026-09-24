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

Early skeleton. `vexryn scan` discovers configs and MCP servers and estimates
context cost from a small bundled catalog of well-known servers. Servers not in
the catalog show as *cost unknown* — we **never execute a server** to measure
it (that's the line Snyk's scanner crosses). Precise counts for unknown servers
will come from an opt-in introspection path, and the catalog will grow into a
community **open feed** (OSV format).

## Develop

```bash
npm install
npm run build
node dist/cli.js scan            # scan the current repo
node dist/cli.js scan ./fixtures/sample-repo
```

## Architecture (decided by the bricks, not habit)

- **Front: TypeScript/Node** — where the bricks live (official MCP SDK,
  token counting, Probot for the GitHub App) and where `npx` distribution is
  frictionless.
- **Depth (later): external subprocesses** — Semgrep (rules), microsandbox
  (safe proof), and the existing Rust proof engine, invoked only for the rare
  "prove it" path. Open feed on OSV, provenance via Sigstore.

See the design doc: *Vexryn — Conception produit*.
