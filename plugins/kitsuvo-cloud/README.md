# Kitsuvo cloud plugin

This remote variant connects to https://kitsuvo-mcp-relay.fly.dev/mcp with OAuth.
It does not start a browser on the relay. Install Kitsuvo on your Windows or Mac
computer, start integrations/mcp-cloud/connect.mjs and explicitly approve your
AI client's request in that connector. Keep it running; closing it revokes access.
See [client setup](https://kitsuvo.com/downloads/distribution-clients.md).

Download and extract the integrations archive from https://kitsuvo.com/integrations.
Run `claude plugin marketplace add .` from the extracted folder, then install in
Claude Code 2.1.275 or later with:

```text
/plugin install kitsuvo-cloud --marketplace kitsuvo-browser
```

Requested page content passes through the authenticated relay to your AI client.
Automation uses an isolated profile and refuses sensitive pages by default.
The local and remote plugins expose the same tool names; enable the intended one.
This package is not a public-directory approval or a registered OpenAI app ID.
