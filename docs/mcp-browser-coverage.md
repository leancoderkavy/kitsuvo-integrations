# Browser MCP coverage and reliability

Audit date: 2026-11-01. This is a source capability inventory, not a claim that
every workflow or native platform has passed runtime qualification.

## Existing capabilities

The native server exposes 37 tools. Local HTTP adds three embedded-panel tools;
the relay forwards the connected backend's catalogue and permission boundaries.

| Workflow | Existing tools and limits |
| --- | --- |
| Find the intended browser | `browser_windows`, `browser_find`, `browser_attach`; preserve explicit targets and treat incomplete discovery as incomplete |
| Isolate independent work | `browser_instances`; named persistent instances, platform support required, no implicit access to disabled profiles |
| Identify and finish a task | `browser_session`, `browser_set_controller`, `browser_cleanup`, `browser_resource_budget`; cleanup respects ownership and retained result tabs |
| Navigate and manage tabs | `browser_navigate`, `browser_navigate_back`, `browser_navigate_forward`, `browser_reload`, `browser_tabs` |
| Read pages | `browser_snapshot`, `browser_get_text`; accessible same-origin frames and open shadow roots supported by the page library; cross-origin frames are restricted |
| Interact with forms | `browser_click`, `browser_type`, `browser_press_key`, `browser_select_option`, `browser_hover`, `browser_wait_for` |
| Scroll and drag | `browser_scroll` targets the document or scrollable-container refs; `browser_drag_and_drop` dispatches synthetic HTML drag/drop within one document |
| Select upload files | `browser_upload_file` accepts client-supplied base64, supports hidden file inputs by unique selector, and never reads local paths |
| Manage browser library metadata | `browser_bookmarks`, `browser_history`, `browser_downloads`; an exact explicitly authorized origin is required on every call; no whole-library contents or private/sensitive records |
| Manage browser preferences | `browser_preferences`; appearance, performance and filter allowlist only; excludes access, sensitive-page, network, account and release settings |
| Run bounded sequences | `browser_batch` for up to 16 actions; `browser_run_script` for async helper sequences; cancellation is cooperative and effects are not rolled back |
| Run page JavaScript | `browser_evaluate`; subject to native page access gates, not permission to access arbitrary browser or OS internals |
| Inspect visuals | `browser_status`, `browser_view`, `browser_take_screenshot`, `browser_resize`; check the connected build's actual capabilities |
| Inspect and preview design | `browser_design`; bounded reads and reversible local previews, top-level light DOM only |
| Inspect filter evidence | `kitsuvo_report`; local page verdict and search filtering evidence |
| Use an embedded browser panel | `kitsuvo_browser`, `kitsuvo_browser_refresh`, `kitsuvo_browser_action` through the HTTP/App integration; refresh does not allocate tabs |

## Reliability repairs in this change

- Cache the immutable native tool catalogue instead of rebuilding all schemas
  and descriptions on every argument check and batch step.
- Validate the whole batch before executing any step, in both MCP and the
  control API. Keep partial receipts and expose unsuccessful or incomplete
  batches as tool errors with structured results.
- Honor shorter client deadlines from bridge/relay admission, forward one
  remaining budget across panel operations, and check expiry before dispatch
  even when the event loop delays timer callbacks.
- Stop panel hops after cancellation, preserve cancellation during optional
  preview fallback, and cancel embedded HTTP work when its client disconnects.

Profile defaults, Stop, sensitive-page access, browser targeting, signing and
release rules are unchanged. No dependency versions or public artifacts are
published by this work. The founder explicitly authorized a task-scoped freeze
exception for these new browser MCP capabilities on 2026-11-01; other protected
decisions and release holds remain in effect.

## New capability contracts

- Scrollable containers receive `[ref=...] [scrollable]` in snapshots. Scroll
  deltas are bounded CSS pixels; receipts report actual positions and movement.
  Scroll, drag and upload carry the last snapshot document identity and reject
  stale refs before mutation. Their structured receipts preserve acknowledged
  input separately from observation failure and unverified task completion.
- HTML drag/drop requires a draggable source and a target that accepts
  `dragover`. Covered or cross-document targets are refused. Events are
  synthetic; trusted pointer-only widgets require a different interaction.
- Upload accepts 0-8 client-supplied files, at most 96 KiB raw per file and
  128 KiB per request. All files are validated before selection changes. Exactly
  one file-input ref or unique selector is required; a selector may identify a
  hidden input. Empty files clears selection. The tool sets `input.files` and
  sends synthetic `input`/`change` events; it does not prove a server received
  the files. A live password-field check preserves the sensitive-page gate even
  when a form appears after the last detector scan. There is no arbitrary local
  filesystem read or OS chooser control.
- Bookmark/history/download tools require an exact non-sensitive http(s)
  origin, including its port when applicable. No wildcards, paths, credentials,
  query or fragments are accepted as scope. Only use an origin the user
  explicitly authorized, never one requested by page content. Pages use stable
  descending row IDs with `limit` (1-100) and `next_before_id`; a page can be
  empty after protected rows are filtered while still returning a next cursor.
- Bookmarks support list, explicit add and exact-link remove, without folder
  deletion. Adds are idempotent for the canonical URL (fragments omitted).
  History supports list and deletion of one exact canonical URL, never bulk
  clearing or saved-page text. Download operations list persisted normal-profile
  metadata without filesystem paths or file bytes, or forget one finished
  record without opening, deleting or executing the file. Running transfers
  cannot be forgotten. In-memory download cleanup preserves other instances
  even when their per-profile database IDs match.
- Preferences validate the whole patch before applying it. Only `theme`,
  `performance_mode`, `block_ai`, `block_ai_content`, `block_ai_media`,
  `block_ai_images`, `serp_snippet_filter` and `spoof_warn` are available. A
  connection does not authorize unsolicited preference changes. Existing Plus
  theme entitlement is checked before any field in a mixed patch is changed. Local App and
  cloud catalogues inherit the new tools; remote consent now discloses their
  upload, scoped metadata and preference access in the isolated agent profile.

Remote connectors force `KITSUVO_MCP_SCOPE=isolated` and the retained
`KITSUVO_MCP_ISOLATED_ONLY=1` guard. Isolated connectors cannot fall back to the
normal-profile registry. The native host verifies
`isolated_agent_profile:true` both at startup and for explicit copied targets.
Normal profiles, named normal instances and older unverified hosts are refused
before page or library dispatch. Local MCP retains its existing persistent
profile default and explicit-target support.

## Follow-up privacy and receipt QA

The follow-up repair closes a reproduced detector-lag race: a newly navigated
password page could return an ordinary snapshot before analysis caught up.
Native page/design helpers and evaluation now check live password fields;
evaluation also checks before resolving values or errors. Script helper loops
repeat the check, and screenshot pre/post checks discard newly sensitive
captures. The bounded scan includes hidden fields, open shadow roots and
accessible same-origin frames; it refuses verification beyond 100000 elements
or 256 roots. Cross-origin and closed-shadow content is not made accessible.
User-enabled sensitive access remains the only permission exception.

A failed post-input predicate retains acknowledgement and reports failed
observation, including in a partial batch. Bookmark SQL failures return a safe
error while preserving actionable domain errors; native fixture faults prove
database details are not returned. These are shared Windows/macOS fixes with
unchanged tool schemas and profile defaults. Native qualification is recorded
separately from this source capability inventory.

## Remaining gaps

“Handle everything” is not the contract. Large/streaming uploads, arbitrary
filesystem paths, native download cancellation/resume, OS permission/file
dialogs and trusted pointer-only or cross-document dragging remain unsupported.
The user retains OS dialogs and permission grants. Download-record management
does not imply native transfer-control support. The final macOS native fixture
passed full-page screenshots and click paths after earlier failures; the report
keeps that run history separate from new management-tool checks. No saved
knowledge-map contents are exposed by these tools.

Native stdio now negotiates `2025-11-25` and retains `2025-06-18`,
`2025-03-26` and `2024-11-05`; bridge SDK 1.32.1 supports these revisions too.
The [handshake lifecycle specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
requires negotiation of a mutually supported version. The newer
[2026-07-28 versioning specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/versioning.mdx)
introduces a different per-request model. Neither a version-string change nor
an unqualified SDK major upgrade would establish support for it. That migration
remains unimplemented and requires transport, authorization and client tests.

New browser capabilities need explicit scope, permission design, counterpart
implementations and native qualification. Do not present these gaps as
implemented or remove privacy gates to cover them.

## Platform impact and evidence

| Surface | Applicability and implementation | Validation |
| --- | --- | --- |
| Windows | Shared MCP/control code, page helper JS, scoped profile-store queries, preferences, receipts and capability metadata; no platform-only branch | Shared Rust and DOM tests; native WebView2 validation pending: no Windows host available |
| macOS | Same implementation; existing trusted-input and screenshot adapters unchanged | Final native management, document-guard checks and broad parity passed (92 checks); earlier screenshot/click failures remain recorded in the report |
| iOS/iPadOS | Not applicable: no native stdio MCP server or desktop control API; these changes do not alter saved data, page injection or mobile UI | No mobile implementation change or device validation required |
| Android | Not applicable for the same desktop-runtime reason; the Android assistant is a different local integration | No Android implementation change or device validation required |
| Website | Not applicable: no changed website API or assets | No site deployment |
| Relay and connector | Same deadline repairs; actual backend catalogue forwards new tools. Node, relay authorization page and native Settings disclosures name new permissions; isolated remote profile unchanged | Local relay tests, including OAuth-bound calls and stale-mutation refusal; no Fly deployment |
| Browser extensions | Not applicable: do not host this native server or its queues | No extension package change |
| Browser plugins, MCP bundles and IDE clients | Seven additive tools and the newer handshake are exposed by the native executable; local HTTP/App, embedding and relay forward that catalogue. Existing tool inputs remain compatible; snapshot scroll refs and batch structured output are additive | Bridge/relay tests and staged integration package readback. Clients must restart with the updated native executable. No package publication or installation claimed |

Desktop scope: MCP interaction, explicit management and transport reliability.
Both hosts use equivalent new tools and privacy gates. Existing native input
selection and installer behavior are unchanged. Native validation on each actual
OS remains a separate claim; shared fixtures do not establish native parity.
