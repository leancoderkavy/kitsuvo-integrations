# Use Kitsuvo in Grok Bot

Connect Grok Bot to Kitsuvo on your own computer to open pages, read them and
explain detection evidence. This uses Kitsuvo's existing OAuth relay; it does
not install Kitsuvo on the Bot's cloud computer or replace its built-in browser.

## Before you start

- Install a current Kitsuvo build on Windows or macOS 14 (Sonoma) or later.
  Check that Settings → Assistants → Remote access is available. An older
  published installer may lack these controls; source availability is not a
  public release. Get available installers from <https://kitsuvo.com/install>.
- Keep that computer awake, online and running the approved connector.
- Use a Grok Bot account that permits custom MCP connections. Team policy may
  require an administrator. No Kitsuvo API key is needed.

The cloud connection uses a separate persistent agent profile. Normal browser
sign-ins are not connected. Requested page text, screenshots, tool arguments
and evidence pass through the relay to the AI client you approve. This is
optional remote access, separate from local detection. Saved knowledge is not
automatically shared. Grok Bot connections can be used by other Bots on the
same account; separate chats do not create separate grants or cookie stores.

## 1. Enable the browser connection

In Kitsuvo, open **Settings → Assistants → Remote access**, read the disclosure
and enable remote access. Keep Kitsuvo open for setup. Review each requesting
client before approving it. Do not run a second terminal connector for the same
setup at the same time.

If that build does not have native Remote access, use the terminal alternative
below with a browser build that supports isolated MCP.

## 2. Add Kitsuvo in Grok Bot

Paste this setup request into your Bot:

```text
Add a custom remote MCP connection named Kitsuvo with this server URL:
https://kitsuvo-mcp-relay.fly.dev/mcp
Use OAuth and start its authentication flow. Do not install or run a local
kitsuvo command on your cloud computer. Let me complete sign-in and approve
the requesting client on my own computer. Attach this connection to this task.
```

Complete the host's **Connect / Authenticate** flow. **Connect apps** manages
installed connections; an installed entry alone is not proof of authentication.
If your host offers **Add custom**, enter the same URL and OAuth there. Labels
vary by host version; if custom connections are unavailable, stop and check
your account/team policy rather than importing the local desktop plugin.

In Kitsuvo, review the requesting client and return address. Approve only the
request you just started, then finish or refresh the authorization page. Never
paste passwords, verification codes, access tokens or connector identity files
into a Bot message. Enable/select Kitsuvo in the task after authentication.

For UI-only setup fields from the existing generator, run this in an extracted
integration package or source checkout:

```sh
node integrations/mcp-http/clients.mjs --client grokbot --transport remote
```

It prints instructions, not an importable Grok Bot configuration, and changes
no settings. Do not add invented OAuth client IDs, secrets or bearer headers.

## 3. Copy a first browsing request

```text
Use the Kitsuvo MCP connection for this task. Check browser_status first and
report the actual connection/profile mode. If available, register Grok Bot
with browser_session using the real task ID; do not invent an ID or URL.
Keep browser_resource_budget at max_tabs: 1. Record existing tabs, create or
reuse one task-owned tab, and open https://example.com in the approved isolated
browser. Read its snapshot and kitsuvo_report. Tell me the observed title,
one fact from the page, and what the detection evidence does and does not show.
Use actual Kitsuvo tool results. If its tools are missing or fail, report that
failure and stop. Do not substitute your built-in browser or call installation
a successful connection. Close only the tab created for this test and complete
the session with browser_cleanup, preserving existing tabs and profile data.
```

If using a user-supplied Kitsuvo browser target, attach to that exact target
first and retain it on every subsequent call. Use current snapshot refs and
explicit tab numbers. Do not silently select a replacement window.

Success means a real Kitsuvo tool call, the observed page title and evidence
from the connected desktop browser. Seeing the connection in a list, a cached
answer, or the Bot's own browser is insufficient. An in-chat interactive panel
is optional and requires separate host qualification; this guide does not
promise Grok Bot renders MCP Apps.

Next tasks can include “Explain why this page was flagged” or “Read this public
page and cite the evidence.” A detection score is not proof of human authorship
or safety. For a layout check, inspect sizes sequentially, record the actual
capped dimensions and restore `browser_resize` with `off: true` before cleanup.

## Terminal alternative (Windows and macOS)

Use Node.js **24.22.1 or newer**, matching the cloud package's engine requirement.
Download and extract the integration package linked from
<https://kitsuvo.com/integrations>, then open a real interactive terminal in
its `integrations/mcp-cloud` directory. Install its locked dependencies. Use
your actual executable path in place of the Windows example:

```powershell
npm.cmd ci --ignore-scripts
$env:KITSUVO_BINARY = 'C:\Program Files\Kitsuvo\kitsuvo.exe'
$env:KITSUVO_CLOUD_ORIGIN = 'https://kitsuvo-mcp-relay.fly.dev'
npm.cmd run connect
```

On macOS 14 or later:

```sh
npm ci --ignore-scripts
export KITSUVO_BINARY=/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo
export KITSUVO_CLOUD_ORIGIN=https://kitsuvo-mcp-relay.fly.dev
npm run connect
```

Review the destination and type `CONNECT` in that terminal. Add the remote URL
in Grok Bot as above. Its authorization page gives a one-time request code;
enter `approve CODE` in the connector terminal, review the client and return
address, then type `APPROVE`. Refresh the authorization page and keep the
terminal running. This starts `kitsuvo mcp --separate-profile`; macOS 13 and
earlier cannot provide cloud isolation and are refused. Plain local `kitsuvo
mcp` retains its normal-profile default and is not a cloud workaround.

For optional startup at login, App mode, grant lifetimes and service removal,
see the [cloud connector guide](https://kitsuvo.com/downloads/cloud-relay.md).
App mode needs the sibling HTTP bridge dependencies and a compatible host;
basic Grok Bot tool use does not need it.

## Troubleshooting and disconnect

| Symptom | Next step |
| --- | --- |
| `spawn kitsuvo ENOENT` on the Bot's cloud computer | Disable/remove that mistaken local stdio connection, then add the HTTPS URL. Installing Kitsuvo or changing PATH on your laptop cannot repair a command running in the cloud. Avoid duplicate local/remote catalogs. |
| `ENOENT` in your local connector terminal | Check `KITSUVO_BINARY` points to the actual installed executable. |
| Installed, but no tools | Finish Authenticate/Reconnect, select Kitsuvo in the task, and retry the harmless check. Check team policy if disabled. |
| OAuth fails or return address is rejected | Restart authentication from the same client; inspect the client/redirect in the local approval UI. Report the error without tokens. Do not disable redirect validation. |
| Offline / 503 | Wake the Kitsuvo computer and check its connector. A temporary terminal connector may need fresh authorization after disconnect. |
| `browser_status` missing | Update to a build exposing the required tool; do not infer profile or capabilities from an old installer. |
| Sign-in or password entry refused | Complete protected steps directly in Kitsuvo yourself; do not disable sensitive-page guards. |
| Local plugin still appears after changes | Use the host's supported uninstall/reimport flow. Source edits do not refresh an installed team catalog. |

Use **Stop** in Kitsuvo to end agent control. To revoke ongoing access, disconnect
the approved client in **Remote access**, and disconnect/remove Kitsuvo in Grok
Bot. For a temporary terminal connector, Ctrl+C disconnects and revokes its
grants; an installed background service instead resumes grants on restart, so
use `node service.mjs revoke` to revoke all its clients or `node service.mjs
uninstall` to remove it. Closing a browser tab is not OAuth revocation. Confirm
a subsequent Bot browser call is refused before considering access removed.
Revocation does not delete page data already returned to the AI provider.

## Evidence and platform limits

This guide describes the existing native/terminal relay contract and the
existing Grok Bot setup generator. It does not establish a signed-in Grok Bot
OAuth round trip or successful browser task. Record those separately before
claiming live compatibility. No public package, catalog or relay deployment is
implied by merging the guide.

| Surface | Implementation / validation boundary |
| --- | --- |
| Windows | Native Remote access and PowerShell terminal instructions; configuration generation checked separately from native browser execution. |
| macOS | Equivalent native and shell setup; cloud isolation requires macOS 14+. Native macOS/Grok Bot interaction remains pending. |
| iOS/iPadOS and Android | Grok Bot can be the controlling client; the Kitsuvo desktop computer must stay online. Mobile Kitsuvo apps do not run the desktop Node connector. Device interaction remains pending. |
| Website / integration packages | Downloadable guide and package/export inclusion; no relay endpoint, OAuth schema, scopes or native behavior changed. |
| Extensions / IDE plugins | No changed runtime or permission contract. The desktop stdio plugin remains for local hosts, not the Bot's cloud computer. |

Host references checked November 3, 2026:
[Connect apps](https://prod.cursor.com/help/grok-bot/connect-apps),
[Grok Bot overview](https://prod.cursor.com/docs/grok-bot), and
[Cursor staff's custom MCP setup instructions](https://forum.cursor.com/t/how-do-i-share-a-custom-mcp-that-one-of-my-bots-has-built-with-the-rest-of-my-team/173538).
These establish host setup concepts, not a live Kitsuvo integration test.
