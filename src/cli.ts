#!/usr/bin/env node
// vexryn — CLI entry.
// Usage:
//   vexryn scan [path] [--deep] [--html]
//   vexryn wrap --name <server> -- <command...>
//   vexryn usage

import path from "node:path";
import { discoverConfigs } from "./scan/discover.js";
import { parseServers } from "./scan/parse.js";
import { introspectServer } from "./scan/introspect.js";
import { assembleReport, renderText } from "./scan/report.js";
import { writeHtml } from "./scan/html.js";
import { runWrap } from "./proxy/wrap.js";
import { loadUsage, usedToolCount } from "./usage/store.js";
import { wireConfigs, unwireConfigs, type WireChange } from "./wire/wire.js";
import { computeTrim, renderTrim, writeTrimmed } from "./trim/trim.js";
import { estimateServer } from "./scan/catalog.js";

const VERSION = "0.0.1";

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(`vexryn ${VERSION}\n`);
    return 0;
  }
  if (cmd === "scan") return runScan(rest);
  if (cmd === "wrap") return runWrapCmd(rest);
  if (cmd === "usage") return runUsage();
  if (cmd === "wire") return runWire(rest, "wire");
  if (cmd === "unwire") return runWire(rest, "unwire");
  if (cmd === "trim") return runTrim(rest);

  process.stderr.write(`Unknown command: ${cmd}\n\n`);
  printHelp();
  return 2;
}

async function runScan(args: string[]): Promise<number> {
  const deep = args.includes("--deep");
  const html = args.includes("--html");
  const target = args.find((a) => !a.startsWith("-")) ?? ".";
  const root = path.resolve(process.cwd(), target);

  const configs = await discoverConfigs(root);
  const servers = await parseServers(configs);

  // Attach real usage from the local store (populated by `vexryn wrap`).
  const usage = await loadUsage();
  for (const s of servers) {
    const used = usedToolCount(usage, s.name);
    s.usedToolCount = usage.servers[s.name] ? used : null;
  }

  if (deep && servers.length > 0) {
    process.stderr.write(
      `\n  --deep: connecting to ${servers.length} of your own MCP server${
        servers.length === 1 ? "" : "s"
      } to measure real tool cost.\n` +
        "  This launches their commands locally. Nothing is sent anywhere.\n",
    );
    for (const server of servers) {
      if (server.transport === "unknown") continue;
      process.stderr.write(`  · introspecting ${server.name}…\n`);
      server.estimate = await introspectServer(server);
    }
    process.stderr.write("\n");
  }

  const report = assembleReport(root, deep, configs, servers);
  process.stdout.write(renderText(report));

  if (html) {
    const out = await writeHtml(report, root);
    process.stdout.write(`  report written to ${path.relative(process.cwd(), out)}\n\n`);
  }
  return 0;
}

function runWrapCmd(args: string[]): number {
  const sep = args.indexOf("--");
  if (sep === -1 || sep === args.length - 1) {
    process.stderr.write(
      "usage: vexryn wrap [--name <server>] -- <command> [args...]\n" +
        "  e.g. vexryn wrap --name github -- npx -y @modelcontextprotocol/server-github\n",
    );
    return 2;
  }
  const before = args.slice(0, sep);
  const nameIdx = before.indexOf("--name");
  const name = nameIdx !== -1 && before[nameIdx + 1] ? before[nameIdx + 1] : "server";
  const [command, ...cmdArgs] = args.slice(sep + 1);
  runWrap(name, command, cmdArgs); // long-lived; exits with the child
  return 0;
}

async function runUsage(): Promise<number> {
  const usage = await loadUsage();
  const names = Object.keys(usage.servers);
  process.stdout.write("\n  vexryn · tool usage (local)\n\n");
  if (names.length === 0) {
    process.stdout.write(
      "  No usage recorded yet. Route a server through the proxy to collect it:\n" +
        "    vexryn wrap --name <server> -- <the server command>\n\n",
    );
    return 0;
  }
  for (const name of names.sort()) {
    const s = usage.servers[name];
    const entries = Object.entries(s.tools).sort((a, b) => b[1] - a[1]);
    process.stdout.write(`  ${name}  (${entries.length} tools used)\n`);
    for (const [tool, count] of entries) {
      process.stdout.write(`    ${count.toString().padStart(5)}  ${tool}\n`);
    }
    process.stdout.write("\n");
  }
  return 0;
}

async function runWire(args: string[], mode: "wire" | "unwire"): Promise<number> {
  const target = args.find((a) => !a.startsWith("-")) ?? ".";
  const root = path.resolve(process.cwd(), target);
  const configs = await discoverConfigs(root);
  const changes = mode === "wire" ? await wireConfigs(configs) : await unwireConfigs(configs);

  const verb = mode === "wire" ? "Wired" : "Unwired";
  process.stdout.write(`\n  vexryn · ${mode}\n\n`);
  let touched = 0;
  for (const c of changes) {
    if (c.wired.length === 0 && c.already.length === 0 && c.skipped.length === 0) continue;
    process.stdout.write(`  ${c.file}\n`);
    if (c.wired.length) {
      process.stdout.write(`    ${verb}: ${c.wired.join(", ")}\n`);
      touched += c.wired.length;
    }
    if (c.already.length) process.stdout.write(`    already wired: ${c.already.join(", ")}\n`);
    if (c.skipped.length) process.stdout.write(`    skipped (not stdio): ${c.skipped.join(", ")}\n`);
  }
  if (touched === 0) process.stdout.write("  Nothing to change.\n");
  else if (mode === "wire")
    process.stdout.write(
      "\n  Your agent now routes these servers through vexryn (a backup was saved).\n" +
        "  Work as usual; run `vexryn usage` or `vexryn scan` to see real usage.\n",
    );
  process.stdout.write("\n");
  return 0;
}

async function runTrim(args: string[]): Promise<number> {
  const write = args.includes("--write");
  const target = args.find((a) => !a.startsWith("-")) ?? ".";
  const root = path.resolve(process.cwd(), target);

  const configs = await discoverConfigs(root);
  const servers = await parseServers(configs);
  const usage = await loadUsage();
  for (const s of servers) {
    if (!s.estimate) s.estimate = estimateServer(s.name, s.target);
    s.usedToolCount = usage.servers[s.name] ? usedToolCount(usage, s.name) : null;
  }

  const result = computeTrim(servers);
  process.stdout.write(renderTrim(result));

  if (write && result.hasUsage) {
    const drop = new Set(result.recs.filter((r) => r.verdict === "drop").map((r) => r.server.name));
    if (drop.size > 0) {
      const written = await writeTrimmed(root, configs, drop);
      for (const w of written) process.stdout.write(`  wrote ${w}\n`);
      process.stdout.write("\n");
    }
  }
  return 0;
}

function printHelp(): void {
  process.stdout.write(
    [
      "",
      "  vexryn — see what your AI agent actually loads, and uses.",
      "",
      "  Commands:",
      "    scan [path] [--deep] [--html]   Scan a repo; report the load",
      "      --deep    Connect to your own servers to measure real token cost",
      "      --html    Also write .vexryn/report.html",
      "    wire [path]                     Route servers through the proxy (auto)",
      "    unwire [path]                   Undo wire (restore direct servers)",
      "    wrap --name <s> -- <command>    Proxy a server to count real tool usage",
      "    usage                           Show recorded tool usage",
      "    trim [path] [--write]           Suggest what to cut, based on usage",
      "",
      "  Any repo, any stack. scan is read-only & local; wire/wrap sit in the",
      "  path locally to count real calls. Nothing is ever sent.",
      "",
    ].join("\n"),
  );
}

main(process.argv.slice(2))
  .then((code) => {
    // `wrap` is long-lived and calls process.exit itself; don't exit here.
    if (process.argv[2] !== "wrap") process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(`vexryn: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
