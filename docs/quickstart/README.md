# Quickstarts

Copy-paste setup for each way to connect Kitsuvo to an AI client. Every snippet
here is taken from this repository's manifests and docs, and the client commands
were checked against the Claude Code and Codex command line.

| You use | Guide | Runs where |
|---|---|---|
| Claude Code | [claude-code.md](claude-code.md) | Local, on the computer with Kitsuvo |
| Codex | [codex.md](codex.md) | Local, on the computer with Kitsuvo |
| Claude Desktop or another client that launches local stdio servers | [mcp-clients.md](mcp-clients.md) | Local stdio |
| ChatGPT or another cloud client, with a tunnel you control | [http-bridge.md](http-bridge.md) | Loopback bridge plus a secure tunnel |
| A cloud client, no tunnel | [cloud-relay.md](cloud-relay.md) | OAuth relay on kitsuvo-mcp-relay.fly.dev |
| Builder evidence in the browser you already use | [browser-extension.md](browser-extension.md) | In the extension, no desktop app needed |

## Before any of these

1. Install Kitsuvo from
   [kitsuvo.com](https://kitsuvo.com/?utm_source=github&utm_medium=readme&utm_campaign=integrations)
   on Windows or macOS. First-launch prompts are explained on
   [kitsuvo.com/install](https://kitsuvo.com/install).
2. Make `kitsuvo` available on PATH, or use the absolute path to the
   executable in the configuration (`kitsuvo.exe` on Windows,
   `/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo` on macOS). Keep the
   argument `mcp`.
3. Plugins start the installed browser; they do not install it. No Kitsuvo
   account or API key is needed for local browsing and detection.

## First task

Ask your agent:

> Open https://example.com in Kitsuvo and explain its detection evidence.

Then try: `Check this page at phone and desktop sizes.`

The server opens a separate agent profile on first use, so your normal cookies
and history are not visible to it. It refuses sign-in pages and password fields.
On macOS use snapshots and resizing; screenshots are Windows-only.

## If tools are missing

- Start a new conversation after installing; hosts load tools at start.
- Check that `kitsuvo` resolves (`where kitsuvo` on Windows, `which kitsuvo`
  on macOS). Do not run `kitsuvo mcp` by hand to test it: it speaks MCP on
  stdin and stdout and will look hung.
- Replace `command` with the absolute path to the executable.
- Still stuck? Open an
  [install help issue](https://github.com/leancoderkavy/kitsuvo-integrations/issues/new?template=install_help.yml).
