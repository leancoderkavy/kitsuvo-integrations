# Install Kitsuvo MCP

Install the native browser only from https://kitsuvo.com on Windows or macOS.
Use command kitsuvo and args ["mcp"], or the full installed executable path.
Merge the relevant client example into existing config; preserve other servers.
Args ["mcp"] use the normal signed-in browser profile; ["mcp", "--separate-profile"] keeps a separate one.
Tell the user which profile you configured. Never add --allow-sensitive.
After installation, list tools, call browser_tabs with action list, navigate to https://example.com,
and read browser_snapshot and kitsuvo_report. Explain evidence uncertainty.
Do not claim a successful install from a config file alone.
For remote clients start integrations/mcp-cloud/connect.mjs after npm ci --ignore-scripts,
then opt in and approve the specific OAuth request in the terminal. Keep it running.
Cloud clients cannot run a local executable. No shared owner browser is provided.

For design/layout tasks, discover browser_design in tools/list. Call op:help for
its short contract. query finds targets, inspect reads snapshot refs or batches
of selectors, and measure returns CSS-pixel edge gaps. Compact JSON and matching
structuredContent include units, viewport coordinates, document/tab identity and
error recovery hints. Snapshot context.design identifies the user's selection.
Read operations do not alter pages. Style/text operations are reversible local
previews; close keeps edits, undo/revert restores them, and reload discards them.
