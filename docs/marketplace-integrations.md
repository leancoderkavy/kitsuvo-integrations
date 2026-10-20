# Kitsuvo plugins and MCP

Kitsuvo is **a browser that filters likely AI-built websites**. Connect through MCP to navigate, read pages, interact with elements and inspect local evidence.

Kitsuvo's plugin bundles its native browser MCP server with setup, browsing,
detection-evidence, and responsive-check skills. The logo and icons are copies
of the existing Kitsuvo assets, with the brand's Vermilion accent. No API key is
needed for local browser automation or local detection.

## More clients and install bundles

[Client setup and distribution](distribution-clients.md) includes Cursor, VS Code,
Gemini CLI, Cline, Continue, LM Studio, Devin and workflow recipes for n8n,
Zapier and Dify. The Claude Desktop bundle is
`https://kitsuvo.com/downloads/kitsuvo-desktop-0.2.10.mcpb`. The remote plugin
variant is `https://kitsuvo.com/downloads/kitsuvo-cloud-plugin-0.2.10.zip`.
Each requires the user’s own installed browser; neither implies directory approval.

## Point a chat at an already open window

Choose the tab in the desired Kitsuvo window, press the plug button, and copy
the connection prompt into Codex or Claude. A normal window asks for explicit
control permission first. Each prompt keeps the chat on that window and tab;
other windows and focus changes cannot retarget it. The assistant confirms the
page before starting. See [the connection flow](connect-open-browser.md) for
copy recovery, Stop, multiple chats and platform qualification.

## Install locally

In the browser, press **Connect your AI assistant** (the plug button beside Settings),
or open **Settings → AI → Let your assistant use the browser**. Follow the three steps:

1. Choose the AI app you already use. Open it and sign in there, then return to Kitsuvo.
2. Close that app and press **Add Kitsuvo to [app]**. The recommended browser instructions are included; Claude Desktop installs the connection only.
3. Reopen the app, approve Kitsuvo's tools if asked, then press **Copy first request** in Kitsuvo. Paste it into a new chat in your AI app and send it.

Kitsuvo opens agent mode when the assistant uses a browser tool. Look for the
page opening and the orange cursor moving, followed by the assistant's answer.
The agent bar identifies the last controller and the model it reports. Setup
being saved does not prove a live connection. If nothing happens, open the
app's setup instructions and check that Kitsuvo's browser tools are enabled.
Web clients have their own setup instructions instead of the local Add button.
Plugin export and raw configuration are under **Advanced: plugins and manual setup**.

For explanations **inside Kitsuvo**, use **Settings → AI**: choose an assistant,
connect it, open a website, then use **3. Try an explanation → Explain current page**.
The answer appears in Kitsuvo's read beside the page. Local site detection needs
no sign-in. API keys use the provider's API billing; a chat subscription does not
cover an API key's usage. ChatGPT plan sign-in is available only in maintainer
local builds, not packaged installers. Failed or cancelled sign-in stays visible
in its account card with a retry button. The AI and connection panels each offer
a replayable setup guide.

The installer uses the running browser's absolute executable path, preserves
unrelated settings, and places uniquely named `kitsuvo-backup-*.bak` copies
beside files it changes. Invalid configuration and conflicting Kitsuvo entries
are left for manual setup. Codex respects `CODEX_HOME` for its configuration;
its skills use `~/.agents/skills`. Claude Code respects `CLAUDE_CONFIG_DIR`
for both `.claude.json` and its `skills` directory. Gemini CLI respects
`GEMINI_CLI_HOME` for its settings and skills. The other coding clients
use their own user skill folders. **Include helpful browser instructions**
can be turned off for an MCP-only install.

Gemini CLI also requires a trusted workspace before enabling MCP servers.
Approve the folder in Gemini's trust prompt, then check `gemini mcp list`.
See [Gemini's trusted-folder instructions](https://geminicli.com/docs/cli/trusted-folders/).

**Export plugin…** saves a complete local marketplace under `kitsuvo-browser`
in a folder you choose. Add that folder to the host's local marketplace and
install Kitsuvo there. For Claude Code, run `claude plugin marketplace add`
with the exported folder as its argument, then
`claude plugin install kitsuvo@kitsuvo-browser`. For Codex, add that folder with
`codex plugin marketplace add`, then install Kitsuvo in the host's plugin UI.
The exported MCP files also use the installed browser's absolute path.

ChatGPT web, Claude web, Copilot, and other models have separate instructions
in the panel. Web clients cannot launch a local stdio process. For Grok,
DeepSeek, Mistral, or Perplexity, use an MCP-capable client for that model;
the panel does not claim every provider's chat website supports custom MCP.

Configuration formats follow the official [Codex MCP documentation](https://developers.openai.com/codex/mcp),
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp),
[Gemini CLI MCP documentation](https://geminicli.com/docs/tools/mcp-server/),
and [Cursor MCP documentation](https://cursor.com/docs/mcp).

Install Kitsuvo on Windows or macOS and make `kitsuvo` available on PATH.
Alternatively, replace `command` in the MCP configuration with the absolute
path to `kitsuvo.exe` or `/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo`.
Keep `args: ["mcp"]`. Plugin installation does not install the native browser.
An installed plugin is cached by its host; edit/reinstall the plugin copy or
configure a separate native MCP connection when using a custom executable path.

Download and extract `https://kitsuvo.com/downloads/kitsuvo-integrations-0.2.20.zip`.
It contains the local marketplace manifests, branded plugin, four skills, and
loopback HTTP MCP bridge with its locked dependencies and tests. Commands below
run from the extracted directory or an authorized repository checkout.

Claude Code, from that directory:

```sh
claude plugin marketplace add .
claude plugin install kitsuvo@kitsuvo-browser
```

The integrations repository is private. Use the downloaded archive for local installation.

For development: `claude --plugin-dir ./plugins/kitsuvo`. For MCP alone:
`claude mcp add --scope user kitsuvo -- "/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo" mcp --separate-profile`. Claude Desktop can merge the
`mcpServers` object from `plugins/kitsuvo/.mcp.json` into its existing client
configuration; retain unrelated servers.

For Codex MCP alone on Mac:

```sh
codex mcp add kitsuvo -- "/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo" mcp --separate-profile
codex mcp get kitsuvo
```

ChatGPT desktop / Codex local marketplace:

```sh
codex plugin marketplace add .
codex plugin add kitsuvo --marketplace kitsuvo-browser
```

Add the downloaded marketplace with the commands above, then install **Kitsuvo**
from that marketplace in a host with local plugin support. A public ChatGPT
directory listing has not been verified. Restart the host after package changes. The repository's
`.agents/plugins/marketplace.json` points at the portable `plugins/kitsuvo`
package. Local execution requires a host with local MCP support; a web or cloud
conversation needs a connection to the computer running the browser.

Run the setup skill, then ask “Open https://example.com in Kitsuvo and explain
its detection evidence.” Tool names may receive a host-specific prefix.

### Local qualification

The [editor qualification report](research/agent-editor-qualification-2026-10-10.md)
records the latest Claude/GPT walkthrough, native editor and wrapped-link
regressions, reproducible snapshot comparisons, and remaining platform limits.

On Windows, point `KITSUVO_TEST_BINARY` at a built Kitsuvo executable and run
`node --test tests/agent-native.test.cjs`. This uses an isolated profile and a
local practice page; it needs no model account. It checks popup/source-tab
snapshots, explicit tab actions, native typing, failed-option recovery,
screenshots, and switching between two MCP clients. The test skips by default.
`node --test tests/agent-selection.test.cjs` checks selection validation in Chrome,
including disabled options and single/multiple selection.

Live model qualification on October 10, 2026 used an authenticated Claude Code
session (Claude Opus 5.5) and GPT in the active Codex session. Both completed a
local practice form, a delayed-message check, opening/reading/closing a details
tab, a screenshot, and a detection report. The standalone Codex CLI had no
login, so its independent account setup was not qualified. Model names shown
in the browser remain self-reported, not proof of provider identity.

Actions return the original tab's updated snapshot, with its tab number. A
popup can become active in the window; pass the snapshot's `tab` with its refs,
or list/select the new tab and take a fresh snapshot before interacting there.
An invalid option request preserves the existing selection and emits no change
event; it cannot partially apply a mixed valid/invalid request.

Snapshots include compact viewport, scroll, device scale, document readiness,
language, focused-field state, frame availability, and traversal timing metadata.
Controls expose readonly/disabled state, bounded accessible descriptions, and
new-tab link targets. Password values and password selection offsets stay hidden.
Text feedback follows typing and caret navigation, including same-origin frames;
shadow controls and frame borders are handled when locating native input.
Cross-origin frame contents remain inaccessible to the page snapshot. Large
snapshots retain their character limit and report truncation; bounded traversal
stops early rather than inspecting every remaining control.

Click, type, press, and select accept optional `settle_ms` (0–2000, default 700).
Use zero only for known non-navigating edits, and use `browser_wait_for` for
asynchronous results. Keep the default for navigation and popup actions.
October 10 Windows measurements on a 6,000-control local fixture recorded
2.8–6.3 ms bounded snapshot traversal, 529 ms full traversal, and an 88 ms
fast form-edit round trip. These are local samples, not a browser ranking.
The native regression also checks trusted hover, iframe and shadow input,
rejected readonly typing, text feedback, and Stop denying existing/new clients.
Run `node --test tests/agent-actions.test.cjs` for the isolated Chrome control
and snapshot-limit regressions.

## Interactive browser inside ChatGPT and Claude

The Node bridge also exposes an **MCP App**. Ask **“Open Kitsuvo in chat at
https://example.com”** to call `kitsuvo_browser` and display a browser panel
inside a compatible ChatGPT, Claude, Cursor, or T3 Code conversation. Use the
[host setup helper](embedding-browser.md#chatgpt-claude-cursor-and-t3-code-setup)
to configure the App bridge for your host and provider. It includes an address
bar, history navigation, tabs, scrolling, page text, detection evidence, and controls for clicking,
hovering, typing, submitting forms, and selecting options. Windows and macOS
include a page preview captured from the native engine. Press **Refresh view** after
the assistant changes the page with native tools. Previews update after panel
actions; they are not a live video stream or a clickable page canvas.

Pages still run in Kitsuvo on the connected computer. The panel communicates
through the host's MCP Apps bridge, with no direct network access, third-party
page iframe, or browser control token in the UI. Sign-in restrictions, detection
gates, and the native **Stop** button continue to apply. When sign-in is needed,
complete it directly in Kitsuvo. One connection shares one browser profile
between the assistant and panels; use separate profiles for independent users.
Each `kitsuvo_browser` call creates a fresh panel tab unless an existing `tab`
is explicitly requested. Panel actions retain their own tab context, including
after opening or closing tabs. Returning to a chat refreshes its saved panel
from the browser, rather than replaying the original page snapshot. Tabs remain
in the same profile and share cookies; panel IDs are routing context, not a
separate authorization boundary. Old panels created before this update can be
replaced by asking the assistant to open a new Kitsuvo panel.

This uses the shared [MCP Apps standard](https://apps.extensions.modelcontextprotocol.io/),
supported by [ChatGPT](https://developers.openai.com/plugins/build/app-quickstart)
and [Claude interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude).
Hosts without UI support can still use the native browser tools.

For other assistants and applications, use the reusable host SDK or try
`npm run embed` in `integrations/mcp-http`. It mounts the same panel in a
sandboxed iframe with an authorized MCP client. See [embedding Kitsuvo](embedding-browser.md)
for the local example, typed API, lifecycle, and shared-profile limits.

### Claude Desktop: local interactive panel

Install Node.js 22 or newer and run `npm ci --ignore-scripts` in
`integrations/mcp-http`. In Claude Desktop's MCP configuration, use the App
bridge instead of the native `kitsuvo mcp` command:

```json
{
  "mcpServers": {
    "kitsuvo": {
      "command": "node",
      "args": ["C:/path/to/kitsuvo/integrations/mcp-http/server.mjs", "--stdio"],
      "env": { "KITSUVO_BINARY": "C:/path/to/kitsuvo/target/release/kitsuvo.exe" }
    }
  }
}
```

Replace both paths with your installation paths and use an absolute Node path
if the desktop client cannot find it. On macOS, point `KITSUVO_BINARY` at
`/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo`. Preserve other MCP servers,
restart Claude Desktop, enable Kitsuvo, and ask to open it in chat. The browser's
automatic **Install MCP connection** button installs native tools; configure
this bridge manually to get the interactive panel. The same `--stdio` bridge
works in other local MCP Apps hosts, including ChatGPT clients that accept
local MCP configuration.

## ChatGPT cloud: local HTTP bridge and Secure MCP Tunnel

The bridge adapts the native stdio MCP server to session-based Streamable HTTP. It
forwards native tool definitions, annotations, screenshots, and tool errors,
and adds the browser panel tools and UI resource. Each HTTP session gets its own native MCP connection;
the browser opens when a browser tool is first called.

Requirements: Node.js 22 or newer, Kitsuvo installed locally, and OpenAI's
[Secure MCP Tunnel client](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
associated with the target ChatGPT workspace.

```sh
cd integrations/mcp-http
npm ci --ignore-scripts
export KITSUVO_MCP_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")"
npm start
```

If Kitsuvo is not on PATH, set `KITSUVO_BINARY` to the absolute executable path
before starting. On PowerShell:

```powershell
$env:KITSUVO_BINARY = 'C:\path\to\kitsuvo\target\release\kitsuvo.exe'
$env:KITSUVO_MCP_TOKEN = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"
npm start
```

Protect this 256-bit token and configure your MCP client or tunnel destination
to send `Authorization: Bearer <KITSUVO_MCP_TOKEN>` on every request, including
session continuation and deletion. For the JavaScript MCP SDK, pass it in
`requestInit.headers.Authorization` when constructing the HTTP transport.
The bridge refuses to start without a valid token. Rotate it by restarting
the bridge and updating authorized clients. Keep it out of URLs, logs and
shared configuration. A tunnel must support this destination header; otherwise
use the authenticated cloud connector or local stdio integration.

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
access; the separate bridge token authenticates access to the local HTTP
listener. Neither credential appears in the plugin package.

One bridge connects to one agent profile. Independent HTTP MCP sessions keep
their own selected tabs and execute concurrently in the same native browser.
Requests within one session run in order, including the panel's state collection.
Clients must retain the `Mcp-Session-Id` returned by initialization and send it
on later requests; standard Streamable HTTP clients do this automatically.
Delete a session with HTTP `DELETE /mcp` using that header when finished.

The bridge permits up to 16 sessions and 32 pending tool operations per session.
Idle sessions expire after 10 minutes; active requests are retained until their
response closes. Expired sessions return HTTP 404 and need a new initialization.
Startup failures, native disconnection, explicit deletion, idle expiry, and bridge shutdown close the
session's native MCP process. Native disconnect cleanup removes that session's
owned tabs; keep result tabs with `browser_cleanup` and `keep_tabs` before ending
the session. Existing tabs and the profile remain. Tabs still share cookies
and storage; use another `KITSUVO_PROFILE_DIR` and port for profile isolation.
The opt-in `/embed` demonstration uses a separate shared connection.

## Public authenticated cloud relay

The separate `integrations/mcp-cloud` service exposes
`https://kitsuvo-mcp-relay.fly.dev/mcp`. Each user starts its connector locally,
opts in to forwarding, and explicitly approves the requesting OAuth client in
the terminal. PKCE-protected tokens route only to that user's connected isolated
browser. Closing the connector revokes its grants. This is separate from the
loopback bridge above; installing the local plugin does not enable forwarding.
See [cloud setup](https://kitsuvo.com/downloads/cloud-relay.md).

For an in-chat panel through the relay, install the HTTP bridge dependencies
and start the cloud connector with `npm run connect -- --app`. Both ChatGPT
and Claude can use the same OAuth-protected MCP endpoint. The relay must run
this version's UI-resource forwarding handlers. The deployed relay passed the
explicit App-mode Windows smoke on October 10, 2026, including the UI resource,
real native panel state, sensitive-page refusal and disconnect revocation.
See the cloud setup guide for installation and consent steps. This protocol
check does not establish a signed-in ChatGPT or Claude host connection.

The live relay also passed a disposable Windows native-browser smoke covering
navigation, snapshots, reports, sensitive-page refusal and disconnect revocation.
It has ephemeral state in one process and requires reauthorization after restart.
OpenAI-managed client mTLS, verified-email identity, reviewer setup and public
directory approval are not established by this test.

## Capabilities and data access

Use the [rendered setup guide](https://kitsuvo.com/integrations#capabilities)
for current installer versions and platform availability. Mac captures the
viewport when browser_status reports support; full-page capture is supported on both (bounded tiles on Mac).
Phone apps are not publicly listed yet.


The MCP exposes navigation, tab management, accessibility snapshots, clicks,
typing, hovering, selection, keys, waits, page text, JavaScript evaluation,
responsive sizing, supported viewport screenshots, and `kitsuvo_report`. Detection reports
include AI-built, slop, and impersonation evidence and gate state; search-result
reports describe hidden or labelled sites.

On Mac 0.2.14, `kitsuvo mcp` reuses the normal signed-in profile by default;
add `--separate-profile` for a separate persistent profile. Automation refuses sensitive sign-in
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

Listing name: **Kitsuvo**. Short description: **Filter likely AI-built websites with Kitsuvo**.
Full description and sample prompts are in `plugin.json`.
Website: <https://kitsuvo.com>. Privacy: <https://kitsuvo.com/privacy>.
Terms: <https://kitsuvo.com/terms>. Support:
<mailto:hello@kitsuvo.com>.

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
and review in the publisher's account. The relay above is deployed and smoke-tested;
publisher registration, a registered host app ID, and public directory approval
remain unverified.

## Verify

Windows developers can run the opt-in native/client check with Node 24,
installed Codex and Claude Code CLIs, and a built Kitsuvo executable. It uses
isolated profiles and actual installer output, starts the native WebView2
browser, checks dropdowns, calls browser tools through stdio and the HTTP
bridge, and installs the exported plugin in both clients. It never sends a
language-model request. Temporary profiles and screenshots stay in `target`;
CLI working directories use the system temp folder to avoid inheriting
project MCP configuration. The runner reports untested hosts separately.

```powershell
npm.cmd install --prefix target/local-client-check --no-audit --no-fund --ignore-scripts @google/gemini-cli @modelcontextprotocol/sdk playwright-core
npm.cmd ci --prefix integrations/mcp-http --ignore-scripts
$env:KITSUVO_TEST_BINARY = (Resolve-Path target/debug/kitsuvo.exe).Path
$env:KITSUVO_TEST_OUTPUT = "$PWD/target/local-client-check/fixtures"
cargo test integrations::tests::emit_local_client_fixtures -- --ignored
node scripts/check-ai-connections.mjs $env:KITSUVO_TEST_BINARY
```

The Windows check accepts `KITSUVO_TEST_GEMINI_NODE` as an absolute path to a
supported alternate Node runtime for Gemini only. Gemini CLI 0.63.0 connected
but crashed while exiting `skills list` under Node 24.18.0; the same complete
check passed with Gemini on Node 22.23.3. The other checks still used Node 24.

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
and a missing executable. On both platforms validate snapshots, resizing,
viewport screenshots, bounded full-page capture, and asynchronous evaluation. Call `kitsuvo_browser` to verify navigation, tabs, harmless
form submission and page evidence in the panel. Before a public submission, test the installed package in
both clients using the publisher's registered connection.

Formats follow [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
and [Claude marketplace packaging](https://code.claude.com/docs/en/plugin-marketplaces).

## Headless browser sessions

### Direct browsing in Codex's browser panel

Open the actual website URL in Codex’s built-in browser and use the
[`kitsuvo-codex` skill](../plugins/kitsuvo/skills/kitsuvo-codex/SKILL.md)
for Kitsuvo analysis of the selected live tab. Codex renders and handles page
input directly; Kitsuvo’s offline scanner supplies evidence from a sanitized
DOM capture. This workflow does not use a screenshot canvas or another native
browser. Analysis runs on request; automatic blocking and search-result hiding
require host integration that is not implemented here. Native profiles and
settings remain separate.

The [experimental remote host](../integrations/codex-browser/README.md) remains
available for testing, with its documented animation and input limitations.

Use `kitsuvo mcp --headless` for a hidden native browser with an isolated profile.
`browser_view` returns a viewport image and element refs inline in MCP chats.
For the existing interactive chat panel, set `KITSUVO_HEADLESS=1` when starting
the MCP App bridge or cloud connector. See [headless setup](headless-browser.md).

## Verified local setup (Mac 0.2.14)

The direct commands above use the installed Mac executable, so PATH setup is
not required. Substitute your own installed executable on Windows and use the
profile options its `--help` lists. Windows native testing is still pending.

`claude mcp list` checks server health; `codex mcp list` lists registration.
Restart the client and ask it to navigate to a public page, report the page
title and visible text, then close only the new test tab by ID with `browser_tabs`. Record existing
tab IDs first. Some hosts share one MCP connection across conversations;
`browser_cleanup` can also close tabs from earlier chats on that connection.
Do not require an `h1` on example.com: its current page has a title but no heading.
Approve the requested browser tools in the client; read-only or noninteractive
policies may deny navigation and cleanup. Keep unrelated tool policies intact.

Marketplace plugins and the downloaded Desktop extension pass only `mcp`;
on Mac 0.2.14 this uses the normal signed-in profile. The plugin also requires
`kitsuvo` on the client's PATH. For a Mac client launched from a terminal, run
`export PATH="/Applications/Kitsuvo.app/Contents/MacOS:$PATH"` before the plugin
commands and confirm `kitsuvo --help` works in that terminal. This does not set
PATH for desktop apps launched from the Dock. The browser's Add button or exported marketplace uses the actual
absolute executable path. Use one Kitsuvo connection per conversation.

## Display branding and host caches

Product display names are **Kitsuvo** and listing artwork is the official mask
in `assets/icon-256.png`. Lowercase `kitsuvo`, `kitsuvo-cloud`, and
`kitsuvo-browser` remain stable package/server/marketplace identifiers.
Cursor/Grok Bot manifests provide `displayName` and `logo` with a dedicated
`.cursor-plugin/marketplace.json`, following the
[Cursor/Grok Bot manifest schema](https://github.com/cursor/plugins/blob/main/schemas/plugin.schema.json).
Claude-compatible manifests and marketplace
entries provide `displayName`;
OpenAI interfaces provide `interface.displayName`, `logo` and `composerIcon`.
Native stdio, the local App bridge and the cloud relay advertise the same title
and an embedded PNG through MCP `serverInfo.icons`. IDE clients use that MCP
identity when supported; a client that displays configuration keys may still
show the lowercase server identifier. Gemini CLI does not have a separate
supported display-name/icon field in our extension manifest.

Grok Bot's installed team-plugin detail page was checked on October 18, 2026:
it still showed the older imported `kitsuvo` listing and fallback letter icon.
The exposed detail page offered Uninstall, without an edit/refresh control.
Its team catalog must ingest the updated package and respect its display
metadata before the installed UI can be verified. Updating source or ZIPs does
not establish that this catalog has refreshed. The `spawn kitsuvo ENOENT`
connection error is separate from branding and is not repaired by this change.

Cross-platform branding audit: Windows/macOS packaging, iOS/iPadOS display
names, Android labels, browser-extension manifests, OpenAI local/cloud plugin
interfaces and Claude Desktop already carry the capitalized product name and
mask artwork. This change fills Cursor/Grok Bot and Claude-compatible display names, MCP identity
icons and registry artwork. Shared protocol and archive checks run on macOS;
Windows execution and refreshed installed/published host listings remain
pending. Mobile app rebuilds are not needed for these desktop/plugin metadata
changes. No new permissions, remote access or profile behavior are introduced.
