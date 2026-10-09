---
name: kitsuvo-evidence
description: Inspect Kitsuvo's evidence for AI-built pages, slop, or brand impersonation when the user asks how a site was made or why the browser flagged it.
---

Open the requested site with Kitsuvo's `browser_navigate`, then call `kitsuvo_report` for that tab. Kitsuvo analyzes rendered pages; do not substitute fetched HTML or a guessed verdict. If `pending` is true, wait briefly with `browser_wait_for` and request the report again. If it remains unavailable, report its `note` or `skipped` reason.

Explain the score, identified builder when present, and strongest reported signals. Separate AI provenance, low-value content, and impersonation: AI-built does not imply fraud, and a low score does not prove human authorship or safety. Attribute verdicts to Kitsuvo and retain uncertainty. Do not invent evidence or request a cloud verdict engine unless the user asks.

For search results, report the hidden or labelled result sites and the recorded source of each verdict. Respect `gate` values: `checking`, `blocked_ai`, and `warned_spoof` mean the page is not currently shown. Do not bypass gates through `browser_evaluate`.

Return a concise explanation with the site's URL, separate verdicts, and supporting observations. User corrections belong in the browser; do not present a speculative verdict as a correction.
