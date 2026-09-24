#!/usr/bin/env node
// End-to-end check for the transparent proxy + usage store.
// Records three cases so scan/trim demos are meaningful:
//   mock-local : used (for the deep-repo "X of Y used" loop)
//   github     : used (keep in trim on sample-repo)
//   sentry     : wired but never called (drop in trim on sample-repo)

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function wrapTransport(name) {
  return new StdioClientTransport({
    command: "node",
    args: ["dist/cli.js", "wrap", "--name", name, "--", "node", "fixtures/mock-mcp-server.mjs"],
    env: process.env,
  });
}

async function session(name, calls) {
  const client = new Client({ name: "proxy-check", version: "0.0.1" }, { capabilities: {} });
  await client.connect(wrapTransport(name));
  const { tools } = await client.listTools();
  for (const c of calls) await client.callTool({ name: c, arguments: {} });
  await client.close();
  await new Promise((r) => setTimeout(r, 300));
  console.log(`${name}: ${tools.length} tools, ${calls.length} call(s)`);
}

await session("mock-local", ["search_issues", "search_issues", "read_file"]);
await session("github", ["search_issues", "create_pull_request"]);
await session("sentry", []); // wired, never used -> trim should drop it
console.log("done");
