// Transparent MCP proxy. The agent launches `vexryn wrap --name <srv> -- <cmd>`
// instead of the server directly. Vexryn spawns the real server, pipes every
// JSON-RPC message through UNCHANGED in both directions, and taps the
// agent→server stream to count `tools/call` invocations per tool.
//
// It stays out of the way: it never alters, drops, or delays a message. MCP's
// stdio transport is newline-delimited JSON (one message per line, no embedded
// newlines), so line framing is safe and lossless.

import { spawn } from "node:child_process";
import readline from "node:readline";
import { recordToolCall, touchServer, flush } from "../usage/store.js";

export function runWrap(name: string, command: string, args: string[]): void {
  // Register the server as active immediately, so a wired-but-unused server is
  // distinguishable from one that was never wired (trim needs this).
  touchServer(name);
  flush();

  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });

  child.on("error", (err) => {
    process.stderr.write(`vexryn wrap: failed to start '${command}': ${err.message}\n`);
    process.exit(1);
  });

  // Downstream → agent: forward raw bytes, fully transparent.
  child.stdout.pipe(process.stdout);

  // Agent → downstream: forward each line unchanged, tapping tools/call.
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    tap(name, line);
    child.stdin.write(line + "\n");
  });
  process.stdin.on("end", () => child.stdin.end());

  // Persist periodically so a long session doesn't lose counts.
  const timer = setInterval(flush, 5000);
  timer.unref();

  const shutdown = (code: number) => {
    clearInterval(timer);
    flush();
    process.exit(code);
  };
  child.on("exit", (code) => shutdown(code ?? 0));
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

/** Sniff one agent→server message; count it if it's a tool call. */
function tap(serverName: string, line: string): void {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return;
  try {
    const msg = JSON.parse(trimmed) as { method?: unknown; params?: { name?: unknown } };
    if (msg.method === "tools/call" && typeof msg.params?.name === "string") {
      recordToolCall(serverName, msg.params.name);
    }
  } catch {
    // not JSON we understand — forwarding already happened, so just skip
  }
}
