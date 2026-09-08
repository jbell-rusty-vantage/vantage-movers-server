# DOP-10 completion — Live workspace: focus without loss, trend %, full cards, kind colours

Date **2026-09-08**. Issue: [`../issues/DOP-10.md`](../issues/DOP-10.md).
Repositories: `vantage-admin` on `daily-operations` (equal to `main` at
pickup) and `vantage-main-server` on the `main` working tree (snapshot
+ pack docs). **No commit. No push. No deploy.**

## What the Owner gets

| Owner request | Where it landed |
| --- | --- |
| Panel controls at the bottom made no sense | Quiet priorities · Sheet Sync · Colours now sit in a **board toolbar** in the chrome (top right of the title row). `CategoryPanels` renders no toolbar. |
| Choosing a panel lost the multi-panel view | `?lane=` now **expands** that panel in place: first grid cell, full width, 40 cards, Load earlier, **Collapse**. Every other panel stays in the grid. The count rail is gone. |
| Arrivals, panels, and overview should work together | One workspace: chrome → tiles → **overview row** (Hourly rhythm · Origins · Source Company) → Arrivals as a **sticky live rail** beside the panel grid on `xl`+ (stacked above on narrow). |
| Percent change versus the previous day or two | Server snapshot loads the **day before**; tiles and panel headers show `+N · +12%` versus yesterday at this hour, a visible `Yesterday by now · Yesterday · Day before` line, and a 2-day-average pace where both days exist. Hourly rhythm charts today vs yesterday vs day before. |
| Do not hide information on the cards | Card renders every populated stored field as a labelled fact grid (route ZIP + state, move type, text purpose/status/send-at/skip reason, Granot class/action/decision, booking kind, exception code/detail, entity type, job number, form/call). Unknown Ingestion Origin shows its raw value. `Open list` and `Open lead` differ. |
| Customise each event type's colour | `lib/api/dailyOperationsColors.ts`: 12 named tones, a default tone per **kind** (all 30 catalog kinds) and per **lane**, Owner overrides in `localStorage` (`vantage-admin-daily-kind-colors`), **Colours** panel with swatches and **Reset colours**. Rail, dot, badge, panel accent, Arrivals dot all read the tone. |
| Live streaming feel | Rippling `◉ Live` dot with `last fact 12s ago`, Arrivals `+N` pulse counter (15-minute window), relative time ticking on Arrivals cards and Live Events rows, slide-in on insert, tile flash on session delta, hourly sparkline on tiles. |
| Live Events too | `live-webhooks.tsx`: live dot + count + last-receipt clock, per-class colour rail using the same tones, **every lead fact on the row** (name, phone, email, job, priority, origin → destination, move date, Granot event), relative time, link to `/daily`. Payload accordion (`Show details` → `Full Granot payload`) kept. |

## Files changed

### `vantage-main-server`

| Action | Path |
| --- | --- |
| Change | `src/services/dailyOperations/snapshot.ts` — loads today, yesterday, **day before**; `day_before`, pace `day_before` / `day_before_by_now`, `webhooks.*.day_before`, companies `day_before_total`, `hourly.day_before` |
| Change | `src/services/dailyOperations/snapshot.test.ts` — day-before totals, `day_before_by_now` on the same fixture as `yesterday_by_now`, missing day → `null`, 24 buckets |
| Change | `src/services/dailyOperations/liveStream.test.ts`, `src/routes/daily-operations-admin.routes.test.ts` — fixtures carry the additive fields |
| Add | `docs/daily-operations/issues/DOP-10.md`, this report |
| Change | `docs/daily-operations/daily-operations-specification.md` — §2.2, §2.3, §3.2, §4.1, §4.2, §5, §8.1, §16.1 amended, each marked `DOP-10` |
| Change | `docs/daily-operations/PROGRESS.md` |

### `vantage-admin`

| Action | Path |
| --- | --- |
| Add | `lib/api/dailyOperationsColors.ts` + `.test.ts` — tones, default kind/lane map, storage read/write/sanitize |
| Change | `lib/api/dailyOperations.ts` + `.test.ts` — optional `day_before*` fields, `percentChange`, `twoDayAverageByNow`, `dailyOperationsTrend` |
| Change | `lib/api/dailyOperationsBoard.ts` + `.test.ts` — `dailyOperationsCardDetails`, `dailyOperationsAttentionChips`, `panelVisibleLimit`, `orderPanelsForFocus`, `countRecentDailyOperationsEvents`, `newestDailyOperationsEventAt`; `leadDeskHref` split list / record |
| Change | `components/daily/daily-copy.ts` — trend, colours, rhythm, fact labels; `formatDailyOperationsRelative`, `dailyOperationsKindLabel`, `dailyOperationsFloridaHour` |
| Change | `components/daily/event-card.tsx` — tone rail / dot / badge, fact grid, relative time, chips, links |
| Change | `components/daily/headline-tiles.tsx` — `TrendChip`, visible baseline line, `HourlySparkline`, focus toggle |
| Add | `components/daily/hourly-rhythm.tsx` — today vs yesterday vs day before, `now` marker |
| Change | `components/daily/arrivals-stream.tsx` — live rail header (dot, recent count, last fact), kind dots, ticking relative time |
| Change | `components/daily/category-panels.tsx` — expand-in-place focus, Show all, lane tone header, trend chip, no toolbar |
| Add | `components/daily/kind-colors-context.tsx` (`useSyncExternalStore` over `localStorage`), `components/daily/kind-colors-panel.tsx`, `components/daily/live-dot.tsx`, `components/daily/use-now.ts` |
| Change | `components/daily/daily-shell.tsx` — chrome toolbar, overview row, workspace grid; still **one** `EventSource` |
| Change | `components/granot-lifecycle/live-webhooks.tsx` — Live Events treatment |
| Change | `app/globals.css` — `daily-live-ripple`, `daily-arrival-enter`, `daily-tile-flash`, stream fade, `--steel-300/400` |
| Change | `tests/daily-page.test.ts`, `tests/granot-lifecycle-components.test.ts` |

## Handoff facts (issue §14)

- **Snapshot fields:** `day_before`, `metrics.{leads,bookings,cancellations,texts}.day_before` and `.day_before_by_now`, `metrics.webhooks.*.day_before`, `companies[].day_before_total`, `hourly.day_before`. Proof: `snapshot.test.ts` asserts `day_before_by_now` on the same hourly fixture that proves `yesterday_by_now`, and `null` when the day-before document is missing.
- **Focus:** `?lane=<lane>` → `orderPanelsForFocus` moves the lane first; that panel gets `col-span-full`, `panelVisibleLimit` 40, Load earlier, Collapse. Others untouched. `data-panel="text"` and `data-panel="exception"` still render with `lane="lead"` (test).
- **Toolbar:** `daily-shell.tsx` chrome. `CategoryPanels` still accepts the toggle props (tests pass them) but renders no buttons.
- **Card fact list:** see spec §8.1 (DOP-10 block) — the order is the `dailyOperationsCardDetails` order.
- **Tones:** `blue sky indigo violet teal emerald lime amber orange rose red slate`. Lane defaults: lead blue · text violet · granot teal · intake amber · booking emerald · cancellation rose · exception red · sheet_sync slate. Kind defaults step off the lane colour for second-look outcomes (duplicate/observed/skipped → slate, unmatched/release/adoption_conflict → orange, held/pending → amber, failed/dead letter → red). Storage key `vantage-admin-daily-kind-colors`; unknown tone names are dropped on read.
- **Layout:** overview row `xl:grid-cols-[1.5fr_1fr_1fr]` (rhythm · origins · companies); workspace `xl:grid-cols-[340px_1fr]`, `2xl:grid-cols-[380px_1fr]`, Arrivals `xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto`; below `xl` Arrivals stacks above the panels. DOM order: Arrivals before panels (test).
- **EventSource count:** `rg -c "new EventSource" components/daily components/granot-lifecycle` → `daily-shell.tsx: 1`, `live-webhooks.tsx: 1` (its own page, unchanged count). Arrivals, panels, tiles, rhythm: 0.
- **Hydration:** kind tones and the ticking clock use `useSyncExternalStore` with a stable server snapshot (empty overrides / `undefined` now). No client-only state set in mount effects for these.

## Tests

| Where | Command | Result |
| --- | --- | --- |
| `vantage-admin` | `pnpm test` | **569 pass / 0 fail** (557 at DOP-09) |
| `vantage-admin` | `pnpm typecheck` | pass |
| `vantage-admin` | `pnpm lint` | repo-wide still fails on **pre-existing** `react-hooks/set-state-in-effect` (`daily-shell.tsx` events-query effect ×2, `needs-you.tsx`, `job-timeline-dashboard.tsx`, `global-search.tsx`). Every DOP-10 file lints clean; the two new hooks (`use-now.ts`, `kind-colors-context.tsx`) were written to avoid that rule. |
| `vantage-main-server` | `snapshot.test.ts`, `liveStream.test.ts`, `daily-operations-admin.routes.test.ts` | **29 pass / 0 fail**; full `pnpm test` 2198 pass earlier in the session |

## Browser walk (local Owner session, production scope, no credentials pasted)

- `/daily` — chrome with `◉ Live`, toolbar top right; eight tiles with sparklines; local day has **no yesterday / day-before documents**, so trend chips are hidden and tiles read *no prior day yet* (honest); Hourly rhythm fills its card with today's bars and a `now` marker; Arrivals rail shows `+N` (last 15 minutes) and `last fact Ns ago` and cards with tone dots and `12s ago`-style time; panel grid beside it, two columns at this width.
- `/daily?lane=granot` — Granot panel expands to full width (three card columns), **Collapse** present; Leads, Texts, Intakes, Bookings, Cancellations, Exceptions all still on screen beneath it. Arrivals unchanged.
- **Colours** — panel opens under the toolbar; kinds grouped by lane; set *Granot Booked* to rose → rail, dot, and badge on the booked cards changed at once; `localStorage["vantage-admin-daily-kind-colors"]` contains `{"granot.booked":"rose"}`. Persistence across reload and **Reset colours** are covered by `dailyOperationsColors.test.ts` (read / write / sanitize / reset).
- `/live-events` — `Live Granot webhooks ◉ LIVE · 9 in the last 30 minutes · last fact 12s ago · Open Daily Operations`; rows with slate (priority updated) / emerald (booking status changed) rails; name, phone, email, job number, Granot event, priority, moving from → to, move date all visible without a click; `Open booking intake` / `Open job timeline` links; `Show details` opens the raw payload.
- Next.js dev overlay reports one hydration warning on both pages: `data-cursor-ref` attributes injected into the DOM by the Cursor browser before React mounts. Not from this change; not reproducible in a plain browser.

Trend rendering with real baselines is proven by `tests/daily-page.test.ts` (fixture with yesterday values renders `%` and *Yesterday*), since the local Mongo has no closed prior days.

## Acceptance (issue §10)

- [x] `?lane=lead` keeps every other panel visible; the count rail is gone.
- [x] Tiles and panel headers show `%` versus yesterday at this hour and the yesterday / day-before line without hover (hidden only when there is no baseline at all).
- [x] Snapshot body has `day_before`, `day_before_by_now`, `hourly.day_before`, `day_before_total`; missing day → `null`.
- [x] A card shows every populated stored field; `Open list` and `Open lead` differ.
- [x] Every catalog kind has a default tone; the Owner can change a kind's tone and it persists across reload; Reset restores.
- [x] Arrivals is a live rail with rippling dot and last-fact clock; still 20 newest, cross-lane, `?lane=` ignored, one EventSource.
- [x] Quiet priorities / Sheet Sync / Colours live in the chrome toolbar.
- [x] Live Events rows show origin → destination on the collapsed row with a per-class colour rail; payload accordion still present.
- [x] `pnpm test && pnpm typecheck` in vantage-admin; server `dailyOperations` suites pass. Browser walk above.

## Gaps and notes

- Local Mongo has no closed prior days, so `%` and the Hourly rhythm ghost bars were verified by unit fixtures, not in the browser. First production day after deploy will show `—` / *no prior day yet* for the day-before column until two closed days exist.
- Server work sits on the `main` working tree, not `daily-operations` (that branch is behind `main`; the local API serves from `main`). The `docs/index.md` and `docs/exact-job-booking-attach/` changes in that tree are **not** DOP-10 and were left alone.
- `pnpm lint` repo-wide failure is pre-existing and outside this issue.
- 21st.dev: searched "Data Stream" and "Status Dot"; adapted the type-coloured dot, header counter, and ripple ideas with existing Owner tokens. Nothing installed.
