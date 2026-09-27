// `vexryn ci`: one line in any CI. Detect the CI → find the PR's base in the
// checkout → review → print → post ONE comment on the PR → `--strict` exit code.
// Non-blocking by default: a CI config problem is a message and exit 0.

import fs from "node:fs/promises";
import { isEmpty, renderReview, reviewOf, strictExit } from "../diff/review.js";
import { git as gitRaw, gitRoot, resolveRef } from "../diff/snapshot.js";
import { adapter, detect, publish, type CiContext } from "./forges.js";

const git = async (cwd: string, args: string[]) => (await gitRaw(cwd, args)).toString("utf8").trim();
const say = (s: string) => process.stdout.write(`vexryn: ${s}\n`);
const warn = (s: string) => process.stderr.write(`vexryn: ${s}\n`);

export async function runCi(dir: string, env: NodeJS.ProcessEnv, strict: boolean): Promise<number> {
  const ctx = detect(env);
  if (!ctx) {
    warn(
      "no supported CI detected (GitHub, Forgejo or Gitea Actions, GitLab CI, Bitbucket Pipelines, Azure Pipelines).\n" +
        "  In any other CI: vexryn diff --base <target branch> --head HEAD [--strict] [--json]",
    );
    return 2;
  }
  if ("skip" in ctx) {
    say(`${ctx.label}: ${ctx.skip}`);
    return 0;
  }

  const root = await gitRoot(dir).catch(() => null);
  if (!root) {
    say(`${ctx.label}: ${dir} is not a git checkout — nothing to review.`);
    return 0;
  }
  const base = await findBase(root, ctx);
  if ("skip" in base) {
    say(`${ctx.label}: ${base.skip}`);
    return 0;
  }

  const review = await reviewOf(root, base.sha, "HEAD");
  const markdown = renderReview(review);
  process.stdout.write(markdown);

  if (!ctx.token) {
    warn(`no token to post this review on ${ctx.label} — ${ctx.tokenHint}. The review is printed above.`);
  } else {
    // A CI env without a usable API URL fails here, as a message, never a crash.
    const out = await Promise.resolve()
      .then(() => publish(adapter(ctx), markdown, isEmpty(review)))
      .catch((e) => ({ result: "failed" as const, error: e instanceof Error ? e.message : String(e) }));
    if (out.result === "skipped") say("no agent config change — nothing to post.");
    else if (out.result === "failed") {
      warn(`could not post the review on ${ctx.label} (${out.error ?? "refused"}) — it is printed above.`);
      if (env.GITHUB_STEP_SUMMARY) await fs.appendFile(env.GITHUB_STEP_SUMMARY, markdown).catch(() => {});
    } else say(`review comment ${out.result} on ${ctx.label}, pull request #${ctx.pr}.`);
  }
  return strictExit(strict, review.open);
}

/**
 * The commit the PR is compared to. A merge-commit checkout (GitHub, Azure,
 * GitLab merged results) → its parent that isn't the PR head. Otherwise the
 * merge-base of the target with HEAD, so main's own later changes are never
 * attributed to the PR.
 */
async function findBase(root: string, ctx: CiContext): Promise<{ sha: string } | { skip: string }> {
  const tryRef = (ref: string) => resolveRef(root, ref).catch(() => null);
  if (ctx.prHead) {
    const prHead = await tryRef(ctx.prHead);
    if (!prHead) return { skip: `the pull request's head commit isn't in this checkout — ${ctx.fix}.` };
    const inCheckout = await git(root, ["merge-base", "--is-ancestor", prHead, "HEAD"]).then(() => true, () => false);
    if (!inCheckout) return { skip: "this checkout isn't the pull request's code (pull_request_target?) — skipping." };
    const [, ...parents] = (await git(root, ["rev-list", "--parents", "-n", "1", "HEAD"])).split(/\s+/);
    if (parents.length === 2 && parents.includes(prHead)) return { sha: parents.find((p) => p !== prHead)! };
  }
  for (const t of ctx.targets) {
    const target = await tryRef(t);
    const mb = target && (await git(root, ["merge-base", target, "HEAD"]).catch(() => ""));
    if (mb) return { sha: mb };
  }
  return { skip: `can't find the pull request's base (${ctx.targets.join(", ") || "none given"}) in this checkout — ${ctx.fix}.` };
}
