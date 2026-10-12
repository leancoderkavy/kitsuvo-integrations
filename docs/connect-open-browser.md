# Connect a chat to an open Kitsuvo window

This flow requires a browser build that offers **Copy connection prompt** and
an MCP server with `browser_attach`. Updating the plugin alone does not update
the native browser. If these are missing, use the regular setup instructions;
the window-targeting feature needs a newer native build when available.

1. In the browser window you want your chat to use, select the desired tab.
2. Press the plug button beside Settings.
3. If the window has not enabled automation, check the permission box and press
   **Allow control & copy prompt**. Otherwise press **Copy connection prompt**.
4. Paste the prompt into your Codex, Claude Code or other locally connected MCP
   chat. The assistant confirms the selected page before starting your task.

Install Kitsuvo's connection in your AI app once and restart that app once.
After setup, you can connect other chats without restarting the AI app.

Each copied prompt gives a chat its own selection, even when several chats share
one MCP process. Changing window focus or the browser's visible tab cannot
retarget the chat. To change its destination, copy a new prompt from that page.
The assistant includes the `browser` target on every tool call, including
session identity, status, tabs, controller and cleanup.

Normal-window permission allows control of the window and its signed-in sites.
Sign-in pages and password fields remain protected. Press **Stop** in the top
bar to end control API access until the window restarts. Closing the target
produces an error; the assistant must not launch or adopt a replacement.

If the clipboard cannot copy the prompt, Kitsuvo opens and selects it under
**View or copy the prompt manually**. Copy it with your normal keyboard shortcut
and paste it into the chat. The prompt contains a local window reference, not
an API token. Do not share control.json or paste a bearer token into a chat.

The local window flow is for clients connected to Kitsuvo's local MCP tools.
ChatGPT and Claude web chats use their separate authenticated connector setup;
copying a local prompt does not install that connector.
