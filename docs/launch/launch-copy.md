# Vexryn — launch copy (ready to paste)

Post everything the same day. Reply to every comment in the first few hours —
that engagement is what keeps a post on the front page. Lead with the problem,
not the tool. Be honest about limits; the audience punishes hype.

Repo: https://github.com/yl0n0ps/vexryn-scan · npm: https://www.npmjs.com/package/vexryn
Live demo review: https://github.com/yl0n0ps/vexryn-scan/pull/1

---

## Hacker News — Show HN

**Title** (80 char max, no emoji, no "revolutionary"):

> Show HN: Vexryn – see what your AI coding agent loads, and what its tools can do

**First comment** (post it yourself right after submitting):

> I kept adding MCP servers and rules to Claude Code, Cursor and Codex and lost
> track of what they actually loaded — and what those tools could do. Code
> review has no opinion on a `.mcp.json` or an `AGENTS.md`.
>
> Vexryn reads the agent configs across a repo and your machine — Claude Code,
> Cursor, VS Code/Copilot, Codex, Gemini, Windsurf, Cline, Roo, Continue, Zed,
> Kiro, OpenCode, Goose — each in its own format (JSON, TOML, YAML), and tells
> you in plain words what each agent loads and what its tools can do: send
> messages, read files, run commands, delete records. It flags the dangerous
> combinations (read the web + read your files + send them out), secrets written
> in plain text, and packages the publisher has deprecated.
>
> It's read-only and 100% local — it never runs a server and never sends
> anything. The "what a tool can do" part comes from a catalogue of popular MCP
> servers I measured once in a public GitHub Action (ephemeral VM, dummy
> credentials), so a static scan can say it without launching anything.
>
> `npx vexryn scan` in any repo. There's also `vexryn diff` for a one-comment PR
> review of a config change, and a read-only MCP mode so your own agent can ask.
>
> Honest limits: instruction-file token counts are exact only for a subset of
> agents; the catalogue covers ~40 servers today; proving a flagged risk is
> actually exploitable is the next step, not built. Apache-2.0. Feedback very
> welcome — especially whether the PR comment reads clearly.

---

## Reddit — r/programming, r/devtools, r/ExperiencedDevs, r/LocalLLaMA

**Title:**

> I built a tool that shows what your AI coding agent silently loads — and what its tools can actually do

**Body:**

> Every AI coding agent (Claude Code, Cursor, Copilot, Codex, …) loads
> instruction files and MCP servers before you type anything, and a config
> change can quietly give it new powers. Those configs are scattered across
> formats and code review ignores them.
>
> Vexryn reads them — 15 agents, each in its own format — and says in plain
> words what each loads and what its tools can do (send messages, read files,
> run commands, delete records), flags dangerous combinations, secrets in plain
> text, and deprecated packages. Read-only, 100% local, nothing is sent, nothing
> is executed.
>
> `npx vexryn scan` — https://github.com/yl0n0ps/vexryn-scan
>
> It also reviews a PR (`vexryn diff`) as a single comment — real example:
> https://github.com/yl0n0ps/vexryn-scan/pull/1
>
> It's early (v0.3, Apache-2.0). I'd love blunt feedback on whether the output
> is actually useful and whether the PR comment reads clearly.

---

## X / Twitter — thread

**1/**
> Your AI coding agent loaded a dozen tools before you typed a word.
> Do you know what they can do?
>
> `npx vexryn scan` tells you — for any agent, in one command, 100% local.
> 🧵

**2/**
> It reads Claude Code, Cursor, Copilot, Codex, Gemini, Windsurf, Cline, Roo,
> Continue, Zed, Kiro, OpenCode, Goose — each in its own config format — and says
> in plain words what each loads and what its tools can do.

**3/**
> The scary part it surfaces: an agent that can read the web, read your files,
> AND send them out. A page it reads could tell it to exfiltrate your files.
> Vexryn flags that combination. Plus secrets in plain text and deprecated
> packages.

**4/**
> On a pull request, `vexryn diff` posts one comment: "new server `slack`
> receives SLACK_BOT_TOKEN, unpinned · Claude Code may run `git push` without
> asking · +2,300 tokens every session."
>
> Real example 👇 https://github.com/yl0n0ps/vexryn-scan/pull/1

**5/**
> Read-only. 100% local. Never runs a server, never sends anything, never
> invents a number. Safe for CI and untrusted repos. Apache-2.0.
>
> ⭐ https://github.com/yl0n0ps/vexryn-scan

---

## One-liners / directories (npm keywords, Product Hunt tagline, awesome-mcp lists)

> See what your AI coding agent actually loads — and what it can do. Any repo,
> any stack, no config. 100% local.

## Submit to (free, high-signal)

- awesome-mcp-servers / awesome-claude-code lists (open a PR adding vexryn)
- Product Hunt (a slower burn; pair with the HN day)
- The MCP registry / directories
- Dev newsletters that take submissions (TLDR, Console.dev, Changelog news)
