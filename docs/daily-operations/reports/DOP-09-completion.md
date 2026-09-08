# DOP-09 completion — Arrivals band on /daily

Closed 2026-09-08. Repository `vantage-admin` (code) and pack docs in
`vantage-main-server`. Branch `daily-operations` in both. No commit.
No push. No deploy.

Coordinator claimed the issue, ran orientation, then sequential
implement / review-fix / browser / docs-keeper agents. Coordinator
fixed two acceptance gaps found in review and walk (empty-day seed;
`?lane=` remount hydration).

## Final component path and placement

`vantage-admin/components/daily/arrivals-stream.tsx` (`ArrivalsStream`).
Mounted in `daily-shell.tsx` **after** the origins / Source Company
grid and **before** `<CategoryPanels />`. Category panels stay. Not
under the tiles. Not below the panels. Not a tab.

## Arrivals selector

`eventsForDailyOperationsArrivals` in
`vantage-admin/lib/api/dailyOperationsBoard.ts`.

- Limit: `DAILY_OPERATIONS_ARRIVALS_LIMIT = 20`
- Order: company filter → Quiet priorities → newest-first →
  `slice(0, 20)`
- Does not fan-out by lane
- `lane` is accepted and ignored so `?lane=` cannot hide Arrivals

Hydration: the shell’s events query is always
`queryKeys.dailyOperations.events("all")` /
`fetchDailyOperationsEvents({ limit: 80 })`. Load earlier stays
lane-scoped when a panel is focused.

## Insert highlight keying

`seedOrArriveDailyOperationsEventIds(seen, nextRawIds, { hydrated, seeded })`
compares **unfiltered** board `event_id`s.

- Until the events query has been applied (`hydrated`), ignore the list.
- First hydrated pass (including an empty day) seeds and does not
  highlight.
- After that, never-seen ids get `highlight` + optional **Just now**.
- Per-`event_id` 1.5s timers (`DAILY_OPERATIONS_ARRIVAL_HIGHLIGHT_MS`).
  A second insert does not cancel another card’s clear.
- Company / Quiet / `?lane=` do not fake-insert.
- Not the shell’s 2s `flashedTiles` session-delta timer.

Card: same `DailyOperationsEventCard` with `highlight` / `justNow`.
CSS: `daily-arrival-highlight` in `app/globals.css` (slide-in +
`bg-amber-50`).

## EventSource count proof

Source-scan (`tests/daily-arrivals.test.ts`): `daily-shell.tsx` has
exactly one `new EventSource(DAILY_OPERATIONS_LIVE_PATH)`.
`arrivals-stream.tsx` has zero `EventSource`. Live Events was not
touched.

## Browser paste

Local Admin http://localhost:3000. Local API http://localhost:3001.
Owner session already signed in. Full walk:
[`DOP-09-browser.md`](DOP-09-browser.md).

The local New York day was **empty**. One synthetic Form Lead was
created through Owner Manual (Create a Lead). No credentials. No live
customer PII. Name Arrivals Walk; last-four **0999**.

After create, `/daily` without reload:

- Arrivals: **Form Lead created** · Arrivals Walk · ••0999 · Best
  Relocation Leads · Vantage Admin · **Just now** · Open lead / Open
  list. Residual amber still on the card. Slide-in **start** was not
  watched (SSE fired while on Manual).
- Tiles ticked without refresh: Leads **1** `+ 1`; Form / Call
  **1 / 0**.
- Confirm absent. "Live facts" absent.

`?lane=text` remount (after all-lanes hydration fix): Texts focused
and empty; Arrivals still showed the Form Lead card. `?company=`
kept the card on Best Relocation and hid it on main site.

## Whether the day already had facts

Empty at walk start. Fact created through the existing Manual desk.
No DOP-10.

## Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck
```

`pnpm test`: **557 pass / 0 fail**. `pnpm typecheck`: **0 errors**.

`pnpm okf:query --type Service --tag daily-operations` (docs-keeper):
count 1 — `docs/knowledge/services/daily-operations.md`.

## Docs

docs-keeper ([docs-keeper](48b0b147-5179-418b-82b4-9229d1ef3191)):
knowledge pointer, admin CONTEXT, admin project-organization map, pack
README, catalog rows. Board is category panels plus complementary
Arrivals. Not Daily View. Not Live Events.

## Gaps

- Slide-in animation **start** was not watched live (tab was on
  Manual). Residual highlight + Just now + tile tick were seen.
- Granot flood / Cancellation-stays-visible was proven in unit tests,
  not in the browser (one Lead fact today).
- Pre-existing Next.js hydration overlay on DashboardLayout. Not
  treated as a Daily Operations defect.
- Company row click on the empty board did not write `?company=`;
  URL navigation did.
- Cross-issue finding unchanged: do not increment Leads on
  `granot.minted`.

## What this issue did not do

- New main-server kinds or hooks.
- Live Events rewrite or second EventSource.
- Confirm on `/daily`.
- 24h/48h Daily View.
- A Lead increment on `granot.minted`.
- Redis `INCR` as the Owner total.
- DOP-10 seed harness.
- Commit / push / deploy.

**Unblocks:** nothing in this pack. Daily Operations Arrivals append
is closed.
