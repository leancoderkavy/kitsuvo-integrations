# Embed Kitsuvo in an assistant or application

Kitsuvo has two integration surfaces: native MCP tools for automation and an
MCP Apps browser panel for an interactive view. A model does not need a
Kitsuvo-specific API: its application needs an MCP connection. UI-capable
MCP Apps hosts can display the panel; other applications can mount it with
the host SDK below. Chat websites that do not accept custom MCP connections
cannot use this integration directly.

The embedded panel provides navigation, tabs, page text, detection evidence,
and controls for clicking, hovering, typing, submitting, and selecting.
Windows provides screenshots; macOS currently provides text and controls.
Screenshots update after actions or **Refresh view**. This is a remote view
of the local engine, not a live video stream, a clickable page canvas, or an
API for placing the native WebView inside another window. The native browser
can open separately. Complete sign-in there when requested.

## For an existing MCP Apps host

Connect the Node bridge using local stdio, the secure tunnel, or the
authenticated cloud relay, then call `kitsuvo_browser` with an optional `url`.
Its resource is `ui://kitsuvo/browser.html` with MIME type
`text/html;profile=mcp-app`. Existing automation tools remain available to
the assistant. See [client setup](marketplace-integrations.md#interactive-browser-inside-chatgpt-and-claude)
for connection configurations and platform limits.

The panel uses the [MCP Apps protocol](https://github.com/modelcontextprotocol/ext-apps).
Host support for interactive UI is separate from support for MCP tools.

## Try the local application example

Download and extract the integration package from the client setup guide.
Install Node.js 22 or newer and Kitsuvo, then run:

```sh
cd integrations/mcp-http
npm ci --ignore-scripts
npm run embed
```

Set `KITSUVO_BINARY` to the installed executable's absolute path if Kitsuvo
is not on PATH. `KITSUVO_PROFILE_DIR` selects an independent agent profile;
`KITSUVO_MCP_PORT` changes the default port 8787.

Open `http://127.0.0.1:8787/embed` and press **Connect local browser**.
The first connected panel shows a nonmodal guide. **Got it**, **Skip**, or
Escape while focused in the guide dismisses it. **Browser guide** replays it.
Only the versioned dismissal flag is stored in the host's local storage.
The guide does not navigate, install software, or change browser settings.

The example routes exist only with `--embed`; ordinary `npm start` and
`--stdio` do not enable them. `/embed/action` accepts only the two browser
panel tools, rejects non-JSON and oversized arguments, and shares the MCP
bridge's serialized operations. The server binds to loopback and checks Host
and Origin. It supplies no wildcard CORS or anonymous public hosting mode.

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
