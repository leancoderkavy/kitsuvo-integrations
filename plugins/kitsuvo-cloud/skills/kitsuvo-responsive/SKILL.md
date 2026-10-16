---
name: kitsuvo-responsive
description: Check a website's phone, tablet, or desktop layout and interactions using Kitsuvo's responsive browser mode.
---

Open the requested page in a dedicated agent tab and pass its tab number to every tool. Use `browser_resize` with a device such as `iphone-16`, `pixel-8`, `ipad-air`, or `desktop`, or explicit `width` and `height`. On Windows, phones and tablets enable touch and a mobile user agent; reload if the site chooses its layout by user agent.

Inspect the snapshot at each requested size and test relevant navigation or controls within the user's scope. Prefer `browser_design` with `inspect` (or batch `selectors`) and `measure` for element bounds, spacing and computed styles at that viewport. Its geometry uses CSS pixels in viewport coordinates; `summary` reports the user's selection and pending previews. Read `op: "help"` for examples. Use `browser_take_screenshot` where supported to verify visual layout; distinguish accessibility observations from visual checks you could not perform. If measuring unsupported frame/shadow content with `browser_evaluate`, use read-only DOM measurements, not script-based clicks or form submissions.

Record tested sizes, observable problems, and steps that reproduce them. Do not infer that an entire page is visually correct from its accessibility tree. In cleanup, call `browser_resize` with `off: true` on the test tab so it leaves responsive mode, including when a check fails.

Then call `browser_cleanup` to close this connection's test tabs and popups, including after failure or cancellation. Use `keep_tabs` only when the user needs a result tab left open. Existing tabs and other connections' tabs are preserved. Report cleanup failures and retry when possible.
