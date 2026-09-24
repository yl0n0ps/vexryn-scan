#!/usr/bin/env node
// vexryn — CLI entry. Agnostic, read-only, no network.
// Usage:  vexryn scan [path]

import path from "node:path";
import { discoverConfigs } from "./scan/discover.js";
import { parseServers } from "./scan/parse.js";
import { assembleReport, renderText } from "./scan/report.js";

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
    const target = rest.find((a) => !a.startsWith("-")) ?? ".";
    const root = path.resolve(process.cwd(), target);
    const configs = await discoverConfigs(root);
    const servers = await parseServers(configs);
    const report = assembleReport(root, configs, servers);
    process.stdout.write(renderText(report));
    return configs.length === 0 ? 0 : 0;
  }

  process.stderr.write(`Unknown command: ${cmd}\n\n`);
  printHelp();
  return 2;
}

function printHelp(): void {
  process.stdout.write(
    [
      "",
      "  vexryn — see what your AI agent actually loads.",
      "",
      "  Usage:",
      "    vexryn scan [path]     Scan a repo for agent configs and report the load",
      "    vexryn --version",
      "    vexryn help",
      "",
      "  Any repo, any stack. Read-only, 100% local — nothing is sent.",
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
