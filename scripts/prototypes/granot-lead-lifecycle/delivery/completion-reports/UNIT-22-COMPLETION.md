# Unit 22 — Booking Reconciliation persistence, sequencing, and read-only reconciliation service

**Status:** Complete  
**Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle` (only repository touched)

## Authority and prerequisites

Implemented final-spec Sections 1–7, 12.3, 13, 18–21, 23.2, 25, 27, 33–41 and the Unit 22 contract. This unit owns full server behavior for AC-18/19, the persistence/revision/sequence portion of AC-20, the Booking-case portion of AC-36, server delegation for AC-39, and the Booking non-interference foundation of AC-40.

Prerequisites were reverified from repository state before edits:

- Units 07/14/15/18 are complete and landed. The processor preallocates Decision IDs and has a Mongo transaction seam.
- Unit 14 identity returns deterministic Booking context and employee Booking Lead Reconciliation delegation.
- `BookedLead` declares unique normalized Job identity; one Booking is never guessed from multiple rows.
- Checked-in flags began and end with processing/shadow true and all case/command/email effects false.
- Work remained on `granot-lead-lifecycle`; the worktree was initially clean.

Unit 22 completes the server-domain half of S15 and makes Unit 23 ready. It does not authorize case reads in production or any owner command.

## Behavior delivered

### Model and indexes

`GranotBookingReconciliationCase` preserves the exact decision-rich Section 21 shape: Job/action/sequence/mode/state, separate case/evidence revisions, Source Scope/Record Link/deterministic Booking refs, four-field causal evidence, bounded observed context, optional suggestion, complete later-unit resolution union, and timestamps. Unit 22 exposes no resolution writer.

Five deterministic indexes are declared and migration-verifiable:

1. partial unique open `{ normalized_job_no, action_kind }`;
2. unique `{ normalized_job_no, action_kind, sequence_number }`;
3. `{ state, last_evidence_at }`;
4. `{ deterministic_booking_id, state }`;
5. `{ suggested_lead.lead_ref.model, suggested_lead.lead_ref.id, state }`.

Model/application guards preserve existing evidence IDs, require direct mutation filters to fence on `state:"open"`, forbid replacement/evidence removal, and make resolved documents immutable.

### Trigger, routing, and non-interference

- Priority `5` + eligible matched Lead + no Booking opens/refreshes `create_missing_booking`.
- Priority `5` + existing Booking opens no review case.
- Actual Booked + no Booking opens/refreshes create-missing even when Priority is malformed or Lead identity is pending/ambiguous; ambiguity stores no suggestion.
- Actual Booked + one deterministic active Booking opens/refreshes `review_existing_booking` with its Booking ID.
- Official cancellation returns `booked_after_official_cancellation` for Unit 29 without discrepancy persistence.
- Booking without Lead returns the existing `BookingLeadReconciliationCase`; an unexpectedly missing work item fails closed and persists only the already prepared Decision.
- Referral stays Unit 28 work. Release/opposite-kind evidence creates and changes no Booking case.
- Identity/Job/Source conflict returns the typed later discrepancy seam without choosing a candidate.

The service rereads the immutable Observation, active Record Link, current source-scoped identity, deterministic Booking/Cancellation, and employee reconciliation work. It consumes Unit 14 Booking context and reloads that Booking by ID; it does not run a second global Booking/contact matcher.

### Atomicity, races, and revisions

The processor is the only caller and passes exactly `{ observation_id, decision_id }` after activation/live classification and Booking-case gates. Historical/live shadow and checked-in false posture never call the effect service.

Inside one Mongo transaction, open/refresh and the effect-bearing immutable Decision commit together. A first open starts both revisions at 1. New Observation evidence appends once and increments only `evidence_revision`; exact replay changes neither revision, evidence, nor timestamp. A true suggestion/current-work change increments `case_revision`. Evidence never changes case mode. Later evidence after resolution allocates `max(sequence_number)+1` and never reopens the resolved row.

Open/sequence duplicate-key or write-conflict races receive one bounded explicit retry. Replica tests prove simultaneous first opens and simultaneous next-sequence allocation converge to one open winner and one deduplicating refresh. Injected failures after case create and after refresh roll back the case/evidence and Decision together.

### Candidate and observability policy

Suggestion/candidate projection consumes only canonical Unit 14 match vocabulary. Record Link/exact Form/exact Call Job/Booking-owner matches are high confidence; Source Scope contact is medium; ambiguity has no suggestion. Duplicate and Bad Form candidates are excluded. Internal candidate search rereads current identity, is limited to 24 hours from opening, and never attaches/corrects a Lead.

Case open/refresh Operational Events use masked case/Observation/Decision IDs and no payload/contact/money/secret/header content. `granot_lifecycle_open_cases{kind="booking",mode}` is recomputed from current open-case cardinality; refresh does not increment it as a counter.

## Files

### Production behavior

- `src/models/GranotBookingReconciliationCase.ts` — exact schema, constants, five indexes, immutability guards.
- `src/models/granotLifecycleSchemas.ts` — shared closed Booking-case/reconciliation vocabularies.
- `src/services/granotLifecycle/bookingReconciliation.ts` — classification, atomic service/store, one-retry convergence, replay/revision logic, current Booking/identity resolution, safe candidate projection/search, audit/gauge updates.
- `src/services/granotLifecycle/processor.ts` — activation/live/gate-only Booking reconciliation orchestration and prepared Decision handoff.
- `src/services/granotLifecycle/metrics.ts` — bounded open Booking-case cardinality gauge.

### Migration, tests, and harness

- `scripts/migrations/granot-lifecycle-indexes.lib.ts` / `.ts` — version 10, collision reporting, three-non-unique-before-two-unique ordering, absent-collection handling, apply refusal, exact verification and masked manifest output.
- `scripts/migrations/granot-lifecycle-indexes.test.ts` — AC-36 collision/order/empty/idempotent/definition coverage.
- `src/models/GranotBookingReconciliationCase.test.ts`.
- `src/services/granotLifecycle/bookingReconciliation.test.ts`.
- `src/services/granotLifecycle/bookingReconciliation.replica.test.ts`.
- `src/services/granotLifecycle/processor.test.ts`.
- `src/services/granotLifecycle/metrics.test.ts`.
- `scripts/test-granot-lifecycle-replica.ts` — registers `--unit=22`.

### Documentation

- `.cursor/businesslogic/granotLifecycle.bookingReconciliation.md` — new runtime/domain contract.
- `.cursor/businesslogic/granotLifecycle.processor.md` — processor orchestration and out-of-scope update.
- `.cursor/rules/project-organization.mdc` — model/service map.
- `scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md` — Unit 22 complete; Unit 23 ready.

## AC-to-proof coverage

| Acceptance | Proof |
| --- | --- |
| AC-18 | Classification/persistence tests cover eligible Priority 5 open/refresh and existing-Booking no case; processor test proves live/gate-only invocation. |
| AC-19 | Tests cover malformed-Priority-independent actual Booked create/review and deterministic Booking ID; service exposes no Booking writer. |
| AC-20 | Unit and replica tests prove append/dedupe, evidence-vs-case revision split, immutable resolved row, and next sequence. |
| AC-36 | Replica simultaneous open and resolved-next-sequence races converge under real unique indexes and Mongo transactions with one explicit retry. |
| AC-39 | Unit 14 deterministic employee workflow is consumed; missing work fails closed; no Granot case/discrepancy is created. |
| AC-40 | Release/opposite-kind paths are classified out; uniqueness is scoped by action kind and no generic Job uniqueness exists. |

## Migration and index posture

Commands ran only against disposable `testvantagemovers` with `TEST_MODE=true`:

```text
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --verify
```

- Report exited 0 with script version `granot-lifecycle-indexes/10`; Booking-case collision arrays were empty and identifiers were masked.
- All five Booking-case indexes were created by the Unit 22 replica fixture and verified exactly by focused tests/runtime verification.
- The aggregate verify command exits nonzero because the shared test database lacks 20 pre-existing index definitions from prior units (CRM source, Decision, activation, Entity Change, Lead S08, and Call Log singleton indexes). None of the five Booking-case names is missing or mismatched.
- **No `--apply` was run.** Production apply remains separately authorized. Runtime does not silently apply indexes.

## Flags before and after

| Setting | Before | After |
| --- | --- | --- |
| processing / shadow | true / true | true / true |
| Lead writes / creation | false / false | false / false |
| Booking cases / commands | false / false | false / false |
| Release cases / commands | false / false | false / false |
| Referral Booking / email | false / false | false / false |

Tests inject post-activation `live` plus Booking-case true only in the disposable environment. No Registry or runtime flag was enabled.

## Verification

Focused issue command plus metrics:

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/models/GranotBookingReconciliationCase.test.ts \
  src/services/granotLifecycle/bookingReconciliation.test.ts \
  src/services/granotLifecycle/processor.test.ts \
  scripts/migrations/granot-lifecycle-indexes.test.ts \
  src/services/granotLifecycle/metrics.test.ts
```

- 71 tests: 70 passed, 0 failed, 1 skipped (the pre-existing processor replica gate).

Replica:

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled \
pnpm test:granot-lifecycle:replica -- --unit=22
```

- 3 tests: 3 passed, 0 failed, 0 skipped. Real replica-set proofs include simultaneous open, duplicate replay, concurrent max+1 after resolution, case/Decision atomicity, create/refresh rollback, and case/evidence revision split.

Repository:

```text
pnpm test
pnpm typecheck
git diff --check
```

- `pnpm test`: 1,422 tests; 1,366 passed, 0 failed, 56 skipped (opt-in replica suites).
- `pnpm typecheck`: passed.
- `git diff --check`: passed (CRLF advisories only).
- No separate lint/build script exists.

## Privacy and forbidden-effect proof

- Evidence contains only Observation/Decision IDs, capture time, and action. Payload/header/contact/money is absent.
- Audit tests assert raw Observation/Decision IDs are absent; migration tests assert raw document IDs and Job value are absent from collision output.
- Unit/replica paths write only synthetic receipts, Observations, Decisions, and Booking cases. No Lead, Booking, Cancellation, Record Link, Domain Command, Entity Change, Sheet outbox, discrepancy, notification, or email effect is invoked.
- Failed test-run synthetic rows were explicitly scoped by `^U22-` and removed from `testvantagemovers`: 15 receipts, 15 Observations, and 6 Decisions; no case rows remained. These disposable fixtures are not recoverable or needed.

## Rollout, risks, and deferred work

No rollout action was performed. Production remains capture/shadow-only with Booking cases false. Required future order is: authorized report/apply/verify of indexes, Unit 23 read API/Admin deployment and review, then separately approved narrow case enablement. Owner Booking commands stay blocked for Units 24–25.

Known risks/deferred work:

- The five indexes must be applied/verified before case enablement; runtime uniqueness relies on them.
- Unit 23 owns read APIs, masking presentation, candidate browser, timelines, and reviewed read-deploy gate.
- Units 24–25 own owner resolution, input revisions/idempotency, and Booking commands. Unit 28 owns Referral; Unit 29 owns discrepancy persistence/correction.
- The shared test database's prior-unit index drift prevents aggregate migration verify from being a single green gate until an authorized reconciliation apply.

## Newly unblocked units

Unit 23 is ready. Units 24–25 remain blocked on Unit 23 and owner review. Unit 26 remains blocked on Unit 23. No effect flag is newly authorized.

## Repository state and external actions

Final `git status --short`:

```text
 M .cursor/businesslogic/granotLifecycle.processor.md
 M .cursor/rules/project-organization.mdc
 M scripts/migrations/granot-lifecycle-indexes.lib.ts
 M scripts/migrations/granot-lifecycle-indexes.test.ts
 M scripts/migrations/granot-lifecycle-indexes.ts
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/models/granotLifecycleSchemas.ts
 M src/services/granotLifecycle/metrics.test.ts
 M src/services/granotLifecycle/metrics.ts
 M src/services/granotLifecycle/processor.test.ts
 M src/services/granotLifecycle/processor.ts
?? .cursor/businesslogic/granotLifecycle.bookingReconciliation.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-22-COMPLETION.md
?? src/models/GranotBookingReconciliationCase.test.ts
?? src/models/GranotBookingReconciliationCase.ts
?? src/services/granotLifecycle/bookingReconciliation.replica.test.ts
?? src/services/granotLifecycle/bookingReconciliation.test.ts
?? src/services/granotLifecycle/bookingReconciliation.ts
```

All changes remain uncommitted. No predecessor/user work was discarded, reset, or overwritten.

**No commit, push, deploy, production mutation, production read/report/verify, index apply, live payload inspection, provider request, Registry change, external Sheet/CRM send, notification, email, or flag enablement occurred.** Only synthetic disposable replica-set test data was written and cleaned up in `testvantagemovers`.
