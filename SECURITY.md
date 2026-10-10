# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Email **hello@kitsuvo.com** with the subject line `Security: <short summary>`.
If the repository's **Security** tab shows a **Report a vulnerability** button,
you can use that instead.

Include:

- which component is affected (plugin, skills, `integrations/mcp-http`,
  `integrations/mcp-cloud`, `crates/kitsuvo-connectors` or an extension) and
  the file or version;
- the steps to reproduce it, and what you expected to happen;
- what an attacker gains, and any proof-of-concept you are willing to share.

Do not include live tokens, cookies or other people's data. Redact them.

## What is in scope

This repository holds the Kitsuvo plugin and skills, the local HTTP MCP bridge,
the cloud relay and its connector, the Rust MCP connector client and the browser
extension sources. Reports are especially useful for:

- the local bridge accepting a request it should refuse (it is meant to bind
  only to `127.0.0.1` and reject foreign `Host` and `Origin` headers);
- the plugin, skills or MCP server driving a sign-in page, a password field or
  the user's main profile when they are meant to be refused;
- the cloud relay or connector skipping its consent step, leaking a token or
  routing one user's requests to another user's browser;
- a browser extension requesting or using more access than its manifest and
  [listing](extensions/listing/store-listing.json) describe, or sending page
  content anywhere;
- secrets, keys or credentials committed to this repository.

Weaknesses in the native Kitsuvo desktop application are also welcome at the
same address, even though its source is not in this repository.

## What is not a vulnerability

- A detection score that is wrong. Scores are evidence to review, not proof of
  AI authorship or safety. Please open a normal issue instead.
- The unsigned installer warning from Windows or macOS. See
  [kitsuvo.com/install](https://kitsuvo.com/install).
- Anything that needs you to run your own malicious MCP server or tunnel, or to
  expose the loopback bridge to the public internet, which its documentation
  warns against.

## Handling

This repository has a single `main` branch, and fixes are made there. We do not
publish a fixed response time. Please give us a reasonable chance to fix a
problem before you disclose it publicly.

Data handling for the integrations is described in the
[privacy policy](https://kitsuvo.com/privacy) and in the
[plugin README](plugins/kitsuvo/README.md#data-handling).
