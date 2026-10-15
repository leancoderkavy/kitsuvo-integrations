# Browser extension setup

Checks the current page for known AI-builder fingerprints, generator tags and
builder hosting, and can optionally hide builder-hosted results on Google,
Bing and DuckDuckGo. Everything runs in the extension: no account, API key,
cloud model, telemetry or desktop app. It is a focused subset of the desktop
detector and does not include slop or impersonation checks.

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/kitsuvo-%E2%80%94-ai-site-filter/kogkgeiglfeoflmlnbmjghbdoinclbdf)
or [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kitsuvo-%E2%80%94-less-ai-less-s/nedklnjihgpgefpinabddmnoagkaoolp).
Both public listings were verified October 14, 2026. Choose the store for your
browser, then open a normal website and select **Scan this page** from Kitsuvo's
toolbar popup. No desktop companion is needed.

The instructions below cover manual developer previews. Firefox signing and
Safari packaging remain separate from the Chrome and Edge store releases.

## Chrome, Edge, Opera, Brave, Vivaldi

Needs Chrome 120 or newer, or the equivalent Chromium version.

1. Clone this repository, or download and extract the ZIP from
   [kitsuvo.com/extensions](https://kitsuvo.com/extensions?utm_source=github&utm_medium=readme&utm_campaign=integrations).
2. Open `chrome://extensions` (`edge://extensions` in Edge) and turn on
   **Developer mode**.
3. Choose **Load unpacked** and select the `extensions/chromium` folder.

## Firefox

Needs Firefox 142 or newer. Public installs need Mozilla signing, so this is a
temporary install that lasts until Firefox restarts.

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and select
   `extensions/firefox/manifest.json`.

## Safari

`extensions/safari` needs Apple packaging and signing before Safari will run
it. See [../browser-extensions.md](../browser-extensions.md).

## Use it

Open a page, click the toolbar button and press **Scan this page**. You get a
score, the suspected builder when one is recognized, and each observation. A
low score does not prove human authorship or safety.

To filter search results, turn on the search filter in the popup. The browser
then asks for access to only Google, Bing and DuckDuckGo search pages. Hidden
results have a **Show hidden results** control, and turning the filter off
removes that access.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Read the current page only after you press **Scan this page** |
| `scripting` | Run the bundled local detector, and register the optional search filter |
| `storage` | Save the filter preference and the guide version, locally |
| Optional search hosts | The opt-in filter on Google, Bing and DuckDuckGo |

Sign-in provider pages, password-field pages and private tabs are skipped.
