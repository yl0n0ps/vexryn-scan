// Exact static rules over agent-config values and agent-loaded text. Pure
// functions, no I/O, own regexes (public token formats, plain phrases — no
// copied rule files). A match is a FACT the review states ("contains the
// phrase …", "is a literal value", "runs a shell with inline code"), never a
// verdict: the reader decides.

import path from "node:path";

// --- Hidden text --------------------------------------------------------------

/**
 * Zero-width, BOM, bidi embeddings/overrides/isolates (the "Trojan Source"
 * set), Unicode tag characters. Not LRM/RLM (U+200E/F): ordinary marks in
 * right-to-left text.
 */
const HIDDEN = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]|[\u{E0000}-\u{E007F}]/gu;
/** A zero-width joiner inside an emoji sequence (👨‍👩‍👧) is how emoji are written. */
const EMOJI_ZWJ = /(\p{Extended_Pictographic}\uFE0F?)\u200D(?=\p{Extended_Pictographic})/gu;

/** Count of characters a reviewer cannot see (a file's leading BOM and emoji joiners excluded). */
export function hiddenChars(text: string): number {
  const t = text.replace(/^\uFEFF/, "").replace(EMOJI_ZWJ, "$1");
  return (t.match(HIDDEN) ?? []).length;
}

/** Instruction-override / hidden-behaviour phrases. Reported as "contains the phrase". */
const PHRASES = [
  /(?:ignore|disregard|forget) (?:all |any |the )?(?:previous|prior|above|earlier) instructions/i,
  /do not (?:tell|mention|reveal|show|disclose)(?: (?:this|it|that|anything))?(?: to)? the user/i,
  /without (?:telling|informing|asking|notifying) the user/i,
  /(?:additionally|secretly|silently|covertly) (?:sends?|collects?|uploads?|forwards?|exfiltrates?|logs?)/i,
  /also (?:collects?|uploads?|exfiltrates?)/i,
  /<important>/i,
  /before (?:using|calling|running) (?:this|any|the) tool/i,
];

/** The phrases found, in text order (each pattern once). */
export function overridePhrases(text: string): string[] {
  const hits: Array<{ at: number; phrase: string }> = [];
  for (const re of PHRASES) {
    const m = text.match(re);
    if (m && m.index !== undefined) hits.push({ at: m.index, phrase: m[0] });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.phrase);
}

/** Lengths of long base64/hex-looking runs (encoded payloads, not ids). */
export function blobs(text: string): number[] {
  return [...text.matchAll(/[A-Za-z0-9+/=]{200,}|[0-9a-fA-F]{200,}/g)].map((m) => m[0].length);
}

// --- Server launch commands ---------------------------------------------------

const SHELLS = /^(?:(?:ba|z|da|k|fi)?sh|cmd|pwsh|powershell|python(?:\d+(?:\.\d+)?)?|node|deno|bun)$/i;
const INLINE_FLAG = /^-{1,2}(?:c|e|eval|command|lc|ic|ec)$/i;

/**
 * A shell/interpreter told to run inline code (`bash -c`, `node -e`,
 * `pwsh -Command`), or `npx -c`. MCP clients spawn servers without a shell,
 * so `&&` or `|` in the args of any other program is passed to it literally
 * and runs nothing.
 */
export function shellInline(command: string, args: string[]): boolean {
  const bin = path.posix.basename(command.replace(/\\/g, "/")).replace(/\.(?:exe|cmd|bat)$/i, "");
  if (bin === "npx") return args.some((a) => a === "-c" || a === "--call");
  return SHELLS.test(bin) && args.some((a) => INLINE_FLAG.test(a));
}

const ROOTS = new Set(["/", "~", "~/", "$HOME", "${HOME}", "C:\\", "C:/"]);
const SENSITIVE =
  /(?:^|\/)\.ssh(?:\/|$)|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?$|(?:^|\/)\.aws(?:\/|$)|(?:^|\/)\.env(?:\.(?!(?:example|sample|template|dist)$)[\w.-]+)?$|\.(?:pem|key|p12|pfx|jks)$|credentials\.json$|(?:^|\/)\.gnupg(?:\/|$)|(?:^|\/)\.kube(?:\/|$)|(?:^|\/)\.docker\/config\.json$|(?:^|\/)\.netrc$/i;

/** Args that name a whole filesystem/home, or a credential-bearing path. */
export function sensitivePaths(args: string[]): string[] {
  return args.filter((a) => ROOTS.has(a) || SENSITIVE.test(a));
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "::1"]);

/** Unencrypted http to a host that is not the machine itself. */
export function plainHttpRemote(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && !LOOPBACK.has(u.hostname) && !u.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

// --- Secrets ------------------------------------------------------------------

/**
 * A name (env var, header, flag) that says it holds a secret: one of its words
 * is TOKEN/KEY/SECRET/PASSWORD… or ends with one (APIKEY), or is exactly
 * AUTH/AUTHORIZATION/CREDENTIAL(S)/COOKIE/SESSION/PASS. Word-based, so
 * KEYBOARD and TOKENIZER are not secrets.
 */
export function secretName(name: string): boolean {
  return name
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter(Boolean)
    .some((w) => /^(?:\w*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|PWD)|AUTH|AUTHORIZATION|CREDENTIALS?|COOKIE|SESSION|PASS)$/.test(w.toUpperCase()));
}

/** Well-known credential formats (public prefixes), matched anywhere in text. */
export const TOKEN_SHAPE =
  /\b(?:gh[pousr]_\w{8,}|github_pat_\w{8,}|glpat-[\w-]{8,}|sk-[\w-]{8,}|sk_(?:live|test)_\w{8,}|xox[abeoprs]-[\w-]{8,}|AKIA[0-9A-Z]{12,}|AIza[\w-]{20,}|ya29\.[\w-]{20,}|npm_[A-Za-z0-9]{8,})|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S{16,}/;

/** A value that is a reference (`${VAR}`, `$VAR`, `%VAR%`), not a literal. */
const REFERENCE = /^(?:\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)$/;

/** Obvious stand-ins that are not credentials. */
const PLACEHOLDER =
  /^(?:<.*>|\[.*\]|\{\{.*\}\}|x+|\*+|\.{3,}|change[-_ ]?me|placeholder|todo|tbd|example|dummy|sample|redacted|none|null|undefined)$|your[-_ ]|[-_ ]here$|paste|replace[-_ ]?me|insert[-_ ]/i;

/** Values that are clearly not credentials even under a secret-sounding name. */
const NOT_SECRET = [
  /^[a-z][a-z0-9+.-]*:\/\/[^\s@]+$/i, // a URL without userinfo
  /^(?:[.~]?\/|[A-Za-z]:[\\/])/, // a path
  /^\d+(?:\.\d+)?[a-z]{0,3}$/i, // a number, maybe with a unit (30s, 512mb)
  /^(?:true|false|yes|no|on|off)$/i, // a boolean
];

/** An env/header value that is a credential written into the file. */
export function secretLiteral(name: string, value: string): boolean {
  if (!value || REFERENCE.test(value) || PLACEHOLDER.test(value)) return false;
  if (TOKEN_SHAPE.test(value)) return true;
  if (!secretName(name) || NOT_SECRET.some((re) => re.test(value))) return false;
  // A secret-named var holding a long literal with more than plain lowercase words.
  return value.length >= 8 && /\d|[A-Z]|[^\w\s]/.test(value);
}

/** A credential shape inside free text: args, URLs (userinfo password), commands. */
export function secretInText(text: string): boolean {
  return TOKEN_SHAPE.test(text) || /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i.test(text);
}
