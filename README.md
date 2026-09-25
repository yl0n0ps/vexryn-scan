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

Early release — [`vexryn` on npm](https://www.npmjs.com/package/vexryn) (0.1.0). What's real today:

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
- **Powers (`--deep`, exact):** from a server's real tool list, Vexryn says in
  plain words what its tools can do — *can: send messages to external
  recipients, read files, run shell commands* — with a deterministic
  classifier (a verb, a noun and an argument shape must agree; unsure = not
  listed). Never from a package name alone.
- **Remembered measurements + drift:** `--deep` results are kept locally
  (`~/.vexryn/measured.json`); the static `scan`, the MCP tool and `trim` then
  show real, dated figures without launching anything, and the next `--deep`
  says what changed: *+1 tool since 2026-09-25: `delete_record` · 1 tool
  changed its description or schema*.
- **HTML report (`--html`):** writes a shareable `.vexryn/report.html`.

- **Real usage (`vexryn wrap`, agnostic):** a transparent MCP proxy. Route a
  server through it and Vexryn counts the tool calls the agent actually makes —
  any agent, any server, precise, local. `vexryn scan` then shows *"you used 2
  of 5 tools"*. See it with `vexryn usage`.

- **Auto-wiring (`vexryn wire` / `unwire`):** routes a repo's stdio servers
  through the proxy, reversible, with a backup.
- **Trim (`vexryn trim [--write]`):** uses real usage to suggest what to cut and
  writes a lean config under `.vexryn/suggested/` (originals untouched). With a
  measurement it goes per tool: *keep `github` — 12 of 46 tools used; never
  used (34): …*.

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
- **Usage per launch command** — `wrap` records calls under the server *name*
  the agent uses, not its launch command, so a name reused for a different
  server in another repo mixes their counts in `trim`.
- **Powers in the PR review** — the diff only holds a launch command, so
  "adds 8 tools, can send messages" needs a measured catalogue
  (package@version → tools). Not before it exists.

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

**Exact rules, no AI judge.** On a server the change adds or modifies, the
review states: a credential written in the file (named, never shown — use
`${VAR}`), a shell launched with inline code or a pipe, a whole filesystem or
home or a credential path handed to it, plain `http://` to a remote host, a
credential inside its command or URL, a long encoded argument; and a server
name now defined in two files with different commands. On any agent file the
change adds text to — including ones not reviewed for load, like `AGENTS.md`
or Cursor rules — it counts invisible characters (zero-width, bidi, tag) and
quotes phrases such as "ignore previous instructions" or "do not tell the
user", reported as *contains the phrase*, never as malicious. An issue already
present and unchanged is never repeated. `vexryn scan` shows the same server
facts under each server.

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
      - uses: yl0n0ps/vexryn-scan@main  # pin to a commit SHA in real use
```

Not reviewed yet (honest): other agents' instruction files (`AGENTS.md`,
`GEMINI.md`, Cursor rules), slash-command files, and MCP tool lists (unknowable
without running a server).

## Use it from your agent (`vexryn mcp`)

The same two things, as MCP tools your own agent can call mid-conversation
("what do you load?", "review my agent-config change"): `agent_load_report`
and `agent_config_review`. Works with any MCP client (Claude Code, Cursor,
Windsurf, Gemini CLI…).

```json
{ "mcpServers": { "vexryn": { "command": "npx", "args": ["-y", "vexryn", "mcp"] } } }
```

(From a checkout instead: `"command": "node", "args": ["<path>/vexryn-scan/dist/cli.js", "mcp"]`.)

**Read-only by construction.** Nothing that edits a config (`wire`,
`trim --write`), sits in a server's path (`wrap`) or launches servers
(`--deep`) is exposed: an agent must never be able to widen its own powers
through Vexryn — that's the exact blind spot Vexryn exists to show. Paths are
confined to the directory the agent started Vexryn in. Secrets are masked as in
`vexryn diff`. Honest note: this adds two tool names to your agent's context
(Claude Code defers their schemas; other clients load them) — a small,
deliberate cost.

## Test

```bash
npm test   # global configs, wire round-trip, proxy + usage + trim, Claude Code
           # context, settings, git snapshots, diff review, the Action's comment
           # script (fake gh), power classifier, remembered measurements + drift,
           # per-tool trim — all in temp dirs / a fake home (VEXRYN_HOME);
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
