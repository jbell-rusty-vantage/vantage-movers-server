# DOP-09 orientation — Arrivals band on /daily

Date **2026-09-08**. Review only. Repositories: `vantage-admin` and
pack docs in `vantage-main-server`, both on `daily-operations`.
Coordinator already set DOP-09 to `active`. No Arrivals code was
written. No commit.

§4 of [`issues/DOP-09.md`](../issues/DOP-09.md) was reverified against
the live Admin tree. **It is still accurate.** The issue file was not
patched.

## Verified / drifted — each §4 bullet

| # | §4 claim | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | `/daily` is four bands in `daily-shell.tsx`: chrome → `HeadlineTiles` → origins + companies → `CategoryPanels`. No Arrivals strip. | **Verified** | `DailyOperationsPage` in `vantage-admin/components/daily/daily-shell.tsx` renders that order. No `arrivals-stream` import. No fifth band. |
| 2 | One native `EventSource(DAILY_OPERATIONS_LIVE_PATH)` in `daily-shell.tsx`. BFF at `app/api/daily-operations-live/route.ts`. | **Verified** | One `new EventSource` at shell line 184. BFF `GET` proxies Owner-only to `api/v1/admin/daily-operations/live`. |
| 3 | Merge by `event_id`, newest-first, per-lane memory cap 200 in `dailyOperationsLive.ts`. | **Verified** | `mergeDailyOperationsEvents` + `DAILY_OPERATIONS_EVENT_MEMORY_LIMIT = 200`. Sort via `compareDailyOperationsEventsNewestFirst`. |
| 4 | Panel fan-out, Quiet priorities (`granot.priority_updated` cards only), `?company=` filter in `dailyOperationsBoard.ts`. | **Verified** | `fanOutDailyOperationsEvents`, `applyQuietPriorities` (`DAILY_QUIET_PRIORITIES_KIND`), `filterDailyOperationsEventsByCompany`. Wired through `eventsForDailyOperationsPanel`. |
| 5 | Shared card + desk links in `event-card.tsx`. No insert highlight / slide-in yet. Name + last four already. | **Verified** | `DailyOperationsEventCard` has `event` + `grouped` only. Clock is `formatDailyOperationsClock`. Name + `••` last four via `dailyOperationsCardFacts` / `dailyOperationsPhoneLast4`. |
| 6 | Leftover unused copy: `DAILY_COPY.eventPipe = "Live facts"` and `eventPipeEmpty`. Replace; do not show "Live facts" to the Owner. | **Verified** | Keys exist only in `components/daily/daily-copy.ts`. Repo-wide grep: no other read. Owner never sees them today. Still delete or stop exporting so they cannot leak. |
| 7 | Live Events stays `/live-events` (`live-webhooks.tsx` has its own EventSource). Do not reuse. | **Verified** | `EventSource(GRANOT_LIVE_RECEIPTS_STREAM_PATH)` (`/api/granot-live-receipts`). `LIVE_EVENTS_HREF = "/live-events"`. Separate socket. |
| 8 | DOP-08 walked an empty local New York day. Prove Arrivals with a real or locally created fact. Do not invent a seed issue. | **Verified** (historical) | [`DOP-08-completion.md`](DOP-08-completion.md). Empty NY day; tiles 0; panels empty. Not re-walked this orientation. |

**Arrivals selector:** none. No `arrivals*` export, no `arrivals` /
`justNow` copy keys, no `components/daily/arrivals-stream.tsx`.

No §4 drift. Issue §4 left as written (observed 2026-09-08).

## Exact reuse map

| Need | File | Export |
| --- | --- | --- |
| Live merge + cap 200 | `lib/api/dailyOperationsLive.ts` | `mergeDailyOperationsEvents`, `compareDailyOperationsEventsNewestFirst`, `DAILY_OPERATIONS_EVENT_MEMORY_LIMIT`, `DAILY_OPERATIONS_LIVE_PATH`, `applyDailyOperationsSsePayload`, `EMPTY_DAILY_OPERATIONS_LIVE_BOARD` |
| Event type | same | `DailyOperationsEventItem`, `DailyOperationsLiveBoard` |
| Quiet | `lib/api/dailyOperationsBoard.ts` | `applyQuietPriorities`, `DAILY_QUIET_PRIORITIES_KIND` (`granot.priority_updated`) |
| Company | same | `filterDailyOperationsEventsByCompany` |
| Panel fan-out (do **not** use for Arrivals) | same | `fanOutDailyOperationsEvents`, `eventsForDailyOperationsPanel` |
| Newest-first already imported there | same | re-exports live `compareDailyOperationsEventsNewestFirst` |
| Shared card | `components/daily/event-card.tsx` | `DailyOperationsEventCard` |
| Copy / prefs keys | `components/daily/daily-copy.ts` | `DAILY_COPY`, `DAILY_QUIET_PRIORITIES_STORAGE_KEY` |
| Page shell | `components/daily/daily-shell.tsx` | `DailyOperationsPage` |
| Route | `app/(dashboard)/daily/page.tsx` | wraps `DailyOperationsPage` in `Suspense` |
| Live BFF | `app/api/daily-operations-live/route.ts` | `GET` |
| URL helpers | `lib/api/dailyOperations.ts` | `toggleSearchParam`, `writeSearchParam` |
| Focus parse | `lib/api/dailyOperationsBoard.ts` | `focusLaneFromSearch` |
| Live Events (leave alone) | `components/granot-lifecycle/live-webhooks.tsx` | `LiveWebhooks` + its own EventSource |

## How `?lane=`, `?company=`, and Quiet apply today

All three are URL state on `/daily`. Filters run **in memory** at
display time. Merge does not filter.

- **`?lane=`** — `DailyOperationsPage` reads `searchParams.get("lane")`
  and passes it to `HeadlineTiles` and `CategoryPanels`.
  `focusLaneFromSearch` treats missing / `all` as unfocused. Focus
  collapses other Daily Operations Panels to a count rail. The HTTP
  events query (`fetchDailyOperationsEvents`) is lane-scoped when
  focused; SSE still merges every lane into `board.events`. **Arrivals
  must not use `focusLaneFromSearch` as a filter.** A Cancellation
  already on `board.events` stays in the strip while the Owner is on
  `?lane=lead`.
- **`?company=`** — company row uses `toggleSearchParam(..., "company",
  slug)`. `CategoryPanels` passes `company` into
  `eventsForDailyOperationsPanel` →
  `filterDailyOperationsEventsByCompany` (exact `source_company ===
  slug`). Arrivals must apply the same helper to the **unfanned** list.
- **Quiet priorities** — URL `quiet_priorities=1` plus
  `localStorage` key `vantage-admin-daily-quiet-priorities`.
  `applyQuietPriorities` drops `granot.priority_updated` cards only.
  Tile / panel **counts** stay on snapshot metrics
  (`dailyOperationsPanelCount` / `granotTileToday`), so Quiet does not
  change numbers. Arrivals must reuse `applyQuietPriorities` the same
  way.

Suggested selector (new export; do not fan-out):

`compareDailyOperationsEventsNewestFirst` →
`filterDailyOperationsEventsByCompany` → `applyQuietPriorities` →
`slice(0, 20)`.

## `eventPipe` grep

`eventPipe` / `eventPipeEmpty` / `"Live facts"` appear only in
`vantage-admin/components/daily/daily-copy.ts`. No import. Safe to
replace with `arrivals`, empty (`Nothing has arrived yet today.`),
optional `justNow`. `tests/daily-copy.test.ts` stringifies `DAILY_COPY`
and forbids `Daily View` only — add an assertion that `"Live facts"`
is gone.

## Existing test patterns

Runner: `pnpm test` → `node --import tsx --test "{lib,server,tests}/**/*.test.ts"`.
`pnpm typecheck` is `tsc --noEmit`.

| File | What it already proves |
| --- | --- |
| `lib/api/dailyOperationsLive.test.ts` | Path `/api/daily-operations-live`; merge by `event_id` newest-first; Cancellation survives a 50-item Granot flood; SSE snapshot / event / metrics. |
| `lib/api/dailyOperationsBoard.test.ts` | Fan-out keeps Cancellation; Quiet hides priority cards only; company filter + empty copy; `createElement(DailyOperationsEventCard)` + `renderToStaticMarkup`; no Confirm. Fixture helper `eventItem(...)`. |
| `tests/daily-page.test.ts` | Nav Owner-only; empty snapshot tiles / origins / panels. Does **not** mount the shell (no EventSource). |
| `tests/daily-copy.test.ts` | Glossary labels. Does **not** yet forbid `eventPipe`. |

Markup tests: `import { createElement } from "react"` +
`renderToStaticMarkup` from `react-dom/server`. Source-scan tests
elsewhere use `readFileSync` (see `tests/bookings-subnav.test.ts`).
**No Daily Operations test currently reads `daily-shell.tsx`.**
**No fake timers exist in this repo yet** — tile flash is a 2s
`setTimeout` in the shell (`flashedTiles`); that is session-delta on
tiles, not card insert highlight. SSE `"event"` frames set
`flashedTiles: []`; only `"metrics"` flashes tiles.

## Gaps the implementer must fill

1. **Selector** — newest 20 across lanes after Quiet + company. New
   export on `dailyOperationsBoard.ts` (or a sibling). Do not call
   `fanOutDailyOperationsEvents` here.
2. **Mount** — `components/daily/arrivals-stream.tsx` (name may
   differ; keep it under `components/daily/`). Insert in
   `daily-shell.tsx` **between** the origins/companies grid and
   `<CategoryPanels />`. Read `board.events`. Do not construct
   EventSource.
3. **Copy** — `DAILY_COPY.arrivals`, empty
   `Nothing has arrived yet today.`, optional `justNow`. Remove
   `eventPipe` / `eventPipeEmpty`.
4. **Highlight** — add an insert / slide-in prop on
   `DailyOperationsEventCard` (1.5s, keyed by newly merged
   `event_id`). Do not fork a second card. Do not reuse the 2s tile
   `flashedTiles` timer.
5. **Tests** (issue §8, TDD):
   - Mixed insert / Granot flood: Cancellation remains in the
     Arrivals **slice of 20** (seed enough Granot that a naive
     first-20-of-granot-only view would hide it).
   - Quiet hides `granot.priority_updated` only.
   - `?company=` filters Arrivals; `?lane=` does not.
   - One `EventSource(DAILY_OPERATIONS_LIVE_PATH)` in the shell
     (source-scan `daily-shell.tsx`). Arrivals file has none.
   - Insert highlight on a new `event_id`, clears after 1.5s
     (unit / fake timers).

## Suggested files to add or change (do not widen)

| Action | Path |
| --- | --- |
| Add | `vantage-admin/components/daily/arrivals-stream.tsx` |
| Change | `vantage-admin/components/daily/daily-shell.tsx` (mount only) |
| Change | `vantage-admin/components/daily/daily-copy.ts` |
| Change | `vantage-admin/components/daily/event-card.tsx` (highlight prop) |
| Change | `vantage-admin/lib/api/dailyOperationsBoard.ts` (selector) |
| Change | `vantage-admin/lib/api/dailyOperationsBoard.test.ts` (selector + flood / Quiet / company / lane) |
| Change | `vantage-admin/tests/daily-copy.test.ts` (Arrivals copy; no "Live facts") |
| Change | `vantage-admin/tests/daily-page.test.ts` and/or a small shell source-scan for one EventSource |
| Change | `vantage-admin/lib/api/dailyOperationsLive.test.ts` only if highlight keying lives next to merge |

Do **not** touch `live-webhooks.tsx`, the Live Events BFF, main-server
hooks, or Redis. 21st.dev is allowed only for the Arrivals shell;
search first; do not invent a second socket or API.

## Recommended implementer order (TDD, issue §8)

1. **Selector first.** Write the mixed-insert / cap-20 test (Cancellation
   visible under a Granot flood). Then Quiet. Then company applies and
   lane does not. Implement the export until those pass.
2. **Copy.** Replace `eventPipe` / `eventPipeEmpty`. Assert band
   **Arrivals**, empty **Nothing has arrived yet today.**, no
   "Live facts".
3. **Card highlight.** Prop on `DailyOperationsEventCard`. Fake-timer
   test: new `event_id` highlighted, gone after 1.5s. Existing cards
   do not reshuffle.
4. **Strip + mount.** Compact strip; empty is one quiet line. Mount
   between mix and panels. Source-scan: one EventSource in the shell;
   none in the strip.
5. **Browser.** Owner `/daily` at localhost:3000. Watch Arrivals when
   a current-day fact lands (or create one through an existing local
   desk — Form Lead, etc.). Paste what you saw. No credentials. No
   live PII. If the New York day is empty and you could not create a
   fact, say so. Do not open a seed issue.

## What this orientation did not do

- Did not implement Arrivals, the selector, copy, or highlight.
- Did not edit `issues/DOP-09.md` (§4 still matches the repo).
- Did not reopen other issues or change issue status.
- Did not run `pnpm test` / `pnpm typecheck`.
- Did not walk the browser or read live payloads.
- Did not commit.

## Blockers before implementation

None. DOP-07/08 surfaces are in place. The leftover `eventPipe` keys
are unused. Proof may be thin if today's New York day is still empty —
that is a walk constraint, not a coding blocker.
