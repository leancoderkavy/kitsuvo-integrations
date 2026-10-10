#!/bin/sh
# Lists the tools served by a locally running Kitsuvo HTTP bridge.
# Start the bridge first: cd integrations/mcp-http && npm ci --ignore-scripts && npm start
PORT="${KITSUVO_MCP_PORT:-8787}"
curl -s -X POST "http://127.0.0.1:${PORT}/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
