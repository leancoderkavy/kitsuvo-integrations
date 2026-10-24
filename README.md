# Kitsuvo integrations

[![Kitsuvo: free browser for Mac and Windows](https://img.shields.io/badge/Kitsuvo-free%20browser%20for%20Mac%20%26%20Windows-D23F1A)](https://kitsuvo.com)
[![MCP: stdio and Streamable HTTP](https://img.shields.io/badge/MCP-stdio%20%26%20Streamable%20HTTP-0b6cff)](docs/quickstart/README.md)
[![Claude Code and Codex plugin](https://img.shields.io/badge/plugin-Claude%20Code%20%26%20Codex-555555)](#claude-code)
[![Node.js 22 or newer](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](integrations/mcp-http)
[![License: Kitsuvo Integration License](https://img.shields.io/badge/license-Kitsuvo%20Integration%20License-lightgrey)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/leancoderkavy/kitsuvo-integrations)](https://github.com/leancoderkavy/kitsuvo-integrations/commits/main)

**Kitsuvo hides likely AI-built websites in Google, Bing and DuckDuckGo, shows the evidence, and lets you open any page anyway.**

[Kitsuvo](https://kitsuvo.com) is a free browser for Mac and Windows. The
integrations here are the secondary, optional way to use it: they let an AI
client such as Claude Code, Codex or another MCP client drive that browser. You
do not need them to filter search results. With them, an agent can open a page,
read it, and explain the local evidence behind its AI-built, slop and
impersonation verdicts, or check a layout at phone, tablet and desktop sizes.

This repository holds the public installation sources: the plugin and its four
agent skills (setup, browse, evidence, responsive), the local HTTP MCP bridge,
the cloud relay connector, a Rust MCP client, and browser-extension developer
previews. The browser itself is a separate download.

> **Get Kitsuvo:** [kitsuvo.com](https://kitsuvo.com/#get)
> for Windows (64-bit) and macOS (Apple silicon and Intel). Free, no account.
> First-launch prompts are explained at [kitsuvo.com/install](https://kitsuvo.com/install).
> The plugins start the installed browser; they do not install it. The filter
> is also available as a [browser extension](#browser-extensions).

## What your agent can do

| Skill | Ask | What happens |
|---|---|---|
| `kitsuvo-setup` | "Set up Kitsuvo" | Checks the connection and explains a missing executable |
| `kitsuvo-codex` | "Browse inside Codex with Kitsuvo evidence" | Uses Codex’s live renderer and offline Kitsuvo analysis on request; no screenshot forwarding or automatic blocking |
| `kitsuvo-browse` | "Open example.com and read the page" | Navigates, reads page text and snapshots, clicks and types on accessible elements |
| `kitsuvo-evidence` | "Why was this site flagged as AI-built?" | Reads Kitsuvo's report: score, identified builder, strongest signals, separate AI-built, slop and impersonation verdicts |
| `kitsuvo-responsive` | "Check this at phone and desktop sizes" | Resizes the page to device sizes and reports layout problems |

No Kitsuvo account or API key is needed for local browsing and detection.

## Additional clients

[Client configs and desktop extension](docs/distribution-clients.md) cover Cursor,
VS Code, Gemini CLI, Cline, Continue, LM Studio, Devin and remote workflow clients.
[Registry metadata](server.json) describes the opt-in authenticated endpoint.
Directory approval is separate from these install sources.

## Install

| You use | Run | Guide |
|---|---|---|
| Claude Code (plugin) | `claude plugin marketplace add leancoderkavy/kitsuvo-integrations` then `claude plugin install kitsuvo@kitsuvo-browser` | [Claude Code](docs/quickstart/claude-code.md) |
| Claude Code (MCP only) | `claude mcp add kitsuvo -- kitsuvo mcp` | [Claude Code](docs/quickstart/claude-code.md#mcp-server-only) |
| Codex (plugin) | `codex plugin marketplace add leancoderkavy/kitsuvo-integrations` then `codex plugin add kitsuvo --marketplace kitsuvo-browser` | [Codex](docs/quickstart/codex.md) |
| Codex (MCP only) | `codex mcp add kitsuvo -- kitsuvo mcp` | [Codex](docs/quickstart/codex.md#mcp-server-only) |
| Gemini CLI extension | `gemini extensions install https://github.com/leancoderkavy/kitsuvo-integrations --ref v0.2.9` | [Other clients](docs/quickstart/mcp-clients.md) |
| Another stdio MCP client | `{"mcpServers":{"kitsuvo":{"command":"kitsuvo","args":["mcp"]}}}` | [Other clients](docs/quickstart/mcp-clients.md) |
| ChatGPT or a cloud client, with a tunnel | Set a private `KITSUVO_MCP_TOKEN`, then start `integrations/mcp-http` | [HTTP bridge](docs/quickstart/http-bridge.md) |
| A cloud client, no tunnel | Start the connector in `integrations/mcp-cloud` | [Cloud relay](docs/quickstart/cloud-relay.md) |
| The browser you already use | Install the extension from the Chrome Web Store, Edge Add-ons, Firefox Add-ons or the Mac App Store (Safari); manual previews remain available | [Extension setup](docs/quickstart/browser-extension.md) |

Every row except the extension needs Kitsuvo installed with `kitsuvo` on PATH.
If it is not on PATH, use the executable's absolute path as `command` and keep
the argument `mcp`.

Then ask: *Open https://example.com in Kitsuvo and explain its detection
evidence.*

## Claude Code

Install Kitsuvo on Windows or macOS and make `kitsuvo` available on PATH.
Then run:

```sh
claude plugin marketplace add leancoderkavy/kitsuvo-integrations
claude plugin install kitsuvo@kitsuvo-browser
```

The local server runs in Claude Code and Cowork. It does not run on Claude web
or mobile.

## Codex

```sh
codex plugin marketplace add leancoderkavy/kitsuvo-integrations
codex plugin add kitsuvo --marketplace kitsuvo-browser
```

The plugin includes setup, browsing, detection-evidence, and responsive skills.
Do not assume the connection is isolated from your normal sign-ins. On current
Mac 0.2.33, local MCP reuses the normal profile by default; add `--separate-profile`
to a direct MCP configuration for a separate persistent profile. Check your
installed build's `browser_status` and the [connection guide](https://kitsuvo.com/integrations).
Windows 0.2.4 predates `browser_status` and cannot satisfy the current connection
check; no qualified replacement Windows release is currently published.
The plugin requires the installed desktop browser; it does not install it.

## Browser inside ChatGPT, Claude, Cursor, or T3 Code

The MCP App bridge provides an interactive browser panel with navigation,
tabs, page controls, detection evidence and Windows/macOS previews. Pages still run
in Kitsuvo on your computer. For Claude Desktop, launch
`node integrations/mcp-http/server.mjs --stdio` after installing that directory's
dependencies. For cloud hosts, use an authenticated tunnel or the cloud
connector's `--app` mode. See [panel setup](docs/marketplace-integrations.md)
and [cloud setup](integrations/mcp-cloud/README.md).

Use `node integrations/mcp-http/setup.mjs --host cursor --binary /absolute/path/to/kitsuvo`
to print a local visual-panel configuration. Hosts `claude`, `t3code`, and
`chatgpt` have their own setup routes; see [host setup](docs/embedding-browser.md).
T3 Code's embedded UI depends on the selected provider and build.

Other applications can mount the same panel with the typed
`@kitsuvo/mcp-http/embed` host SDK and an authorized MCP client. Try
`npm run embed` in `integrations/mcp-http`, then open
`http://127.0.0.1:8787/embed`. Set a private `KITSUVO_MCP_TOKEN` first and enter
it in the example's password field. See [embedding Kitsuvo](docs/embedding-browser.md)
for lifecycle, isolation and shared-profile details.

## HTTP MCP

```sh
cd integrations/mcp-http
npm ci --ignore-scripts
npm test
export KITSUVO_MCP_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")"
npm start
```

Node.js 22 or newer is required. The bridge binds only to loopback and is for a
secure, authenticated tunnel. Every HTTP request must carry the matching
`Authorization: Bearer <KITSUVO_MCP_TOKEN>` header. See the setup guide for
PowerShell. Public cloud-directory submission needs a stable
HTTPS endpoint with authentication and a connection to each user's own browser.
See [MCP setup](docs/marketplace-integrations.md).

## Authenticated cloud relay

`integrations/mcp-cloud` includes the separate OAuth-protected cloud relay and
interactive local connector. The endpoint is
https://kitsuvo-mcp-relay.fly.dev/mcp. Connecting forwards selected page results
to the relay and the client you explicitly approve. Disconnecting revokes access.
See [cloud setup](integrations/mcp-cloud/README.md) for prerequisites, consent,
ephemeral-state limits and remaining publisher identity requirements.

## Rust connector client

Build the standalone client with `cargo build --locked --manifest-path
crates/kitsuvo-connectors/Cargo.toml`. It discovers and calls tools from explicitly
approved stdio and Streamable HTTP MCP servers. OAuth credentials are stored in
the macOS or Windows credential store. See [connector setup](docs/third-party-connectors.md)
for approval syntax and current provider qualification limits.

## Browser extensions

Free public store installs:

| Browser | Store listing |
|---|---|
| Chrome | [Chrome Web Store](https://chromewebstore.google.com/detail/kitsuvo-%E2%80%94-ai-site-filter/kogkgeiglfeoflmlnbmjghbdoinclbdf) |
| Edge | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kitsuvo-%E2%80%94-ai-site-filter/nedklnjihgpgefpinabddmnoagkaoolp) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/kitsuvo-page-evidence/) |
| Safari on Mac | [Mac App Store](https://apps.apple.com/app/kitsuvo-browser-extension/id6821491898) |

Store versions can be older than the preview ZIPs, so a change in a preview may
not be in the store build yet. [kitsuvo.com/extensions](https://kitsuvo.com/extensions)
has the current store links and preview ZIPs. The extension works without
installing the desktop browser.

`extensions/chromium` targets Chrome, Edge, Opera, Brave and Vivaldi.
`extensions/firefox` can be loaded temporarily for testing; use the Firefox
Add-ons listing for a normal install. `extensions/safari` is source that needs
Apple packaging and signing; use the Mac App Store listing to install. See
[browser setup](docs/browser-extensions.md).

The extension checks local builder fingerprints and optionally filters search
results. It has no cloud AI, telemetry, or desktop companion requirement.
It does not include the desktop browser's full slop or impersonation checks.
Manual packages remain developer previews. Browser-store availability does not
establish approval in any AI-client directory.

## Security and privacy

- **Choose the profile.** These local plugin configurations pass `mcp` and
  inherit the installed browser's default. On current Mac 0.2.33 this reuses the normal
  signed-in profile, including website cookies. Add `--separate-profile` in a
  direct MCP configuration when you want a separate persistent profile. Check
  `browser_status` for your installed build. The packages do not enable
  `--allow-sensitive`.
- **Sensitive pages are refused.** Sign-in pages and password fields are not
  driven.
- **Local by default.** The plugin adds no analytics and no Kitsuvo-hosted
  upload service. Kitsuvo itself sends no telemetry.
- **What the AI client sees.** Tool arguments (URLs and any text you ask it to
  type) go to the browser. Page text, snapshots, reports and supported
  screenshots go back to the connected client, which handles them under its own
  data policy. Pages can contain personal data.
- **Cloud paths are opt-in.** The loopback bridge is not exposed unless you put
  a tunnel in front of it. The cloud relay reaches your browser only while you
  run its connector and after you approve a client in your terminal.
- **Evidence, not proof.** AI-built is provenance, not proof of harm. A low
  score is not proof of human authorship or safety.

Full policy: [kitsuvo.com/privacy](https://kitsuvo.com/privacy). To report a
vulnerability, see [SECURITY.md](SECURITY.md).

## FAQ

**What is Kitsuvo?** A free browser for Mac and Windows that hides likely
AI-built websites in Google, Bing and DuckDuckGo, shows the evidence, and lets
you open any page anyway. These integrations are the optional, secondary way to
let an AI agent use it.

**Do I need an account, API key or paid plan?** No. Local browsing and detection
need none. Optional cloud AI checks in the desktop app are separate.

**Does installing the plugin install Kitsuvo?** No. Install the desktop browser
first. The plugin runs `kitsuvo mcp`.

**Which systems are supported?** The desktop browser is for Windows (64-bit) and
macOS (Apple silicon and Intel). Screenshot support depends on your installed
build: request only a mode that `browser_status` reports, and use snapshots when
image capture is unavailable. On Linux or ChromeOS, try the
[extension preview](docs/quickstart/browser-extension.md).

**Can the agent use my signed-in browser?** Yes, when it uses your normal
profile: that is the local MCP default on current Mac 0.2.33. A separate profile must
be selected explicitly with `--separate-profile`. Sensitive sign-in pages and
password fields are protected by default. Page text from other signed-in pages
can still reach the connected AI client.

**Does it work with ChatGPT?** Through the Codex local marketplace, or a cloud
client via the [HTTP bridge](docs/quickstart/http-bridge.md) with a secure
tunnel or the [cloud relay](docs/quickstart/cloud-relay.md).

**Is it listed in the Claude, ChatGPT or browser-extension stores?** The
extension has public listings on the Chrome Web Store, Edge Add-ons, Firefox
Add-ons and the Mac App Store (Safari), linked above. That is separate from
AI-client directory approval; no such approval is established here. The local
Claude Code and Codex plugin install routes use this repository.

**Can it prove a site was written by AI?** No. It reports builder evidence and
separates AI-built, low-value content and impersonation. Detection depends on
recognizable traces.

**Can I fork or redistribute this?** The
[Kitsuvo Integration License](LICENSE) allows personal use and local
configuration changes. Other modification or redistribution needs written
permission from hello@kitsuvo.com.

**Something broke.** Open an
[install help](https://github.com/leancoderkavy/kitsuvo-integrations/issues/new?template=install_help.yml)
or [bug report](https://github.com/leancoderkavy/kitsuvo-integrations/issues/new?template=bug_report.yml)
issue. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository map

| Path | What it is |
|---|---|
| `plugins/kitsuvo` | Plugin, MCP configuration and browser skills |
| `.claude-plugin`, `.agents/plugins` | Claude and Codex marketplace manifests |
| `integrations/mcp-http` | Local Streamable HTTP bridge |
| `integrations/mcp-cloud` | OAuth relay and local connector |
| `crates/kitsuvo-connectors` | Rust MCP connector client |
| `extensions/` | Chromium, Firefox and Safari extension sources |
| `docs/quickstart`, `examples/` | Setup guides and copy-paste configuration |
