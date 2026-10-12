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
