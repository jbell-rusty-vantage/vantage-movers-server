# Unit 26 — Release Reconciliation persistence, projections, and read-only Admin workflow

> **Contract maturity: implementation-ready; implementation status: ready.** This is S17 only. It adds durable read-only Release Reconciliation and its server/Admin projections. It exposes no Release owner mutation and gives Granot evidence no authority to update a Booking or create/reverse a Cancellation.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 12.3, 13, 18, 20–23.2, 25, 27–29, 34–41; especially Section 21.1/21.3–21.5, Section 20 routing, AC-25/26/27/35/36/40, and Section 38/S17.
- **Acceptance ownership:** Unit 26 owns the Release read/persistence portions of AC-25–27, the Release projection portion of AC-35, the Release case/index portion of AC-36, and Release/Booked coexistence in AC-40. Unit 27 owns all Release owner commands. Unit 29 owns discrepancy persistence and correction.
- **Approved split:** Unit 26 in `specs/lead_lifecycle_issue_breakdown_reccomendation.md`; preserve the S17 no-commands boundary.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`, repository/Admin instructions and applicable rules, verified Unit 22–25 completion reports, and current code rather than the ledger alone.

The final specification wins. `release` is a repeatable Granot Booking Action: it means the Rep released the job to edit it or because the customer cancelled. It is evidence, not an official Vantage Cancellation fact.

## 2. Objective

Deliver the Release read half end to end. A valid live Release against the one active compatible Booking opens or refreshes one sequence-numbered `GranotReleaseReconciliationCase`, atomically with its `SynchronizationDecision`. An already officially cancelled Booking records `already_current`/`booking_already_cancelled` and opens no case. Missing or conflicting current facts return the exact Release-discrepancy routing seam without persisting a discrepancy yet. Protected APIs and Admin then show combined Booking/Release queues, Release detail, immutable evidence, the deterministic live Booking, and non-collapsed Job/Lead timelines—with zero owner commands and zero Lead/Booking/Cancellation/Sheet effects.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle` and `vantage-admin` / `granot-lead-lifecycle`. Server DTOs and error behavior are authoritative. No extension work.
- **Prerequisites:** Units 22–23 complete and stable Booking reads/identity. Reverify Unit 22 case race/revision patterns, Unit 23 projection/cursor/privacy patterns, Unit 14 deterministic Booking context, Unit 15/18 processor/Decision transaction seam, Unit 07 Record Link, and the Booking/Cancellation normalized-Job facts.
- Units 24–25 are not specification prerequisites, but they are now landed. Preserve their routes, command capabilities, Admin drafts, and query invalidations; do not modify standard Booking behavior while adding Release reads.
- As of 2026-08-19, Units 22–25 are complete, Unit 23 read-only Preview review is accepted, and the authorized `testvantagemovers` index apply/verify reported all predecessor definitions green. Production index posture remains independently unproven. Unit 26 is therefore contract- and sequence-ready after repository re-verification.
- Runtime writes are limited to redacted synthetic `TEST_MODE=true` data on an explicitly confirmed replica-set database. No commit, push, deploy, production mutation/index apply, live payload read, flag enablement, or external send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-19:

- Shared vocabulary already contains `release`, `release_case_opened`, `release_case_refreshed`, `booking_already_cancelled`, Release discrepancy reasons, and `GranotReleaseReconciliationCase` as an `EntityRef`, but no Release model/service/test exists.
- `bookingReconciliation.ts` deliberately classifies `release` as `opposite_action_kind`; `processor.ts` deliberately excludes Release from `maybeReconcileBooking`. Extend with a separate `releaseReconciliation` module instead of widening Booking-case policy.
- `GranotBookingReconciliationCase` provides the required schema/index/immutability and one-bounded-retry sequence pattern. Reuse shared sub-schemas and helpers, but create the distinct final-spec Release model/collection—never a generic case model.
- `projections.ts` already reserves `kind:"release"`, Release timeline discriminants, `release_cases` capabilities, and filters, but returns an empty page for `kind=release`, resolves detail only from the Booking collection, and hard-codes Release capability false. Replace those reservations with real Release projections without changing cursor ordering or masking.
- Admin already accepts the Release filter and renders capability badges/discriminants, while case detail and owner actions are Booking-only. Extend the typed server projection; do not recreate Release business rules or add action buttons.
- `BookedLead` has `normalized_job_no`, `domain_revision`, `cancelled`, leadless/Referral flags, and the unique normalized-Job index. `CancelledLead` and the Booking `cancelled` ref are official current facts; either proves official cancellation.
- Checked-in defaults are processing/shadow true and every effect flag false. Existing tests inject only their owned flags.

The implementing agent must date and correct this evidence if the shared branch has moved.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** current Mongo Booking, Cancellation, Record Link, and case rows—not Granot wording or Admin cache—determine routing and display.
- **Invariant 2:** Release evidence never cancels, updates, or reactivates a Booking.
- **Invariant 3:** Release is an observation/action and case work item, not a stored lifecycle-state enum.
- **Invariant 4:** deterministic lookup uses the one normalized-Job Booking; ambiguity/conflict never chooses a Booking.
- **Invariant 5:** this read-only unit invokes no canonical aggregate command. Unit 27 will be the only Release mutation seam.
- **Invariants 6–7:** no aggregate mutation, `EntityChange`, or Sheet Sync work may arise from case open/refresh, already-cancelled, discrepancy routing, API reads, or Admin reads.
- **Invariants 8–10:** preserve provenance axes, immutable submitted/creation evidence, Source Scope, Ingestion Origin, and CPL. A conflict routes to review and never reassigns identity.
- **Invariant 11:** Bad/Duplicate Form restrictions remain unchanged; Release targets the deterministic Booking and does not contact-match another Lead.
- **Invariant 12:** one open Release case exists per normalized Job/action kind; refresh never changes sequence or reopens a resolved case; later Release evidence allocates the next sequence. Booking and Release cases may coexist and never auto-close each other.

## 6. Deliverables and exact contract

### 6.1 Release case model and indexes

Add `src/models/GranotReleaseReconciliationCase.ts` and reuse `granotLifecycleSchemas.ts` shared case evidence, actor, state, and No Action vocabulary. The persisted contract is:

```ts
type GranotReleaseReconciliationCaseDocument = {
  _id: ObjectId;
  normalized_job_no: string;
  job_no_snapshot: string;
  action_kind: "release";
  sequence_number: number;
  state: "open" | "resolved";
  case_revision: number;
  evidence_revision: number;
  source_scope?: {
    granot_crm_source_id: ObjectId;
    lead_source_company: ObjectId;
    source_granularity_id: ObjectId;
  };
  record_link_id?: ObjectId;
  deterministic_booking_id: ObjectId;
  booking_revision_at_open: number;
  evidence: Array<{
    observation_id: ObjectId;
    decision_id: ObjectId;
    captured_at: Date;
    action: "release";
  }>;
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
    lead_ref: { model: "FormLead" | "CallLead"; id: ObjectId };
    confidence: "high" | "medium";
    match_method: string;
    reason_codes: string[];
  };
  resolution?: {
    outcome:
      | "cancellation_created"
      | "booking_updated"
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

The final specification says to use the same common fields and indexes as the Booking case. Keep `suggested_lead` optional for shape/index parity but do not populate it in this unit: Release does not select a Lead. Release has no specified persisted mode enum; as narrow issue-author projection guidance, return `mode:"release"` in list/detail DTOs without storing a lifecycle enum.

Declare and migration-register all five Release equivalents:

```ts
{ normalized_job_no: 1, action_kind: 1 }
  unique, partialFilterExpression: { state: "open" }
{ normalized_job_no: 1, action_kind: 1, sequence_number: 1 } unique
{ state: 1, last_evidence_at: -1 }
{ deterministic_booking_id: 1, state: 1 }
{ "suggested_lead.lead_ref.model": 1, "suggested_lead.lead_ref.id": 1, state: 1 }
```

Use deterministic names parallel to Unit 22, include exact definitions in Section 34.5 report/apply/verify, disable runtime `autoIndex`, and preserve model guards: resolved rows immutable; evidence IDs append-only; direct updates require `state:"open"`; no replacement or evidence removal.

### 6.2 Release classification and current-state routing

Add `src/services/granotLifecycle/releaseReconciliation.ts` implementing:

```ts
interface GranotReleaseReconciliation {
  reconcileObservation(input: {
    observation_id: string;
    decision_id: string;
  }): Promise<CaseEffectResult>;
}
```

The processor is the only automatic caller. It may invoke this service only for a valid independent `booking_action.normalized === "release"`, post-activation `execution_mode:"live"`, allowed reviewed Registry/source gates, and `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=true`. Malformed Priority on the same otherwise-valid Release does not suppress the action. Historical/live shadow, disabled/deferred/unclassified sources, missing Job Number, invalid/unsupported action, or false case flag create no Release case.

Reread the immutable Observation plus current active Record Link and Unit 14 deterministic Booking context inside the lifecycle transaction. Route exactly:

1. **One compatible active Booking:** open/refresh a Release case with that Booking ID and its current `domain_revision` as `booking_revision_at_open`. A Booking without a Lead is not itself a discrepancy and the Booking is never owner-selectable.
2. **Officially cancelled Booking:** persist a no-effect Decision with `outcome:"already_current"`, `reason_code:"booking_already_cancelled"`, and the existing Booking/Cancellation target refs; create/refresh no case or discrepancy.
3. **No Booking:** return `release_without_vantage_booking` to the typed discrepancy-required seam; Unit 29 persists it.
4. **Identity conflict:** map only to `release_record_link_conflict`, `release_job_number_conflict`, or `release_source_scope_conflict` according to the conflicting current fact. Do not collapse them or guess a Booking/Lead. Return the typed seam only; Unit 29 owns storage.

Do not create a discrepancy for an already-cancelled Release or merely because the deterministic Booking lacks a Lead. Do not contact-match, source-correct, attach a Lead, establish/correct a Record Link, or mutate official facts.

### 6.3 Open, refresh, sequence, Decision, and coexistence

Opening sets `case_revision=1`, `evidence_revision=1`, sequence `max(job+"release")+1`, exact Observation/Decision/capture/action evidence, observed display context, deterministic Booking/revision, current link/source refs, and timestamps. The Release Decision uses `outcome:"linked"`, reason `release_case_opened`, target/effect ref `GranotReleaseReconciliationCase`.

A repeated Release against the open case appends/deduplicates by Observation ID, refreshes observed display context, updates `last_evidence_at`, and increments only `evidence_revision`; exact replay changes nothing. `booking_revision_at_open` remains the immutable opening snapshot. If a compatible current Booking/link change is owner-relevant, increment `case_revision` and expose the new fact through the live projection without rewriting that opening revision; never silently retarget to another Booking. The Decision reason is `release_case_refreshed`.

Case and Decision commit atomically in one Mongo transaction. Allocate sequence inside the transaction; resolve open/sequence duplicate-key races with one bounded retry exactly as Unit 22. A resolved row is never reused. Booking-case uniqueness is a separate collection/action kind: Booked and Release cases for the same Job may both be open, appear separately, and never resolve/close one another.

### 6.4 Server reads and privacy contract

Extend the existing protected Section 28.2 endpoints, not a new router:

```text
GET /api/v1/admin/granot-lifecycle/cases
GET /api/v1/admin/granot-lifecycle/cases/:case_id
GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no
GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle
```

`kind=release` queries Release rows; absent `kind` merges Booking and Release rows under the same filters, stable selected timestamp+ObjectId ordering, limit/cursor contract, and no duplication/omission across pages. `kind=booking` remains unchanged. Apply state/source/Job/date/sort/order/mode filters consistently; projection-only Release `mode` is `release`.

Detail resolves either case model and returns `kind:"release"`, `mode:"release"`, separate immutable evidence, the exact warning `Granot evidence — not official Vantage values`, current Record Link, deterministic live Booking and any current official Cancellation, and the complete Job timeline. `candidate_search.available=false`; no suggestion/Lead selector or employee-reconciliation substitution is introduced. Capabilities advertise Release reads only when the model/index contract is landed; `commands=false`, discrepancies false until Unit 29, and Booking capabilities remain truthful.

Job/Lead timelines add Release case opened/refreshed/resolved entries while keeping the source `booking_action:"release"` and Decision as separate entries. Preserve ascending `(event_at,type_priority,id)` ordering, sequence/evidence entries, current official facts, and non-collapse. Lists mask contact and Booking refs. Detail returns only allowlisted owner-work fields—never receipt payload/headers, credentials, addresses, raw transport data, or logs containing unmasked contact.

### 6.5 Read-only Admin workflow

Extend the existing Granot Lifecycle queue/detail/timeline files and query keys:

- default open queue merges Booking and Release newest evidence first; URL-backed `kind=release` and other server filters round-trip exactly;
- Release rows are visibly labeled and never mixed with Employee Booking reconciliation;
- Release detail shows immutable Granot evidence separately from the read-only deterministic current Booking/Cancellation and labels Granot monetary/contact/move values as non-official;
- actual Booked and Release actions and both case sequences remain distinct timeline entries;
- render no `Confirm Cancellation`, `Update Booking`, `No Action`, bulk, fake-success, or other mutation control in Unit 26;
- evidence-only refresh updates count/timeline/current read projection without discarding unrelated local page state;
- preserve labels, headings, keyboard navigation, focus order, non-color status, loading/error/empty states, and masked contact presentation.

Admin consumes server routing and projections and never classifies Release, resolves identity, checks official cancellation, or selects a Booking itself. BFF authorization remains Owner/Admin for reads under the existing v1 guard; no new write ACL is added.

## 7. Explicitly out of scope

- Confirm Cancellation, Release Booking update, Release No Action, owner schemas/routes/forms, canonical Cancellation work, and command flag enablement (Unit 27).
- Booking case creation/commands (Units 22–25), Referral case/Booking workflow (Unit 28), discrepancy models/routes/correction/re-evaluation (Unit 29), health/alerts (Unit 30), email (optional Unit 32), and compatibility cleanup (Unit 33).
- Automatic Booking update, Cancellation, un-cancellation, reactivation, Record Link correction, Lead attachment, source reassignment, compensation, or external Sheet publish.
- A generic reconciliation collection/model, a Release lifecycle-status enum, owner-selectable Booking dropdown, or contact-based Booking lookup.
- Production apply/deploy/flags, live payload/customer inspection, and any raw payload, secret, unmasked contact/address, or customer data in projections/logs/tests/reports/handoffs.

## 8. Flags and runtime posture

Checked-in defaults remain exactly:

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

Tests inject post-activation `live` plus Release cases only. Unit 26 does not change checked-in values or any separately reviewed Booking posture. After server/Admin read capability is deployed, Release indexes verify green, distributions are reviewed, and separate rollout authorization is granted, `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED` may be enabled narrowly one reviewed source/effect at a time. `RELEASE_COMMANDS`, Referral, and email remain false. Historical shadow never opens cases; live shadow Decisions are not replay-promoted.

## 9. Migration and indexes

This unit adds the Release case collection indexes, so Section 34.5 applies. Extend `scripts/migrations/granot-lifecycle-indexes.ts`/library/tests with all five exact Release definitions and collision checks. Run dry-run first:

```text
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:indexes -- --verify
```

Report must be deterministic/PII-safe, create non-unique definitions before unique definitions, and show zero open-job and job-sequence collisions before apply. Omitted mode means report; modes cannot be combined; verify is read-only and exits nonzero on missing/mismatched definitions. No apply—test, staging, or production—is authorized by issue assignment. Runtime must not create indexes silently.

## 10. Acceptance criteria

- [ ] **AC-25 (read portion):** Release with one active compatible Booking opens/refreshes a case whose read detail exposes the future Confirm Cancellation, Update Booking, and No Action capability boundary, while this unit exposes no executable command and performs nothing automatically.
- [ ] **AC-26 (Release portion):** already officially cancelled Release yields `already_current`/`booking_already_cancelled`, no case, and no mutation. Booked-after-Cancellation remains Unit 22/29 Booking-discrepancy routing and is not weakened.
- [ ] **AC-27 (routing portion):** no Booking or conflicting link/Job/Source yields the exact Release-discrepancy-required reason and creates/cancels nothing; Unit 29 storage remains absent.
- [ ] **AC-35:** raw payload/headers/credentials/addresses are absent from Release list/detail/timeline/Admin/log projections; list contact and Booking refs are masked.
- [ ] **AC-36 (Release case):** partial-open and sequence uniqueness hold under simultaneous evidence; one bounded retry converges; evidence deduplicates; resolved cases never reopen.
- [ ] **AC-40:** actual Booked and Release can have separate open cases for one Job, both project/timeline independently, and neither auto-closes or rewrites the other.
- [ ] Active/already-cancelled/missing/conflicting distributions, immutable evidence, separate revisions, deterministic Booking/revision snapshot, combined cursor pagination, no candidate selector, and zero mutation-command/Change/outbox counts are proven.

## 11. Required tests and commands

Name focused tests with AC-25, AC-26, AC-27, AC-35, AC-36, and AC-40. Server proof must include:

- model tests for every field/validator/index, required deterministic Booking/revision, immutable resolved/evidence guards, and no raw payload field;
- pure/module tests for valid Release despite malformed Priority, live/flag gates, active/already-cancelled/no-Booking and each exact conflict reason, Booking-without-Lead, no contact match, and no Unit 29 persistence;
- replica-set tests for simultaneous first open, exact replay, simultaneous next sequence after resolution, Decision+case atomic rollback, open refresh/revision split, and simultaneous Booked/Release coexistence;
- route/projection tests for auth, kind/mode/filter/cursor merge, cross-collection stable pagination, detail-not-found/error envelope, masking/forbidden-key scan, deterministic Booking/current Cancellation, and timeline non-collapse;
- before/after counts proving no Lead/Booking/Cancellation/Record Link/Command/Change/outbox/discrepancy/notification/email mutation.

Admin proof covers typed DTO/API, URL filters, mixed queue, Release detail/current Booking, evidence/current-state labels, masked values, no action controls/BFF writes, timeline coexistence, accessibility, and refresh stability.

Run:

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test src/models/GranotReleaseReconciliationCase.test.ts src/services/granotLifecycle/releaseReconciliation.test.ts src/services/granotLifecycle/projections.test.ts src/routes/granot-lifecycle-admin.routes.test.ts scripts/migrations/granot-lifecycle-indexes.test.ts
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=26
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --report
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck

# vantage-admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Use landed focused filenames if different and record exact counts/outcomes. Mocked tests cannot replace real replica uniqueness/transaction proof. Documentation/rules for the new model/module/projection behavior must change with implementation.

## 12. Live/staging verification

Use redacted synthetic preview/staging evidence first. With commands and external Sheet delivery disabled, exercise active, already-cancelled, missing Booking, each link/Job/source conflict, Booking without Lead, repeated refresh, next sequence, and simultaneous Booked/Release. Inspect only bounded receipt/Observation/Decision/case/Booking/Cancellation/link IDs, revisions, reason/outcome strings, index verification, masked projections, and collection counts. Prove zero Booking/Cancellation/Lead/Command/Change/outbox delta.

Only separate authorization after deployment/index verification may enable Release cases for one reviewed source/effect. Observe active/already-cancelled/no-Booking/conflict distributions for one normal interval. Production verification is read-only and never inspects raw payload/contact values. Stop on wrong Booking selection, a duplicate/open-sequence violation, any automatic official mutation/Sheet intent, cross-kind auto-close, missing causal ID, unmasked data, or command control exposure.

## 13. Rollback

Set `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=false` first. Keep capture/processing, protected reads, Booking cases, and durable Release evidence available; hide the Release creation caller or faulty Admin Release projection without deleting rows. Preserve receipts, Observations, Decisions, activation, Record Links/history, all Booking/Release cases/evidence/sequences, official Bookings/Cancellations, audits, commands, changes, revisions, and outbox records.

Do not delete the Release collection/indexes, reopen resolved cases, collapse sequences, rewrite Decisions, or reverse any official fact. Schema/index changes are additive; any rollback cleanup requires a separately authorized report-first script.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-26-COMPLETION.md` using Runbook Section 13. Include both repositories/branches; verified Unit 22–23/stable-identity prerequisites; behavior-grouped files; exact model/index/routing/DTO contracts; invariants and AC allocation; report/apply/verify target and outcomes; flags before/after; focused/full/replica/lint/typecheck/build results; masked active/already-cancelled/missing/conflict/coexistence/cursor/privacy/zero-mutation proof; final Git statuses; and the explicit external-action statement.

Successful implementation makes Unit 27 contract-permitted only after Owner review of the read-only Release cases. It does not unblock Unit 29 until Unit 27 is complete and does not authorize Release commands, production index apply, deployment, or flag enablement.
