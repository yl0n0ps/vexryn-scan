// One side of a diff, materialized into a temp dir so the static scan runs on
// it unchanged. A commit is read from git objects (`git cat-file`), never
// checked out; `null` = the working tree (tracked + new unignored files).
// Files are data: nothing here executes them. git runs via execFile, never a shell.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

/** Repo-relative (posix) paths the review reads. */
export function isAgentConfigPath(p: string): boolean {
  const base = path.posix.basename(p);
  return (
    base === ".mcp.json" ||
    base === "CLAUDE.md" ||
    base === "CLAUDE.local.md" ||
    /(^|\/)\.(cursor|vscode)\/mcp\.json$/.test(p) ||
    /(^|\/)\.gemini\/settings\.json$/.test(p) ||
    /(^|\/)\.claude\/settings(\.local)?\.json$/.test(p) ||
    /(^|\/)\.claude\/skills\/(.+\/)?SKILL\.md$/.test(p) ||
    /(^|\/)\.claude\/agents\/[^/]+\.md$/.test(p)
  );
}

/** Agent files the review doesn't read yet: a change to them is named, never silently dropped. */
export function isUnreviewedAgentPath(p: string): boolean {
  const base = path.posix.basename(p);
  return (
    ["AGENTS.md", "GEMINI.md", ".cursorrules", ".windsurfrules"].includes(base) ||
    /(^|\/)\.(cursor|windsurf)\/rules\//.test(p) ||
    /(^|\/)\.claude\/commands\//.test(p) ||
    /(^|\/)\.github\/copilot-instructions\.md$/.test(p)
  );
}

export interface Side {
  /** Temp dir holding the reviewed files; the caller deletes it. */
  dir: string;
  /** Content hash of every agent file (reviewed or not), for change detection. */
  hashes: Record<string, string>;
  /** Reviewed files that are symlinks the review won't follow (out of the repo, or to another link). */
  unresolved: string[];
}

export async function gitRoot(dir: string): Promise<string> {
  try {
    return (await git(dir, ["rev-parse", "--show-toplevel"])).toString("utf8").trim();
  } catch {
    throw new Error(`not a git repository: ${dir}`);
  }
}

/** Resolve a ref to a commit sha. Refuses anything git could read as an option. */
export async function resolveRef(root: string, ref: string): Promise<string> {
  if (ref.startsWith("-")) throw new Error(`invalid ref: ${ref}`);
  try {
    return (await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).toString("utf8").trim();
  } catch {
    throw new Error(`unknown git ref: ${ref}`);
  }
}

/** Materialize one side: a commit sha, or `null` for the working tree. */
export async function snapshot(root: string, sha: string | null): Promise<Side> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vexryn-diff-"));
  try {
    const read = sha ? await commitReader(root, sha) : await workingTreeReader(root);
    const side: Side = { dir, hashes: {}, unresolved: [] };
    for (const rel of read.paths) {
      const reviewed = isAgentConfigPath(rel);
      if (!reviewed && !isUnreviewedAgentPath(rel)) continue;
      const content = await read.file(rel);
      if (content === "unresolved") {
        if (reviewed) side.unresolved.push(rel);
        continue;
      }
      if (content == null) continue; // tracked but deleted on disk, or not a file
      side.hashes[rel] = createHash("sha256").update(content).digest("hex");
      if (!reviewed) continue;
      const dest = path.resolve(dir, rel);
      if (!dest.startsWith(dir + path.sep)) continue; // never write outside the snapshot
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content);
    }
    return side;
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
}

/** A file's bytes, "unresolved" for a symlink we won't follow, or null if absent. */
type FileReader = { paths: string[]; file: (rel: string) => Promise<Buffer | "unresolved" | null> };

/**
 * Files of a commit, from git objects only. A symlink is followed one hop to
 * a regular file inside the repo (CLAUDE.md -> AGENTS.md is common); anything
 * else is "unresolved".
 */
async function commitReader(root: string, sha: string): Promise<FileReader> {
  const entries = new Map<string, { mode: string; oid: string }>();
  for (const record of (await git(root, ["ls-tree", "-r", "-z", "--full-tree", sha])).toString("utf8").split("\0")) {
    const m = record.match(/^(\d+) \w+ ([0-9a-f]+)\t(.+)$/s);
    if (m) entries.set(m[3], { mode: m[1], oid: m[2] });
  }
  const blob = (oid: string) => git(root, ["cat-file", "blob", oid]);
  const isFile = (mode: string | undefined) => mode === "100644" || mode === "100755";
  return {
    paths: [...entries.keys()],
    async file(rel) {
      const e = entries.get(rel)!;
      if (isFile(e.mode)) return blob(e.oid);
      if (e.mode !== "120000") return null; // submodule etc.
      const target = (await blob(e.oid)).toString("utf8");
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), target));
      const t = entries.get(resolved);
      if (path.posix.isAbsolute(target) || resolved.startsWith("../") || !t || !isFile(t.mode)) return "unresolved";
      return blob(t.oid);
    },
  };
}

/** Tracked + new unignored files of the working tree; symlinks as for a commit. */
async function workingTreeReader(root: string): Promise<FileReader> {
  const listing = await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const lstat = (p: string) => fs.lstat(p).catch(() => null);
  return {
    paths: [...new Set(listing.toString("utf8").split("\0").filter(Boolean))],
    async file(rel) {
      const p = path.join(root, rel);
      const st = await lstat(p);
      if (!st) return null;
      if (st.isFile()) return fs.readFile(p);
      if (!st.isSymbolicLink()) return null;
      // One hop, to a regular file whose real path stays inside the repo.
      const target = path.resolve(path.dirname(p), await fs.readlink(p));
      const real = await fs.realpath(target).catch(() => null);
      if (!real || !real.startsWith(root + path.sep) || !(await lstat(target))?.isFile()) return "unresolved";
      return fs.readFile(real);
    },
  };
}

async function git(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: MAX_BUFFER, encoding: "buffer" });
  return stdout;
}
