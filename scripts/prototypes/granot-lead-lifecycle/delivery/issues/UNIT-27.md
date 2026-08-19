# Unit 27 — Release owner commands: cancellation, Booking update, and No Action

> **Contract maturity: implementation-ready; implementation remains blocked by Unit 26 and Owner review of read-only Release cases.** This is S18 only. It adds explicit Owner mutations to an already-open Release case. Granot still performs no automatic Booking update, Cancellation, reversal, or reactivation.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 18, 20–21, 23–25, 27–29, 34–41; especially Sections 23.1–23.4, 24.2/24.4/24.5, Section 25 `GranotReleaseReconciliation`, Section 28.3/28.4, AC-21/25/26/32, and Section 38/S18.
- **Acceptance ownership:** Unit 27 owns Release command/form portions of AC-21/25/32 and the owner-race/already-current continuation of AC-26. Unit 26 owns case open/read/already-cancelled-at-processing behavior. Unit 29 owns discrepancies and link correction.
- **Approved split:** Unit 27 in `specs/lead_lifecycle_issue_breakdown_reccomendation.md`; reuse Unit 24–25 strict Owner, cents/catalog, Booking update, idempotency, transaction, Admin draft, and invalidation primitives without changing their standard Booking semantics.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`, server/Admin instructions and applicable rules, verified Units 10–11/24–26 evidence, and current code.

The final specification wins. A Release case offers three explicit Owner paths—Confirm Granot Cancellation, Update Existing Booking, and No Action—but the action observation itself is never authority for any of them.

## 2. Objective

Complete S18 with three strict, idempotent, revision-guarded Owner workflows against the case-bound deterministic active Booking. Confirm Cancellation atomically creates one official Cancellation, claims and mirrors the Booking (and its Lead when one exists), records the complete causal Command/Change/revision chain, resolves the case, and queues one Cancellation Chain intent. Update Existing Booking reuses the full official replacement contract against the Release case. No Action resolves only the case/command. One concurrent command wins; exact replay is durable; current state may resolve `already_satisfied` without a second official mutation. Admin provides explicit accessible review and draft-preserving `409` recovery.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle` and `vantage-admin` / `granot-lead-lifecycle`. Server schemas/results/errors are authoritative. No extension work.
- **Prerequisites:** Units 10–11 complete; Unit 26 complete with exact Release model/index/read behavior; Owner review of read-only Release cases accepted. Verify these against code, index definitions, flags, replica output, and completion reports.
- Reverify Unit 24–25 Owner actor/initiator construction, `Idempotency-Key`, exact calendar/cents/catalog helpers, `updateBooking`, case CAS, Entity Change/outbox persistence, BFF trust boundary, invalidations, explicit review, and draft-preserving `409` behavior.
- Reverify current `BookedLead`/`CancelledLead` revision and mirror fields, active normalized-Job uniqueness, Record Link compatibility, and `cancellation_chain` planner. A case Booking is never selected by the Owner.
- Runtime writes use only `TEST_MODE=true`, an explicitly confirmed disposable replica set, `SHEET_SYNC_MODE=queued` with external delivery stubbed, redacted synthetic fixtures, and test-injected flags. No commit, push, deploy, production mutation, live payload read, flag enablement, or external send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-19 before Unit 26 lands:

- `CanonicalDomainCommands` already exposes compatibility `createCancellation` and final `updateBooking`; Unit 25 implements full replacement only for standard Booking cases. Unit 27 must use/refactor these canonical seams, not mutate models from the route or add a parallel patch command.
- `createCancelledLeadInTransaction` currently resolves from client-shaped Booking/Lead input and rejects a non-leadless Booking without Lead refs with `Referral booking cancellation is not supported yet`. It saves Cancellation/Booking/Lead and queues `cancellation_chain`, but it does not implement the Release case/expected Booking CAS contract. Replace the blanket Referral rejection only at the verified deterministic lifecycle path; preserve unrelated public compatibility behavior.
- Existing `runExistingCreateCancellation` persists Command/Changes around that legacy primitive. Adapt a transaction-bound deterministic Booking claim so one lifecycle executor transaction owns Cancellation, Booking/Lead mirrors, case resolution, Changes, Command, and outbox. Do not nest transactions or finalize Sheet work before commit.
- Unit 25 `bookingOwnerCommands.ts` rejects Referral/leadless Bookings and assumes Booking-case source scope. Extract/reuse the strict replacement primitives while giving Release revalidation its own final-spec rules. Do not make Release call a Booking-case route/service.
- `BookedLead.cancelled` plus a `CancelledLead` row are official current facts. Current cancellation planning writes Master Booked plus Master Cancelled and the linked Lead projection when present; a Referral Booking correctly has no Lead projection to mirror.
- Unit 24–25 response/error/BFF/Admin foundations are landed; no Release write routes/forms exist. Checked-in Release commands remain false.

The implementing agent must date and correct these claims after Unit 26/recent branch changes.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** the live Mongo Release case, deterministic Booking, official Cancellation, link, revisions, and catalogs govern the command—not Granot display values or cached Admin state.
- **Invariant 2:** only an explicit authenticated Owner command may create a Cancellation or update a Booking; Release never reverses a Cancellation or makes a Booking active again.
- **Invariant 3:** resolution composes with current facts; no lifecycle-status field is introduced.
- **Invariant 4:** commands target the single case-bound normalized-Job Booking and never create/select a second Booking.
- **Invariants 5–6:** all official changes use canonical commands and atomically persist Decision provenance, `DomainCommandExecution`, each `EntityChange`/revision, case resolution, and one appropriate outbox intent.
- **Invariant 7:** exact replay, already-satisfied, and No Action create no duplicate aggregate Change or Sheet work.
- **Invariants 8–10:** Receipt/Observation channel, source system, actor, initiator, Ingestion Origin, Source Scope, CPL, and immutable evidence remain separate and unchanged.
- **Invariant 11:** no contact matching or Lead selection occurs; a missing Lead mirror does not invalidate an otherwise verified active Booking, including Referral.
- **Invariant 12:** the open case CAS has one winner, evidence refresh alone does not stale the form, resolved cases never reopen, and later Release evidence creates the next sequence through Unit 26.

## 6. Deliverables and exact contract

### 6.1 Strict Owner routes, envelope, and inputs

Extend the existing protected lifecycle router with exactly:

```text
POST /api/v1/admin/granot-lifecycle/release-cases/:id/confirm-cancellation
POST /api/v1/admin/granot-lifecycle/release-cases/:id/update-booking
POST /api/v1/admin/granot-lifecycle/release-cases/:id/no-action
```

All bodies are strict. The route supplies `case_id` and rejects any body `case_id`, provenance/actor fields, Booking/Lead/source/Job/contact identity, Granot estimate/payment/balance/move/source/Agent display fields, unknown keys, or replacement Booking ID. Every request requires exactly one `Idempotency-Key` of 8–200 printable characters with no outer whitespace; actor/initiator come only from trusted Owner authentication and the server computes the stable payload checksum.

Confirm Cancellation body:

```ts
type ConfirmCancellationBody = {
  expected_case_revision: number;    // integer >= 1
  expected_booking_revision: number; // integer >= 0
  official_cancellation_details: {
    cancel_date: string;              // calendar-valid YYYY-MM-DD
    refund_amount: number;            // finite, >= 0, <= 2 decimals
    reason?: string;                   // trimmed, max 500
    notes?: string;                    // trimmed, max 2000
    cancelled_by?: string;             // trimmed, max 200; business field only
  };
};
```

Update Booking body is the exact Unit 25/final-spec full replacement:

```ts
type UpdateReleaseBookingBody = {
  expected_case_revision: number;
  expected_booking_revision: number;
  official_booking_details: OfficialBookingDetails;
};
```

`OfficialBookingDetails` remains strict Book Date, 1–20 unique active Agent IDs/allocations, exact integer-cents Binder sum, nonnegative two-decimal Deposit, and active Merchant ID. It replaces the whole official set and never changes identity.

No Action body is exactly:

```ts
type ReleaseNoActionBody = {
  expected_case_revision: number;
  reason_code?: NoActionReasonCode;
  reason_text?: string; // trimmed, max 1000
};
```

Use the exact Section 21.1 reason union. Reason fields are independently optional metadata and never branching logic. Validate dates as real calendar dates and all money through decimal-string-to-integer-cents conversion; never compare floats.

### 6.2 Module methods, command names, response, and errors

Implement the final deep interface:

```ts
interface GranotReleaseReconciliation {
  confirmCancellation(input: ConfirmCancellationCommand): Promise<ReleaseOwnerCommandResult>;
  updateExistingBooking(input: UpdateBookingCommand): Promise<ReleaseOwnerCommandResult>;
  noAction(input: NoActionCommand): Promise<ReleaseOwnerCommandResult>;
}
```

Use the existing canonical aggregate names, not aliases: persisted `createCancellation` for official Cancellation and `updateBooking` for full Booking replacement. The final specification does not name the Release No Action command; use `resolveGranotReleaseCaseNoAction` as narrow issue-author guidance and lock it in tests. Route method labels (`confirmCancellation`, `updateExistingBooking`, `noAction`) do not change persisted command names.

Return:

```ts
type ReleaseOwnerCommandResult = {
  case_id: string;
  case_state: "resolved";
  case_revision: number;
  outcome:
    | "cancellation_created"
    | "booking_updated"
    | "no_action"
    | "already_satisfied";
  command_execution_id: string;
  decision_id: string;
  booking_ref: { id: string; domain_revision: number };
  cancellation_ref?: { id: string; domain_revision: number };
  entity_refs: Array<{ model: string; id: string }>;
  replayed: boolean;
};
```

Fresh cancellation creation returns `201 { ok:true,data }`; update/No Action/already-satisfied return `200`; exact replay returns stored `200` with `replayed:true`. Persisted command status remains `applied`. Use Unit 26 case's stable first evidence Receipt/Observation/Decision as causal provenance; do not create a new business Decision for an Owner command.

Use Section 28.4 mappings: `400 GRANOT_VALIDATION_FAILED`, `403 GRANOT_OWNER_REQUIRED`, `404 GRANOT_CASE_NOT_FOUND`, `409 DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT`, `409 GRANOT_CASE_REVISION_CONFLICT`, `409 DOMAIN_REVISION_CONFLICT`, `409 GRANOT_IDENTITY_CONFLICT`, and `422 GRANOT_POLICY_BLOCKED`. A missing/cancelled/stale Booking is a domain revision conflict unless already-satisfied is provable from the exact current official chain; incompatible case/Job/link/source identity is identity conflict. No Mongo/internal/raw values escape.

### 6.3 Shared revalidation and one-winner transaction boundary

For all three paths, inside the transaction require the Release case `_id`, `action_kind:"release"`, `state:"open"`, and exact `case_revision`; trusted Owner; enabled Release command gate; current reviewed source/disposition policy; and stable causal evidence. Cancellation/update additionally require the case's exact `deterministic_booking_id`, normalized Job, and current compatible Record Link/source facts when present.

For effect-bearing commands, load the deterministic Booking and require `domain_revision === expected_booking_revision`. Never accept a Booking dropdown or run contact/Lead matching. A Booking may be standard, Referral, or otherwise leadless if Unit 26 proved the same active deterministic Booking; absence of a Lead means omit the Lead mirror, not invent one. Do not use an Employee Booking reconciliation case as a substitute.

Every case resolution uses:

```ts
{ _id: case_id, state: "open", case_revision: expected_case_revision }
```

and increments `case_revision` exactly once while leaving `evidence_revision` unchanged. Exact replay returns stored results without another CAS. Concurrent cancellation/update/No Action calls at one revision yield one winner; losers return the exact conflict unless the live official state exactly satisfies that request and the case can be resolved as `already_satisfied` without another mutation.

### 6.4 Confirm Cancellation transaction

The deterministic Booking must still be active. Claim it first with the exact final-spec CAS:

```ts
{
  _id: booking_id,
  domain_revision: expected_booking_revision,
  normalized_job_no: case.normalized_job_no,
  $or: [{ cancelled: null }, { cancelled: { $exists: false } }],
}
```

Refactor/expose a transaction-bound internal cancellation primitive that takes the already-verified Booking identity and official details. It must not start a nested transaction or re-resolve from client-shaped `booked_lead`/`lead_id`. Remove the blanket Referral rejection for this verified path: an active `is_referral_booking:true` Booking may be cancelled with no Lead mirror. Preserve unrelated public adapters and their compatibility validation.

In one executor transaction:

1. claim/increment the active Booking revision through CAS;
2. create exactly one `CancelledLead` with official date/refund/reason/notes/cancelled-by, Booking/customer/source snapshots, Booking ref, and Lead ref/model only when present;
3. set Booking `cancelled` to the Cancellation and create its revision/Change;
4. mirror `cancelled` and its revision/Change to the linked Form/Call Lead only when the verified Booking has one; Referral/leadless creates no Lead and no Lead Change;
5. persist the new Cancellation revision/`EntityChange` and complete Receipt → Observation → Decision → Command → Change refs with actor/initiator/channel axes;
6. resolve the Release case with `outcome:"cancellation_created"`, Command, Owner actor, entity ref, and one `resolved_at`;
7. persist exactly one queued `cancellation_chain` outbox intent.

External Sheet delivery/finalization occurs only after commit. The Cancellation Chain must project the current Booking to Master Booked, the Cancellation to Master Cancelled, and the linked Lead chain only when a Lead exists. It must not create a source Lead row for Referral. Store contact/address Change values as reference-only and never copy raw Observation payload.

If an official Cancellation already exists for the same Booking at execution time, verify the Booking/Cancellation chain. Resolve the case as `already_satisfied` with one command and no new Cancellation, aggregate revision, Change, or outbox. A mismatched/ambiguous cancellation is a conflict, not already-satisfied. Never reverse, delete, replace, or un-cancel an existing official Cancellation.

### 6.5 Release Booking update and No Action

Update reuses Unit 25's exact active catalog/cents/full-replacement and `updateBooking` canonical implementation, but Release owns its case loader/resolution and must support its verified deterministic Booking without requiring a Lead selector. Replace only Book Date, allocations, total Binder, Deposit, and Merchant. Recompute Booking threshold facts and mirror only those derived fields to an existing linked Lead. Preserve Job/normalized Job, customer/contact, Lead ref/model, source, Referral/leadless flags, submission/creation identity, Record Link, Source Scope, Ingestion Origin, CPL, cancellation identity, and immutable evidence.

The Booking CAS is the same active filter shown above. In one transaction write Booking (and legitimate linked-Lead threshold) revision/Changes, Release case `outcome:"booking_updated"`, Command, and exactly one queued `booking_chain` intent. Identical live official/derived state resolves `already_satisfied` with no aggregate Change/outbox. Update can never create another Booking, Cancellation, or Record Link change.

No Action persists `resolveGranotReleaseCaseNoAction` plus Release case `outcome:"no_action"`, optional exact reason metadata, actor, and resolution timestamp. It does not require a Booking revision and creates no Lead/Booking/Cancellation/Customer/Record Link/Registry mutation, aggregate revision, `EntityChange`, Sheet intent/publish, discrepancy, notification, email, or replacement case.

### 6.6 Admin Owner workflow

Extend Unit 26/25 Admin files and BFF ACL:

- open Release detail shows the deterministic Booking read-only above the three actions; no Booking or Lead selector;
- `Update Booking` initializes from current official Booking values, not Granot evidence, and uses the Unit 25 full-replacement/catalog controls;
- `Create Cancellation` accepts only the strict official Cancellation fields, displays exact currency/date review, and uses the final labeled button `Create Cancellation`;
- `Resolve — No Action` uses the exact optional reason vocabulary/text;
- every action has an explicit separate review screen, pending/double-submit protection, labels/error summary/focus management/keyboard support, and no bulk action;
- evidence refresh updates timeline/count without resetting drafts. Submit loaded case/Booking revisions;
- every `409` refetches case/current Booking/Cancellation, explains which revision/identity changed, preserves every unsent field, and never auto-resubmits;
- success invalidates case list/detail, Job and linked Lead timelines, Booking/Cancellation lists/details, relevant analytics, and catalogs as applicable.

Proxy only the three exact Release POST patterns for Owner, deny Admin/non-Owner, forward one idempotency header and trusted signed admin actor, strip browser authority/secret headers, and keep audit data bounded—never reason/notes, money, contact, IDs beyond masked operational refs, or raw response payload. Admin renders server capabilities and errors and owns no policy.

## 7. Explicitly out of scope

- Release case creation/refresh/sequence/index/read policy (Unit 26), except consuming it.
- Booking-case commands (Units 24–25), Referral Booking creation/case policy (Unit 28), discrepancy persistence/re-evaluation/link correction (Unit 29), health/alerts (Unit 30), email (optional Unit 32), and compatibility cleanup (Unit 33).
- Automatic command execution, Booking/Cancellation reversal or deletion, un-cancellation/reactivation, Record Link correction, Lead selection/creation/attachment, source reassignment, partial Booking patch, or second Booking/Cancellation.
- Changing legacy public cancellation/referral behavior beyond the internal compatibility refactor required to expose the verified canonical lifecycle path.
- New models/indexes/backfills, production deploy/apply/flag enablement, live payload/customer reads, raw payload/secret/unmasked contact in any projection/log/test/report/handoff, or external sends.

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

All three routes fail closed unless `GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=true`; tests inject it only in disposable test mode. Do not disable separately reviewed Release-case reads. After deployment, index verification, full test-mode proof, and separate Owner rollout approval, Release commands may be enabled narrowly for reviewed Owners and one source/effect at a time. Checked-in default remains false; Referral creation and email remain false. Never enable a later flag to make tests pass.

## 9. Migration and indexes

**None.** Consume Unit 26 Release case indexes, Booking normalized-Job uniqueness, active Record Link, aggregate revisions, Command/Change, and Sheet outbox definitions. Do not add another uniqueness/idempotency/index contract or backfill cases/official facts.

Run read-only verification before staging proof:

```text
pnpm migration:granot-lifecycle:indexes -- --verify
```

It must include Unit 26 definitions and exit nonzero on drift. No report/apply or production mutation is authorized by this unit.

## 10. Acceptance criteria

- [ ] **AC-21 (Release commands):** simultaneous cancellation/update/No Action at one case revision have one winner; exact replay returns stored result; loser conflicts or exact current state resolves already-satisfied without a second mutation.
- [ ] **AC-25:** active Booking Release supports explicit Confirm Cancellation, full Update Booking, and No Action; none occurs automatically and no Owner selects another Booking.
- [ ] **AC-26 (owner continuation):** already officially cancelled Release has no case through Unit 26; if cancellation wins after a case opens, a verified command resolves already-satisfied without a duplicate or reversal.
- [ ] **AC-32:** every real Cancellation/Booking mutation has Receipt → Observation → Decision → Command → Change refs, revision transitions, and one appropriate queued Sheet intent; replay/already-satisfied/No Action have no aggregate Change or Sheet work.
- [ ] Strict dates/cents/reasons/catalogs, exact case/Booking CAS, active/current link/source revalidation, Referral cancellation without Lead mirror, complete Master Booked/Cancelled chain, and absence of automatic reversal are proven.
- [ ] Admin explicit review, exact action visibility/final labels, accessibility, invalidations, pending protection, and `409` draft preservation are proven.

## 11. Required tests and commands

Name focused tests with AC-21, AC-25, AC-26, and AC-32. Server proof must include:

- strict Zod/idempotency/auth/status/error tests for all three routes, calendar validity, decimal bounds, unknown/server-owned fields, reason lengths, and exact envelopes;
- module tests for allowed mode/state, deterministic Booking/no selector, source/link/Job compatibility, active/already-cancelled/disappeared Booking, standard/Referral/leadless behavior, full update replacement, No Action, and no reversal;
- real replica tests for cancellation-vs-cancellation, cancellation-vs-update, cancellation-vs-No Action, update-vs-No Action, case/Booking races, replay/checksum conflict, already-satisfied, rollback after every write boundary, and one-winner resolution;
- atomic before/after assertions for one Cancellation, exact Booking/optional Lead mirrors and revisions, one Change per mutated aggregate, stable full causal refs, exactly one `cancellation_chain` or `booking_chain` outbox, correct Master targets, and zero work on replay/already-satisfied/No Action;
- regression proof that unrelated public cancellation/Booking routes still use their canonical adapters and do not bypass transactions.

Admin proof includes API/error/query/BFF ACL/header stripping/audit tests and components for three action visibilities, live Booking initialization, strict cancellation/update/no-action review, evidence refetch, every `409` draft preservation/refetch/no auto-submit, invalidation sets, accessibility/error focus/keyboard behavior, and double-submit prevention.

Run:

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test src/validation/v1/granotLifecycle.validation.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/granotLifecycle/releaseReconciliation.test.ts src/services/granotLifecycle/releaseOwnerCommands.test.ts src/services/domainCommands/domainCommands.test.ts src/services/sheetSync/drainer/jobPlanner.test.ts
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test:granot-lifecycle:replica -- --unit=27
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck

# vantage-admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Use landed focused filenames if different and record exact results. Mocked/UI tests cannot replace replica CAS/transaction/outbox proof. Update applicable behavior docs/rules in this unit.

## 12. Live/staging verification

First use redacted synthetic test-mode cases with queued Sheet delivery stubbed. Exercise each command, exact replay/checksum conflict, all pairwise races, already-satisfied current Cancellation/update, Referral without Lead mirror, standard with Lead mirror, exact cents/dates/catalogs, full causal refs, rollback boundaries, evidence refresh while editing, and preserved Admin drafts. Inspect only bounded case/Booking/Cancellation/Lead/link/Command/Change/outbox IDs, revisions, paths, outcomes, and target names.

After complete deployment/review, only separate authorization may enable Release commands and execute reviewed cases. S18 live verification requires one reviewed No Action and, when available, one official mutation with Mongo/Sheet chain verification, followed through one normal interval. Production verification does not inspect raw payload/contact. Stop on duplicate Cancellation, wrong Booking/Lead/source identity, partial commit, missing Change/revision/causal ref, incorrect Sheet target, Referral Lead fabrication, automatic reversal, lost draft, raw-data exposure, or any discrepancy/Referral-create/email effect.

## 13. Rollback

Set `GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=false` first. Keep capture/processing, Release cases, protected reads, and Admin read UI available. Hide/roll back faulty action callers while preserving the server read contract. Preserve all receipts, Observations, Decisions, activation, links/history, Booking/Release cases/evidence/resolutions, audits, Domain Commands, Entity Changes, outbox records, revisions, and committed official Booking/Cancellation/Lead facts.

Never automatically reverse/delete a committed Cancellation or Booking update, reopen a resolved case, decrement revisions, clear a Booking cancellation ref, delete Command/Change evidence, or enqueue compensation. Repair requires a separately reviewed report-first canonical command.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-27-COMPLETION.md` using Runbook Section 13. Include verified Unit 26 and Owner-review gates; both repositories/branches; behavior-grouped files; exact schemas/command names/results/errors/revalidation/transaction/Sheet contracts; invariants and AC allocation; migration `none` plus index verify; flags before/after; focused/full/replica/lint/typecheck/build results; masked one-winner/replay/already-satisfied/Referral/no-Lead/full-causal/rollback/privacy/Admin proof; final Git statuses; and the explicit external-action statement.

Successful implementation completes S18 and unblocks Unit 29's S16–S18 prerequisite after repository verification. It does not enable Release commands, authorize live official mutation, or satisfy Unit 28's separate reviewed Referral Registry prerequisite.
