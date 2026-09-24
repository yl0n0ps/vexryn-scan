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
      "    wrap --name <s> -- <command>    Proxy a server to count real tool usage",
      "    usage                           Show recorded tool usage",
      "",
      "  Any repo, any stack. scan is read-only & local; wrap sits in the path",
      "  locally to count real calls. Nothing is ever sent.",
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
