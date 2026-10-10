# HTTP bridge and Secure MCP Tunnel

For cloud clients such as ChatGPT. The bridge adapts `kitsuvo mcp` to stateless
Streamable HTTP on loopback; a tunnel you control carries remote access. It has
no authentication of its own and must not be exposed to the public internet.

Requires Node.js 22 or newer and Kitsuvo installed on the same computer.

## Start it

```sh
cd integrations/mcp-http
npm ci --ignore-scripts
npm test
npm start
```

The bridge listens at `http://127.0.0.1:8787/mcp` and prints that address.

| Variable | Purpose | Default |
|---|---|---|
| `KITSUVO_BINARY` | Absolute path to the Kitsuvo executable, when it is not on PATH | `kitsuvo` |
| `KITSUVO_MCP_PORT` | Port to listen on | `8787` |
| `KITSUVO_PROFILE_DIR` | Separate profile directory when you run a second bridge | |

PowerShell:

```powershell
$env:KITSUVO_BINARY = 'C:\Path\To\kitsuvo.exe'
npm start
```

## Try it locally

With the bridge running, list its tools from the same computer
([examples/http-bridge-curl.sh](../../examples/http-bridge-curl.sh)):

```sh
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Only `POST /mcp` is served. A request whose `Host` or `Origin` is not the
loopback address gets `403`, any other path gets `404`, and any other method
gets `405`.

## Connect a cloud client

Point OpenAI's Secure MCP Tunnel client at `http://127.0.0.1:8787/mcp` and add
it in ChatGPT Plugins as a custom MCP server over that tunnel. Follow
[OpenAI's current tunnel instructions](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
and the longer walkthrough in
[../marketplace-integrations.md](../marketplace-integrations.md).

One bridge serves one agent profile. Callers share its tabs and mutating calls
run in order.
