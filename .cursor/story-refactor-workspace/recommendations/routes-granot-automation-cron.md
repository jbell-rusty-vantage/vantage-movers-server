# Recover Granot automation and dispatch scheduled Estimates and Pool work

- Status: recommended; source-verified 2026-10-29.
- Target: `src/routes/granot-automation-cron.routes.ts`
- Domain: `docs/knowledge/services/granot-http-collector.md`, `docs/knowledge/services/sales-outreach-desk.md`.
- Evidence: `src/app.ts`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`, `src/services/granotHttpCollector/poolCron.ts`.

## Two separate endpoint stories

ALL `/api/cron/granot-automation-heartbeat` calls `recoverGranotRuns`. It returns 503 “Granot recovery could not publish a worker wakeup.” only when recoverable work exists and queue_published is false, including local hosts. With no recoverable work, return ordinary 200; do not claim every unpublished/local heartbeat fails. Success spreads the recovery bag. Catch returns fixed 500 “Granot recovery heartbeat failed.” The recovery endpoint never calls the worker or claims its account lease.

ALL `/api/cron/granot-estimates-in-process` evaluates `estimatesCronDecision(now)` and `poolCronDecision(now)`. If neither runs it returns 200 skipped with the estimates decision reason. It loads scheduled windows when needed, inspects Outreach configuration and requires active configuration plus Pool policy enablement for Pool lanes. An all-lane schedule may also refresh Pool; discovery uses `poolDiscoveryDateChunks`, while refresh can depend on that all-lane coverage. Preserve slot keys, manifests and dependency ordering in the deeper workflow.

The route dispatches each created slot and returns run_id/run_ids/date_window/pool_enabled. No created runs returns 200 skipped pool_not_enabled. When no dispatched run has queue_published, it calls `runGranotWorker` inline and includes local_worker; otherwise it returns queue_published true. That local execution belongs to this scheduled endpoint and is distinct from the recovery heartbeat. Catch uses fixed 500 “Estimates in Process cron failed.” Do not remove this branch based on September's “cron never drains” sentence.

## Authentication, actor and naming boundary

Both routes mount before v1 and require trimmed CRON_SECRET via Bearer or x-cron-secret; missing config is 500 “CRON_SECRET is not set”, wrong credential 401 “Unauthorized”. The route's timing-safe secret comparison is separate from Registry Owner HMAC. `estimatesCronActor` uses the designated system actor id and origin vantage_admin; it does not impersonate an Owner or authorize an extension apply.

A useful cleanup names recovery, schedule dispatch and local worker fallback separately while preserving request/response shapes. Keep schedule decisions, manifests, durable dispatch, Pool policy and worker account lease in their existing modules. Do not flatten this into one generic cron drain or move lifecycle/apply policy into HTTP. Source inspection establishes these current branches; no HTTP/provider/runtime tests were run by this catalog review.
