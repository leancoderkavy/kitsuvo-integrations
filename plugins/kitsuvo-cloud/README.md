# Kitsuvo cloud plugin

This remote variant connects to https://kitsuvo-mcp-relay.fly.dev/mcp with OAuth.
It does not start a browser on the relay. Install Kitsuvo on your Windows or Mac
computer, start integrations/mcp-cloud/connect.mjs and explicitly approve your
AI client's request in that connector. Keep it running; closing it revokes access.
See [client setup](https://kitsuvo.com/downloads/distribution-clients.md).

After adding `leancoderkavy/kitsuvo-integrations` as a marketplace, install in
Claude Code 2.1.275 or later with:

```text
/plugin install kitsuvo-cloud --marketplace leancoderkavy/kitsuvo-integrations
```

Requested page content passes through the authenticated relay to your AI client.
Automation uses an isolated profile and refuses sensitive pages by default.
The local and remote plugins expose the same tool names; enable the intended one.
This package is not a public-directory approval or a registered OpenAI app ID.
