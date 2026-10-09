# Third-party MCP connectors

Kitsuvo now includes a Rust MCP client, separate from the browser MCP server.
Use `kitsuvo connect` to discover and call tools from a server you configure.
This first release is a CLI integration, not an automatic assistant tool loop
or a graphical account catalog. It works with stdio and Streamable HTTP.

Copy `integrations/connectors/example.json` to a private configuration path.
Add the executable/arguments for an installed trusted server, or its HTTPS
MCP endpoint. Do not put tokens in URLs or arguments. A stdio connector can
explicitly pass environment-variable names using `pass_env`; other environment
variables are not inherited. No configured process starts automatically.

```sh
kitsuvo connect --config connectors.json list
kitsuvo connect --config connectors.json tools kitsuvo-local --approve kitsuvo-local:connect
kitsuvo connect --config connectors.json call kitsuvo-local kitsuvo_report '{}' \
  --approve kitsuvo-local:connect --approve kitsuvo-local:kitsuvo_report
```

Every connection and every tool call requires an exact named approval,
including tools a provider labels read-only. Untrusted server annotations do
not authorize execution. Tool calls refresh the catalog before execution.
The client does not invoke a language model or follow instructions in tool
results. Avoid putting sensitive arguments in shell history.

## OAuth and tokens

For an HTTP server supporting MCP OAuth discovery and dynamic native-client
registration:

```sh
kitsuvo connect --config connectors.json login my-service --approve my-service:login
kitsuvo connect --config connectors.json tools my-service --approve my-service:connect
kitsuvo connect --config connectors.json disconnect my-service
```

The consent page opens in your browser. Review provider scopes yourself.
The official MCP Rust SDK handles PKCE, state and issuer validation, discovery,
and token refresh. The callback listens only on an ephemeral loopback port and
expires after five minutes. Credentials are saved in the OS keychain on macOS
and Windows, bound to the connector name and endpoint. The configuration holds
no tokens. Disconnect removes the local credentials; revoke the grant in the
provider's account settings if you also want server-side revocation.

HTTPS is required except for explicit loopback development servers. Embedded
credentials, query parameters and fragments are rejected. HTTP redirects are
not followed. Servers requiring preregistered apps or a custom authentication
method need additional provider-specific setup; they are not claimed supported
by this automatic native-client registration flow.

## Validation and limits

The client discovered all 17 tools from the actual installed Kitsuvo MCP
server. Six executable fixture tests exercise stdio calls, HTTP discovery,
process environment isolation, exact consent, unknown-tool refusal and
redirect refusal. Three Rust unit tests cover URL and consent validation.
Tests run using `cargo test --manifest-path crates/kitsuvo-connectors/Cargo.toml`
and, after building the crate, `python3 scripts/test_connectors.py`.

Actual Google Workspace, Slack, Notion, GitHub and Microsoft 365 authorization
has not been qualified. Their app registrations, provider permissions and
real account flows must be completed before claiming product support. This
client does not create a public browser gateway: a cloud gateway still needs
authenticated per-user routing to a separately isolated browser runtime.

Protocol reference: https://github.com/modelcontextprotocol/rust-sdk
