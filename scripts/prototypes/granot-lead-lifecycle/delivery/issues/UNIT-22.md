# Unit 22 — Booking Reconciliation persistence, sequencing, and read-only reconciliation service

> **Contract maturity: implementation-ready; implementation remains blocked by Unit 18.** This is the server-domain half of S15. It adds the exact Booking case schema/indexes and a transaction-safe open/refresh/sequence/candidate service, but leaves the case effect flag off and executes no owner command. Unit 23 owns read APIs/Admin and the reviewed read-deploy gate before Booking cases may be enabled.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 12.3, 13, 18–21, 23.2, 25, 27, 33–41; especially Sections 19/21, the same-transaction Decision/effect rule in Section 23.2, AC-18–20/36/39/40, Section 34.5, and 38/S15.
- **Acceptance ownership:** full server-domain behavior for AC-18 and AC-19; persistence/revision/sequence portion of AC-20; Booking-case portion of AC-36; server delegation portion of AC-39; Booking-side/non-interference foundation for AC-40. Unit 23 owns read/UI proof; Units 24–25 own owner commands/form concurrency; Unit 26 completes Release coexistence; Unit 29 completes discrepancy persistence.
- **Approved split:** Unit 22 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Units 07/14–15 provide Decisions/links/gates and policy-before-identity/Booking context; Unit 18 supplies the live processor/canonical Lead-effect seam. This unit owns Booking case persistence/service only. Unit 23 owns all external reads/UI. Referral case opening is Unit 28.
- **Execution:** delivery runbook; server rules/docs; verified completion reports and repository state for Units 07, 14, 15, and 18; current Observation/Decision/Record-Link/identity/processor, Booked/Cancelled models, existing Employee `BookingLeadReconciliationCase`, migration tooling, and replica harness.

The final specification wins. A Granot Booking case is owner work backed by evidence, not a Booking, lifecycle enum, or substitute for Employee Booking Lead Reconciliation.

## 2. Objective

Implement `GranotBookingReconciliationCase` and `GranotBookingReconciliation.reconcileObservation` so an eligible post-activation live Priority `5` or actual `booked` Observation can atomically open one Booking case for a normalized Job Number/action kind, refresh that open case without staling an owner form, or allocate the next sequence after resolution. Resolve the current deterministic Booking and safe Lead suggestion/candidates through existing source-scoped identity. Route existing Cancellation, missing-Booking-Lead, ambiguity, and later-unit work without guessing. Persist only case/evidence/current-work context; never create/update a Booking, mutate a Lead/Record Link/Cancellation, execute an owner command, or enqueue Sheet Sync.

## 3. Repository, branch, and prerequisites

- **Repository/branch:** `vantage-main-server` / `granot-lead-lifecycle` only.
- **Prerequisites:** verified Units 07, 14–15, and 18. Units 07/14/15 are recorded complete. Unit 18 currently has only an authored contract and no completion report, so implementation remains blocked until Units 16–18 and accepted cross-channel parity are actually complete.
- Reverify Unit 18's landed processor transaction boundary and ensure this service consumes its prepared Observation/Decision/identity/policy results instead of rerunning normalization, source policy, identity, temporal ordering, or desired-state planning.
- Verify the one-Booking-per-normalized-Job unique index; Unit 14 `booking_context`; active Record Link; Booked/Cancelled revisions; and the existing Employee Booking Lead Reconciliation behavior before edits.
- Runtime writes require `TEST_MODE=true`, an explicit disposable replica-set database, `SHEET_SYNC_MODE=disabled`, all Booking/Release/Referral/email flags false, and redacted synthetic fixtures. No production apply, effect enablement, deployment, current payload access, or external send is authorized.
- Preserve unrelated/user edits. No commit, push, deploy, production mutation, or live data inspection.

## 4. Current-state evidence to verify

Observed on 2026-08-18; reverify after Unit 18 lands:

- `src/models/GranotBookingReconciliationCase.ts` and `src/services/granotLifecycle/bookingReconciliation.ts` do not exist. The Section 21 fields/indexes have not been deployed.
- Shared types already contain case entity refs plus `booking_case_opened`/`booking_case_refreshed` effects and reason codes; do not fork that vocabulary.
- The current processor persists shadow Decisions/links and has no reconciliation invocation. Unit 18 will materially change its live transaction seam; this unit must integrate with the landed seam, not today's scaffolded behavior.
- Identity already returns a deterministic `booking_context` with Booking ref, owner Lead, `booking_lead_reconciliation_required`, Referral/leadless status, and multiple-Booking conflict. Consume it; do not issue a second global contact/Booking match.
- `BookedLead` has normalized Job identity, one-Booking unique index, Lead/referral/leadless state, Cancellation ref, and revisions. `CancelledLead` remains the official Cancellation fact.
- Existing `BookingLeadReconciliationCase` is a separate Employee/external-ingestion workflow with different states/revisions/APIs. It must remain separate and is never renamed/reused as the Granot case.
- The fixed index migration exists but has no Granot Booking-case declarations/collision checks. The replica harness has no Unit 22 suite.
- Lifecycle configuration already defaults Booking cases/commands false; historical/live-shadow processing is prohibited from opening cases.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo Booked/Cancelled/Lead/Record-Link facts determine the case view; Granot evidence or a cached candidate does not override them.
- **Invariant 2:** Priority `5`/Booked evidence opens owner work only. It never creates/updates a Booking or creates/reverses a Cancellation.
- **Invariant 3:** case mode/state is workflow state, not a stored Lead Lifecycle enum.
- **Invariant 4:** resolve at most one Booking by normalized Job Number; multiple rows are a hard conflict and never candidate choice.
- **Invariants 5–7:** this unit invokes no Lead/Booking/Cancellation domain command and creates no `DomainCommandExecution`, `EntityChange`, revision transition on those aggregates, or Sheet outbox—even on open/refresh/no-case paths.
- **Invariants 8–10:** case scope/evidence preserves channel, source, origin, actor, and initiator axes; suggestions never overwrite immutable evidence or reassign Source Company, Granularity, Ingestion Origin, or CPL.
- **Invariant 11:** duplicate Form Leads are never candidates; Bad Form Leads cannot be suggested or booked and exact identity only retains its prior evidence/Priority exception.
- **Invariant 12:** a resolved case is immutable and never reopened. Later same-kind evidence allocates the next sequence.
- Booking and Release cases are independent and may coexist; this service never queries, closes, or changes Release work.

## 6. Deliverables and exact contract

### 6.1 Exact model

Add `src/models/GranotBookingReconciliationCase.ts` and shared sub-schemas under the named lifecycle schema seam. Preserve Section 21 exactly:

```ts
type CaseState = "open" | "resolved";
type ActionKind = "booked" | "release";
type CaseEvidence = {
  observation_id: ObjectId;
  decision_id: ObjectId;
  captured_at: Date;
  action: "priority_5" | ActionKind;
};

type NoActionReasonCode =
  | "already_handled_elsewhere"
  | "granot_action_not_authoritative"
  | "wrong_customer_or_job"
  | "duplicate_granot_action"
  | "booking_still_valid"
  | "granot_change_only"
  | "insufficient_information"
  | "legacy_data"
  | "other";
```

Retain the decision-rich document shape:

```ts
type GranotBookingReconciliationCaseDocument = {
  _id: ObjectId;
  normalized_job_no: string;
  job_no_snapshot: string;
  action_kind: "booked";
  sequence_number: number;
  mode:
    | "create_missing_booking"
    | "review_existing_booking"
    | "create_referral_booking";
  state: CaseState;
  case_revision: number;
  evidence_revision: number;
  source_scope?: {
    granot_crm_source_id: ObjectId;
    lead_source_company: ObjectId;
    source_granularity_id: ObjectId;
  };
  record_link_id?: ObjectId;
  deterministic_booking_id?: ObjectId;
  evidence: CaseEvidence[];
  observed_context: {
    contact?: { name?: string; phone_number?: string; email?: string };
    move_date?: Date;
    estimated_cubic_feet?: number;
    estimate?: string;
    payment?: string;
    balance?: string;
    granot_priority?: string;
    granot_username?: string;
  };
  suggested_lead?: {
    lead_ref: { model: LeadModel; id: ObjectId };
    confidence: "high" | "medium";
    match_method: string;
    reason_codes: string[];
  };
  resolution?: {
    outcome:
      | "booking_created"
      | "booking_updated"
      | "referral_booking_created"
      | "no_action"
      | "already_satisfied"
      | "superseded_by_current_state";
    command_execution_id: ObjectId;
    actor: DurableActor;
    reason_code?: NoActionReasonCode;
    reason_text?: string;
    resolved_at: Date;
    entity_ref?: EntityRef;
  };
  opened_at: Date;
  last_evidence_at: Date;
  resolved_at?: Date;
};
```

Preserve the complete resolution union (`booking_created | booking_updated | referral_booking_created | no_action | already_satisfied | superseded_by_current_state`) and `NoActionReasonCode` in the schema for later commands, but Unit 22 exposes no writer for `resolution`, `state:"resolved"`, or `resolved_at`. `reason_code`/`reason_text` remain optional metadata, never decision logic.

Declare exact indexes:

```ts
{ normalized_job_no: 1, action_kind: 1 } // unique where state:"open"
{ normalized_job_no: 1, action_kind: 1, sequence_number: 1 } // unique
{ state: 1, last_evidence_at: -1 }
{ deterministic_booking_id: 1, state: 1 }
{ "suggested_lead.lead_ref.model": 1, "suggested_lead.lead_ref.id": 1, state: 1 }
```

Use explicit deterministic names exported with the model for Section 34.5 verification. Application/model middleware rejects mutation of evidence IDs already present and any transition from resolved back to open.

### 6.2 Trigger and mode table

The processor calls reconciliation only after normalization, reviewed source policy/identity, activation/execution-mode, and a prepared/evaluated gate snapshot. The effect-bearing Decision is not persisted before the case transaction. Exact behavior:

| Evidence/current fact | Result |
| --- | --- |
| eligible matched Lead + Priority `"5"`, no Booking, non-Referral | open/refresh `create_missing_booking` |
| eligible matched Lead + Priority `"5"`, one Booking | no new review case |
| actual `booked`, no Booking, non-Referral, including pending/ambiguous Lead candidate | open/refresh `create_missing_booking`; ambiguity means no suggestion, not no case |
| actual `booked`, one active Booking | open/refresh `review_existing_booking` with deterministic Booking ID |
| actual `booked`, officially cancelled Booking | no Booking case; return the typed `booked_after_official_cancellation` discrepancy-routing classification for Unit 29 |
| existing Booking missing Lead | no Granot case/discrepancy; delegate/display the existing `BookingLeadReconciliationCase` workflow |
| Referral Booked/no Booking | schema-compatible but no case in Unit 22; Unit 28 owns opening |
| historical shadow, live shadow, disabled gate, malformed/unsupported action, Priority other than `5` without Booked, Bad/Duplicate Priority target, or missing Job | no case/effect |
| Record-Link/Job/Source identity conflict | no normal case; preserve the later discrepancy-routing seam without guessing |

Priority and Booking Action are independent. A malformed Priority on a valid Booked action does not suppress the Booked path. Priority `5` alone never opens `review_existing_booking`. Actual Booked and Release work never auto-close each other.

Discrepancy routing is non-persisting here: return the canonical `GranotDiscrepancyReasonCode` to the processor/later seam, but do not claim `booking_discrepancy_opened/refreshed` or create a model before Unit 29. For missing-Lead Booking, require/return the existing Employee reconciliation ref when present; if repository state lacks the expected work item, fail closed with a PII-safe operational error/deferred result rather than creating a second workflow or inventing an `EntityRef` member.

### 6.3 Reconciliation interface and transaction

Preserve the final deep interface:

```ts
interface GranotBookingReconciliation {
  reconcileObservation(input: {
    observation_id: string;
    decision_id: string;
  }): Promise<CaseEffectResult>;
  // Owner methods remain unavailable/disabled until Units 24–25/28.
}
```

`CaseEffectResult` is internal issue-author guidance, not a new persisted outcome vocabulary: it is a discriminated result for `opened`, `refreshed`, `none`, `employee_booking_lead_reconciliation`, or `booking_discrepancy_required`; opened/refreshed carry the canonical Section 7 reason/effect and case ref, while non-effects carry only a closed internal classification.

The processor preallocates the immutable Decision ID and passes it with the Observation ID. Integrate with Unit 18's transaction/store seam so the Decision carrying the case effect and the open/refresh case write commit coherently; never persist a case evidence ref to a nonexistent Decision or mutate an immutable Decision afterward. Routes/consumers cannot call this with payload data.

Inside one Mongo transaction:

1. re-read the immutable Observation plus active link, current Booking/Cancellation, source scope, and eligible identity context; consume the processor's prepared, not-yet-persisted Decision/gate document with its preallocated ID;
2. find the open `{ normalized_job_no, action_kind:"booked" }` case;
3. if open, append evidence only when its Observation ID is new, refresh normalized display context, and update permitted owner-relevant current work;
4. if absent, allocate `max(sequence_number for job+kind)+1`, insert with both revisions `1`, and retry once on the sequence/open unique race;
5. insert that effect-bearing Decision and the winning case open/refresh in the same transaction, then return the result; never persist the Decision early or reopen a resolved row.

Two simultaneous first opens yield one open case; the loser rereads and deduplicating-refreshes that winner. A resolved-race yields one next sequence. Unbounded retry is forbidden.

### 6.4 Evidence and revision rules

- Evidence contains only Observation/Decision IDs, capture time, and action; append/dedupe by Observation ID. Never copy receipt payload/header or contact into `evidence`.
- `observed_context` is the bounded normalized owner-display snapshot defined in Section 21; it may contain normalized contact/move/money/Agent evidence but is never official Booking default/input.
- Opening sets `case_revision=1` and `evidence_revision=1`.
- New evidence on an open case increments only `evidence_revision`. Duplicate Observation replay changes neither revision/timestamp nor array.
- Evidence arrival alone never changes mode or `case_revision`, even when a Booking appeared since open; project newly live official facts separately. The final specification does not authorize automatic case-mode transitions.
- Background candidate refresh may run for 24 hours. A real suggestion/candidate-current-state change is owner-relevant and increments `case_revision`; an unchanged refresh does not. Refresh never selects/attaches/corrects a Lead.
- Resolved rows reject every later write. Later evidence creates the next sequence.

### 6.5 Suggestion and candidate policy

Use existing source policy/identity outputs and canonical match vocabulary:

- active Record Link, exact eligible Form `ref_no`/ObjectId compatibility, or exact eligible Call Job Number -> high confidence and may be preselected;
- Source Scope contact -> medium confidence, display only;
- ambiguity -> no suggestion;
- default candidate search scope is exact Source Scope; an Owner may later request all eligible Leads;
- duplicate Form and Bad Form Leads are never suggested/candidates; current eligibility is rechecked;
- out-of-scope selection/correction belongs to Units 23–24/29 and requires later warning/reason/command evidence.

Constrain `match_method`/`reason_codes` to landed canonical identity vocabulary despite the persistence type being `string`. Do not implement a second matcher or global contact search. Unit 22 provides internal safe candidate projection/search functions for Unit 23, but no HTTP route.

### 6.6 Observability and privacy

Emit PII-safe case `open`/`refresh` Operational Events. Set/recompute `granot_lifecycle_open_cases{kind="booking",mode}` from current open-case cardinality; an evidence refresh does **not** increment that gauge. Use case/Observation/Decision/source IDs only in masked/bounded form. No payload/header, secret, full contact/address, Granot money text, actor label, or customer data enters logs, metrics, index manifests, errors, or handoff.

## 7. Explicitly out of scope

- Case list/detail/Job/Lead timeline routes, candidate HTTP endpoint, Admin UI/navigation/query keys, masking presentation, or read enablement (Unit 23).
- Confirm Booking, Update Booking, No Action, case resolution, owner input/revision/idempotency, Record Link correction, or any Booking/Cancellation/Lead command (Units 24–25/29).
- Opening Referral cases or creating leadless Referral Bookings (Unit 28); the schema union is compatibility only.
- Release case persistence/reads/commands (Units 26–27), discrepancy persistence/correction (Unit 29), complete health/alerts (Unit 30), email (Unit 32), or cleanup.
- Reimplementing identity/source policy/desired state, changing the Employee `BookingLeadReconciliationCase`, auto-attaching a Lead, or a generic reconciliation model.
- Production index apply, flag enablement, deployment, current payload inspection, or raw/unmasked data.

## 8. Flags and runtime posture

Checked-in/start/end posture remains:

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

Historical shadow and live shadow never open/refresh cases. Tests inject live activation and Booking-case true only in the disposable environment. S15 permits Booking cases true only after Unit 23's read UI is deployed/reviewed; Unit 22 ends with the flag false. Commands and all later effects remain false.

## 9. Migration and indexes

No document backfill. Extend Section 34.5 tooling for all five exact Booking-case indexes:

```text
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:indexes -- --verify
```

Report collisions for open `{job,kind}` and `{job,kind,sequence}` unique keys; create the three non-unique indexes first; create unique indexes only after zero collisions; verify names/keys/unique/partial definitions. Manifests are deterministic/PII-safe/idempotent. Production apply is separately authorized. Existing collections may be absent/empty; tooling must handle that deterministically without bypassing the report.

## 10. Acceptance criteria

- [ ] **AC-18:** Priority `5` plus eligible matched Lead/no Booking opens or evidence-refreshes `create_missing_booking`; Priority `5` alone with an existing Booking opens no review case.
- [ ] **AC-19:** actual Booked/no Booking opens create-missing; actual Booked/one active Booking opens review-existing with that deterministic Booking; no path creates a Booking/second Booking.
- [ ] **AC-20 (persistence portion):** same-kind evidence refreshes one open case, dedupes by Observation ID, increments evidence—not case—revision; resolved cases never reopen and later evidence gets next sequence.
- [ ] **AC-36 (Booking portion):** real concurrent evidence satisfies open and sequence unique indexes with one bounded retry and one open winner.
- [ ] **AC-39 (server portion):** an existing Booking without Lead delegates to existing Booking Lead Reconciliation and produces no Granot case/discrepancy/duplicate workflow.
- [ ] **AC-40 (Booking foundation):** Booking-side work never reads/closes/changes Release work; the schema/service permits later same-Job coexistence without a generic uniqueness constraint.
- [ ] High/medium/ambiguous suggestion rules, Bad/Duplicate exclusions, 24-hour non-attaching refresh, and current eligibility are exact.
- [ ] Officially cancelled Booking uses the non-persisting Unit 29 routing seam; Referral remains Unit 28; neither is falsely claimed complete.
- [ ] Every open/refresh is causally tied to Observation/Decision and privacy-safe, while Lead/Booking/Cancellation/Record-Link, Command, Change, outbox, discrepancy, notification, and email counts remain zero.

## 11. Required tests and commands

Name tests with AC-18, AC-19, AC-20, AC-36, AC-39, and AC-40 as allocated. Required:

- model tests for every field/enum/constant, exact five indexes, defaults, resolved immutability, evidence append/dedupe, and privacy;
- module tests for the trigger/mode table, malformed-Priority-independent Booked, high/medium/ambiguous suggestions, Bad/Duplicate exclusion, Booking-without-Lead delegation, cancelled/referral routing, opposite-kind non-interference, and zero forbidden effects;
- replica-set tests for simultaneous open, duplicate evidence, max+1 race/one retry, resolved-vs-new-sequence race, Decision/case atomicity, rollback at each write, and revision split;
- migration tests for collision reports, ordering, definitions, absent/empty collection, idempotent report/verify, and apply guard;
- processor integration tests proving activation/live/gate requirements and checked-in false posture.

Run from `vantage-main-server`:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/models/GranotBookingReconciliationCase.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts src/services/granotLifecycle/processor.test.ts scripts/migrations/granot-lifecycle-indexes.test.ts
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=22
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck
```

Use landed equivalents if filenames differ. Mocked uniqueness/transactions are insufficient. Never run apply without authorization.

## 12. Live/staging verification

Unit 22 performs isolated synthetic service verification only because its case flag ends false. With replica-set test DB, activation, live execution, and test-injected gate true, exercise Priority-5/create-missing, Priority-5/existing no-case, Booked create/review, repeated evidence, resolved-next-sequence, candidate confidence/ambiguity, missing-Lead delegation, cancelled/referral routing, and concurrent opens. Inspect masked case/Observation/Decision IDs, revisions, modes, counts, and index definitions; prove zero official aggregate/Command/Change/outbox/discrepancy/notification effects.

Joint S15 staging/live verification occurs only after Unit 23 deploys reads. Production remains read-only and flag-off unless separately approved. Stop on duplicate open case/sequence, resolved-row mutation, evidence staling case revision, wrong Booking, Bad/Duplicate suggestion, missing-Lead duplicate workflow, raw-data exposure, or any official mutation.

## 13. Rollback

Leave/set `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false`. Do not disable capture or delete/unwind the additive schema/indexes. Existing cases remain readable once Unit 23 exists. Preserve receipts, Observations, Decisions, activation, Record Links, case evidence/revisions, audits, Commands/Changes, and committed official facts.

Never resolve/reopen/delete cases, create compensating Booking/Cancellation mutations, detach suggestions/links, or rewrite immutable evidence automatically. A faulty service caller is disabled before any data repair; repair requires a separately reviewed, report-first contract.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-22-COMPLETION.md` using Runbook Section 13. Include verified prerequisites; repository/branch; model/schema/service/processor/index/test/docs files; exact trigger/mode/result/revision/sequence/candidate/delegation contracts; invariants and partial AC ownership; migration report/apply/verify; flags before/after; focused/full/replica results; masked race/atomicity/evidence/revision/routing/privacy/forbidden-effect proof; rollout actions (normally none); risks; final Git status; and external-action statement.

Successful implementation unblocks Unit 23 contract-permitted implementation. Booking cases still cannot be production-enabled until Unit 23 read UI is deployed/reviewed; owner commands remain blocked for Units 24–25.
