# Kitsuvo MCP clients and distribution

Version 0.2.7. Install Kitsuvo on Windows or macOS first. The local server is
`kitsuvo mcp`; current Mac 0.2.30 local MCP reuses the normal signed-in profile by default. Add `--separate-profile` for a separate persistent profile. Sensitive pages remain protected. Windows 0.2.4 predates `browser_status` and cannot satisfy the current connection check; no qualified replacement Windows release is currently published.
The client receives requested page text, screenshots and reports. No API key
is needed for local automation. These installation sources do not establish
public directory approval or tested compatibility in every client.

## Local clients

For a visual browser inside ChatGPT, Claude, Cursor, or T3 Code, use the
[embedded browser setup](embedding-browser.md#chatgpt-claude-cursor-and-t3-code-setup).
The native examples below provide automation tools; the Node App bridge also
serves the interactive panel. T3 Code support depends on its selected provider.

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

Claude Code: `claude mcp add --scope user kitsuvo -- "/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo" mcp --separate-profile`.
Codex: `codex mcp add kitsuvo -- "/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo" mcp --separate-profile`.
For skills too, download and extract the [integrations archive](https://kitsuvo.com/downloads/kitsuvo-integrations-0.2.27.zip), then run the marketplace commands from the extracted folder:

```sh
claude plugin marketplace add .
claude plugin install kitsuvo@kitsuvo-browser
```

For Gemini CLI, use the manual `gemini-cli.json` configuration above with the installed executable path. Restart the client and verify its connection.

### Claude Desktop extension

Download `https://kitsuvo.com/downloads/kitsuvo-desktop-0.2.11.mcpb`.
In Claude Desktop choose Settings → Extensions → Advanced settings → Install
Extension. Configure the Kitsuvo executable. The bundle uses the client's Node
runtime, has no external npm dependencies and does not install the browser.
Its launcher passes only `mcp`; it does not enable cloud forwarding. Plain `mcp`
uses the normal signed-in browser profile by default on Windows and Mac. Use a
direct MCP configuration with `--separate-profile` when isolation is required;
on Mac this needs macOS 14 or later. Revoke it by disabling/removing the extension.

## Remote clients and cloud plugin

Endpoint: `https://kitsuvo-mcp-relay.fly.dev/mcp`. OAuth is required. Download
`https://kitsuvo.com/downloads/kitsuvo-cloud-plugin-0.2.12.zip` for the remote
plugin. A package is installation metadata, not a registered publisher app ID.
Do not fabricate `.app.json` registered IDs; attach the actual portal-generated
mapping if the target host requires it.

On your own Windows or Mac computer, install Kitsuvo and Node.js 22+, extract
`https://kitsuvo.com/downloads/kitsuvo-integrations-0.2.27.zip`, then:

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

For Claude Code's remote variant, run from the extracted integrations archive:

```sh
claude plugin marketplace add .
claude plugin install kitsuvo-cloud@kitsuvo-browser
```

The local and remote variants expose the same browser tool names. Enable only
the intended variant in a conversation to avoid duplicate tool catalogs.

LM Studio 0.3.17 or later also supports a one-click remote install. Start and
approve your local Kitsuvo cloud connector first, then use
[Add Kitsuvo to LM Studio](lmstudio://add_mcp?name=kitsuvo&config=eyJ1cmwiOiJodHRwczovL2tpdHN1dm8tbWNwLXJlbGF5LmZseS5kZXYvbWNwIn0%3D).
This deep link installs connection metadata; it does not install or start the
Kitsuvo desktop browser or its connector.

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
| Cursor | Publisher application at `cursor.com/marketplace/publish` | Public repository, account review, and actual Marketplace install/tool/panel qualification |
| GitHub Copilot / VS Code Agent Plugins | Repository marketplace using Agent Plugins 1.0; optional contribution to a curated marketplace | The portable plugin is installable from a marketplace source; default/public marketplace inclusion requires separate review and readback |
| VS Code MCP gallery | Customization Marketplace / MCP feed | Manual configuration is ready; an accepted publisher/feed entry and gallery readback are separate |
| Gemini CLI gallery | Public repository with root `gemini-extension.json` | Versioned manifest and install validation are live; the public repository has the `gemini-cli-extension` topic and `v0.2.8` tag. Wait for the daily crawler and verify public gallery readback before claiming a listing |
| Cline | Catalog PR in `cline/marketplace`; legacy extension marketplace uses `cline/mcp-marketplace` | PR #222 is open; qualify installation and OAuth separately. Legacy submissions require a 400px icon and actual Cline README-only installation test |
| Smithery | Publish authenticated remote server | Account access and successful end-to-end connection |
| Glama | Remote connector listing | Account access; source listing requires open-source license |
| Docker MCP catalog | Contribution to `docker/mcp-registry` | Appropriate remote/connector packaging and catalog review |

T3 Code, Continue, LM Studio, and legacy Windsurf/Cascade currently use the
configuration routes above. They are not treated as public marketplace
submissions without a verified first-party publisher flow and listing readback.
See `integrations/distribution/publishers/platform-status.md` for the dated
submission/status ledger and exact remaining gates.

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

Official references: [Cursor MCP](https://docs.cursor.com/context/model-context-protocol),
[Cursor Marketplace](https://cursor.com/marketplace/publish),
[VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers),
[VS Code Agent Plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins),
[GitHub Copilot plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins),
[Gemini CLI](https://geminicli.com/docs/tools/mcp-server/),
[Gemini CLI extensions](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/releasing.md),
[Continue](https://docs.continue.dev/customize/mcp-tools),
[LM Studio](https://lmstudio.ai/docs/app/mcp),
[LM Studio install link](https://lmstudio.ai/docs/app/mcp/deeplink),
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

## Historical local setup evidence (Mac 0.2.14)

The direct commands above use the installed Mac executable, so PATH setup is
not required. Substitute your own installed executable on Windows and use the
profile options its `--help` lists. Windows native testing is still pending.

`claude mcp list` checks server health; `codex mcp list` lists registration.
Restart the client and ask it to navigate to a public page, report the page
title and visible text, then close only the new test tab by ID with `browser_tabs`. Record existing
tab IDs first. Some hosts share one MCP connection across conversations;
`browser_cleanup` can also close tabs from earlier chats on that connection.
Do not require an `h1` on example.com: its current page has a title but no heading.
Approve the requested browser tools in the client; read-only or noninteractive
policies may deny navigation and cleanup. Keep unrelated tool policies intact.

Marketplace plugins and the downloaded Desktop extension pass only `mcp`;
on Mac 0.2.14 this uses the normal signed-in profile. The plugin also requires
`kitsuvo` on the client's PATH. For a Mac client launched from a terminal, run
`export PATH="/Applications/Kitsuvo.app/Contents/MacOS:$PATH"` before the plugin
commands and confirm `kitsuvo --help` works in that terminal. This does not set
PATH for desktop apps launched from the Dock. The browser's Add button or exported marketplace uses the actual
absolute executable path. Use one Kitsuvo connection per conversation.
