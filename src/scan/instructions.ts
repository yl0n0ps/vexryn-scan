// What Cursor, Windsurf and Gemini CLI load into every request, read from disk
// only. Rules per their docs (checked 2026-09-26):
//  - Cursor (cursor.com/docs/context/rules): `.cursor/rules/**/*.mdc` —
//    `alwaysApply: true` → the rule, a `description` without `globs` → the
//    description (the agent reads it to decide); root `AGENTS.md`. Rules
//    attached by file pattern or by hand load only when used: not counted.
//    `.cursorrules` is no longer documented: not counted.
//  - Windsurf (docs.devin.ai/desktop/cascade/memories): `global_rules.md`,
//    `.devin/rules/*.md` (or `.windsurf/rules/*.md`) with `trigger: always_on`
//    → the rule, `model_decision` → the description; `.windsurfrules`; root `AGENTS.md`.
//  - Gemini CLI (gemini-cli docs/cli/gemini-md.md): `~/.gemini/GEMINI.md` and
//    the workspace's and its parents' context files, named by `context.fileName`.
// An agent is counted only when it is present: its files in the repo, or (with
// user-wide configs) its folder in the home directory.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentClient, ContextItem } from "../types.js";
import { homeDir, tildify } from "./discover.js";
import { frontmatter } from "./claude.js";
import { readJsonLoose } from "./parse.js";
import { countTokens } from "./tokens.js";

export type AgentContexts = Partial<Record<AgentClient, ContextItem[]>>;

export async function agentContexts(root: string, includesGlobal: boolean): Promise<AgentContexts> {
  const home = homeDir();
  const present = async (repoPaths: string[], homePath: string) =>
    (await anyExists(repoPaths.map((p) => path.join(root, p)))) || (includesGlobal && (await exists(path.join(home, homePath))));
  const out: AgentContexts = {};
  const agentsMd = await readText(path.join(root, "AGENTS.md"));

  if (await present([".cursor", ".cursorrules"], ".cursor")) {
    const items: ContextItem[] = [];
    const always: Rule[] = [];
    const described: Rule[] = [];
    for (const r of await rules(root, ".cursor/rules", ".mdc")) {
      if (r.fm.alwaysApply === "true") always.push(r);
      else if (r.fm.description && !r.fm.globs) described.push(r);
    }
    aggregate(items, "cursor-rules", "always-apply rule", always, (r) => r.body);
    aggregate(items, "cursor-rule-descriptions", "rule description", described, (r) => r.fm.description);
    file(items, "AGENTS.md", agentsMd);
    if (items.length) out.Cursor = items;
  }

  if (await present([".windsurf", ".devin", ".windsurfrules"], path.join(".codeium", "windsurf"))) {
    const items: ContextItem[] = [];
    if (includesGlobal) {
      const global = path.join(home, ".codeium", "windsurf", "memories", "global_rules.md");
      file(items, tildify(global), await readText(global));
    }
    // .devin/rules is preferred; .windsurf/rules is the fallback.
    const dir = (await exists(path.join(root, ".devin", "rules"))) ? ".devin/rules" : ".windsurf/rules";
    const always: Rule[] = [];
    const described: Rule[] = [];
    for (const r of await rules(root, dir, ".md")) {
      if (r.fm.trigger === "always_on") always.push(r);
      else if (r.fm.trigger === "model_decision" && r.fm.description) described.push(r);
    }
    aggregate(items, "windsurf-rules", "always-on rule", always, (r) => r.body);
    aggregate(items, "windsurf-rule-descriptions", "rule description", described, (r) => r.fm.description);
    file(items, ".windsurfrules", await readText(path.join(root, ".windsurfrules")));
    file(items, "AGENTS.md", agentsMd);
    if (items.length) out.Windsurf = items;
  }

  const names = await geminiFileNames(root, home, includesGlobal);
  if (await present([".gemini", ...names], ".gemini")) {
    const items: ContextItem[] = [];
    const dirs = [root];
    if (includesGlobal) for (let d = path.dirname(root); d !== path.dirname(d); d = path.dirname(d)) dirs.push(d);
    const seen = new Set<string>();
    const add = async (label: string, p: string) => {
      if (!seen.has(p)) file(items, label, await readText(p));
      seen.add(p);
    };
    for (const dir of dirs) for (const n of names) await add(dir === root ? n : tildify(path.join(dir, n)), path.join(dir, n));
    if (includesGlobal) for (const n of names) await add(tildify(path.join(home, ".gemini", n)), path.join(home, ".gemini", n));
    if (items.length) out["Gemini CLI"] = items;
  }
  return out;
}

interface Rule {
  rel: string;
  fm: Record<string, string>;
  body: string;
}

/** Rule files under `root/dir` (up to 4 folders deep), with their frontmatter and body. */
async function rules(root: string, dir: string, ext: string): Promise<Rule[]> {
  const out: Rule[] = [];
  const walk = async (rel: string, depth: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory() && depth < 4) await walk(r, depth + 1);
      else if (e.isFile() && e.name.endsWith(ext)) {
        const text = (await readText(path.join(root, r))) ?? "";
        out.push({ rel: r, fm: frontmatter(text), body: text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "") });
      }
    }
  };
  await walk(dir, 0);
  return out;
}

/** Context file names Gemini CLI reads: `context.fileName` (repo settings first), default GEMINI.md. */
async function geminiFileNames(root: string, home: string, includesGlobal: boolean): Promise<string[]> {
  const files = [path.join(root, ".gemini", "settings.json"), ...(includesGlobal ? [path.join(home, ".gemini", "settings.json")] : [])];
  for (const f of files) {
    const s = (await readJsonLoose(f)) as { context?: { fileName?: unknown } } | null;
    const n = s?.context?.fileName;
    const list = (Array.isArray(n) ? n : [n]).filter((x): x is string => typeof x === "string" && x !== "" && !x.includes("/") && !x.includes(".."));
    if (list.length) return list;
  }
  return ["GEMINI.md"];
}

function aggregate(items: ContextItem[], key: string, what: string, rs: Rule[], text: (r: Rule) => string) {
  if (rs.length) items.push({ key, label: `${rs.length} ${what}${rs.length === 1 ? "" : "s"}`, tokens: countTokens(rs.map(text).join("\n")), names: rs.map((r) => r.rel) });
}

function file(items: ContextItem[], label: string, text: string | null) {
  if (text) items.push({ key: label, label, tokens: countTokens(text) });
}

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

async function anyExists(ps: string[]): Promise<boolean> {
  for (const p of ps) if (await exists(p)) return true;
  return false;
}
