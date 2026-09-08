# DOP-06 completion — Admin chrome, headline, origins, companies, pace

Closed 2026-09-08. Repository `vantage-admin` (code) + pack docs here.
Branch `daily-operations` in both repos. No commit. No push. No deploy.

§4 of the issue was re-verified before coding: Today nav was Overview,
Live Events, Lead Conversations, Intakes, Manual. Neither
`OWNER_ONLY_PAGE_PREFIXES` nor `ownerOnlyPagePrefixes` included
`/daily`. No `app/(dashboard)/daily/`. No `queryKeys.dailyOperations`.
Overview `MetricCard` tokens still match. Only `/daily` was added to
the incomplete shell prefix list.

21st.dev was searched (`user-21st`) for headline tiles and mix shells.
Results were thin / paid retrieval. Craft matches Overview `MetricCard`
tokens (`text-xs uppercase tracking-wide text-muted-foreground` +
`tabular-nums text-3xl`) and Overview `bg-trust-blue` share bars.

## Query key and live merge helpers DOP-07 should use

| Item | Where |
| --- | --- |
| Snapshot query key | `queryKeys.dailyOperations.snapshot()` → `["daily-operations", "snapshot"]` |
| Snapshot fetch | `fetchDailyOperationsSnapshot()` in `lib/api/dailyOperations.ts` via `/api/proxy/api/v1/admin/daily-operations` |
| Normalize zeros | `normalizeDailyOperationsSnapshot` / `ensureSnapshotOrigins` / `ensureSnapshotCompanies` |
| Pace | `paceVersusYesterdayByNow(today, yesterday_by_now)` — never full yesterday |
| Live path | `DAILY_OPERATIONS_LIVE_PATH` = `/api/daily-operations-live` |
| SSE apply | `applyDailyOperationsSsePayload(eventName, rawData, board)` |
| Event merge | `mergeDailyOperationsEvents` (by `event_id`, newest first, cap 40) |
| Metrics | `applyDailyOperationsMetricTouches` + `sessionDeltaIncrements` |
| Board seed | `EMPTY_DAILY_OPERATIONS_LIVE_BOARD` |

Do not add a 3s snapshot poll while EventSource is live. `?lane=` is
ignored server-side; filter in memory.

## URL params already written

| Param | Writer | Notes |
| --- | --- | --- |
| `lane` | Headline tile click | Toggle/clear. Values: `lead`, `text`, `granot`, `intake`, `booking`, `cancellation`. Form/Call and Duplicates write `lead`. |
| `company` | Source Company row click | Toggle/clear. Slug from the snapshot row (e.g. `top10_leads`). |

`?open=` is not written. DOP-07 honors lane/company for panel focus.

Browser proof: Leads tile → `?lane=lead` (Form/Call and Duplicates
pressed with it). TBM Leads row → `?company=tbm_leads` (toggle). Both
params share `toggleSearchParam` and can coexist; a second click on the
same value clears that key.

## Temporary event list

Unstyled `<ul>` under **Live facts**. Each row is
`{Eastern clock} {kind} {title}`. Newest first, merge-by-`event_id`,
cap 40. Empty copy: `Nothing in this category yet today.` No card
chrome, no Quiet priorities, no zip/held chips, no category panels.

## Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck
```

`pnpm test`:

```
ℹ tests 534
ℹ suites 0
ℹ pass 534
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5395.2383
```

Focused new/updated cases include Owner nav order, Admin cannot see
`/daily`, `canAccessDashboardPath("admin", "/daily") === false`,
Owner-only proxy on every Daily Operations method, copy labels,
snapshot/metrics merge helpers, WordPress form 0 + company zeros.

`pnpm typecheck`: **0 errors**.

Scoped lint on files this issue touched: **0 errors**. Full-repo lint
was not required; scoped lint is the issue’s allowed fallback.

## Browser walk (localhost:3000, local API 3001)

Signed in as Owner from `vantage-admin/.env` seed (values not pasted).
Local Admin was already on http://localhost:3000; local API was
listening on http://localhost:3001.

What I saw (no live PII):

- Today nav: Overview, **Daily Operations** (current), Live Events, …
- `/daily` header: `Tue, Sep 8 · America/New_York` and **● Live**
- Headline tiles: Leads 0, Form/Call 0/0, Duplicates 0, Bookings 0,
  Cancellations 0, Texts sent 0 (0 held), Granot receipts 0, Intakes 0
  (`0 opened · 29 Waiting for you`). Pace chips are `—` (no yesterday
  day document).
- Ingestion Origin includes **WordPress form 0** plus the other four
  origins at 0.
- Source Company: all eight catalog slugs visible at 0 (TBM Leads,
  TBM Prime Leads, Top 10 Forms, Best Relocation Leads, GetMovers
  Leads, main site, Paid Overflow, not provided). Yesterday `—`.
- Live facts: `Nothing in this category yet today.`
- Owner live BFF `GET /api/daily-operations-live` returned **200**
  `text/event-stream; charset=utf-8` (body not read; no live PII).
- **The local New York day is empty** (all increment tiles 0). The
  Intakes “Waiting for you” 29 is the live open-case query, not a day
  increment.

Admin role: no second Admin-role session was used. Unit-equivalent:
Admin nav omits `/daily`; `canAccessDashboardPath("admin", "/daily")`
is false; `ownerOnlyPagePrefixes` includes `/daily` so the shell shows
“Not allowed”; BFF returns 403 when `admin.role !== "owner"`; proxy
GET/POST/PATCH/DELETE on `/api/v1/admin/daily-operations*` are false
for Admin.

## What this issue did not do

- Category panels, event cards, Quiet priorities, zip/held card chrome
  (DOP-07).
- Confirm Granot Booking on `/daily`.
- 3s snapshot poll while SSE is live.
- Redis credentials in the browser or BFF.
- Changing Overview or Live Events.
- “Fixing” other missing `OWNER_ONLY` prefixes.
- A Lead increment on `granot.minted`.
- Marking `/daily` as done.
- Full CONTEXT.md / project-organization map rewrite (one-line
  pointers only; DOP-08 owns the map).
- Commit / push / deploy / live customer payloads.
- docs-keeper (DOP-08 owns pointers).

**Unblocks:** DOP-07.
