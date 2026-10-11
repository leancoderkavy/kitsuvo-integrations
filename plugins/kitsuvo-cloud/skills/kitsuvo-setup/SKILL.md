---
name: kitsuvo-setup
description: Set up or diagnose the Kitsuvo browser plugin when its MCP tools are missing or cannot launch the desktop browser.
---

Kitsuvo must be installed on the computer running the local connector. This remote plugin connects to `https://kitsuvo-mcp-relay.fly.dev/mcp` using OAuth. The user must start their local cloud connector, type CONNECT, and approve this client in that connector. Closing it revokes access. Do not bypass consent or connect an owner profile as a shared service.

Check whether Kitsuvo's `browser_tabs` tool is available (hosts may namespace it). Call it with `action: list` to verify the connection. Explain that this uses a separate profile, so normal browsing cookies and history are absent.

If tools are missing, enable the installed plugin and start a new conversation. If the executable cannot be found, check the local connector’s Kitsuvo executable path and restart the connector. Restart the client. Do not download or run an unrelated binary.

Cloud clients cannot execute a local stdio server directly. Use the opt-in authenticated relay or bridge and Secure MCP Tunnel setup in the [integration guide](https://github.com/leancoderkavy/kitsuvo-integrations/blob/main/docs/marketplace-integrations.md). Do not invent a server URL or a registered app ID.

When ready, offer a first task: open a user-selected page and read its Kitsuvo report. Do not enable `--main-profile` or `--allow-sensitive` as a setup shortcut.
