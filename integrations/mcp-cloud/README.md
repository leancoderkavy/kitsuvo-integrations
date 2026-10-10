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

### Interactive browser panel in ChatGPT or Claude

To include the MCP App, install the sibling bridge's dependencies too, then
start the connector in App mode from this directory:

```sh
npm ci --ignore-scripts --prefix ../mcp-http
npm run connect -- --app
```

Complete the same `CONNECT` and OAuth approval flow. Ask your connected host
to **“Open Kitsuvo in chat at https://example.com”**. The panel provides page
previews on Windows, page text and controls on both desktop platforms, and
Kitsuvo's detection evidence. The local browser still renders pages. Tools,
UI resource reads and panel actions route to the browser that authorized
that client; stopping the connector revokes all of them.

The relay deployment must include the resource-forwarding handlers in this
version before `--app` can display a panel through it. The deployed relay passed
the explicit Windows App smoke on October 10, 2026: bundled UI resource,
real native page state, sensitive-page refusal and disconnect revocation.
This does not establish a registered connection inside ChatGPT or Claude.

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
Run `node smoke-native.mjs --app` to also check the actual UI resource and
browser panel. Install the HTTP bridge's dependencies first as shown above.

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
