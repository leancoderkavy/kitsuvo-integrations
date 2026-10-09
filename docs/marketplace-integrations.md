# Kitsuvo plugins and MCP

Kitsuvo's plugin bundles its native browser MCP server with setup, browsing,
detection-evidence, and responsive-check skills. The logo and icons are copies
of the existing Kitsuvo assets, with the brand's Vermilion accent. No API key is
needed for local browser automation or local detection.

## Install locally

Install Kitsuvo on Windows or macOS and make `kitsuvo` available on PATH.
Alternatively, replace `command` in the MCP configuration with the absolute
path to `kitsuvo.exe` or `/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo`.
Keep `args: ["mcp"]`. Plugin installation does not install the native browser.
An installed plugin is cached by its host; edit/reinstall the plugin copy or
configure a separate native MCP connection when using a custom executable path.

Download and extract `https://kitsuvo.com/downloads/kitsuvo-integrations-0.2.3.zip`.
It contains the local marketplace manifests, branded plugin, four skills, and
loopback HTTP MCP bridge with its locked dependencies and tests. Commands below
run from the extracted directory or an authorized repository checkout.

Claude Code, from that directory:

```sh
claude plugin marketplace add .
claude plugin install kitsuvo@kitsuvo-browser
```

The integration marketplace is public. The native application repository
remains private; the marketplace includes only the reviewed integration sources:

```sh
claude plugin marketplace add leancoderkavy/kitsuvo-integrations
claude plugin install kitsuvo@kitsuvo-browser
```

For development: `claude --plugin-dir ./plugins/kitsuvo`. For MCP alone:
`claude mcp add kitsuvo -- kitsuvo mcp`. Claude Desktop can merge the
`mcpServers` object from `plugins/kitsuvo/.mcp.json` into its existing client
configuration; retain unrelated servers.

ChatGPT desktop / Codex local marketplace:

```sh
codex plugin marketplace add .
codex plugin add kitsuvo --marketplace kitsuvo-browser
```

Open the Plugins directory in the ChatGPT desktop app, select **Kitsuvo Browser**,
and install **Kitsuvo**. Restart the host after package changes. The repository's
`.agents/plugins/marketplace.json` points at the portable `plugins/kitsuvo`
package. Local execution requires a host with local MCP support; a web or cloud
conversation needs a connection to the computer running the browser.

Run the setup skill, then ask “Open https://example.com in Kitsuvo and explain
its detection evidence.” Tool names may receive a host-specific prefix.

## ChatGPT cloud: local HTTP bridge and Secure MCP Tunnel

The bridge adapts the native stdio MCP server to stateless Streamable HTTP. It
forwards native tool definitions, annotations, screenshots, and tool errors,
rather than maintaining a second catalog. It starts the native MCP process;
the browser opens when a browser tool is first called.

Requirements: Node.js 22 or newer, Kitsuvo installed locally, and OpenAI's
[Secure MCP Tunnel client](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
associated with the target ChatGPT workspace.

```sh
cd integrations/mcp-http
npm ci --ignore-scripts
npm start
```

If Kitsuvo is not on PATH, set `KITSUVO_BINARY` to the absolute executable path
before starting. On PowerShell:

```powershell
$env:KITSUVO_BINARY = 'D:\Coding\unvibe\target\release\kitsuvo.exe'
npm start
```

`KITSUVO_MCP_PORT` optionally changes the default port 8787. Configure the
tunnel's MCP destination as `http://127.0.0.1:8787/mcp`, following its current
workspace registration instructions. In ChatGPT Plugins, choose **Add custom
MCP server**, **Tunnel**, select that tunnel, and use the name **Kitsuvo** with
the package description. Install the resulting connection and test a new chat.
Use the supplied `plugins/kitsuvo/assets/icon-256.png` for the listing logo.

The bridge binds only to `127.0.0.1` and rejects foreign Host and Origin
headers. The tunnel must preserve or rewrite the destination Host to the
loopback address. There is no public unauthenticated deployment mode, OAuth
implementation, or wildcard CORS. Do not expose this port with an anonymous
public forwarding service. The secure tunnel handles remote identity and
access; the browser control token never appears in the plugin package.

One bridge connects to one agent profile. Tools from simultaneous callers
share its tabs; mutating calls run in order. Run a separate bridge with a
different `KITSUVO_PROFILE_DIR` and port for another independent browser.
Closing the bridge stops its MCP process; the native browser may remain open.

## Capabilities and data access

The MCP exposes navigation, tab management, accessibility snapshots, clicks,
typing, hovering, selection, keys, waits, page text, JavaScript evaluation,
responsive sizing, Windows screenshots, and `kitsuvo_report`. Detection reports
include AI-built, slop, and impersonation evidence and gate state; search-result
reports describe hidden or labelled sites.

By default, automation has a separate profile and refuses sensitive sign-in
pages and password fields. These packages do not enable `--main-profile` or
`--allow-sensitive`. The user's native browser settings and network rules still
apply; adding a plugin does not enable cloud verdict engines. System-keychain
API keys can still be used by engines already enabled in the agent profile.

Page text, screenshots, tool arguments, and reports returned through MCP are
visible to the connected AI client and covered by that client's data handling.
The browser's local-only switch does not stop a client from receiving tool
results through the local bridge. AI-built is provenance, not proof of harm;
a low detection score is not proof of human authorship or safety.

## Listings and public submission

Listing name: **Kitsuvo**. Short description: **Browse and inspect websites**.
Full description and sample prompts are in `plugin.json`.
Website: <https://kitsuvo.com>. Privacy: <https://kitsuvo.com/privacy>.
Terms: <https://kitsuvo.com/terms>. Support:
<https://github.com/leancoderkavy/kitsuvo-integrations/issues>.

The repository catalogs support local/private installation. They do not mean
the plugin is approved in either public directory. Claude's directory uses
its [plugin submission process](https://code.claude.com/docs/en/plugins-reference).
For OpenAI, [local MCP submissions](https://developers.openai.com/plugins/guides/submit-claude-plugin)
currently require a public HTTPS endpoint or coordination with an OpenAI
contact for local MCP support. A secure tunnel supports personal/workspace
testing but is not a substitute for a public submission endpoint.

Do not submit this as a skills-only plugin: the workflows depend on browser
tools. Public cloud distribution needs an authenticated architecture that
connects each user to their own browser, registered MCP connection metadata,
and review in the publisher's account. No hosted service, OAuth registration,
registered app ID, marketplace approval, or public release is claimed here.

## Verify

Create the portable / Claude-compatible archive with
`python scripts/package_plugins.py`; output is `dist/kitsuvo-plugin.zip`.
It includes the skills and original brand assets, not the browser executable
or the separate HTTP bridge. CI also produces this archive as an artifact.

```sh
claude plugin validate ./plugins/kitsuvo
claude plugin validate .
cd integrations/mcp-http
npm test
```

After connecting, list tools, open a harmless page, read its snapshot and
report, and switch responsive mode on and off. Check a denied sensitive page
and a missing executable. On macOS validate snapshots and resizing; screenshots
are Windows-only. Before a public submission, test the installed package in
both clients using the publisher's registered connection.

Formats follow [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
and [Claude marketplace packaging](https://code.claude.com/docs/en/plugin-marketplaces).
