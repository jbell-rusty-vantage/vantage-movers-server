Implements all 7 phases of docs/sheet-sync-queue-batching-architecture.md. Confirmed decisions: full feature in one pass; Vercel Queues enabled (real publisher via @vercel/queue); MongoDB Atlas (real multi-doc transactions); vantage-main-server only.

Key resolved decisions (from research)
Publisher: @vercel/queue send(topic, payload, { idempotencyKey }). New dependency to add.
Consumer: because the whole app is one Express function via rewrites: "/(._)" -> "/api", and a queue experimentalTriggers config makes a route private, the consumer MUST be a dedicated function file (api/queues/sheet-sync-consumer.ts) using QueueClient().handleNodeCallback, configured in vercel.json functions. It imports and calls the same drainer the cron uses.
The legacy boundary scheduleFullSheetSyncProcess(job) (in sheetSyncCoordinator.ts) is preserved as the single switch point between queued | legacy | disabled modes.
Tests use the built-in node runner (node --import tsx --test "api/\*\*/_.test.ts"), so new tests use node:test + node:assert; Google client is injected/mocked.
Target flow
API write (lead/booking/cancellation)
Mongo transaction: domain doc + SheetSyncJob
Commit
queue.send sheet-sync wakeup (idempotencyKey)
CRM submit (after commit, form leads)
api/queues consumer fn
cron /api/cron/sheet-sync-drain (20-30m)
drainer
Coalesce by coalescing_key + priority
Per spreadsheet/tab leases
Reserve quota tokens (Mongo bucket)
Batch by spreadsheetId+tab
Google Sheets batch API
Update sheet_sync + SheetSyncAttempt + job status
Phase 1 - Models and config
New models under api/models/ (PascalCase file, snake_case fields, explicit collection, timestamps: true, mongoose.models.X ?? model(...), indexes after schema):

SheetSyncJob.ts - fields per doc lines 156-176 (status, priority, resource, operation, entity_model, entity_id, coalescing_key, target_hints, tombstone, due_at, leased_until, lease_owner, attempts, last_error, last_error_at, created_by, run_id). Indexes: {status,due_at,priority,createdAt}, {coalescing_key,status}, {leased_until}, {entity_model,entity_id,status}. Start without the partial-unique coalescing index (coalesce in app code via findOneAndUpdate upsert) to avoid Mongo partial-unique edge cases; revisit if profiling needs it.
SheetSyncRun.ts - drainer run history (doc lines 188-200).
SheetSyncAttempt.ts - target/batch outcomes (doc lines 202-219).
SheetSyncLease.ts - keyed by scope (spreadsheet/tab), leased_until, owner; TTL-ish via leased_until checks.
SheetSyncQuotaBucket.ts - keyed by scope + op_class + minute window; atomic $inc reservations.
Config under api/config/domain/ (follow ringcentral-config.ts envFlag/envInt and cpl.ts snapshot patterns):

sheetSync.ts - getSheetSyncMode(): "queued"|"legacy"|"disabled" (Zod-validated read, default legacy until rollout flips it), queue topic resolver (env-scoped: sheet-sync-events prod, sheet-sync-events-dev otherwise), documented Google limit constants, env-overridable budgets (SHEET_SYNC_READS/WRITES_PER_MINUTE_BUDGET, project budgets, SHEET_SYNC_MAX_PAYLOAD_BYTES), drainer guardrails (max jobs/coalesced/rows/subrequests/run-duration/lease-duration/debounce/max-attempts), and a coalescingKey(job)/priorityFor(resource) helper. Re-export via api/config/domain.ts.
Tests: sheetSync.config.test.ts (mode parsing, budget parsing, topic scoping), coalescing.test.ts (keys + priority ordering), retry classification reuse.

Phase 2 - Queue adapter and scheduler boundary
Add dep @vercel/queue to package.json.
New api/services/sheetSync/sheetSyncQueue.service.ts: publishSheetSyncWakeup(reason, { idempotencyKey }). Production/preview -> send(topic, payload, ...); when NODE_ENV!=="production" and no queue creds OR explicit local fallback -> log no-op (cron/direct drain covers it). Small payload { kind, reason, run_hint }.
New api/services/sheetSync/sheetSyncOutbox.service.ts: enqueueSheetSyncJob(job, session) doing coalescing upsert (findOneAndUpdate on active coalescing_key, set latest operation/due_at/priority, delete tombstones supersede pending upserts) inside the caller's Mongo session.
Refactor sheetSyncCoordinator.ts scheduleFullSheetSyncProcess into a mode switch: legacy -> current waitUntil(runFullSheetSyncProcess); queued -> NO-OP here (job already written in the domain transaction) + caller publishes wakeup post-commit; disabled -> log + mark intent. Keep runFullSheetSyncProcess exported (used by legacy + reused internally).
Phase 3 - Targeted transactions
New api/db.ts helper withTransaction(fn) using mongoose.connection.startSession() + session.withTransaction (Atlas confirmed). Connection pool note: maxPoolSize: 5 is fine; sessions reuse pool.
Thread an optional session through the domain write paths so domain.save()/create() + enqueueSheetSyncJob() commit atomically, then publish wakeup + run CRM AFTER commit. Paths (from research):
formLead.service.ts: createFormLead (create + form-fill call-lead jobs + outbox in txn; CRM + publish after commit), updateFormLead, deleteFormLead (tombstone in txn).
callLead.service.ts: createCallLead, createRingCentralCallLead, updateCallLead, deleteCallLead.
duplicateLead.service.ts: markMatchingCallLeadsWithFormFill (share source-lead coalescing key).
bookedLead.service.ts: create/upsert/update/delete; referralBooking.service.ts.
cancelledLead.service.ts: create/update/delete (delete writes cancellation+booking+source tombstone/refresh jobs in txn).
callLeadEnrichment.service.ts: enrichment updates.
bookingMirror.service.ts refreshAttachedBookingFromLead accepts a session.
Legacy mode keeps working: when mode=legacy, services skip outbox writes and use the existing scheduleFullSheetSyncProcess waitUntil. Guard so transactions still wrap domain writes harmlessly.
Tests: transaction rollback leaves neither domain doc nor job; commit creates both; publish failure leaves recoverable pending job.
Phase 4 - Drainer and batcher
New api/services/sheetSync/drainer/:

runSheetSyncDrain(trigger) - creates SheetSyncRun; queries due pending|retrying jobs by priority+age; claims N with leases (findOneAndUpdate set leased_until/lease_owner); coalesces by coalescing_key; resolves each to target ops by reloading Mongo (reuse sheetSyncSourceLookup.ts projections) or tombstone data; groups by spreadsheetId+tab.
quotaLimiter.ts - reserve read/write tokens against SheetSyncQuotaBucket per minute window (atomic $inc with cap); defer (set job retrying + due_at) when exhausted; honor Retry-After.
tabRowMap.ts - one spreadsheets.values.batchGet per tab to build Mongo-ID -> row map only when row numbers missing/stale.
batchWriter.ts - spreadsheets.values.batchUpdate (known-row updates), append (multi-row inserts), spreadsheets.batchUpdate deleteDimension (descending row order). Split by SHEET_SYNC_MAX_PAYLOAD_BYTES and max subrequests.
On outcomes: update each doc's sheet_sync via existing mergeSheetSyncEntries, write SheetSyncAttempt rows, mark jobs synced|retrying|failed|partial, release leases, finalize run summary.
Reuse withSheetsRetry 1 for short transient errors only; durable backoff lives in job state.
Inject getSheetsClient for tests; add drainer tests with mocked Sheets client (coalescing, batching, quota deferral, partial failure).
Phase 5 - Delete tombstones
In queued mode, replace inline delete\*FromSheets (in formLead/callLead/bookedLead/cancelledLead deletes) with tombstone jobs created in the same txn, capturing prior sheet_sync entries + target hints + linked ids (doc lines 342-368).
Drainer delete handler: group by spreadsheet/tab, prefer known row numbers, validate Mongo ID, build tab map fallback, delete descending. Booking/cancellation chains refresh remaining rows.
Legacy mode keeps inline deletes. Tests: descending deletes + stale row-number fallback.
Phase 6 - Admin and cron
Consumer function: api/queues/sheet-sync-consumer.ts (dedicated Vercel function, NOT mounted on Express) -> QueueClient().handleNodeCallback(async () => runSheetSyncDrain("queue")).
Cron route: new api/routes/sheet-sync-cron.routes.ts /api/cron/sheet-sync-drain guarded by requireCronAuth (CRON_SECRET, same pattern as ringcentral-cron.routes.ts); mount in api/index.ts.
Admin endpoints under /api/v1/admin/sheet-sync in v1.routes.ts (behind requireApiSecret, { ok, data } envelope): GET health, GET jobs, GET runs, GET runs/:id, POST retry. New api/services/admin/adminSheetSync.service.ts + Zod schemas in api/validation/v1/sheetSync.validation.ts (re-export from v1.validation.ts). Read-only + retry (re-queue failed jobs); no Heal.
vercel.json: add functions entry with experimentalTriggers: [{ type: "queue/v2beta", topic: "sheet-sync-events" }] for the consumer file, and a crons entry for /api/cron/sheet-sync-drain every 20-30m.
Tests: admin service methods + cron drainer invocation.
Phase 7 - Rollout and observability
Structured logs for publish, claim, coalesce, quota deferral, target success/failure, run summary.
Add inspection script under scripts/ (pending/failed jobs) and update the doc Status to implemented with an emergency legacy fallback runbook.
Keep SHEET_SYNC_MODE default legacy in code; production env flips to queued after deploy/verify.
Risks / call-outs
Queue consumer being a separate private function changes how local dev exercises the path; the @vercel/queue local dev mode + cron + direct-drain tests cover this. Will verify the rewrite/filesystem interaction during implementation.
Transactions require all participating writes to use the session; missing a write in a path = silent non-atomicity. Tests assert atomicity on representative paths.
Coalescing without a partial-unique index relies on app-level upsert; acceptable per doc lines 184-186.
