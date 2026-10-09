# Kitsuvo cloud MCP relay

An OAuth-protected Streamable HTTP relay to each consenting user's own native
Kitsuvo browser. The cloud service does not launch a browser or share an owner's
profile. Each outbound TLS WebSocket belongs to a separate isolated agent
profile on the connecting computer.

## Connect your browser

Install Kitsuvo and put `kitsuvo` on PATH. Use Node.js 22 or newer:

```sh
npm ci --ignore-scripts
export KITSUVO_CLOUD_ORIGIN=https://kitsuvo-mcp-relay.fly.dev
npm run connect
```

PowerShell uses `$env:KITSUVO_CLOUD_ORIGIN = 'https://kitsuvo-mcp-relay.fly.dev'`.
The connector requires a real interactive terminal. Review the destination and
type `CONNECT` to opt in. Configure your MCP client with the HTTPS `/mcp` URL
and OAuth. The authorization page provides a one-time request code. Type
`approve <code>` in the connector terminal, inspect the client name and redirect
URI, then type `APPROVE`. Refresh the authorization page to finish linking.
Approval authorizes navigation, tab management, clicking, typing, page JavaScript
and reading snapshots, reports and supported screenshots in this isolated agent profile.
The native server's sensitive-page restrictions remain enabled.

Tool arguments and selected page snapshots, screenshots and detection reports
pass through the relay to the authorized MCP client. Do not approve an
unrecognized client. The cloud service retains ephemeral authorization state
in memory and does not log page data, authorization codes, tokens or tool
arguments. Requests necessarily leave the computer; this is separate from the
loopback-only MCP bridge and local detection mode.

Disconnecting the connector revokes all its access/refresh tokens. Stopping or
restarting the relay revokes all connections and grants; reconnect and authorize
again. Access tokens last ten minutes; rotated refresh tokens last one day.
The browser window may remain open after stopping the connector.

## Validation and deployment

`npm test` exercises PKCE, resource/client/redirect binding, replay refusal,
refresh rotation, revocation, host/origin checks and independent browser routing.
For an explicit native test in a disposable profile, set
`KITSUVO_CLOUD_SMOKE=1` and run `node smoke-native.mjs` against your chosen relay.
The smoke approves only its own named test client and closes its own browser.

`fly deploy --remote-only --ha=false` builds the supplied Dockerfile. Keep exactly
one machine/process: authorization state and browser sockets are ephemeral,
with no cross-machine state store. The endpoint is `/mcp`, health is `/health`,
and discovery uses standard OAuth protected-resource and authorization metadata.
WebSocket connections, queues, request sizes and authorization stores are bounded;
SDK OAuth endpoints include rate limiting. This initial service is not a
high-availability or persistent account system.

## Publisher requirements

This implementation establishes browser-possession consent, not verified email
identity. `/userinfo` returns an opaque subject only; it never invents an email
or an `email_verified` claim. Workspace email/domain restrictions need a real
verified identity provider. OpenAI-managed client mTLS, publisher registration,
domain verification, reviewer connection and walkthrough requirements must be
completed through the actual publisher connection. Do not claim directory
approval, SLA, verified-email support or mTLS qualification from these tests.

Official requirements:
https://developers.openai.com/plugins/build/auth
https://developers.openai.com/plugins/build/mcp-server
