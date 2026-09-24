// Compare two snapshots of a repo's agent configs and render the PR comment:
// what the agent may now DO (MCP servers, Claude Code permissions, hooks,
// plugins) and what it now LOADS every session (Claude Code context).
// Exact facts only: every changed agent file is named, even when no field this
// review reads changed. Every string that came from the repo goes through
// `code()`, which masks secrets and keeps markdown, links and @mentions inert.

import path from "node:path";
import type { ContextItem, McpServer } from "../types.js";
import { discoverConfigs } from "../scan/discover.js";
import { parseServers, readJsonLoose } from "../scan/parse.js";
import { claudeCodeContext } from "../scan/claude.js";
import { readClaudeSettings, type ClaudeSettings, type Hook } from "../scan/settings.js";
import { promises as fs } from "node:fs";
import { gitRoot, isAgentConfigPath, resolveRef, snapshot, type Side } from "./snapshot.js";
import { TOKEN_SHAPE, secretName, blobs, hiddenChars, overridePhrases, plainHttpRemote, secretInText, sensitivePaths, shellInline } from "./rules.js";

export const MARKER = "<!-- vexryn-pr-review -->";
export const NO_CHANGE = "No agent config file changed.";

/** Lines per section and items per inline list. */
const MAX_LINES = 40;
const MAX_ITEMS = 10;
/** GitHub rejects comments over 65,536 chars; stay clear of it. */
const MAX_BODY = 60_000;
const WARN = "⚠️ ";
const SETTINGS_FILES = [".claude/settings.json", ".claude/settings.local.json"];

export interface Snapshot {
  servers: McpServer[];
  context: ContextItem[];
  settings: ClaudeSettings;
  /** Config files present but not valid JSON. */
  unreadable: string[];
  /** Content hash of every agent file, reviewed or not. */
  hashes: Record<string, string>;
  /** Reviewed files that are symlinks the review won't follow. */
  unresolved: string[];
  /** Content of every agent file (reviewed or not), for the text rules. */
  texts: Record<string, string>;
}

export interface Review {
  /** What the agent may do — increases first (prefixed ⚠️). */
  powers: string[];
  /** What Claude Code loads every session. */
  loadHeader: string | null;
  load: string[];
  /** Agent files whose content changed: read by this review / not read yet. */
  changed: string[];
  unreviewed: string[];
}

/**
 * `vexryn diff` in one call: review `base` → `head` (default: the working
 * tree) of the repo containing `dir`. Temp snapshots are always removed.
 */
export async function reviewRepo(dir: string, base: string, head?: string): Promise<string> {
  const root = await gitRoot(dir);
  const baseSha = await resolveRef(root, base);
  const headSha = head ? await resolveRef(root, head) : null;
  const sides: Side[] = [];
  try {
    sides.push(await snapshot(root, baseSha));
    sides.push(await snapshot(root, headSha));
    return renderReview(compare(await readSnapshot(sides[0]), await readSnapshot(sides[1])));
  } finally {
    for (const s of sides) await fs.rm(s.dir, { recursive: true, force: true });
  }
}

/** Read a snapshot side with the static scan, repo scope only. */
export async function readSnapshot(side: Side): Promise<Snapshot> {
  const configs = await discoverConfigs(side.dir);
  const unreadable: string[] = [];
  for (const c of configs) {
    if (c.relPath.endsWith(".json") && (await readJsonLoose(c.path)) === null) unreadable.push(posix(c.relPath));
  }
  const texts: Record<string, string> = {};
  for (const rel of Object.keys(side.hashes)) {
    texts[rel] = await fs.readFile(path.join(side.dir, rel), "utf8").catch(() => "");
  }
  return {
    servers: (await parseServers(configs, side.dir)).map((s) => ({ ...s, fromRelPath: posix(s.fromRelPath) })),
    context: (await claudeCodeContext(side.dir, false)).items,
    settings: await readClaudeSettings(side.dir),
    unreadable,
    hashes: side.hashes,
    unresolved: side.unresolved,
    texts,
  };
}

export function compare(base: Snapshot, head: Snapshot): Review {
  // A settings file unreadable on either side can't be compared: no fake deltas.
  const settingsComparable = !SETTINGS_FILES.some((f) => base.unreadable.includes(f) || head.unreadable.includes(f));
  const powers = [
    ...unreadableLines(base, head),
    ...serverLines(base, head),
    ...serverFactLines(base, head),
    ...shadowLines(base, head),
    ...textLines(base, head),
    ...(settingsComparable
      ? [
          ...permissionLines(base.settings, head.settings),
          ...hookLines(base.settings.hooks, head.settings.hooks),
          ...pluginLines(base.settings.plugins, head.settings.plugins),
        ]
      : []),
  ];
  // Increases first, keeping each group's order.
  powers.sort((x, y) => Number(y.startsWith(WARN)) - Number(x.startsWith(WARN)));

  const files = [...new Set([...Object.keys(base.hashes), ...Object.keys(head.hashes)])].sort();
  const changed = files.filter((f) => base.hashes[f] !== head.hashes[f]);
  return {
    powers,
    ...loadLines(base, head),
    changed: changed.filter(isAgentConfigPath),
    unreviewed: changed.filter((f) => !isAgentConfigPath(f)),
  };
}

export function renderReview(r: Review): string {
  const head = [MARKER, "### Vexryn — agent config review", ""];
  if (r.powers.length === 0 && r.load.length === 0 && r.changed.length === 0 && r.unreviewed.length === 0) {
    return [...head, NO_CHANGE].join("\n") + "\n";
  }
  const body: string[] = [];
  if (r.powers.length > 0 || r.load.length > 0) {
    body.push("These changes affect what your AI agent may do or what it loads.", "");
  } else {
    body.push("Agent config files changed, but not in any field this review reads.", "");
  }
  if (r.powers.length > 0) body.push("**What the agent may do**", ...bullets(r.powers), "");
  if (r.loadHeader) body.push(r.loadHeader, ...bullets(r.load), "");

  const files = [
    r.changed.length ? `Changed agent files: ${list(r.changed)}.` : "",
    r.unreviewed.length ? `Not reviewed yet: ${list(r.unreviewed)}.` : "",
  ].filter(Boolean);
  const foot = [
    ...(files.length ? [files.join(" "), ""] : []),
    "<sub>This review reads MCP servers, Claude Code permissions, permission mode, extra directories, hooks, " +
      "plugins and always-loaded context (CLAUDE.md, skills, subagents); other fields aren't reviewed. " +
      "Static read: nothing was executed, nothing was sent. An MCP server's tool list can't be known " +
      "without running it — run `vexryn scan --deep` locally on servers you trust.</sub>",
  ];

  const size = (lines: string[]) => [...head, ...lines, ...foot].join("\n").length;
  if (size(body) > MAX_BODY) {
    while (body.length > 0 && size([...body, "", "…review truncated to fit in one comment."]) > MAX_BODY) body.pop();
    body.push("", "…review truncated to fit in one comment.", "");
  }
  return [...head, ...body, ...foot].join("\n") + "\n";
}

/** Inline code span for untrusted text: secrets masked, flattened, truncated, backtick-safe. */
export function code(s: string): string {
  const flat = redact(s).replace(/\s+/g, " ").trim();
  if (!flat) return "(empty)";
  const text = flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  return longest > 0 ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

// --- Secrets ---------------------------------------------------------------

const TOKEN_SHAPE_G = new RegExp(TOKEN_SHAPE.source, "g");
const MASK = "***";

/**
 * Mask what is likely a secret in a command line, URL or rule: the value of a
 * secret-named flag (`--api-key X`, `--token=X`) or assignment (`API_KEY=X`),
 * what follows `Bearer` or a secret-named header (`Authorization: X`), known
 * token shapes, and in URLs the userinfo, query, fragment and random-looking
 * path segments. Over-masking is fine: this text is only ever displayed.
 */
export function redact(s: string): string {
  let maskNext = false;
  return s
    .split(/(\s+)/)
    .map((w) => {
      if (w === "" || /^\s+$/.test(w)) return w;
      if (maskNext) {
        maskNext = false;
        return MASK;
      }
      const assign = w.match(/^(["']?-{0,2}[\w.-]*)=(.+)$/);
      if (assign && secretName(assign[1])) return `${assign[1]}=${MASK}`;
      const secretFlag = /^-{1,2}[\w.-]+$/.test(w) && secretName(w);
      const secretHeader = /^["']?[\w-]+:["']?$/.test(w) && secretName(w);
      if (secretFlag || secretHeader || /^bearer$/i.test(w)) {
        maskNext = true;
        return w;
      }
      return maskUrls(w).replace(TOKEN_SHAPE_G, MASK);
    })
    .join("");
}

function maskUrls(w: string): string {
  return w.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>()]+/gi, (raw) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return MASK;
    }
    const segments = url.pathname.split("/").map((seg) => (seg.length >= 16 && /[a-z]/i.test(seg) && /\d/.test(seg) ? MASK : seg));
    const secretPath = segments.includes(MASK);
    if (!url.username && !url.password && !url.search && !url.hash && !secretPath) return raw; // nothing to hide
    return `${url.protocol}//${url.host}${secretPath ? segments.join("/") : url.pathname}${url.search ? "?…" : ""}`;
  });
}

// --- MCP servers -----------------------------------------------------------

function unreadableLines(base: Snapshot, head: Snapshot): string[] {
  const what = (f: string) => (SETTINGS_FILES.includes(f) ? "settings" : "MCP servers");
  return [
    ...head.unreadable
      .filter((f) => !base.unreadable.includes(f))
      .map((f) => `${WARN}${code(f)} is not valid JSON — its ${what(f)} can't be reviewed`),
    ...base.unreadable
      .filter((f) => !head.unreadable.includes(f) && head.hashes[f])
      .map((f) => `${code(f)} was not valid JSON before — changes to its ${what(f)} can't be compared`),
  ];
}

const serverKey = (s: McpServer) => `${s.fromRelPath}\u0000${s.name}`;
/** Raw launch facts: display text is truncated, so it can't decide "changed". */
const launch = (s: McpServer) => JSON.stringify([s.transport, s.command ?? "", s.args ?? [], s.url ?? "", [...(s.receives ?? [])].sort()]);
/** Launch facts + which names hold a literal secret: what makes a server worth re-checking. */
const facts = (s: McpServer) => launch(s) + JSON.stringify([...(s.literalSecrets ?? [])].sort());

/** Head servers that are new or changed, in files readable on both sides. */
function newOrChanged(base: Snapshot, head: Snapshot): McpServer[] {
  const unknown = (f: string) => base.unreadable.includes(f) || head.unreadable.includes(f);
  const before = new Map(base.servers.map((s) => [serverKey(s), s]));
  return head.servers.filter((s) => {
    const was = before.get(serverKey(s));
    return !unknown(s.fromRelPath) && (!was || facts(was) !== facts(s));
  });
}

function serverLines(base: Snapshot, head: Snapshot): string[] {
  const key = serverKey;
  const unknown = (f: string) => base.unreadable.includes(f) || head.unreadable.includes(f);
  const before = new Map(base.servers.map((s) => [key(s), s]));
  const after = new Map(head.servers.map((s) => [key(s), s]));
  const lines: string[] = [];
  for (const [k, s] of after) {
    const was = before.get(k);
    if (unknown(s.fromRelPath)) continue; // reported once as unreadable
    if (!was) {
      lines.push(`${WARN}New MCP server ${code(s.name)} for ${s.client} in ${code(s.fromRelPath)}: ${describe(s)}`);
    } else if (launch(was) === launch(s)) {
      // Only literal secrets changed: a new one is a fact line; one moved out is a fix.
      const gone = (was.literalSecrets ?? []).filter((n) => !(s.literalSecrets ?? []).includes(n));
      if (gone.length) {
        lines.push(`MCP server ${code(s.name)} (${code(s.fromRelPath)}): ${list(gone)} ${gone.length === 1 ? "is" : "are"} no longer written in the file`);
      }
    } else {
      const [now, then] = [describe(s), describe(was)];
      const hidden = now === then ? ` — ${argDelta(was.args, s.args) || "details changed beyond what is shown"}` : "";
      lines.push(`${WARN}MCP server ${code(s.name)} changed in ${code(s.fromRelPath)} (${s.client}): now ${now} (before: ${then})${hidden}`);
    }
  }
  for (const [k, s] of before) {
    if (!after.has(k) && !unknown(s.fromRelPath)) {
      lines.push(`MCP server ${code(s.name)} removed from ${code(s.fromRelPath)} (${s.client})`);
    }
  }
  return lines;
}

/** Exact facts about a new/changed server's launch config (rules.ts), one line each. */
function serverFactLines(base: Snapshot, head: Snapshot): string[] {
  const lines: string[] = [];
  for (const s of newOrChanged(base, head)) {
    const who = `MCP server ${code(s.name)} (${code(s.fromRelPath)})`;
    const args = s.args ?? [];
    if (s.command && shellInline(s.command, args)) lines.push(`${WARN}${who} runs a shell with inline code or a pipe: ${code(s.target)}`);
    const paths = sensitivePaths(args);
    if (paths.length) lines.push(`${WARN}${who} is given ${list(paths)} — a whole filesystem/home or a credential path`);
    if (s.url && plainHttpRemote(s.url)) lines.push(`${WARN}${who} connects over plain ${code("http://")} (unencrypted) to ${code(new URL(s.url).hostname)}`);
    for (const name of s.literalSecrets ?? []) {
      lines.push(`${WARN}${who}: ${code(name)} is a literal secret written in the file (not shown) — use ${code(`\${${name}}`)}`);
    }
    if (secretInText(s.target)) lines.push(`${WARN}${who}: its command or URL contains a credential (masked)`);
    const blob = Math.max(0, ...blobs(args.join(" ")));
    if (blob) lines.push(`${WARN}${who}: an argument contains a ${blob}-char base64/hex-looking string`);
  }
  return lines;
}

/** A name newly defined in several files with different launch commands. */
function shadowLines(base: Snapshot, head: Snapshot): string[] {
  const shadowed = (snap: Snapshot) => {
    // Per agent app: only servers one agent loads together can shadow each other.
    const byName = new Map<string, { name: string; launches: Map<string, string> }>(); // client+name → launch → file
    for (const s of snap.servers) {
      const k = `${s.client}\u0000${s.name}`;
      const e = byName.get(k) ?? { name: s.name, launches: new Map<string, string>() };
      if (!e.launches.has(launch(s))) e.launches.set(launch(s), s.fromRelPath);
      byName.set(k, e);
    }
    return new Map([...byName].filter(([, e]) => e.launches.size > 1).map(([k, e]) => [k, { name: e.name, files: [...e.launches.values()].sort() }]));
  };
  const before = shadowed(base);
  return [...shadowed(head)]
    .filter(([k]) => !before.has(k))
    .map(([, { name, files }]) => {
      const where = files.length === 2 ? `both ${code(files[0])} and ${code(files[1])}` : list(files);
      return `${WARN}${code(name)} is now defined in ${where} with different launch commands`;
    });
}

/** Text rules over what this change ADDS to any agent file. */
function textLines(base: Snapshot, head: Snapshot): string[] {
  const lines: string[] = [];
  for (const file of Object.keys(head.texts).sort()) {
    const after = head.texts[file];
    const before = base.texts[file] ?? "";
    if (after === before) continue;
    const seen = new Set(before.split("\n"));
    const added = after.split("\n").filter((l) => !seen.has(l)).join("\n");
    // Counted on the added lines, so removing hidden text elsewhere can't offset it.
    const hidden = hiddenChars(added);
    if (hidden > 0) lines.push(`${WARN}${code(file)} adds text containing ${hidden} invisible character${plural(hidden)} (zero-width/bidi/tag) a reviewer cannot see`);
    const phrases = overridePhrases(added);
    if (phrases.length) lines.push(`${WARN}${code(file)} adds text containing the phrase ${list(phrases)}`);
    // In a JSON config, a long argument is already reported as a server fact.
    const blob = file.endsWith(".json") ? 0 : Math.max(0, ...blobs(added));
    if (blob) lines.push(`${WARN}${code(file)} adds a ${blob}-char base64/hex-looking string`);
  }
  return lines;
}

function describe(s: McpServer): string {
  const how =
    s.transport === "stdio"
      ? `runs ${code(s.target)}${unpinned(s) ? " — version not pinned" : ""}`
      : s.transport === "http"
        ? `connects to ${code(s.target)}`
        : "unrecognized launch config";
  return how + (s.receives?.length ? `, receives ${list(s.receives)}` : "");
}

function argDelta(before: string[] = [], after: string[] = []): string {
  const added = after.filter((a) => !before.includes(a));
  const removed = before.filter((a) => !after.includes(a));
  return [added.length ? `args added: ${list(added)}` : "", removed.length ? `args removed: ${list(removed)}` : ""]
    .filter(Boolean)
    .join("; ");
}

const RUNNERS = new Set(["npx", "bunx", "pnpx", "uvx"]);

/**
 * A package runner fetching a package without an exact version: what runs can
 * change any day. No claim for local paths, URLs or git specs.
 */
function unpinned(s: McpServer): boolean {
  const runner = path.basename(s.command ?? "").replace(/\.(cmd|exe)$/i, "");
  if (!RUNNERS.has(runner)) return false;
  const args = s.args ?? [];
  let pkg: string | undefined;
  for (let i = 0; i < args.length && pkg === undefined; i++) {
    const a = args[i];
    if (/^--(package|from)=/.test(a)) pkg = a.slice(a.indexOf("=") + 1);
    else if (a === "-p" || a === "--package" || a === "--from") pkg = args[i + 1];
    else if (!a.startsWith("-")) pkg = a;
  }
  if (!pkg || /^[./~]|:\/\/|^(git|github|file|link)[:+]/.test(pkg)) return false;
  // npm: name@version (skip a scope's leading @); uv: name==version or name@version.
  const version = runner === "uvx" ? pkg.split(/==|@/)[1] : pkg.slice(1).split("@")[1];
  return !(version && /^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(version));
}

// --- Claude Code settings --------------------------------------------------

/** Modes Claude Code ignores when set in a project file (docs: settings). */
const IGNORED_FROM_PROJECT = new Set(["auto", "bypassPermissions"]);

function permissionLines(base: ClaudeSettings, head: ClaudeSettings): string[] {
  const lines: string[] = [];
  const delta = (a: string[], b: string[]) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });

  const allow = delta(base.allow, head.allow);
  for (const r of allow.added) lines.push(`${WARN}Claude Code may use ${code(r)} without asking (once the folder is trusted)`);
  for (const r of allow.removed) lines.push(`Claude Code no longer auto-approved for ${code(r)}`);
  const deny = delta(base.deny, head.deny);
  for (const r of deny.added) lines.push(`Claude Code is now blocked from ${code(r)}`);
  for (const r of deny.removed) lines.push(`${WARN}Claude Code no longer blocked from ${code(r)}`);
  const ask = delta(base.ask, head.ask);
  for (const r of ask.added) lines.push(`Claude Code now asks before ${code(r)}`);
  for (const r of ask.removed) lines.push(`${WARN}Claude Code no longer forced to ask before ${code(r)}`);
  const dirs = delta(base.additionalDirectories, head.additionalDirectories);
  for (const d of dirs.added) {
    const note = sensitivePaths([d]).length ? " — a whole filesystem/home or a credential path" : "";
    lines.push(`${WARN}Claude Code may access directory ${code(d)}${note}`);
  }
  for (const d of dirs.removed) lines.push(`Claude Code no longer has access to directory ${code(d)}`);

  // `manual` is an alias of `default`. Of the modes a project file can set,
  // only `acceptEdits` loosens (`dontAsk` auto-denies, `plan` is read-only).
  const norm = (m: string | null) => (m == null || m === "manual" ? "default" : m);
  if (norm(base.defaultMode) !== norm(head.defaultMode)) {
    const to = norm(head.defaultMode);
    lines.push(
      `${to === "acceptEdits" ? WARN : ""}Permission mode: ${code(base.defaultMode ?? "default")} → ${code(head.defaultMode ?? "default")}` +
        (IGNORED_FROM_PROJECT.has(to) ? " — ignored by Claude Code when set in a project file" : ""),
    );
  }
  return lines;
}

function hookLines(base: Hook[], head: Hook[]): string[] {
  const id = (h: Hook) => `${h.on}\u0000${h.action}\u0000${h.what}`;
  const was = new Set(base.map(id));
  const is = new Set(head.map(id));
  const show = (h: Hook) => `on ${code(h.on)}: ${h.action} ${code(h.what)}`;
  return [
    ...head.filter((h) => !was.has(id(h))).map((h) => `${WARN}New hook ${show(h)}`),
    ...base.filter((h) => !is.has(id(h))).map((h) => `Hook removed ${show(h)}`),
  ];
}

function pluginLines(base: Record<string, boolean>, head: Record<string, boolean>): string[] {
  const lines: string[] = [];
  for (const id of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (head[id] === true && base[id] !== true) lines.push(`${WARN}Enables Claude Code plugin ${code(id)}`);
    if (base[id] === true && head[id] !== true) lines.push(`Stops enabling Claude Code plugin ${code(id)}`);
  }
  return lines;
}

// --- Always-loaded context -------------------------------------------------

const AGGREGATES: Record<string, string> = { skills: "Skill descriptions", agents: "Subagent descriptions" };

function loadLines(baseSnap: Snapshot, headSnap: Snapshot): Pick<Review, "loadHeader" | "load"> {
  const load: string[] = [];
  // A root file that is an unfollowable symlink on either side has no honest number.
  // ponytail: an unfollowable SKILL.md/agent link still shifts its aggregate; name it if that shows up.
  const unresolved = new Set([...baseSnap.unresolved, ...headSnap.unresolved]);
  for (const f of headSnap.unresolved.filter((f) => !baseSnap.unresolved.includes(f))) {
    load.push(`${code(f)} is a symlink the review won't follow (outside the repo, or to another link) — not counted`);
  }
  const base = baseSnap.context.filter((c) => !unresolved.has(c.key));
  const head = headSnap.context.filter((c) => !unresolved.has(c.key));
  const before = new Map(base.map((c) => [c.key, c]));
  const after = new Map(head.map((c) => [c.key, c]));
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key);
    const a = after.get(key);
    const [bt, at] = [b?.tokens ?? 0, a?.tokens ?? 0];
    const [bn, an] = [b?.names ?? [], a?.names ?? []];
    if (bt === at && bn.join("\u0000") === an.join("\u0000")) continue;
    if (AGGREGATES[key]) {
      const added = an.filter((n) => !bn.includes(n));
      const removed = bn.filter((n) => !an.includes(n));
      load.push(
        `${AGGREGATES[key]}: ${bn.length} → ${an.length} (${signed(at - bt)} tokens)` +
          (added.length ? ` — adds ${list(added)}` : "") +
          (removed.length ? ` — removes ${list(removed)}` : ""),
      );
    } else {
      load.push(`${code(key)}: ${fmt(bt)} → ${fmt(at)} tokens (${signed(at - bt)})`);
    }
  }
  if (load.length === 0) return { loadHeader: null, load };
  const [tb, ta] = [sum(base), sum(head)];
  return { loadHeader: `**Loads every session (Claude Code): ${fmt(tb)} → ${fmt(ta)} tokens (${signed(ta - tb)})**`, load };
}

// --- Formatting ------------------------------------------------------------

/** Code spans for at most MAX_ITEMS names, then "+N more". */
function list(names: string[]): string {
  const shown = names.slice(0, MAX_ITEMS).map(code).join(", ");
  return names.length > MAX_ITEMS ? `${shown} +${names.length - MAX_ITEMS} more` : shown;
}

function bullets(lines: string[]): string[] {
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `…and ${lines.length - MAX_LINES} more`] : lines;
  return shown.map((l) => `- ${l}`);
}

function sum(items: ContextItem[]): number {
  return items.reduce((n, c) => n + c.tokens, 0);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${fmt(n)}`;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function posix(p: string): string {
  return p.split(path.sep).join("/");
}
