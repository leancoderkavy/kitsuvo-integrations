# Kitsuvo integrations

Public installation sources for Kitsuvo browser plugins, four agent skills,
the local HTTP MCP bridge, and browser-extension developer previews.
Native desktop downloads: https://kitsuvo.com. Extension downloads and setup:
https://kitsuvo.com/extensions.

## Claude Code

Install Kitsuvo on Windows or macOS and make `kitsuvo` available on PATH.
Then run:

```sh
claude plugin marketplace add leancoderkavy/kitsuvo-integrations
claude plugin install kitsuvo@kitsuvo-browser
```

## Codex

```sh
codex plugin marketplace add leancoderkavy/kitsuvo-integrations
codex plugin add kitsuvo --marketplace kitsuvo-browser
```

The plugin includes setup, browsing, detection-evidence, and responsive skills.
Its native MCP connection uses a separate browser profile. It requires the
installed desktop browser; it does not install that executable.

## HTTP MCP

```sh
cd integrations/mcp-http
npm ci --ignore-scripts
npm test
npm start
```

Node.js 22 or newer is required. The bridge binds only to loopback and is for a
secure, authenticated tunnel. Public cloud-directory submission needs a stable
HTTPS endpoint with authentication and a connection to each user's own browser.
See [MCP setup](docs/marketplace-integrations.md).

## Rust connector client

Build the standalone client with `cargo build --locked --manifest-path
crates/kitsuvo-connectors/Cargo.toml`. It discovers and calls tools from explicitly
approved stdio and Streamable HTTP MCP servers. OAuth credentials are stored in
the macOS or Windows credential store. See [connector setup](docs/third-party-connectors.md)
for approval syntax and current provider qualification limits.

## Browser extensions

`extensions/chromium` targets Chrome, Edge, Opera, Brave and Vivaldi.
`extensions/firefox` is for temporary Firefox installation; Mozilla signing is
required for public installs. `extensions/safari` needs Apple packaging and
signing. See [browser setup](docs/browser-extensions.md).

The extension checks local builder fingerprints and optionally filters search
results. It has no cloud AI, telemetry, or desktop companion requirement.
It does not include the desktop browser's full slop or impersonation checks.
These are developer previews. No public browser-store or AI-directory approval
is claimed. This repository contains integration sources only.
