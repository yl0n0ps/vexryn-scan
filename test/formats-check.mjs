#!/usr/bin/env node
// Reading the new agents' config formats (TOML, YAML) and normalizing every
// agent's server shape into the one Vexryn already understands. Pure, offline.
import assert from "node:assert/strict";
import { readToml, readYaml } from "../dist/scan/formats.js";
import { serversFromConfig } from "../dist/scan/parse.js";

// --- tolerant readers -------------------------------------------------------
// smol-toml returns null-prototype objects; compare content, not prototype.
assert.deepEqual(JSON.parse(JSON.stringify(readToml('[mcp_servers.x]\ncommand = "node"\n'))), { mcp_servers: { x: { command: "node" } } });
assert.equal(readToml("this is = = not toml"), null, "invalid TOML → null, no throw");
assert.deepEqual(readYaml("a: 1\n"), { a: 1 });
assert.equal(readYaml(": : ["), null, "invalid YAML → null, no throw");

const one = (kind, obj) => {
  const s = serversFromConfig(kind, obj);
  assert.equal(s.length, 1, `${kind}: expected 1 server, got ${s.length}`);
  return s[0];
};

// --- Codex TOML -------------------------------------------------------------
let toml = readToml(`
[history]
persistence = "save-all"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789" }

[mcp_servers.docs]
url = "https://mcp.example.test/docs"
bearer_token_env_var = "DOCS_TOKEN"
`);
let servers = serversFromConfig("codex-toml", toml);
assert.equal(servers.length, 2, "the unrelated [history] table is not a server");
const gh = servers.find((s) => s.name === "github");
assert.equal(gh.transport, "stdio");
assert.equal(gh.target, "npx -y @modelcontextprotocol/server-github");
assert.deepEqual(gh.literalSecrets, ["GITHUB_TOKEN"], "a literal token in Codex env is flagged");
const docs = servers.find((s) => s.name === "docs");
assert.equal(docs.transport, "http");
assert.ok(docs.receives.includes("DOCS_TOKEN"), "the bearer-token env var name is surfaced, value never read");

// --- OpenCode: command is an ARRAY, env under `environment` -----------------
const oc = one("opencode", { mcp: { fs: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/"], environment: { FOO: "${FOO}" } } } });
assert.equal(oc.command, "npx", "first array element is the command");
assert.deepEqual(oc.args, ["-y", "@modelcontextprotocol/server-filesystem", "/"], "the rest are args");
assert.ok(oc.receives.includes("FOO"));
const ocRemote = one("opencode", { mcp: { d: { type: "remote", url: "http://docs.internal.test/mcp" } } });
assert.equal(ocRemote.transport, "http");
assert.equal(ocRemote.target, "http://docs.internal.test/mcp");

// --- Zed: context_servers ---------------------------------------------------
const zed = one("zed", { context_servers: { srv: { command: "node", args: ["s.js"] } } });
assert.equal(zed.target, "node s.js");
// a Zed file without context_servers (only rules/settings) yields no servers, no crash
assert.deepEqual(serversFromConfig("zed", { theme: "One Dark" }), []);

// --- Goose: extensions, cmd/uri, env_keys names only ------------------------
const goose = one("goose", { extensions: { git: { type: "stdio", cmd: "uvx", args: ["mcp-server-git"], env_keys: ["GIT_TOKEN"] } } });
assert.equal(goose.target, "uvx mcp-server-git");
assert.ok(goose.receives.includes("GIT_TOKEN"), "env_keys names are surfaced");
const gooseHttp = one("goose", { extensions: { docs: { type: "streamable_http", uri: "https://docs.test/mcp" } } });
assert.equal(gooseHttp.transport, "http");
assert.equal(gooseHttp.target, "https://docs.test/mcp");
// a builtin extension is not an MCP server we can name a command for
assert.deepEqual(serversFromConfig("goose", { extensions: { developer: { type: "builtin", name: "developer" } } }), []);

// --- Continue: mcpServers is a LIST -----------------------------------------
const cont = one("continue-yaml", { mcpServers: [{ name: "search", command: "node", args: ["s.js"], env: { KEY: "sk-abcdefghijklmnopqrstuvwxyz0123" } }] });
assert.equal(cont.name, "search");
assert.equal(cont.target, "node s.js");
assert.deepEqual(cont.literalSecrets, ["KEY"]);

// Continue also accepts a copied Claude/Cursor JSON (mcpServers as an OBJECT)
const contObj = one("continue-yaml", { mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] } } });
assert.equal(contObj.name, "github");
assert.equal(contObj.target, "npx -y @modelcontextprotocol/server-github");
// and a bare single-server file (no mcpServers wrapper)
const contBare = one("continue-yaml", { name: "solo", command: "node", args: ["s.js"] });
assert.equal(contBare.name, "solo");
assert.equal(contBare.target, "node s.js");

// --- the VS Code family: plain mcpServers object ----------------------------
for (const kind of ["copilot-cli", "cline", "roo-mcp", "kiro"]) {
  const s = one(kind, { mcpServers: { x: { command: "node", args: ["x.js"] } } });
  assert.equal(s.target, "node x.js", kind);
}

console.log("formats-check: all assertions passed");
