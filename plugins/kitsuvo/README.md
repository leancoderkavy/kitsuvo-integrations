# Kitsuvo

Browse with evidence. Kitsuvo helps you inspect AI-built websites, read the observations behind a verdict, and check pages at phone, tablet, and desktop sizes.

![Kitsuvo logo](assets/icon-256.png)

## What you can do

- Set up the installed Kitsuvo desktop browser.
- Open websites, read page text, and interact with accessible elements.
- Inspect AI-builder, slop, and impersonation evidence without treating provenance as proof of harm.
- Compare responsive layouts.

## Requirements and supported clients

Install Kitsuvo from https://kitsuvo.com on Windows or macOS and place `kitsuvo` on PATH. The plugin starts `kitsuvo mcp`; it does not download or bundle the native executable. The executable is the publicly distributed Kitsuvo desktop application, maintained in a separate private repository. Reviewers should install the desktop app first and test the local MCP connection.

The local server runs in Claude Code and Cowork. It does not run on Claude web or mobile. On macOS use page snapshots and resizing; screenshots are Windows-only.

## Data handling

Browser automation uses a separate local profile by default. It refuses sensitive sign-in pages and password fields. No sensitive-profile opt-ins are included in this package.

The server receives tool arguments, including URLs and any text the user asks it to type. It returns page text, snapshots, reports, and supported screenshots to the connected AI client. Pages can contain personal data. The native browser may retain local cookies, history, settings, and downloads until the user clears its agent profile or deletes the files. There is no Kitsuvo-hosted data service in this package and no fixed automatic deletion period.

Navigation contacts the websites the user opens. User-requested interactions can send entered text to those websites. Those destinations are chosen by the user, not a fixed vendor list. The plugin's skills do not add analytics or their own cloud upload service. If the user separately enables a cloud verdict provider in the native app, bounded page evidence is handled according to that provider's settings and terms. The connected AI client's data policy governs tool results it receives.

Privacy: https://kitsuvo.com/privacy
Terms: https://kitsuvo.com/terms
Support: https://github.com/leancoderkavy/kitsuvo-integrations/issues

## Reviewer walkthrough

1. Install Kitsuvo, then install this plugin and run the setup skill.
2. Ask to open https://example.com, read the page snapshot, and explain the detection report.
3. Resize the page to phone and desktop sizes and compare the layout.
4. Confirm an identity-provider page is refused and password fields are not typed into.
5. Remove the native executable from PATH and confirm setup explains the missing dependency.

No hosted account or API key is required. Local automation uses a disposable separate profile. Do not enter real credentials or confidential data during review.

## License

Proprietary personal-use integration license. See [LICENSE](LICENSE). The separately distributed native app and third-party dependencies retain their own licenses.
