# Cursor marketplace submission preparation

Status checked 2026-10-13: Kitsuvo was not returned by the public Cursor
Marketplace search. Cursor exposes a publisher application and reviews official
MCP servers and Agent Plugins for inclusion.

- Name: Kitsuvo
- Website: https://kitsuvo.com
- Portable Agent Plugin: `plugins/kitsuvo`
- Remote MCP endpoint: https://kitsuvo-mcp-relay.fly.dev/mcp
- Privacy: https://kitsuvo.com/privacy
- Terms: https://kitsuvo.com/terms
- Support: mailto:hello@kitsuvo.com

## Publisher completion steps

1. Sign in at https://cursor.com/marketplace/publish and apply with the website and downloadable
   integration archive. Point reviewers at `plugins/kitsuvo` if the form accepts a
   repository subdirectory; otherwise publish a dedicated release repository
   whose root is the portable plugin.
2. Prefer the local Agent Plugin for desktop Cursor because it starts the
   user's installed Kitsuvo browser. Offer the authenticated relay only where
   Cursor's OAuth connection flow is supported.
3. In a current production Cursor build, install the submitted artifact, list
   the Kitsuvo tools, open `https://example.com`, read a snapshot and report,
   restore responsive mode, verify sensitive-page refusal, and disconnect.
4. Record the Cursor version, OS, install source, discovered tools, and whether
   the MCP Apps panel rendered. A successful JSON configuration test does not
   establish Marketplace installation or panel support.
5. Submit only after the download URLs contain the exact
   reviewed version. Preserve the existing listing rather than creating a
   duplicate if Cursor assigns one during review.

Cursor's manual `.cursor/mcp.json` route remains supported independently of a
Marketplace decision.
