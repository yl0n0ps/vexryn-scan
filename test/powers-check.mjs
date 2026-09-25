#!/usr/bin/env node
// The power classifier: a tool maps to a power only when verb + noun + argument
// shape agree; otherwise null. Refusal cases come first — they are the point.
import assert from "node:assert/strict";
import { classifyTool, argNames, powerLabels } from "../dist/scan/powers.js";

const t = (name, description, args) => ({
  name,
  description,
  inputSchema: { type: "object", properties: Object.fromEntries(args.map((a) => [a, { type: "string" }])) },
});

// Refused (from Ferrum's tests + everyday look-alikes)
for (const tool of [
  t("org.secretary.schedule", "Assign a secretary to update the meeting notes", ["attendee"]),
  t("search.tokenizer.update", "Update the text tokenizer used for search indexing", ["text"]),
  t("cache.invalidate", "Remove a cached entry by id", ["id"]),
  t("sys.webadm", "Administer the web admin panel", ["to"]),
  t("weather.lookup", "Get the current weather", ["city"]),
  t("agent.memory.read", "Read previously persisted content from the agent's memory/notes store.", ["key"]),
  t("agent.memory.act", "Take an action whose content is sourced from the agent's memory/notes store.", ["recipient", "content"]),
  t("cron.tasks.fire", "Fire a previously scheduled task, performing its action.", ["scheduleId", "recipient", "content"]),
  t("run_query", "Run a read-only SQL query against the configured database and return rows.", ["sql"]),
  t("search_issues", "Search issues in a repository by text query, labels, author, and state.", ["query", "state"]),
  t("create_pull_request", "Open a pull request from a head branch into a base branch with a title and body.", ["title", "body", "head", "base"]),
  t("list_commits", "Get list of commits of a branch, one page at a time", ["page", "perPage"]),
  t("get_issue", "Get details of an issue", ["issue_number"]),
]) assert.equal(classifyTool(tool), null, `${tool.name} must not classify`);

// Mapped
const cases = [
  [t("wise.transfers.send", "Send money to a recipient", ["destination", "amount"]), "payment.transfer"],
  [t("zendesk.tickets.reply", "Reply to a customer support ticket", ["to", "body"]), "external-message.send"],
  [t("send_email", "Send an email notification to a recipient address with a subject and message body.", ["to", "subject", "body"]), "external-message.send"],
  [t("auth.password.reset", "Reset a user account password", ["account", "new_password"]), "credential.change"],
  [t("crm.records.delete", "Delete a customer record permanently", ["record_id"]), "data.delete"],
  [t("crm.records.delete", "Permanently delete a stored record by id", ["recordId"]), "data.delete"],
  [t("drive.files.share", "Share a file's contents with a recipient.", ["recipient", "content"]), "file.share"],
  [t("iam.roles.grant", "Grant the agent a scope.", ["scope"]), "permission.escalate"],
  [t("cron.tasks.create", "Schedule a task to run later on a trigger.", ["scheduleId", "trigger", "recipient", "payload"]), "schedule.create"],
  [t("agent.memory.write", "Persist content into the agent's persistent memory/notes store.", ["key", "content"]), "memory.write"],
  [t("read_file", "Read the contents of a file at a path within the repository.", ["path"]), "file.read"],
  [t("list_directory", "List the contents of a directory", ["path"]), "file.read"],
  [t("get_file_contents", "Get the contents of a file or directory from a GitHub repository", ["owner", "repo", "path"]), "file.read"],
  [t("write_file", "Create a new file or overwrite an existing file", ["path", "content"]), "file.write"],
  [t("edit_file", "Make line-based edits to a text file", ["path", "edits"]), "file.write"],
  [t("move_file", "Move or rename files and directories", ["source", "destination"]), "file.write"],
  [t("execute_command", "Execute a shell command", ["command"]), "shell.exec"],
  [t("bash", "Executes a given bash command in a persistent shell session", ["command", "timeout"]), "shell.exec"],
  [t("fetch", "Fetches a URL from the internet and extracts its contents as markdown", ["url"]), "network.fetch"],
  [t("web_search", "Search the web for a query", ["query"]), "network.fetch"],
  [t("browser_navigate", "Navigate the browser to a URL", ["url"]), "network.fetch"],
];
for (const [tool, power] of cases) assert.equal(classifyTool(tool), power, `wrong power for ${tool.name}`);

// Robustness: no schema / odd schema → no args, no crash
assert.deepEqual(argNames(undefined), []);
assert.deepEqual(argNames({ type: "object", properties: "nope" }), []);
assert.equal(classifyTool({ name: "read_file", description: "Read a file at a path" }), null, "no args → no anchor → null");

// Labels: distinct, display order, nulls dropped
assert.deepEqual(powerLabels(["file.read", null, "external-message.send", "file.read"]), [
  "send messages to external recipients",
  "read files",
]);
console.log("powers-check: all assertions passed");
