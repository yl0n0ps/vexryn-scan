// One side of a diff, materialized into a temp dir so the static scan runs on
// it unchanged. A commit is read from git objects (`git show`), never checked
// out; `null` = the working tree (tracked + new unignored files). Files are
// data: nothing here executes them. git runs via execFile, never a shell.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

/** Repo-relative (posix) paths the review reads. Everything else is ignored. */
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

/** Write one side's agent-config files into a new temp dir; the caller deletes it. */
export async function snapshot(root: string, sha: string | null): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vexryn-diff-"));
  const listing = sha
    ? await git(root, ["ls-tree", "-r", "-z", "--name-only", sha])
    : await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const paths = [...new Set(listing.toString("utf8").split("\0"))].filter(isAgentConfigPath);

  for (const rel of paths) {
    const dest = path.resolve(dir, rel);
    if (!dest.startsWith(dir + path.sep)) continue; // never write outside the snapshot
    const content = sha ? await git(root, ["show", `${sha}:${rel}`]) : await readWorkingFile(path.join(root, rel));
    if (content == null) continue; // tracked but deleted on disk
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content);
  }
  return dir;
}

/** A working-tree file, or its link text if it is a symlink (as git stores it). */
async function readWorkingFile(p: string): Promise<Buffer | string | null> {
  try {
    const st = await fs.lstat(p);
    return st.isSymbolicLink() ? await fs.readlink(p) : st.isFile() ? await fs.readFile(p) : null;
  } catch {
    return null;
  }
}

async function git(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: MAX_BUFFER, encoding: "buffer" });
  return stdout;
}
