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

Before you type a word, your agent has already loaded instruction files
(`CLAUDE.md`…), skill and subagent descriptions, and MCP servers — and a config
change can quietly give it new powers (a new server holding a token, a shell
command it may run without asking, a hook that runs at every session start).
Those configs are scattered and unreadable, and code review has no opinion on
them. Vexryn makes them legible.

## The road (perf → review → proof)

1. **Load report (here).** `vexryn scan` — a lean, faster agent in one command.
2. **PR review (built — CLI + GitHub Action).** `vexryn diff` turns an
   unreadable agent-config diff into a short comment: *"new MCP server `slack`
   receives `SLACK_BOT_TOKEN`, version not pinned · Claude Code may run
   `git push` without asking · +2,300 tokens every session."* A hosted GitHub
   App comes later, when a team needs it.
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
- **Claude Code's always-loaded context (default, exact):** what Claude Code
  loads at every session start, per its docs
  ([context window](https://code.claude.com/docs/en/context-window)): CLAUDE.md
  files (repo root + parents + `~/.claude/CLAUDE.md`), auto memory `MEMORY.md`
  (first 200 lines / 25KB), skill descriptions (user, repo, enabled plugins —
  not `disable-model-invocation` ones) and subagent descriptions. Real tokens,
  read from disk, nothing executed. On a typical setup this — not MCP — is the
  biggest fixed load.
- **MCP tool search aware:** Claude Code defers MCP tool schemas by default
  (only names load up front), so their cost isn't counted as up-front load
  unless `ENABLE_TOOL_SEARCH=false` / a custom `ANTHROPIC_BASE_URL` turns
  deferral off. MCP servers shipped by enabled plugins are listed too.
- **No invented numbers:** the static path never executes a server and never
  guesses its cost — an unmeasured server says *not measured*. Safe for CI /
  untrusted repos.
- **Real measurement (`--deep`, agnostic):** connects to your OWN configured
  servers locally, reads their real tool list, and counts real tokens with
  `gpt-tokenizer`. Works for ANY server. Opt-in, launches
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

Not built yet (honest):
- **Wiring user-wide configs** — read-only for now (Claude Code rewrites
  `~/.claude.json` while it runs), so usage/trim only cover repo-level servers.
- **Other agents' instruction files** (`GEMINI.md`, `AGENTS.md`, Cursor rules…)
  aren't counted yet — only Claude Code's, whose loading rules are documented.
- **Not visible from config files:** the agent's built-in system prompt, hook
  output (e.g. SessionStart hooks), slash-command files, and connectors added
  through an app UI (claude.ai / desktop) rather than a config file.
- **Open feed** (OSV format) of measured per-server costs — to be filled from
  real `--deep` measurements, never by hand.

## PR review (`vexryn diff`)

```bash
vexryn diff --base main            # what my uncommitted/branch changes do
vexryn diff --base <sha> --head <sha>
```

Compares two versions of the repo's agent configs and prints one markdown
comment: **what the agent may now do** — MCP servers added/removed/changed
(launch command or URL, unpinned `npx`/`uvx` packages, the *names* of the env
vars/headers they receive — never values), Claude Code permission rules,
permission mode, extra directories, hooks, plugins — and **what Claude Code now
loads every session** (token deltas — counted with the o200k tokenizer, an
approximation of the model's own count — and skills/subagents by name). Every
changed agent file is named, including ones it doesn't review yet (`AGENTS.md`,
Cursor rules…), so a change is never reported as "no change".

Static: files are read from git objects as data, never executed; a symlinked
`CLAUDE.md` is followed one hop inside the repo, never outside. Every string
from the repo is rendered inside a code span, so a hostile server name can't
inject links or @mentions, and likely secrets in commands, URLs and hooks are
masked. Exits 0 whatever it finds — it informs, it doesn't block (1 on a git
error, 2 on a usage error).

In CI, the GitHub Action posts it as a single comment it keeps up to date
(on a fork PR, whose token is read-only, it writes to the job summary instead):

```yaml
# .github/workflows/vexryn.yml
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  agent-config-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4   # pin to a commit SHA in real use
        with:
          fetch-depth: 2            # the merge commit + the base it compares to
      - uses: OWNER/vexryn-scan@main  # not published yet — see Status
```

Not reviewed yet (honest): other agents' instruction files (`AGENTS.md`,
`GEMINI.md`, Cursor rules), slash-command files, and MCP tool lists (unknowable
without running a server).

## Test

```bash
npm test   # global configs, wire round-trip, proxy + usage + trim, Claude Code
           # context, settings, git snapshots, diff review, the Action's comment
           # script (fake gh) — all in temp dirs / a fake home (VEXRYN_HOME);
           # your real configs are never touched, nothing reaches GitHub
```

## Develop

```bash
npm install
npm run build
node dist/cli.js scan ./fixtures/sample-repo            # static (read-only)
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
