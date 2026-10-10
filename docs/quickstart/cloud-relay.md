# Cloud relay

An OAuth-protected Streamable HTTP relay at
`https://kitsuvo-mcp-relay.fly.dev/mcp`. You start a connector on your own
computer and approve each client in your terminal; requests route only to your
connected isolated browser.

This sends tool arguments and selected page snapshots, screenshots and
detection reports through a Fly.io-hosted relay to the client you approve.
Use the [local plugin](claude-code.md) if that is not what you want.

## 1. Start the connector

Requires Kitsuvo installed with `kitsuvo` on PATH and Node.js 22 or newer.

```sh
cd integrations/mcp-cloud
npm ci --ignore-scripts
export KITSUVO_CLOUD_ORIGIN=https://kitsuvo-mcp-relay.fly.dev
npm run connect
```

PowerShell: `$env:KITSUVO_CLOUD_ORIGIN = 'https://kitsuvo-mcp-relay.fly.dev'`.

It needs a real interactive terminal. Read the destination and type `CONNECT`
to opt in.

## 2. Add the URL to your client

```sh
# Claude Code
claude mcp add --transport http kitsuvo-cloud https://kitsuvo-mcp-relay.fly.dev/mcp

# Codex
codex mcp add kitsuvo-cloud --url https://kitsuvo-mcp-relay.fly.dev/mcp
codex mcp login kitsuvo-cloud
```

In Claude Code, run `/mcp` and authenticate `kitsuvo-cloud`. Other clients: add
the HTTPS `/mcp` URL with OAuth.

## 3. Approve the client

The authorization page shows a one-time request code. In the connector
terminal type `approve <code>`, check the client name and redirect URI, then
type `APPROVE`. Refresh the authorization page to finish.

Approval allows navigation, tab management, clicking, typing, page JavaScript
and reading snapshots, reports and supported screenshots in the isolated
profile. Sensitive-page restrictions stay on. Do not approve a client you do not
recognize.

## Limits

- Access tokens last ten minutes and rotated refresh tokens last one day.
- Stopping the connector revokes its tokens. Restarting the relay revokes every
  connection, so reconnect and approve again.
- State is in memory in one process. This is not a high-availability service.
- It proves browser possession, not a verified email address. No directory
  approval is claimed.

Details: [../../integrations/mcp-cloud/README.md](../../integrations/mcp-cloud/README.md).
