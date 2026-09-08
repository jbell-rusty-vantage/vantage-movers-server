# DOP-11 — Board motion, solo panels, full-stream overlay, live clock

> **Contract maturity: implementation-ready.** Session 9. Owner-requested
> follow-on after DOP-10. Same board, same EventSource, same kinds.
> Category panels stay. Arrivals stays. What changes is how the Owner
> isolates one Daily Operations Panel, how the full in-memory stream
> opens, how facts move, and how like-hour baselines stay honest.

## 1. Authority and required reading

- **Owner request (after DOP-10):** (a) expand-in-place focus still kept
  every panel on the board and reordered them — the Owner wants one
  panel alone; (b) Open all should show every in-memory fact, not a
  longer slice on the board; (c) the board should feel live (enter /
  exit, tweened counts); (d) pace versus yesterday at this hour drifted
  on a board left open because `*_by_now` was frozen at snapshot
  `generated_at`; (e) a burst of facts in one poll counted as one
  because the client added the deduped `metrics` frame.
- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §2.2 (panel view), §2.3 (counts), §3.2 (bands), §3.4 (Arrivals),
  §4.1–§4.2 (motion / density), §5 (tiles), §16.2 (SSE `metrics`),
  §17 (client). This issue **amends** those sections as recorded in §6
  below. The spec is edited in the same change; the amendments are
  marked `DOP-11`.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md),
  [`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)
- **Reports:** [`../reports/DOP-10-completion.md`](../reports/DOP-10-completion.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

The Owner isolates one Daily Operations Panel as a **solo view** (the
others leave the grid), opens every in-memory fact in a full-stream
overlay, sees facts arrive and leave with motion, and reads pace
against yesterday / the day before **at this hour** on the browser
clock. Tiles and `+N` move once per fact.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-admin` (board) and `vantage-main-server`
  (`metrics` frame multiplicity only).
- **Branches:** the desk already used for Daily Operations. No commit,
  push, or deploy unless asked.
- **Prerequisites:** DOP-10 `complete`.
- 21st.dev not used.

## 4. Current-state evidence to verify

Observed 2026-09-08 on DOP-10's tree; **reverify before coding.**

- `category-panels.tsx`: `?lane=` **expands** that panel in place
  (`orderPanelsForFocus`); every other panel stays in the grid; count
  rail gone. **Show all (N)** reveals the in-memory slice without
  focusing. **Collapse** clears `?lane=`.
- `headline-tiles.tsx`: `*_by_now` comes from the snapshot as stamped
  at `generated_at`. A board left open compares a growing today against
  a frozen like-hour baseline.
- `dailyOperationsLive.ts`: tiles and session `+N` apply the SSE
  `metrics` frame. The server's touch list was a `Set`, so three Form
  Leads in one wake counted as one.
- `earlierDailyOperationsCursor` paged from the oldest fact **on the
  whole board**, so a Granot flood skipped earlier Cancellations when
  paging the Cancellations panel.
- Quiet priorities / Sheet Sync were copied into React state by an
  effect.

## 5. Locked decisions kept

- Category panels on one board. Not the 2026-08-19 tabbed Daily View.
  Not a page per category. Not a mixed feed as the only view.
- One EventSource. Arrivals reads `board.events`. No Redis in the
  browser.
- Arrivals default 20 newest after Quiet + `?company=`; `?lane=` does
  not filter Arrivals. Same card shell. Name + last four. No Confirm.
- Mongo is SoR. No new kinds, hooks, or increments. No Lead increment
  on `granot.minted`.
- Owner strings live in `daily-copy.ts`.
- DOP-10 toolbar, trend `%`, kind tones, full-fact cards, Hourly
  rhythm, and Arrivals live rail stay.

## 6. Deliverables and exact contract

### 6.1 Client — solo view (amends §2.2, §3.2)

- A `role="tablist"` **Panel view** strip above the panels: **All
  panels** plus one control per visible Daily Operations Panel.
  `panelsForDailyOperationsView({ lane, sheetSyncOptIn })` returns
  `{ tabs, visible, solo }`.
- Choosing a lane is a **solo view**: only that panel renders
  (`data-panels-view="solo"`, `?lane=<lane>`). **All panels** clears
  `lane` (`data-panels-view="all"`). This **replaces** DOP-10
  expand-in-place focus.
- Sheet Sync remains a strip control only after opt-in (or
  `lane=sheet_sync`).
- Clicking the same lane control again, or **All panels** / the panel
  header while solo, returns to All panels.

### 6.2 Client — full-stream overlay (amends §3.4, §4.2)

- **Open all (N)** on a panel or **Open full stream** on Arrivals
  opens a full-screen `aria-modal` overlay
  (`data-daily-overlay=<lane|all>`) listing every in-memory fact for
  that lane (or all lanes, newest first).
- Layout: responsive **Grid** or one long **Column**, persisted in
  `localStorage` key `vantage-admin-daily-overlay-layout`.
- Footer: **Load earlier** (per-lane cursor) and **Every fact for
  today is loaded** when that scope is exhausted.
- Escape, backdrop, and **Close** dismiss it. Nothing in the overlay
  fetches on its own except the earlier page the Owner asks for.

### 6.3 Client — motion (amends §4.1)

- New facts animate in (`daily-row-enter`); facts that fall off a
  slice slide out (`daily-row-exit`, `use-exiting-list.ts` +
  `event-list.tsx`).
- Tile numbers, panel counts, Origins / Source Company counts, and
  Hourly Rhythm header counts tween (`animated-number.tsx`).
- Progress bars (`daily-bar`) and SVG bars (`daily-svg-bar`,
  `scaleY`) transition. The Hourly Rhythm `now` column pulses
  (`daily-now-pulse`).
- All motion is disabled under `prefers-reduced-motion: reduce`.
- Form / Call tile shows a split share bar.
- Arrival highlight tracking is shared across Arrivals, panels, and
  the overlay (`use-arrival-highlights.ts`).

### 6.4 Client — live clock (amends §2.3, §5, §16.1)

- `withLiveDailyOperationsClock` rebases `*_by_now` (yesterday / day
  before) and the sparkline / Hourly Rhythm `now` hour from the
  browser clock (15s tick), not the snapshot's `generated_at`.
- Baselines the server left `null` stay `null`.
- Once the America/New_York day differs from `snapshot.today` the
  function leaves the snapshot alone; the resync takes over.

### 6.5 Client — count per event (amends §2.3, §16.2, §17)

- Tiles, `+N` session badges, and hourly buckets move per `event`
  frame (`metric_touches`, deduped by `event_id` so reconnect replays
  never double count). `hourly.<field>` touches bump that fact's
  America/New_York-hour bucket.
- The SSE `metrics` frame is acknowledged and otherwise ignored for
  counting.
- `messages.deferred` (a held Lead Message) flashes the Texts tile
  but does not move its `+N` (the tile prints successful sends only).

### 6.6 Client — snapshot resync (amends §17)

- The snapshot refetches every 5 minutes while visible
  (`refetchInterval`) — refreshes `held_now` / `still_open` and
  corrects drift. **Not** a live poll.
- Also refetch when the tab returns after being hidden ≥ 240s, and
  on America/New_York day rollover.
- `receiveDailyOperationsSnapshot(board, snapshot)` treats every
  fetched / streamed snapshot as authoritative. When `today` differs
  from the board's, yesterday's facts and the session `+N` badges are
  dropped and the live socket reconnects.

### 6.7 Client — per-lane Load earlier (amends §4.2)

- `earlierDailyOperationsCursor(events, lane)` pages from the oldest
  in-memory fact **of that lane**. Exhaustion is tracked per scope.

### 6.8 Client — preferences

- Quiet priorities and Sheet Sync are read through a `localStorage`
  external store (`use-preference-flag.ts`), not copied into React
  state by an effect. `?quiet_priorities=1` on arrival still persists;
  a stored preference is written back into the URL once.

### 6.9 Server — `metrics` multiplicity (amends §16.2)

- `emitMetricsIfTouched` carries every touch **with multiplicity**
  (no `Set` dedupe) so a consumer that does add the frame sees every
  increment. The Admin board still ignores the frame.

### 6.10 Copy (`daily-copy.ts`)

`panels`, `panelsSubtitle`, `panelTabs` ("Panel view"), `allPanels`,
`onlyThis`, `openAll`, `fullStream` ("Open full stream"), `allLanes`,
`cards`, `layout`, `layoutGrid`, `layoutColumn`, `close`,
`wholeDayLoaded` ("Every fact for today is loaded"), `filtered`,
`formShare`, `callShare`.

### 6.11 Tests

Admin: `pnpm test && pnpm typecheck`; lint on `components/daily` and
the daily lib files. Server: `dailyOperations` suites, including
`liveStream.test.ts` ("a burst of facts in one wake keeps every touch
in the metrics frame").

### 6.12 Sheet Sync drain hook (amends §13, §15.9, §16.3)

The §15.9 drain hook landed. `runSheetSyncDrain` records
`sheet_sync.completed` after `markJobSynced` (representative or empty
job) and `sheet_sync.failed` inside `recordJobFailureEvent` (planning
or write failure; attempts + error on the card). Panel count is
`completed + failed`. Coalesced duplicates and quota deferrals never
record. Do not hook `finalizeSheetSync`. Rebuild counts `sheet_sync`
from the day's Daily Operations Events.

## 7. Out of scope

- New kinds, hooks, or metric increments — except the already-specified
  §15.9 Sheet Sync drain hook in 6.12 (kinds existed; the wire did not).
- A second EventSource, Redis in the browser.
- Confirm Granot Booking on `/daily`.
- 24h/48h Daily View. A page per category.
- Lead cost, binder, deposit.
- Historical trend beyond two prior days (Analytics owns that).
- The browser walk may be appended as a separate report.

## 8. Tests

- Client: `panelsForDailyOperationsView` — All panels vs solo;
  Sheet Sync on the strip only after opt-in or `lane=sheet_sync`.
- Client: `earlierDailyOperationsCursor` is per lane (Granot-oldest
  is not the Cancellations cursor).
- Client: `withLiveDailyOperationsClock` rebases `*_by_now` on the
  same day; leaves the snapshot alone after day rollover; `null`
  baselines stay `null`.
- Client: live counting — three facts in one wake move tiles by
  three; `metrics` does not add; replay of the same `event_id` does
  not double count; `messages.deferred` flashes Texts and does not
  bump `+N`.
- Client: `receiveDailyOperationsSnapshot` drops old-day facts and
  session `+N` when `today` changes.
- Server: burst of facts in one wake keeps every touch in the
  `metrics` frame.
- Server: Sheet Sync drain hook — `sheet_sync.completed` /
  `sheet_sync.failed` after `markJobSynced` / `recordJobFailureEvent`;
  never on coalesced duplicates or quota deferrals; coordinator not
  hooked.

## 9. Knowledge updates after this issue ships

Invoke **docs-keeper** so the admin map / Daily Operations pointer
describe solo view, the overlay, per-event counting, the live clock,
and the 5-minute snapshot resync. DOP-10 expand-in-place is
superseded, not deleted from history.

## 10. Acceptance criteria

- [x] Panel view strip: **All panels** plus one control per visible
      lane; `?lane=` is a solo view (`data-panels-view="solo"`); All
      panels clears `lane`. DOP-10 expand-in-place is gone from the
      board.
- [x] **Open all** / **Open full stream** opens the overlay
      (`data-daily-overlay`); Grid / Column persist; Load earlier is
      per lane; Escape / backdrop / Close dismiss.
- [x] New facts enter and fallen-off facts exit; counts tween;
      motion is off under `prefers-reduced-motion: reduce`.
- [x] `*_by_now` and the Hourly Rhythm `now` hour follow the browser
      clock on the same America/New_York day; `null` stays `null`.
- [x] Tiles / `+N` / hourly buckets count per `event`; `metrics` is
      ignored by the Admin board; `messages.deferred` flashes Texts
      only.
- [x] Snapshot resyncs every 5 minutes while visible, after hidden
      ≥ 240s, and on New York day rollover; a new `today` drops
      yesterday's facts and session `+N` and reconnects the socket.
- [x] Load earlier pages from the oldest in-memory fact of that
      lane.
- [x] Quiet priorities / Sheet Sync read through the preference
      store; `?quiet_priorities=1` persists.
- [x] Server `metrics` frame keeps multiplicity. Admin `pnpm test`
      (585) + `pnpm typecheck`; daily eslint clean; server
      dailyOperations + sheetSync + admin-route focused 138.
      Browser walk may be appended separately.
- [x] Sheet Sync drain hook: `runSheetSyncDrain` records
      `sheet_sync.completed` / `sheet_sync.failed`; panel count is
      `completed + failed`; coalesced duplicates and quota deferrals
      never record.

## 11. Commands

```bash
cd vantage-main-server && pnpm test -- src/services/dailyOperations
cd vantage-admin && pnpm test && pnpm typecheck
```

Browser per LOCAL-ADMIN: `/daily`, `/daily?lane=lead`, Open all /
Open full stream, All panels. Walk may be appended separately.

## 12. Risks

- Calling the Panel view strip the 2026-08-19 tabbed Daily View.
- Applying both the `event` touches and the `metrics` frame.
- A second EventSource for the overlay.
- Rebasing `*_by_now` after the New York day has rolled (the
  snapshot must stay put until resync).
- A shared Load-earlier cursor that skips a quiet lane.

## 13. Rollback

Restore DOP-10 `category-panels.tsx`, `daily-shell.tsx`,
`dailyOperationsLive.ts`, and `liveStream.ts` `emitMetricsIfTouched`.
Remove the overlay, live-clock helper, and preference store.

## 14. Handoff list for the completion report

- Solo view vs DOP-10 expand-in-place.
- Overlay open / layout / dismiss / Load earlier.
- Motion classes and reduced-motion.
- Live clock and day-rollover rule.
- Count-per-event and `metrics` ignore / server multiplicity.
- Snapshot resync cadence.
- Per-lane cursor.
- Preference store.
- Tests. Browser walk may be appended separately.
- Sheet Sync drain hook (§15.9).
- Gaps.

**Unblocks:** nothing. Pack closes when this issue closes.
