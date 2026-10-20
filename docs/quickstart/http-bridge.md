# Authenticated HTTP bridge and Secure MCP Tunnel

The bridge adapts `kitsuvo mcp` to session-based Streamable HTTP on loopback.
Every HTTP request requires a private bearer token, including initialization,
session continuation and deletion. A secure tunnel handles remote identity
separately. Do not expose the listener through anonymous public forwarding.

Requires Node.js 22 or newer, Kitsuvo installed locally and integrations archive
0.2.20 or later. Native stdio does not require this HTTP credential.

## Start it

```sh
cd integrations/mcp-http
npm ci --ignore-scripts
npm test
export KITSUVO_MCP_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")"
npm start
```

The bridge listens at `http://127.0.0.1:8787/mcp` and refuses to start without a
valid token. Configure the authorized client or tunnel destination to send
`Authorization: Bearer <KITSUVO_MCP_TOKEN>` on every request. Protect the token:
keep it out of URLs, logs and shared configuration. Rotate it by restarting the
bridge and updating clients.

| Variable | Purpose | Default |
|---|---|---|
| `KITSUVO_MCP_TOKEN` | Private 32-byte base64url HTTP credential | Required |
| `KITSUVO_BINARY` | Absolute executable path when Kitsuvo is not on PATH | `kitsuvo` |
| `KITSUVO_MCP_PORT` | Loopback port | `8787` |
| `KITSUVO_PROFILE_DIR` | Independent profile for another bridge | |

PowerShell:

```powershell
$env:KITSUVO_BINARY = 'C:\Path\To\kitsuvo.exe'
$env:KITSUVO_MCP_TOKEN = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"
npm start
```

## Try it locally

In another terminal with the same private token, run
[examples/http-bridge-curl.sh](../../examples/http-bridge-curl.sh). It initializes
an authenticated session, lists tools and deletes its own session, without
calling browser tools. SDK clients should set `requestInit.headers.Authorization`
on `StreamableHTTPClientTransport`.

Foreign Host or Origin headers receive 403. Missing or incorrect credentials
receive 401 before a native backend starts. The optional `/embed` example has a
password field and retains the credential only in memory while connected.

## Connect a cloud client

Point the secure tunnel destination at `http://127.0.0.1:8787/mcp` and configure
the matching bearer header. Follow
[OpenAI's tunnel instructions](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
and [the setup guide](../marketplace-integrations.md). If the tunnel cannot set
the destination header, use the authenticated cloud connector or local stdio.
Do not remove local authentication to accommodate a tunnel.

One bridge serves one agent profile. Independent sessions retain their own
selected tabs and can execute concurrently. Use separate profiles, ports and
credentials for independent users.
