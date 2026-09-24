# Marche 2 — readable PR review of agent configs (design)

Status: approved by the founder 2026-09-24 (mock comment validated in chat).

## Goal

When a pull request touches an AI agent's config, turn the unreadable diff into
a short, exact comment: what the agent may now **do**, and what it now **loads**
every session. Non-blocking: it informs, it never prevents a merge.

## Hard constraints

- **Static only.** Never execute anything from the PR (no MCP server, no hook,
  no script). Files are read from git objects as data. Safe on any PR, fork
  included.
- **Exact facts only.** Every line is read from a file or counted with the
  tokenizer. No guessed tool lists, no invented numbers. An MCP server's tools
  can't be known without running it, so the comment states the config facts
  (command, package, pinned or not, credential *names* it receives), not "+12
  tools".
- **No secret values, ever.** Env/header *names* only.
- **No server of ours.** Delivered as a CLI command + a GitHub Action that runs
  in the user's own CI. The hosted GitHub App waits until a team pays
  (design doc "do-not-build").
- **Nothing sent** except the PR comment itself, posted with the workflow's own
  token.

## What it compares (repo files only — a PR can't change a user's home)

| Area | Files | Reported |
|---|---|---|
| MCP servers, any agent | `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json` | added / removed / changed server: launch command or URL, unpinned `npx`/`uvx` package, env + header names it receives |
| Claude Code permissions | `.claude/settings.json`, `.claude/settings.local.json` | `permissions.allow` / `ask` / `deny` rules added or removed; `defaultMode` change (noting that `auto`/`bypassPermissions` are ignored from project files); `additionalDirectories` added |
| Claude Code hooks | same files | hook added/removed: event + what runs (`command` / `url` / `mcp_tool` / `prompt`) |
| Claude Code plugins | same files | `enabledPlugins` turned on/off |
| Claude Code load | root `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/skills/**/SKILL.md`, `.claude/agents/*.md` | always-loaded tokens before → after; skills/subagents added or removed by name |

Out of scope for v1 (honest list in the comment footer when relevant):
instruction files of other agents (`AGENTS.md`, `GEMINI.md`, Cursor rules) —
their loading rules aren't verified yet; slash-command files; MCP tool lists.

## How it works

1. `vexryn diff [path] --base <ref> [--head <ref>] [--markdown]`.
   `--head` defaults to the working tree (local use: "what am I about to
   change?"); in CI the Action passes both refs.
2. For each side, list the ref's files (`git ls-tree -r`), keep only the paths
   above, and write them (`git show <ref>:<path>`) into a temp dir. Paths are
   checked to stay inside the temp dir; git symlinks are written as plain text.
   The temp dirs are deleted afterwards.
3. Run the existing static scan pieces on both dirs, repo-only
   (`--no-global` semantics): `parseServers`, `claudeCodeContext`, plus a new
   reader for Claude Code settings (permissions, hooks, plugins).
4. Diff the two snapshots and render one markdown comment (also printed as-is
   in the terminal). No agent-config change → a one-line "no change" and the
   Action posts nothing.
5. Exit code 0 unless the command itself fails (not a git repo, unknown ref).

## GitHub Action (`action.yml`, composite)

- Trigger: `pull_request` (not `pull_request_target`: the PR's files are only
  read, but we keep the safe default).
- Steps: checkout with enough history for the base ref → run `vexryn diff
  --base <base sha> --head <head sha> --markdown` → if there is a change, create
  or update **one** sticky comment (found by a hidden marker) with `gh api`.
- Fork PRs get a read-only token: fall back to the job summary
  (`$GITHUB_STEP_SUMMARY`) instead of failing.
- Permissions requested: `contents: read`, `pull-requests: write`.

## Testing

- `test/diff-check.mjs`: a temp git repo, base commit vs head commit with
  every kind of change above; asserts each line of the comment, that a secret
  env *value* never appears, that an unrelated change yields "no change", and
  that the working-tree default works.
- The Action is exercised end to end only once the repo is on GitHub
  (founder decision: publishing); until then its shell is tested by running
  the same commands locally.

## Decisions left to the founder

- Publishing: push `vexryn-scan` to GitHub, publish the `vexryn` npm package
  (the Action needs one of the two to be usable by others).
