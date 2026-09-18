# Team handoff — CSI-03

- **Team / issue / date:** B / CSI-03 webhook fan-out and subscription lifecycle / September 17, 2026.
- **Agent and repo / branch / commit:** Fable (main implementer) with an independent Opus 5 code review ([INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md); Request Changes → all findings resolved → Approve); `vantage-main-server` `sales-intelligence`, baseline `1925c32` (CSI-02 review resolved, clean tree at claim). The CSI-03 patch is **uncommitted** and left for review together with CSI-04 (same patch; see the review's item-2 condition). No checkout reset, branch switch, commit or push. `vantage-admin` untouched.
- **Status:** ready for review. Implementation evidence is database-backed on the isolated replica with synthetic payloads and fakes; live provider capability (webhook delivery, subscriptions, queue delivery) is not claimed.

## Concrete behavior delivered

1. **Durable webhook fan-out (03 §2.2).** After the existing durable `captureRingCentralWebhookEvent`, when `SALES_INTELLIGENCE_CAPTURE_WEBHOOK=true`, the route awaits `fanOutCaptureProjection` which upserts one deduplicated `capture_projection` job per stored receipt (`dedupe_key csi:capture_projection:receipt:<uuid>`, or `...:receipt_id:<_id>` when the provider sent no uuid; `input_refs = [receipt _id]`; `subject_key webhook_receipt:<uuid|id>`) in its own transaction, under a bounded acknowledgement budget (default 2.5 s), independent of `RINGCENTRAL_WEBHOOK_ENABLED`. Publish of `{ job_id }` to the env-scoped Vercel Queue topic is post-commit and best-effort. The response carries `captureProjection` (`enqueued | existing | skipped(flag_off | receipt_not_durable | no_telephony_session) | enqueue_failed | enqueue_timeout`). Receipts without a telephony session (validation handshakes) produce no job anywhere.
2. **Receipt watermark recovery.** `runReceiptWatermarkRecovery` (sync-state scope `webhook_receipts`, fenced lease) scans telephony receipts from `watermark − overlap` to `now − settle`, pages forward on a `(receivedAt, _id)` keyset, ensures a job per receipt (exactly once through dedupe), publishes wake-ups for created jobs, quarantines deterministic failures, respects page and wall-clock budgets, and writes a **monotone** watermark in one fenced state write. It also backfills receipts stored while the flag was off (inside the 12 h lookback) — intentional and idempotent.
3. **Capture-projection worker.** `runCaptureProjectionJob` claims through `claimCsiJob(owner, id, ttl, "capture_projection")`, loads the receipt by `input_refs[0]` (never the queue payload), calls `normalizeWebhookPartyObservations(rawBody, receivedAt)` then `observeRingCentralWebhookEvents(observations, { request_id: jobId })`, and completes with a bounded `result` plus a `job`-kind audit row `capture_projection.completed`; retryable session codes (`persist_failed`, `retry_exhausted`) retry with the partial result on the row; deterministic ones (`account_unresolved`, `account_mismatch`, `identity_missing`, `projection_failed`) complete with the code visible in result, audit and an operational event; an unloadable receipt is `schema_invalid` with the receipt id on the row. `drainCaptureProjectionJobs(max, deps, { deadlineMs })` is the cron recovery path.
4. **Dispatch and registration.** `dispatchCsiWakeup({ job_id })` reads the stage from Mongo and routes through `defaultStageHandlers`; stages without a consumer are left pending. `api/queues/sales-intelligence-consumer.ts` (topic `sales-intelligence-events*`) and `src/routes/sales-intelligence-cron.routes.ts` (`/api/cron/sales-intelligence-call-log-reconcile` → `runCallLogReconcileOnce` under `CAPTURE_CALL_LOG`, `3-59/10 * * * *`; `/api/cron/sales-intelligence-job-recovery` → receipt recovery + capture drain under `CAPTURE_WEBHOOK`, `* * * * *`; `/api/cron/sales-intelligence-directory-sync` `20 5 * * *`, handler in CSI-04) are registered in `vercel.json` and mounted in `app.ts` before the v1 guard with the existing `CRON_SECRET` auth. Tests read `vercel.json` and `app.ts` to prove wiring.
5. **Subscription lifecycle (03 §2.1).** `buildRingCentralTelephonyEventFilters("all")` → `["/restapi/v1.0/account/~/telephony/sessions"]` (no direction filter, no `withRecordings`); inbound builders byte-for-byte unchanged. `webhook-subscription-lifecycle.ts` provides read-only `plan`, and `ensure/renew/repair` with explicit ownership checks against the stored subscription metadata: foreign subscriptions (including same-address ones) are reported and never renewed, deleted or replaced; repair only from `Blacklisted`/`Suspended`; unknown expiry is renew-due; unknown status is reported and left alone; ownership evidence must be durable in Mongo or the module fails closed and surfaces the created id. `validationEchoHeaders` states the echo rule the route already implements. Ops command `scripts/ringcentral/sales-intelligence-subscription.ts` is read-only by default (`plan`, `list`) and requires `--confirm-production-subscription` to mutate. **No production subscription was created, renewed, modified or deleted.**
6. **Boundaries.** Call Qualification (`ingestRingCentralQualifiedCall`, evaluator, filters, `RINGCENTRAL_WEBHOOK_FILTER_MODE`, `call-log-sync*`, `ringcentral_call_log_sync_state`) unchanged; qualification suites re-run. `numberActivity` import boundary test still passes (the new read dependency on `ringcentral/webhook-capture` is the receipt store, not a qualification service). No recording access, STT, LLM or Redis. All flags default off.

## Files owned and changed

Added: `src/services/numberActivity/{webhookReceipts,webhookFanout,webhookRecovery,captureProjectionWorker,jobDispatch}.ts`, `src/services/numberActivity/fanout.test.ts`, `src/services/ringcentral/webhook-subscription-lifecycle.ts` + `.test.ts`, `src/routes/sales-intelligence-cron.routes.ts` + `.test.ts`, `api/queues/sales-intelligence-consumer.ts` + `.test.ts`, `scripts/ringcentral/sales-intelligence-subscription.ts`, `scripts/test-csi-fanout.ts`, `scripts/test-csi-fanout.replica.test.ts`, `docs/knowledge/services/sales-intelligence-webhook-fanout.md`, `docs/call-sales-intelligence/workspace/evidence/csi-03/*`.

Shared files touched (additive, recorded in CONTRACTS): `src/routes/ringcentral-webhook.routes.ts` (fan-out call and response field; qualification branch unchanged), `src/services/ringcentral/webhook-capture.ts` (`receiptId` in the capture result; exported `ensureRingCentralWebhookEventIndexes`; one additional partial index for the recovery scan), `src/services/ringcentral/webhook-subscriptions.ts` (mode `"all"`; `listStoredRingCentralWebhookSubscriptionIds`, `markStoredRingCentralWebhookSubscriptionStatus`), `src/services/salesIntelligence/jobs.ts` (optional `stage` on `claimCsiJob`; `{ result }` option and `runValidators` on `completeCsiJob`/`failCsiJob`), `src/models/salesIntelligence/infrastructure.ts` (job `result`; audit kind `job`), `src/services/salesIntelligence/transactions.ts` (audit kind `job`), `src/app.ts`, `vercel.json`, `package.json` (`test:csi:fanout:replica`), `docs/index.md`, `docs/knowledge/services/number-activity-capture.md` (wiring line), CONTRACTS/LEDGER.

Not touched: Call Qualification services, `call-log-sync*.ts`, evaluator, filters, `ringcentral_call_log_sync_state`, `scripts/dev_ops/**` (gitignored local ops scripts unchanged), Admin, production subscriptions.

## Contract/version changes and consumers notified

`csi-fanout-v1` published in [CONTRACTS.md](../../CONTRACTS.md#csi-03-concrete-imports-server-relative-september-17): stage-handler and `extraRecovery` registration for CSI-04/C/CSI-11, `result`/`job` audit shape, `FanoutResult` states, recovery summary, subscription lifecycle exports, env knobs. CSI-01 additive corrections: `claimCsiJob` stage filter, `result` options/field, audit kind `job` — CSI-01 replica 15/15 unchanged. Qualification-owned additive edits: `receiptId`, `"all"` mode, index export. This is a written handoff; no messages were sent.

## Tests/checks actually run

See [CHECKS.md](CHECKS.md): typecheck exit 0; focused suite 95/95 (27 CSI-03 unit tests); CSI-03 replica 11/11; CSI-02 replica 12/12; CSI-01 replica 15/15; qualification suites 102 pass / 0 fail / 3 pre-existing skips; `git diff --check` clean.

## Race/idempotency/failure cases verified

Database-backed: duplicate uuid → one receipt/one job; concurrent workers on one job (one completed, one not claimable); expired lease holder fenced out of complete and fail after a successor; concurrent recoveries elect one lease holder; enqueue failure → recovery closes the gap exactly once; watermark monotone under a clustered-overlap stream, keyset paging through a same-millisecond cluster, quarantine of a deterministic conflict; replay on a completed job not claimable; retryable per-session failure retried then recovered by the same handler; foreign-stage wake-up leaves the job untouched; flag matrix; handshake bodies create no job. Fakes: ack timeout, publish failure, ownership refusals on renew/repair/create, unknown-status noop, unknown-expiry renew, cron auth/flag/lease mapping.

## Known gaps or capability blockers

- **Not live-verified:** RingCentral webhook delivery of account-wide telephony sessions, validation handshake on a real subscription, subscription create/renew/repair on the real account, Vercel Queue delivery/consumer invocation, production cron invocation. Creating the production all-direction subscription is a G6 Team F action via the ops command; it was not run.
- **Design note:** the capture-projection job completes after per-session projection commits (CSI-02 transactions). Accepted by the reviewer as safe because semantic replay is a no-op and downstream jobs are dedupe-keyed; a crash between projection and completion re-runs to a no-op.
- **Recovery backfill:** receipts stored while `CAPTURE_WEBHOOK` was off but inside the 12 h lookback are projected once the flag turns on. Operators enabling capture should expect that burst; the drain deadline and minute cron absorb it.
- **Import boundary:** `numberActivity/webhookReceipts.ts` reads the receipt store through `ringcentral/webhook-capture` (not in 03 §0's allow list, not in its forbidden list). It is a read of provider evidence, recorded here as a deliberate, additive dependency.
- **Deployment inputs:** `SALES_INTELLIGENCE_DEPLOYMENT_ID` must be configured wherever `CAPTURE_WEBHOOK` is on (job dataset identity); `CRON_SECRET` as today.

## Deployment actions performed

None. Flags remain off. Local Docker replica `csi01` reused for isolated tests only.

## Next dependency and exact entry point for the receiving team

- **CSI-04 (this session):** register the `rebuild` worker in `defaultStageHandlers` / the consumer's `deps.handlers`, add its drain as an `extraRecovery` step, and mount the `directory-sync` handler at `CSI_CRON_PATHS.directorySync`.
- **Team C (CSI-05/06), CSI-11:** register `attachment_refresh`, `outreach_ensure`, `recording_discovery` handlers the same way; claim with the stage filter. Until then their jobs stay pending.
- **Team E (Coverage):** `RecoverySummary`, `DrainSummary`, job `result` and the `job` audit rows are the health/backlog inputs; `sync_state` scope `webhook_receipts` carries the recovery watermark.
- **Team F (G6):** run `scripts/ringcentral/sales-intelligence-subscription.ts --action plan` first; `--action ensure --confirm-production-subscription` creates the owned all-direction subscription. Record the outcome as deployment evidence, not as a claim of this patch.

## Independent review

Opus 5 reviewer: first pass Request Changes (1 must-fix: watermark regression reproduced on the replica; 7 should-fix; 4 nits); all resolved with regression proofs; second pass Approve with an item-2 condition (directory-sync entry and handler in the same commit — satisfied by CSI-04 in this patch) and three non-blocking residuals (scan index, keyset cursor, scan deadline), all closed. Finding-by-finding table: [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md).

## Ledger rows updated

CSI-03 → review (ready). Other rows unchanged until CSI-04.
