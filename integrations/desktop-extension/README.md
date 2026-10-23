# Kitsuvo desktop extension

Download kitsuvo-desktop-0.2.11.mcpb from https://kitsuvo.com/integrations.
In Claude Desktop open Settings → Extensions → Advanced settings → Install Extension.
Choose the bundle, then configure the installed Kitsuvo executable. On macOS use
/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo; Windows users choose their installed kitsuvo.exe.
The browser must already be installed. Start a new chat and call browser_tabs with action list.
The extension launches plain `kitsuvo mcp`, which uses the normal signed-in browser profile by
default. The connected client can inspect open pages and interact with signed-in websites
using that profile's session state. MCP does not expose a direct saved-history,
bookmarks, or settings API. Sensitive sign-in pages and password fields remain protected. Use a direct MCP
configuration with `--separate-profile` when isolation is required; on Mac this needs macOS 14 or later.
This package is not yet approved in the public extension directory.
