// The Vexryn catalogue: popular MCP server packages measured by the public
// catalog workflow (scripts/measure-catalog.mjs), shipped in the package as
// catalog/catalog.json. It holds facts only — tool names, token cost, power,
// traps, a hash — never descriptions. It lets a static read say what a server
// can do from its launch command alone, without running anything.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ServerEstimate, ToolInfo } from "../types.js";

export interface CatalogVersion {
  measuredAt: string;
  /** The public workflow run that measured it. */
  by: string;
  tools: ToolInfo[];
}

export interface CatalogEntry {
  /** The publisher's deprecation notice for the latest version, or null. */
  deprecated: string | null;
  latest: string;
  versions: Record<string, CatalogVersion>;
}

interface Catalog {
  schema: number;
  servers: Record<string, CatalogEntry>;
}

let cache: Catalog | null = null;

/** The shipped catalogue (VEXRYN_CATALOG overrides the path, for tests). Empty if missing or unreadable. */
function catalog(): Catalog {
  if (cache) return cache;
  const file = process.env.VEXRYN_CATALOG || new URL("../../catalog/catalog.json", import.meta.url);
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Catalog;
    cache = data && typeof data.servers === "object" && data.servers ? data : { schema: 1, servers: {} };
  } catch {
    cache = { schema: 1, servers: {} };
  }
  return cache;
}

export interface PackageSpec {
  eco: "npm" | "pypi";
  name: string;
  version: string | null;
}

const NPM_RUNNERS = new Set(["npx", "bunx", "pnpx"]);

/**
 * The package a package runner launches (`npx -y pkg@1.2.3`, `npx -p pkg cmd`,
 * `uvx pkg==1.2`, `uvx --from pkg cmd`), or null: not a runner, or a local
 * path, URL or git spec.
 */
export function packageSpec(command: string, args: string[]): PackageSpec | null {
  const runner = path.basename(command.replace(/\\/g, "/")).replace(/\.(cmd|exe)$/i, "");
  const eco = NPM_RUNNERS.has(runner) ? "npm" : runner === "uvx" ? "pypi" : null;
  if (!eco) return null;
  let pkg: string | undefined;
  for (let i = 0; i < args.length && pkg === undefined; i++) {
    const a = args[i];
    if (/^--(package|from)=/.test(a)) pkg = a.slice(a.indexOf("=") + 1);
    else if (a === "-p" || a === "--package" || a === "--from") pkg = args[i + 1];
    else if (!a.startsWith("-")) pkg = a;
  }
  if (!pkg || /^[./~]|:\/\/|^(git|github|file|link)[:+]/.test(pkg)) return null;
  if (eco === "pypi") {
    const [name, version] = pkg.split(/==|@/);
    return { eco, name, version: version || null };
  }
  // npm: name@version, a scope's leading @ is part of the name.
  const at = pkg.indexOf("@", 1);
  return at === -1 ? { eco, name: pkg, version: null } : { eco, name: pkg.slice(0, at), version: pkg.slice(at + 1) || null };
}

/** An exact version (1.2.3, 2025.4.25, 1.0.0-beta.1): what runs can't change. */
export function isExactVersion(v: string | null): boolean {
  return !!v && /^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(v);
}

export interface CatalogHit {
  /** npm name or PyPI name, for display. */
  package: string;
  /** The version the figures are for. */
  version: string;
  /** The measurement, or null when the config pins a version the catalogue lacks. */
  measured: CatalogVersion | null;
  /** True when the config pins exactly this version; false = latest measured, config not pinned. */
  exact: boolean;
  latest: string;
  deprecated: string | null;
}

const pypiName = (n: string) => n.toLowerCase().replace(/[-_.]+/g, "-");

/**
 * The catalogue entry for a launched package: the pinned version if measured,
 * the latest measured one if the config isn't pinned. A pinned version the
 * catalogue lacks gets NO figures — another version's tools may differ.
 */
export function lookup(spec: PackageSpec | null): CatalogHit | null {
  if (!spec) return null;
  const servers = catalog().servers;
  const key =
    spec.eco === "npm"
      ? `npm:${spec.name}`
      : Object.keys(servers).find((k) => k.startsWith("pypi:") && pypiName(k.slice(5)) === pypiName(spec.name));
  const entry = key ? servers[key] : undefined;
  if (!entry) return null;
  const pinned = isExactVersion(spec.version);
  const version = pinned ? spec.version! : entry.latest;
  return {
    package: spec.name,
    version,
    measured: entry.versions[version] ?? null,
    exact: pinned,
    latest: entry.latest,
    deprecated: entry.deprecated,
  };
}

/** A dated estimate from the catalogue — nothing launched. */
export function estimateFromCatalog(hit: CatalogHit & { measured: CatalogVersion }): ServerEstimate {
  return {
    toolCount: hit.measured.tools.length,
    approxTokens: hit.measured.tools.reduce((n, t) => n + t.tokens, 0),
    source: "catalog",
    tools: hit.measured.tools,
    measuredAt: hit.measured.measuredAt,
    catalog: { package: hit.package, version: hit.version, exact: hit.exact },
  };
}

/** Parse "npm:@a/b@1.2.3", "@a/b@1.2.3", "pypi:x==1.0", "x" into a spec (npm by default). */
export function parsePackageArg(arg: string): PackageSpec | null {
  const m = arg.trim().match(/^(?:(npm|pypi):)?(.+)$/);
  if (!m || !m[2]) return null;
  return packageSpec(m[1] === "pypi" ? "uvx" : "npx", [m[2]]);
}
