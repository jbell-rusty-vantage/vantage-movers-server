---
type: Service
title: Sales Intelligence webhook fan-out and job wiring (CSI-03)
description: Durable capture-projection job per stored RingCentral receipt, receipt watermark recovery, the capture worker, queue/cron registration and the all-direction subscription lifecycle with ownership guards.
tags: [sales-intelligence, ringcentral, durable-work]
status: draft
stale_after: 2026-12-17
resource: src/services/numberActivity/webhookFanout.ts
applies_to:
  - src/services/numberActivity/webhookFanout.ts
  - src/services/numberActivity/webhookRecovery.ts
  - src/services/numberActivity/webhookReceipts.ts
  - src/services/numberActivity/captureProjectionWorker.ts
  - src/services/numberActivity/jobDispatch.ts
  - src/services/ringcentral/webhook-subscription-lifecycle.ts
  - src/routes/sales-intelligence-cron.routes.ts
  - api/queues/sales-intelligence-consumer.ts
owners: [team:main-server]
sources:
  - id: specification
    resource: docs/call-sales-intelligence/03-server-pipeline-and-jobs.md
  - id: handoff
    resource: docs/call-sales-intelligence/workspace/evidence/csi-03/HANDOFF.md
  - id: review
    resource: docs/call-sales-intelligence/workspace/evidence/csi-03/INDEPENDENT-REVIEW.md
---

# Sales Intelligence webhook fan-out and job wiring

**Role:** connects the existing RingCentral webhook receipt store to [Number Activity capture](number-activity-capture.md) through durable jobs (03 §2.2, §11, §14). It never projects a call itself and never widens [Call Qualification](ringcentral-call-lead-qualification.md); the qualified-call evaluator, its flag, filters, scheduling and cursor are untouched.

**System of record:** `sales_intelligence_jobs` (stage `capture_projection`), `sales_intelligence_sync_state` scope `webhook_receipts` (recovery watermark and lease), `ringcentral_webhook_events[_test]` (read-only receipt evidence), `ringcentral_webhook_subscriptions` (ownership evidence for subscriptions this application created).

## Modules

| Module | Responsibility |
| --- | --- |
| `webhookFanout.ts` | `fanOutCaptureProjection` (route hook): flag check, skip non-telephony receipts, `ensureCaptureProjectionJob` in its own transaction awaited under a bounded acknowledgement budget (`SALES_INTELLIGENCE_FANOUT_ACK_TIMEOUT_MS`, default 2500 ms), then best-effort post-commit `publishCaptureProjectionWakeup` (`{ job_id }` on the env-scoped topic). Dedupe key `csi:capture_projection:receipt:<uuid>` or `...:receipt_id:<_id>`; `input_refs=[receipt _id]`. |
| `webhookRecovery.ts` | `runReceiptWatermarkRecovery`: fenced lease, scans telephony receipts from `watermark − overlap` to `now − settle`, pages forward from the last processed receipt, ensures a job per receipt, quarantines deterministic failures (`IDEMPOTENCY_CONFLICT`, `INVALID_INPUT`), publishes wake-ups for created jobs, writes a monotone watermark in one fenced state write. |
| `webhookReceipts.ts` | Read-only access to the receipt store: `findWebhookReceiptById`, `listWebhookReceiptsBetween` (telephony receipts only). |
| `captureProjectionWorker.ts` | `runCaptureProjectionJob(jobId?)`: `claimCsiJob(owner, id, ttl, "capture_projection")`, load receipt by `input_refs[0]`, `normalizeWebhookPartyObservations`, `observeRingCentralWebhookEvents` with `request_id = job id`, then `completeCsiJob` with a bounded `result` and a `job` audit row, or `failCsiJob`. `drainCaptureProjectionJobs(max, deps, { deadlineMs })` for cron recovery. |
| `jobDispatch.ts` | `dispatchCsiWakeup({ job_id })`: strict payload, stage read from Mongo, `defaultStageHandlers` registry; stages without a consumer are left pending (never claimed). CSI-04 registers `rebuild` here. |
| `ringcentral/webhook-subscription-lifecycle.ts` | Mode `"all"` builder (`/restapi/v1.0/account/~/telephony/sessions`, no direction filter, no `withRecordings`), `planAllDirectionSubscription` (read-only), `ensure/renew/repair` with explicit ownership checks, `validationEchoHeaders`. Ownership evidence must be durable in Mongo; the module fails closed without it. |
| `routes/sales-intelligence-cron.routes.ts` | `/api/cron/sales-intelligence-call-log-reconcile` (`runCallLogReconcileOnce`, `CAPTURE_CALL_LOG`), `/api/cron/sales-intelligence-job-recovery` (receipt recovery + capture drain under `CAPTURE_WEBHOOK`; `extraRecovery` steps under their own flags), `/api/cron/sales-intelligence-directory-sync` (CSI-04). Existing `CRON_SECRET` bearer / `x-cron-secret` auth. |
| `api/queues/sales-intelligence-consumer.ts` | Vercel Queue consumer registered in `vercel.json` (`sales-intelligence-events*`), not mounted on Express; calls `dispatchCsiWakeup`. |

## Invariants

- The route acknowledges only after the receipt is durable and the job transaction has either committed or exceeded its bounded budget. An enqueue failure or timeout is reported (`enqueue_failed` / `enqueue_timeout`), never thrown at the provider; the receipt is durable and recovery closes the gap. No unawaited in-process projection exists.
- Fan-out is independent of `RINGCENTRAL_WEBHOOK_ENABLED`; the qualification path runs or not exactly as before. Fan-out is off unless `SALES_INTELLIGENCE_CAPTURE_WEBHOOK=true`.
- A duplicate provider `uuid` yields one receipt and one job. Receipts without a `telephonySessionId` (validation handshakes) produce no job, in the route and in recovery alike.
- Queue payload is exactly `{ job_id }`; stage and provider evidence come from Mongo. Duplicate delivery hits the claim fence; a wake-up for a stage without a registered consumer leaves the job pending with `attempts` untouched.
- Recovery watermark is monotone and pages forward within a run; a run that exhausts `maxPages` resumes from the last processed receipt. Recovery also backfills receipts stored while the flag was off (inside the lookback), which is intentional and idempotent.
- Worker retry classification: `persist_failed` / `retry_exhausted` retry (`transient`); `account_unresolved`, `account_mismatch`, `identity_missing`, `projection_failed` complete the job with the code visible in `job.result` and the `invalidation.kind: "job"` audit row (`capture_projection.completed`); an unloadable receipt is `schema_invalid` with the receipt id on the row. Projection commits before completion; that is safe because CSI-02 semantic replay is a no-op and downstream jobs are dedupe-keyed. An expired lease cannot complete or fail after a successor claims.
- Subscription lifecycle never renews, deletes or replaces a subscription whose id is not in this application's stored metadata; foreign same-address subscriptions are reported as warnings. Repair (delete + recreate) is reachable only from an explicit `Blacklisted`/`Suspended` status; unknown statuses are reported and left alone; unknown expiry is treated as renew-due. Create/renew that cannot record ownership surfaces `SubscriptionOwnershipRecordError` with the id.
- No production subscription is created, renewed or deleted by tests or by the runtime; the ops command `scripts/ringcentral/sales-intelligence-subscription.ts` is read-only by default and requires `--confirm-production-subscription` to mutate.

## Configuration

`SALES_INTELLIGENCE_CAPTURE_WEBHOOK` (fan-out, recovery, capture drain), `SALES_INTELLIGENCE_CAPTURE_CALL_LOG` (reconcile cron), `SALES_INTELLIGENCE_DEPLOYMENT_ID` (required by the job dataset once capture is on), `SALES_INTELLIGENCE_QUEUE_TOPIC` (default `sales-intelligence-events` in production, `-dev` elsewhere), `SALES_INTELLIGENCE_FANOUT_ACK_TIMEOUT_MS` (2500), `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_LOOKBACK_MINUTES` (720), `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_OVERLAP_MINUTES` (5), `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_BATCH` (200), `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_MAX_PAGES` (10), `CRON_SECRET`. Publishing happens only on a Vercel function runtime outside tests.

## Tests

- `src/services/numberActivity/fanout.test.ts`, `src/routes/sales-intelligence-cron.routes.test.ts`, `api/queues/sales-intelligence-consumer.test.ts`, `src/services/ringcentral/webhook-subscription-lifecycle.test.ts` — fakes; registration asserted by reading `vercel.json` and `app.ts`.
- `pnpm test:csi:fanout:replica` — isolated replica proof through the real route, worker, recovery, dispatcher and cron router with synthetic payloads. Not a live provider capability proof.
