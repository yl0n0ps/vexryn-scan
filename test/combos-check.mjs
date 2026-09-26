#!/usr/bin/env node
// Dangerous combinations: exact rules over an agent's tool powers, stated as facts.
import assert from "node:assert/strict";
import { combinations } from "../dist/scan/combos.js";

const leak = /read web pages, read your files and send them out/;
assert.equal(combinations([]).length, 0);
assert.equal(combinations(["network.fetch", "file.read"]).length, 0, "no way out, no leak");
assert.equal(combinations(["file.read", "external-message.send"]).length, 0, "nothing untrusted comes in");
assert.match(combinations(["network.fetch", null, "file.read", "external-message.send"]).join("\n"), leak);
assert.match(combinations(["network.fetch", "file.read", "file.share"]).join("\n"), leak, "sharing a file is a way out");
assert.match(combinations(["network.fetch", "shell.exec"]).join("\n"), /read web pages and run shell commands/);
assert.equal(combinations(["network.fetch", "shell.exec", "file.read", "external-message.send"]).length, 2);
console.log("combos-check: all assertions passed");
