# Install Kitsuvo MCP

Install the native browser only from https://kitsuvo.com on Windows or macOS.
Use command kitsuvo and args ["mcp"], or the full installed executable path.
Merge the relevant client example into existing config; preserve other servers.
Local automation uses a separate profile. Never add --main-profile or --allow-sensitive.
After installation, list tools, call browser_tabs with action list, navigate to https://example.com,
and read browser_snapshot and kitsuvo_report. Explain evidence uncertainty.
Do not claim a successful install from a config file alone.
For remote clients start integrations/mcp-cloud/connect.mjs after npm ci --ignore-scripts,
then opt in and approve the specific OAuth request in the terminal. Keep it running.
Cloud clients cannot run a local executable. No shared owner browser is provided.
