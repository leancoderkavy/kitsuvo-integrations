---
name: kitsuvo-setup
description: Set up or diagnose the Kitsuvo browser plugin when its MCP tools are missing or cannot launch the desktop browser.
---

Kitsuvo must be installed on the same computer as its MCP process. The packaged plugin runs `kitsuvo mcp`, which uses the normal signed-in browser profile by default. A direct configuration with `args: ["mcp", "--separate-profile"]` selects a separate persistent profile on Windows and macOS 14 or later.

Check whether Kitsuvo's `browser_tabs` tool is available (hosts may namespace it). Call it with `action: list` to verify the connection, then call `browser_status`. Use the returned profile mode as the authority. Do not infer isolation from the plugin being installed.

If status reports the normal profile, explain that the connected client can inspect open pages and interact with signed-in websites using that profile's session state. The profile also retains normal browsing data; MCP does not expose a direct saved-history, bookmarks, or settings API. Sensitive sign-in pages and password fields remain protected by default. If status reports a separate profile, explain that normal browsing cookies and history are absent, but accounts signed into that profile remain accessible.

If tools are missing, enable the installed plugin and start a new conversation. If the executable cannot be found, put the installed Kitsuvo executable on PATH or replace `command` in the client's MCP configuration with its absolute path. Keep `args: ["mcp"]` only when the user accepts the normal signed-in profile. Use `args: ["mcp", "--separate-profile"]` when the user wants isolation and the platform supports it. Restart the client. Do not download or run an unrelated binary.

Cloud clients cannot execute a local stdio server directly. Use the opt-in authenticated relay or bridge and Secure MCP Tunnel setup in the [integration guide](https://kitsuvo.com/integrations). Do not invent a server URL or a registered app ID.

When ready, offer a first task: open a user-selected page and read its Kitsuvo report. Do not enable `--main-profile` or `--allow-sensitive` as a setup shortcut.

To connect to an already open window after setup, ask the user to choose its tab, open the plug button beside Settings, and copy the connection prompt into the chat. A normal window requires explicit control consent there. Attach with the exact target and pass `browser` on every call; copying does not itself confirm attachment. Never expose a bearer token or ask the user to paste control.json. Existing chats can switch by copying a new prompt; no client restart is needed after one-time setup.
