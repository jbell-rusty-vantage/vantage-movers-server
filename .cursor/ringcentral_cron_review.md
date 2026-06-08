# RingCentral Cron Call Lead Review

Review entry point: `api/routes/ringcentral-cron.routes.ts`

Scope: how the cron jobs use RingCentral Call Log and Analytics, how calls qualify, and how qualified calls can become `call_leads`.

## Executive Summary

The cron pipeline is mostly well structured. The route layer is thin, cron access is gated by `CRON_SECRET`, feature flags prevent accidental activation, Call Log qualification is centralized, and the final ingest path is shared with the webhook flow. That shared ingest path is the strongest part of the design because idempotency, duplicate classification, dry-run/shadow/create behavior, and real lead creation all happen in one place.

The business rule described in the request is implemented in the Call Log path:

- The call must be `Inbound`.
- The called number must match one of the configured RingCentral inbound numbers.
- The call must be answered.
- The duration must be at least `120` seconds.
- The caller phone number must be present.

The biggest critique is not that the core rule is missing. It is that the cron path currently trusts several RingCentral payload semantics that are worth validating in production: what `duration` means on detailed call-log records, whether answered status can be inferred reliably from any leg, whether a target number on any leg always means the caller entered through that owned number, and whether `telephonySessionId` is always present. There are also operational concerns around the current 2-hour cron cadence, hard pagination cap, limited reject observability, and partial-failure retry behavior.

## Actual Runtime Flow

`api/routes/ringcentral-cron.routes.ts` exposes two cron endpoints:

1. `/api/cron/ringcentral-call-log-sync`
2. `/api/cron/ringcentral-analytics-reconcile`

Both routes require `CRON_SECRET`. They accept either:

- `Authorization: Bearer <CRON_SECRET>`
- `x-cron-secret: <CRON_SECRET>` for local/manual testing

The call-log route checks `RINGCENTRAL_CALL_LOG_SYNC_ENABLED`. If disabled, it returns a skipped JSON response. If enabled, it calls `runRingCentralCallLogSync()`.

The analytics route checks `RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED`. If disabled, it returns skipped. If enabled, it calls `runRingCentralAnalyticsReconcile()`.

Current deployed schedule in `vercel.json`:

- Call Log sync: `0 */2 * * *`, once every 2 hours.
- Analytics reconcile: `0 6 * * *`, once daily.

There is documentation drift: `scripts/ringcentral/RINGCENTRAL-PRODUCTION-RUNBOOK.md` says the Call Log cron runs every 10 minutes, but `vercel.json` currently runs it every 2 hours.

## Call Log Sync Flow

`runRingCentralCallLogSync()` does the following:

1. Resolves a time window.
   - If a previous successful cursor exists, it fetches from `lastSyncTo - overlap`.
   - Otherwise it fetches from `now - lookback`.
   - Defaults:
     - `RINGCENTRAL_CALL_LOG_SYNC_LOOKBACK_MINUTES`: `30`
     - `RINGCENTRAL_CALL_LOG_SYNC_OVERLAP_MINUTES`: `15`

2. Fetches detailed inbound RingCentral Call Log records.
   - Endpoint: `/restapi/v1.0/account/~/call-log`
   - Query:
     - `direction=Inbound`
     - `type=Voice`
     - `view=Detailed`
     - `perPage=250`
   - Pagination is capped at 20 pages, so one run can fetch at most 5,000 records.

3. Vets each record with `vetRingCentralCallLogRecord()`.

4. Converts qualified records into `RingCentralQualifiedCall`.

5. Sends each qualified call to `ingestRingCentralQualifiedCall()`.

6. Advances the sync cursor only after the entire run succeeds.

7. On error, records the error but does not advance the cursor, so the next run retries the same window.

## Qualification Logic

The Call Log vetting logic lives in `api/services/ringcentral/call-log-vetting.ts`.

A record qualifies only when all rejection reasons are absent:

- `direction === "Inbound"`
- A matched target number exists in `to.phoneNumber` on the root record or any leg.
- The matched target number maps through `resolveRingCentralInboundSource()`.
- The record or any leg has an answered-like result.
- The selected duration is `>= CALL_LEAD_MINIMUM_ANSWERED_SECONDS`.
- A caller phone number can be found and normalized.

The current configured target numbers are:

- `+18883164387` -> `10best Inbounds`, `tbm_leads`
- `+18883083612` -> `TBM Prime Inbounds`, `tbm_prime_leads`
- `+18887240625` -> `Top10 Inbounds`, `top10_leads`
- `+18884779232` -> `Main Site Inbounds`, `main_site`

The answered result set is:

- `Accepted`
- `Completed`
- `Call connected`
- `Connected`
- `Answered`

Duration is computed as the max of:

- root `duration`
- root `durationMs / 1000`
- each leg's `duration`

That max-duration choice is pragmatic for multi-leg queue calls, but it is also the most important semantic assumption to validate against real RingCentral records.

## Lead Storage Behavior

Qualified Call Log records are not written directly as leads. They go through `ingestRingCentralQualifiedCall()` in `api/services/ringcentral/ringcentral-call-lead-ingest.service.ts`.

The ingest service does four important things:

1. Idempotency check.
   - Looks in `ringcentral_processed_calls` by `telephonySessionId` or `callLogId`.
   - If already created/shadowed, returns `skipped_already_processed`.

2. Duplicate classification.
   - Checks for an existing non-duplicate `call_leads` record with the same source company and normalized caller phone within `RINGCENTRAL_DUPLICATE_WINDOW_HOURS`.
   - Default duplicate window is 24 hours.
   - Duplicate calls are still created, but with `duplicate: true` and `cpl: 0`.

3. Write mode resolution.
   - `RINGCENTRAL_CREATE_CALL_LEADS=true`: creates a real `call_leads` record.
   - Else if `RINGCENTRAL_SHADOW_CALL_LEADS=true`: writes to `ringcentral_shadow_call_leads`.
   - Else: dry-run only.

4. Ledger write.
   - Writes the outcome to `ringcentral_processed_calls`.

Real RingCentral leads are created through `createRingCentralCallLead()`, which also schedules the existing sheet sync process.

## Analytics Reconcile Flow

`runRingCentralAnalyticsReconcile()` is reporting-only. It does not create call leads.

It queries RingCentral Analytics aggregation with:

- Grouping: `CompanyNumbers`
- Direction: `Inbound`
- Response: `Answered`
- Duration minimum: `120`
- Called numbers: the configured target numbers

The result is stored in `ringcentral_analytics_snapshots`. This is useful as a daily sanity check against the number of leads the webhook plus cron pipeline produced.

Important: Analytics snapshots do not include caller-level data, so this path cannot decide duplicates or create leads.

## What Looks Good

The route layer is appropriately small. Authentication, feature flags, and error responses are easy to understand.

The Call Log cron uses an overlap window and only advances the cursor on success. That is the right shape for late-arriving Call Log records.

The Call Log path and webhook path share the same final ingest service. This reduces the chance that cron-created leads and webhook-created leads drift in duplicate handling or write-mode behavior.

The lead-write kill switch is conservative. The default is dry-run, real `call_leads` creation requires `RINGCENTRAL_CREATE_CALL_LEADS=true`, and shadow mode exists for production observation without billable leads.

The `call_leads` model has a unique sparse index on `ringcentral.telephony_session_id`, which is a strong final guard against same-session double creation when RingCentral provides that ID.

The tests cover the happy-path Call Log qualification and core rejections: under 120 seconds, outbound, unmapped target, missed call, and target matching across legs.

## Main Risks And Critique

### 1. The 2-hour cron cadence conflicts with the documented 10-minute design

The current schedule in `vercel.json` is every 2 hours. The runbook says every 10 minutes.

If the cron path is intended as a near-real-time safety net for missed webhooks, 2 hours is slow. It also means the default first-run lookback of 30 minutes is not enough if the cursor is missing, reset, or lost after the service has been running for longer than 30 minutes.

Recommendation: decide whether 2 hours is intentional. If not, update `vercel.json` and the runbook so they agree. If 2 hours is intentional, increase the first-run lookback or document the operational recovery procedure when cursor state is missing.

### 2. The duration rule may not equal answered talk time

The business rule says the call went over the 120 second buffer and was answered. The code uses the maximum duration found on the root call-log record or its legs.

This can be correct, but it depends on RingCentral's detailed Call Log semantics. For queue/IVR calls, a long total duration can include time before a human answered, queue wait, transfers, or other leg timing. The webhook session aggregator is more explicit about answer-to-terminal timing. The Call Log path is less precise because it trusts `duration`.

False-positive scenario: caller waits in queue for 130 seconds, agent talk time is short, but a call-log duration still exceeds 120.

False-negative scenario: a relevant answered agent leg exceeds 120, but the root record's result/duration layout does not expose it in the shape this parser expects.

Recommendation: validate a sample of real detailed Call Log records against RingCentral's UI/export for "answered talk time". If possible, prefer a field that specifically represents connected/talk duration on the answered leg rather than max duration across all parts.

### 3. Answered detection is broad across root and any leg

The code treats a call as answered if the root or any leg has one of the answered results. This handles multi-leg calls, but it can over-qualify when an internal/queue leg is "Accepted" or "Completed" while the customer was not actually connected to an agent in the intended sense.

Recommendation: confirm that `Accepted` and `Completed` always mean customer answer/talk for these records. If not, narrow the answered result set or require that the answered leg is also the leg used for the caller/target/duration decision.

### 4. Target matching across any leg is useful but can be permissive

The code qualifies a call if any leg's `to.phoneNumber` matches one of the owned toll-free numbers. This is probably necessary for queue-routed RingCentral calls where the root `to.phoneNumber` may change.

The risk is that "any leg matched" can make the session qualify even if the final answered leg is not actually attributable to that source or queue. Source attribution then comes from the first matching target leg, while duration and answered status may come from different legs.

Recommendation: add review instrumentation that records which part supplied the matched target, which part supplied the answered signal, and which part supplied the max duration. That would make attribution problems much easier to diagnose.

### 5. Missing `telephonySessionId` weakens cross-path idempotency

The design is strong when `telephonySessionId` is present. The processed-call ledger checks it, and `call_leads` has a unique sparse index on it.

If Call Log records lack `telephonySessionId`, cron-to-cron dedupe can still use `callLogId`, but webhook-to-cron dedupe is weaker because webhooks do not have `callLogId`. The existing doc `docs/ringcentral-cron-idempotency-hardening.md` already calls this out as future hardening.

Recommendation: implement that hardening before relying on the cron path for real lead creation at scale:

- Add a unique sparse index on `call_leads.ringcentral.call_log_id`.
- Add a stable fallback key when both shared IDs are missing.
- Catch Mongo duplicate-key errors during real lead creation and convert them into a clean skip.

### 6. Dry-run idempotency can suppress later real creation

`ingestRingCentralQualifiedCall()` checks existing processed calls and only skips statuses `lead_created`, `lead_created_duplicate`, and `shadow_recorded`. It does not skip prior `dry_run`, which means a dry-run record can later be processed again once write mode changes to create.

That behavior is probably intentional and useful for go-live. The subtle issue is historical dry-run windows: when `RINGCENTRAL_CREATE_CALL_LEADS` is turned on, any retried or overlapped dry-run-qualified calls inside the sync window may become real leads, depending on cursor/window state.

Recommendation: make this behavior explicit in the go-live runbook. Before enabling real creation, confirm the cursor and overlap will not replay old dry-run calls that should remain non-billable.

### 7. Partial failure retries the whole window and can produce noisy repeats

The cursor advances only after the whole run succeeds. That is good for safety, but if ingestion fails halfway through, earlier successful records remain in the retried window.

Idempotency should absorb this for real/shadow writes. But dry-run records do not cause future skips, so a repeatedly failing dry-run job can repeatedly reclassify the same calls and rewrite processed-call status.

Recommendation: consider per-record error isolation. One bad record should be counted and skipped without failing the entire window unless the error is systemic, such as RingCentral API failure or database outage.

### 8. Pagination has a hard cap with no overflow signal

The sync fetches at most 20 pages of 250 records, or 5,000 records per run. That is probably enough for normal traffic, but there is no explicit warning if page 20 is full, which means the job may silently truncate a busy window.

Recommendation: if page 20 returns 250 records, log and surface a `paginationTruncated: true` warning in the summary. Ideally continue using RingCentral navigation links or increase the cap safely.

### 9. Reject observability is limited

The summary counts fetched, candidate, qualified, actions, leads, duplicates, and errors. It does not aggregate rejection reasons.

When a production discrepancy appears, the first question will be: were calls rejected because they were under 120, not answered, missing caller phone, or target not matched? Today that requires deeper log/data inspection.

Recommendation: add reject counts by reason to the cron summary and logs. This is low-risk and high-value.

### 10. Analytics reconcile can only validate counts, not correctness

The analytics job is useful, but it cannot validate caller-level lead creation or duplicate classification. A matching daily count does not prove that the right caller numbers became leads. A mismatch can indicate a problem, but not where the problem is.

Recommendation: treat analytics as a coarse alarm. The authoritative audit for lead creation should remain the detailed Call Log records, processed-call ledger, and created/shadow call leads.

### 11. Documentation defaults appear stale

The runbook says `RINGCENTRAL_WEBHOOK_FILTER_MODE` defaults to `per-number`, but `ringcentral-config.ts` defaults to `account`. The runbook also says the cron is every 10 minutes, but `vercel.json` says every 2 hours.

Recommendation: update the runbook to match current code, or update code/config to match the intended runbook.

## Tests: Current Coverage And Gaps

Existing tests cover:

- Basic Call Log qualification.
- Under-120 rejection.
- Outbound rejection.
- Unmapped target rejection.
- Missed call rejection.
- Matching target number across legs.
- Duplicate classification by caller/source window.
- Same telephony session not counted as duplicate.

Useful additions:

- Call Log record where root duration is long but answered leg duration is short.
- Call Log record where queue/IVR leg has matched target but answered leg has a different target.
- Call Log record with `durationMs` only.
- Call Log record with missing `telephonySessionId` but present `callLogId`.
- Call Log record with neither `telephonySessionId` nor `callLogId`.
- Pagination cap behavior when the final allowed page is full.
- Ingest behavior when `createRingCentralCallLead()` throws duplicate-key error.
- Reject reason aggregation once added.

## Recommended Priority Fixes

1. Resolve the schedule/documentation mismatch.
   - Decide between 10 minutes and 2 hours.
   - Align `vercel.json`, runbook, and lookback defaults.

2. Add reject-reason metrics to the call-log sync summary.
   - This will make production review much easier.

3. Validate RingCentral Call Log duration semantics with real records.
   - Confirm whether max root/leg duration means answered talk time.
   - If not, change vetting to use the answered leg's connected/talk duration.

4. Add instrumentation for the selected target, answered, caller, and duration source.
   - This helps diagnose multi-leg queue attribution.

5. Implement the existing idempotency hardening for missing `telephonySessionId`.
   - Especially before real lead creation is considered fully production-safe.

6. Add a pagination truncation warning.
   - Silent truncation is avoidable.

7. Update tests around multi-leg edge cases.
   - The current tests prove the simple rule, but not the risky queue/leg attribution cases.

## Bottom Line

The cron pipeline is functional and has a solid architecture: fetch detailed inbound Call Logs, vet with explicit business rules, and use a shared ingest service for idempotency, duplicate handling, write posture, and lead creation.

The core critique is that the qualification code currently collapses multi-leg RingCentral records by mixing evidence from different parts of the call: target number from any leg, answered result from any leg, duration as max duration, and caller from the first inbound part. That may match real RingCentral behavior for these queues, but it should be verified with production samples because it is exactly where false positives or wrong source attribution would appear.

I would not call this brittle, but I would not treat it as fully audited until the duration/leg semantics and missing-ID hardening are addressed.
