# Connect Kitsuvo to an agent

Kitsuvo exposes its existing browser operations through MCP. Connect the
application running your model: a model subscription or provider name alone
does not give a chat website an external browser interface. A connection does
not replace an agent's built-in browser automatically. Ask it to use Kitsuvo
and verify its actual tool call.

## Grok Bot

Grok Bot runs tools on its cloud computer. Use the remote connection:

1. On your own supported Windows or macOS 14+ computer, open Kitsuvo Settings →
   Assistants → Remote access. Review the disclosure and enable remote access.
   It uses an isolated persistent agent profile, not your normal signed-in one.
2. In Grok Bot, add an MCP server by URL:
   `https://kitsuvo-mcp-relay.fly.dev/mcp`. Use OAuth. Follow the host's Connect
   or Authenticate flow; adding an app is not the same as signing in.
3. Review the request's client name and return address in Kitsuvo, then approve
   only the connection you requested. A terminal connector can perform the same
   review using the existing `approve CODE` flow.
4. Attach Kitsuvo to the Grok Bot task. Send: “Use Kitsuvo's browser tools to
   open https://example.com, read its title and explain its detection evidence.
   Use the approved isolated browser, not your built-in browser.”
5. Inspect the actual tool result. Test Stop and revocation before granting
   access to real workflows. Leave sign-in, MFA and protected steps to the user.

Grok Bot connections are account-wide across your Bots. Different conversations
or screens do not create separate OAuth grants or separate cookie stores.
Kitsuvo browser targets keep task selections stable; they do not create an
identity boundary within a host that shares its grant. Use separate explicitly
scoped browser profiles/connections when independent accounts are required.
[Grok Bot's connection and sharing model](https://docs.x.ai/grok-bot/computer-and-apps)

`spawn kitsuvo ENOENT` means the host tried to start an executable it could not
find. If that host is Grok Bot's cloud computer, a Mac PATH change cannot fix
it. Remove/disable the mistaken local connection in that host and add the
remote URL instead. Do not enable both local and remote Kitsuvo catalogs in
one task. An older imported plugin may need to be replaced through its host's
supported import/reconnect flow; changing source does not refresh that import.

The user's Kitsuvo computer must remain awake and online. An installed
background connector resumes approved grants; it cannot serve pages while the
computer is off. The [terminal/service guide](../integrations/mcp-cloud/README.md)
requires Node.js 24.22.1+ for that optional route. Native Remote access does not
require Node. A cloud request shares requested page content with the relay and
chosen provider. Local saved knowledge is not automatically shared.

Basic tool use does not require an embedded panel. For an in-chat view in a
compatible host, use the [App bridge](embedding-browser.md) and qualify the
panel separately. Grok Bot panel rendering remains a host qualification gate.

## Generate the right configuration

From an extracted integration bundle or source checkout:

```sh
node integrations/mcp-http/clients.mjs --list
node integrations/mcp-http/clients.mjs --client grokbot --transport remote
node integrations/mcp-http/clients.mjs --client codex --binary /Applications/Kitsuvo.app/Contents/MacOS/kitsuvo
node integrations/mcp-http/clients.mjs --client gemini --transport remote
```

Windows PowerShell example:

```powershell
node integrations/mcp-http/clients.mjs --client vscode --binary 'C:\Program Files\Kitsuvo\kitsuvo.exe'
```

Use your actual installed path. Microsoft Store users should use the stable
execution alias selected by Kitsuvo's Add button, rather than a versioned
WindowsApps package folder. The generator only prints reviewable metadata; it
does not install a browser, write settings, connect an account, or enable access.
Merge only the Kitsuvo entry into the selected host configuration and preserve
other servers. For UI-only hosts it prints setup fields/instructions, not a
fictional import format. API examples are connection metadata, not complete
model requests; the application supplies its model, authentication and toolset.

Local configurations retain the protected `mcp` normal-profile default. Add
`--isolated` to generate `mcp --separate-profile` explicitly. A custom `--profile`
requires `--isolated`. Separate profiles need a supported engine; on macOS that
means macOS 14+. Remote configurations cannot contain a local binary/profile
or credentials. A custom `--url` must be HTTPS without credentials, query or
fragment. Finish OAuth using the host's supported flow; never paste tokens into
the generated configuration or a prompt.

| Client | Printed format / setup |
| --- | --- |
| Codex | TOML `[mcp_servers.kitsuvo]`; respect the intended Codex home or trusted project |
| Claude Code, Claude Desktop, Cursor, Cline, LM Studio | JSON `mcpServers`; use the host's configuration/connection UI |
| Gemini CLI | JSON `mcpServers`; remote Streamable HTTP uses `httpUrl`, not the SSE `url` key; check folder trust |
| VS Code Local harness | JSON `servers` with `type`; select the correct configuration destination |
| Copilot portable configuration | JSON `mcpServers`; verify the chosen harness and current host setup destination |
| Continue | YAML `mcpServers`; use Agent mode and the intended workspace/user configuration |
| OpenCode | JSON `mcp` with `local` or `remote` entry and a command array for local execution |
| OpenClaw | JSON `mcp.servers`; select its outbound MCP client runtime, then probe and run a real task |
| Grok Bot, ChatGPT web, Claude web | Remote URL + OAuth and host-specific setup guidance |
| OpenAI/xAI/Claude APIs | Remote connection metadata; secure user authorization, tool selection and action approval belong to the application |
| n8n, Dify | Remote workflow setup; qualify exact transport/version, OAuth refresh and workflow permissions |

ChatGPT web uses its custom MCP plugin flow; account/workspace policy applies.
Claude web can use the relay's automatic OAuth registration path. Neither is
the same as launching a local stdio server from a desktop application.
[ChatGPT connection testing](https://developers.openai.com/plugins/deploy/connect-chatgpt),
[Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

Host formats differ. For example, Gemini's `httpUrl` and VS Code's `servers`
cannot be replaced with a generic Cursor configuration. OpenClaw's MCP server
mode is the reverse direction, exposing OpenClaw; this integration uses its
client registry. Provider documentation and the exact installed runtime take
precedence over a recipe, and generated configurations are not workflow proof.
[Gemini](https://geminicli.com/docs/tools/mcp-server/),
[VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers),
[OpenClaw](https://docs.openclaw.ai/cli/mcp/registry)

## Frameworks and other models

Prefer the framework's existing MCP client/toolset. Pass the same installed
executable + `mcp` locally, or approved OAuth relay URL remotely. Keep credentials
in that framework's secure credential lifecycle and propagate cancellation.
Bind calls to the actual task target; two tabs can still share website cookies.

| Framework or service | Integration boundary |
| --- | --- |
| LangChain / LangGraph | MCP adapter supplies the browser tools to the agent; keep the MCP connection alive for the task. [Documentation](https://docs.langchain.com/oss/python/langchain/mcp) |
| Google ADK | MCP toolset with stdio or Streamable HTTP connection parameters; preserve user credential scope. [Documentation](https://adk.dev/tools-custom/mcp-tools/) |
| CrewAI | MCP tools through the documented stdio/HTTP adapter; retain the adapter context for the run. [Documentation](https://docs.crewai.com/en/mcp/overview) |
| Vercel AI SDK | MCP client/tool definitions and the application's OAuth provider; a model call does not create browser consent. [Documentation](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools) |
| OpenAI Responses API | Remote MCP or supported private tunnel; application-managed OAuth and explicit call approvals. [Documentation](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) |
| xAI API | The generated remote recipe exposes observation/target selection only. `require_approval` is not implemented; use the function adapter with application approval for page changes. [Documentation](https://docs.x.ai/developers/tools/remote-mcp) |
| Claude API | Remote MCP tools; resources and embedded UI are separate capabilities. [Documentation](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) |
| n8n / Dify | MCP Client/workflow tools; check version-specific HTTP/SSE support and whether shared workflow users inherit credentials. [n8n](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp), [Dify](https://docs.dify.ai/en/cloud/use-dify/workspace/tools) |

DeepSeek, Qwen, Mistral, Llama, Ollama and other tool-capable models can use
Kitsuvo inside a compatible host. Do not infer that their consumer websites
allow custom connections. Devin/Windsurf, Zapier, AutoGen, Semantic Kernel,
PydanticAI and other hosts need qualification of their actual current runtime;
existing recipes or similar names do not establish support. Closed hosts need
a vendor-supported extension point rather than a policy bypass.

### Function-tool adapter

For an application that accepts function tools but has no native MCP toolset,
`integrations/mcp-http/function-tools.mjs` adapts an already authenticated MCP
client. It discovers schemas, exposes only an explicit allowlist, binds an
immutable browser target, and requires an application approval callback for
every call. It does not store credentials, start a server, choose a model,
approve itself, change the MCP default profile, or retry uncertain operations.

```js
import { browserFunctionTools } from './integrations/mcp-http/function-tools.mjs';

// mcpClient is your authenticated SDK client. Obtain and verify browserTarget
// through browser_find/browser_attach, or use the target supplied by the user.
const browser = await browserFunctionTools(mcpClient, {
  browser: browserTarget,
  allowedTools: ['browser_snapshot', 'kitsuvo_report'],
  approve: request => applicationApproval(request),
});
const responseTools = browser.openai();    // OpenAI/xAI Responses-style functions
const claudeTools = browser.anthropic();   // name, description, input_schema
// Dispatch an approved model-selected function once; forward its actual result.
const result = await browser.call(toolName, toolArguments, { signal });
browser.close();
```

Keep tool arguments as parsed JSON objects, preserve `isError` and observed
content, and return the result through the provider's documented tool-result
message. The application owns the authenticated MCP client's lifetime and
task cleanup. An optional setup `signal` covers discovery and the adapter
lifetime; a per-call `signal` covers that call. Cancellation and `close()` also
settle pending approval/catalog waits. The approval callback receives an optional
second argument `{ signal }` so an application can dismiss its own approval UI.
Closing the adapter cancels its active request, never the shared client or other
tasks. Already dispatched page actions may have completed; inspect the browser
before retrying.

Pass a plain JSON argument object. The adapter takes a private snapshot before
approval and refuses values that JSON would drop or alter: undefined, non-finite
numbers, custom objects such as Date/Map/Set, accessors, symbols, cycles and
sparse/decorated arrays. Plain cross-realm and null-prototype records are
supported; negative zero follows JSON's zero representation. Input is limited
to 128 nesting levels and 100,000 values, checked within the same call budget.
Approval and dispatch use matching JSON data. Definition exports are fresh
snapshots, so a framework can normalize its copy without changing later exports.

Catalog discovery follows up to 16 pages and 2,048 uniquely named tools.
The App/HTTP bridge and local cloud connector aggregate complete backend page
chains into one client-visible catalog. Their shared read has one 180-second
budget, caches only complete validated results, and preserves first-page result
metadata and each tool's metadata. The App bridge reserves its three built-in
names and counts them within the 2,048-tool limit. Invalid/ambiguous names,
cyclic cursors and excess pages or tools fail discovery; a later request may
retry a failed read. Backend list-change notifications invalidate the complete
cache. A failed obsolete read cannot evict a newer generation, and cancelling
one client does not cancel discovery shared with another client.

Every revalidation page consumes the same approval-to-dispatch call budget;
pagination never resets the deadline. Revalidation ignores JSON object key order but still refuses
changed contracts, duplicate names and cyclic/oversized pagination. Model tool
selection, paid API calls and interactive host behavior need separate tests.

`timeoutMs` (default 60 seconds, maximum 180 seconds) bounds initial discovery
and each call separately. A call's single budget includes application approval,
contract revalidation and browser execution. The SDK and native queue receive
only the remaining time. Abort and `close()` promptly reject pending callers,
and late approvals or catalogs cannot dispatch. A dispatched client promise
keeps the adapter busy until it settles, even if that client ignores cancellation.
Cancellation cannot undo an executed action; inspect browser state before retrying.

Remote/App/HTTP connector children in current native source enforce
`KITSUVO_MCP_SCOPE=isolated`: even a copied normal-window target cannot escape
the connector profile. Update older native binaries before relying on this
additional boundary. This does not change the ordinary local MCP default.

## Qualification

Install the locked bridge dependencies, then run the actual native client
checks on an isolated profile:

```sh
npm ci --ignore-scripts --prefix integrations/mcp-http
node integrations/mcp-http/qualify-client.mjs --binary /absolute/path/to/kitsuvo
node integrations/mcp-http/qualify-client.mjs --binary /absolute/path/to/kitsuvo --app
```

These checks call no LLM and approve only their own loopback fixture operations.
They verify actual native tools, target discovery, two-task page selection,
function-adapter binding, detection reports, protected-page refusal and optional
App resources. They retain a disposable private profile for investigation.
An optional `--output` path records the result. For the remote OAuth chain run
`integrations/mcp-cloud/qualify-local-native.mjs` with the intended
`KITSUVO_BINARY`; its temporary relay approves only its own fixture client.

These are native/protocol checks, not proof of Grok Bot/ChatGPT/Claude account
installation, model selection or in-chat panel rendering. Use
`integrations/distribution/compatibility.json` as the route inventory, and the
dated execution record for actual results. Before marking a host workflow
passed, record its exact versions, native OS/build, transport/profile, deployed
relay revision, observed tool result, refusal/Stop/revoke, restart and
two-task behavior. Keep credentials and private page data out of reports.

Native MCP supports initialization-based revisions through `2025-11-25` and
retains the older supported revisions. The pinned Node SDK also uses that
protocol family. Modern stateless-only `2026-07-28` clients are not advertised:
use a documented dual-era client with legacy fallback, or record the host as
blocked. Unsupported-era probes must fail before dispatching a page operation;
changing a version string alone does not implement the new semantics.
[Protocol versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)

Windows and macOS use the same MCP/adapter contract with explicit native
capabilities. Raw CDP remains a Windows-specific integration, not a universal
gateway. Mobile agent apps may control a qualified remote desktop connection;
the mobile Kitsuvo apps do not host the desktop stdio runtime. No native
Linux/container browser or always-on hosted fleet is introduced here.
