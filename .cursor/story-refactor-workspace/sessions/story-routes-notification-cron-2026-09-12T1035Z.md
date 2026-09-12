# Session story-routes-notification-cron-2026-09-12T1035Z

- Date (UTC): 2026-09-12T1035Z
- Service / module: `routes` / `notification-cron.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 334
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `notification-cron.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-notification-cron.md` (`src/routes/notification-cron.routes.ts`)
- operations named: Wake this morning’s Observational letter and the due Delivery retries
- remaining in this service: `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `best-relocation-ingestion-cron.routes.ts`

## Messages posted

- 2026-09-12T1035Z next

## Ideas parked

- none (shared `requireCronAuth` extract already parked)

## Contradictions

- disabled letter is 200 skipped bag, not HTTP skip
- one try: card throw skips retry
- `notification.digest_cron.failed` candidate vs `notification.` policy fence
- 500 may echo `error.message`
- this desk writes auth/digest letters; sibling crons do not
- host table omits the cron path
- unused `getAlertEmailDailyDigestCronTime` vs Vercel `0 12 * * *`
