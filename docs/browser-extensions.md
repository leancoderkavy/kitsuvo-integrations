# Kitsuvo browser extensions

The extension runs a focused local subset of Kitsuvo's desktop detector. It
uses the same hosting, markup-fingerprint, generator, builder-meta, and
traditional-CMS rule tables and the same score curve. It scans on request,
optionally hides the search engine's own AI answers, and optionally filters
search results by builder hosting. It is independent of the
desktop browser; no native messaging host, AI account, or API key is needed.

It does not port the desktop's design/copy analysis, slop and impersonation
checks, cloud verdicts, calibrated models, corrections, or the desktop’s page-analysis navigation gates. Chromium build 0.1.8 adds a
separate opt-in gate for known builder-hosting domains only.
Hosting alone is circumstantial, and the interface says so.

## Build and test

```sh
python scripts/build_extensions.py
node --test tests/extensions.test.cjs tests/extensions-ui.test.cjs
CHROME_PATH=/path/to/Chromium node scripts/smoke_extension.cjs
npx --yes web-ext@10.7.0 lint --source-dir dist/extensions/firefox
python -m pip install -r scripts/extension-qa-requirements.txt
python scripts/smoke_extension_firefox.py
python scripts/prepare_extension_submissions.py
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

The runtime smoke was verified on Windows with Chrome for Testing
155.0.8059.39, installed Chrome, and installed Edge. It loads the temporary
package using CDP `Extensions.loadUnpacked` over a debugging pipe. The randomly
generated test key pins its ID so built-in browser workers cannot satisfy the
test. The smoke loads the real worker, injects the bundled detector into a
loopback fixture, and verifies that password pages are skipped.
Only the temporary smoke package receives loopback host access to substitute
for the toolbar's activeTab grant. Public packages do not contain that access.

Firefox 157.0.1 on Windows passed 14 real-browser checks (a DOM-clobbering
scan check was added later): temporary add-on
installation, popup and guide replay, Lovable score 78, report URL sanitization,
password and browser-page skips, editable-content exclusion, installed detector
sign-in exclusion, strong search-host filtering, weaker/ordinary results retained,
Show hidden results restoration, and restoration when filtering is disabled.
The harness calls the real event-page scanner and injects the production search
scripts on a local Google-shaped fixture. It does not establish live Google
markup compatibility or exercise a native toolbar click's activeTab grant.
Selenium Manager uses an isolated profile and caches stable Firefox/geckodriver
when `FIREFOX_PATH` is absent. Evidence is under
`target/extension-firefox-smoke/` and `target/extension-chromium-smoke/`.

`Browser extension qualification` repeats Chromium/Firefox runtime checks on
Windows and macOS and generates an unsigned Safari containing app on a macOS
runner. `python3 scripts/package_safari_extension.py` uses Apple's current
packager (or the older converter) and compiles the embedded extension with
Xcode. A successful unsigned build does not establish Safari runtime support,
signing, or store approval. Real Safari device testing remains a release gate.

## Product and privacy

The toolbar popup offers **Scan this page**, the evidence report, and an
optional search filter for Google.com, Bing, and DuckDuckGo, including its
no-AI search page. Filtered results
have a **Show hidden results** control on the search page. Only hosting
signals that reach the native 70 threshold are filtered; weaker hosting such
as Replit is not hidden on hosting alone. Search-engine markup can change;
unrecognized results remain visible.

**Hide AI answers in search** is a separate opt-in switch in the same popup,
off by default. It shares the same optional search-site access and the same
search-page script as the filter. When on, it hides the engine's own AI answer
panels (Google AI Overviews and AI Mode, Bing Copilot answers, Duck.ai and
Search Assist) and the engine's links into its AI chat, reading page markup
only. A hidden answer gets a page banner with **Show AI answer**, which keeps
that answer visible for the rest of the page. Hidden chat links get no banner
and return when the switch is turned off. The search-site access is removed
only when both search switches are off.

While either search switch is on, the search page also shows a quiet status
line in the same banner, so a search where nothing was hidden still says what
Kitsuvo did. With nothing hidden it reads "Results checked: N. None are on
known AI-builder domains." The check reads only each result link's hostname,
so a builder-made site on its own custom domain is not caught; the line says
so by naming domains. N counts only the result rows the filter actually
examined. Engine redirects are read from the link itself, as in the desktop
finder, and never opened or fetched: Bing `/ck/a` (`u=a1` plus base64url),
DuckDuckGo `/l/?uddg=` (html.duckduckgo.com and lite.duckduckgo.com link
through duckduckgo.com) and Google `/url?q=`. Google's encrypted `/goto` links
use the result's visible breadcrumb host. A link that still points at the
search engine after that (an unreadable redirect, an engine page or a
DuckDuckGo ad link) is neither counted nor hidden, so a page of such links
shows no "Results checked" line. Recognized layouts are Google (including its
lightweight `#main` layout), Bing, DuckDuckGo, html.duckduckgo.com and
DuckDuckGo Lite, where a result's snippet and address rows hide with its title
row. The filter reads result title links only, up to 1,000 per pass, so long
infinite-scroll pages stay filtered. Hidden rows get the `hidden` attribute and
an inline `display: none !important`, which an engine stylesheet or page CSP
cannot override; Show and turning the filter off restore both exactly. If a
checked result is on a known builder host but stayed visible (weaker hosting
or an always-show choice), the line says "None were hidden." instead. With
**Hide AI answers in search** on and no answer panel recognized, it says "No
AI answer recognized yet."; the page is still watched, and a late panel
Kitsuvo recognizes replaces that with the usual hidden answer text. **Hide this
line** moves keyboard focus to the results it sat above (a temporary
`tabindex="-1"`, removed on blur) instead of letting it fall to the page. When
results are hidden, the existing text and buttons stay and
the banner adds **Wrong verdict?**, which lists the hidden hosts, each with
**Always show {host}**. That writes the same local `alwaysShowHosts` choice as
the popup, so **Reset {host}** in the popup undoes it. No report is sent
anywhere. The line links to `https://kitsuvo.com/extensions` (**How this
works**, new tab, no query string, `noreferrer`). **Hide this line** stores
`searchStatus: false`; the popup's **Show Kitsuvo status on search pages**
checkbox brings it back and is ticked unless the line was hidden. With the
line off, the banner is exactly the pre-status banner. Buttons that write
storage act only on trusted user clicks, never on clicks the search page
dispatches. The line needs `ai-panels.js` engine detection and a results
container, so search home pages and unsupported hosts show nothing. It adds no
permission, network request or telemetry. The desktop browser's status line
is separate and not part of this extension change.

A new install opens a welcome page (`welcome.html`) in one tab. Extension,
browser and shared-module updates never open it. The page explains page scans,
**Hide AI answers in search** and the search filter, and offers both search
settings as unticked checkboxes. Each checkbox asks for the search-site access
only inside its own click, and a declined prompt leaves the setting off. The
page also says where the controls live later and links to
`https://kitsuvo.com/install` without a query string, and has one line about
the status line on search pages. It makes no network requests. Finishing,
leaving or closing it records guide version 5, so the popup does not repeat
the same steps. A new install is therefore not walked through the popup's
Rate Kitsuvo link. The popup's **Setup guide** footer link
reopens it.

The popup's nonblocking guide appears the first time it opens unless the
welcome page already recorded it. It persists its completed/dismissed version
in local extension storage, and **Help** replays all of its steps. Version 5
has five steps: page scans, Hide AI answers, the Setup guide link, the status
line checkbox and the footer links. Step 5 points at **Rate Kitsuvo** in store
installs and at the full-browser link otherwise, and is skipped if neither link
is shown. Someone who closed an earlier version sees only the newer steps once
(version 2 sees steps 3 to 5; version 4 sees step 5). Close and Escape
restore focus. Neither the guide nor the welcome page scans, ticks a setting
or grants access on the user's behalf. Keyboard, reduced-motion, and narrow
layouts are supported.

The popup footer links to `https://kitsuvo.com/install` (**Get the full
Kitsuvo browser (Mac and Windows)**, new tab, no query string or channel
label). In a store install it also shows **Rate Kitsuvo**, which opens that
store's listing in a new tab. The store comes only from the extension ID:
`kogkgeiglfeoflmlnbmjghbdoinclbdf` (Chrome Web Store),
`nedklnjihgpgefpinabddmnoagkaoolp` (Edge Add-ons), `browser-evidence@kitsuvo.com`
(Firefox Add-ons) and `com.kitsuvo.browser-extension.Extension (E2L636Z97D)`
(Safari, Mac App Store write-review link). ZIP and unpacked installs have other
IDs, and `management.getSelf()` (no extra permission) reports temporary
Firefox loads as development installs, so neither gets a rating link. Nothing
is fetched to decide this.

After the search filter has hidden at least 5 results on at least 3 different
days, the popup shows a quiet card: "Kitsuvo has hidden search results for you
on 3 different days. If it has been useful, a store rating helps other people
find it." Its actions are **Rate Kitsuvo** (new tab), **Not now** (hidden for
14 days) and **Don’t ask again**; Rate also stops the card. It has no reward
or incentive wording, appears only inside the popup the user opened and never
opens anything by itself. Safari builds show only the footer link, because
Apple does not allow custom review prompts in apps. `search.js` keeps the
count: each result row the filter newly hides on a page adds one (up to 5),
and the first such row on a new local date adds a day (up to 3). It stores only
those counts and the last such date, writes nothing while the filter is off or
when only AI answers are hidden, and stops writing once both counts are full.

Default permissions are `activeTab`, `scripting`, and `storage`. Persistent
search-host access is optional and removed when the filter is disabled.
Chromium 0.1.8 also declares optional `declarativeNetRequest` permission for the
**Block known AI-builder sites** switch. It is off by default and asks for the
permission when enabled. Its one dynamic rule blocks only HTTP(S) `main_frame`
requests on the reviewed strong builder-host domains; it does not inspect request
content or block resources and embedded frames. Rules persist across tabs, worker
suspension and browser sessions. Turning it off removes the rule and releases the
permission; external revocation resets the preference. Search filtering and its
exact-host always-show choices remain separate. A blocked site uses the browser’s
blocked-request page; switch blocking off and reload to visit it. Firefox and
Safari builds do not expose this Chromium-only switch. Custom-domain analysis
does not automatically become a navigation rule. Codex runtime support still
requires loading and testing the extension in Codex itself.

No cookies, history, native messaging, web-request listeners, remote executable code,
or cloud connections are requested. Local extension storage holds seven keys:
`searchFilter` (search-result filter), `hideAiPanels` (Hide AI answers in
search), `navigationBlock` (the Chromium-only Block known AI-builder sites
switch), `alwaysShowHosts` (exact hostnames you choose to always show, from the
popup or from **Wrong verdict?** on a search page), `searchStatus` (whether the
status line shows on search pages; missing means on), `tourVersion` (the
completed or closed guide version) and `rateAsk` (the capped rating counter
above, its last date, and the Not now or Don’t ask again choice). Paths, query
strings,
page content and reports are not saved.
Page scans skip sign-in provider hosts, password-field pages, and private tabs.
Scan copies strip input values and editable content before local analysis.
Scans read the page through the DOM prototypes, so a page cannot hide its
evidence or break the scan by clobbering `document` or form properties with
named elements (`<img name="title">`, `<form name="querySelector">`).

## Publisher access and submissions

The prepared listing is `extensions/listing/store-listing.json`. It must
describe what the source ships: every popup switch, every manifest permission
and every local storage key. `tests/extension-listing.test.cjs` checks that,
along with the store length limits, `data_collection` staying "None" and the
manifest name and summary matching the listing.

The store name and summary come from the manifest that
`scripts/build_extensions.py` writes into each package. The next store upload
must carry a `VERSION` above 0.1.10. The 0.1.11 archives meet that rule, and
their manifest name and summary match the current listing. Any change to the
manifest name or summary, including a renamed listing, needs a new `VERSION`
above 0.1.11, because the 0.1.11 archives on kitsuvo.com/downloads are
immutable. A name change also changes the Chrome Web Store URL slug; update the
`sameAs` URL pinned in `tests/site-entity.test.cjs` only after the store shows
the new slug.

Use the existing Kitsuvo icons in each package and the actual-UI screenshots
generated by `node scripts/render_extension_listing.cjs`. The screenshots clearly label
the example as illustrative. Store descriptions must retain the scope and
uncertainty language; do not call this a safety certificate or claim approval.

`python scripts/prepare_extension_submissions.py` prepares five portal-specific
folders under `dist/store-submissions/` with upload ZIP, icons, screenshots,
listing, reviewer instructions, readable reviewer source, package SHA-256 and
explicit pending submission state. Chrome, Edge and Opera use the same
Chromium package; Brave/Vivaldi can install that package, but their independent
runtime behavior is not yet qualified. Nothing in this command submits to a
store. It does not mark publisher IDs or approval URLs as known.

For Firefox, the owner must choose an AMO-supported license explicitly:
`python scripts/prepare_extension_submissions.py --amo-license LICENSE`.
No license grant is inferred from the private repository. With publisher API
credentials set securely as `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`, submit:

```sh
npx --yes web-ext@10.7.0 sign --channel listed --no-input \
  --source-dir dist/extensions/firefox \
  --amo-metadata dist/store-submissions/firefox/amo-metadata.json \
  --upload-source-code dist/store-submissions/reviewer-source.zip \
  --artifacts-dir target/firefox-signed --approval-timeout 0
```

This command submits to AMO; a returned upload ID is not approval. Preserve the
returned IDs and verify the listing/signing state in AMO. Readable source needs
Python 3 to regenerate ZIPs; runtime QA also needs Node 22+ and the pinned
Selenium dependency. Do not place publisher secrets in submission bundles.

Safari can also be packaged in a browser through App Store Connect's Xcode
Cloud extension upload flow; a Mac is not required for that packaging route.
Apple Developer membership and an app record are required. Use the Safari ZIP
and prepared `app-metadata.json`; confirm the suggested bundle ID is available
before registration. Safari runtime qualification still requires a Safari
device. Store questions about legal identity, content rights and age ratings
must be answered using the actual publisher's details.

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

After scanning, Always show this host keeps that exact host visible in search. Reset the choice in the popup to restore filtering; evidence scores are unchanged. Disabling restores hidden results immediately, and reenabling resumes filtering in loaded supported pages.
