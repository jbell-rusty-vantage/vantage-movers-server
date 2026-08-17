# Unit 08 — Durable claim service, drainer, queue/cron, retries, dead letter, and manual requeue

> **Contract maturity: implementation-ready once Units 04 and 07 are complete.** This is S06. It turns Mongo receipt work state into one fenced execution path shared by queue, cron, future synchronous applies, and Owner requeue. It runs only the verified processor in historical/live shadow; it does not match Leads itself, enable effects, or mutate official Lead/Booking/Cancellation facts.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, receipt work state/index/update rules in 9.1, Decisions in 11, processor interface in 25, 26–27, 28.3 requeue and 28.4 errors, 33, 35–36, 37.1–37.2, 38/S06, and 39–41.
- **Acceptance ownership:** AC-30 durable-clock/state foundation shared with Unit 15; full AC-37; plus lease recovery/single-claimant proof. Unit 15 completes actual `link_only` classification and incomplete-data routing through the production processor.
- **Approved split:** Unit 08 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Unit 08 schedules a processor-returned `pending_match`; Units 14–15 own identity, match eligibility, desired state, and production processor orchestration.
- **Predecessors:** verified Unit 04 normalization/Observation and Unit 07 Decision/activation/Record Link/flags/processor/health skeleton, their completion reports, and repository evidence. Units 02–03 receipt/capture/queue-publish evidence must also remain green.
- **Execution:** delivery runbook, repository instructions, lifecycle/capture/observability/cron/queue rules and business-logic docs.

The final specification wins. Where Section 26 leaves a state transition unstated, this issue uses the narrow fail-closed guidance labeled below; do not reinterpret payload meaning, source policy, or matching.

## 2. Objective

Implement one atomic receipt claim/lease/finalization service and drainer used by a dedicated Vercel queue consumer, five-minute cron, future synchronous extension/automation calls, and audited Owner requeue; distinguish technical retries from the exact 24-hour business match schedule; recover expired leases, dead-letter the tenth consecutive technical failure, expose PII-safe health/metrics/events, and prove no unfenced or shadow execution creates forbidden effects.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Blocked by:** Units 04 and 07 implemented and independently verified. Shared-branch sequencing remains mandatory.
- Verify the exact receipt work-state model/indexes and processing-only update guards from Unit 02, capture defaults and `{receipt_id}` publisher from Unit 03, one Observation per receipt from Unit 04, and Unit 07's processor result/error behavior, unique Decision attempt index, flags, activation classifier, Admin router/validation, operations health, and PII-safe telemetry.
- Before writes, confirm `TEST_MODE=true`, disposable replica-set database, `SHEET_SYNC_MODE=disabled`, processing/shadow/effect flags, queue publish posture, and absence of live external targets.
- No commit, push, deploy, production activation/mutation, historical backlog run, current-payload inspection, live queue publish, or external send without separate authorization.

## 4. Current-state evidence to verify

Observed on 2026-08-17; reverify after Units 04/07 land:

- `GranotObservationReceipt.processing` already has exact `state`, `technical_attempts`, `match_attempt`, `next_attempt_at`, lease/start/error/completion/latest-Decision fields, and `manual_requeue_count`. Capture initializes pending, both attempt counters `0`, due at capture, and requeue count `0`.
- Named due and lease indexes already exist: `granot_observation_receipt_processing_due` on state/next-at/captured-at and `granot_observation_receipt_leased_until`. Receipt evidence is write-once; query updates are limited to `$set/$inc/$unset` under `processing.*`.
- Capture commits before returning `202`, then best-effort publishes exactly `{receipt_id}` to environment-scoped `granot-lifecycle-events*`. No consumer currently exists, so queued wake-ups cannot mutate anything.
- `vercel.json` has dedicated `queue/v2beta` consumer and five-minute cron precedents, but no lifecycle consumer/cron. `src/app.ts` mounts no lifecycle cron.
- Lifecycle metrics currently cover capture/queue-publish only. No retry, recovery, dead-letter, durable run timestamps, or requeue path exists.
- Unit 07's authored contract leaves `last_queue_run`/`last_cron_run` null and delegates retry/dead-letter/requeue telemetry to Unit 08. Reverify the actual implementation rather than relying on that prose.

## 5. Locked decisions and invariants at risk

- **Invariant 1 — MongoDB is the System of Record:** queue messages are wake-ups only; due state, claims, leases, attempts, errors, and completion live on the receipt.
- **Invariant 2 — Observation is evidence, not official-fact authority:** retry/requeue/shadow processing cannot create/update/cancel/un-cancel a Booking.
- **Invariant 3 — lifecycle is composed, not an enum:** receipt `processing.state` is operational work state, never Lead lifecycle state.
- **Invariant 5 — only canonical commands mutate aggregates:** consumer, cron, claim service, and requeue route never patch aggregates directly.
- **Invariant 6 — atomic causal mutation:** one fence prevents concurrent processors; after lease loss, retry relies on later canonical command idempotency and the stale worker may not finalize.
- **Invariant 7 — no-op has no Change/Sheet work:** retry scheduling, terminal/no-op/shadow, dead-letter, and requeue create no business effect.
- **Invariant 8 — provenance axes remain separate:** queue/cron/manual trigger, Observation Channel, processor actor, and Owner initiator are distinct.
- **Invariant 9 — immutable evidence never changes:** only `processing.*` may change; requeue cannot replace payload, hash, headers, channel operation ID, Observation, or Decision.
- **Invariant 10 — identity conflict never reassigns source/CPL:** reprocessing cannot broaden a predecessor conflict/policy result.

## 6. Deliverables and exact contract

### 6.1 Production seams and shared entrypoint

Add the final-spec files:

```text
src/services/granotLifecycle/drainer.ts
api/queues/granot-lifecycle-consumer.ts
src/routes/granot-lifecycle-cron.routes.ts
```

Extend the verified lifecycle processor/operations/metrics, Admin route and validation, `src/app.ts`, `vercel.json`, tests, and docs. All queue, cron, future extension/automation synchronous apply, and manual requeue work enters one claim service. Callers pass receipt identity only and own no normalization, policy, matching, desired-state, or patch logic.

The claim service supports both one requested receipt ID (queue/future synchronous caller) and an indexed due scan (cron). A queue wake-up first targets its ID; it must not become an unbounded policy-owning consumer. Mongo remains durable recovery if the wake-up is lost.

### 6.2 Exact claim, lease, and fence

Claim due work atomically with the exact Section 26 predicate/update:

```ts
filter: {
  "processing.state": { $in: ["pending", "retry_scheduled", "claimed"] },
  "processing.next_attempt_at": { $lte: now },
  $or: [
    { "processing.state": { $ne: "claimed" } },
    { "processing.leased_until": { $lte: now } },
  ],
}
update: {
  $set: {
    "processing.state": "claimed",
    "processing.lease_owner": owner,
    "processing.leased_until": now + 5 minutes,
    "processing.last_started_at": now,
  },
  $inc: { "processing.technical_attempts": 1 },
}
```

- Initial due-scan batch is `20`; bounded concurrency is `4`; lease duration is five minutes.
- Owner is a bounded opaque worker/run token, never contact/source/payload data.
- Renew before every potentially long phase and at least every two minutes.
- Renew and every success/retry/dead-letter finalization filter by `{_id,"processing.state":"claimed","processing.lease_owner":owner}`. A zero match means lease lost: stop, write no final state, launch no replacement processor, and never undo a committed idempotent command.
- The same predicate recovers an expired claim and increments `granot_lifecycle_claim_recoveries_total` only after a successful recovery claim.
- Processing disabled means no claim and a safe skipped run; capture/due work remain intact.

### 6.3 Technical failure budget

On a processor dependency/transaction failure, create no `SynchronizationDecision`; retain the provisional claim increment and fence one of:

- attempts `1..9`: `retry_scheduled`, due at `min(6h, 30s * 2^(attempt-1))` plus injected random jitter from `0%` through `25%`, safe `last_error`, lease cleared;
- attempt `10`: `dead_letter`, safe `last_error`, lease cleared, PII-safe dead-letter event/metric; no processor/effect runs again until an Owner requeues.

`last_error` stores bounded code, message (schema maximum 500), and failure time only. Sanitization rejects/strips payload, headers, credentials, contacts, addresses, Job/source labels, stack dumps, query values, and arbitrary provider messages. Inject clock/randomness for exact bound tests; the final spec does not prescribe a seed.

Section 26 increments `technical_attempts` on claim but also says a successful business attempt does not consume technical retry budget. **Issue-author guidance:** treat the claim increment as provisional and reset `technical_attempts` to `0` on every successfully evaluated processor result. Thus the stored value is the consecutive technical-failure budget; only dependency failures retain it, lost/expired claims are safely absorbed by the next successful fenced finalization, and nine pending-match attempts cannot make the first technical failure dead-letter.

### 6.4 Business outcomes and exact pending-match clock

For every successful processor result, fence finalization and set `latest_decision_id`. The outcome matrix is exhaustive over `SynchronizationOutcome`:

- `created`, `applied`, `linked`, `already_current`, `stale`, `unmatched`, `ambiguous`, `conflict`, `deferred`, `policy_blocked`, `insufficient_creation_data`, `invalid`, or `unsupported` -> `completed` with `completed_at`, lease/error cleared, technical budget reset;
- `pending_match` -> `retry_scheduled`, increment `match_attempt` exactly once, reset technical budget, clear lease/error, and keep receipt due/Decision `next_match_attempt_at` identical.

The Section 26 terminal list plus the closed outcome union leaves `pending_match` as the only schedulable successful result. Treating every other successfully evaluated outcome as completed is narrow **issue-author guidance**; an unknown outcome fails closed as a technical contract error and is never silently completed.

Only `pending_match` uses the business schedule measured from immutable first `captured_at`:

```text
immediate -> 1m -> 5m -> 15m -> 1h -> 2h -> 6h -> 12h -> 24h
```

- Each business attempt has its own unique `(observation_id,attempt)` Decision and one `match_attempt` increment.
- Determine the next absolute offset from `captured_at`, never from last execution time, so delay does not drift.
- At or after the 24-hour boundary, a still-failed match becomes `unmatched` and completes; it is not scheduled beyond 24 hours.
- `insufficient_creation_data` is terminal and never converted to pending match.
- If finalization loses its fence, do not write counters/state. A later claimant reprocesses idempotently.

### 6.5 Synchronous claim-and-poll seam

Expose a typed internal module seam for Units 16–17:

- attempt the same atomic claim;
- if this caller wins, run the same fenced processor path;
- if it loses, poll the receipt for at most five seconds with bounded injected backoff;
- completed returns the stored normalized processor result;
- still claimed or retry-scheduled returns typed `accepted_for_processing` with receipt identity/due state only;
- never start an unfenced second processor.

Do not invent extension/automation HTTP envelopes here; those units translate this module result.

### 6.6 Queue and cron

- `api/queues/granot-lifecycle-consumer.ts` is a dedicated Vercel function, not an Express route. It accepts only `{receipt_id}`, connects/registers required lifecycle foundations, and invokes the requested-ID shared drainer.
- Register its `queue/v2beta` trigger in `vercel.json` with topic pattern exactly `granot-lifecycle-events*`.
- Mount cron route exactly `/api/cron/granot-lifecycle-drain`, using existing constant-time cron-secret convention. It invokes due scanning only, returns a safe bounded summary, and exposes no errors/payload values.
- Register cron schedule exactly `*/5 * * * *` in `vercel.json`.
- Queue and cron may overlap; Mongo claim/fence—not process memory—selects the single winner.

### 6.7 Owner-only audited manual requeue

Add exact route `POST /api/v1/admin/granot-lifecycle/receipts/:id/requeue` behind existing API and trusted signed Admin actor boundaries. Require Owner and strict body:

```ts
{ reason: string } // trim; 10..500; unknown keys rejected
```

The strict body is issue-author guidance because the final spec fixes the reason but does not print the request type. It structurally forbids payload/hash/operation-ID replacement.

- Safest fail-closed eligibility is `dead_letter` only; other states return `409 GRANOT_REQUEUE_STATE_CONFLICT` as bounded issue-author guidance. Do not requeue completed evidence or steal a live claim.
- As narrow **issue-author guidance**, perform the processing transition and audited Operational Event in one replica-set transaction: compare current dead-letter state, set `state:"pending"`, due now, clear lease/error/completion, increment `manual_requeue_count`, preserve `match_attempt`/latest Decision/evidence, reset the technical failure budget to `0` so attempt-10 can run again, and persist one PII-safe event with trusted actor, reason, receipt ID, prior/new state, and requeue count.
- The counter resets are issue-author guidance required to make dead-letter requeue claimable without erasing its audit/event history.
- Missing -> `404 GRANOT_RECEIPT_NOT_FOUND`; non-Owner -> `403 GRANOT_OWNER_REQUIRED`; invalid ID/body -> `400 GRANOT_VALIDATION_FAILED`; state race -> safe `409`; success -> `200 {ok:true,data}`.
- Requeue itself invokes no processor and creates no Decision/domain effect. Concurrent requests have one state-transition winner; every successful requeue has exactly one audit.

### 6.8 Metrics, health, events, and privacy

Implement Unit 08's exact metrics:

```text
granot_lifecycle_queue_due
granot_lifecycle_oldest_due_seconds
granot_lifecycle_claim_recoveries_total
granot_lifecycle_technical_retries_total{code}
granot_lifecycle_dead_letters_total{code}
```

- Emit PII-safe Operational Events for technical retry, dead letter, manual requeue, and bounded queue/cron run completion/failure. Unit 07 owns processing completion; Unit 30 owns final exporters/alerts.
- Extend health with claimed count, expired-claim count, dead-letter count, and accurate last queue/cron run while preserving indexed due/oldest counts.
- Serverless process memory is not durable. **Issue-author guidance:** derive last queue/cron run from durable PII-safe Operational Events rather than inventing a new run model.
- Labels are bounded enum/error codes only. Never label/log Job Number, source label, ObjectId, actor, contact, payload, headers, or free-form error/requeue text.

### 6.9 Documentation

Update project-organization, lifecycle capture/processing business logic, observability, queue/cron, and applicable rules. Capture docs must now say a consumer exists but preserve capture-first/queue-wakeup-only semantics.

## 7. Explicitly out of scope

- Identity ladders/contact matching, candidate selection, full `link_only` eligibility, temporal winner, desired-state planning, or inventing a `pending_match` outcome (Units 14–15).
- Extension/automation receipt apply APIs (Units 16–17); Unit 08 provides only the internal claim/poll seam.
- Aggregate revision/command/Change/outbox/provenance work (Units 09–13), Lead effects/creation, RingCentral convergence/cadence, reconciliation/cases/owner commands, Referral, discrepancies, email, cleanup, or current-payload certification.
- Raw receipt endpoint or Admin UI, source-policy/classification changes, activation, live effect enablement, or automatic official fact mutation.

## 8. Flags and runtime posture

Starting and ending posture after Unit 07 is exactly:

```text
GRANOT_LIFECYCLE_PROCESSING_ENABLED=true
GRANOT_LIFECYCLE_SHADOW_MODE=true
GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED=false
GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=false
GRANOT_LIFECYCLE_EMAIL_ENABLED=false
```

- Without activation every receipt is permanently `historical_shadow`; an approved disposable post-cutoff test remains `live_shadow`. No live effect flag becomes true.
- Shadow Decisions are never replay-promoted. Capture remains active when processing is disabled.

## 9. Migration and indexes

- **Data migration: none. New indexes: none**, provided Unit 02's named due/lease indexes and Unit 07's Decision attempt index are present and verified.
- Reverify exact index definitions through `migration:granot-lifecycle:indexes -- --report|--verify` against a disposable/test database before claim/concurrency proof. Do not create activation or process backlog as migration.
- No production apply/index sync is authorized. Unit 31 owns historical shadow certification.

## 10. Acceptance criteria

- [ ] **AC-30 exact release assertion (foundation/partial here):** “`link_only` pending match follows the exact schedule and becomes unmatched at 24 hours; incomplete data is not retried as pending match.” Unit 08 proves every absolute offset from `captured_at`, receipt/Decision state transitions, technical-budget separation, and the terminal boundary for a processor-returned outcome. Unit 15 proves actual `link_only` classification and incomplete-data routing.
- [ ] Each pending attempt creates one new Decision, increments `match_attempt` once, aligns receipt/Decision due timestamps, and consumes no technical-failure budget; dependency failure creates no Decision and follows technical retry.
- [ ] **AC-37 (exact release assertion):** “Manual requeue requires Owner reason/audit, respects payload identity, and dead-letter work does not mutate until reprocessed successfully.” Prove strict 10–500 reason, atomic audit/state transition, immutable hash/operation identity, and zero effect from requeue itself.
- [ ] Two claimants/queue+cron racers have one winner; unexpired lease cannot be stolen; expired lease recovers; stale owner cannot renew/finalize.
- [ ] Technical failures use exact exponential cap/jitter; failure 9 retries and consecutive failure 10 dead-letters with safe error/event.
- [ ] Synchronous loser polls at most five seconds and never runs a second processor.
- [ ] Health/metrics/run evidence are durable, bounded, indexed, and raw/PII-free.
- [ ] Historical/live shadow produces zero Lead, Booking, Cancellation, Change, Sheet, case, discrepancy, notification, or external-send delta.

## 11. Required tests and commands

Use AC-named tests at these levels:

- pure fake-clock/random tests for retry/jitter, all pending offsets/24-hour boundary, and poll deadline/backoff;
- replica-set integration for atomic claimant, queue/cron race, expiry recovery, renew/finalize fence, lease loss, attempt-10 dead letter, and concurrent requeue/audit atomicity;
- module tests for terminal/pending/technical mapping, counter separation/reset guidance, zero Decision on dependency failure, and zero forbidden effects;
- consumer/cron/Admin route tests for ID-only payload, auth, processing-disabled skip, strict Owner reason, exact envelopes/errors, and shared drainer;
- manifest tests for exact queue topic and five-minute cron; metrics/health privacy scans with bounded labels.

Add or reuse the fixed safe package runner `test:granot-lifecycle:replica`. It must refuse a non-test/historical/production database, require a replica-set topology, and use a disposable database name. This runner name is **issue-author guidance** so transaction claims have one reproducible entrypoint.

Run exactly:

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/drainer*.test.ts" "src/services/granotLifecycle/operations.test.ts" "src/services/granotLifecycle/metrics.test.ts" "src/routes/granot-lifecycle-*.test.ts" "src/validation/v1/granotLifecycle.validation.test.ts" "api/queues/granot-lifecycle-consumer.test.ts"
pnpm test:granot-lifecycle:replica -- --unit=08
pnpm test
pnpm typecheck
```

Use `vercel dev` smoke only when needed to prove queue/cron routing differences, with isolated configuration. Fakes alone do not prove lease/concurrency.

## 12. Live/staging verification

- Through the production drainer in a disposable replica-set environment, inject a synthetic dependency failure and prove retry scheduled with zero Decision; drive a synthetic pending match through exact fake-clock offsets to terminal unmatched.
- Race queue wake-up and cron on one receipt; force lease expiry/recovery; prove stale owner cannot finalize; drive failure 10 to dead letter; Owner-requeue it and prove identity/evidence unchanged.
- Verify health due/oldest/claimed/expired/dead-letter and last-run values plus retry/recovery/dead-letter metrics/events.
- Record only masked causal IDs, counts, enum codes, timestamps, and flag posture. Assert zero forbidden aggregate/case/Change/Sheet/notification/external deltas.
- No production activation/mutation, current payload, deployment, live queue, flag enablement, or external send is authorized.

## 13. Rollback

- First set `GRANOT_LIFECYCLE_PROCESSING_ENABLED=false`; disable the lifecycle consumer and cron caller if needed. Capture continues and work remains durable/due.
- Keep all effect flags false. Do not bulk-clear leases/attempt history or drop receipt indexes as routine rollback.
- Preserve Receipts, Observations, Decisions, activation, Record Links, Operational Events/audits, dead letters, and committed official facts. Never rewrite immutable payload/hash/operation identity.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-08-COMPLETION.md` per Runbook Section 13, including:

- files grouped by claim/drainer, consumer/cron, requeue, metrics/health, tests, manifest, and docs;
- exact claim/update/fence, lease/renew cadence, batch/concurrency, technical/business schedules, counter-separation guidance, and lost-lease behavior;
- full AC-30/AC-37 test names/results and replica-set single-winner/recovery/stale-finalizer evidence;
- exact queue/cron manifest entries, manual-requeue actor/reason/audit/identity proof, and PII scan;
- migration/index decision, flags/activation before/after, zero-forbidden-effect deltas, staging result or not-run reason, final `git status --short`, and explicit external-action statement.

Successful verified Unit 08 completes S06 and removes Unit 15's durable-work prerequisite; Unit 15 still waits for Unit 14 and its other approved prerequisites.
