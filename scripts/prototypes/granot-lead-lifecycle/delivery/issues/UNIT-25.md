# Unit 25 — Existing Booking update and Booking No Action workflows

> **Contract maturity: implementation-ready; implementation remains blocked by Unit 24.** This is the remaining S16 work. It adds explicit Owner update for `review_existing_booking` and No Action for standard Booking cases, then completes the Booking-command capability. It never creates a Booking, changes Booking/Lead/source identity, implements Referral/Release behavior, or enables production effects by assignment alone.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 18–19, 21.1–21.2/21.4–21.5, 23–25, 27–29, 34–41; especially Sections 24.2 and 24.5, Section 23.2 CAS/transaction rules, AC-20/21/24/32, and 38/S16.
- **Acceptance ownership:** Unit 25 owns the Booking update and standard Booking No Action form/route/command portions of AC-20/21/32 and full AC-24. Unit 24 owns confirm-missing and the shared strict owner envelope/cents/catalog/provenance seam. Unit 27 owns Release update/No Action; Unit 28 owns Referral case actions.
- **Approved split:** Unit 25 in `lead_lifecycle_issue_breakdown_reccomendation.md`; remaining S16 only. Reuse the landed Unit 24 server/Admin foundations without weakening their strict contract.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`; server/admin instructions and rules; verified Unit 24 completion report and repository state; Units 10–11/22–23 evidence underlying it.

The final specification wins. An actual Booked action against an existing Booking creates review work, not authority to change that Booking. Update or No Action occurs only after an authenticated Owner explicitly submits the corresponding command.

## 2. Objective

Complete S16 by delivering two end-to-end Owner paths. `Update Existing Booking` loads the one deterministic live Booking, starts from its current official values, requires the full strict replacement input and expected Booking/case revisions, revalidates current identity, and atomically replaces only the authorized official fields with one causal command/change/outbox chain. `No Action` resolves an eligible standard Booking case through an idempotent domain command with optional reason metadata and zero aggregate, `EntityChange`, or Sheet Sync effects. Both paths provide one-winner concurrency, exact replay, already-satisfied behavior, correct query invalidation, accessible review, and `409` recovery that preserves unsent input.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle` and `vantage-admin` / `granot-lead-lifecycle`. Server response/error types remain authoritative for Admin. No extension work.
- **Prerequisite:** verified Unit 24 completion. Confirm its strict Official Booking/cents/catalog helpers, deterministic case-evidence provenance rule, owner actor/idempotency envelope, transaction-bound Booking primitive, Admin form/client/invalidation helpers, flags, migrations/index verification, and tests actually landed.
- **Current sequencing gate:** as of 2026-08-18, only Units 01–15 have completion reports and Unit 24 is not implemented. This complete contract therefore remains implementation-blocked.
- Before edits, also reverify Unit 22 case resolution/revision immutability; Unit 23 current Booking projection and draft-preserving detail UI; Unit 10/11 executor/Change/outbox semantics; normalized-Job unique index; active Record Link; and the current Booking/Lead cancellation/revision facts.
- Runtime writes use only `TEST_MODE=true`, an explicitly confirmed disposable replica-set database, queued Sheet mode with external delivery stubbed, redacted synthetic fixtures, and test-injected flags. No commit, push, deploy, production mutation/index apply, live payload access, flag enablement, or external send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-18; Unit 24 and its prerequisites will materially change these seams:

- `CanonicalDomainCommands` does not yet expose the final-spec `updateBooking`; current `updateBookedLead` is a compatibility patch adapter with no required expected-domain CAS.
- Current Booking update validation is partial, name/string based, and permits fields outside the lifecycle replacement contract. It resolves Agent/Merchant names and uses floating-point Binder tolerance. Do not expose it unchanged to lifecycle routes.
- Current Booking update code may mutate Job/source/local/submission data and uses patch-or-replace allocation behavior. Unit 25 requires a narrow full replacement of Book Date, allocations, total Binder, Deposit, and Merchant on the case's deterministic Booking only.
- `BookedLead` persists Merchant as a canonical label and Agent ObjectId/name snapshots, has `domain_revision`, cancellation ref, and the unique partial normalized-Job index. Unit 24 must land ID-based active catalog resolution and exact cents helpers for reuse here.
- Lifecycle case mutation routes/schemas/Admin files are absent today because Units 22–24 are not implemented. Extend the landed files; do not create a parallel router, model, query-key family, or independently redefined DTO.
- Checked-in lifecycle defaults already keep Booking commands false. Current Admin has legacy Booking forms and separate Employee reconciliation; neither is semantic authority for Granot case actions.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** the live deterministic Mongo Booking/case/link facts, not cached UI or Granot display values, determine whether update is allowed and what is already satisfied.
- **Invariant 2:** Granot never updates a Booking automatically; the explicit Owner command is the only authority here.
- **Invariant 4:** update targets the one case-bound normalized-Job Booking and can never create a second Booking.
- **Invariants 5–6:** effect-bearing update uses the canonical `updateBooking` command and atomically records provenance, `DomainCommandExecution`, `EntityChange`, Booking/derived Lead revision transitions, case resolution, and Booking Chain outbox intent.
- **Invariant 7:** already-satisfied update, No Action, and exact replay create no aggregate Change or Sheet work.
- **Invariants 8–10:** provenance axes and immutable evidence remain separate; update cannot alter Job, Lead ref/model, source, Source Scope, Ingestion Origin, CPL, or immutable snapshots.
- **Invariant 12:** one case-revision winner resolves the case once; evidence refresh does not stale the form, and later same-kind evidence creates the next sequence instead of reopening this one.

## 6. Deliverables and exact contract

### 6.1 Strict update and No Action inputs

Add strict Owner-only routes to Unit 24's lifecycle router:

```text
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/update-booking
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/no-action
```

Update body:

```ts
type UpdateBookingBody = {
  expected_case_revision: number;    // integer >= 1
  expected_booking_revision: number; // integer >= 0
  official_booking_details: {
    book_date: string;               // strict calendar-valid YYYY-MM-DD
    agent_allocations: Array<{
      agent_id: string;              // ObjectId of active Agent
      binder_amount: number;         // finite, >= 0, <= 2 decimal places
    }>;
    total_binder_amount: number;     // finite, >= 0, <= 2 decimal places
    deposit_amount: number;          // finite, >= 0, <= 2 decimal places
    merchant_id: string;             // ObjectId of active Merchant
  };
};
```

No Action body:

```ts
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

type BookingNoActionBody = {
  expected_case_revision: number; // integer >= 1
  reason_code?: NoActionReasonCode;
  reason_text?: string;           // trimmed, max 1000
};
```

The route supplies `case_id`; reject body `case_id`, unknown keys, Granot display fields, Job/source/contact, Lead/replacement Booking identity, or partial Booking details. Both routes require Unit 24's exact `Idempotency-Key` header, trusted Owner-derived context, and SHA-256 checksum of stable canonical `{ command_name, case_id, validated_body }`. Reason fields are independently optional metadata and never business decision logic; do not require text for `other` or infer a reason.

Reuse Unit 24's 1–20 unique active Agent IDs, active Merchant ID, exact integer-cents conversion, fractional-digit rejection, and Binder sum equality. Resolve IDs again at execution time and snapshot canonical labels. Malformed, unknown, or inactive submitted Agent/Merchant IDs are `400 GRANOT_VALIDATION_FAILED`; a disabled command/source policy is `422 GRANOT_POLICY_BLOCKED`. Never fall back to a name.

### 6.2 Module, canonical commands, and response

Implement the final deep interface:

```ts
interface GranotBookingReconciliation {
  updateExistingBooking(input: UpdateBookingCommand): Promise<BookingOwnerCommandResult>;
  noAction(input: NoActionCommand): Promise<BookingOwnerCommandResult>;
}
```

Add the exact final-spec canonical aggregate command to `CanonicalDomainCommands`:

```ts
updateBooking(input: {
  booking_id: string;
  expected_domain_revision: number;
  official_booking_details: OfficialBookingDetails;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult>;
```

Use persisted command name `updateBooking`. No Action has no persisted name in the final specification; use `resolveGranotBookingCaseNoAction` as narrow issue-author guidance, lock it in tests, and do not share an ambiguous `noAction` command name with Release/discrepancy workflows.

Extend Unit 24's response without redefining it:

```ts
type BookingOwnerCommandResult = {
  case_id: string;
  case_state: "resolved";
  case_revision: number;
  outcome: "booking_updated" | "no_action" | "already_satisfied";
  command_execution_id: string;
  decision_id: string;
  booking_ref?: { id: string; domain_revision: number };
  record_link_ref?: { id: string; domain_revision: number };
  entity_refs: Array<{ model: string; id: string }>;
  replayed: boolean;
};
```

Both fresh resolutions return `200 { ok:true, data }`; exact replay returns stored `200` data with `replayed:true`. Persisted command status stays `applied`. Reuse Unit 24's stable first-case-evidence Observation/Decision provenance and do not create a second Decision for an Owner command.

### 6.3 Existing Booking revalidation and full replacement

Within the executor transaction, require:

1. case exists as `action_kind:"booked"`, `mode:"review_existing_booking"`, `state:"open"`, and exact `case_revision`;
2. Booking command flag, trusted Owner, and current reviewed Registry/source policy remain allowed;
3. `case.deterministic_booking_id` exists and resolves to exactly one active, non-cancelled Booking whose normalized Job equals the case and whose `domain_revision` equals `expected_booking_revision`;
4. when the case carries a Record Link, it is still the active link with the same normalized Job/Booking and no Lead/source conflict; a case without a Record Link does not authorize this unit to establish or correct one. The linked Booking's Lead/source identity must remain compatible with the case;
5. all submitted Agent/Merchant IDs remain active and cents validation still passes.

Use the exact Booking CAS:

```ts
{
  _id: booking_id,
  domain_revision: expected_booking_revision,
  normalized_job_no: case.normalized_job_no,
  $or: [{ cancelled: null }, { cancelled: { $exists: false } }],
}
```

and case CAS `{ _id:case_id, state:"open", case_revision:expected_case_revision }`.

Replace the complete official set—`book_date`, every Agent allocation, `total_binder_amount`, `deposit_amount`, and Merchant—rather than patching/merging allocations. Recompute Booking deposit threshold flags and mirror only those derived Booking relationship/threshold fields to its already-linked Lead when the canonical Booking invariant requires it. Never change or accept Job/normalized Job, Lead ref/model, source, customer/contact, local/move data, Referral/leadless/booking origin, submission identity, cancellation identity, or Record Link identity.

In one transaction persist the Booking replacement, its revision/`EntityChange`, any legitimate derived Lead mirror revision/Change, case resolution `outcome:"booking_updated"`, `DomainCommandExecution`, and exactly one queued Booking Chain outbox intent. The Change chain carries receipt/Observation/Decision/case/actor/initiator provenance and reference-only contact/address treatment. External Sheet delivery runs only after commit.

If every submitted official field and derived threshold already equals live state, resolve the open case as `already_satisfied` with the command execution and no Booking/Lead revision, `EntityChange`, or outbox. A concurrent winner's exact desired state may take this path. As narrow fail-closed issue-author guidance, a missing/cancelled Booking or stale Booking CAS returns `409 DOMAIN_REVISION_CONFLICT`; deterministic Booking ID/Job/link/source incompatibility returns `409 GRANOT_IDENTITY_CONFLICT`; all such failures write nothing. Do not use `superseded_by_current_state`: the final specification defines the stored union but does not define that outcome's conditions for this path.

### 6.4 No Action transaction

No Action is allowed for open standard `create_missing_booking` or `review_existing_booking` cases. It is not exposed for `create_referral_booking` in this unit. Re-read the case and use the exact case CAS; a review-existing detail may include its deterministic Booking ref for context, but No Action does not require or mutate Booking state.

Inside one executor transaction:

- persist one `DomainCommandExecution` with case (and deterministic Booking ref when present) and stable causal provenance;
- resolve the case with `state:"resolved"`, `resolution.outcome:"no_action"`, command execution, authenticated Owner actor, optional exact reason fields, and one `resolved_at`;
- increment `case_revision` exactly once and leave `evidence_revision` unchanged.

Write no Booking, Lead, Cancellation, Customer, Record Link, Registry, or other aggregate; create no aggregate revision, `EntityChange`, Sheet Sync intent/publish, discrepancy, notification, email, or replacement case. Exact replay does not re-resolve. A concurrent loser gets `GRANOT_CASE_REVISION_CONFLICT` unless the same winning command replays through its idempotency key.

### 6.5 Error and Admin contract

Both routes use Unit 24's safe Section 28.4 mappings: `400 GRANOT_VALIDATION_FAILED`, `403 GRANOT_OWNER_REQUIRED`, `404 GRANOT_CASE_NOT_FOUND`, `409 DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT`, `409 GRANOT_CASE_REVISION_CONFLICT`, `409 DOMAIN_REVISION_CONFLICT`, `409 GRANOT_IDENTITY_CONFLICT`, and `422 GRANOT_POLICY_BLOCKED`. Apply the deterministic catalog/revision/identity/policy allocation above; do not invent an unlisted public Booking-not-found code or expose Mongo errors.

Extend Unit 24/23 Admin files:

- `review_existing_booking` shows the deterministic Booking read-only above actions and initializes the replacement form from **live official Booking values**, never Granot evidence;
- `create_missing_booking` exposes No Action but no Update action; Referral mode receives neither Unit 25 action;
- update uses full replacement controls, active ID catalogs, exact decimals, explicit review, and final button `Update Booking`;
- No Action uses the exact optional reason union/text, explicit review, and final button `Resolve — No Action`;
- evidence-only refetch updates evidence/timeline without resetting either draft. Submit the loaded case and Booking revisions;
- any `409` refetches detail/current Booking, explains the changed revision/identity, preserves every unsent replacement/reason field, and requires explicit resubmission;
- successful update or No Action invalidates case list/detail, Job timeline, linked Lead detail/timeline, Booking/Cancellation lists, and relevant analytics through Unit 23's helpers.

All controls use labeled fields, semantic review/error summary, focus management, keyboard navigation, non-color-only state, exact currency display with decimal input, pending/double-submit protection, and no bulk action. Admin renders server policy; it never reimplements current-state or already-satisfied decisions.

Extend the Admin BFF proxy authorization for both exact POST paths: Owner forwarding only, non-Owner denial, trusted signed admin headers, browser secret/actor-header stripping, and no direct lifecycle client call to the server.

## 7. Explicitly out of scope

- Confirm missing Booking and its selection/Record-Link correction (Unit 24), except reuse of its shared strict primitives.
- Referral case creation/No Action/leadless Booking (Unit 28); Release update/No Action/Cancellation (Units 26–27); discrepancies/correction (Unit 29).
- Case opening/evidence refresh/sequence/index/candidate business policy (Unit 22) or read projection/navigation foundations (Unit 23).
- Partial Booking patch, changing Job/Lead/source/customer/contact/local/submission/cancellation identity, selecting another Booking, or creating a second Booking.
- Automatic Booking/Cancellation/un-cancellation, compensation/reversal, bulk action, email, or any Granot official-field default.
- New models/indexes/backfills, production apply/deploy/flag changes, live payload/customer inspection, or external sends.
- Raw payload, headers, credentials, unmasked contact/address, or customer data in projections, logs, errors, tests, reports, issue/handoff text, or agent output.

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

Unit 25 does not reset any separately reviewed Booking-case runtime posture inherited from Unit 23/24.

Both routes fail closed unless `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=true`. Tests inject the flag only in a disposable environment. Unit 25 completes S16 capability, so after server/Admin deployment, index verification, full test-mode proof, and separate rollout authorization, the flag may be enabled narrowly for reviewed Owners and one reviewed source/effect at a time. The checked-in default remains false. Referral, Release, and email flags remain false.

## 9. Migration and indexes

**None.** Consume Unit 22 case indexes, the Booking normalized-Job unique index, active Record Link index, and Unit 10/11 Command/Change/outbox indexes. Do not add a second uniqueness/idempotency/index contract or backfill cases/Bookings.

Run `pnpm migration:granot-lifecycle:indexes -- --verify` before staging proof. It is read-only; no report/apply or production mutation is authorized by this unit.

## 10. Acceptance criteria

- [ ] **AC-20 (command/UI portion):** evidence-only refresh does not stale `expected_case_revision` or erase update/No Action drafts; resolution is immutable and later same-kind evidence uses the next sequence through Unit 22.
- [ ] **AC-21 (update/No Action):** two concurrent commands at one case revision have one winner; exact winner replay returns stored result; loser conflicts or update resolves already-satisfied without a second mutation.
- [ ] **AC-24:** full official replacement targets the exact deterministic Booking, preserves one Booking per Job, and cannot change Job/Lead/source identity or create another Booking.
- [ ] **AC-32:** every real Booking mutation has Receipt → Observation → Decision → Command → Change refs and one queued Sheet intent; already-satisfied, replay, and No Action have no aggregate Change or Sheet work.
- [ ] Update revalidates active Booking/case/link/Registry/catalog state with exact Booking/case CAS and integer-cents rules inherited from Unit 24.
- [ ] No Action records only Command plus case resolution/reason metadata; all aggregate/outbox/later-effect counts remain zero.
- [ ] Admin exact live-value initialization, action visibility, accessibility, invalidations, pending protection, and `409` unsent-input preservation are proven.

## 11. Required tests and commands

Name focused tests with AC-20, AC-21, AC-24, and AC-32. Server proof:

- strict update/No Action Zod, idempotency-header, auth, response/status, and safe error mapping tests;
- module tests for mode eligibility, deterministic Booking/link/source revalidation, complete replacement/no forbidden paths, exact cents/active catalog reuse, already-satisfied, disappeared/cancelled/conflicting Booking, and No Action reason metadata;
- real replica tests for update-vs-update, update-vs-No Action, exact replay/checksum conflict, case/Booking revision races, rollback at each write, full atomic update chain, and No Action zero-effect counts;
- before/after assertions for exactly one Booking, unchanged identity/source/contact fields, precise Booking/derived Lead revisions, one Change per mutated aggregate, one outbox for update, and none for No Action/already-satisfied/replay.

Admin proof includes API/error/query and BFF proxy ACL/header-stripping tests and components for live Booking initialization, full replacement, exact action visibility by mode, reason choices, explicit review/final labels, evidence refresh, update/No Action `409` draft preservation/refetch/no auto-resubmit, exact invalidation set, accessibility/keyboard/error focus, and double-submit prevention.

Run:

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test src/validation/v1/granotLifecycle.validation.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts src/services/domainCommands/domainCommands.test.ts
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test:granot-lifecycle:replica -- --unit=25
pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck

# vantage-admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Use landed focused filenames if different and record them. Mocked/UI proof cannot replace replica CAS/transaction/outbox assertions.

## 12. Live/staging verification

First use redacted synthetic test-mode data with queued Sheet mode and external delivery stubbed. Exercise live Booking initialization, exact replacement/cents/catalog snapshots, no forbidden identity fields, already-satisfied, replay/checksum conflict, update-vs-update and update-vs-No Action races, evidence refresh during both drafts, disappeared/cancelled/link-conflict handling, and No Action with/without reasons. Inspect only bounded case/Booking/Lead/link/Command/Change/outbox IDs, revisions, changed paths, outcomes, and counts.

After complete S16 deployment/review, only separate authorization may enable Booking commands for one reviewed source/effect and execute one reviewed case. Verify the Mongo/Sheet causal chain and observe one normal interval without raw payload/contact access. For No Action, verify case/Command only and zero Change/outbox/aggregate delta. Stop on duplicate Booking, identity/source mutation, partial replacement/commit, floating-money behavior, inactive catalog snapshot, missing causal ref, No Action side effect, lost Admin draft, raw-data exposure, or any Referral/Release/Cancellation effect.

## 13. Rollback

Set `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false` first; keep capture/processing, Booking cases, protected reads, and Admin read UI available. Hide/roll back faulty update/No Action callers without removing server reads. Preserve receipts, Observations, Decisions, activation, links/history, case evidence/resolutions, audits, Domain Commands, Entity Changes, outbox records, revisions, and committed official Booking/Lead values.

Never reverse a committed Booking update automatically, reopen a resolved case, decrement revisions, delete Command/Change evidence, or enqueue compensation. Repair requires a separate report-first reviewed command.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-25-COMPLETION.md` using Runbook Section 13. Include verified Unit 24 prerequisite; both repositories/branches; behavior-grouped server/Admin files; exact update/No Action schemas, command names, response/error/current-state/replacement contracts; invariants and AC allocation; migration `none` plus index verify; flags before/after and any separately authorized runtime action; focused/full/replica/lint/typecheck/build results; masked race/replay/already-satisfied/atomic update/No Action zero-effect/privacy/invalidation/accessibility proof; final Git statuses; and explicit external-action statement.

Successful implementation completes S16's Booking owner-command capability and makes Unit 28 contract-permitted once its reviewed Referral Registry classification is also satisfied. Unit 26 remains governed by its independent stable Booking read/identity prerequisite; no Release or Referral flag is unblocked automatically.
