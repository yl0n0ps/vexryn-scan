#!/usr/bin/env node
// Measure the Vexryn catalogue: launch each listed MCP server package, read its
// real tool list, record FACTS (tool names, token cost, power, traps, a hash to
// notice changes) — never the descriptions themselves.
//
// It downloads and runs third-party packages, so it runs ONLY in GitHub Actions
// (an ephemeral VM, no secrets, read-only token): .github/workflows/catalog.yml.
// Each package gets a minimal environment — PATH, HOME and the credentials it
// asks for, set to a dummy value. `--local-ok` exists for the offline test,
// which measures a local mock server and nothing else.
//
//   node scripts/measure-catalog.mjs [--list catalog/servers.json] [--out catalog/catalog.json] [--only <key>]

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { introspectServer } from "../dist/scan/introspect.js";
import { argNames } from "../dist/scan/powers.js";

const argv = process.argv.slice(2);
const opt = (flag, dflt) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : dflt);
const listPath = opt("--list", "catalog/servers.json");
const outPath = opt("--out", "catalog/catalog.json");
const only = opt("--only", null);
// Classifier work only: name, description and argument names of every tool. Never committed or shipped.
const debugOut = opt("--debug-out", null);
const debug = [];

if (process.env.GITHUB_ACTIONS !== "true" && !argv.includes("--local-ok")) {
  process.stderr.write("measure-catalog runs third-party packages: only in GitHub Actions (see .github/workflows/catalog.yml).\n");
  process.exit(2);
}

const DUMMY = "not-a-real-value";
const TIMEOUT_MS = Number(opt("--timeout-ms", "120000"));
const by = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : "local";

const list = JSON.parse(readFileSync(listPath, "utf8"));
const catalog = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { schema: 1, servers: {} };
const results = [];

for (const [key, spec] of Object.entries(list)) {
  if (only && key !== only) continue;
  const eco = key.slice(0, key.indexOf(":"));
  const name = key.slice(key.indexOf(":") + 1);
  try {
    const { version, deprecated, command, args } = await resolve(eco, name, spec);
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...Object.fromEntries((spec.env ?? []).map((n) => [n, DUMMY])) };
    const server = { name, client: "Unknown", scope: "project", transport: "stdio", target: [command, ...args].join(" "), command, args, fromRelPath: key, estimate: null };
    const est = await introspectServer(server, TIMEOUT_MS, env);
    if (est.source !== "introspect" || !est.tools) throw new Error(est.error ?? "no tool list");
    const entry = (catalog.servers[key] ??= { deprecated: null, latest: version, versions: {} });
    entry.deprecated = deprecated;
    entry.latest = version;
    entry.versions[version] = {
      measuredAt: new Date().toISOString(),
      by,
      // Facts only: the description is dropped here, on purpose.
      tools: est.tools.map((t) => ({ name: t.name, tokens: t.tokens, power: t.power ?? null, hash: t.hash, ...(t.flags ? { flags: t.flags } : {}) })),
    };
    if (debugOut) for (const t of est.raw ?? []) debug.push({ key, name: t.name, description: t.description ?? "", args: argNames(t.inputSchema) });
    results.push({ key, ok: true, detail: `${version} · ${est.tools.length} tools` });
  } catch (err) {
    results.push({ key, ok: false, detail: String(err instanceof Error ? err.message : err).split("\n")[0].slice(0, 120) });
  }
}

catalog.servers = Object.fromEntries(Object.entries(catalog.servers).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n");
if (debugOut) writeFileSync(debugOut, JSON.stringify(debug, null, 2) + "\n");

for (const r of results) process.stdout.write(`${r.ok ? "ok  " : "FAIL"}  ${r.key}  ${r.detail}\n`);
const measured = results.filter((r) => r.ok).length;
process.stdout.write(`\nmeasured ${measured}, failed ${results.length - measured}\n`);

/** The exact version to run (latest published), its deprecation notice, and the launch command. */
async function resolve(eco, name, spec) {
  if (eco === "npm") {
    const version = npm(["view", name, "version"]);
    const deprecated = npm(["view", `${name}@${version}`, "deprecated"]) || null;
    return { version, deprecated, command: "npx", args: ["-y", `${name}@${version}`, ...(spec.args ?? [])] };
  }
  if (eco === "pypi") {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (!res.ok) throw new Error(`PyPI ${res.status}`);
    const version = (await res.json()).info.version;
    return { version, deprecated: null, command: "uvx", args: [`${name}==${version}`, ...(spec.args ?? [])] };
  }
  if (eco === "local") return { version: "0.0.0-local", deprecated: null, command: spec.command, args: spec.args ?? [] };
  throw new Error(`unknown ecosystem: ${eco}`);
}

function npm(args) {
  return execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
