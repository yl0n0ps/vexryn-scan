// Deterministic power classifier: a tool's name + description + argument names
// → ONE power, only when a verb, a noun and an argument shape all agree;
// otherwise null. No model, no guess. Ported from our own Rust autoconfig.rs
// (Ferrum) with the same discipline and refusal cases, plus four everyday
// powers a developer reads at a glance.

export type Power =
  | "payment.transfer"
  | "credential.change"
  | "data.delete"
  | "file.share"
  | "permission.escalate"
  | "schedule.create"
  | "memory.write"
  | "external-message.send"
  | "file.read"
  | "file.write"
  | "shell.exec"
  | "network.fetch";

/** Plain-English labels, in display order (the eight prohibited effects first). */
export const POWER_LABEL: Record<Power, string> = {
  "payment.transfer": "move money",
  "credential.change": "change passwords or credentials",
  "data.delete": "delete records",
  "file.share": "share files with a recipient",
  "permission.escalate": "grant permissions",
  "schedule.create": "schedule tasks to run later",
  "memory.write": "write to the agent's memory",
  "external-message.send": "send messages to external recipients",
  "file.read": "read files",
  "file.write": "create, edit or delete files",
  "shell.exec": "run shell commands",
  "network.fetch": "access the network",
};

export interface ToolShape {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Argument names = keys of the schema's `properties`, or [] for anything odd. */
export function argNames(inputSchema: unknown): string[] {
  const props = (inputSchema as { properties?: unknown } | null | undefined)?.properties;
  return props && typeof props === "object" && !Array.isArray(props) ? Object.keys(props) : [];
}

export function classifyTool(tool: ToolShape): Power | null {
  const text = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
  const args = argNames(tool.inputSchema).map((a) => a.toLowerCase());
  const has = (...words: string[]) => words.some((w) => text.includes(w));
  const arg = (...names: string[]) => names.some((n) => args.includes(n));

  // — the eight prohibited effects, verbatim from autoconfig.rs —
  if (has("transfer", "send money", "payment", "payout") && arg("amount", "value", "sum")) return "payment.transfer";
  // needs an account/secret-shaped arg: "secretary" ≠ secret, "tokenizer" ≠ token
  if (
    has("password", "credential", "secret", "api key", "token") &&
    has("reset", "change", "rotate", "update") &&
    arg("account", "user", "username", "login", "newsecret", "new_secret", "new_password", "password", "secret")
  )
    return "credential.change";
  // a bare `id` is NOT enough: cache/session/temp cleanups "remove by id" too
  if (has("delete", "remove", "purge", "erase") && arg("recordid", "record_id", "record", "resource_id")) return "data.delete";
  if (has("share", "attach") && has("file", "document", "attachment") && arg("recipient", "to", "content")) return "file.share";
  if (has("grant", "escalate", "elevate") && (has("scope", "permission", "privilege", "role") || arg("scope"))) return "permission.escalate";
  if (has("schedule", "cron") && arg("scheduleid", "schedule_id") && (has("create", "later", "defer") || arg("trigger", "payload")))
    return "schedule.create";
  if (has("memory", "notes") && arg("key") && arg("content", "value") && has("save", "store", "persist", "write", "remember"))
    return "memory.write";
  if (has("send", "reply", "message", "email", "notify") && arg("to", "recipient", "body", "message", "text")) return "external-message.send";

  // — everyday powers, same discipline —
  const pathArg = arg("path", "file", "files", "filepath", "file_path", "filename", "file_name", "directory", "dir", "source", "destination");
  const fileNoun = has("file", "directory", "directories", "folder", "path");
  if (
    has("run", "execute", "exec", "launch", "spawn", "start") &&
    has("command", "shell", "bash", "terminal", "script", "process") &&
    arg("command", "cmd", "script", "args", "argv")
  )
    return "shell.exec";
  if (has("write", "create", "edit", "save", "move", "copy", "rename", "delete", "remove", "append", "overwrite") && fileNoun && pathArg)
    return "file.write";
  if (has("read", "get", "list", "cat", "open", "view", "show", "search") && fileNoun && pathArg) return "file.read";
  if (
    has("fetch", "download", "open", "navigate", "browse", "request", "crawl", "scrape", "search", "visit", "load") &&
    has("url", "web", "internet", "http", "website", "browser") &&
    arg("url", "uri", "link", "href", "endpoint", "query")
  )
    return "network.fetch";
  return null;
}

/** Distinct plain-English labels of a set of powers, in display order. */
export function powerLabels(powers: (Power | null | undefined)[]): string[] {
  const set = new Set(powers.filter((p): p is Power => !!p));
  return (Object.keys(POWER_LABEL) as Power[]).filter((p) => set.has(p)).map((p) => POWER_LABEL[p]);
}
