# Cline marketplace submission

Status checked 2026-10-13: submitted as
[cline/marketplace#222](https://github.com/cline/marketplace/pull/222), open and
not merged. The live PR showed no reported checks. Do not open a duplicate.
Complete Cline's README-only or llms-install.md installation test before making
the corresponding compatibility claim. An SDK handshake or another client's
successful setup is not a Cline host qualification.

- Name: Kitsuvo
- GitHub repository: https://github.com/leancoderkavy/kitsuvo-integrations
- Installation instructions: https://github.com/leancoderkavy/kitsuvo-integrations/blob/main/llms-install.md
- Logo (400×400 PNG): https://kitsuvo.com/downloads/mcp/icon-400.png
- Author: leancoderkavy
- License: Kitsuvo Integration License (proprietary; do not select an open-source license)
- Description: Connect Cline to your installed Kitsuvo browser. Navigate pages,
  read accessibility snapshots and local detection evidence, and check responsive
  layouts. Local stdio requires no API key. Remote access requires an opt-in
  user connector and OAuth approval. The integration uses an isolated browser
  profile and refuses sensitive pages by default.

## Required qualification

Give Cline only the linked README or llms-install.md. Install on Windows or
macOS with a real Kitsuvo executable available. Record the Cline version, OS,
configuration it creates, tool discovery, example.com navigation and
snapshot/report results, sensitive-page refusal, and disconnect behavior.
Confirm no main-profile or sensitive-page override was added. Only then
complete the corresponding marketplace attestation.

Current catalog changes are reviewed in
[cline/marketplace](https://github.com/cline/marketplace). The older
`cline/mcp-marketplace` issue flow is legacy; use it only if Cline explicitly
redirects the current submission there.
