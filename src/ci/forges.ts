// Where `vexryn ci` posts the review: ONE comment on the pull/merge request, kept
// up to date. Every path, field and header here comes from the forge's own API
// docs/spec (see docs/plans/2026-09-27-any-forge.md). Nothing else is sent, only
// to the forge the CI runs for, with the token the user gave; the token is never
// printed. GitHub, Forgejo and Gitea share one comment API.

import fs from "node:fs";
import { MARKER } from "../diff/review.js";

export type Forge = "github" | "gitlab" | "bitbucket" | "azure";

export interface CiContext {
  forge: Forge;
  /** For messages: "github.com", "codeberg.org", "GitLab"… */
  label: string;
  /** The comments collection's URL root (see `adapter`). */
  root: string;
  pr: string;
  token?: string;
  /** What to set when there is no token. */
  tokenHint: string;
  /** Commits/refs the PR merges into, best first; the review's base is their merge-base with HEAD. */
  targets: string[];
  /** The PR's own head commit, when the CI says it: the checkout must contain it. */
  prHead?: string;
  /** How to fetch enough history on this CI. */
  fix: string;
}

export type Detected = CiContext | { label: string; skip: string } | null;

/** Hidden marker for forges whose markdown renders no HTML (a CommonMark link definition renders as nothing). */
export const MD_MARKER = "[//]: # (vexryn-pr-review)";
const NOTICE = "### Vexryn — agent config review\n\nThe latest review couldn't be posted as a comment — see the CI job log.\n";

const digits = (s: unknown) => typeof s === "string" && /^\d+$/.test(s);
const seg = encodeURIComponent;

/** Which CI this is, and which pull/merge request, from the CI's own variables. */
export function detect(env: NodeJS.ProcessEnv, readEvent = readJson): Detected {
  const token = (...names: string[]) => [env.VEXRYN_TOKEN, ...names.map((n) => env[n])].find((t) => t);

  if (env.GITHUB_ACTIONS === "true" || env.FORGEJO_ACTIONS === "true" || env.GITEA_ACTIONS === "true") {
    const server = env.GITHUB_SERVER_URL ?? "https://github.com";
    const label = hostOf(server);
    const pr = (env.GITHUB_EVENT_PATH ? readEvent(env.GITHUB_EVENT_PATH) : null)?.pull_request;
    if (!pr || !digits(String(pr.number))) return { label, skip: "not a pull request event — nothing to review." };
    const [owner, name] = (env.GITHUB_REPOSITORY ?? "").split("/");
    return {
      forge: "github",
      label,
      root: `${(env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "")}/repos/${seg(owner)}/${seg(name)}`,
      pr: String(pr.number),
      token: token("GITHUB_TOKEN", "GH_TOKEN"),
      tokenHint: "give the step `VEXRYN_TOKEN: ${{ github.token }}` and the job `pull-requests: write`",
      targets: [pr.base?.sha].filter(Boolean),
      prHead: pr.head?.sha,
      fix: "check out with `fetch-depth: 2` (actions/checkout) or more",
    };
  }

  if (env.GITLAB_CI === "true") {
    const label = "GitLab";
    const iid = env.CI_MERGE_REQUEST_IID;
    if (!digits(iid)) return { label, skip: "not a merge request pipeline — add `rules: - if: $CI_PIPELINE_SOURCE == \"merge_request_event\"`." };
    return {
      forge: "gitlab",
      label,
      root: `${(env.CI_API_V4_URL ?? "").replace(/\/$/, "")}/projects/${seg(env.CI_PROJECT_ID ?? "")}/merge_requests/${iid}/notes`,
      pr: iid!,
      token: token("GITLAB_TOKEN"),
      tokenHint: "add a masked CI/CD variable `VEXRYN_TOKEN`: a project access token with the `api` scope",
      // Merged-results pipelines: the target tip; otherwise the MR's diff base.
      targets: [env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA, env.CI_MERGE_REQUEST_DIFF_BASE_SHA].filter((t): t is string => !!t),
      prHead: env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA || undefined,
      fix: "set `GIT_DEPTH: 0` in the job's variables",
    };
  }

  if (env.BITBUCKET_BUILD_NUMBER) {
    const label = "Bitbucket";
    const id = env.BITBUCKET_PR_ID;
    if (!digits(id)) return { label, skip: "not a pull request pipeline — run it under `pipelines: pull-requests:`." };
    return {
      forge: "bitbucket",
      label,
      root: `https://api.bitbucket.org/2.0/repositories/${seg(env.BITBUCKET_WORKSPACE ?? "")}/${seg(env.BITBUCKET_REPO_SLUG ?? "")}/pullrequests/${id}/comments`,
      pr: id!,
      token: token("BITBUCKET_TOKEN"),
      tokenHint: "add a secured repository variable `VEXRYN_TOKEN`: a repository access token that can write pull requests",
      targets: env.BITBUCKET_PR_DESTINATION_BRANCH ? [`origin/${env.BITBUCKET_PR_DESTINATION_BRANCH}`] : [],
      prHead: env.BITBUCKET_COMMIT || undefined,
      fix: "set `clone: depth: full` in bitbucket-pipelines.yml",
    };
  }

  if (/^true$/i.test(env.TF_BUILD ?? "")) {
    const label = "Azure DevOps";
    const id = env.SYSTEM_PULLREQUEST_PULLREQUESTID;
    if (!digits(id)) return { label, skip: "not a pull request build — nothing to review." };
    if (env.BUILD_REPOSITORY_PROVIDER && env.BUILD_REPOSITORY_PROVIDER !== "TfsGit") {
      return { label, skip: `the repository is on ${env.BUILD_REPOSITORY_PROVIDER}, not Azure Repos — post from that forge's CI, or run \`vexryn diff\`.` };
    }
    const collection = (env.SYSTEM_COLLECTIONURI ?? "").replace(/\/?$/, "/");
    const target = (env.SYSTEM_PULLREQUEST_TARGETBRANCH ?? "").replace(/^refs\/heads\//, "");
    return {
      forge: "azure",
      label,
      root: `${collection}${seg(env.SYSTEM_TEAMPROJECT ?? "")}/_apis/git/repositories/${seg(env.BUILD_REPOSITORY_ID ?? "")}/pullRequests/${id}/threads`,
      pr: id!,
      token: token("SYSTEM_ACCESSTOKEN"),
      tokenHint: "map `SYSTEM_ACCESSTOKEN: $(System.AccessToken)` into the step's env (the build service needs 'Contribute to pull requests')",
      targets: target ? [`origin/${target}`] : [],
      prHead: env.SYSTEM_PULLREQUEST_SOURCECOMMITID || undefined,
      fix: "add `- checkout: self` with `fetchDepth: 0`",
    };
  }
  return null;
}

export interface Comment {
  id: string;
  /** Azure DevOps: the comment's id inside its thread (`id` is the thread's). */
  sub?: string;
  body: string;
}

export interface Adapter {
  list(): Promise<Comment[]>;
  create(markdown: string): Promise<void>;
  update(c: Comment, markdown: string): Promise<void>;
}

type Fetch = typeof fetch;

export function adapter(ctx: CiContext, fetchImpl: Fetch = fetch): Adapter {
  const origin = new URL(ctx.root).origin;
  const headers: Record<string, string> =
    ctx.forge === "github"
      ? { authorization: `token ${ctx.token ?? ""}`, accept: "application/vnd.github+json", "user-agent": "vexryn" }
      : ctx.forge === "gitlab"
        ? { "private-token": ctx.token ?? "" }
        : { authorization: `Bearer ${ctx.token ?? ""}` };
  // Bitbucket and Azure DevOps markdown: no HTML → markdown-only marker, no <sub>.
  const plain = ctx.forge === "bitbucket" || ctx.forge === "azure";
  const text = (md: string) => (plain ? md.replace(MARKER, MD_MARKER).replace(/<\/?sub>/g, "") : md);

  async function call(method: string, url: string, body?: unknown): Promise<Response> {
    const res = await fetchImpl(url, {
      method,
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`${method} ${new URL(url).pathname} → HTTP ${res.status}`);
    return res;
  }

  /** GET every page; a `next` page is followed only on the API's own origin (the token stays there). */
  async function pages(first: string, items: (json: any) => unknown[], next: (res: Response, json: any) => string | undefined) {
    const out: unknown[] = [];
    let url: string | undefined = first;
    for (let i = 0; url && i < 50; i++) {
      const res = await call("GET", url);
      const json = await res.json();
      out.push(...items(json));
      const n = next(res, json);
      url = n && new URL(n, url).origin === origin ? new URL(n, url).href : undefined;
    }
    return out;
  }
  const linkNext = (res: Response) => /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
  const valid = (c: Comment) => digits(c.id) && (c.sub === undefined || digits(c.sub)) && typeof c.body === "string";

  const api = {
    github: {
      list: () => pages(`${ctx.root}/issues/${ctx.pr}/comments?per_page=100`, (j) => (Array.isArray(j) ? j : []), linkNext),
      map: (c: any): Comment => ({ id: String(c?.id), body: c?.body }),
      create: (md: string) => call("POST", `${ctx.root}/issues/${ctx.pr}/comments`, { body: md }),
      update: (c: Comment, md: string) => call("PATCH", `${ctx.root}/issues/comments/${c.id}`, { body: md }),
    },
    gitlab: {
      list: () => pages(`${ctx.root}?per_page=100`, (j) => (Array.isArray(j) ? j.filter((n) => !n?.system) : []), linkNext),
      map: (c: any): Comment => ({ id: String(c?.id), body: c?.body }),
      create: (md: string) => call("POST", ctx.root, { body: md }),
      update: (c: Comment, md: string) => call("PUT", `${ctx.root}/${c.id}`, { body: md }),
    },
    bitbucket: {
      list: () => pages(`${ctx.root}?pagelen=100`, (j) => (Array.isArray(j?.values) ? j.values.filter((c: any) => !c?.deleted) : []), (_r, j) => j?.next),
      map: (c: any): Comment => ({ id: String(c?.id), body: c?.content?.raw }),
      create: (md: string) => call("POST", ctx.root, { content: { raw: md } }),
      update: (c: Comment, md: string) => call("PUT", `${ctx.root}/${c.id}`, { content: { raw: md } }),
    },
    azure: {
      list: () => pages(`${ctx.root}?api-version=7.1`, (j) => (Array.isArray(j?.value) ? j.value.filter((t: any) => !t?.isDeleted && !t?.comments?.[0]?.isDeleted) : []), () => undefined),
      map: (t: any): Comment => ({ id: String(t?.id), sub: String(t?.comments?.[0]?.id), body: t?.comments?.[0]?.content }),
      create: (md: string) => call("POST", `${ctx.root}?api-version=7.1`, { comments: [{ parentCommentId: 0, content: md, commentType: 1 }], status: 1 }),
      update: (c: Comment, md: string) => call("PATCH", `${ctx.root}/${c.id}/comments/${c.sub}?api-version=7.1`, { content: md }),
    },
  }[ctx.forge];

  return {
    list: async () => (await api.list()).map(api.map).filter(valid),
    create: async (md) => void (await api.create(text(md))),
    update: async (c, md) => {
      if (!valid(c)) throw new Error("invalid comment id");
      await api.update(c, text(md));
    },
  };
}

export type Outcome = { result: "posted" | "updated" | "skipped" | "failed"; error?: string };

/**
 * Keep ONE review comment on the PR: update the newest comment carrying the
 * marker, else create one. Someone else's marker comment can't be updated →
 * Vexryn posts its own, so it can't be silenced. When the review itself is
 * refused, a sticky already up is replaced by a short notice (never left stale).
 */
export async function publish(a: Adapter, markdown: string, empty: boolean): Promise<Outcome> {
  let error: string | undefined;
  const attempt = async (write: () => Promise<void>) => {
    try {
      await write();
      return true;
    } catch (e) {
      error ??= e instanceof Error ? e.message : String(e);
      return false;
    }
  };
  let mine: Comment | undefined;
  try {
    const ours = (await a.list()).filter((c) => c.body.trimStart().startsWith(MARKER) || c.body.trimStart().startsWith(MD_MARKER));
    mine = ours.sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1)).at(-1);
  } catch {
    // Listing refused: post as if there were no sticky yet.
  }
  if (!mine && empty) return { result: "skipped" };
  if (mine && (await attempt(() => a.update(mine!, markdown)))) return { result: "updated" };
  if (await attempt(() => a.create(markdown))) return { result: "posted" };
  if (mine) await a.update(mine, `${MARKER}\n${NOTICE}`).catch(() => {});
  return { result: "failed", error };
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "GitHub";
  }
}
