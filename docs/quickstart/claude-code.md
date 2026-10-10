# Claude Code

Requires Kitsuvo installed with `kitsuvo` on PATH
(see [before any of these](README.md#before-any-of-these)).

## Plugin (recommended)

```sh
claude plugin marketplace add leancoderkavy/kitsuvo-integrations
claude plugin install kitsuvo@kitsuvo-browser
```

The plugin adds the MCP server plus four skills: `kitsuvo-setup`,
`kitsuvo-browse`, `kitsuvo-evidence` and `kitsuvo-responsive`. Start a new
conversation, run the setup skill, then ask for a first task.

From a local checkout instead of GitHub, run the same two commands with
`claude plugin marketplace add .` in the repository root. To try the plugin
without installing it: `claude --plugin-dir ./plugins/kitsuvo`.

## MCP server only

```sh
claude mcp add kitsuvo -- kitsuvo mcp
```

Add `--scope project` to write `.mcp.json` in the current project. The entry it
creates is the same as [examples/claude-code.mcp.json](../../examples/claude-code.mcp.json):

```json
{
  "mcpServers": {
    "kitsuvo": { "type": "stdio", "command": "kitsuvo", "args": ["mcp"] }
  }
}
```

If `kitsuvo` is not on PATH, replace `"command"` with the absolute path.

## Check it

```sh
claude plugin validate ./plugins/kitsuvo
claude mcp list
```

Then ask: `Open https://example.com in Kitsuvo and explain its detection evidence.`
Tool names may carry a host-specific prefix.

The local server runs in Claude Code and Cowork. It does not run on Claude web
or mobile; use the [cloud relay](cloud-relay.md) or [bridge](http-bridge.md)
for cloud clients.
