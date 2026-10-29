# Wake The Reporting Worker For This Run — Never Throw, Never Provider-Deduplicate, Mongo Still Owns The Lease — operational story

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/reporting/queue.ts`
- Domain evidence: `docs/knowledge/services/reporting.md`
- Current exported operations/constants: `publishReportingWakeup`, `REPORTING_DELIVERY_TOPIC`.
- Current exported types: types declared by the target.
- Direct import sites found (resolved relative imports): `src/routes/reporting-cron.routes.ts`, `src/routes/reporting.routes.ts`, `src/services/reporting/reporting.service.ts`.
- Related tests: Locate existing callers and targeted tests before changing this module.

## Current boundary and parity

Reporting definitions, immutable revisions, confirmed runs and Google delivery remain live. Preserve the Owner gate, destination checks, leased execution and cleanup boundaries. Live-test harnesses and their safety checks remain operational tooling. Reporting signals are structured logs; do not recreate the retired Operational Events persistence or notification pipeline.

The target and its direct callers are the authority for the exact implementation. Preserve the public signatures, persisted identifiers, transaction and side-effect ordering, error shapes, and idempotency while migrating callers. Keep any existing public name as an alias until its callers move. Do not introduce an additional service class or move policy into a route.

## Remaining cleanup

Read the exported operations above in their actual order and rename only an operation whose name obscures its current outcome or scope. Keep separate operations separate where their callers own different decisions; extract a private helper only when it gives a real decision a clearer name. Migrate the direct callers together, then cover the existing success, refusal, retry and side-effect boundaries relevant to this module with targeted tests. This is a behavior-preserving naming and module-shape pass, not authorization to add effects or change business policy.

## Specific implementation checks from the original brief

2. **Leftover consumer uses leftover `run_hint`. Sheet Sync’s consumer does not.** `reporting-consumer.ts` forwards leftover `run_hint` into leftover `runReportingDeliveryWorker`. Leftover `claimNextQueuedReportingRun` then filters `{ _id: runHint }` when the hint is present. Sheet Sync ignores `{ kind, reason, run_hint }` and scans due Mongo. Granot parses exactly `{ receipt_id }`. Do not drop leftover `run_hint` so “we match Lead Messaging,” and do not start switching leftover consumer on leftover `reason` so “the worker knows why.” A missing or already-leased hint still returns leftover `lease_busy_or_empty`; Mongo still owns the lease.

3. **First leftover confirm publishes. Leftover confirm replay does not.** Leftover `prepareManualRun` dynamic-imports this file only after leftover `persistedRunReplay(..., false)` for the newly inserted run. Concurrent consume, consumed-key replay, and existing-run replay return without leftover `wakeupPublished`. Do not start publishing on replay so “every confirm pokes,” and do not fail leftover confirm when leftover `wakeupPublished` is `false` so “the 202 is honest.” Knowledge already says publish `false` does not delete the run.

6. **Hosted Vercel heartbeat treats unpublished as `503`.** When leftover `published` is `false` and `VERCEL === "1"`, leftover heartbeat returns `503` “Reporting recovery wakeup could not be published.” Local unpublished is `{ ok: true, woke: true, published: false }`. Leftover confirm and leftover cancel never 503 on unpublished. Do not make leftover confirm wait on leftover `true` so “the owner sees a real queue,” and do not drop leftover heartbeat `503` so “every publisher is best-effort.”

7. **The error letter says recovery. The reason is `cron`.** Leftover heartbeat `503` names “recovery wakeup.” Leftover reason union includes leftover `recovery` and leftover reporting never sends it. Do not rename leftover heartbeat to leftover `recovery` so “the letter wins,” and do not add a leftover `recovery` publisher from leftover health-scan so “the unused reason looks live.”

8. **Leftover `schedule` / `retry` / `recovery` are unused here.** They live on leftover `DurableWorkWakeup` because leftover ingestion uses them. Do not delete them so “the reporting union is honest,” and do not start leftover scheduled-report publish from this file so “the reason exists.” Leave them visible.

9. **The publish gate is two env reads, not leftover `reporting.ts`.** Sheet Sync / Granot / Lead Messaging ask a sibling config helper (`VERCEL_REGION`, approved `VERCEL_ENV`, often leftover `TEST_MODE` / leftover test-runner). This file only asks `VERCEL === "1"` and leftover live hosted `NODE_ENV`. There is no leftover `-dev` topic and no leftover `REPORTING_QUEUE_TOPIC` override. Leftover `vercel.json` already wildcards `reporting-delivery-events*`. Do not add leftover `shouldPublishReportingQueue` so “every queue matches Sheet Sync,” do not honor leftover `SHEET_SYNC_QUEUE_LOCAL_PUBLISH`, and do not refuse leftover preview `VERCEL_ENV` in this rename.

11. **Leftover confirm dynamic-imports. Leftover cancel and leftover heartbeat import statically.** The after-persist **seam** stays outside leftover confirm’s Mongo session (`session.endSession()` already ran). Do not move leftover `send` inside leftover confirm’s transaction so “the poke rides the write,” and do not publish from leftover persist `catch` so “the heartbeat will find a run we never wrote.”
