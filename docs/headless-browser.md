# Headless browser for LLM chats

Run Kitsuvo's native browser without a desktop window:

```sh
kitsuvo --headless
```

For an LLM client, configure a stdio MCP server:

```json
{
  "mcpServers": {
    "kitsuvo-headless": {
      "command": "kitsuvo",
      "args": ["mcp", "--headless"],
      "env": { "KITSUVO_PROFILE_DIR": "/absolute/path/to/your/chat-browser-profile" }
    }
  }
}
```

Use a different profile directory for each independent chat browser. Headless
mode enables the existing token-protected loopback control API and isolated
agent profile. It refuses `--main-profile`. An existing visible agent browser
in the same profile must be quit first. The native engine still needs a desktop
OS session; this is hidden-window mode, not a Linux/container browser service.

Call `browser_session` with the real chat identity, then `browser_navigate`,
`browser_snapshot`, `browser_click`, `browser_type`, and the other existing
browser tools. Call `browser_view` to receive the current viewport as a PNG and
an accessibility snapshot with element refs, together in the tool response.
The default viewport is 1280 × 800 CSS pixels. Use `browser_resize` to change
it without opening a window.

Compatible MCP clients display the image in the chat. Repeat `browser_view`
after actions to refresh it. The native stdio view is a refreshed screenshot. Client support determines how
MCP images are shown. For an interactive panel in MCP Apps-compatible chats,
run `KITSUVO_HEADLESS=1 node integrations/mcp-http/server.mjs --stdio` as the MCP
server and call `kitsuvo_browser`. The existing panel and embedding SDK use the
same headless native engine. They do not require a visible Kitsuvo window.
See [MCP integration setup](marketplace-integrations.md) for cloud connection
and embedding options.

`browser_take_screenshot` returns just the PNG. macOS uses public WebKit
snapshot APIs for viewport images. `full_page: true` uses bounded viewport tiles
on Mac and a bounded WebView2 capture on Windows. Mac capture briefly scrolls
the page, hides repeated fixed/sticky overlays after the first tile, and restores
temporary styles and scroll on success or failure. Captures are limited to
16 megapixels; Mac also limits documents to 8192 CSS pixels per axis and 64
tiles. Lazy-loaded content that changes page dimensions causes an explicit
retry error. Sign-in and password protections remain in effect.

The browser process remains available after the MCP connection ends, as with
existing agent mode. Quit the browser process when finished; do not share its
profile directory or local control token with other users.

For the local HTTP bridge or the cloud connector, set `KITSUVO_HEADLESS=1`
before running
`node integrations/mcp-http/server.mjs` or
`node integrations/mcp-cloud/connect.mjs`. The cloud connector retains its
existing explicit connection and client authorization steps. To verify a local build with an offline
fixture, run `python3 scripts/smoke_headless.py /absolute/path/to/kitsuvo`.
