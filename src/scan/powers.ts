// Deterministic power classifier: a tool's name + description + argument names
// → ONE power, only when a verb, a noun and an argument shape all agree;
// otherwise null. No model, no guess. Ported from our own Rust autoconfig.rs
// (Ferrum) with the same discipline and refusal cases, plus four everyday
// powers a developer reads at a glance.
//
// The tool NAME decides first (its verb and its object: read_file, slack_post_message,
// exec_in_pod); the description only backs it up. Tuned on the real tools of the
// catalogue run of 2026-09-26, where a word in passing ("prefer this over
// execute_command", "from file", a `command` sub-command argument) misled a
// description-wide match.

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
  "shell.exec": "run commands or code",
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
  // A word must START a word in the text: "prune" is not "run", "budget" is not "get"; "executes" still is "execute".
  const has = (...words: string[]) => words.some((w) => new RegExp(`(?:^|[^a-z])${w}`).test(text));
  const arg = (...names: string[]) => names.some((n) => args.includes(n));
  const name = nameWords(tool.name);
  const nameHas = (...words: string[]) => words.some((w) => name.includes(w));

  // — the eight prohibited effects, verbatim from autoconfig.rs —
  if (has("transfer", "send money", "payment", "payout") && arg("amount", "value", "sum")) return "payment.transfer";
  // needs an account/secret-shaped arg: "secretary" ≠ secret, "tokenizer" ≠ token
  if (
    has("password", "credential", "secret", "api key", "token") &&
    has("reset", "change", "rotate", "update") &&
    arg("account", "user", "username", "login", "newsecret", "new_secret", "new_password", "password", "secret")
  )
    return "credential.change";
  // a bare `id` is NOT enough: cache/session/temp cleanups "remove by id" too; and a name that
  // deletes something else (remove_label) isn't deleting the record it takes.
  const otherObject = nameHas(...DELETE_V) && !nameHas(...DATA_N) && name.some((w) => !DELETE_V.includes(w) && !GENERIC.includes(w));
  if (has("delete", "remove", "purge", "erase") && arg("recordid", "record_id", "record", "resource_id") && !otherObject) return "data.delete";
  if (has("share", "attach") && has("file", "document", "attachment") && arg("recipient", "to", "content")) return "file.share";
  if (has("grant", "escalate", "elevate") && (has("scope", "permission", "privilege", "role") || arg("scope"))) return "permission.escalate";
  if (has("schedule", "cron") && arg("scheduleid", "schedule_id") && (has("create", "later", "defer") || arg("trigger", "payload")))
    return "schedule.create";
  if (has("memory", "notes") && arg("key") && arg("content", "value") && has("save", "store", "persist", "write", "remember"))
    return "memory.write";
  // "email" is not a send verb: find_contact_by_email(email) reads.
  const sendName = nameHas("send", "post", "reply", "notify", "publish", "forward", "sms") || (nameHas("add", "create") && nameHas("comment", "message", "reply"));
  if (sendName && arg(...RECIPIENT, "body", "message", "text", "content")) return "external-message.send";
  // Whole word: "sender" and "sendgrid" are not "send".
  if (/(?:^|[^a-z])(?:send|sends|sending)(?![a-z])/.test(text) && arg(...RECIPIENT)) return "external-message.send";

  // A knowledge-graph / memory store the agent writes to (the key+content shape is above).
  if (has("knowledge graph", "memory") && nameHas(...WRITE_V) && !nameHas(...READ_V)) return "memory.write";
  // Deleting stored data: a delete verb in the name, a data object in the name or description.
  // Not stored data: an index, a cache, a session, temp files or logs.
  // The description names the data only when the name has no object of its own (delete-many);
  // remove_label acts on a label, not on the record the description mentions.
  const nameObject = name.some((w) => !DELETE_V.includes(w) && !GENERIC.includes(w));
  if (nameHas(...DELETE_V) && !nameHas("index", "indexes", "cache", "session", "sessions", "temp", "tmp", "log", "logs") && (nameHas(...DATA_N) || (!nameObject && has(...DATA_N))))
    return "data.delete";

  // — everyday powers: the name decides —
  // Run commands or code: a run verb in the name, and a command/code object in the name or arguments.
  if (nameHas(...EXEC_V) && (nameHas("command", "commands", "shell", "bash", "terminal", "process", "script", "code", "cmd") || arg("command", "cmd", "script", "code")))
    return "shell.exec";
  if (nameHas("bash", "shell", "terminal") && arg("command", "cmd")) return "shell.exec";
  if (nameHas("interact") && nameHas("process", "terminal", "shell")) return "shell.exec";

  // Files: the name must be about files; its verb says read or write.
  const pathArg = arg("path", "paths", "file", "files", "filepath", "file_path", "filename", "file_name", "directory", "dir", "source", "destination");
  if (nameHas("file", "files", "directory", "directories", "dir", "folder", "folders", "path", "paths", "filesystem", "fs") && pathArg) {
    // Uploading local files sends them out: a way out, not a write.
    if (nameHas("upload", "share", "attach")) return "file.share";
    if (nameHas(...WRITE_V, ...DELETE_V)) return "file.write";
    if (nameHas(...READ_V)) return "file.read";
  }

  // Network: a fetch verb or web object in the name with a URL argument; a web search; or a
  // description that says it fetches a URL.
  const urlArg = arg("url", "urls", "uri", "link", "links", "href", "endpoint");
  if (urlArg && nameHas("fetch", "navigate", "browse", "crawl", "scrape", "download", "visit", "goto", "extract", "web", "url", "urls", "page", "webpage", "site", "website", "browser", "internet"))
    return "network.fetch";
  if (nameHas("search") && (nameHas("web", "internet") || has("web search", "the web", "internet")) && arg("query", "q", "queries")) return "network.fetch";
  if (urlArg && has("fetch", "download", "scrape", "crawl") && has("url", "web page", "webpage", "internet", "website")) return "network.fetch";
  return null;
}

const READ_V = ["get", "read", "list", "search", "find", "query", "view", "show", "describe", "retrieve", "open", "cat", "stat", "inspect", "tree", "info", "head", "tail", "lookup"];
const WRITE_V = ["write", "create", "edit", "update", "patch", "put", "set", "add", "insert", "upsert", "append", "save", "move", "rename", "copy", "apply", "push", "commit", "modify", "replace", "store", "persist", "remember"];
const DELETE_V = ["delete", "remove", "drop", "purge", "erase", "destroy", "wipe", "rm", "unlink"];
const EXEC_V = ["run", "exec", "execute", "spawn", "launch", "start"];
const GENERIC = ["many", "all", "one", "by", "id", "ids", "a", "an", "the", "api"];
const RECIPIENT = ["to", "recipient", "recipients", "email", "channel", "channel_id", "channelid", "phone", "thread_ts"];
const DATA_N = ["record", "records", "row", "rows", "document", "documents", "collection", "collections", "table", "tables", "database", "databases", "entity", "entities", "block", "blocks", "observation", "observations", "relation", "relations"];

/** A tool name's words: snake_case, kebab-case, dotted and camelCase split, lowercased. */
function nameWords(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Distinct plain-English labels of a set of powers, in display order. */
export function powerLabels(powers: (Power | null | undefined)[]): string[] {
  const set = new Set(powers.filter((p): p is Power => !!p));
  return (Object.keys(POWER_LABEL) as Power[]).filter((p) => set.has(p)).map((p) => POWER_LABEL[p]);
}
