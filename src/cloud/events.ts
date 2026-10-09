// The review event: the ONLY thing `vexryn ci` sends to Vexryn Cloud. Facts
// only — names, packages, versions, powers, finding lines (already redacted by
// review.ts). Never a value, a description, a file body. The schema is closed:
// `validateReviewEvent` is used by the CLI (before sending) and by the cloud
// (on receipt) — the same code, so the contract can't drift.
import type { McpServer } from "../types.js";
import type { Review } from "../diff/review.js";
import { isExactVersion, lookup, packageSpec } from "../scan/catalog.js";

export const LIMITS = { strings: 2000, lines: 500, servers: 500, names: 100 } as const;

export interface ServerFact {
  name: string;
  client: string;
  scope: string;
  transport: string;
  file: string;
  package?: string;
  version?: string;
  eco?: "npm" | "pypi";
  pinned?: boolean;
  known: boolean;
  deprecated: boolean;
  /** NAMES of env vars / headers the server receives — never values. */
  receives: string[];
  /** Of those, the names whose value is written literally in the file. */
  literalSecrets: string[];
  powers: string[];
  tools?: number;
}

export interface ReviewEvent {
  schema: "vexryn.review/1";
  sentAt: string;
  cli: string;
  forge: "github" | "gitlab" | "bitbucket" | "azure";
  forgeHost: string;
  repo: string;
  pr: string;
  baseSha: string;
  headSha: string;
  runUrl?: string;
  outcome: "clean" | "warn" | "block";
  review: Review;
  servers: ServerFact[];
}

export function serverFacts(servers: McpServer[]): ServerFact[] {
  return servers.map((s) => {
    const spec = s.command ? packageSpec(s.command, s.args ?? []) : null;
    const hit = lookup(spec);
    const fact: ServerFact = {
      name: s.name,
      client: s.client,
      scope: s.scope,
      transport: s.transport,
      file: s.fromRelPath,
      known: !!hit?.measured,
      deprecated: !!(hit?.deprecated && hit.version === hit.latest),
      receives: s.receives ?? [],
      literalSecrets: s.literalSecrets ?? [],
      powers: hit?.measured ? [...new Set(hit.measured.tools.map((t) => t.power).filter((p): p is NonNullable<typeof p> => !!p))] : [],
    };
    if (spec) {
      fact.package = spec.name;
      fact.eco = spec.eco;
      if (spec.version) fact.version = spec.version;
      fact.pinned = isExactVersion(spec.version);
    }
    if (hit?.measured) fact.tools = hit.measured.tools.length;
    return fact;
  });
}

export function buildReviewEvent(input: Omit<ReviewEvent, "schema" | "sentAt" | "servers"> & { headServers: McpServer[] }): ReviewEvent {
  const { headServers, ...rest } = input;
  return { schema: "vexryn.review/1", sentAt: new Date().toISOString(), ...rest, servers: serverFacts(headServers) };
}

// --- closed-schema validation (no library: the shape is small and must be exact)
type Check = (v: unknown) => string | null;
type Shape = Record<string, Check>;
const str = (max: number = LIMITS.strings): Check => (v) => (typeof v === "string" && v.length <= max ? null : `expected a string ≤ ${max}`);
const bool: Check = (v) => (typeof v === "boolean" ? null : "expected a boolean");
const int: Check = (v) => (Number.isInteger(v) && (v as number) >= 0 ? null : "expected a non-negative integer");
const oneOf = (...vals: string[]): Check => (v) => (typeof v === "string" && vals.includes(v) ? null : `expected one of ${vals.join(", ")}`);
const strs = (max: number): Check => (v) =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length <= LIMITS.strings) ? null : `expected ≤ ${max} strings`;
const optional = (f: Check): Check => (v) => (v === undefined ? null : f(v));
const obj = (shape: Shape, required: string[]): Check => (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "expected an object";
  for (const k of Object.keys(v)) if (!(k in shape)) return `unknown key "${k}"`;
  for (const k of required) if (!(k in v)) return `missing "${k}"`;
  for (const [k, f] of Object.entries(shape)) {
    const err = f((v as Record<string, unknown>)[k]);
    if (err) return `${k}: ${err}`;
  }
  return null;
};
const list = (f: Check, max: number): Check => (v) => {
  if (!Array.isArray(v) || v.length > max) return `expected an array of ≤ ${max}`;
  for (const [i, x] of v.entries()) {
    const err = f(x);
    if (err) return `[${i}] ${err}`;
  }
  return null;
};

const server = obj(
  {
    name: str(), client: str(), scope: str(), transport: str(), file: str(),
    package: optional(str()), version: optional(str()), eco: optional(oneOf("npm", "pypi")), pinned: optional(bool),
    known: bool, deprecated: bool, receives: strs(LIMITS.names), literalSecrets: strs(LIMITS.names), powers: strs(LIMITS.names), tools: optional(int),
  },
  ["name", "client", "scope", "transport", "file", "known", "deprecated", "receives", "literalSecrets", "powers"],
);
const load = obj({ header: str(), lines: strs(LIMITS.lines) }, ["header", "lines"]);
const review = obj(
  { powers: strs(LIMITS.lines), accepted: int, loads: list(load, LIMITS.lines), changed: strs(LIMITS.lines), unreviewed: strs(LIMITS.lines), open: int },
  ["powers", "accepted", "loads", "changed", "unreviewed", "open"],
);
const event = obj(
  {
    schema: oneOf("vexryn.review/1"), sentAt: str(64), cli: str(64), forge: oneOf("github", "gitlab", "bitbucket", "azure"), forgeHost: str(255),
    repo: str(), pr: str(64), baseSha: str(64), headSha: str(64), runUrl: optional(str()), outcome: oneOf("clean", "warn", "block"),
    review, servers: list(server, LIMITS.servers),
  },
  ["schema", "sentAt", "cli", "forge", "forgeHost", "repo", "pr", "baseSha", "headSha", "outcome", "review", "servers"],
);

export function validateReviewEvent(json: unknown): { ok: true; event: ReviewEvent } | { ok: false; error: string } {
  const error = event(json);
  return error ? { ok: false, error } : { ok: true, event: json as ReviewEvent };
}
