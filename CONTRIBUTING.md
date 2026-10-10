# Contributing

Thanks for looking at the Kitsuvo integrations. This repository holds the
Claude Code and Codex plugin, the local MCP bridge, the cloud relay, the Rust
connector client and the browser extension previews for
[Kitsuvo](https://kitsuvo.com/?utm_source=github&utm_medium=readme&utm_campaign=integrations),
the free anti-AI web browser for Mac and Windows.

## Before you start

- These files are published under the
  [Kitsuvo Integration License](LICENSE): personal use and local configuration
  changes are allowed; other modification and redistribution need written
  permission. Questions about permission go to hello@kitsuvo.com.
- The sources are maintained alongside the native Kitsuvo app in a private
  repository and published here, so a change accepted here also has to be made
  there. Open an issue before you write a pull request, so we can say whether
  the change fits.
- The native desktop app is not in this repository. Problems with the browser
  itself are still welcome as issues.

## The most useful contributions

| You found | Open |
|---|---|
| A plugin, skill, MCP, bridge, relay or extension bug | A [bug report](https://github.com/leancoderkavy/kitsuvo-integrations/issues/new?template=bug_report.yml) |
| A step that did not work during install | An [install help](https://github.com/leancoderkavy/kitsuvo-integrations/issues/new?template=install_help.yml) request |
| A missing client, tool or workflow | A [feature request](https://github.com/leancoderkavy/kitsuvo-integrations/issues/new?template=feature_request.yml) |
| A security problem | Nothing public. See [SECURITY.md](SECURITY.md) |
| A typo or an unclear sentence in the docs | A pull request, after a short issue |

Tell us the client (Claude Code, Codex or another MCP client) and its version,
your operating system, how you installed Kitsuvo, and the exact command that
failed. Remove tokens, cookies and anything personal from logs first.

## Claims stay evidence-based

Kitsuvo's descriptions are deliberately cautious, and changes to docs and
manifests must keep that tone:

- AI-built is provenance, not proof of harm; a low score is not proof of human
  authorship or safety.
- Do not claim a directory listing, store approval, ratings, user counts or
  platform support that has not been qualified. See
  [docs/browser-extensions.md](docs/browser-extensions.md) and
  [docs/marketplace-integrations.md](docs/marketplace-integrations.md) for what
  is and is not established.
- Do not enable `--main-profile` or `--allow-sensitive` in any shipped
  configuration. Automation uses a separate profile and refuses sign-in pages.
- Never put tokens in URLs, arguments, examples or commit messages.

## Running the checks locally

These are the same commands the
[validation workflow](.github/workflows/validate.yml) runs.

```sh
# HTTP MCP bridge (Node.js 22 or newer)
cd integrations/mcp-http && npm ci --ignore-scripts && npm test

# Cloud relay and connector
cd integrations/mcp-cloud && npm ci --ignore-scripts && npm test

# Rust connector client
cargo fmt --manifest-path crates/kitsuvo-connectors/Cargo.toml --check
cargo test --locked --manifest-path crates/kitsuvo-connectors/Cargo.toml
cargo clippy --locked --manifest-path crates/kitsuvo-connectors/Cargo.toml --all-targets -- -D warnings
python scripts/test_connectors.py

# Firefox extension lint
npx --yes web-ext@10.7.0 lint --source-dir extensions/firefox --warnings-as-errors
```

`claude plugin validate .` and `claude plugin validate ./plugins/kitsuvo`
check the Claude marketplace and plugin manifests.

## Pull requests

Keep a pull request to one concern, say what you ran, and do not bump a plugin
or extension version: versions are set when archives are rebuilt and published.
