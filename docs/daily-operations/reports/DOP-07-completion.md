# DOP-07 completion — Category panels, cards, links, Quiet priorities

Closed 2026-09-08. Repository `vantage-admin` (code) + pack docs here.
Branch `daily-operations` in both repos. No commit. No push. No deploy.

§4 of the issue was re-verified before coding: DOP-06 chrome + tiles +
mix + one EventSource already live in `components/daily/daily-shell.tsx`.
URL writers already set `?lane=` and `?company=` via `toggleSearchParam`.
Temporary **Live facts** list (`{clock} {kind} {title}`) was replaced by
category panels. Query key `queryKeys.dailyOperations.snapshot()` is
unchanged. Merge helpers stay in `lib/api/dailyOperationsLive.ts`.
`SidePanel` was not forked. Confirm is not on `/daily`.

21st.dev (`user-21st` search: activity feed / event card / panel grid)
was thin / paid retrieval. Craft matches existing dashboard `Card`
tokens (`text-xs uppercase tracking-wide text-muted-foreground`,
`tabular-nums`, steel / trust-blue chips).

## Panel list and focus behavior

On by default on `?lane=all` (no `lane` param): Leads, Texts, Granot,
Intakes, Bookings, Cancellations, Exceptions. Grid:
`xl:grid-cols-2 2xl:grid-cols-3`.

Focus (`?lane=lead` / `text` / `granot` / `intake` / `booking` /
`cancellation` / `exception` / `sheet_sync`) expands that panel; the
others become a count rail. Exceptions stay visible; when focused they
span the row. Sheet Sync is off until local preference
`vantage-admin-daily-sheet-sync` or `?lane=sheet_sync`.

One EventSource (`/api/daily-operations-live`). Fan-out by `lane` in
memory. Quiet priorities hides `granot.priority_updated` cards only;
Granot tile / panel counts still include them.

Default 8 cards per panel; focused 40. **Load earlier** calls
`GET /api/proxy/api/v1/admin/daily-operations/events` with `lane`,
`cursor`, `limit=40` (existing Owner proxy). No second socket. No 3s
snapshot poll. A one-shot events page also seeds the board so today’s
cards are not SSE-only.

## Link hrefs

| Card | Href |
| --- | --- |
| Form Lead | `/form-leads?record=` |
| Duplicate Form Lead | `/duplicate-form-leads?record=` |
| Call Lead | `/call-leads?record=` |
| Duplicate Call Lead | `/duplicate-call-leads?record=` |
| `?open=lead:<id>` alias | `/form-leads?record=` (desk, not a second drawer) |
| Granot receipt | **Open in Live Events** → `/live-events` |
| Booked / Release / intake | `/intakes?case=` when `links.intake_case_id` |
| Job Number | `buildJobTimelineHref({ job })` → `/job-timeline?job=` |
| Booking | `/bookings?record=` |
| Cancellation | `/cancellations?record=` |
| Lead Message | lead desk + `?panel=message` |
| Zip miss | open the Lead |
| Dead letter | `/observational` and `/granot-lifecycle/health` |

No Confirm control. No second drawer.

## Quiet-priorities storage key

`vantage-admin-daily-quiet-priorities` (`"1"` when on). URL
`quiet_priorities=1` when on.

Sheet Sync opt-in key (not Quiet): `vantage-admin-daily-sheet-sync`.

## Gaps

- **Empty local New York day (2026-09-08).** All increment tiles 0.
  Pace `—`. Live facts / panel bodies empty. Intakes “Waiting for you”
  29 is the live open-case query, not a day increment. Cards, zip chip,
  held-text `send_at` title, and desk hrefs were proven with unit
  fixtures, not live customer payloads.
- **Sheet Sync** is opt-in (preference + `?lane=sheet_sync`). Renderer
  works; panel is hidden by default.
- **Load earlier** is wired to the events proxy. Not exercised in the
  browser because the local day had no `next_cursor`.

## Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck
```

`pnpm test`:

```
ℹ tests 544
ℹ suites 0
ℹ pass 544
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7387.0094
```

Focused new/updated cases: fan-out by lane (Cancellation survives a
Granot flood); Quiet priorities hides cards only; company filter +
filtered empty copy; held-text title from `send_at` (not hardcoded
8:00 AM); zip chip on Lead + Lead still in Leads panel; desk hrefs;
Granot pairing by `parent_receipt_id`; Sheet Sync hidden until opt-in;
Admin still cannot see `/daily`; no Confirm control; events proxy
fetch; per-lane merge cap.

`pnpm typecheck`: **0 errors**.

Scoped lint on files this issue touched: **0 errors**.

## Browser walk (localhost:3000, local API 3001)

Signed in as Owner from `vantage-admin/.env` seed (values not pasted).
Local Admin http://localhost:3000; API http://localhost:3001.

What I saw (no live PII):

- `/daily`: Tue, Sep 8 · America/New_York; ● Live; tiles all 0; pace
  `—`; Intakes `0 opened · 29 Waiting for you`. Seven panels at once.
  Empty copy: `Nothing in this category yet today.` Exceptions:
  `No exceptions so far today.` Texts header:
  `0 sent · 0 held until 8:00 AM · 0 failed`. Sheet Sync hidden.
  No Confirm control. Pre-existing Next.js hydration overlay on
  `DashboardLayout` (date/window) — not introduced here.
- `/daily?lane=text`: Texts focused; count rail for the other
  categories; empty `Nothing in this category yet today.`
- `/daily?lane=exception`: Exceptions focused; empty
  `No exceptions so far today.`
- Company click (Top 10 Forms): URL `company=top10_leads`; Exceptions
  empty became `No Exceptions for Top 10 Forms today.`
- Quiet priorities: button pressed; URL `quiet_priorities=1`;
  `localStorage` key `vantage-admin-daily-quiet-priorities` = `1`.
- Deep link: `/live-events` opened the existing Live Events desk
  (no cards on the empty day to click). Card hrefs proven in fixtures.

**The local New York day is empty.** Card chrome was not visible on
live data.

Admin role: no second Admin-role session. Unit-equivalent unchanged:
Admin nav omits `/daily`; `canAccessDashboardPath("admin", "/daily")`
is false.

## What this issue did not do

- Confirm Granot Booking on `/daily`.
- A second EventSource or a 3s snapshot poll while live.
- Redis credentials in the browser or BFF.
- Hardcoded “8:00 AM” on the held-text **card title** (header uses
  the copy send-window label).
- Hiding zip-miss Leads from the Leads tile / panel.
- Quiet priorities changing Granot counts.
- Tabs or a page per category.
- The 2026-08-19 24h/48h Daily View.
- A Lead increment on `granot.minted` (still a Cross-issue finding).
- Full CONTEXT.md / project-organization map rewrite (DOP-08).
- docs-keeper (DOP-08).
- Commit / push / deploy / live customer payloads.

**Unblocks:** DOP-08 (`ready` only).
