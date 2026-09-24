// Exact static rules over agent-config values and agent-loaded text. Pure
// functions, no I/O, own regexes (public token formats, plain phrases — no
// copied rule files). A match is a FACT the review states ("contains the
// phrase …", "is a literal value", "runs a shell with inline code"), never a
// verdict: the reader decides.

import path from "node:path";

// --- Hidden text --------------------------------------------------------------

/** Zero-width, BOM, bidi controls/isolates, Unicode tag characters. */
const HIDDEN = /[\u200B-\u200F\u2060\uFEFF\u202A-\u202E\u2066-\u2069]|[\u{E0000}-\u{E007F}]/gu;

/** Count of characters a reviewer cannot see. */
export function hiddenChars(text: string): number {
  return (text.match(HIDDEN) ?? []).length;
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
const FETCHERS = /\b(?:curl|wget|base64|nc|telnet)\b/i;
const CHAINING = /(?:^|\s)(?:&&|\|\||;)(?:\s|$)|\|\s*(?:ba|z|da|k)?sh\b/;

/** A shell/interpreter given inline code, a fetcher, or any command chaining. */
export function shellInline(command: string, args: string[]): boolean {
  const joined = args.join(" ");
  if (CHAINING.test(joined)) return true;
  const bin = path.posix.basename(command.replace(/\\/g, "/")).replace(/\.(?:exe|cmd|bat)$/i, "");
  if (!SHELLS.test(bin)) return false;
  return args.some((a) => INLINE_FLAG.test(a)) || FETCHERS.test(joined);
}

const ROOTS = new Set(["/", "~", "~/", "$HOME", "${HOME}", "C:\\", "C:/"]);
const SENSITIVE =
  /(?:^|\/)\.ssh(?:\/|$)|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?$|(?:^|\/)\.aws(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|jks)$|credentials\.json$|(?:^|\/)\.gnupg(?:\/|$)|(?:^|\/)\.kube(?:\/|$)|(?:^|\/)\.docker\/config\.json$|(?:^|\/)\.netrc$/i;

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

export const SECRET_NAME = /token|key|secret|passw|auth|credential|cookie|session/i;

/** Well-known credential formats (public prefixes), matched anywhere in text. */
export const TOKEN_SHAPE =
  /\b(?:gh[pousr]_\w{8,}|github_pat_\w{8,}|glpat-[\w-]{8,}|sk-[\w-]{8,}|sk_(?:live|test)_\w{8,}|xox[abeoprs]-[\w-]{8,}|AKIA[0-9A-Z]{12,}|AIza[\w-]{20,}|ya29\.[\w-]{20,}|npm_[A-Za-z0-9]{8,})|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S{16,}/;

/** A value that is a reference (`${VAR}`, `$VAR`, `%VAR%`), not a literal. */
const REFERENCE = /^(?:\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)$/;

/** Obvious stand-ins that are not credentials. */
const PLACEHOLDER =
  /^(?:<.*>|\[.*\]|\{\{.*\}\}|x+|\*+|\.{3,}|change[-_ ]?me|placeholder|todo|tbd|example|dummy|sample|redacted|none|null|undefined)$|your[-_ ]|[-_ ]here$|paste|replace[-_ ]?me|insert[-_ ]/i;

/** An env/header value that is a credential written into the file. */
export function secretLiteral(name: string, value: string): boolean {
  if (!value || REFERENCE.test(value) || PLACEHOLDER.test(value)) return false;
  if (TOKEN_SHAPE.test(value)) return true;
  if (!SECRET_NAME.test(name)) return false;
  // A secret-named var holding a long literal with more than plain lowercase words.
  return value.length >= 8 && /\d|[A-Z]|[^\w\s]/.test(value);
}

/** A credential shape inside free text: args, URLs (userinfo password), commands. */
export function secretInText(text: string): boolean {
  return TOKEN_SHAPE.test(text) || /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i.test(text);
}
