# Vexryn everywhere — every forge, every CI, every agent

Three ways in, one engine. Everything is a static read: nothing from the repo is
executed, and the only thing ever sent is the review comment, to your own forge,
with the token you give it.

| Entry | For | Command |
|---|---|---|
| **CI comment** | GitHub, GitLab, Forgejo / Gitea (Codeberg), Bitbucket Cloud, Azure DevOps | `npx -y vexryn@0.4.0 ci` |
| **Any other CI** (Jenkins, CircleCI, Buildkite, Woodpecker, TeamCity…) | markdown, JSON, exit code | `npx -y vexryn@0.4.0 diff --base <base> --head HEAD [--strict] [--json]` |
| **Any coding agent** | a read-only MCP server | `npx -y vexryn mcp` |

## One line in your CI: `vexryn ci`

`vexryn ci` finds the pull/merge request from the CI's own variables, reviews
**only what the PR changes** (a change made on the target branch meanwhile is
never attributed to it), prints the review in the job log and keeps **one**
comment on the PR up to date. With no token it just prints the review.

- **Non-blocking by default.** Add `--strict` to fail the check while a ⚠️
  finding is open. To let one through, accept its `vx-…` id in `.vexryn.json`
  **on the base branch** (a small PR of its own): a PR can't approve itself.
- **Safe on forks and odd checkouts.** A checkout that isn't the PR's code
  (`pull_request_target`) is skipped, a history too shallow gets a message with
  the exact fix for your CI, a refused comment goes to the job log/summary.

### GitHub

```yaml
# .github/workflows/vexryn.yml
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  vexryn:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4       # pin to a commit SHA in real use
        with:
          fetch-depth: 2                # the merge commit + the base it compares to
      - uses: yl0n0ps/vexryn-scan@v0.4.0
        # with:
        #   strict: true                # fail the check on an open ⚠️ finding
```

### Forgejo / Gitea Actions (Codeberg)

Same comment API as GitHub; the automatic token is used.

```yaml
# .forgejo/workflows/vexryn.yml  (Gitea: .gitea/workflows/vexryn.yml)
on: pull_request
jobs:
  vexryn:
    runs-on: docker                     # a label your runner offers
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx -y vexryn@0.4.0 ci
        env:
          VEXRYN_TOKEN: ${{ github.token }}
```

### GitLab (gitlab.com or self-managed)

Add a **masked CI/CD variable** `VEXRYN_TOKEN`: a project access token with the
`api` scope (the job token can't write merge request notes).

```yaml
# .gitlab-ci.yml
vexryn:
  image: node:22
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GIT_DEPTH: "0"
  script:
    - npx -y vexryn@0.4.0 ci
```

### Bitbucket Cloud

Add a **secured repository variable** `VEXRYN_TOKEN`: a repository access token
that can write pull requests (Pipelines has no automatic API token).

```yaml
# bitbucket-pipelines.yml
clone:
  depth: full
pipelines:
  pull-requests:
    '**':
      - step:
          name: Vexryn agent config review
          image: node:22
          script:
            - npx -y vexryn@0.4.0 ci
```

### Azure DevOps (Azure Repos)

Run it as a **Build validation** in the target branch's policy (that's what
makes it a pull request build), and give the project's build service
*Contribute to pull requests* on the repository.

```yaml
# azure-pipelines.yml
pool:
  vmImage: ubuntu-latest
steps:
  - checkout: self
    fetchDepth: 0
  - script: npx -y vexryn@0.4.0 ci
    env:
      SYSTEM_ACCESSTOKEN: $(System.AccessToken)
```

### Any other CI

Review against the merge-base, keep the markdown, post it with your own tool —
or read the JSON:

```bash
npx -y vexryn@0.4.0 diff --base "$(git merge-base origin/main HEAD)" --head HEAD --strict > vexryn-review.md
npx -y vexryn@0.4.0 diff --base "$(git merge-base origin/main HEAD)" --head HEAD --json   # {powers, loads, changed, unreviewed, accepted, open}
npx -y vexryn@0.4.0 scan --json --no-global                                               # the full load report
```

`--json` output is stable in spirit but may still change before 1.0.

## Any coding agent: `vexryn mcp`

Three read-only tools (`agent_load_report`, `agent_config_review`,
`mcp_server_lookup`). Every client needs the same thing: command `npx`, args
`-y vexryn mcp`.

**Claude Code**

```bash
claude mcp add vexryn -- npx -y vexryn mcp
```

**Cursor, Claude Desktop, Gemini CLI, Windsurf, Kiro, Cline, Roo Code** (the `mcpServers` family —
`.cursor/mcp.json`, `.gemini/settings.json`, `.kiro/settings/mcp.json`, `.roo/mcp.json`, …)

```json
{ "mcpServers": { "vexryn": { "command": "npx", "args": ["-y", "vexryn", "mcp"] } } }
```

**VS Code / GitHub Copilot** (`.vscode/mcp.json`)

```json
{ "servers": { "vexryn": { "type": "stdio", "command": "npx", "args": ["-y", "vexryn", "mcp"] } } }
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.vexryn]
command = "npx"
args = ["-y", "vexryn", "mcp"]
```

**OpenCode** (`opencode.json`)

```json
{ "mcp": { "vexryn": { "type": "local", "command": ["npx", "-y", "vexryn", "mcp"] } } }
```

**Zed** (`settings.json`)

```json
{ "context_servers": { "vexryn": { "command": "npx", "args": ["-y", "vexryn", "mcp"] } } }
```

**Goose** (`~/.config/goose/config.yaml`)

```yaml
extensions:
  vexryn:
    type: stdio
    cmd: npx
    args: ["-y", "vexryn", "mcp"]
    enabled: true
```

## Honest limits

- The GitHub path runs on this repo's own pull requests. GitLab, Forgejo/Gitea,
  Bitbucket and Azure DevOps are built and tested against each forge's
  documented API (local mock servers in `test/ci-forges-check.mjs` and
  `test/ci-check.mjs`), not yet on a live instance of each.
- Bitbucket and Azure DevOps get a markdown-only comment (no HTML): the hidden
  marker is a markdown link definition, finding ids are plain text.
- Bitbucket Data Center / Server (self-hosted) has a different API — not
  supported yet; use the generic `vexryn diff` recipe.
