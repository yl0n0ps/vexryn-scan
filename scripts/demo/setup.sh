# Sourced, hidden, by demo.tape: a throwaway world for the README demo.
# It lives OUTSIDE your home on purpose: Claude Code reads the CLAUDE.md files of
# parent folders, so a demo under ~ would show your own instructions.
VX_REPO="$(pwd)"
VX_DEMO="$(mktemp -d)"
cp -R "$VX_REPO/fixtures/demo" "$VX_DEMO/acme-app"
rm -rf "$VX_DEMO/acme-app/.vexryn"
mkdir -p "$VX_DEMO/agents-lab/tools" "$VX_DEMO/home"

# Two local MCP servers for `--deep` (the repo's offline mock; nothing downloaded),
# slow to start like real ones so the spinner is visible.
for s in issues:0 browser:1; do
  name="${s%%:*}"; fetch="${s##*:}"
  cat > "$VX_DEMO/agents-lab/tools/$name-mcp.mjs" <<JS
await new Promise((r) => setTimeout(r, 1400));
if ($fetch) process.env.MOCK_FETCH = "1";
await import("$VX_REPO/fixtures/mock-mcp-server.mjs");
JS
done
cat > "$VX_DEMO/agents-lab/.mcp.json" <<JSON
{ "mcpServers": {
  "issues": { "command": "node", "args": ["tools/issues-mcp.mjs"] },
  "browser": { "command": "node", "args": ["tools/browser-mcp.mjs"] }
} }
JSON

export VEXRYN_HOME="$VX_DEMO/home"   # no user-wide config of this machine is read
export BASH_SILENCE_DEPRECATION_WARNING=1
export PS1='\[\e[38;2;139;147;172m\]\W\[\e[0m\] \[\e[38;2;74;144;255m\]❯\[\e[0m\] '
npx -y vexryn --version >/dev/null 2>&1   # warm the npx cache for this exact spec: no install prompt on camera
cd "$VX_DEMO/acme-app"
