# Pin a chat to an open Kitsuvo window

Pinning is optional. With **Assistant access** on (the switch beside Settings),
assistants you added Kitsuvo to already use the active tab. Pin a chat when it
must stay on one window and tab while you switch.

This flow requires a browser build that offers **Copy connection prompt** in the
plug button's panel and
an MCP server with `browser_attach`. Updating the plugin alone does not update
the native browser. If these are missing, use the regular setup instructions;
the window-targeting feature needs a newer native build when available.

1. In the browser window you want your chat to use, select the desired tab.
2. Press the plug button beside Settings, then **Copy connection prompt** under
   **3. Optional: pin a chat to this tab**. If assistant access is off, turn on
   the **Assistant access** switch first.
4. Paste the prompt into your Codex, Claude Code or other locally connected MCP
   chat. The assistant confirms the selected page before starting your task.

Install Kitsuvo's connection in your AI app once and restart that app once.
After setup, you can connect other chats without restarting the AI app.

Each copied prompt gives a chat its own selection, even when several chats share
one MCP process. Changing window focus or the browser's visible tab cannot
retarget the chat. To change its destination, copy a new prompt from that page.
The assistant includes the `browser` target on every tool call, including
session identity, status, tabs, controller and cleanup.

Assistant access allows authenticated local apps to control this profile, including
signed-in sites. Private tabs, sign-in pages and password fields remain protected.
Turn the **Assistant access** switch off (the same setting as Settings →
Assistants) to block it across restarts. Press **Stop** in the top
bar to end control API access until the window restarts. Closing the target
produces an error; the assistant must not launch or adopt a replacement.

If the clipboard cannot copy the prompt, Kitsuvo opens and selects it under
**View or copy the prompt manually**. Copy it with your normal keyboard shortcut
and paste it into the chat. The prompt contains a local window reference, not
an API token. Do not share control.json or paste a bearer token into a chat.

The local window flow is for clients connected to Kitsuvo's local MCP tools.
ChatGPT and Claude web chats use their separate authenticated connector setup;
copying a local prompt does not install that connector.
