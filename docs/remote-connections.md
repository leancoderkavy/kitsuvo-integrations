# Connect to another computer

This source change adds a Browser / Terminal selector to the relay's `/remote`
page. It needs both the updated desktop app and updated relay. This change does
not publish or install either component.

On the host computer, open Settings → Assistants → Remote access, enable it,
and keep Kitsuvo running. On another computer or phone, open the remote-control
address shown there, choose **Link this device**, and approve the code on the
host. The connected-computer label identifies its OS; the native app does not
share the OS hostname. One page controls one paired computer. Unlink before
pairing with another computer.

If authorization expires or is revoked and refresh is rejected, the remote page
clears its tokens, old screenshot, controls and target address and returns to
**Link this device**. Approve a fresh link on the host to continue. A temporary
refresh-network failure keeps the link available for a manual retry and does
not replay the last action.

**Browser** controls only the separate agent profile. The normal signed-in
profile and local MCP default are unchanged.

For **Terminal**, enable Developer tools on the host, choose **Request terminal
access** on the client, and review the request on the host. The host chooses a
starting folder and confirms a native shell permission dialog. The folder is a
starting location, not a sandbox: commands run with that OS user's permissions.
Nothing is typed automatically. Browser approval does not approve a shell. A
new PTY is created; existing local terminal sessions and their output are not
shared.

**End terminal session** on the client or **End remote terminal** in the host's
Remote access settings stops the shell. Unlinking, revoking the device, turning
remote access off, or losing the host connection also ends the session. If the
controlling tab/network disappears without sending a stop, the relay expires
it after 15 seconds without polling; the native host independently expires it
after 20 seconds. Pending approvals expire after 60 seconds. An approved
terminal expires after 15 minutes without input. Reloading requires a new
request and approval. Stopping does not undo commands or promise to terminate
a deliberately detached program.

## Access and data boundaries

- `/remote/terminal` is an authenticated, same-origin HTTP channel, not an MCP
  method or tool. Existing MCP/IDE clients gain no shell tool. Each terminal ID
  belongs to one computer and one OAuth grant; another device cannot poll,
  type into, resize or stop it. Token rotation preserves the same grant.
- One remote PTY per host; at most one new request per 30 seconds. Input is
  limited to 8 KiB and output to 64 KiB per poll, with bounded queues. The
  vendored xterm runtime keeps 2,000 lines in memory, with no link provider or
  clipboard escape handler. Link activation is explicitly disabled. Dynamic styles use a response-specific CSP nonce;
  scripts remain same-origin without inline-script permission.
- Kitsuvo and the relay do not persist terminal input/output, approvals or
  starting folders, or send them to telemetry. Input/output necessarily pass
  through the relay to the approved device. The shell and commands may write
  files or history according to the user's shell configuration.
- The independent native watchdog handles leases even while folder/permission
  dialogs hold the UI loop. Approval is checked again after those dialogs;
  an expired request cannot start a shell.
- Agent-mode, private-tab and App Store hosts cannot approve terminals. The
  host must support developer tools and keep them enabled. Changing those
  permissions ends the PTY. Local terminals remain unavailable to MCP agents
  and website IPC.
- The relay advertises support before the native app sends capabilities.
  Older relays retain browser-only behavior. Legacy Node/background connectors
  do not advertise a terminal and cannot accidentally expose one.

New host approval copy currently uses the normal English fallback for new
catalog keys; the relay page retains its existing English-only interface.

## Platform and verification record

The founder explicitly approved remote terminals on 2026-11-01 as an extension
of the remote-access scope-freeze exception. That authorizes source work, not
publication or a change to the protected MCP default.

| Surface | Applicability / implementation | Validation |
| --- | --- | --- |
| Windows | Shared approval, lease, relay and PTY code; existing PowerShell/ConPTY adapter. | Chromium checks pass in Windows state at wide/narrow widths. Native WebView2, folder/permission dialogs and ConPTY execution remain pending: no native Windows host was used. |
| macOS | Same shared implementation; existing zsh/PTY adapter. macOS 14+ remote-profile restriction retained. | Native Rust PTY input/output, resizing, stopping and lease checks pass. Both Chromium macOS widths pass. Actual WKWebView approval/folder-dialog interaction and a physical second-device run remain pending. |
| iOS/iPadOS | Can control a desktop using the relay page; cannot host this OS shell. No native app adapter added. | 390px Chromium client flow passes; physical Safari/iOS remains pending. |
| Android | Can control a desktop using the relay page; cannot host this desktop PTY. No native app adapter added. | Same narrow client flow; physical Android/Chrome remains pending. |
| Website / relay | Existing `/remote` gains Browser / Terminal and a separate grant-bound channel. Marketing site unchanged. | Relay unit/integration and client end-to-end tests pass locally. Production deployment not performed. |
| Extensions / browser plugins | Not applicable: no terminal host runtime or shared permission route. | Source impact review; unchanged. |
| MCP / IDE clients | Browser-only tool/resource contracts unchanged; legacy Node connectors remain browser-only. | Existing relay OAuth, isolation, cancellation, resource and revocation checks pass. No package publication. |
| Mac App Store | Terminal deliberately unavailable and capability reports false; host controls hidden. | Store configuration compiles successfully; no Store submission. |

Reproduction:

```sh
node --test --test-concurrency=1 integrations/mcp-cloud/test/*.test.mjs
node --test --test-concurrency=1 tests/remote-control-page.test.mjs tests/remote-terminal-host.test.cjs tests/terminal-visibility.test.cjs
cargo test --no-default-features --bin kitsuvo remote:: -- --test-threads=1
cargo test --no-default-features --bin kitsuvo terminal:: -- --test-threads=1
cargo clippy --no-default-features -- -D warnings
cargo check --no-default-features --features app-store
cargo check
python3 scripts/build_localizations.py --check
```

The relay Docker image includes xterm, the fit addon, CSS and MIT licenses copied
byte-for-byte from `src/ui/vendor/`. Keep the copies in sync when upgrading the
shared terminal runtime. No CDN is required.
