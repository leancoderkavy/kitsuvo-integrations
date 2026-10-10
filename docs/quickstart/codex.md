# Codex

Requires Kitsuvo installed with `kitsuvo` on PATH
(see [before any of these](README.md#before-any-of-these)).

## Plugin (recommended)

```sh
codex plugin marketplace add leancoderkavy/kitsuvo-integrations
codex plugin add kitsuvo --marketplace kitsuvo-browser
```

In the ChatGPT desktop app, open the Plugins directory, select **Kitsuvo
Browser** and install **Kitsuvo**. Restart the host after changing the package.

## MCP server only

```sh
codex mcp add kitsuvo -- kitsuvo mcp
```

This writes the following to `~/.codex/config.toml`
([examples/codex-config.toml](../../examples/codex-config.toml)):

```toml
[mcp_servers.kitsuvo]
command = "kitsuvo"
args = ["mcp"]
```

If `kitsuvo` is not on PATH, set `command` to the absolute path and keep
`args = ["mcp"]`.

## Check it

```sh
codex mcp list
```

Then ask: `Open https://example.com in Kitsuvo and explain its detection evidence.`
Local execution needs a host with local MCP support. A web or cloud
conversation needs the [bridge](http-bridge.md) or [cloud relay](cloud-relay.md).
