# DOP-09 implementation — Arrivals band on /daily

Date **2026-09-08**. Implementation only. Repositories: `vantage-admin`
(code) and pack docs in `vantage-main-server`, both on
`daily-operations`. **Not complete.** No commit. No push. No deploy.
§10 boxes left unchecked. No `DOP-09-completion.md`.

## Files changed

| Action | Path |
| --- | --- |
| Add | `vantage-admin/components/daily/arrivals-stream.tsx` |
| Change | `vantage-admin/components/daily/daily-shell.tsx` (mount only; still one EventSource) |
| Change | `vantage-admin/components/daily/daily-copy.ts` |
| Change | `vantage-admin/components/daily/event-card.tsx` (`highlight` + `justNow`) |
| Change | `vantage-admin/app/globals.css` (local `daily-arrival-slide-in` keyframe; no new package) |
| Change | `vantage-admin/lib/api/dailyOperationsBoard.ts` (selector + highlight helpers) |
| Change | `vantage-admin/lib/api/dailyOperationsBoard.test.ts` |
| Change | `vantage-admin/tests/daily-copy.test.ts` |
| Change | `vantage-admin/tests/daily-arrivals.test.ts` (new) |
| Change | `vantage-main-server/docs/daily-operations/PROGRESS.md` (issue-log line only) |

## Selector

`eventsForDailyOperationsArrivals({ events, company, quietPriorities, lane? })`

- Limit: `DAILY_OPERATIONS_ARRIVALS_LIMIT = 20`
- Order: company filter → Quiet priorities → newest-first
  (`compareDailyOperationsEventsNewestFirst`) → `slice(0, 20)`
- Does **not** call `fanOutDailyOperationsEvents`
- `lane` is accepted and ignored so `?lane=` cannot hide or
  lane-filter Arrivals

Helpers next to it:

- `newlyArrivedDailyOperationsEventIds(previousIds, nextIds)`
- `scheduleArrivalHighlightClear(ids, onClear, delayMs?)`
- `DAILY_OPERATIONS_ARRIVAL_HIGHLIGHT_MS = 1500`

## Highlight keying

Arrivals tracks seen `event_id`s from the **unfiltered** board
`events` list (see Review fix). Empty first paint does not seed.
First non-empty list hydrates the seen set and does not highlight.
After seed, only never-seen ids highlight and may get **Just now**.
The card receives `highlight` (1.5s slide-in + `bg-amber-50` /
trust-blue ring) and optional `justNow`. Clears are per-`event_id`
(`schedulePerIdArrivalHighlightClear`), not the shell’s 2s
`flashedTiles` session-delta timer. Existing cards keep order and
shift down.

## EventSource count

Source-scan: `daily-shell.tsx` has exactly one `new EventSource` and
it uses `DAILY_OPERATIONS_LIVE_PATH`. `arrivals-stream.tsx` has zero
`EventSource`. Arrivals reads `board.events`. Live Events
(`live-webhooks.tsx`) was not touched.

## 21st.dev

Searched MCP `user-21st` / `search` for
`activity arrivals live strip timeline feed compact`. Hits were full
activity feeds, timelines, and stacked cards (Chrono Board, Activity
Feed, Live Feed, Timeline, Activity List, Stacked Activity Cards).
None fit a compact steel / trust-blue / navy strip that sits between
the mix and the category panels without inventing a second drawer,
socket, or API. **Not used.** Reused `Card` + existing Owner tokens,
same as Origins / Source Company.

## Test commands and results

From `vantage-admin`:

```
pnpm test && pnpm typecheck && pnpm lint
```

| Command | Result |
| --- | --- |
| `pnpm test` | **556 pass / 0 fail** after review fix (was 552; +4
  seed / hydrate / filter / per-id timer tests) |
| `pnpm typecheck` | **pass** (`tsc --noEmit`, no errors) |
| `pnpm lint` | Repo-wide still fails on **pre-existing**
  `react-hooks/set-state-in-effect` (including `daily-shell.tsx` lines
  that already merged the events query). Arrivals-touched files lint
  clean: `arrivals-stream.tsx`, `event-card.tsx`, `daily-copy.ts`,
  `dailyOperationsBoard.ts`, and the new/updated tests. |

Focused Arrivals coverage:

- Cross-lane newest-20: Cancellation at ~15th newest stays in the
  slice; naive first-20-of-Granot-only omits it
- Quiet hides `granot.priority_updated` only; `dailyOperationsPanelCount`
  unchanged (183 Granot / 1 Cancellation)
- `?company=` filters Arrivals; passing `lane` does not
- Copy: band **Arrivals**, empty **Nothing has arrived yet today.**,
  **Just now**; `doesNotMatch` `/Live facts/`
- Highlight helper + 1500ms fake timers; card markup when
  `highlight` is true
- Strip empty is one quiet line (`data-band="arrivals"`); one
  EventSource in the shell

## Coordinator seed fix (empty-day first fact)

The review-fix helper treated the **first non-empty** board list as
hydration. On an empty New York day the events query returns `[]`,
then the first live fact would be that first non-empty list and would
**not** highlight — the exact walk DOP-09 needs.

Change:

- `seedOrArriveDailyOperationsEventIds(seen, nextRawIds, { hydrated, seeded })`
- Until `hydrated`, ignore the list.
- First hydrated pass (including empty) seeds and does not highlight.
- After that, never-seen ids arrive. First live fact on an empty day
  highlights.
- Shell sets `eventsHydrated` in the same effect that applies
  `eventsQuery.data` (or `isFetched` on error) and passes
  `hydrated={eventsHydrated}` to Arrivals.

## What this implementation did not do

- Did not walk Owner `/daily` in the browser. Sign-in and a live or
  locally created insert are left for the next agent. DOP-08 recorded
  an empty New York day; this agent did not re-check today’s facts.
- Did not check §10 acceptance boxes.
- Did not write `DOP-09-completion.md`.
- Did not set the issue status to `complete`.
- Did not touch `live-webhooks.tsx`, main-server `src/`, Redis, Live
  Events BFF, Confirm, or the 24h/48h Daily View.
- Did not increment Leads on `granot.minted`.
- Did not add an animation package or a second EventSource.
- Did not commit, push, or deploy.

## Review fix

Coordinator review found two highlight bugs. **Not complete.**
No commit. No §10 boxes. No `DOP-09-completion.md`.

**What was wrong**

1. `ArrivalsStream` keyed highlight off the **filtered** Arrivals
   slice. First paint was often empty, so the effect seeded
   `previousIds` to `[]`. When today’s facts hydrated, every id
   looked newly arrived (highlight + **Just now**). Toggling
   `?company=` or Quiet changed the filtered slice and treated
   existing facts that entered it as inserts.
2. Effect cleanup `clearTimeout(timer)` on slice change cancelled
   the previous batch’s 1.5s clear without removing those ids. A
   second insert within 1.5s could leave the first card highlighted
   forever.

**What changed**

- Highlight now tracks seen `event_id`s from the incoming
  **unfiltered** `events` prop (the board list). Empty first paint
  does not seed. First non-empty list hydrates the seen set and
  does not highlight. After seed, only never-seen ids highlight.
- Per-`event_id` timers (`schedulePerIdArrivalHighlightClear`). A
  new insert does not cancel other ids’ 1.5s clears. Timers clear
  on unmount or when that same id is rescheduled.
- Helper `seedOrArriveDailyOperationsEventIds` plus tests: seed
  then insert, empty then hydrate, filter change is not an insert,
  second insert does not cancel the first clear. Existing 1500ms
  fake-timer test kept. Selector, copy, card props, EventSource
  count, and `daily-shell.tsx` placement unchanged.
