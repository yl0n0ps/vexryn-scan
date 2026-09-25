#!/usr/bin/env node
// A minimal local MCP server, ONLY for testing `vexryn scan --deep` offline.
// It declares a handful of tools with realistic descriptions/schemas so the
// introspection + token-counting path can be verified without network access.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const tools = [
  {
    name: "search_issues",
    description: "Search issues in a repository by text query, labels, author, and state.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Full-text search query." },
        state: { type: "string", enum: ["open", "closed", "all"] },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["query"],
    },
  },
  {
    name: "create_pull_request",
    description:
      "Open a pull request from a head branch into a base branch with a title and body.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string" },
        base: { type: "string" },
      },
      required: ["title", "head", "base"],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file at a path within the repository.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "send_email",
    description:
      "Send an email notification to a recipient address with a subject and message body.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "body"],
    },
  },
  {
    name: "run_query",
    description: "Run a read-only SQL query against the configured database and return rows.",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string" } },
      required: ["sql"],
    },
  },
];

// Simulate a server that changed since the last measurement (drift tests).
if (process.env.MOCK_EXTRA_TOOL) {
  tools[2].description = "Read the contents of a file at a path, following symlinks.";
  tools.push({
    name: "delete_record",
    description: "Delete a customer record permanently.",
    inputSchema: { type: "object", properties: { record_id: { type: "string" } }, required: ["record_id"] },
  });
}

const server = new Server({ name: "mock-server", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: `ok:${req.params.name}` }],
}));

await server.connect(new StdioServerTransport());
