---
type: Service
title: Sales Intelligence webhook fan-out and job wiring (CSI-03)
description: Durable capture-projection job per stored RingCentral receipt, receipt watermark recovery, the capture worker, queue/cron registration, the all-direction subscription lifecycle with ownership guards and its daily renewal cron, and the CC-08 targeted Call Log refresh after hang-up.
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
  - src/services/numberActivity/callLogRefresh.ts
  - src/services/numberActivity/webhookSubscriptionCron.ts
  - src/services/ringcentral/webhook-subscription-lifecycle.ts
  - ops/ringcentral/sales-intelligence-subscription.ts
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
| `captureProjectionWorker.ts` | `runCaptureProjectionJob(jobId?)`: `claimCsiJob(owner, id, ttl, "capture_projection")`, load receipt by `input_refs[0]`, `normalizeWebhookPartyObservations`, `observeRingCentralWebhookEvents` with `request_id = job id`, then `completeCsiJob` with a bounded `result` and a `job` audit row, or `failCsiJob`. CC-08: sessions this delivery hung up are listed in `result.call_log_refresh`, and the completion transaction enqueues one `call_log_refresh` job for each. `drainCaptureProjectionJobs(max, deps, { deadlineMs })` for cron recovery. |
| `callLogRefresh.ts` (CC-08) | Hang-up detection (`sessionsNeedingRefresh`: the delivery carries a terminal party status for the session **and** every account party of the stored session has `terminal_at`, the rule `fromWebhookParties` uses for `terminal`), `enqueueCallLogRefreshJob` (dedupe `csi:call_log_refresh:session:<telephony_session_id>:1`, subject `telephony_session:<id>`, `input_refs=[interaction _id]`, due `now + 90 s`, delayed queue wake-up), `fetchCallLogRecordsBySession` (`GET /account/~/call-log?telephonySessionId=…&view=Detailed&dateFrom=<started_at − 1 h>`), `runCallLogRefreshJob` / `drainCallLogRefreshJobs`. |
| `webhookSubscriptionCron.ts` (CC-08) | `runWebhookSubscriptionMaintenance`: plan + apply for the all-direction subscription with a 7-day renew window; creates only under `SALES_INTELLIGENCE_WEBHOOK_AUTO_CREATE=true`; operational events `sales_intelligence.webhook_subscription.{created,renewed,repaired,foreign_warning,missing,failed}`. |
| `jobDispatch.ts` | `dispatchCsiWakeup({ job_id })`: strict payload, stage read from Mongo, `defaultStageHandlers` registry; stages without a consumer are left pending (never claimed). CSI-04 registers `rebuild` here. |
| `ringcentral/webhook-subscription-lifecycle.ts` | Mode `"all"` builder (`/restapi/v1.0/account/~/telephony/sessions`, no direction filter, no `withRecordings`), `planAllDirectionSubscription` (read-only), `ensure/renew/repair` with explicit ownership checks, `validationEchoHeaders`, `resolveAllDirectionWebhookAddress`. Requests `expiresIn = 630,720,000 s` (20 years, the WebHook maximum) and treats under 7 days left as renew-due. Ownership evidence must be durable in Mongo; the module fails closed without it. |
| `routes/sales-intelligence-cron.routes.ts` | `/api/cron/sales-intelligence-call-log-reconcile` (`runCallLogReconcileOnce`, `CAPTURE_CALL_LOG`), `/api/cron/sales-intelligence-job-recovery` (receipt recovery + capture drain under `CAPTURE_WEBHOOK`; `extraRecovery` steps under their own flags, including the CC-08 `call_log_refresh` drain under `CAPTURE_WEBHOOK`), `/api/cron/sales-intelligence-directory-sync` (CSI-04), `/api/cron/sales-intelligence-webhook-subscription` (CC-08, daily `15 6 * * *`, `CAPTURE_WEBHOOK`). Existing `CRON_SECRET` bearer / `x-cron-secret` auth. |
| `api/queues/sales-intelligence-consumer.ts` | Vercel Queue consumer registered in `vercel.json` (`sales-intelligence-events*`), not mounted on Express; calls `dispatchCsiWakeup`. |

## Invariants

- The route acknowledges only after the receipt is durable and the job transaction has either committed or exceeded its bounded budget. An enqueue failure or timeout is reported (`enqueue_failed` / `enqueue_timeout`), never thrown at the provider; the receipt is durable and recovery closes the gap. No unawaited in-process projection exists.
- Fan-out is independent of `RINGCENTRAL_WEBHOOK_ENABLED`; the qualification path runs or not exactly as before. Fan-out is off unless `SALES_INTELLIGENCE_CAPTURE_WEBHOOK=true`.
- A duplicate provider `uuid` yields one receipt and one job. Receipts without a `telephonySessionId` (validation handshakes) produce no job, in the route and in recovery alike.
- Queue payload is exactly `{ job_id }`; stage and provider evidence come from Mongo. Duplicate delivery hits the claim fence; a wake-up for a stage without a registered consumer leaves the job pending with `attempts` untouched.
- Recovery watermark is monotone and pages forward within a run; a run that exhausts `maxPages` resumes from the last processed receipt. Recovery also backfills receipts stored while the flag was off (inside the lookback), which is intentional and idempotent.
- Worker retry classification: `persist_failed` / `retry_exhausted` retry (`transient`); `account_unresolved`, `account_mismatch`, `identity_missing`, `projection_failed` complete the job with the code visible in `job.result` and the `invalidation.kind: "job"` audit row (`capture_projection.completed`); an unloadable receipt is `schema_invalid` with the receipt id on the row. Projection commits before completion; that is safe because CSI-02 semantic replay is a no-op and downstream jobs are dedupe-keyed. An expired lease cannot complete or fail after a successor claims.
- Subscription lifecycle never renews, deletes or replaces a subscription whose id is not in this application's stored metadata; foreign same-address subscriptions are reported as warnings. Repair (delete + recreate) is reachable only from an explicit `Blacklisted`/`Suspended` status; unknown statuses are reported and left alone; unknown expiry is treated as renew-due. Create/renew that cannot record ownership surfaces `SubscriptionOwnershipRecordError` with the id.
- Tests never create, renew or delete a production subscription. At runtime only the daily subscription cron mutates, and only an owned subscription (renew/repair); it creates one only with `SALES_INTELLIGENCE_WEBHOOK_AUTO_CREATE=true`. The ops command `ops/ringcentral/sales-intelligence-subscription.ts` is read-only by default and requires `--confirm-production-subscription` to mutate.
- CC-08: webhook projection never settles a row; only a Call Log record does (the refresh or the reconcile). A session gets at most one `call_log_refresh` (dedupe key `...:1`); a later hang-up delivery for the same session reuses it and never conflicts. The refresh applies each record with `source: "call_log_reconcile"` and `proof_ref: "call_log_refresh:<record id>"`, `request_id` = the job id. No record yet: retry at +2, +5, +15 min, then complete with `result.state = "not_published"` (the reconcile window covers it). A 429 is a `throttled` deferral (attempt not spent); other provider errors retry with the job backoff; `identity_missing` / `projection_failed` / `account_mismatch` complete with the code on the row.

## Configuration

`SALES_INTELLIGENCE_CAPTURE_WEBHOOK` (fan-out, recovery, capture drain, `call_log_refresh` drain, subscription cron), `SALES_INTELLIGENCE_WEBHOOK_AUTO_CREATE` (default off; lets the subscription cron create the subscription when none owned exists), `RINGCENTRAL_WEBHOOK_URL` (delivery address; a bare host gets `/api/webhooks/ringcentral`), `SALES_INTELLIGENCE_CAPTURE_CALL_LOG` (reconcile cron), `SALES_INTELLIGENCE_DEPLOYMENT_ID` (required by the job dataset once capture is on), `SALES_INTELLIGENCE_QUEUE_TOPIC` (default `sales-intelligence-events` in production, `-dev` elsewhere), `SALES_INTELLIGENCE_FANOUT_ACK_TIMEOUT_MS` (2500), `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_LOOKBACK_MINUTES` (720), `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_OVERLAP_MINUTES` (5), `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_BATCH` (200), `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_MAX_PAGES` (10), `CRON_SECRET`. Publishing happens only on a Vercel function runtime outside tests.

## Tests

- `src/services/numberActivity/fanout.test.ts`, `src/routes/sales-intelligence-cron.routes.test.ts`, `api/queues/sales-intelligence-consumer.test.ts`, `src/services/ringcentral/webhook-subscription-lifecycle.test.ts` — fakes; registration asserted by reading `vercel.json` and `app.ts`.
- `src/services/numberActivity/callLogRefresh.test.ts`, `src/services/numberActivity/webhookSubscriptionCron.test.ts` — CC-08 with fakes.
- `pnpm test:csi:fanout:replica` — isolated replica proof through the real route, worker, recovery, dispatcher and cron router with synthetic payloads, plus CC-08: one refresh per hang-up (none while a party is live), the refresh applying the fetched record to the same row, not-published retry then give-up, dispatcher registration, and the subscription cron with durable Mongo ownership (create/noop/renew/repair/foreign). Not a live provider capability proof.

## Runbook: turn webhook capture on in production (CC-08)

Run everything from `vantage-main-server` with the production `.env`. The Call Log reconcile keeps running either way; webhook capture only accelerates it.

1. **Deploy** a build that contains `callLogRefresh.ts` and the subscription cron. Both are inert while `SALES_INTELLIGENCE_CAPTURE_WEBHOOK` is off.
2. **Readiness (read-only):**
   ```sh
   RC_TOKEN_STORE=file node --env-file=.env --import tsx scripts/dev_ops/check-webhook-capture-readiness.ts
   ```
   Expect: the resolved address is `https://vantage-movers-main-server.vercel.app/api/webhooks/ringcentral`; the in-process handshake echoes `Validation-Token` on a JSON 200; the deployed GET returns `ready: true`; the plan is `create` with no warnings. `--post-validation` also POSTs the handshake to the deployed route. That stores one receipt row (`validationTokenPresent: true`, no job), so use it only when you want that proof.
3. **Decide the qualification path first.** When `RINGCENTRAL_WEBHOOK_ENABLED` is true (its default), the route runs Lead qualification on every delivery. With an all-direction subscription that turns on webhook-sourced qualified-call Lead ingestion and adds per-delivery Mongo work before the acknowledgement. Keep `RINGCENTRAL_WEBHOOK_ENABLED=false` in Vercel production unless the Owner wants webhook Lead ingestion. Fan-out does not depend on it.
4. **Vercel production env:** `SALES_INTELLIGENCE_CAPTURE_WEBHOOK=true`, `RINGCENTRAL_WEBHOOK_ENABLED=false` (see step 3). `SALES_INTELLIGENCE_DEPLOYMENT_ID` is already set. Leave `SALES_INTELLIGENCE_WEBHOOK_AUTO_CREATE` unset. Redeploy so the env takes effect.
5. **Create the subscription** (the one mutating step). Make sure `RINGCENTRAL_NGROK_WEBHOOK_URL` is not set in `.env`; it wins over `RINGCENTRAL_WEBHOOK_URL` for this command. Warm the function with a GET first: RingCentral validates the address with a POST during creation, and a cold start can miss its short timeout.
   ```sh
   curl -s https://vantage-movers-main-server.vercel.app/api/webhooks/ringcentral
   node --env-file=.env --import tsx ops/ringcentral/sales-intelligence-subscription.ts --action plan
   node --env-file=.env --import tsx ops/ringcentral/sales-intelligence-subscription.ts --action ensure --confirm-production-subscription
   node --env-file=.env --import tsx ops/ringcentral/sales-intelligence-subscription.ts --action list
   ```
   `ensure` creates the all-direction `/telephony/sessions` WebHook subscription with `expiresIn` 630,720,000 s and records ownership in `ringcentral_webhook_subscriptions`. `list` must show it `OWNED` and `Active`. If creation fails validation (`SUB-521`/`SUB-525`), check the deployed route, warm it with a GET and re-run.
6. **Renewal** needs nothing more. `/api/cron/sales-intelligence-webhook-subscription` runs daily at 06:15 UTC. It renews the owned subscription when under 7 days remain, repairs it if RingCentral reports `Blacklisted`/`Suspended`, and warns about foreign same-address subscriptions (`sales_intelligence.webhook_subscription.*` operational events). Manual run: `curl -H "Authorization: Bearer $CRON_SECRET" https://vantage-movers-main-server.vercel.app/api/cron/sales-intelligence-webhook-subscription`.
7. **Verify** (read-only, production Mongo):
   ```js
   db.ringcentral_webhook_subscriptions.find({}, { subscriptionId: 1, status: 1, expirationTime: 1 })
   db.ringcentral_webhook_events.find({}, { receivedAt: 1, telephonySessionId: 1 }).sort({ receivedAt: -1 }).limit(5)
   db.sales_intelligence_jobs.aggregate([
     { $match: { deployment: "csi-production", stage: { $in: ["capture_projection", "call_log_refresh"] }, next_attempt_at: { $gte: new Date(Date.now() - 3600e3) } } },
     { $group: { _id: { stage: "$stage", status: "$status", state: "$result.state" }, n: { $sum: 1 } } }])
   db.call_interactions.countDocuments({ sources: "webhook", started_at: { $gte: new Date(Date.now() - 3600e3) } })
   ```
   Expect receipts during business hours, `capture_projection` jobs `completed`, `call_log_refresh` jobs `completed` with `result.state: "applied"` (a few `not_published` are normal), and interactions carrying both `webhook` and `call_log_reconcile` sources. Target (spec §8 step 8): `call_log_refresh` p95 under 3 minutes after hang-up. Re-running the readiness check should now show plan `noop`.
8. **Turn off:** set `SALES_INTELLIGENCE_CAPTURE_WEBHOOK=false`. Fan-out, the refresh drain and the subscription cron all stop; receipts are still stored. The cron never deletes a subscription except to repair it, so stopping deliveries means deleting the owned subscription deliberately.
