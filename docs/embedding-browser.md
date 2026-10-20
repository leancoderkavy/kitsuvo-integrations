# Embed Kitsuvo in an assistant or application

Kitsuvo has two integration surfaces: native MCP tools for automation and an
MCP Apps browser panel for an interactive view. A model does not need a
Kitsuvo-specific API: its application needs an MCP connection. UI-capable
MCP Apps hosts can display the panel; other applications can mount it with
the host SDK below. Chat websites that do not accept custom MCP connections
cannot use this integration directly.

The embedded panel provides navigation, tabs, page text, detection evidence,
and controls for clicking, hovering, typing, submitting, and selecting.
Windows and macOS provide viewport screenshots, page text, and controls.
Full-page screenshots use bounded native capture on Windows and viewport tiles on macOS.
Screenshots update after actions or **Refresh view**. This is a remote view
of the local engine, not a live video stream, a clickable page canvas, or an
API for placing the native WebView inside another window. The native browser
can open separately. Complete sign-in there when requested.
Use **Fit preview** if a background tab has a tiny or blank preview. This
explicitly displays the panel's tab in the isolated Kitsuvo window and restores
its normal viewport size; it does not apply a mobile device identity.

## For an existing MCP Apps host

Connect the Node bridge using local stdio, the secure tunnel, or the
authenticated cloud relay, then call `kitsuvo_browser` with an optional `url`.
Its resource is `ui://kitsuvo/browser.html` with MIME type
`text/html;profile=mcp-app`. Existing automation tools remain available to
the assistant. See [client setup](marketplace-integrations.md#interactive-browser-inside-chatgpt-and-claude)
for connection configurations and platform limits.

The panel uses the [MCP Apps protocol](https://github.com/modelcontextprotocol/ext-apps).
Host support for interactive UI is separate from support for MCP tools.

## ChatGPT, Claude, Cursor, and T3 Code setup

Use the **App bridge**, not `kitsuvo mcp` alone, to get the embedded view.
After extracting the integration archive, run `npm ci --ignore-scripts` in
`integrations/mcp-http`. The setup helper prints configuration for review;
it does not edit your client settings or remove other servers.

```sh
node setup.mjs --host cursor --binary /Applications/Kitsuvo.app/Contents/MacOS/kitsuvo
node setup.mjs --host claude --binary /Applications/Kitsuvo.app/Contents/MacOS/kitsuvo
node setup.mjs --host t3code --provider codex --binary /Applications/Kitsuvo.app/Contents/MacOS/kitsuvo
node setup.mjs --host chatgpt
```

On Windows, pass the installed executable, for example
`--binary "C:\Program Files\Kitsuvo\kitsuvo.exe"`. The helper uses the
absolute Node and bridge paths from the computer where it runs. Optional
`--node`, `--bridge`, and `--profile` accept absolute paths, including paths
with spaces. An explicit profile directory separates this connection from
other assistants; do not share one profile between independent users.

| Host | Where to connect | Embedded view |
| --- | --- | --- |
| ChatGPT | Custom MCP app with OAuth at the printed HTTPS URL; keep the local cloud connector running with `node connect.mjs --app` and approve the client | MCP Apps panel; the native browser runs on the connector's computer |
| Claude Desktop | Merge the printed JSON into Claude Desktop's MCP configuration and restart | MCP Apps panel; Claude Code itself can use text tools |
| Claude web | Remote OAuth connector, with the local connector in `--app` mode | Interactive connector panel when enabled for the conversation |
| Cursor | Merge the printed JSON into `.cursor/mcp.json` or `~/.cursor/mcp.json`, then restart | MCP Apps panel in chat on supported Cursor versions |
| T3 Code | Merge the printed TOML into the Codex configuration used by the selected provider on the T3 server | MCP Apps panel when that T3 build and provider expose MCP Apps operations |

For T3 Code's Claude provider, `--host t3code --provider claude` prints JSON
for that provider's project `.mcp.json`. Use the provider's configured Claude
directory and enable the server there. This config provides tools; whether
it also renders the panel depends on the selected provider. T3's UI support
does not imply every provider exposes the necessary resource/tool operations.
For Codex, use the provider's configured `CODEX_HOME` rather than assuming it
is your local default. A remote T3 server needs Node, Kitsuvo, and the extracted
bridge on that server; local desktop paths are not remote paths.

In each host, enable Kitsuvo and ask **“Open Kitsuvo in chat at
https://example.com”**. Check that `kitsuvo_browser` appears in its tools.
If only `browser_navigate` and other native tools appear, the connection uses
the native server instead of the App bridge. If the host cannot render UI,
the same call returns page text and element refs for continued automation.

Host contracts checked October 12, 2026:
[ChatGPT MCP Apps](https://developers.openai.com/plugins/build/chatgpt-ui),
[Claude interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude),
[Cursor MCP Apps](https://prod.cursor.com/help/customization/mcp), and
[T3 Code's MCP App resource/tool bridge](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/mcpApps/McpAppRequests.ts).
These contracts establish an integration route; they are not proof of a live
installation in your accounts. Test a harmless page, a panel interaction, Stop,
and disconnect in the actual host before claiming host qualification.

## Try the local application example

Download and extract the integration package from the client setup guide.
Install Node.js 22 or newer and Kitsuvo, then run:

```sh
cd integrations/mcp-http
npm ci --ignore-scripts
export KITSUVO_MCP_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")"
npm run embed
```

Set `KITSUVO_BINARY` to the installed executable's absolute path if Kitsuvo
is not on PATH. `KITSUVO_PROFILE_DIR` selects an independent agent profile;
`KITSUVO_MCP_PORT` changes the default port 8787.

Open `http://127.0.0.1:8787/embed`, enter the same private token in the password
field, and press **Connect local browser**. The example retains the token only
in memory while connected; it never puts it in a URL or browser storage.
Use the PowerShell token assignment in [HTTP setup](marketplace-integrations.md)
on Windows. HTTP and embedded resource/action requests require
`Authorization: Bearer <KITSUVO_MCP_TOKEN>` even on loopback. Native stdio does
not need this additional HTTP credential.
The first connected panel shows a nonmodal guide. **Got it**, **Skip**, or
Escape while focused in the guide dismisses it. **Browser guide** replays it.
Only the versioned dismissal flag is stored in the host's local storage.
The guide does not navigate, install software, or change browser settings.

The example routes exist only with `--embed`; ordinary `npm start` and
`--stdio` do not enable them. `/embed/action` accepts only the two browser
panel tools, rejects non-JSON and oversized arguments, and shares the MCP
bridge's serialized operations. The server binds to loopback and checks Host
and Origin. It supplies no wildcard CORS or anonymous public hosting mode.

The bridge probes the installed executable's help before connecting. Newer
builds receive `mcp --separate-profile`; recognized older builds with a documented
isolated agent default receive `mcp`. Headless mode is rejected when that older
build does not support it. Unknown builds keep the explicit isolation flag.

## Mount in your application

The integration sources include a browser-side ES module with TypeScript
declarations. It is currently shipped in the integration archive, not
published as an npm registry package. Install the extracted
`integrations/mcp-http` directory as a local dependency or import its module
through your application's bundler. The package exports
`@kitsuvo/mcp-http/embed`; it requires a DOM environment, not server rendering.

Supply an already connected and authorized MCP client for the Node App bridge
or cloud connector started with `--app`. The native `kitsuvo mcp` process
alone does not serve the UI resource. The SDK needs only `readResource` and
`callTool`; a standard MCP SDK client can be wrapped as follows:

```js
import { mountKitsuvo } from '@kitsuvo/mcp-http/embed';

// mcpClient is connected by your host's existing MCP/session layer.
const panel = await mountKitsuvo(document.getElementById('browser'), {
  client: {
    readResource: request => mcpClient.readResource(request),
    callTool: request => mcpClient.callTool(request),
  },
  initialUrl: 'https://example.com/',
  theme: 'light',
});

await panel.navigate('https://example.org/');
await panel.refresh(); // Refresh after assistant/native-tool navigation.
await panel.setTheme('dark');

// Or deliver a kitsuvo_browser / kitsuvo_browser_action result from your host.
// await panel.update(result);

// On unmount: releases the frame and its message listener.
await panel.destroy();
```

Give the container a usable height, for example `height: 760px`. The panel
has a minimum height of 480px and works in narrow containers. `timeout`
defaults to 15000 milliseconds for the UI handshake. Resource fetching and
tool execution use the host client's own timeouts. Keep the container in
the same document/window that loaded the SDK.

`destroy()` is idempotent and removes the iframe and guide. It does not close
the host's MCP client, interrupt an already running native action, or quit
Kitsuvo. Framework hosts should call it during unmount, including when an
asynchronous mount completes after a component has been removed. Store the
panel handle in component state/ref, not a global shared between users.

For Electron, Tauri, or a web application, establish MCP in a trusted process
or authenticated server session and expose only these client callbacks to
the renderer. Keep OAuth credentials and browser control tokens in that
trusted layer. The loopback example is a developer example; applications
should use their existing authentication and consent flow. A web application
on another origin should use its authorized MCP/session layer rather than
requesting cross-origin access to the example endpoints.

## Isolation and data handling

The SDK creates an opaque iframe with `sandbox="allow-scripts"`, no referrer,
and no same-origin, popup, or top-navigation privileges. Its bridge checks the
message source and forwards only `kitsuvo_browser` and
`kitsuvo_browser_action`. It does not forward arbitrary native tools such as
JavaScript evaluation, resources, or prompts. The bundled panel has a content
security policy that blocks network connections and nested frames; web pages
execute in the native engine. Untrusted page labels are rendered as text.

The native Stop button, sensitive-page refusals, agent isolation, and detection
gates remain active. This SDK does not opt into the main profile or sensitive
access. One MCP connection shares its native tabs/profile with every panel
and assistant on that connection. Separate users need separate authorized
connections, profile directories, and (for loopback bridges) ports. Creating
another iframe does not create another browser profile.

The host receives page text, reports, tool arguments, and screenshots when
supported. Remote AI hosts may process that data under their own policies.
Local-only browser settings do not stop an authorized MCP host from receiving
tool results. The iframe receives no host credentials, but the host client
remains responsible for its connection's permissions and data handling.

## Validate an integration

```sh
cd integrations/mcp-http
npm test
```

In a repository checkout with Chrome installed, run
`node --test tests/embedded-browser.test.cjs tests/mcp-browser.test.cjs`
from the repository root. These checks cover the standard bridge handshake,
desktop/narrow layout, source isolation, privileged-tool refusal, timeout
cleanup, guide dismissal/replay, and the opt-in HTTP example. Test sign-in
refusal and Stop with your installed native browser before distributing a host.
