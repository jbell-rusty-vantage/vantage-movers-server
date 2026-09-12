# Session story-routes-granot-automation-cron-2026-09-12T1323Z

- Date (UTC): 2026-09-12T1323Z
- Service / module: `routes` / `granot-automation-cron.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 337
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `granot-automation-cron.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-granot-automation-cron.md` (`src/routes/granot-automation-cron.routes.ts`)
- operations named: Recover leftover queued or expired-lease Granot automation work
- remaining in this service: `granot-lifecycle-cron.routes.ts`

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `granot-lifecycle-cron.routes.ts`

## Messages posted

- 2026-09-12T1323Z next

## Ideas parked

- none (shared `requireCronAuth` extract already parked; this desk accepts `x-cron-secret` and 500s a missing secret)

## Contradictions

- unpublished recovery 503 always (no `run_id`) vs Reporting Vercel-only 503 vs Owner recover 202
- `exists()` unsorted vs Reporting oldest stranded
- missing secret 500 `"CRON_SECRET is not set"` vs Reporting 503 `"is not configured."`
