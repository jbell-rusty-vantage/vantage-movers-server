# Ringcentral Call Log Sync

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/call-log-sync.service.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `runRingCentralCallLogSync`, `resolveWindowStart`.
- Current exported types: `RingCentralCallLogSyncSummary`, `RingCentralCallLogSyncDependencies`.
- Direct import sites found: `src/routes/ringcentral-cron.routes.test.ts`, `src/routes/ringcentral-cron.routes.ts`, `src/services/ringcentral/call-log-sync-lease.replica.test.ts`, `src/services/ringcentral/call-log-sync.service.test.ts`, `scripts/dev_ops/ringcentral/ringcentral-call-log-sync-run.ts`.
- Related tests: `src/services/ringcentral/call-log-sync.service.test.ts`

## Current operation and naming boundary

Claim the account lease before loading routes or calling RingCentral. Load one route snapshot, collect all provider pages (250/page, at most 20), then sort by startTime oldest first before vetting/ingesting so a callback can see the earlier call in the same run. The rolling 12-hour floor remains even with a recent cursor; default cursor overlap is 15 minutes. Renew while work remains and stop on lease loss. Any page, route, ingest, ledger or fenced terminal-write failure leaves the cursor unchanged; committed records are safe to rescan. Preserve the safe summary/error-code vocabulary and runtime/adoption/conflict/throttle counters. Focus parity on oldest-first duplicates, full-success cursor advance, pagination failure before ingest and stale-owner no-writes in the unit/replica suites.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
