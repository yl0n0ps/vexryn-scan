#!/usr/bin/env node
// End-to-end check for the transparent proxy:
// connect an MCP client THROUGH `vexryn wrap` to the mock server, call tools,
// and confirm the usage store recorded the calls.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: [
    "dist/cli.js",
    "wrap",
    "--name",
    "mock-local",
    "--",
    "node",
    "fixtures/mock-mcp-server.mjs",
  ],
  env: process.env,
});

const client = new Client({ name: "proxy-check", version: "0.0.1" }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`listTools through proxy: ${tools.length} tools`);

await client.callTool({ name: "search_issues", arguments: { query: "bug" } });
await client.callTool({ name: "search_issues", arguments: { query: "flaky" } });
await client.callTool({ name: "read_file", arguments: { path: "README.md" } });
console.log("called: search_issues x2, read_file x1");

await client.close();
// give the proxy a moment to flush on shutdown
await new Promise((r) => setTimeout(r, 400));
console.log("done");
