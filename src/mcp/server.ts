// `vexryn mcp`: the load report and the config review as two MCP tools over
// stdio, so the user's own agent can call them from a conversation.
//
// Read-only by construction. Nothing that edits a config (wire, trim --write),
// sits in a server's path (wrap) or launches servers (--deep) is exposed: an
// agent must never be able to widen its own powers through Vexryn — that is
// the exact blind spot Vexryn exists to show. Paths are confined to the
// directory Vexryn was started in. stdout carries the protocol; the tools
// only ever return strings.

import { promises as fs } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { staticReport } from "../scan/collect.js";
import { renderText } from "../scan/report.js";
import { reviewRepo } from "../diff/review.js";

const ANSI = /\u001b\[[0-9;]*m/g;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export async function runMcp(version: string): Promise<void> {
  const server = new McpServer({ name: "vexryn", version });

  server.registerTool(
    "agent_load_report",
    {
      title: "Agent load report",
      description:
        "Read-only. What the AI agents configured for a repo load at every session start (MCP servers, " +
        "and for Claude Code its CLAUDE.md, memory, skill and subagent descriptions), with token counts. " +
        "Reads config files only; never launches a server. By default also reads the user's own agent configs.",
      inputSchema: {
        path: z.string().optional().describe("Repo directory, relative to where Vexryn was started (default: that directory)."),
        includeGlobal: z.boolean().optional().describe("Also read the user's own agent configs (default true)."),
      },
      annotations: READ_ONLY,
    },
    ({ path: p, includeGlobal }) =>
      guarded(async () => renderText(await staticReport(await insideCwd(p), includeGlobal ?? true)).replace(ANSI, "")),
  );

  server.registerTool(
    "agent_config_review",
    {
      title: "Agent config review",
      description:
        "Read-only. Reviews what a change to a repo's agent configs lets the agent do and load, between a git " +
        "ref and another ref or the working tree: MCP servers added/removed/changed (with the names of the " +
        "credentials they receive, never values), Claude Code permissions, hooks, plugins, and always-loaded " +
        "context deltas. Static: nothing from the repo is executed.",
      inputSchema: {
        path: z.string().optional().describe("A directory inside the repo, relative to where Vexryn was started."),
        base: z.string().describe("Git ref to compare from, e.g. main or a commit sha."),
        head: z.string().optional().describe("Git ref to compare to (default: the working tree)."),
      },
      annotations: READ_ONLY,
    },
    ({ path: p, base, head }) => guarded(async () => reviewRepo(await insideCwd(p), base, head)),
  );

  await server.connect(new StdioServerTransport());
  // Serve until the client disconnects (stdin closes), then let the CLI exit.
  await new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
  });
}

/** An agent-supplied path resolves to the launch directory or somewhere inside it. */
async function insideCwd(p: string | undefined): Promise<string> {
  const cwd = await fs.realpath(process.cwd());
  const target = path.resolve(cwd, p ?? ".");
  const real = await fs.realpath(target).catch(() => target);
  const rel = path.relative(cwd, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path must be inside the directory Vexryn was started in (${cwd})`);
  }
  return real;
}

/** A tool result: the text, or the error as an `isError` result the model can read. */
async function guarded(run: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await run() }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `vexryn: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
}
