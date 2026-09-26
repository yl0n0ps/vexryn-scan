// Tolerant readers for the config formats beyond JSON: TOML (Codex) and YAML
// (Continue, Goose). Configs are untrusted input, so a parse error is null,
// never a throw — exactly like `readJsonLoose` for JSON.

import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

/** Parse TOML, or null on any error. */
export function readToml(text: string): unknown | null {
  try {
    return parseToml(text);
  } catch {
    return null;
  }
}

/** Parse YAML, or null on any error. */
export function readYaml(text: string): unknown | null {
  try {
    const v = parseYaml(text);
    return v ?? null;
  } catch {
    return null;
  }
}
