# Session story-routes-sheet-sync-cron-2026-09-12T0718Z

- Date (UTC): 2026-09-12
- Service / module: `routes` / `sheet-sync-cron.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 331 (through `routes-booking-reconciliation-cron.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `sheet-sync-cron.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-sheet-sync-cron.md`
- operations named: after the cron secret proves this tick is ours, wake the Sheet Sync outbox drain if mode is queued — never hold the drain seat here, never publish a wake-up, never write a sheet row, never use the API secret
- remaining in this service: `lead-messaging-cron.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `lead-messaging-cron.routes.ts`

## Messages posted

- 2026-09-12T0718Z next

## Ideas parked

- Mode gate lives on the route, not in `runSheetSyncDrain` / consumer / Admin retry — leave both.
- Mode defaults to `legacy`; unknown folds to `legacy`; `queued` is opt-in.
- Held drain seat is `summary.skipped === true` with HTTP `skipped: false`, not `lease_held`.
- Handled `summary.ok === false` is still HTTP 200; only unexpected throw is 500.
- Route 500 echoes `error.message`; Call Log is generic; rematch has no catch.
- This desk never writes `sheet_sync.drain.failed` — Wave A drain already pages.
- No factory inject; non-queued skip is already testable via env.
- `requireCronAuth` is copied across sibling crons — do not extract in this rename.
- `router.all` is GET-and-POST; Vercel cron GETs.
- Host / hit-vantage-api omit `/api/cron/sheet-sync-drain` and list Admin retry.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- HTTP `skipped: false` wrapping drain `summary.skipped` / `summary.ok === false` vs Call Log `lease_held` 200 skip
- Mode gate on cron only vs drain / consumer / Admin retry
- 500 echoes `error.message` vs Call Log generic 500 vs rematch unhandled Express
- Host / hit-vantage-api omit `/api/cron/sheet-sync-drain`
