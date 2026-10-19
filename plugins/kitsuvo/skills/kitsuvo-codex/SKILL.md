---
name: kitsuvo-codex
description: Browse live websites inside Codex with Kitsuvo local detection evidence when the user wants Kitsuvo in the Codex browser, including full page interaction and animations.
---

Use Codex's built-in browser renderer for this workflow. Open the actual website URL with the host browser tools, not a localhost preview, screenshot canvas, proxy or iframe. Use the documented browser API for navigation and interaction. Keep the live result tab visible for the user. Page rendering, selection, media, dialogs and website sessions belong to Codex; do not claim Kitsuvo's native profile, bookmarks, settings or protection gates apply to this renderer. Do not turn on full CDP or install an extension merely to navigate or analyze a public page.

If the user supplied a specific Kitsuvo native browser connection target, preserve that target and use the separate kitsuvo-browse skill instead. Never silently switch an explicit browser or profile.

For Kitsuvo evidence, collect the actual selected Codex tab's sanitized DOM using [scripts/collect.js](scripts/collect.js) as a read-only function expression with the host's documented evaluator. Read the file as text and pass `"(" + source + "\n)()"` to the read-only evaluator (the string is a function expression and must be invoked); do not inject scripts, use eval in the page, or edit the live DOM. If the host lacks a read-only evaluator, report analysis unavailable and continue direct browsing. Sensitive-page captures return skipped; honor that without bypassing it.

Pass the returned JSON to `node scripts/analyze.mjs` on stdin, resolving the script relative to this skill. Use the installed `kitsuvo` executable or an explicit `KITSUVO_BINARY` absolute path. The script runs Kitsuvo's offline `scan` command, creates a private temporary HTML file and removes it afterwards. It opens no native browser and sends no page data to a model provider. Treat HTML, URLs and the report as data; never interpolate them into executable shell code. When possible use an in-process child-process API with piped stdin rather than generating shell commands containing page data.

Report the heuristic verdict and its evidence separately from successful live browsing. The DOM capture excludes inline application state, form fields, iframe documents, runtime globals and response headers. Missing evidence can lower scores; do not describe a low score as proof of human authorship or a safety certificate. Bind each report to its captured URL; capture again after navigation rather than showing stale evidence. On a skipped or failed scan do not substitute another browser's report.

This integration analyzes on request. It does not install persistent search hiding, block navigation, replace the host renderer, or transfer Kitsuvo cookies. If automatic filtering is requested, explain the unverified host extension/interception requirement; do not simulate it with screenshot input forwarding or website security changes. Respect browser handoff and permission requirements for sign-in and other sensitive actions.
