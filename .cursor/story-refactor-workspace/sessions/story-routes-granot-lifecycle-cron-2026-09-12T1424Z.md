# Session story-routes-granot-lifecycle-cron-2026-09-12T1424Z

- Date (UTC): 2026-09-12T1424Z
- Service / module: `routes` / `granot-lifecycle-cron.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 338
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `granot-lifecycle-cron.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-granot-lifecycle-cron.md` (`src/routes/granot-lifecycle-cron.routes.ts`)
- operations named: Drain due Granot Observation Receipts
- remaining in this service: none — `routes` is now visited

## Stock at end

- Visited / in-progress / unvisited: 43 / 0 / 5
- Current service / next module: `models` (unvisited) / enumerate `src/models/`

## Messages posted

- 2026-09-12T1424Z next

## Ideas parked

- none (shared `requireCronAuth` extract already parked; this desk accepts `x-cron-secret` and 500s a missing secret; factory injects `connect` / `drain` and never `emit`)

## Contradictions

- HTTP 200 omits Wave A `reason: "processing_disabled"` and `trigger`
- factory injects `drain` but not `emit`; emit throw after a finished scan 500s zeros
- missing secret 500 `"CRON_SECRET is not set"` vs Reporting 503 `"is not configured."`
- consumer rethrows after a failed letter; this tick 500s
