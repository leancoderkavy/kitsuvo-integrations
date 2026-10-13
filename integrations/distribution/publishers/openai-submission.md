# OpenAI submission preparation

Status: package preparation, not a registered or approved public plugin.
Use the remote `kitsuvo-cloud` package for a hosted conversation, or the local
`kitsuvo` package for a desktop host with local execution support.

Both portable manifests include website, support, privacy and terms links,
square 256px composer/listing icons, five positive and three negative review
cases under `extensions.com.openai.review`, and an explicit commerce declaration.
The cloud package declares OAuth with Dynamic Client Registration, the relay's
resource identifier, and the `browser` scope under the namespaced MCP auth
extension. It contains no client secret or registered client identifier.
Review cases describe expected behavior; they are not a claim that all cases
passed in ChatGPT or that review is approved.

## Publisher-only completion steps

1. Open https://platform.openai.com/plugins in the correct organization/project.
   Resolve developer identity or Apps Management Write access if the dashboard
   requests it. Identity verification requires the owner's participation.
2. Upload the corresponding ZIP. Resolve actual metadata/skills findings and
   connect the MCP server through the dashboard. Use the portal's registered
   identity and mapping; never fabricate `.app.json` identifiers.
3. Complete the supplied domain challenge and applicable mTLS registration.
   Challenge values and registration state must come from the real portal.
4. Start a dedicated reviewer connector with an empty automation profile and
   complete the real OAuth flow. Provide access only through the secure review
   form; no credentials belong in GitHub, a plugin ZIP, or these instructions.
5. Record a real walkthrough and provide its reviewer-accessible URL. No demo
   recording URL is declared until a genuine recording is available.
6. Run the eight declared cases in the actual host, finish automated checks,
   submit the draft, and publish only after approval. Uploaded packages, scans,
   submitted review and a live directory listing are distinct states.

## Known authentication blocker

The relay currently advertises only the `browser` scope and `/userinfo` returns
an opaque subject. It does not advertise `openid` and `email`, or return an
email with `email_verified: true`. OpenAI requires that identity when workspace
email/domain restrictions apply. Do not invent those claims in package
metadata; implement and test a real identity source before enabling that gate.

The portal also requires an accessible walkthrough recording and private
reviewer access. Neither belongs in this repository until it is real.

[Official submission requirements](https://developers.openai.com/plugins/deploy/submission)
are the authority for the current dashboard flow.
