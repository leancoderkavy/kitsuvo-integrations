#!/bin/sh
# List tools in an authenticated local MCP session. No browser tools are called.
set -eu
: "${KITSUVO_MCP_TOKEN:?Set the same private KITSUVO_MCP_TOKEN as the HTTP bridge}"
PORT="${KITSUVO_MCP_PORT:-8787}"
case "$PORT" in ''|*[!0-9]*) echo 'Choose a numeric loopback port.' >&2; exit 1;; esac
[ "${#KITSUVO_MCP_TOKEN}" -eq 43 ] || exit 1
case "$KITSUVO_MCP_TOKEN" in *[!A-Za-z0-9_-]*) exit 1;; esac
temporary_dir=$(mktemp -d)
chmod 700 "$temporary_dir"
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM
session=''
rpc() {
  # Credentials go over stdin, keeping them out of curl's process arguments.
  {
    printf 'url = "http://127.0.0.1:%s/mcp"\n' "$PORT"
    printf 'header = "Authorization: Bearer %s"\n' "$KITSUVO_MCP_TOKEN"
    if [ -n "$session" ]; then printf 'header = "Mcp-Session-Id: %s"\n' "$session"; fi
  } | curl --config - --silent --show-error --fail-with-body --max-time 15 \
    --request "$1" --dump-header "$temporary_dir/headers" \
    --header 'Content-Type: application/json' \
    --header 'Accept: application/json, text/event-stream' \
    --header 'MCP-Protocol-Version: 2025-03-26' --data "${2:-}"
}
rpc POST '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"kitsuvo-local-example","version":"1"}}}' > "$temporary_dir/initialize"
session=$(awk 'tolower($1)=="mcp-session-id:" {gsub(/\r/,"",$2);print $2}' "$temporary_dir/headers")
[ -n "$session" ] || { echo 'The bridge did not initialize a session.' >&2; exit 1; }
case "$session" in *[!A-Za-z0-9_-]*) exit 1;; esac
rpc POST '{"jsonrpc":"2.0","method":"notifications/initialized"}' > /dev/null
rpc POST '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
rpc DELETE > /dev/null
