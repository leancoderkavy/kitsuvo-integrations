# Kitsuvo MCP clients and distribution

Version 0.2.6. Install Kitsuvo on Windows or macOS first. The local server is
`kitsuvo mcp`; automation uses an isolated profile and refuses sensitive pages.
The client receives requested page text, screenshots and reports. No API key
is needed for local automation. These installation sources do not establish
public directory approval or tested compatibility in every client.

## Local clients

Merge an example from `integrations/distribution/clients` into your client's
existing configuration; preserve other servers. Replace `kitsuvo` with the
installed executable's absolute path if it is not on PATH. macOS installations
normally use `/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo`.

| Client | Example | Install location or action |
| --- | --- | --- |
| Cursor | `cursor.json` | `.cursor/mcp.json`, or user MCP settings |
| VS Code / GitHub Copilot | `vscode.json` | Command Palette → MCP: Add Server, or workspace `.vscode/mcp.json` |
| Gemini CLI | `gemini-cli.json` | Merge `mcpServers` into `.gemini/settings.json` |
| Cline | `cline.json` | MCP Servers → Configure MCP Servers |
| Continue | `continue.yaml` | Workspace `.continue/mcpServers/kitsuvo.yaml`; use agent mode |
| LM Studio | `lm-studio.json` | Program → Install → Edit mcp.json |
| Legacy Devin/Windsurf Cascade | `devin-cascade.json` | Cascade MCP configuration; current Devin Local uses a separate config route |

Claude Code: `claude mcp add kitsuvo -- kitsuvo mcp`.
Codex: `codex mcp add kitsuvo -- kitsuvo mcp`.
For skills too, install `kitsuvo@kitsuvo-browser` from the public
`leancoderkavy/kitsuvo-integrations` marketplace.

### Claude Desktop extension

Download `https://kitsuvo.com/downloads/kitsuvo-desktop-0.2.6.mcpb`.
In Claude Desktop choose Settings → Extensions → Advanced settings → Install
Extension. Configure the Kitsuvo executable. The bundle uses the client's Node
runtime, has no external npm dependencies and does not install the browser.
Its launcher passes only `mcp`; it does not enable cloud forwarding or use the
main browsing profile. Revoke it by disabling/removing the desktop extension.

## Remote clients and cloud plugin

Endpoint: `https://kitsuvo-mcp-relay.fly.dev/mcp`. OAuth is required. Download
`https://kitsuvo.com/downloads/kitsuvo-cloud-plugin-0.2.6.zip` for the remote
plugin. A package is installation metadata, not a registered publisher app ID.
Do not fabricate `.app.json` registered IDs; attach the actual portal-generated
mapping if the target host requires it.

On your own Windows or Mac computer, install Kitsuvo and Node.js 22+, extract
`https://kitsuvo.com/downloads/kitsuvo-integrations-0.2.6.zip`, then:

```sh
cd integrations/mcp-cloud
npm ci --ignore-scripts
export KITSUVO_CLOUD_ORIGIN=https://kitsuvo-mcp-relay.fly.dev
export KITSUVO_BINARY=/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo
npm run connect
```

On Windows PowerShell, set `$env:KITSUVO_CLOUD_ORIGIN = 'https://kitsuvo-mcp-relay.fly.dev'`
and `$env:KITSUVO_BINARY` to your installed `kitsuvo.exe` path before `npm run connect`.
The macOS executable path above must also match your installation.

Type `CONNECT` to opt in. Add the HTTPS endpoint with OAuth in your client.
On the authorization page, copy the request code to the connector terminal:
`approve <code>`. Review the client and redirect URI, then type `APPROVE` and
refresh the authorization page. Keep the connector running. Each user approves
access to their own isolated browser. Closing the connector revokes access.
The relay has ephemeral state; restarts require reconnection/reauthorization.
A sleeping or disconnected user computer cannot fulfill browser workflows.

For Claude Code's remote variant:

```sh
claude plugin marketplace add leancoderkavy/kitsuvo-integrations
claude plugin install kitsuvo-cloud@kitsuvo-browser
```

The local and remote variants expose the same browser tool names. Enable only
the intended variant in a conversation to avoid duplicate tool catalogs.

## Workflow recipes

These are setup recipes, not imported/tested provider templates. Complete a
real OAuth and tool call in each provider before claiming compatibility.

- **n8n:** Add an AI Agent and its MCP Client Tool, configure the remote endpoint
  and a supported OAuth credential, select browser navigation/snapshot/report
  tools, and connect a Manual Trigger. Start with “Read example.com and return
  its detection evidence.” Restrict enabled tools to the workflow's needs.
- **Zapier:** Add an MCP Client connection to the remote endpoint and complete
  OAuth with the local connector running. Create a manual workflow that calls
  `browser_tabs` (`action: list`) first; then navigate/read/report using the
  schemas discovered by the client. Do not schedule unattended workflows until
  connection lifetime and machine availability have been qualified.
- **Dify:** Tools → MCP, add the HTTPS endpoint using supported OAuth, discover
  tools, and attach the required tools to an agent. Test a harmless page and
  sensitive-page refusal before sharing the workflow.

## Publisher routes and release gates

| Channel | Route | Gate |
| --- | --- | --- |
| Official MCP Registry | Root `server.json` in the public repo, `mcp-publisher validate` then publish | Namespace ownership and actual registry readback |
| Claude plugin | Existing submission in `claude.ai/directory/manage` | Reviewer decision; do not create a duplicate |
| Claude Desktop | `.mcpb` desktop-extension submission | Actual install/tool qualification and publisher form |
| OpenAI | Upload reviewed remote plugin; register/scan endpoint | Verified developer identity, domain challenge, verified-email UserInfo, reviewer connection and applicable mTLS |
| Cline | Catalog PR in `cline/marketplace`; legacy extension marketplace uses `cline/mcp-marketplace` | Validate catalog entry; qualify installation and OAuth separately. Legacy submissions require a 400px icon and actual Cline README-only installation test |
| Smithery | Publish authenticated remote server | Account access and successful end-to-end connection |
| Glama | Remote connector listing | Account access; source listing requires open-source license |
| Docker MCP catalog | Contribution to `docker/mcp-registry` | Appropriate remote/connector packaging and catalog review |

Existing browser store applications must be checked before submitting updates.
A signed/native install, accepted upload, scan result, review and public listing
are distinct states. Pending reviews must not be advertised as approvals.

## Reproduce packages and qualification

```sh
python3 scripts/package_plugins.py --site
python3 scripts/package_distribution.py --site
python3 scripts/package_integrations.py --site
npx --yes @anthropic-ai/mcpb@2.1.2 validate integrations/desktop-extension/manifest.json
node --test integrations/desktop-extension/server.test.mjs
```

After installing in any client: list tools, list tabs, open `https://example.com`,
read snapshot/report, test responsive sizing where supported, and check a denied
sensitive page and disconnect behavior in an isolated test profile. Never use
`--main-profile` or `--allow-sensitive` to make qualification pass.

Official references: [Cursor](https://docs.cursor.com/context/model-context-protocol),
[VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers),
[Gemini CLI](https://geminicli.com/docs/tools/mcp-server/),
[Continue](https://docs.continue.dev/customize/mcp-tools),
[LM Studio](https://lmstudio.ai/docs/app/mcp),
[Devin](https://docs.devin.ai/desktop/cascade/mcp),
[Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop),
[MCP Registry](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx),
[OpenAI submission](https://developers.openai.com/plugins/deploy/submission),
[Cline](https://github.com/cline/mcp-marketplace),
[Smithery](https://smithery.ai/docs), [Glama](https://glama.ai/mcp/faq),
[Docker](https://github.com/docker/mcp-registry),
[n8n](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp),
[Zapier](https://help.zapier.com/hc/en-us/articles/38777069364109-Connect-remote-MCP-servers-to-Zapier-using-MCP-Client),
[Dify](https://dify.ai/blog/v1-6-0-built-in-two-way-mcp-support).
