# Vexryn for teams — design

**Date:** 2026-10-09 · **Status:** approved by the founder in conversation (sections 1–8), written form for review · **Supersedes:** the "trending" ambition of `docs/launch/`.

## 1. Purpose

Vexryn's ambition changes: the company's goal is to be **acquired within about 12 months** by a security vendor. Everything in this document serves that goal. The product is designed so that a buyer finds, on day one of due diligence, the three things buyers pay for: users it does not have, a brick missing from its own roadmap, and a clean asset (code, data, licence).

**Success in 12 months** (the numbers a buyer asks for):

- Companies using Vexryn for teams, with named pilots: ≥ 10, of which ≥ 3 paying.
- Developers covered (CI + laptops): ≥ 2,000.
- Agent-config changes reviewed per month: ≥ 5,000, with blocks and accepted exceptions visible.
- Catalogue coverage: ≥ 500 MCP servers measured without execution (today 41).
- Vexryn results visible *inside* at least two acquirer products (GitHub code scanning alerts, GitLab).
- Zero legal/IP debt: Apache-2.0 CLI, our own code, catalogue measured by our own public workflow.

## 2. Positioning, buyers, competitors

**One sentence.** No AI coding agent gains a power in your company without it being seen, checked against your rules, and traced.

**Who buys:** the application-security lead or the internal developer-platform team. **Who uses:** developers, in their pull requests, with nothing to install; the security team, in a dashboard where it sets rules and reads the trace.

**The wedge is the moment of change, not the snapshot.** The "inventory of AI agents on developer machines" space is already taken: Snyk Evo (org inventory, allowed list, dashboard — built on the Invariant Labs acquisition of June 2025), Wiz (an endpoint sensor on developer workstations), Cisco (DefenseClaw, AI BOM), Checkmarx (AI-BOM), OX Security (Agent AI BOM). Nobody reviews **the change** — a PR that adds an MCP server or widens a permission — across GitHub, GitLab, Bitbucket, Azure DevOps and Forgejo/Gitea, against company rules, with a blocking check and a traced exception. GitLab and GitHub govern only their *own* agents.

**Three differences a buyer cannot easily copy:**

1. **Nothing is executed, anywhere.** Snyk's scanner launches each MCP server to read it (its CI flag is literally `--dangerously-run-mcp-servers`). Vexryn knows what a tool can do from its catalogue, measured once in our public workflow. Safe to run on every laptop and in every CI.
2. **Breadth.** Fifteen agents, each in its own format, repo and user-wide; five forges.
3. **Exact rules, no AI judge.** Every finding is a fact (a secret in a file, an unpinned package, a dangerous combination of powers), with a stable id that can be accepted and traced.

**Target acquirers (lack this layer today):** GitLab, GitHub, Socket (scans agent skills; bought Coana in 2025), Datadog, Semgrep, Sonar, Aikido, JFrog, Mend. Wiz and Snyk remain possible buyers for the PR layer.

## 3. Scope

**v1 — months 1–3 ("the cloud and the rules")**

- Vexryn Cloud: organisations, members, org tokens, review events, rules, exceptions, timeline, inventory derived from events, CSV export.
- `vexryn ci` posts its review to the cloud when `VEXRYN_ORG_TOKEN` is set, fetches the org's rules, blocks on a rule hit, and links to "ask for an exception".
- Rules compatible with GitHub's enterprise MCP allow/deny lists, plus powers, combinations and requirements.
- `vexryn ci --sarif <file>`: findings as SARIF 2.1.0 for GitHub code scanning (and any SARIF consumer).
- `vexryn rules import <copilot/managed-settings.json>`: imports GitHub's allow/deny lists.
- Catalogue: 200 servers, weekly automated measurement.

**v2 — months 4–6 ("the laptops and the money")**

- `vexryn report`: a one-shot inventory of this machine sent to the cloud; `vexryn report --install` schedules it daily (launchd/cron/Task Scheduler), no resident daemon.
- Team plan with billing (Stripe); free up to 5 developers.
- Webhook on every block or exception (Slack, SIEM).
- Catalogue: 500 servers; "measure this server" request from the dashboard, run in our public workflow.

**Later (not in the first year):** self-hosted edition, SSO, SCIM, a public read-only catalogue API.

v1 is too large for one implementation plan; it is built as four plans, in this order, each shippable on its own: (1) cloud core — organisations, tokens, review events, timeline, CSV; (2) rules engine + `ci` posting/fetching/blocking + exceptions; (3) SARIF export + GitHub allow-list import; (4) dashboard pages beyond the timeline, and catalogue scaling to 200.

## 4. User journeys

**A developer opens a PR that adds an MCP server.** `vexryn ci` runs (GitHub Action or one line in any CI). It reviews only what the PR changes, fetches the org's rules, and posts one comment: what the agent may now do, which rule is hit, and the outcome. If a rule blocks, the check fails and the comment ends with a link: *ask for an exception*. The link opens the dashboard with the finding pre-filled (id, rule, repo, PR); the developer writes a reason. An approver (a member with the *approver* role) approves or refuses in the dashboard. The CI re-runs (or the next push) and passes. The acceptance is recorded: who asked, who approved, why, when, where, which finding id.

**A developer's laptop config violates a rule.** `vexryn scan` (free, local) shows the rule hit under the server as a ⚠ line when `~/.vexryn/config.json` holds an org token: `scan` then *downloads* the organisation's rules and nothing else; it never uploads anything. With `vexryn report` installed, the daily inventory reaches the cloud and the violation appears in the timeline and inventory.

**A security engineer evaluates Vexryn.** Signs in with GitHub (or an email magic link), creates an organisation, copies the org token into CI secrets, imports the company's GitHub MCP allow list, and sees the first reviews arrive. Free up to 5 developers, so no procurement is needed to try.

**An auditor asks "who allowed agent X to send messages?"** The timeline answers: the PR, the finding, the approver, the reason, the date. CSV export of the period.

## 5. Architecture

Three bricks. The first exists.

```
 developer laptop / CI runner                      Vexryn Cloud (EU)                 browser
 ┌──────────────────────────────┐    HTTPS, JSON    ┌──────────────────────────┐     ┌──────────────┐
 │ vexryn CLI (Apache-2.0)      │ ───────────────▶  │ API  (Node 22, TypeScript)│ ◀── │ dashboard    │
 │  scan · diff · ci · report   │  review events,   │ Postgres (managed, EU)    │     │ (server-     │
 │  reads 15 agents' configs    │  inventory events │ rules · events · accepts  │     │  rendered    │
 │  never executes anything     │ ◀───────────────  │ members · tokens · audit  │     │  HTML)       │
 └──────────────────────────────┘  rules, catalogue └──────────────────────────┘     └──────────────┘
```

**The CLI** stays the open-source engine, unchanged in spirit: static read, never executes repo content, never sends anything unless an org token is present. New commands/flags: `ci` posts and fetches rules; `report` sends an inventory; `rules import`; `--sarif`.

**The cloud API** is one small Node 22 / TypeScript service (same language as the CLI, so the review and catalogue code is shared as a library), with a managed Postgres in an EU region. Server-rendered HTML for the dashboard with a little vanilla JavaScript — no front-end framework (the CLI already renders a branded HTML report; the same tokens and palette are reused). One deployable unit; hosting provider chosen in the plan (EU region is a requirement: the founder's market is European and data residency is a selling point).

**Data flow and minimisation (a contract, enforced by tests):** the CLI sends *facts* only.

| Sent | Never sent |
|---|---|
| server name, package, version, ecosystem, transport, `fromRelPath`, scope | code, file contents, diffs |
| the *names* of env vars/headers a server receives | env/header *values*, any secret, any token |
| powers (`file.read`, `send.external`…), combination ids, finding ids and their plain-words text (already redacted by `review.ts`) | tool descriptions (never relayed, as today in MCP mode) |
| agent client, counts, token totals | conversation content, prompts |
| repo slug, PR number, head/base sha, forge, CI run URL | repository contents, branch contents |
| for `report`: a stable device id (hash of hostname + user), git user email, OS | file system listing beyond config paths |

Tests assert the event schema is closed (unknown keys rejected server-side) and that the client never serialises `env`, `headers` values, `description`, or file bodies.

**Identity.** Sign-in: GitHub OAuth and email magic link. Roles per organisation: *admin* (rules, members, tokens), *approver* (exceptions), *viewer*. Org tokens: random, shown once, stored hashed, scoped to one organisation, revocable; a token is for machines (CI, `report`), never for the dashboard.

## 6. Rules

Rules are one JSON document per organisation, edited in the dashboard, versioned (every change is an audit event), fetched by the CLI with the org token. Vocabulary compatible with GitHub's enterprise managed settings, extended:

```jsonc
{
  "allowedMcpServers": [ { "name": "github" }, { "command": "npx -y @modelcontextprotocol/server-filesystem" }, { "url": "https://mcp.internal.example.com/*" } ],
  "deniedMcpServers":  [ { "name": "shell" } ],
  "deniedPowers": [ "shell.exec" ],
  "deniedCombinations": [ "web+files+send" ],
  "require": { "pinnedVersions": "block", "noLiteralSecrets": "block", "noDeprecated": "warn", "knownInCatalog": "warn" },
  "exceptions": [ { "repo": "acme/data-pipeline", "allow": [ { "name": "shell" } ], "reason": "sandboxed runner", "by": "ana@acme.com", "until": "2027-03-31" } ]
}
```

Semantics (same as GitHub's where they overlap): a deny entry wins over an allow entry; when `allowedMcpServers` is non-empty, any server matching none of its entries is *not allowed*; matchers are by `name`, `command` (prefix match on the launch command, args joined) or `url` (glob on the URL). Each `require` value is `"block"`, `"warn"` or `"off"`. Outcomes per finding: **block** (CI exit 1, comment names the rule), **warn** (comment only), **allow**. An accepted exception (section 7) turns a block into *accepted* for that finding id in that repo.

Without an org token, `vexryn ci` behaves exactly as today (no rules, non-blocking unless `--strict`). A local `.vexryn.json` keeps working for accepted findings without the cloud.

## 7. Exceptions and the audit trail

An **exception** is the acceptance of one finding id in one repository (or org-wide, admins only), with a reason, a requester, an approver, timestamps, and an optional expiry. Requests come from the link in the PR comment or from the dashboard; approval needs the *approver* role; the requester cannot approve their own request. Every rule change, token creation/revocation, membership change and exception decision is an **audit event** (actor, action, before/after, time), listed in the dashboard and exported with the CSV.

The existing local mechanism (`.vexryn.json` read from the base branch) remains the offline form; when an org token is present, cloud exceptions are merged with the local file (either accepts), and the review comment says which one applied.

## 8. The catalogue

The catalogue is what lets Vexryn say what a tool can do without executing it, so its coverage is the product's reach. Today: 41 servers, 543 tools, measured by the public GitHub Actions workflow on an ephemeral VM with dummy credentials. The official MCP registry listed about 18,800 entries in July 2026, but usage is concentrated: a few hundred packages account for most installs (Playwright MCP alone: ~23.7 M npm downloads in August 2026). Targets: 200 servers by month 3, 500 by month 6, chosen by npm/PyPI download counts and the official registry, re-measured weekly.

**Unknown servers** are reported as such (`knownInCatalog` rule: warn or block). From the dashboard, a member can request **"measure this server"**: the cloud queues a `workflow_dispatch` of the measurement workflow with the package spec; the result lands in `catalog/catalog.json` by the usual review and is served to CLIs. Measurement never runs on a customer machine.

The CLI ships a catalogue snapshot (as today). With an org token it fetches the latest catalogue from the cloud at the start of `ci`/`report`; `scan` keeps using the shipped snapshot unless `--catalog-refresh` is passed (nothing downloaded by default, as promised today).

## 9. Integrations that put Vexryn inside acquirer products

- **SARIF export** (`vexryn ci --sarif vexryn.sarif`, `vexryn diff --sarif`): each finding becomes a SARIF result (rule id = finding kind, message = the plain-words line, location = the agent config file). Uploaded to GitHub code scanning by the Action (`github/codeql-action/upload-sarif`), so findings appear as native alerts; usable by GitLab and any SARIF consumer.
- **GitHub allow-list import** (`vexryn rules import` and in the dashboard): reads `allowedMcpServers` / `deniedMcpServers` from `copilot/managed-settings.json`.
- **Webhooks** (v2): one HTTP POST per block or exception decision, with the event JSON, for Slack and SIEMs.

## 10. Dashboard

Pages, server-rendered, brand palette of `docs/design-system.md`:

1. **Timeline** — every reviewed change: repo, PR, agent, what changed in powers, rule outcome, link to the forge. Filters by repo, outcome, period.
2. **Inventory** — derived from the latest event per repo and per device: servers × agents × where; powers; risks; "unknown in catalogue". Who declared it (last change's author).
3. **Rules** — the JSON document with a form for the common cases (allow/deny a server, deny a power, requirements) and a raw editor; version history.
4. **Exceptions** — pending requests (approve/refuse with a note), active and expired exceptions.
5. **Audit** — the audit events; **Export** CSV (timeline, inventory, exceptions, audit) for a period.
6. **Settings** — members and roles, org tokens, webhook URL, billing (v2), data deletion.

## 11. Security and privacy of the cloud

- HTTPS only; org tokens hashed (SHA-256 with per-token salt); sessions as secure cookies; CSRF tokens on forms.
- Event schemas are closed; oversize payloads rejected; per-token rate limits.
- EU hosting; no third-party analytics or trackers; data retention 13 months, deletion of an organisation on request within 30 days.
- A public **security page** and **data policy** (what is sent, what is never sent, where it lives) by month 7 — buyers ask for them.
- The cloud never receives a secret value, a tool description, a file body or code. This is the promise that distinguishes Vexryn and it is tested, not asserted.

## 12. Business model

- **Free, forever:** the CLI (Apache-2.0) and the cloud up to 5 developers per organisation.
- **Team:** about €19 per developer per month (below Snyk's and Socket's $25), billed monthly or yearly, self-serve with Stripe (v2). "Developer" = a distinct author of a reviewed change or a reported device in the last 90 days.
- **Enterprise:** on quote, for SSO, audit export SLAs and, later, self-hosting.
- Revenue is a signal, not the goal: the goal is named pilots and usage. Prices are confirmed with the first three pilots.

## 13. Non-goals (first year)

No runtime gateway or proxy at org scale; no resident endpoint sensor; no AI/LLM judgement of risk; no self-hosted edition; no SSO/SCIM; no inventory of models and datasets (Checkmarx's ground); no mobile app; no ingestion of tool descriptions or code — ever.

## 14. Twelve-month roadmap and acquisition signals

| Months | Build | Market |
|---|---|---|
| 1–3 | Cloud v1 (events, rules, exceptions, timeline, inventory, CSV), `ci` posting + rules, SARIF, GitHub import, catalogue 200 | Launch (existing kit), 3 pilots from the launch and the founder's network |
| 4–6 | `report` + daily schedule, Team plan + Stripe, webhooks, catalogue 500, measure-on-request | 10 pilots, first paying teams |
| 7–9 | Security page, data policy, hardening, case studies in the dashboard | Public testimonials; warm introductions to corporate development at GitLab, GitHub, Socket, Datadog, Semgrep, Aikido |
| 10–12 | Polish, scale, due-diligence package (architecture, tests, data policy, metrics) | Conversations with proof: companies, developers covered, changes reviewed and blocked |

**Signals tracked monthly** (one page in the dashboard, admin-only, and in the due-diligence package): organisations, developers covered, changes reviewed, blocks, exceptions, catalogue coverage, forges in use, SARIF uploads.

## 15. Testing

Same style as today (`node:assert` suites, temp dirs, a fake home, nothing reaching a real forge or the real cloud):

- **Contract tests** for the event schemas: a serialised review/inventory never contains env or header values, descriptions, or file bodies (property-style over the fixtures).
- **Rules engine**: a table of rule documents × findings → outcomes; GitHub semantics (deny wins, allow-list intersection) pinned with the examples from GitHub's docs.
- **API**: each endpoint against a local Postgres in CI; auth, roles, token scoping, closed schemas, rate limits.
- **CLI ↔ cloud**: `vexryn ci` against a mock cloud (as `ci-forges-check` mocks the forges): posting, rule fetch, block, exception applied, SARIF file valid against the SARIF 2.1.0 schema.
- **Dashboard**: server-rendered pages checked for content and for escaping of every string that comes from a repo (hostile server names).

## 16. Decisions still owned by the founder

1. The legal entity and bank account for Stripe billing (needed in month 4).
2. The product domain (e.g. `app.vexryn.…`) and the EU hosting provider's account.
3. Which three companies to approach first as pilots.

## 17. Sources

- Snyk × Invariant Labs: https://securitybrief.co.uk/story/snyk-acquires-invariant-labs-to-boost-ai-native-app-security · Snyk Agent Security / Evo: https://docs.snyk.io/agent-security · Snyk agent-scan README (execution, consent, `--dangerously-run-mcp-servers`): https://github.com/snyk/agent-scan
- 2026 acquisitions in agent security: https://pipelab.org/blog/ai-agent-security-acquisition-wave-2026/ · https://securityweek.com/cybersecurity-ma-roundup-39-deals-announced-in-september-2026
- Wiz Sensor for Developer Workstations: https://www.wiz.io/blog/introducing-the-wiz-sensor-for-developer-workstations · Cisco DefenseClaw: https://newsroom.cisco.com/c/r/newsroom/en/us/a/y2026/m03/cisco-reimagines-security-for-the-agentic-workforce.html · Checkmarx AI-BOM: https://checkmarx.com/ai-bom/ · OX Agent AI BOM: https://docs.ox.security/vibesec/agent-ai-bom
- GitHub enterprise MCP allow lists: https://github.blog/changelog/2026-08-06-mcp-allowlists-in-enterprise-managed-settings/ · https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-enterprise-allowlist · SARIF upload: https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github
- GitLab agent governance: https://about.gitlab.com/blog/govern-agentic-ai-mcps-code-assistants/
- Socket (skills, Coana): https://socket.dev/blog/socket-brings-supply-chain-security-to-skills · https://socket.dev/blog/socket-acquires-coana-reachability-analysis
- CISO guidance: https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-agent-governance-framework-gap-20260403/ · https://www.microsoft.com/insidetrack/blog/protecting-ai-conversations-at-microsoft-with-model-context-protocol-security-and-governance/ · Gartner guardian agents (summary): https://www.opsinsecurity.com/blog/gartner-market-guide-guardian-agents
- Pricing: https://socket.dev/pricing · https://dev.to/rahulxsingh/snyk-pricing-in-2026-free-plan-team-business-and-enterprise-costs-breakdown-5e88
- MCP registry size and downloads: https://mcpqueen.com/reports/state-of-mcp-2026-07 · https://dev.to/grahamduescn/mcp-in-2026-the-numbers-behind-the-ecosystem-explosion-2b8e
