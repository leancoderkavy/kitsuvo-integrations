# Kitsuvo cloud MCP relay

An OAuth-protected Streamable HTTP relay to each consenting user's own native
Kitsuvo browser. The cloud service does not launch a browser or share an owner's
profile. Each outbound TLS WebSocket belongs to a separate isolated agent
profile on the connecting computer.

## Connect your browser

Install Kitsuvo and put `kitsuvo` on PATH. Use Node.js 22 or newer:

Download and extract the [integration package](https://kitsuvo.com/downloads/kitsuvo-integrations-0.2.17.zip).
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
The native server's sensitive-page restrictions remain enabled.

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
