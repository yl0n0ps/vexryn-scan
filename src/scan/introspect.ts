// Opt-in introspection (--deep): connect to the user's OWN configured MCP
// servers, locally, read their real tool list, and count real tokens.
//
// This LAUNCHES a stdio server's command (or opens an http endpoint). It runs
// only on explicit --deep, on the user's machine, for servers their agent
// already runs. Nothing is sent anywhere. The default `scan` never does this.

import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServer, ServerEstimate, ToolInfo } from "../types.js";
import { countToolTokens } from "./tokens.js";
import { classifyTool } from "./powers.js";

const CONNECT_TIMEOUT_MS = 15_000;

/** Introspect one server → a measured estimate, or an error estimate. */
export async function introspectServer(server: McpServer): Promise<ServerEstimate> {
  try {
    const tools = await withTimeout(listTools(server), CONNECT_TIMEOUT_MS);
    const detailed: ToolInfo[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      tokens: countToolTokens(t),
      power: classifyTool(t),
      hash: createHash("sha256").update(JSON.stringify({ d: t.description ?? "", s: t.inputSchema ?? {} })).digest("hex"),
    }));
    const approxTokens = detailed.reduce((sum, t) => sum + t.tokens, 0);
    return {
      toolCount: detailed.length,
      approxTokens,
      source: "introspect",
      tools: detailed,
    };
  } catch (err) {
    return {
      toolCount: 0,
      approxTokens: 0,
      source: "introspect-failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface RawTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

async function listTools(server: McpServer): Promise<RawTool[]> {
  const client = new Client({ name: "vexryn-scan", version: "0.0.1" }, { capabilities: {} });
  const transport = buildTransport(server);
  try {
    await client.connect(transport);
    const res = await client.listTools();
    return (res.tools ?? []) as RawTool[];
  } finally {
    await client.close().catch(() => {});
  }
}

function buildTransport(server: McpServer) {
  if (server.transport === "stdio" && server.command) {
    return new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: process.env as Record<string, string>,
    });
  }
  if (server.transport === "http" && server.url) {
    return new StreamableHTTPClientTransport(new URL(server.url));
  }
  throw new Error(`cannot introspect '${server.name}' (unsupported transport)`);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
