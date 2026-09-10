---
type: Service
title: Daily Operations
description: Pointer to the Owner Daily Operations contract. Category panels (focus expands in place) plus Arrivals as a live rail on /daily; trend % vs yesterday-by-now with the day before; kind colour tones. Not Daily View. Not Live Events. Not a second specification.
tags: [daily-operations, owner-dashboard, admin-dashboard]
status: draft
stale_after: 2026-12-08
resource: src/services/dailyOperations/recordDailyOperationsFact.ts
applies_to:
  - src/services/dailyOperations/**
  - src/models/DailyOperationsEvent.ts
  - src/models/DailyOperationsDay.ts
  - src/config/domain/dailyOperations.ts
  - src/routes/daily-operations-admin.routes.ts
  - src/routes/daily-operations-cron.routes.ts
  - vantage-admin/app/(dashboard)/daily/**
  - vantage-admin/components/daily/**
  - vantage-admin/components/daily/arrivals-stream.tsx
  - vantage-admin/lib/api/dailyOperations.ts
  - vantage-admin/lib/api/dailyOperationsLive.ts
  - vantage-admin/lib/api/dailyOperationsBoard.ts
  - vantage-admin/lib/api/dailyOperationsColors.ts
  - vantage-admin/app/api/daily-operations-live/route.ts
  - vantage-admin/server/auth/authorization.ts
owners: [team:main-server, team:vantage-admin]
sources:
  - id: spec
    resource: docs/daily-operations/daily-operations-specification.md
    title: Daily Operations specification
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:docs-keeper
  at: 2026-09-10T17:43:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [`daily-operations-specification.md`](../../daily-operations/daily-operations-specification.md) — **working contract; wins on every conflict.**  
**Pack:** [`daily-operations/README.md`](../../daily-operations/README.md)  
**Admin map:** [`vantage-admin/.cursor/rules/project-organization.mdc`](../../../../vantage-admin/.cursor/rules/project-organization.mdc)  
**Domain terms used:** [Daily Operations](../../../../CONTEXT.md), [Daily Operations Event](../../../../CONTEXT.md), [Daily Operations Panel](../../../../CONTEXT.md), [Arrivals](../../../../CONTEXT.md), [Lead Message](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md)

# Daily Operations

This file is a **Service pointer** only. It does not copy contract rules, hook tables, or wire shapes.

- [Daily Operations specification](../../daily-operations/daily-operations-specification.md) — Owner category panels plus complementary Arrivals on `/daily`. Mongo day projection, after-commit facts, Redis doorbell, SSE. Sections marked `DOP-10` / `DOP-11` (§2.2, §2.3, §3.2, §4.1, §4.2, §5, §8.1, §16.1) hold the focus / trend / colour / rail / backfill rules. **Wins.** Pack files live at [`internal_hidden_docs/daily-operations/`](../../../internal_hidden_docs/daily-operations/).
- [Pack README](../../daily-operations/README.md) — DOP-01–11 shipped ([PROGRESS.md](../../daily-operations/PROGRESS.md) is the live ledger). Arrivals is on `/daily`. Pointers only; not a second spec.
- [Pre-specification](../../daily-operations/daily-operations-pre-specification.md) — superseded one mixed feed. Do not implement from it.
- [2026-08-19 tabbed layout](../../granot-lead-lifecycle/owner-daily-operations-view-specification.md) — not this board. Do not implement 24h/48h tabs, conversations, or deposit here.

**Shipped:** Owner-only `/daily` after Overview. Category panels plus complementary Arrivals. Confirm stays on `/intakes`, not `/daily`. Admin is 403. Reads do not mutate. Mongo is the book; Redis is a doorbell only. Not Daily View. Not Live Events.

**DOP-10 state (2026-09-08):**

- **Snapshot (server, additive):** `getDailyOperationsSnapshot` loads three New York day documents — today, yesterday, day before. Body gains `day_before` (day key), pace `day_before` / `day_before_by_now` on `metrics.{leads,bookings,cancellations,texts}`, `metrics.webhooks.*.day_before`, `companies[].day_before_total`, `hourly.day_before` (24 buckets). A missing day document yields `null` (UI shows a dash); `*_by_now` sums hourly buckets `0..currentNyHour`. Every earlier field is unchanged. Proof: `snapshot.test.ts`.
- **Focus without loss (superseded by DOP-11 solo view):** `?lane=` is a solo Daily Operations Panel (`data-panels-view="solo"`); **All panels** clears `lane`. The DOP-07 count rail is gone.
- **Trend:** tiles and panel headers show `+N · +12%` versus `yesterday_by_now`, a visible `Yesterday by now · Yesterday · Day before` line, and a two-day-average pace when both prior days exist. No baseline → chip hidden, *no prior day yet*. Hourly rhythm card charts today vs yesterday vs day before.
- **Toolbar:** Quiet priorities · Sheet Sync · Colours live in the board chrome (title row), not under the panels.
- **Arrivals as a live rail:** still the newest-20 cross-lane strip (`?lane=` ignored, company + Quiet applied, one `EventSource`), rendered as a sticky rail beside the panel grid on `xl`+ and stacked above it below `xl`. Rippling live dot, `+N` recent counter, last-fact clock, ticking relative time. The Arrivals **Card** is height-capped (`xl:max-h-[calc(100dvh-6rem)]`); the card list (`data-arrivals-scroll`) is the scroll region. Header and Open all stay pinned. Category panels use the same pattern (`data-panel-scroll`, grid `max-h` 28rem, solo taller). Open all / Load earlier still open the existing overlay.
- **Cards:** every populated stored field renders as a labelled fact grid (order = `dailyOperationsCardDetails`). Unknown Ingestion Origin shows its raw value. `Open list` and `Open lead` differ.
- **Kind colour tones (UI words, not glossary):** `lib/api/dailyOperationsColors.ts` — 12 named tones, a default tone per Daily Operations Event kind (all 30 catalog kinds) and per lane; Owner overrides in `localStorage` `vantage-admin-daily-kind-colors` (never the URL; unknown tones dropped on read). Card rail, dot, badge, panel accent, and Arrivals dot read the resolved tone. Colours panel has swatches and Reset colours.
- **Live Events (`/live-events`, separate page):** `components/granot-lifecycle/live-webhooks.tsx` reuses the Granot tones, live dot, and relative clock — every lead fact on the row, per-class colour rail, link to `/daily`; the payload accordion stays. Live Events is still not Daily Operations.

**DOP-11 admin board (2026-09-10):**

- **Panel backfill includes `exception`:** `lanesNeedingBackfill` treats Exceptions like other starved lanes. Zip-miss count is rebuilt from Lead ZIP state, so a Granot flood on the first newest-80 page can starve Exception facts; without backfill the Exceptions panel showed a number and empty copy. Cancellations were already in backfill. A panel count must never sit above an empty stack.
- **Zip-miss Lead fallback (admin companion):** `eventsForDailyOperationsPanel` for the exception lane also shows an in-memory Lead that carries `zip_miss` when no `exception.zip_missing` fact for that Lead is in memory (deduped by `lead_id`). Spec still wants dedicated Exception cards.
- **Empty copy:** count > 0 with no cards in view → `This count is on the board; the cards are still loading.` (`DAILY_COPY.countWithoutCards`). True-empty Exceptions still read `No exceptions so far today.`

**Primary code (server):** `src/services/dailyOperations/**` (`snapshot.ts` owns the three-day load), `src/models/DailyOperationsEvent.ts`, `src/models/DailyOperationsDay.ts`, `src/config/domain/dailyOperations.ts`, `src/routes/daily-operations-admin.routes.ts`, `src/routes/daily-operations-cron.routes.ts`.

**Primary code (admin):** `app/(dashboard)/daily/**`, `components/daily/**` (`daily-shell.tsx` chrome + toolbar + workspace grid, single `EventSource`; `arrivals-stream.tsx` is the complementary Arrivals rail, not a Daily Operations Panel; `category-panels.tsx` solo Panel view; `headline-tiles.tsx` trend chip + sparkline; `hourly-rhythm.tsx`; `kind-colors-context.tsx` / `kind-colors-panel.tsx`; `live-dot.tsx`; `use-now.ts`), `lib/api/dailyOperations.ts` (`percentChange`, `twoDayAverageByNow`, `dailyOperationsTrend`), `lib/api/dailyOperationsLive.ts`, `lib/api/dailyOperationsBoard.ts` (`eventsForDailyOperationsArrivals`, `eventsForDailyOperationsPanel`, `lanesNeedingBackfill`, `dailyOperationsCardDetails`, `panelsForDailyOperationsView`, `panelVisibleLimit`), `lib/api/dailyOperationsColors.ts`, `app/api/daily-operations-live/route.ts`. Owner BFF/proxy gates live in `server/auth/authorization.ts` (`/daily` and `/api/v1/admin/daily-operations`). Hydration events fetch is all-lanes so a remount on `?lane=` cannot empty Arrivals.

**Known gap (record only — do not “fix” on `granot.minted`):** `createLeadFromGranot` writes the Lead directly and never calls `completeFormLeadIngestion` / `completeCallLeadIngestion`. `granot.minted` correctly omits `leads.*`, so Granot-minted Lead volume is not incremented on the live board. Do **not** add a Lead increment on `granot.minted`. This is a gap versus spec §23 narrative (“Twenty minted from Granot lead_created”), not a DOP-08 feature.
