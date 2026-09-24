# Innovation mining — what to take from the repos we chose (2026-09-24)

Read-only study, decided by the founder (full list, in order). Method: ideas and
techniques are borrowed freely; code only under MIT/Apache/BSD, with provenance.
Nothing here is implemented yet — each "take" below becomes its own tested change.

## 1. Our own Rust engine — the power classifier (`crates/vexryn-runner/src/autoconfig.rs`)

**What it is.** A deterministic classifier (no model) that maps a tool's
*name + description + argument names* to one of 8 prohibited-effect classes:
`payment.transfer`, `credential.change`, `data.delete`, `file.share`,
`permission.escalate`, `schedule.create`, `memory.write`, `external-message.send`.
Its discipline is the valuable part: every class needs a **verb + a noun + an
argument-shape anchor** (e.g. "delete" alone is not enough — it needs a
`record_id`-shaped arg, because cache/session/temp cleanups "remove by id" too),
and an unmappable tool yields `None`, never a guess. Its unit tests encode the
false positives it refuses ("secretary" ≠ secret, "tokenizer" ≠ token, a bare
`id` arg ≠ record deletion, `schedule.fire` ≠ `schedule.create`).

**The honest catch.** It needs the tool list. A static config file (`.mcp.json`)
holds only a *launch command* — `npx -y @modelcontextprotocol/server-slack` —
not the tools. So "+12 tools, can send email" **cannot come from the PR diff
alone** without executing the server, which we refuse to do on a PR.

**What that implies (the real innovation).** The classifier becomes useful
statically only through a **measured catalogue**: run `--deep` once, on a
trusted machine, for a given package@version → record its real tool list and
the powers the classifier assigns → the PR review then says, from the config
text alone, "`@modelcontextprotocol/server-slack@2026.1.0`: 8 tools, can send
messages to external recipients, receives `SLACK_BOT_TOKEN`". That catalogue is
exactly the *open feed* the design doc plans — and it is what turns the static
review from "a server was added" into "these powers were added". Filled only
from measurements, never by hand (our earlier invented catalogue is the
cautionary tale).

**Take (IDEA, our own code):**
1. Port the classifier to TypeScript with the same discipline, but as a
   *power taxonomy* rather than a security-twin selector: keep the 8 classes,
   add the everyday ones a developer reads at a glance — read files, write
   files, run shell commands, network access — each with verb + noun + arg
   anchor and a refusal list as tests.
2. Apply it wherever we *do* have tools: `scan --deep` (local, opt-in) and the
   `agent_load_report` MCP tool when measurements exist; show "powers" next to
   token cost.
3. Start the measured catalogue as a local file written by `--deep`
   (package@version → tools + powers + tokens), reused by `diff` when the PR's
   server matches a measured entry, and marked *measured on <date>*.

## 2. MCP security scanners (mcp-scan → Snyk, Ramparts, Cisco mcp-scanner)

All three are **Apache-2.0** (LICENSE files read); rule data may be copied with
attribution (NOTICE). **None reviews a PR from config text alone**: each gets
tool descriptions by launching stdio servers or connecting to remote ones.

- **mcp-scan** is now [snyk/agent-scan](https://github.com/snyk/agent-scan) — see §3.
  Its `verify_api.py` does no local analysis: everything is POSTed to Snyk.
- **[Ramparts](https://github.com/highflame-ai/ramparts)** (moved from
  getjavelin; ~96 stars; Rust). The interesting part is **static YARA rules**
  (`rules/pre/*.yar`, ~40 rules): `mcp_config_risk.yar` (command is a
  shell/interpreter + args with `-c`/`-e`, `curl|wget|base64|nc`, `| sh`,
  `&&`), `secrets_leakage.yar` (AKIA…, `ghp_`…, bearer tokens, PEM headers,
  SSH paths, key-file extensions, named env vars with placeholders excluded),
  `cross_origin_escalation.yar` (mixed hosts/ports/schemes, `?url=`/`&redirect=`),
  plus injection / credential-harvesting / system-manipulation rules for
  skills. Before matching it strips zero-width chars, folds homoglyphs (NFKC),
  decodes base64/hex. Structural checks: overbroad `allowed-tools`, sensitive
  `@<path>` references, skill-name collisions, embedded blobs, unsafe YAML
  tags, prototype pollution. **Drift fingerprints** (`MCPConfigChanged`,
  `MCPToolChanged`, `SkillContentChanged`) against a local baseline. Also:
  OSV.dev CVE lookups (network) and an optional LLM (OpenAI by default).
  Some malware rules are "adapted from NVIDIA SkillSpector" — that license is
  unverified; don't copy those.
- **[Cisco mcp-scanner](https://github.com/cisco-ai-defense/mcp-scanner)**
  (~1.1k stars; Python). YARA rules for code execution, coercive/prompt
  injection, command injection, credential harvesting, data exfiltration,
  script/SQL injection, system manipulation, **tool poisoning** (18 patterns
  for hidden side behaviours: "also collects", "additionally sends",
  undisclosed third-party sharing, indexing of tokens). A key-free "Prompt
  Defense" regex layer (12 attack categories). An **offline `static` mode**
  reads a pre-exported `{"tools":[…]}` JSON — the same shape our `--deep`
  measures. Optional LLM / Cisco cloud / VirusTotal / CVE analyzers need keys.

**Take, ranked by value for the static PR review (IDEA = reimplement;
RULE = copy regexes, Apache-2.0, attributed):**
1. RULE — literal secret in a config value (`env`/`headers`/`args`/URL query):
   prefixed shapes only (`AKIA…`, `ghp_…`, `sk-…`, PEM header, `Bearer …`);
   no entropy checks (noisy). We mask these today; flag them.
2. RULE — shell/interpreter launched with inline code or a pipe to shell in a
   *server command* (Ramparts `mcp_config_risk.yar`); we already do it for hooks.
3. IDEA — hidden/invisible characters in any agent-loaded text: zero-width
   U+200B–200F/2060/FEFF, bidi U+202A–202E/2066–2069, Unicode tags
   U+E0000–E007F. Exact; near-zero false positives.
4. RULE — instruction-override / hidden-instruction phrases in *added* text
   ("ignore previous instructions", "do not tell the user", "also sends…"),
   reported as *"contains the phrase"*, never "is malicious" (security docs
   quote them). Cisco `tool_poisoning.yara` + Ramparts skill rules.
5. IDEA — sensitive paths handed to servers or referenced in text
   (`~/.ssh`, `.aws/credentials`, `.env`, `*.pem`, a filesystem server rooted
   at `/`).
6. IDEA — name collision / shadowing across scopes or configs.
7. IDEA — plain `http://` to a non-localhost remote; `?url=`/`&redirect=` params.
8. IDEA — embedded base64/hex blobs > ~200 chars in args or text.
9. IDEA — for `--deep` only: a local **lockfile** (server, tool, sha256 of
   description + schema) gives rug-pull detection with no remote service
   (Ramparts' drift, done locally); re-run 3–5 over live descriptions there.

**Deliberately not copied:** any LLM judge (probabilistic — conflicts with
exact facts), any remote analysis API, OSV/VirusTotal network lookups on the
PR path (a network call from CI on a PR is a side effect we don't want yet).

## 3. Snyk Agent Scan (= the former Invariant Labs `mcp-scan`, acquired)

Sources: [snyk/agent-scan](https://github.com/snyk/agent-scan) (CLI, **Apache-2.0**,
"Copyright 2025 Invariant Labs AG"), [docs/risks.md](https://github.com/snyk/agent-scan/blob/main/docs/risks.md),
[docs/scanning.md](https://github.com/snyk/agent-scan/blob/main/docs/scanning.md),
[docs/cli-reference.md](https://github.com/snyk/agent-scan/blob/main/docs/cli-reference.md).
The CLI is open; the **analysis runs on Snyk's API** (closed) and needs a
`SNYK_TOKEN`. "Agent Guard" installs session-start hooks into Claude Code /
Cursor / Codex / Copilot that report the machine's servers and skills to Snyk.

**Our four market-study claims, verified: all TRUE.** (a) It scans a machine's
*state*, no diff/PR concept (`--ci` = exit code only, no Action, no comment).
(b) It *launches* stdio servers to read tools — CI requires the flag
`--dangerously-run-mcp-servers`, which says it all. (c) Tool descriptions,
configs (secrets redacted first) and skill text are sent to Snyk's API; no
fully local analysis. (d) Findings are scored "risk indicators" from content
classification; nothing is proven.

**What it checks (all by server-side content analysis, none by config rule):**
MCP servers — prompt injection in tool descriptions (tool poisoning), untrusted
content exposure, private-data access, destructive capabilities, cross-server
"toxic flows" (untrusted content + private data + an outbound channel).
Skills (`SKILL.md`) — injection in instructions, suspicious download URLs,
malicious code, insecure credential handling, hardcoded secrets, direct money
access, third-party content exposure, unverifiable runtime dependencies,
system-service modification, missing SKILL.md. Hidden/bidi Unicode existed in
v0.5. Covers 14 agent apps' MCP configs and skills.

**What it does NOT cover — and that is our marche 2, line by line:** the PR
diff itself; unpinned packages; `http://` remotes; Claude Code `settings.json`
permissions and hooks; `CLAUDE.md`, `.cursorrules`, `AGENTS.md` text; secrets
in MCP `env`/`headers` (only redacted on upload, never flagged).

**Do NOT copy (we already comply):** launching servers from a checked-out PR
(code execution on CI from a hostile `.mcp.json`); shipping customer config
or skill text to a hosted classifier; hooks that report at every session.

**Take (all IDEA, deterministic, from config text only):**
1. **Hardcoded secret literal** in a server's `env`/`headers` → "set to a
   literal token (`ghp_…`, redacted); use `${GITHUB_TOKEN}` instead".
2. **Hidden text in instruction files and skills**: zero-width / bidi Unicode,
   HTML comments carrying instructions → "CLAUDE.md adds characters a reviewer
   cannot see". Exact, no judgement call.
3. **`curl … | sh` / instructions fetched from a URL at runtime** in skills,
   hooks and server commands → the pattern is textual, we already flag it in
   hooks.
4. **Stable risk ids + an ignore list**, and operational failures (parse error,
   unknown format) kept separate from findings — we already separate
   "unreadable" from findings; add ids when the rule set grows.
5. **Toxic-flow combination** — only once the measured catalogue (§1) tells us
   which servers read untrusted content / private data / send outbound. Not
   before: guessing from a package name would be an overclaim.

## 4. MCP context managers (mcpm, mcp-router, mcp-context-manager, 1mcp, MetaMCP)

Verified against the GitHub API (stars, activity, LICENSE); qualitative details
from READMEs (untrusted, marked where unverified).

| Tool | Stars / activity | License | What it really is |
|---|---|---|---|
| [mcpm.sh](https://github.com/pathintegral-institute/mcpm.sh) | ~1,000 · 2026-08 | MIT | Package manager + "virtual profiles"; imports/writes 9+ clients' configs (clobber risk); `mcpm usage` = call counts, no token measurement found |
| [mcp-router](https://github.com/mcp-router/mcp-router) | ~2,100 · **archived 2026-09-18** | "Sustainable Use License" — source-available, **not** reusable | Desktop app, workspaces, per-server *and per-tool* on/off; the classic on/off switch. Dead upstream now |
| [mcp-context-manager](https://github.com/Lucface/mcp-context-manager) | 2 · toy | MIT | Despite the name: a discovery/metadata helper; its README admits it does **not** change token usage — the "save 90%" claim is unmeasured |
| [1mcp](https://github.com/1mcp-app/agent) | ~500 · very active | Apache-2.0 | Aggregation proxy with opt-in **lazy loading** (`instructions → inspect → run`), project-level `.1mcprc` |
| [MetaMCP](https://github.com/metatool-ai/metamcp) | ~2,700 · 2026-06 | MIT | Self-hosted middleware proxy (Docker, web dashboard), namespaces, per-tool filtering, SSO |

**None of the five measures token cost, and none reviews a PR.** They toggle,
route or aggregate. That confirms the design doc: our edge is the *measured*
report + real usage + the PR path, not "multi-client support" (mcpm already
covers 9 clients) and not a switch.

**Honest "where they beat us":** they *act* (switch servers/tools off live,
via profiles or a proxy); we measure and suggest. A user who wants less context
*right now* gets it faster from them. 1mcp's lazy loading structurally prevents
bloat for clients that lack it — but Claude Code now defers tool schemas
natively (tool search), so "save tokens for the model" is being absorbed by the
platforms, exactly as the design doc warned. Not our fight.

**Market signal:** the best-known pure switch (mcp-router, 2,100 stars) was
archived this month. Switch-only tooling didn't sustain a project.

**Take (all IDEA — reimplement; no code needed):**
1. **Per-tool trim, not only per-server.** A server's tool list is where the
   bloat lives; `trim` should say "keep `github`, but 31 of its 46 tools were
   never used" — we already have per-tool usage from `wrap`, so this is cheap.
2. **Profiles as the unit of a decision** ("this set for coding, that set for
   ops"), written as a *suggested* config under `.vexryn/suggested/`, never
   applied by us — consistent with read-only.
3. **A one-shot import/normalize view** of every client's config (mcpm's
   `client import`) is what our `scan` already is; keep it that way — no
   writing into clients' files.

Explicitly **not** taken: a GUI/dashboard, a hosted proxy, live toggling — each
is a server or a write into the user's configs, both ruled out for now.

## 5. What this changes, and the decision for the founder

**Confirmed, with sources:** nobody reviews the PR; nobody counts what an
agent loads; Snyk executes servers and ships text to its API; the best-known
"switch" was archived this month. Our three edges from the design doc — the
PR diff, static-only, 100 % local — are real gaps, not a story.

**One strategic correction (§1):** "+12 tools, can send email" is impossible
from a PR diff without a **measured catalogue**. That catalogue is the open
feed the design doc already planned; it is now the brick that gives the PR
review its punch, so it moves up the roadmap.

**Proposed order — three waves, each a tested change, nothing hosted, nothing
sent, no new dependency, no LLM judge:**

- **Wave A — static rules in `diff` (and `scan`).** Literal secrets, shell
  pipes in server commands, hidden Unicode, override phrases, sensitive paths,
  name shadowing, `http://` remotes, blobs. Also extends the review to skill
  bodies and other agents' rule files for the text rules (still no load
  counts for them — honest). Fast, high value per line, exact.
- **Wave B — powers where we have tools (`--deep`, MCP tool).** Port the
  classifier to TypeScript as a power taxonomy (8 classes + read/write files,
  shell, network); show powers next to tokens; **per-tool trim**; the local
  drift lockfile.
- **Wave C — the measured catalogue.** `--deep` records package@version →
  tools, powers, tokens, date; `diff` uses it → "adds 8 tools, can send
  messages to external recipients". Needs a founder decision on *who measures
  what* (which popular servers, on which trusted machine) and, at
  publication time, whether the catalogue is shared/open (OSV-like format).

**Not doing:** GUI, hosted proxy, live toggling, session-reporting hooks,
remote classifiers.
