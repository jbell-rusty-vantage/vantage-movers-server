# Session story-routes-reporting-cron-2026-09-12T1222Z

- Date (UTC): 2026-09-12T1222Z
- Service / module: `routes` / `reporting-cron.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 336
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `reporting-cron.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-reporting-cron.md` (`src/routes/reporting-cron.routes.ts`)
- operations named: Wake one stranded reporting delivery run; Scan reporting operational health; Walk the official leftover cleanup janitor; Walk the live-test harness-folder janitor
- remaining in this service: `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `granot-automation-cron.routes.ts`

## Messages posted

- 2026-09-12T1222Z next

## Ideas parked

- none (shared `requireCronAuth` extract already parked; this desk is Bearer-only + 503)

## Contradictions

- Bearer-only vs sibling `x-cron-secret`
- missing secret 503 `"CRON_SECRET is not configured."` vs sibling 500 `"is not set"` / CPL 500 `"is not configured"`
- unpublished wakeup 503 only when `VERCEL === "1"` vs Best Relocation always 503 vs Owner cancel discard
- delivery-off heartbeat only wakes cancel-requested stranded runs
- official cleanup opens Mongo via Drive OAuth, not `connectMongo` on the route
