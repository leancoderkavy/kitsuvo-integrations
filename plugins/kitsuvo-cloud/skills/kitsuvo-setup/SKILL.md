---
name: kitsuvo-setup
description: Set up or diagnose the Kitsuvo browser plugin when its MCP tools are missing or cannot launch the desktop browser.
---

Kitsuvo must be installed on the computer running the local connector. This remote plugin connects to `https://kitsuvo-mcp-relay.fly.dev/mcp` using OAuth. The user must start their local cloud connector, type CONNECT, and approve this client in that connector. Closing it revokes access. Do not bypass consent or connect an owner profile as a shared service.

Check whether Kitsuvo's `browser_tabs` tool is available (hosts may namespace it). Call it with `action: list` to verify the connection. Explain that this uses a separate profile, so normal browsing cookies and history are absent.

If tools are missing, enable the installed plugin and start a new conversation. If the executable cannot be found, check the local connector’s Kitsuvo executable path and restart the connector. Restart the client. Do not download or run an unrelated binary.

Cloud clients cannot execute a local stdio server directly. Use the opt-in authenticated relay or bridge and Secure MCP Tunnel setup in the [integration guide](https://kitsuvo.com/integrations). Do not invent a server URL or a registered app ID.

When ready, offer a first task: open a user-selected page and read its Kitsuvo report. Do not enable `--main-profile` or `--allow-sensitive` as a setup shortcut.

To connect to an already open window after setup, ask the user to choose its tab, open the plug button beside Settings, and copy the connection prompt into the chat. A normal window requires explicit control consent there. Attach with the exact target and pass `browser` on every call; copying does not itself confirm attachment. Never expose a bearer token or ask the user to paste control.json. Existing chats can switch by copying a new prompt; no client restart is needed after one-time setup.
