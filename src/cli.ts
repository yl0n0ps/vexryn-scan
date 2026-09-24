#!/usr/bin/env node
// vexryn — CLI entry. Agnostic, read-only by default.
// Usage:  vexryn scan [path] [--deep] [--html]

import path from "node:path";
import { discoverConfigs } from "./scan/discover.js";
import { parseServers } from "./scan/parse.js";
import { introspectServer } from "./scan/introspect.js";
import { assembleReport, renderText } from "./scan/report.js";
import { writeHtml } from "./scan/html.js";

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
  if (cmd === "scan") {
    return runScan(rest);
  }

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

function printHelp(): void {
  process.stdout.write(
    [
      "",
      "  vexryn — see what your AI agent actually loads.",
      "",
      "  Usage:",
      "    vexryn scan [path]     Scan a repo for agent configs and report the load",
      "      --deep               Connect to your own servers to measure real token cost",
      "      --html               Also write .vexryn/report.html",
      "    vexryn --version",
      "    vexryn help",
      "",
      "  Any repo, any stack. Default is read-only, 100% local — nothing is sent.",
      "  --deep launches your configured servers locally to read their real tools.",
      "",
    ].join("\n"),
  );
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`vexryn: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
