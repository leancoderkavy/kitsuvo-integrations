# Kitsuvo distribution and submission map

Checked 2026-10-13. This file separates a real public submission route from a
manual configuration or repository install. A package, open pull request,
accepted upload, approved review, and public listing are different states.

| Platform | Distribution route | Artifact in this repository | Current gate |
| --- | --- | --- | --- |
| OpenAI / ChatGPT / Codex public directory | Plugin submission portal | `plugins/kitsuvo-cloud` | Not publicly listed; owner must verify identity, upload, connect and scan OAuth MCP, complete domain challenge, provide reviewer access and recording, run cases, submit, then publish after approval. Verified-email OIDC identity remains a blocker where workspace-domain restrictions apply. |
| OpenAI / ChatGPT / Codex local or workspace | Repo/personal Agent Plugin marketplace | `plugins/kitsuvo`, `.agents/plugins/marketplace.json` | Installable source, not public-directory approval. Requires the local desktop browser. |
| Claude directory | Claude publisher dashboard | `plugins/kitsuvo-cloud` plus Claude metadata | Existing private review must be checked by the owner; do not create a duplicate or claim approval without dashboard readback. |
| Claude Code | Repository marketplace | `plugins/kitsuvo`, `.claude-plugin/marketplace.json` | Repository install route; not equivalent to Claude directory approval. |
| Claude Desktop | Desktop extension submission | `integrations/desktop-extension` (`.mcpb`) | Publisher form and a real Claude Desktop install/tool qualification are required. |
| Cursor | Cursor Marketplace publisher application | Portable Agent Plugin in `plugins/kitsuvo` and `cursor.json` | Not returned by public search on 2026-10-13; sign-in/application and production Cursor qualification required. |
| GitHub Copilot CLI / VS Code Agent Plugins | Repository marketplace using Agent Plugins 1.0 | `plugins/kitsuvo`; the public repository already has Claude-compatible marketplace metadata Copilot can read | Repository marketplace is real distribution. Inclusion in a default/public curated marketplace is separate and needs that marketplace's contribution/review route. |
| VS Code MCP gallery | Customization Marketplace / MCP gallery | `vscode.json` and official MCP Registry metadata | Manual config works. Do not claim an official gallery listing until Marketplace readback identifies Kitsuvo. Publisher identity or accepted feed/catalog entry is required. |
| Gemini CLI | Git repository extension or manual MCP config | `gemini-cli.json` | Manual config is ready. A gallery-quality extension additionally needs a root `gemini-extension.json`, a tagged public release, and the `gemini-cli-extension` repository topic; the current multi-package repo is not shaped as a dedicated extension release. |
| T3 Code | Selected Codex or Claude provider configuration | Generated TOML/JSON from `integrations/mcp-http/setup.mjs` | Config-only. There is no verified T3 marketplace submission route; qualify the selected provider and MCP Apps bridge in a production T3 build. |
| Cline | `cline/marketplace` catalog pull request | `cline.json`, `cline-submission.md` | PR #222 is open and unmerged; complete actual Cline host qualification and wait for catalog review. |
| Continue | MCP configuration | `continue.yaml` | Config-only for this integration. Do not claim a Continue Hub listing without a separate published package and readback. |
| LM Studio | `mcp.json` or official `lmstudio://add_mcp` deep link | `lm-studio.json`; remote deep link in `docs/distribution-clients.md` | One-click install is available, but no verified public marketplace submission route exists for this artifact. The browser and user connector remain separate prerequisites. |
| Windsurf / legacy Cascade / Devin | MCP configuration | `devin-cascade.json` | Config-only and legacy-client-specific. Current Devin and Windsurf behavior must be qualified separately. |
| Official MCP Registry | `mcp-publisher` metadata publication | `server.json` | Version 0.2.6 was active and latest on live registry readback on 2026-10-13. Future versions still require validation, publish, and readback. |
| Smithery | Authenticated server publication | Remote relay plus public repository | Public detail page was live on 2026-10-13. Reconnect and qualify OAuth after each material relay/auth change. |
| Glama | Remote connector listing | Remote relay plus registry metadata | Public discovery result existed on 2026-10-13. Proprietary licensing does not qualify the source-server route; use the remote connector route. |
| Docker MCP Catalog | Contribution to `docker/mcp-registry` | Remote/connector metadata | PR #5620 was an open draft on 2026-10-13. Do not containerize or claim a shared native GUI browser; preserve per-user connector semantics. |

## Common release gate

For each client, test the artifact that users will actually install: discover
tools, list tabs, open a harmless public page, read a snapshot and detection
report, exercise responsive mode where supported, verify sensitive-page
refusal, and disconnect. Record the client version and OS. Protocol tests from
another host do not establish client UX, OAuth, or embedded-panel support.
