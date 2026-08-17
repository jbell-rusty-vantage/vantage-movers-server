# Unit 08 completion — Durable claim service, drainer, queue/cron, retries, dead letter, and manual requeue

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, receipt work state/index/update rules in 9.1, Decisions in 11, processor interface in 25, 26–27, 28.3 requeue and 28.4 errors, 33, 35–36, 37.1–37.2, 38/S06, and 39–41
- **Acceptance ownership:** AC-30 durable-clock/state foundation shared with Unit 15; full AC-37; plus lease recovery/single-claimant proof. Unit 15 still owns actual `link_only` classification and incomplete-data routing.
- **Applicable invariants preserved:** 1–3, 5–10 as restated in UNIT-08 (Mongo remains SoR; queue messages are wake-ups; receipt `processing.state` is operational work state; no aggregate patches; one fence; no-op/shadow/retry/requeue create no business effect; provenance axes stay separate; evidence immutable; identity conflict not reassigned)
- **Runtime posture:** one claim/lease/finalization service is shared by the dedicated queue consumer, five-minute cron, internal claim-and-poll seam, and Owner dead-letter requeue. The verified Unit 07 processor runs only after a successful fence. Capture still does not invoke the processor. All eight effect flags stay false.

## Files added or changed

### Claim / drainer

- `src/services/granotLifecycle/drainer.ts` + `.test.ts` + `.replica.test.ts` — Section 26 claim/fence, due scan, requested-ID drain, technical vs pending-match clocks, sync poll
- `src/services/granotLifecycle/schedules.ts` + `.test.ts` — technical retry, pending-match offsets, poll backoff, batch/lease constants
- `src/services/granotLifecycle/lastError.ts` + `.test.ts` — bounded codes and 500-char PII-stripped `last_error`

### Consumer / cron

- `api/queues/granot-lifecycle-consumer.ts` + `.test.ts` — dedicated Vercel function; `{ receipt_id }` only
- `src/routes/granot-lifecycle-cron.routes.ts` + `.test.ts` — `/api/cron/granot-lifecycle-drain`, constant-time cron secret, bounded summary
- `src/app.ts` — mounts the cron router
- `vercel.json` — queue topic `granot-lifecycle-events*`; cron `*/5 * * * *`
- `src/config/domain/granotWebhook.ts` — consumer may drain wake-ups; publish failure still cannot change `202`

### Requeue

- `src/services/granotLifecycle/operations.ts` + `.test.ts` — Owner-only `dead_letter` → `pending` transaction + one PII-safe audit
- `src/routes/granot-lifecycle-admin.routes.ts` + `.test.ts` — `POST /api/v1/admin/granot-lifecycle/receipts/:id/requeue`
- `src/validation/v1/granotLifecycle.validation.ts` + `.test.ts` + barrel — `{ reason }` trim 10–500, unknown keys rejected
- `src/services/granotLifecycle/errors.ts` — `GRANOT_RECEIPT_NOT_FOUND`, `GRANOT_REQUEUE_STATE_CONFLICT`

### Metrics / health

- `src/services/granotLifecycle/metrics.ts` + `.test.ts` — due/oldest/recovery/retry/dead-letter counters; labels `^[a-z][a-z0-9_]{0,63}$`
- `src/services/granotLifecycle/projections.ts` + `.test.ts` — claimed/expired/dead-letter counts; last queue/cron run from Operational Events

### Tests / runner / manifest

- `scripts/test-granot-lifecycle-replica.ts` — refuses non-`TEST_MODE`, non-`testvantagemovers*`, and non-replica-set
- `package.json` — `test` includes `api/queues/**/*.test.ts`; `test:granot-lifecycle:replica`

### Docs

- `.cursor/businesslogic/granotLifecycle.drainer.md`
- `.cursor/businesslogic/granotLifecycle.capture.md`
- `.cursor/businesslogic/granotLifecycle.processor.md`
- `.cursor/businesslogic/granotLifecycle.normalization.md`
- `.cursor/index.md`
- `.cursor/rules/granot-lifecycle-capture.mdc`
- `.cursor/rules/project-organization.mdc`
- `.cursor/rules/owner-lead-workflow.mdc`
- `.cursor/rules/business-logic.mdc`
- `.cursor/rules/schema-and-crud-inputs.mdc`
- `.cursor/agents/docs-keeper.md`

## Exact contracts landed

### Claim, lease, and fence

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
    "processing.lease_owner": owner, // glc_${trigger}_${hex}
    "processing.leased_until": now + 5 minutes,
    "processing.last_started_at": now,
  },
  $inc: { "processing.technical_attempts": 1 },
}
```

- Requested-ID claim adds `_id` to that filter.
- Due-scan batch `20`; concurrency `4`; lease five minutes; renew at least every two minutes and before long phases.
- Renew/finalize fence: `{_id, "processing.state":"claimed", "processing.lease_owner": owner}`. Zero match → stop, write no final state, launch no replacement processor.
- Recovery = previous state was `claimed`; `granot_lifecycle_claim_recoveries_total` increments only after a successful recovery claim.
- Processing disabled: no claim, skipped run; capture and due work remain.

### Technical vs business clocks

- Technical failure (no Decision): attempts 1–9 → `retry_scheduled` at `min(6h, 30s * 2^(attempt-1))` plus 0–25% jitter; attempt 10 → `dead_letter`.
- Claim increment of `technical_attempts` is provisional; every successfully evaluated processor result resets it to `0`.
- `pending_match` increments `match_attempt` once and schedules the next absolute offset from immutable `captured_at`: `0, 1m, 5m, 15m, 1h, 2h, 6h, 12h, 24h`. At or after 24 hours the receipt completes and is not scheduled further. The drainer does not fabricate an `unmatched` Decision.
- Every other known `SynchronizationOutcome` completes. Unknown outcomes fail closed as `unknown_outcome`.
- Sync seam: same claim; loser polls ≤5s with `min(1s, 50 * 2^n)` backoff; completed returns the stored Decision result; still claimed/retry_scheduled → `accepted_for_processing`.

### Queue / cron manifest

| Kind | Entry |
| --- | --- |
| Queue | `api/queues/granot-lifecycle-consumer.ts` → `queue/v2beta` topic `granot-lifecycle-events*` |
| Cron | `/api/cron/granot-lifecycle-drain` schedule `*/5 * * * *` |

### Owner requeue

`POST /api/v1/admin/granot-lifecycle/receipts/:id/requeue` is Owner-only. Body `{ reason }` (trim 10–500). Eligibility is `dead_letter` only. One replica-set transaction sets `pending`, due now, clears lease/error/completion, resets the technical budget, increments `manual_requeue_count`, preserves evidence/`match_attempt`/latest Decision, and writes one PII-safe audit. Requeue itself runs no processor.

Errors: `404 GRANOT_RECEIPT_NOT_FOUND`, `409 GRANOT_REQUEUE_STATE_CONFLICT`, `403 GRANOT_OWNER_REQUIRED`, `400 GRANOT_VALIDATION_FAILED`.

### Metrics and health

```text
granot_lifecycle_queue_due
granot_lifecycle_oldest_due_seconds
granot_lifecycle_claim_recoveries_total
granot_lifecycle_technical_retries_total{code}
granot_lifecycle_dead_letters_total{code}
```

Health adds `claimed_count`, `expired_claim_count`, `dead_letter_count`, and last queue/cron run derived from `granot_lifecycle.{queue|cron}.run.{completed|failed}` Operational Events.

## Flags before / after

| Flag | Before | After |
| --- | --- | --- |
| `GRANOT_LIFECYCLE_PROCESSING_ENABLED` | `true` | `true` |
| `GRANOT_LIFECYCLE_SHADOW_MODE` | `true` | `true` |
| `GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED` | `false` | `false` |
| `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED` | `false` | `false` |
| `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` | `false` | `false` |
| `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED` | `false` | `false` |
| `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED` | `false` | `false` |
| `GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED` | `false` | `false` |
| `GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED` | `false` | `false` |
| `GRANOT_LIFECYCLE_EMAIL_ENABLED` | `false` | `false` |

Activation row: **absent**. No live effect flag became true.

## Indexes and migration

- **Data migration:** none. **New indexes:** none.
- Unit 02 named due/lease indexes and Unit 07 Decision attempt index remain the authority. This unit did not apply or verify indexes against a disposable database.
- Production `--apply` was **not** run.

## Verification

Focused (issue command plus Unit 08 schedule/sanitizer/health files):

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/drainer*.test.ts" "src/services/granotLifecycle/operations.test.ts" "src/services/granotLifecycle/metrics.test.ts" "src/services/granotLifecycle/schedules.test.ts" "src/services/granotLifecycle/lastError.test.ts" "src/routes/granot-lifecycle-*.test.ts" "src/validation/v1/granotLifecycle.validation.test.ts" "api/queues/granot-lifecycle-consumer.test.ts" "src/services/granotLifecycle/projections.test.ts"
```

- **48 passed, 0 failed, 6 skipped.**
- Skipped: opt-in replica-set claimant/recovery/dead-letter/requeue/queue+cron tests (`GRANOT_LIFECYCLE_REPLICA_TESTS=true` plus `TEST_MODE=true` / `testvantagemovers`). In-memory fence/recovery/poll proofs passed. Live Mongo replica-set commit is **not claimed**.

Replica runner:

```text
pnpm test:granot-lifecycle:replica -- --unit=08
```

- **Not run.** Runner refused: `TEST_MODE must be true.` Fail-closed; no disposable `testvantagemovers` replica set was used.

Full server:

```text
pnpm test
pnpm typecheck
```

- **1104 passed, 0 failed, 8 skipped.**
- Typecheck **passed.**
- `git diff --check` **passed.**

## AC-to-proof coverage

| AC | Unit 08 assertion | Proof |
| --- | --- | --- |
| AC-30 foundation | Exact pending-match offsets from `captured_at`; 24h terminal complete without a fabricated unmatched Decision; `insufficient_creation_data` is not converted to pending match; technical budget separated/reset; dependency failure creates no Decision | `schedules.test.ts`, `drainer.test.ts` `[AC-30] foundation *` |
| AC-30 / lease | Two claimants have one winner; unexpired lease cannot be stolen; expired lease recovers; stale owner cannot renew/finalize | `drainer.test.ts` in-memory; replica files exist and were skipped |
| AC-30 / sync | Loser polls ≤5s and never starts a second processor | `schedules.test.ts`, `drainer.test.ts` |
| AC-30 / shadow | Historical shadow drain creates no forbidden aggregate effects | `drainer.test.ts` `[AC-30] foundation historical shadow drain` |
| AC-37 | Owner reason 10–500, unknown keys rejected; dead-letter only; evidence/hash/operation identity preserved; requeue itself has zero effect | `granotLifecycle.validation.test.ts`, `operations.test.ts`, admin route tests |
| AC-35 portion | Metric labels bounded; `last_error` stripped; health raw-free | `metrics.test.ts`, `lastError.test.ts`, `projections.test.ts` |

## Privacy, metrics, and forbidden effects

- Lease owner is opaque `glc_${trigger}_${hex}`.
- Metric labels are bounded error codes only. Job Number, ObjectId, actor, reason text, payload, and contacts are rejected.
- `last_error.message` is ≤500 and strips payload/credential/contact/stack/URI patterns.
- Cron summary and health last-run expose counts/status/timestamps only.
- Unit 08 effects are claim/retry/dead-letter/requeue state only. No Domain Command, Entity Change, Sheet Sync intent, Lead/Booking/Cancellation write, case, discrepancy, or notification path is invoked.

## Masked staging / live verification

Not run. No production activation, no current-payload inspection, no Granot call, no live queue publish, and no external send. Synthetic redacted fixtures only. Replica-set Mongo proofs were not executed against a disposable `testvantagemovers` replica set because this environment is not in that posture (`TEST_MODE` is not true for the replica runner).

## Known risks and deferred work

- Live Mongo replica-set single-winner / lease-recovery / concurrent-requeue proof remains unverified until a disposable `testvantagemovers` replica set is available and `GRANOT_LIFECYCLE_REPLICA_TESTS=true` is set before process start. In-memory stores prove the predicate/fence contract; they are not Mongo concurrency proof.
- Index `--report|--verify` against a disposable database was not re-run in this session. No new indexes were added.
- The drainer completes a still-failed `pending_match` at/after 24 hours without writing an `unmatched` Decision. Unit 15 owns that classification.
- `GRANOT_REQUEUE_STATE_CONFLICT` and dead-letter-only eligibility are issue-author fail-closed guidance, not printed in spec §28.4.
- Technical-budget reset on successful processor results is issue-author guidance so nine pending-match attempts cannot dead-letter the first technical failure.
- Last queue/cron run is derived from Operational Events (issue-author guidance) rather than a new run model.
- Production consumer/cron deploy, index apply, and activation remain separately authorized.
- Units 14–15 still own identity, match eligibility, desired state, and production processor orchestration. Units 16–17 still own extension/automation HTTP envelopes.

## Newly unblocked

Successful Unit 08 verification completes **S06** and removes Unit 15's durable-work prerequisite. **Unit 15** still waits for Unit 14 and its other approved prerequisites. Shared-branch implementation stays sequential; **Unit 09** is the next sequential implementation target.

## Final `git status --short`

### vantage-main-server (`granot-lead-lifecycle`)

```text
 M .cursor/agents/docs-keeper.md
 M .cursor/businesslogic/granotLifecycle.capture.md
 M .cursor/businesslogic/granotLifecycle.normalization.md
 M .cursor/businesslogic/granotLifecycle.processor.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/owner-lead-workflow.mdc
 M .cursor/rules/project-organization.mdc
 M .cursor/rules/schema-and-crud-inputs.mdc
 M package.json
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M src/app.ts
 M src/config/domain/granotWebhook.ts
 M src/routes/granot-lifecycle-admin.routes.test.ts
 M src/routes/granot-lifecycle-admin.routes.ts
 M src/services/granotLifecycle/errors.ts
 M src/services/granotLifecycle/metrics.ts
 M src/services/granotLifecycle/operations.test.ts
 M src/services/granotLifecycle/operations.ts
 M src/services/granotLifecycle/projections.test.ts
 M src/services/granotLifecycle/projections.ts
 M src/validation/v1.validation.ts
 M src/validation/v1/granotLifecycle.validation.ts
 M vercel.json
?? .cursor/businesslogic/granotLifecycle.drainer.md
?? api/queues/granot-lifecycle-consumer.test.ts
?? api/queues/granot-lifecycle-consumer.ts
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-08-COMPLETION.md
?? scripts/test-granot-lifecycle-replica.ts
?? src/routes/granot-lifecycle-cron.routes.test.ts
?? src/routes/granot-lifecycle-cron.routes.ts
?? src/services/granotLifecycle/drainer.replica.test.ts
?? src/services/granotLifecycle/drainer.test.ts
?? src/services/granotLifecycle/drainer.ts
?? src/services/granotLifecycle/lastError.test.ts
?? src/services/granotLifecycle/lastError.ts
?? src/services/granotLifecycle/metrics.test.ts
?? src/services/granotLifecycle/schedules.test.ts
?? src/services/granotLifecycle/schedules.ts
?? src/validation/v1/granotLifecycle.validation.test.ts
```

No commit, push, deploy, production mutation, production index apply, production activation, current-payload inspection, live queue publish, Granot call, or external send occurred.
