# MCP action readiness

Click, type, key, select and hover return a fresh snapshot by default. A snapshot
is an observation of the current page; it cannot guarantee future timers,
requests or application updates have finished.

- `readiness: "auto"` waits for navigation hinted by direct links/submissions or
  observed loading. Known `_blank` links wait for a new tab to appear. An ordinary non-navigation action returns observed state
  immediately. A prevented submission or intercepted link can exhaust the
  navigation-start grace; use a page predicate for SPA transitions. Child-frame
  links do not wait for a top-level transition; explicitly wait for required
  frame state before further actions.
- `wait_until: { "text": "Saved" }` waits for the required state after the action.
  `text_gone` and `ref` are also supported; combined predicates must all hold.
  In auto mode a predicate takes precedence over the navigation heuristic.
- `readiness: "navigation"` explicitly waits for a new page, useful for script
  redirects. `readiness: "ack"` returns observed state without a navigation wait.
  A supplied `wait_until` still waits even in ack mode.
- `output: "full"` is the default snapshot with the existing 30,000-character
  budget. Raise `max_chars` for complete large-page extraction. `output:
  "viewport"` limits extraction to the viewport; `output: "none"` skips it.
  Output selection does not disable the chosen readiness checks.

The stdio protocol reader answers ping and discovery during browser work.
Browser tools stay serialized. Admission is bounded at 32 pending/running tools;
`_meta: { "kitsuvo/deadlineMs": 5000 }` can shorten the native queue-inclusive
180-second deadline. Expired/cancelled queued work is checked again before UI
dispatch. Native queued deadline errors are returned when the worker reaches the
request, so their response can be delayed by an earlier active operation.

HTTP and cloud queues propagate cancellation and use deadlines from admission.
HTTP sessions bind cancellation to the right client; cloud sessions additionally
bind to the OAuth client and approved browser. The local bridge admits 64 sessions,
the relay 500; shared-backend idle sessions expire after 15 minutes.
The existing per-backend bridge mode retains its 16-session, 10-minute defaults. Cancellation travels over
the transport: a client-side abort may resolve before its notification arrives.
It cannot undo a mutation already dispatched. Always inspect current state before
retrying an uncertain or interrupted action. Existing `settle_ms` overrides and `output: "changed"` remain supported.
Native per-client selected tabs and tab ownership are preserved. Mutations are never automatically
replayed after a transport failure; eligible read operations may reconnect once.

The explicit-approval function-tool adapter also counts approval and catalog
revalidation against its call deadline and forwards the remaining budget to the
SDK/native queue. Abort or adapter close settles callers promptly; late approval
cannot dispatch. Dispatched client work retains admission until the client
promise settles. See [the adapter contract](agent-compatibility.md#function-tool-adapter).

Tool discovery in the App/HTTP bridge and cloud connector reads the entire
backend catalog before advertising it. The read shares one 180-second budget
across at most 16 pages, with 2,048 total tools including App controls. Invalid
page chains, duplicate names and App-name collisions are refused without
caching partial results. See [the discovery contract](agent-compatibility.md#function-tool-adapter).

## Bridge deadlines and batches

The same `kitsuvo/deadlineMs` metadata shortens admission deadlines in the local
HTTP/App bridge and cloud relay. Every embedded-panel hop forwards the remaining
budget to native MCP; it does not start another 180-second deadline. The built-in
remote connector counts time waiting for its child lock and native process
initialization against that budget too. Cancelled
panel requests stop before the next hop, including optional screenshot capture.
Closing an embedded HTTP connection cancels its queued panel work. Queue dispatch
also checks the monotonic deadline directly, so a delayed JavaScript timer cannot
allow an expired mutation to start.

`browser_batch` validates all steps before dispatch. Missing required fields,
wrong argument types and non-string select values reject the entire sequence
before any action. A later runtime failure can still follow successful actions;
validation cannot make a sequence transactional.

Batch responses preserve the JSON receipt in the first text block and also
return it as `structuredContent`. `isError: true` means a step failed or timed
out, the sequence stopped before all requested steps, or its requested final
snapshot was unavailable. The receipt identifies the attempted steps and any
opened tabs. Inspect current state and continue only the remaining authorized
actions; never replay the complete batch automatically.

A failed `wait_until` after acknowledged input returns `observation: "failed"`
with `execution: "acknowledged"` and `isError: true`; it does not erase the
executed action or claim `condition_met`. A fresh snapshot is retained when
available. Batches stop on this observation failure before another step.

Page helpers check live password fields immediately before operations, including
hidden fields, accessible same-origin frames and open shadow roots. Async
JavaScript results and rejections are checked before returning; script helper
loops check at each cooperative boundary. Screenshot pre/post checks discard
captures when the page becomes sensitive. These checks supplement URL/private
and cached detector gates; they do not enable sensitive access. Cleanup still
works after the page becomes protected.

See [browser MCP coverage](mcp-browser-coverage.md) for current capabilities,
platform applicability, seven new scoped tools and the remaining gaps.
