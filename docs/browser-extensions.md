# Kitsuvo browser extensions

The extension runs a focused local subset of Kitsuvo's desktop detector. It
uses the same hosting, markup-fingerprint, generator, builder-meta, and
traditional-CMS rule tables and the same score curve. It scans on request and
optionally filters search results by builder hosting. It is independent of the
desktop browser; no native messaging host, AI account, or API key is needed.

It does not port the desktop's design/copy analysis, slop and impersonation
checks, cloud verdicts, calibrated models, corrections, or page-navigation gates.
Hosting alone is circumstantial, and the interface says so.

## Build and test

```sh
python scripts/build_extensions.py
node --test tests/extensions.test.cjs tests/extensions-ui.test.cjs
CHROME_PATH=/path/to/Chromium node scripts/smoke_extension.cjs
npx --yes web-ext@10.7.0 lint --source-dir dist/extensions/firefox
```

`extensions/shared/rules.js` is generated from the Rust tables. Regenerate it
when those tables change. `--site` also copies deterministic upload archives
to `site/downloads/`; browser-store signing is not part of archive generation.

| Browser | Package | Installation before store approval |
| --- | --- | --- |
| Chrome, Edge, Opera, Brave, Vivaldi | `dist/extensions/chromium/` | Load unpacked in the browser's extension developer mode |
| Firefox | `dist/extensions/firefox/` | Load `manifest.json` using `about:debugging` for temporary testing; public installs require Mozilla signing |
| Safari | `dist/extensions/safari/` | Package through Apple's Safari Extension Packager or Xcode, then test and sign the containing app |

The corresponding ZIPs are in `dist/`. These are upload/source archives,
not signed Chrome CRXs, Firefox XPIs, or Safari applications. Chromium-based
mobile browsers vary in extension support; compatibility is not claimed for
every mobile browser. Runtime testing in one engine does not prove Safari or
Firefox behavior; complete per-browser qualification before store submission.

The runtime smoke was verified with Chromium 143 on Windows. Use an unbranded
Chromium build that supports `--load-extension`; recent branded Chrome builds
may disable that flag. The smoke loads a real worker and injects the bundled
detector into a loopback fixture, then verifies that password pages are skipped.
Only the temporary smoke package receives loopback host access to substitute
for the toolbar's activeTab grant. Public packages do not contain that access.

## Product and privacy

The toolbar popup offers **Scan this page**, the evidence report, and an
optional search filter for Google.com, Bing, and DuckDuckGo. Filtered results
have a **Show hidden results** control on the search page. Only hosting
signals that reach the native 70 threshold are filtered; weaker hosting such
as Replit is not hidden on hosting alone. Search-engine markup can change;
unrecognized results remain visible.

The popup's nonblocking guide appears the first time it opens, persists its
completed/dismissed version in local extension storage, and can be replayed
with **Help**. Close and Escape restore focus. It never scans or grants access
on the user's behalf. Keyboard, reduced-motion, and narrow layouts are supported.

Default permissions are `activeTab`, `scripting`, and `storage`. Persistent
search-host access is optional and removed when the filter is disabled.
No cookies, history, native messaging, web requests, remote executable code,
or cloud connections are requested. Stored preferences contain no page data.
Page scans skip sign-in provider hosts, password-field pages, and private tabs.
Scan copies strip input values and editable content before local analysis.

## Publisher access and submissions

The prepared listing is `extensions/listing/store-listing.json`. Use the
existing Kitsuvo icons in each package and the actual-UI screenshots generated
by `node scripts/render_extension_listing.cjs`. The screenshots clearly label
the example as illustrative. Store descriptions must retain the scope and
uncertainty language; do not call this a safety certificate or claim approval.

| Destination | Publisher prerequisite | Submit |
| --- | --- | --- |
| Chrome Web Store | Google publisher registration, verified contact, registration payment if required | [Developer dashboard](https://chrome.google.com/webstore/devconsole) |
| Edge Add-ons | Verified Microsoft Partner Center Edge publisher account | [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) |
| Firefox Add-ons | Mozilla developer account and signing access | [AMO developer hub](https://addons.mozilla.org/developers/) |
| Opera Add-ons | Opera publisher account | [Opera developer portal](https://addons.opera.com/developer/) |
| Safari App Store | Apple Developer Program enrollment and App Store Connect access | [App Store Connect](https://appstoreconnect.apple.com/) |
| OpenAI plugin directory | Publisher access and public HTTPS authenticated MCP service, or approved local-MCP submission route | [Plugin submission guide](https://developers.openai.com/plugins/deploy/submission) |
| Anthropic plugin directory | Publisher access and directory review | [Claude plugin documentation](https://code.claude.com/docs/en/plugin-marketplaces) |

Registration needs the account owner's real publishing identity and contact
details. Email/phone verification, payment, signing credentials, and account
authentication cannot be invented or transferred from GitHub/Vercel access.
Record store-assigned IDs and approved listing URLs only after they are returned
by the relevant portal. The repository and website downloads do not represent
store approval. Marketplace submission of the local MCP still needs the
account-specific setup described in `docs/marketplace-integrations.md`.

Official format and distribution references:
[Chrome registration](https://developer.chrome.com/docs/webstore/register/),
[Firefox MV3](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/),
[Safari packaging](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect),
[Edge publication](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension),
[Opera guidelines](https://help.opera.com/en/extensions/publishing-guidelines/).
