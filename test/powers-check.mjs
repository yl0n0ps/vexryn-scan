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
  // a verb must start a word: "prune" is not "run", "restart" is not "start", "budget"/"target" are not "get"
  t("prune_processes", "Prune stale process entries", ["command"]),
  t("budget_report", "Show the budget target for a directory", ["path"]),
  t("restart_daemon", "Restart the background process", ["cmd"]),
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

// Real tools from the Vexryn catalogue run (2026-09-26): name, argument names, first words of the
// description. These pin the name-first rules on what real servers actually expose.
const real = [
  // wrong before: a word in the description decided
  [t("read_file", "Read contents from files and URLs. Prefer this over 'execute_command' with cat/type for viewing files.", ["path", "isUrl", "offset", "length"]), "file.read"],
  [t("write_file", "Write or append to file contents. IMPORTANT: DO NOT use this tool to create PDF files.", ["path", "content", "mode"]), "file.write"],
  [t("kubectl_create", "Create Kubernetes resources using various methods (from file or using subcommands)", ["manifest", "filename", "resourceType", "name", "command"]), null],
  [t("kubectl_delete", "Delete Kubernetes resources by resource type, name, labels, or from a manifest file", ["resourceType", "name", "manifest", "filename"]), null],
  [t("aks", "Azure Kubernetes Service operations - Manage and query Azure Kubernetes Service (AKS) resources", ["intent", "command", "parameters", "learn"]), null],
  [t("monitor", "Monitor operations - Commands for managing Azure Monitor workspaces, querying logs", ["intent", "command", "parameters", "learn"]), null],
  [t("report-problem", "Report a problem with Apify's MCP tools or Actors to the Apify team.", ["message", "actorId", "actorRunId"]), null],
  [t("runAccessibilityAudit", "Lighthouse accessibility audit of the current page. Launches a separate headless browser.", ["url", "tabId"]), null],
  // right before, must stay right
  [t("read_file", "Read the complete contents of a file as text.", ["path", "tail", "head"]), "file.read"],
  [t("get_file_info", "Retrieve detailed metadata about a file or directory.", ["path"]), "file.read"],
  [t("directory_tree", "Get a recursive tree view of files and directories as a JSON structure.", ["path"]), "file.read"],
  [t("start_process", "Start a new terminal process with intelligent state detection.", ["command", "timeout_ms", "shell"]), "shell.exec"],
  [t("exec_in_pod", "Execute a command in a Kubernetes pod or container and return the output.", ["name", "namespace", "command"]), "shell.exec"],
  [t("slack_post_message", "Post a new message to a Slack channel", ["channel_id", "text"]), "external-message.send"],
  [t("navigate", "Navigate to a URL", ["url"]), "network.fetch"],
  [t("fetch", "Fetches a URL from the internet and optionally extracts its contents as markdown.", ["url", "max_length"]), "network.fetch"],
  [t("brave_web_search", "Performs a web search using the Brave Search API.", ["query", "count"]), "network.fetch"],
  // missed before
  [t("read_multiple_files", "Read the contents of multiple files simultaneously.", ["paths"]), "file.read"],
  [t("add_issue_comment", "Add a comment to an existing issue", ["owner", "repo", "issue_number", "body"]), "external-message.send"],
  [t("create_entities", "Create multiple new entities in the knowledge graph", ["entities"]), "memory.write"],
  [t("delete-many", "Removes all documents that match the filter from a MongoDB collection", ["connectionId", "database", "collection", "filter"]), "data.delete"],
  [t("API-delete-a-block", "Notion | Delete a block", ["block_id"]), "data.delete"],
  [t("browser_run_code_unsafe", "Run a Playwright code snippet. Unsafe: executes arbitrary JavaScript.", ["code", "filename"]), "shell.exec"],
  [t("run_container", "Run an image in a new Docker container", ["image", "name", "command", "volumes"]), "shell.exec"],
  [t("web_fetch_exa", "Read a webpage's full content as clean markdown.", ["urls", "maxCharacters"]), "network.fetch"],
  [t("tavily_extract", "Extract content from URLs. Returns raw page content in markdown or text format.", ["urls", "extract_depth"]), "network.fetch"],
  [t("browser_file_upload", "Upload one or multiple files", ["paths"]), "file.share"],
  [t("interact_with_process", "Send input to a running process and automatically receive the response.", ["pid", "input"]), "shell.exec"],
  [t("firecrawl_interact", "Open or reuse a live browser session to navigate a page, click controls, fill fields, or run browser code. Provide either `url` or `scrapeId`.", ["scrapeId", "url", "prompt", "code"]), "network.fetch"],
  [t("drop-index", "Drop an index for the provided database and collection.", ["connectionId", "database", "collection", "indexName"]), null],
  // review findings (2026-09-26): look-alikes that must stay out
  [t("find_contact_by_email", "Find a CRM contact by email address", ["email"]), null],
  [t("list_messages", "List messages in a channel with their sender and timestamp", ["channel"]), null],
  [t("remove_label", "Remove a label from a record", ["record_id", "label"]), null],
  // stay out of the taxonomy on purpose
  [t("query", "Run a read-only SQL query", ["sql"]), null],
  [t("execute_sql", "Executes raw SQL in the Postgres database.", ["project_id", "query"]), null],
  [t("create_pull_request", "Create a new pull request in a GitHub repository", ["owner", "repo", "title", "body", "head", "base"]), null],
];
for (const [tool, power] of real) assert.equal(classifyTool(tool), power, `real tool ${tool.name} (${tool.description.slice(0, 40)}…)`);

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
