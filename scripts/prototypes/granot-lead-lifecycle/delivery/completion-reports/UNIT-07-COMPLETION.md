# Unit 07 completion — Decision, activation, Record Link, execution mode, and safe operational skeleton

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 11, 13, 25, 27, 28.2 plus activation/error portions of 28.3–28.4, 33–36, 37.1–37.2, 38/S05, and 39–40
- **Acceptance ownership:** Decision-causality portion of AC-02; execution-mode/activation foundation of AC-31; Record Link causal/absence-of-forbidden-effect portion of AC-32; model, route, projection, log, and audit privacy portion of AC-35
- **Applicable invariants preserved:** 1–12 as restated in UNIT-07 (no Lead/Booking/Cancellation mutation; historical-only safe links; no contact matching; no reconciliation case)
- **Runtime posture:** callable `processGranotObservation` persists one Decision per observation/attempt and, only for valid reviewed `historical_shadow` evidence with a normalized Job Number, one job-level Record Link. Capture does not invoke the processor. Activation command exists; activation row remains absent. All eight effect flags stay false.

## Files added or changed

### Models

- `src/models/SynchronizationDecision.ts` + `.test.ts` — Section 11 shape, write-once, four named indexes, collection `synchronization_decisions`
- `src/models/GranotLifecycleActivation.ts` + `.test.ts` — Section 27.1 write-once activation, unique `{ key: 1 }`
- `src/models/GranotRecordLink.ts` + `.test.ts` — Section 13 job-level current aggregate, three named indexes, refresh-only updates
- `src/models/granotLifecycleSchemas.ts` — frozen Decision/activation/link enums coupled to Unit 01 types

### Config, processor, operations, projections

- `src/config/domain/granotLifecycle.ts` + `.test.ts` — ten flags, explicit boolean parse, pure execution-mode classifier
- `src/config/domain.ts` — barrel export
- `src/services/granotLifecycle/processor.ts` + `.test.ts` — Section 25 interface, terminal mappings, historical link establish/confirm/conflict, replay
- `src/services/granotLifecycle/operations.ts` + `.test.ts` — Owner-only write-once activation + transactional audit
- `src/services/granotLifecycle/projections.ts` + `.test.ts` — raw-free Job/health skeletons
- `src/services/granotLifecycle/errors.ts` — `GRANOT_*` envelopes with `request_id`
- `src/services/granotLifecycle/metrics.ts` — bounded `{outcome,reason_code,channel}` Decision counters, capture-to-decision timing, activation counter
- `src/services/granotLifecycle/types.ts` — `SynchronizationEffectSummary` as the Section 11 effects shape used by Section 25

### Routes and validation

- `src/routes/granot-lifecycle-admin.routes.ts` + `.test.ts` — focused protected Admin router
- `src/routes/v1.routes.ts` — mount after the `/api/v1` guard
- `src/validation/v1/granotLifecycle.validation.ts` + barrel export

### Indexes

- `scripts/migrations/granot-lifecycle-indexes.ts` / `.lib.ts` / `.test.ts` — script version `granot-lifecycle-indexes/5`; four Decision, one Activation, three Record Link indexes; collision reports with masked IDs

### Docs

- `.cursor/businesslogic/granotLifecycle.processor.md`
- `.cursor/businesslogic/granotLifecycle.capture.md`
- `.cursor/businesslogic/granotLifecycle.normalization.md`
- `.cursor/businesslogic/granotLifecycle.sourcePolicy.md`
- `.cursor/index.md`
- `.cursor/rules/project-organization.mdc`
- `.cursor/rules/schema-and-crud-inputs.mdc`
- `.cursor/rules/granot-lifecycle-capture.mdc`
- `.cursor/rules/owner-lead-workflow.mdc`
- `.cursor/rules/business-logic.mdc`

## Exact contracts landed

### Models and indexes

| Model | Collection | Unique / named indexes |
| --- | --- | --- |
| `SynchronizationDecision` | `synchronization_decisions` | `synchronization_decision_observation_attempt_unique`, `synchronization_decision_outcome_decided`, `synchronization_decision_target_decided`, `synchronization_decision_source_decided` |
| `GranotLifecycleActivation` | `granot_lifecycle_activations` | `granot_lifecycle_activation_key_unique` |
| `GranotRecordLink` | `granot_record_links` | `granot_record_link_active_job_unique` (partial `state:"active"`), `granot_record_link_lead_state`, `granot_record_link_booking_state` |

Decision attempt is `processing.match_attempt + 1`. Insert is immutable. Same observation/attempt replay returns the stored Decision when causal inputs agree; a differing candidate is an integrity failure. Technical failure creates no Decision.

Activation is write-once. Body is `{ reason, processor_version }` only. Server supplies `activated_at` and maps the verified Owner actor to `DurableActor` (`origin: "vantage_admin"`). Concurrent/existing row → `409 GRANOT_ALREADY_ACTIVATED`.

Record Link establishment: `provider="granot"`, `state="active"`, `disputed=false`, `domain_revision=0`. `lead_ref`, `booking_ref`, `last_change_id`, `last_changed_at`, and `superseded_by` are absent. Compatible refresh advances only `last_observation_id`, `last_observed_at`, and `domain_revision`.

### Processor interface

```ts
process({ receipt_id, initiator? }) => {
  observation_id, decision_id, outcome, effects, target?
}
```

`effects` use the Section 11 shape. Unit 07 never returns a Lead/Booking target. Historical safe-link Decisions use `linked` / `record_link_established|record_link_confirmed`. Eligible non-link historical attempts use `policy_blocked` / `historical_shadow`. Post-cutoff shadow uses `policy_blocked` / `shadow_effect_suppressed`. Explicit live with all effects false uses `policy_blocked` / `global_effect_disabled`.

### Mode classifier

Absent activation or `captured_at < activated_at` → `historical_shadow`. Equal timestamp is post-cutoff. Channel never affects mode. Stored mode is never recomputed or promoted.

### Projections

- `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`
- `GET /api/v1/admin/granot-lifecycle/operations/health`
- `POST /api/v1/admin/granot-lifecycle/activation`

Reads require Owner/Admin. Activation requires Owner plus trusted signed Admin actor. Capabilities mark the Job timeline incomplete. Health `last_queue_run` and `last_cron_run` are null.

## Flags before / after

| Flag | Before | After |
| --- | --- | --- |
| `GRANOT_LIFECYCLE_PROCESSING_ENABLED` | absent | `true` |
| `GRANOT_LIFECYCLE_SHADOW_MODE` | absent | `true` |
| `GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED` | absent | `false` |
| `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED` | absent | `false` |
| `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` | absent | `false` |
| `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED` | absent | `false` |
| `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED` | absent | `false` |
| `GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED` | absent | `false` |
| `GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED` | absent | `false` |
| `GRANOT_LIFECYCLE_EMAIL_ENABLED` | absent | `false` |

Activation row: **absent**. Capture remains independent of these flags.

## Indexes and migration

- **Data migration:** none. No activation, Decision backfill, receipt batch, or synthesized links.
- Index script version `granot-lifecycle-indexes/5`.
- Report refuses unique create on duplicate `(observation_id, attempt)`, duplicate activation keys, and duplicate active `(provider, normalized_job_no)` groups. IDs in reports are masked.
- Production `--apply` was **not** run. Local test-DB apply was **not** run.

## Verification

Focused:

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/SynchronizationDecision.test.ts" "src/models/GranotLifecycleActivation.test.ts" "src/models/GranotRecordLink.test.ts" "src/config/domain/granotLifecycle.test.ts" "src/services/granotLifecycle/processor.test.ts" "src/services/granotLifecycle/projections.test.ts" "src/services/granotLifecycle/operations.test.ts" "src/routes/granot-lifecycle-admin.routes.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts"
```

- **46 passed, 0 failed, 2 skipped.**
- Skipped: opt-in replica-set Decision/link unique-race and concurrent-activation tests (`GRANOT_LIFECYCLE_REPLICA_TESTS=true` plus `TEST_MODE=true` / `testvantagemovers`). Injected transaction/replay/conflict proofs passed. Live Mongo replica-set commit is **not claimed**.

Full server:

```text
pnpm test
pnpm typecheck
```

- **1065 passed, 0 failed, 3 skipped.**
- Typecheck **passed.**
- `git diff --check` **passed.**

## AC-to-proof coverage

| AC | Unit 07 assertion | Proof |
| --- | --- | --- |
| AC-02 portion | Distinct webhook receipts/Observations → distinct Decisions; same observation/attempt replay → one Decision | `processor.test.ts` `[AC-02] portion` |
| AC-31 foundation | Pre-activation remains `historical_shadow`; live-shadow is not promoted; write-once activation; equal timestamp is post-cutoff | `granotLifecycle.test.ts`, `processor.test.ts`, `operations.test.ts`, `GranotLifecycleActivation.test.ts` |
| AC-32 portion | Historical establish/confirm/conflict keep one active link; zero Domain Commands, Entity Changes, Sheet Sync, Lead/Booking/Cancellation, cases, discrepancies, notifications | `processor.test.ts` `[AC-32] portion`, `GranotRecordLink.test.ts` |
| AC-35 portion | Raw payload/headers and unmasked contact/address/money/source evidence absent from models, projections, logs, metrics, events, fixtures, and errors | model omit tests, `projections.test.ts`, activation projection test, bounded metric labels |

## Historical link and distinct-webhook proof

- Two distinct webhook receipts with identical synthetic evidence produced two attempt-1 Decisions.
- Same observation/attempt replay returned the stored Decision and did not persist a second row.
- Historical reviewed Job Number evidence established one active job-only link; a compatible later Observation confirmed it (`record_link_confirmed`); incompatible Source Scope recorded `conflict` / `record_link_conflict` without altering the link.
- Post-cutoff live-shadow and live (all effects false) paths persisted Decisions and created zero links.

## Privacy, metrics, and forbidden effects

- Job/health projections and activation projection omit payload, headers, contact, money, source label, activation reason, and actor email.
- Decision metric labels are only frozen `{outcome,reason_code,channel}`.
- Processing logs contain causal IDs, mode, outcome/reason, attempt, and duration only.
- Unit 07 effects are only `record_link_established` / `record_link_confirmed`. No Domain Command, Entity Change, Sheet Sync intent, Lead/Booking/Cancellation write, case, discrepancy, or notification path is invoked.

## Masked staging / live verification

Not run. No production activation, no current-payload inspection, no Granot call, and no external send. Synthetic redacted fixtures only. Replica-set Mongo proofs were not executed against a disposable `testvantagemovers` replica set because this environment is not in that posture.

## Known risks and deferred work

- Live Mongo replica-set transaction/concurrency proof remains unverified until a disposable `testvantagemovers` replica set is available and `GRANOT_LIFECYCLE_REPLICA_TESTS=true` is set before process start.
- Section 13's complete “mark disputed” behavior remains Unit 29. Unit 07 records `conflict` / `record_link_conflict` and proves disputed rows remain lookup-visible with synthetic documents.
- Historical safe-link Decisions use `linked` / `record_link_established|confirmed` rather than `policy_blocked` / `historical_shadow`. The latter pair is used when no link is written.
- `SynchronizationEffectSummary` is the Section 11 effects array; Section 7 does not define a separate type.
- DurableActor origin `granot_lifecycle` is not added; Unit 10 owns origin expansion. Activation uses `vantage_admin`.
- Index production apply and rollout activation remain separately authorized.
- Unit 08 claim/drainer/cron, Units 14–15 identity/desired-state, and post-cutoff link mutation remain later.

## Newly unblocked

Successful Unit 07 verification unblocks **Unit 08** (Units 04 and 07 are now both complete). It also contributes its prerequisite to **Units 14 and 22**, which remain blocked on their other dependencies. Shared-branch implementation stays sequential; Unit 09 remains blocked unless an integration owner explicitly authorizes non-overlapping work.

## Final `git status --short`

### vantage-main-server (`granot-lead-lifecycle`)

```text
 M .cursor/businesslogic/granotLifecycle.capture.md
 M .cursor/businesslogic/granotLifecycle.normalization.md
 M .cursor/businesslogic/granotLifecycle.sourcePolicy.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/owner-lead-workflow.mdc
 M .cursor/rules/project-organization.mdc
 M .cursor/rules/schema-and-crud-inputs.mdc
 M scripts/migrations/granot-lifecycle-indexes.lib.ts
 M scripts/migrations/granot-lifecycle-indexes.test.ts
 M scripts/migrations/granot-lifecycle-indexes.ts
 M src/config/domain.ts
 M src/models/granotLifecycleSchemas.ts
 M src/routes/v1.routes.ts
 M src/services/granotLifecycle/metrics.ts
 M src/services/granotLifecycle/types.ts
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M src/validation/v1.validation.ts
?? .cursor/businesslogic/granotLifecycle.processor.md
?? src/config/domain/granotLifecycle.test.ts
?? src/config/domain/granotLifecycle.ts
?? src/models/GranotLifecycleActivation.test.ts
?? src/models/GranotLifecycleActivation.ts
?? src/models/GranotRecordLink.test.ts
?? src/models/GranotRecordLink.ts
?? src/models/SynchronizationDecision.test.ts
?? src/models/SynchronizationDecision.ts
?? src/routes/granot-lifecycle-admin.routes.test.ts
?? src/routes/granot-lifecycle-admin.routes.ts
?? src/services/granotLifecycle/errors.ts
?? src/services/granotLifecycle/operations.test.ts
?? src/services/granotLifecycle/operations.ts
?? src/services/granotLifecycle/processor.test.ts
?? src/services/granotLifecycle/processor.ts
?? src/services/granotLifecycle/projections.test.ts
?? src/services/granotLifecycle/projections.ts
?? src/validation/v1/granotLifecycle.validation.ts
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-07-COMPLETION.md
```

No commit, push, deploy, production mutation, production index apply, production activation, current-payload inspection, Granot call, or external send occurred.
