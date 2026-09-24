// Real token counting. We count what the model actually sees for a tool:
// its name, description, and input schema, serialized the way an MCP client
// hands it to the model. Uses gpt-tokenizer (OpenAI o200k) — an approximation
// that is close enough across models to rank and total tool cost honestly.

import { encode } from "gpt-tokenizer";

export interface RawTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Tokens a single tool definition adds to the context window. */
export function countToolTokens(tool: RawTool): number {
  // Roughly what a client serializes into the tool list.
  const payload = JSON.stringify({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.inputSchema ?? {},
  });
  return countTokens(payload);
}

/** Tokens of an arbitrary string. */
export function countTokens(text: string): number {
  try {
    return encode(text).length;
  } catch {
    // Defensive fallback: ~4 chars per token.
    return Math.ceil(text.length / 4);
  }
}
