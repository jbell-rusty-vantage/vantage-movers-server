# DOP-11 completion — Board motion, solo panels, full-stream overlay, live clock

Date **2026-09-08**. Issue: [`../issues/DOP-11.md`](../issues/DOP-11.md).
Repositories: `vantage-admin` and `vantage-main-server` (`metrics`
multiplicity + pack docs). **No commit. No push. No deploy.**

## What the Owner gets

| Owner request | Where it landed |
| --- | --- |
| Expand-in-place still kept every panel on the board | **Panel view** strip (`role="tablist"`): **All panels** plus one control per visible Daily Operations Panel. Choosing a lane is a **solo view** — only that panel renders (`data-panels-view="solo"`, `?lane=<lane>`). All panels clears `lane`. DOP-10 expand-in-place is superseded. |
| Open all should show every in-memory fact | **Open all (N)** on a panel or **Open full stream** on Arrivals opens a full-screen `aria-modal` overlay (`data-daily-overlay=<lane\|all>`). Grid or Column, persisted as `vantage-admin-daily-overlay-layout`. Footer **Load earlier** (per-lane cursor) and **Every fact for today is loaded** when exhausted. Escape, backdrop, Close dismiss. The overlay does not fetch except the earlier page the Owner asks for. |
| The board should feel live | New facts `daily-row-enter`; fallen-off facts `daily-row-exit` (`use-exiting-list.ts`, `event-list.tsx`). Counts tween (`animated-number.tsx`). Bars transition (`daily-bar`, `daily-svg-bar`). Hourly Rhythm `now` column pulses (`daily-now-pulse`). Off under `prefers-reduced-motion: reduce`. Form / Call tile has a split share bar. Arrival highlights are shared (`use-arrival-highlights.ts`). |
| Pace drifted on a board left open | `withLiveDailyOperationsClock` rebases `*_by_now` and the sparkline / Hourly Rhythm `now` hour from the browser clock (15s tick), not snapshot `generated_at`. Server `null` stays `null`. After the America/New_York day leaves `snapshot.today` the function leaves the snapshot alone; resync takes over. |
| A burst of facts counted as one | Tiles, `+N`, and hourly buckets move per `event` (`metric_touches`, deduped by `event_id`). The SSE `metrics` frame is acknowledged and ignored by the Admin board. Server `emitMetricsIfTouched` now keeps multiplicity for any consumer that does add the frame. `messages.deferred` flashes Texts and does not move its `+N`. |

Also shipped with this unit: snapshot resync every 5 minutes while visible (refreshes `held_now` / `still_open`, corrects drift — **not** a live poll), when the tab returns after hidden ≥ 240s, and on New York day rollover. `receiveDailyOperationsSnapshot` treats every snapshot as authoritative; a new `today` drops yesterday's facts and session `+N` and reconnects the live socket. Load earlier is per lane. Quiet priorities / Sheet Sync read through `use-preference-flag.ts`; `?quiet_priorities=1` on arrival still persists.

## Flaws fixed

- **DOP-10 expand-in-place** reordered panels and kept every panel on the board. Replaced by solo view.
- **Frozen like-hour baselines.** Pace `%` vs yesterday at this hour compared today's growing count to yesterday at page-load hour.
- **Deduped `metrics` counting.** Three Leads in one poll incremented tiles by one. Client now counts per `event`; server `metrics` keeps multiplicity.
- **Shared Load-earlier cursor.** A Granot-flooded board skipped earlier Cancellations when paging that panel.
- **Preference flags copied by effect.** Quiet priorities / Sheet Sync now use a `localStorage` external store.

## Files changed

### `vantage-admin`

| Action | Path |
| --- | --- |
| Change | `components/daily/category-panels.tsx` — Panel view strip; solo view (`data-panels-view`); **Open all**; Sheet Sync header `N completed · M failed` |
| Add | `components/daily/events-overlay.tsx` — full-stream overlay |
| Change | `lib/api/dailyOperationsBoard.ts` + `.test.ts` — `panelsForDailyOperationsView`, per-lane `earlierDailyOperationsCursor`; Sheet Sync panel count `completed + failed`; backfill includes `sheet_sync`; `card.sheet_sync` details |
| Change | `lib/api/dailyOperations.ts` + `.test.ts` — `withLiveDailyOperationsClock`; snapshot `metrics.sheet_sync` (`{0,0}` when omitted) |
| Change | `lib/api/dailyOperationsLive.ts` + `.test.ts` — count per `event`; ignore `metrics`; `receiveDailyOperationsSnapshot` day rollover; live `sheet_sync.*` touches |
| Change | `components/daily/daily-shell.tsx` — 5-minute / hidden-240s / day-rollover resync; overlay host; preference store |
| Change | `components/daily/daily-copy.ts` — Panel view / overlay / share-bar copy; Sheet Sync fact labels + `completed` |
| Add | `components/daily/use-exiting-list.ts`, `components/daily/event-list.tsx`, `components/daily/animated-number.tsx`, `components/daily/use-arrival-highlights.ts`, `components/daily/use-preference-flag.ts` |
| Change | `components/daily/headline-tiles.tsx`, `arrivals-stream.tsx`, `hourly-rhythm.tsx` — tweened counts, share bar, **Open full stream** |
| Change | `app/globals.css` — `daily-row-enter` / `daily-row-exit` / `daily-bar` / `daily-svg-bar` / `daily-now-pulse`; reduced-motion kill |
| Change | `tests/daily-page.test.ts` |

### `vantage-main-server`

| Action | Path |
| --- | --- |
| Change | `src/services/dailyOperations/liveStream.ts` — `emitMetricsIfTouched` keeps multiplicity (no `Set`) |
| Change | `src/services/dailyOperations/liveStream.test.ts` — "a burst of facts in one wake keeps every touch in the metrics frame"; snapshot fixtures gain `sheet_sync` |
| Change | `src/services/dailyOperations/kinds.ts` — `sheet_sync.*` `metricTouches` are the kind itself (panel only) |
| Change | `src/models/DailyOperationsDay.ts`, `src/services/dailyOperations/dayDocument.ts` — day counter `sheet_sync: { completed, failed }` |
| Change | `src/models/DailyOperationsEvent.ts` — `card.sheet_sync?` |
| Change | `src/services/dailyOperations/recordDomainFacts.ts` — `recordSheetSyncDailyOperationsFact` |
| Change | `src/services/sheetSync/drainer/runSheetSyncDrain.ts` — hook after `markJobSynced` / in `recordJobFailureEvent` |
| Change | `src/services/dailyOperations/snapshot.ts`, `rebuild.ts` — `metrics.sheet_sync`; rebuild from the day's events |
| Add | `docs/daily-operations/issues/DOP-11.md`, this report |
| Change | `docs/daily-operations/daily-operations-specification.md` — §2.2, §2.3, §3.2, §3.4, §4.1, §4.2, §5, §15.9, §16.1, §16.2, §16.3, §17, §21 amended, each marked `DOP-11` |
| Change | `docs/daily-operations/PROGRESS.md`, `README.md`, `reports/README.md` |

## Handoff facts (issue §14)

- **Solo view:** `panelsForDailyOperationsView` — All panels → every on-by-default panel; `?lane=granot` → `{ tabs, visible: ["granot"], solo: "granot" }`. Sheet Sync joins `tabs` only after opt-in or `lane=sheet_sync`. Header / tile / strip control writes `?lane=`; All panels clears it. `data-panels-view="solo"|"all"`.
- **Overlay:** `events-overlay.tsx`, `data-daily-overlay=<lane|all>`, `aria-modal`. Storage key `vantage-admin-daily-overlay-layout` (`grid` \| `column`). Same cards, same highlights, same EventSource.
- **Motion:** enter / exit on the visible slice; tweened numbers; bar transitions; `now` pulse. Disabled when `prefers-reduced-motion: reduce`.
- **Live clock:** `withLiveDailyOperationsClock(snapshot, nowMs)` — same `today` only; rebases `yesterday_by_now` / `day_before_by_now` from `hourly.*` through the current America/New_York hour; `null` stays `null`; other day → identity.
- **Counting:** `applyDailyOperationsSsePayload` on `event` applies `metric_touches` once per `event_id`. `metrics` → no-op. `messages.deferred` ∈ flash set, not Texts `+N`.
- **Resync:** `SNAPSHOT_RESYNC_MS = 5 * 60_000` while visible; `HIDDEN_RESYNC_MS = 240_000`; New York day mismatch invalidates snapshot + events queries and bumps `streamGeneration`.
- **Load earlier:** `earlierDailyOperationsCursor(events, lane)` from the oldest in-memory fact of that lane (`null` lane = overlay all-lanes). Exhaustion per scope key.
- **Preferences:** `useStoredPreferenceFlag` over `vantage-admin-daily-quiet-priorities` / Sheet Sync key. URL `?quiet_priorities=1` persists; stored value written back once.
- **EventSource count:** still one, in `daily-shell.tsx`. Overlay / panels / Arrivals: 0.
- **Sheet Sync drain hook:** `recordSheetSyncDailyOperationsFact` from `runSheetSyncDrain` only. Panel count `completed + failed`. Rebuild from the day's events. Coalesced duplicates and quota deferrals never record.

## Tests

| Where | Command | Result |
| --- | --- | --- |
| `vantage-admin` | `pnpm test` | **585 pass / 0 fail** (583 at DOP-11 board; 569 at DOP-10) |
| `vantage-admin` | `pnpm typecheck` | pass |
| `vantage-admin` | eslint on `components/daily` and the daily lib files | clean |
| `vantage-main-server` | dailyOperations + sheetSync + admin-route focused | **138 pass / 0 fail** (103 at DOP-11 board) |

New / updated admin tests: `lib/api/dailyOperations.test.ts`, `lib/api/dailyOperationsBoard.test.ts`, `lib/api/dailyOperationsLive.test.ts`, `tests/daily-page.test.ts`.

## Browser walk

Walked on `localhost:3000/daily` against the local API (Owner session, live board with ~94 Granot receipts, 12 Leads, 2 Bookings on the day).

Passed: LIVE pill; tiles with numbers and the Form / Call split bar; Hourly rhythm bars and one `data-now-column`; Panel view strip (All panels + seven lane tabs); Granot tab → one `[data-panel]`, `?lane=granot`, `data-panels-view="solo"`; All panels → seven panels, `lane` cleared; Open all → `[data-daily-overlay="granot"]`, Grid ↔ Column persisted, Load earlier 55 → 87 cards, Escape closes; Open full stream → `[data-daily-overlay="all"]` labelled All lanes, Close button; Quiet priorities toggles `aria-pressed` and `quiet_priorities=1` with no flicker back; reload keeps the preference and the board; 60 s dwell kept LIVE and tiles moved (Leads 11 → 12, Granot 89 → 92).

Found and fixed during the walk:

- **Cached queries not folded on remount.** The render-phase sync markers were seeded with the current query data, so a fresh mount that found both queries already cached (route change and back, Fast Refresh) showed counts from the socket snapshot but no facts anywhere. Markers now start empty. Verified: `/daily` → Live Events → `/daily` returns 32 cards, LIVE, no console errors.
- **Panel count without facts.** Leads read "Nothing in this category yet today" beside a count of 12: the first newest-80 page across every lane was all Granot. `lanesNeedingBackfill` names each visible panel that holds fewer in-memory facts of its lane than `min(count, 8)` — i.e. it cannot fill its default card slots (never `exception`; `sheet_sync` is included now that its count is a fact count), and the shell fetches that lane's newest page once. The first cut only fired on zero facts, which left Texts reading 11 over two cards and Intakes 10 over three; the slot rule closes that. Verified after a hard reload and after a Live Events → Daily Operations remount: Leads 16 / 8 cards, Texts 11 / 8, Intakes 10 / 8, Bookings 2 / 2; solo Leads shows every lane fact (17, the extra being a duplicate-lead fact outside `leads.total`).
- **Duplicate React keys in the Granot panel.** `pairGranotEvents` pushed a receipt's outcomes once per receipt-shaped fact sharing the same `receipt_id` (the receipt and a pending match on it). Outcomes now hang under the first, once. Test added.
- **Sheet Sync always read 0.** Nothing recorded a Daily Operations Event for Sheet Sync: the kinds catalog declared `sheet_sync.completed` / `sheet_sync.failed` with `metricTouches: []`, §15.9 named the drain hook, and the hook was never wired. Production is `SHEET_SYNC_MODE=queued`, so `runSheetSyncDrain` is the only place jobs finish. Admin `dailyOperationsPanelCount(..., "sheet_sync")` was hard-coded 0 and `lanesNeedingBackfill` excluded the lane. Fix: `recordSheetSyncDailyOperationsFact` + drainer hook after `markJobSynced` / inside `recordJobFailureEvent` (not coalesced duplicates, not quota deferrals, not `finalizeSheetSync`); day counter + snapshot `metrics.sheet_sync` + rebuild from the day's events; Admin count = completed + failed, live `metric_touches`, backfill includes `sheet_sync`, card details for `card.sheet_sync`. Verified: snapshot carries `metrics.sheet_sync`; count stays 0 until the deployed drainer records the first job (local `/daily?lane=sheet_sync` against production Mongo — no synthetic facts seeded).

Noise, not defects: the Next.js hydration-mismatch entries diff only `data-cursor-ref` attributes injected by the QA browser before hydration.

## Acceptance (issue §10)

- [x] Panel view strip; `?lane=` is solo; All panels clears `lane`; expand-in-place gone from the board.
- [x] Overlay from Open all / Open full stream; layout persists; per-lane Load earlier; dismiss.
- [x] Enter / exit / tweened counts; reduced-motion off.
- [x] Live clock on the same America/New_York day; `null` stays `null`.
- [x] Count per `event`; Admin ignores `metrics`; held text flashes Texts only.
- [x] 5-minute / hidden ≥ 240s / day-rollover resync; new `today` drops old facts and `+N`.
- [x] Per-lane Load earlier.
- [x] Preference store; `?quiet_priorities=1` persists.
- [x] Server multiplicity. 585 admin tests; typecheck; daily eslint clean; 138 focused server dailyOperations + sheetSync + admin-route. Browser walk above. Sheet Sync drain hook landed (panel count + facts).

## Gaps and notes

- Browser walk recorded above.
- DOP-10's `orderPanelsForFocus` and the `collapse` / `showAll` / `showFewer` / `lookCloser` copy keys were removed with the expand-in-place focus; the board uses `panelsForDailyOperationsView`.
- Root glossary still says Daily Operations is not tabs. The Panel view strip is an on-board `role="tablist"` labelled **Panel view**; it is not the 2026-08-19 tabbed Daily View.
