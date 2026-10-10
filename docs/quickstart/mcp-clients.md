# Other MCP clients (stdio)

Kitsuvo's MCP server is the desktop app's own `kitsuvo mcp` command, speaking MCP
over stdio. Any client that can launch a local stdio server can use it.

## Configuration

Merge this `mcpServers` entry into the client's existing configuration and keep
its other servers ([examples/generic-stdio.mcp.json](../../examples/generic-stdio.mcp.json)):

```json
{
  "mcpServers": {
    "kitsuvo": { "command": "kitsuvo", "args": ["mcp"] }
  }
}
```

Replace `command` with the absolute path when `kitsuvo` is not on PATH:

| System | Executable |
|---|---|
| Windows | the full path to `kitsuvo.exe` |
| macOS | `/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo` |

Keep `"args": ["mcp"]`. Restart the client afterwards.

### Claude Desktop

Claude Desktop reads `claude_desktop_config.json`: open it from **Settings >
Developer > Edit Config**, add the `kitsuvo` entry under `mcpServers`, and
restart the app.

## What the server exposes

Navigation, tab management, accessibility snapshots, clicks, typing, hovering,
selection, keys, waits, page text, JavaScript evaluation, responsive sizing,
Windows screenshots and `kitsuvo_report`, the detection evidence for a page.

The agent profile is separate from your normal browsing profile. Sign-in pages
and password fields are refused. Page text, snapshots and reports are returned
to the connected client and handled under that client's data policy.
