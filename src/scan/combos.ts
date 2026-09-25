// Dangerous combinations: powers that are harmless alone but not together.
// Exact rules over the powers the classifier found (powers.ts), stated as
// facts with the reason, never as a verdict. Only the agent's MCP tools are
// counted — its built-in tools (file reading, web fetch) are not.

import type { Power } from "./powers.js";

const COMBINATIONS: Array<{ needs: Power[][]; fact: string }> = [
  {
    // untrusted content in + private data + a way out = the classic leak
    needs: [["network.fetch"], ["file.read"], ["external-message.send", "file.share"]],
    fact: "Its MCP tools can read web pages, read your files and send them out — a page it reads could tell it to send your files",
  },
  {
    needs: [["network.fetch"], ["shell.exec"]],
    fact: "Its MCP tools can read web pages and run shell commands — a page it reads could tell it to run a command",
  },
];

/** The combinations present in a set of powers, one sentence each. */
export function combinations(powers: Iterable<Power | null | undefined>): string[] {
  const have = new Set(powers);
  return COMBINATIONS.filter((c) => c.needs.every((anyOf) => anyOf.some((p) => have.has(p)))).map((c) => c.fact);
}
