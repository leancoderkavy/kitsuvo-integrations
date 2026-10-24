# Kitsuvo cloud MCP relay

An OAuth-protected Streamable HTTP relay to each consenting user's own native
Kitsuvo browser. The cloud service does not launch a browser or share an owner's
profile. Each outbound TLS WebSocket belongs to a separate isolated agent
profile on the connecting computer.

## Connect your browser

Install Kitsuvo and put `kitsuvo` on PATH. Use Node.js 22 or newer:

Download and extract the [integration package](https://kitsuvo.com/downloads/kitsuvo-integrations-0.2.28.zip).
Open a terminal in its `integrations/mcp-cloud` folder before running the commands
below. If the browser is not on PATH, set `KITSUVO_BINARY` to its absolute executable
path. Web hosts need the App-mode commands in the next section for the in-chat panel.

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
The connector starts `kitsuvo mcp --separate-profile`, so the relay never reaches
your normal signed-in profile; that needs Windows or macOS 14 or later. Older
Kitsuvo builds without the flag already isolate MCP. The native server's
sensitive-page restrictions remain enabled.

**macOS 13 (Ventura) and earlier are not supported for cloud access.** Those
releases cannot keep a separate browser data store, so an isolated profile is
impossible and the connector would otherwise expose your normal signed-in
browser. The terminal connector and `service.mjs install`/`run` stop before
connecting and print:

> Kitsuvo cloud access needs macOS 14 (Sonoma) or later. […] Nothing was
> connected. Update macOS to use cloud access, or use local MCP on this Mac
> instead […]

To fix it, update macOS to 14 or later. Until then, use local MCP
(`kitsuvo mcp`), which runs on your Mac only and, by default, uses your normal
signed-in profile. No relay is involved. There is no override that sends the
signed-in profile through the relay.

### Interactive browser panel in ChatGPT or Claude

To include the MCP App, install the sibling bridge's dependencies too, then
start the connector in App mode from this directory:

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix ../mcp-http
export KITSUVO_CLOUD_ORIGIN=https://kitsuvo-mcp-relay.fly.dev
npm run connect -- --app
```

On Windows, use this PowerShell block instead:

```powershell
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix ../mcp-http
$env:KITSUVO_CLOUD_ORIGIN = 'https://kitsuvo-mcp-relay.fly.dev'
npm run connect -- --app
```

Complete the same `CONNECT` and OAuth approval flow. Ask your connected host
to **“Open Kitsuvo in chat at https://example.com”**. The panel provides page
previews on Windows, page text and controls on both desktop platforms, and
Kitsuvo's detection evidence. The local browser still renders pages. Tools,
UI resource reads and panel actions route to the browser that authorized
that client; stopping a temporary terminal connector revokes its grants.

In ChatGPT, add a custom MCP server from Plugins using
`https://kitsuvo-mcp-relay.fly.dev/mcp` and OAuth. Install the created plugin,
select it in a new chat, and send the request above. Account/workspace policies
can limit custom connections. See the [official ChatGPT connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
In Claude, open **Customize → Connectors** and add a custom connector using
the same server URL. Use OAuth and choose **Register automatically** for the
OAuth client: this relay supports dynamic registration, not Claude's published
client identity. Team and Enterprise owners add the connector through
**Organization settings → Connectors** first. Authenticate it and enable it in
a new conversation. See the [official custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
Neither host can launch the connector on your computer: keep the terminal
process running or install the background service below.

The relay deployment must include the resource-forwarding handlers in this
version before `--app` can display a panel through it. The deployed relay passed
the explicit Windows App smoke on October 10, 2026: bundled UI resource,
real native page state, sensitive-page refusal and disconnect revocation.
This does not establish a registered connection inside ChatGPT or Claude.

Tool arguments and selected page snapshots, screenshots and detection reports
pass through the relay to the authorized MCP client. Do not approve an
unrecognized client. The relay persists client registration metadata, connector identity hashes and
access/refresh token hashes in an issuer-bound private file on an encrypted volume.
It does not persist page data, authorization codes or tool arguments. An SDK-issued
confidential client secret, if used, is part of private registration metadata. Requests necessarily leave the computer; this is separate from the
loopback-only MCP bridge and local detection mode.

A temporary terminal connector revokes its grants on disconnect and relay restart.
An installed background connector resumes approved grants after service, login
or relay restarts. While it is offline, browser calls return temporary unavailability
(503), without invalidating authorization. Access tokens last ten minutes; rotated
refresh tokens last one day for temporary connectors and 90 days for installed
background connectors. Refresh extends the latter expiry, with old tokens invalidated.
Presenting a spent authorization code or an already-rotated refresh token is
treated as theft: every token from that grant is revoked and the client must
re-authorize. Each browser keeps at most 8 grants and each client at most 4;
issuing another revokes that browser's or client's least recently refreshed
grant. When the store is full, grants of offline connectors are evicted first.
The browser window may remain open after stopping the connector.

## Automatic startup on macOS and Windows

For an already approved cloud-browser setup, install the optional user background
service. It starts at login and stays running when the desktop app closes, so
reopening Kitsuvo, restarting the connector or logging in after a reboot does not
require manually reconnecting ChatGPT. It uses the same isolated agent
profile and forwards selected browser data through the selected HTTPS relay.
Installation is explicit opt-in; Kitsuvo's normal local-only mode does not
install or enable this service. Node.js 22+, this integration directory and its
`mcp-http` sibling with installed dependencies must remain at their saved paths.

```sh
node service.mjs install --origin https://kitsuvo-mcp-relay.fly.dev \
  --binary /Applications/Kitsuvo.app/Contents/MacOS/kitsuvo \
  --profile /absolute/path/to/isolated-chatgpt-profile --approve-cloud
node service.mjs status
```

On Windows use an absolute `kitsuvo.exe` path and an isolated profile under your
user directory. The installer registers a limited, interactive-user Scheduled
Task at logon. macOS uses a per-user LaunchAgent. Neither requires administrator
access. Both service managers restart a failed connector and prevent multiple
scheduled instances; they do not depend on the desktop app's lifetime.

Link ChatGPT once to this service, replacing the old terminal connection. At the
authorization page, approve its one-time request using an interactive terminal:

```sh
node service.mjs approve CODE_SHOWN_ON_AUTHORIZATION_PAGE
```

Review the displayed client and redirect, type `APPROVE`, then refresh the page.
New clients are never approved automatically. The local approval endpoint uses
a private capability file, loopback-only binding and browser-origin rejection.
It grants only a one-use challenge for a locally reviewed request.

```sh
node service.mjs uninstall
```

Use `node service.mjs revoke` to revoke all approved clients without uninstalling.
Uninstall confirms revocation with the relay before disabling startup; if the
relay is unavailable, retry when it is reachable. Revocation works even if the
local service has stopped. Disconnecting an app in its host revokes that grant
through the standard OAuth endpoint when the host supports it.

The service stores a random 256-bit connector key in `identity.json` in its private
user configuration directory, bound to the selected HTTPS origin. Protect this file:
anyone possessing it can impersonate this connector. It is sent only in a TLS
WebSocket/HTTP header, never a URL or diagnostic output. The relay keeps its hash,
refuses a duplicate active connector, and restores the same approved browser
identity after disconnect. New clients still require explicit approval.

An unknown connector remains in memory for at most ten minutes. Its identity
is persisted only after a valid WebSocket handshake and explicit OAuth approval.
Pending connectors have separate capacity and a 20-attempts-per-15-minute source
budget; approved reconnects use a separate 120-attempt budget and reserved
capacity, including a separate rate-bucket pool. IPv6 sources share a /56 bucket.

| Limit | Global | Per source |
| --- | --- | --- |
| Installed (keyed) connectors online | 50 | 5 |
| Temporary (anonymous) connectors approved | 25 | 3 |
| Pending (unapproved) connectors, 10 minutes each | 60 | 3 |
| Unapproved client registrations (one day each) | 500 | 10 |
| Pending authorization requests (10 minutes each) | 500 | 10 |
| Token records | 5000 | — |
| MCP sessions (15 minutes idle each) | 500 | 16 per browser, 64 per connector network |

Temporary connectors cannot consume installed capacity, and both caps are also
checked when a connector approves its first client. A browser's new MCP session
beyond its 16 replaces that browser's least recently used session. Sessions are
also counted per connector network (the browser connector's IPv4 address or IPv6
/56, not the MCP client's address, because hosted chat apps share egress
addresses): a network's session beyond its 64 replaces that network's least
recently used one. When all 500 are in use, a new session evicts the least
recently used session of the network holding the most, instead of refusing
everyone else. Client
registration metadata is limited to 4 KiB, so a full registry always fits the
4 MiB authorization store and the relay can restart. Before approval a connector
may only send WebSocket messages up to 16 KiB; approved connectors may send up
to 8 MiB. A failed state write keeps authorization closed until a later full
write succeeds (retried at most every five seconds), and is logged as
`state_write_failed`.
Failed handshakes cannot create durable identity records. On restart, legacy
orphan identities without an unexpired approved grant are discarded. Direct
listeners ignore forwarded IP headers. The supplied Fly configuration sets
`KITSUVO_TRUST_PROXY_HOPS=1`; use that setting only behind an edge proxy which
appends the real source IP and prevents direct public access to the listener.

The service also keeps a private, bounded `panels.json` recovery file containing
panel IDs and their last page URLs in this isolated profile. After a native
browser/connector restart, **Refresh view** reopens each panel in its own fresh
tab. It never trusts a saved numeric native tab ID, which can be reused after
restart. Page text, form fields and element references are not saved. URLs may
contain private query strings, so protect this file like local browser history.
Unsupported URL schemes reopen a blank/default tab. Old click/type/submit
operations are refused until a refresh; form submissions and navigation history
are not replayed. Recovery records expire after 90 days.

Existing ephemeral grants require a one-time migration to the installed service.
After that, retain the service directory and relay volume across updates. Normal
reboots resume when the user logs in and networking is available; they do not
provide browser access while the computer is off. After 90 days without refresh,
revocation, removal of the identity file or loss of the relay volume, linking is
required again.

## Validation and deployment

`npm test` exercises PKCE, resource/client/redirect binding, replay refusal,
refresh rotation, revocation, host/origin checks and independent browser routing.
For an explicit native test in a disposable profile, set
`KITSUVO_CLOUD_SMOKE=1` and run `node smoke-native.mjs` against your chosen relay.
The smoke approves only its own named test client and closes its own browser.
Run `node smoke-native.mjs --app` to also check the actual UI resource and
browser panel. Install the HTTP bridge's dependencies first as shown above.

`fly deploy --remote-only --ha=false` builds the supplied Dockerfile. Keep exactly
one machine/process with the `kitsuvo_cloud_state` volume mounted at `/data`,
and `KITSUVO_CLOUD_STATE_FILE=/data/authorization.json`. Create the volume in the
app region before the first deployment. Browser sockets and in-flight approvals
remain ephemeral; client registrations and approved installed-service grants
survive process restarts. Atomic private-file writes are synced before tokens or
revocation acknowledgements are returned. Corrupt/unwritable state fails closed;
never fall back to an empty store or restore an old authorization snapshot as a
code rollback, since that could restore revoked credentials. The endpoint is `/mcp`, health is `/health`,
and discovery uses standard OAuth protected-resource and authorization metadata.
WebSocket connections, queues, request sizes and authorization stores are bounded;
SDK OAuth endpoints include rate limiting. This single-volume deployment does not provide high availability.

On SIGTERM (Fly's configured `kill_signal`, with a 20-second `kill_timeout`) the
relay stops accepting connections, answers requests on kept-alive sockets and
`/health` with a retryable 503, and lets in-flight MCP calls finish for up to
10 seconds (`KITSUVO_SHUTDOWN_GRACE_MS`). It then closes connector sockets with
code 1012 (service restart), flushes the authorization store and exits. Installed
background connectors reconnect when their service manager restarts them;
temporary terminal connectors end and say so. Reconnects use the per-source
budgets above, so a reconnect storm is throttled with 429 rather than starving
other connectors. Token and session expiry run on a monotonic clock anchored
at startup, so an NTP step or manual clock change while running cannot expire
and prune every grant at once. Tokens carry relative lifetimes (`expires_in`), so
an MCP client's clock skew does not affect them.

Every relay response sends `Content-Security-Policy: default-src 'none';
frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer` and, over HTTPS, HSTS. The approval page
is deliberately plain English text (`Content-Language: en`): it has no markup,
scripts or form, and approval happens only in your connector terminal.

### Optional PostHog exception reporting

The relay sends no telemetry unless `KITSUVO_POSTHOG_KEY` is set. Configure that
value as a Fly secret for PostHog project 657811; never put it in `fly.toml`, a
container image, source code, or client configuration. `POSTHOG_HOST` is optional
and selects a self-hosted or regional PostHog endpoint (the SDK default is used
when absent). It may be a Fly secret or a non-secret Fly environment value.

Only bounded relay failure metadata is captured: a fresh generic exception,
allowlisted error type/code and source, and allowlisted HTTP method/route names.
Original error messages, stacks, causes and arbitrary paths/context are discarded;
SDK exception autocapture is disabled. Request bodies, authorization
headers, browser/connector IDs, WebSocket messages, tool arguments and page data
are excluded. SIGTERM/SIGINT and relay close drain the PostHog queue before the
process exits.

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
