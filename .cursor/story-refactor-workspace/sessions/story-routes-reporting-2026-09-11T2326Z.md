# Session story-routes-reporting-2026-09-11T2326Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `reporting.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 323 (through `routes-ingestion.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `reporting.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-reporting.md`
- operations named: after the secret, let the signed dashboard Owner see the allowed datasets, point reports at a Drive destination, preview fifty sample rows, freeze an immutable revision, clone or archive a definition, estimate then confirm a manual run, show the redacted runs, then request cancellation — never walk the worker here, never write RAW cells here, never recover on the cron secret, never leak row payloads or execution destinations
- remaining in this service: `granot-webhook.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `granot-webhook.routes.ts`

## Messages posted

- 2026-09-11T2326Z next

## Ideas parked

- This desk remounts `requireApiSecret` because `app.ts` mounts it after public v1 and leftover ingestion as a third `/api/v1` router. Granot automation remounts because it sits before v1. Tariff / Owner apply do not remount.
- GET asks `requireRegistryReadActor` (Admin may read). Writes ask Owner HMAC. Extension Owner Bearer without HMAC is not enough on writes.
- Google kill switch is only on destination writes and new runs. Preview / freeze / clone / archive-definition / cancel do not check it. Cancel staying open when writes are off is load-bearing.
- `prepareManualRun` is two owner operations on one URL. Estimate is 200; queued is 202. Confirm wakeup lives in Wave A.
- Definition preview `:id` is a gate, not the frozen revision.
- Clone 404 lies when the revision is missing. Clone does not persist and does not audit.
- GET definition detail hides preview snapshots and still returns revision `destination_snapshot`.
- Destination `NotFoundError` becomes 500. Definition miss is in-file 404.
- `ReportingError` echoes `error.message`. Unexpected errors are `"Reporting request failed"`.
- Cancel discards wakeup and always 200. Heartbeat unpublished is 503.
- Host rule lists `POST .../archive`; this file only has DELETE.
- `serializeReportingRouteError` / `safeReportingRunForRead` exported so `reporting.test.ts` can unit the hide. No HMAC HTTP on this desk.
- No factory. `objectId` throws typed `InvalidReportingObjectIdError` → 400 (unlike leftover ingestion bare Error → 500).
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- Destination `NotFoundError` → 500 vs definition miss 404
- `ReportingError` echoes message vs leftover ingestion hide
- Kill switch on `/run` and destination writes only; cancel stays open
- Cancel wakeup discard 200 vs heartbeat unpublished 503
- Host rule POST archive vs file DELETE only
- GET definition revision snapshot vs GET run destination hide
- GET read-actor (Admin) vs Granot automation GET Owner
