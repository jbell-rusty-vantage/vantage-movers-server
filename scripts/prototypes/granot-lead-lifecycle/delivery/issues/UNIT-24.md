# Unit 24 — Confirm missing standard Booking owner workflow

> **Contract maturity: implementation-ready; implementation remains blocked by Units 22–23 and Owner review of the read-only workflow.** This is the confirm-missing portion of S16. It adds one explicit Owner command from a reviewed `create_missing_booking` case to an official standard Booking. It does not enable Booking commands, implement existing-Booking update/No Action, or authorize any automatic Booking effect.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 13, 18–19, 21.1–21.2/21.4–21.5, 23–25, 27–29, 34–41; especially Section 24.1, the Section 23.2 transaction/CAS rules, AC-20–23/32, and 38/S16.
- **Acceptance ownership:** Unit 24 owns confirm-missing form/route/command proof for AC-20/21/22/23/32. Unit 22 owns case open/refresh/sequence/index behavior; Unit 23 owns read projections/candidate browsing; Unit 25 completes S16 with existing-Booking update and Booking No Action; Unit 29 owns general discrepancy and Record Link correction workflows.
- **Approved split:** Unit 24 in `lead_lifecycle_issue_breakdown_reccomendation.md`; confirm-missing only. Do not pull the remaining S16 paths forward.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`; server/admin instructions and rules; verified completion reports and repository state for Units 10–11 and 22–23; the landed Unit 22 case/service and Unit 23 server DTO/Admin client are the immediate contracts to extend.

The final specification wins. Granot evidence and case display values are evidence, not Booking authority. Only an authenticated Owner's explicit command may create the Booking.

## 2. Objective

Deliver the end-to-end `Confirm Granot Booking` workflow for an open standard `create_missing_booking` case: render a blank official form, require explicit eligible Lead selection, validate active Agent/Merchant IDs and exact money in integer cents, revalidate current case/Lead/Record-Link/Registry/Booking facts, then atomically create exactly one Booking, mirror its official relationship to the selected Lead, establish or correct the active Record Link, resolve the case, persist the causal command/change/revision chain, and queue the Booking Chain Sheet Sync intent. Provide deterministic replay, one-winner concurrency, safe already-satisfied handling, and Admin `409` recovery that preserves unsent input.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle` and `vantage-admin` / `granot-lead-lifecycle`. The server contract lands first; Admin consumes the exported DTO/error contract. No extension work.
- **Specification prerequisites:** Units 10–11 and 22–23 plus Owner review of the deployed read-only Booking cases. Unit 24 must verify their completion reports, repository state, migrations/indexes, flags, and tests—not the ledger alone.
- **Current sequencing gate:** as of 2026-08-18, only Units 01–15 have completion reports; Units 16–17 are merely ready and Units 18/22/23 remain blocked. Therefore this complete contract remains implementation-blocked.
- Before edits, verify the landed Unit 22 case model/indexes and reconciliation interface; Unit 23 case/candidate DTOs, masking, query keys, and detail UI; Unit 10/11 executor, `EntityChange`, queued outbox, revision CAS, and transaction-bound Booking internals; active Booking normalized-Job unique index; active Record Link index; and current Booking/Lead/Registry revisions.
- Runtime writes use only `TEST_MODE=true`, an explicitly confirmed disposable replica-set database, `SHEET_SYNC_MODE=queued` with post-commit delivery stubbed, synthetic redacted fixtures, and test-injected flags. No commit, push, deploy, production mutation/index apply, flag enablement, live payload inspection, or external send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-18; reverify after every prerequisite lands:

- Server lifecycle code currently ends at Unit 15. `GranotBookingReconciliationCase`, `bookingReconciliation.ts`, case mutation routes, and confirm-booking validation do not yet exist; Unit 22/23 must supply the exact read/case seams this unit extends.
- `CanonicalDomainCommands` currently exposes compatibility Booking create/attach operations but not a Granot owner confirm command. `executeIdempotentCanonicalCommand` already owns the Mongo transaction, stored replay, and post-commit boundary; extend that foundation rather than starting a nested transaction.
- Existing Booking create/update services accept Agent names, resolve Merchant names, and compare Binder with floating-point tolerance. This unit must add ID-based active catalog resolution and exact integer-cents validation for the strict lifecycle contract; it must not weaken legacy endpoint compatibility.
- `BookedLead` stores canonical Agent ObjectIds/name snapshots and a Merchant name string, has `domain_revision`, and declares the unique partial normalized-Job index. Owner input nevertheless uses `agent_id` and `merchant_id`; resolve each active row by ObjectId inside the command and persist the canonical snapshots/name.
- Existing generic Booking create may upsert by Lead and derive fields from legacy request values. The Granot confirm path may not upsert, accept source/Job/contact overrides, or prefill from Granot. It requires a transaction-bound create-only internal operation with normalized Job Number and Booking source loaded only from the case/current reviewed case-source projection; the selected Lead supplies permitted relationship/customer facts, never source authority.
- Lifecycle checked-in defaults have processing/shadow true and all effect flags false. The current Admin repository has Granot Automation and Employee Booking reconciliation but no Granot lifecycle client/components/routes; Unit 23 must land those first and keep the two workflows distinct.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo case, Lead, Registry, Record Link, Booking, Agent, and Merchant facts are authoritative at submit time; the browser and Granot display context are not.
- **Invariant 2:** no Priority/Booked Observation creates a Booking. Only this explicit Owner command does.
- **Invariant 4:** exactly one Booking may exist per normalized Job Number; the unique index is the final race guard.
- **Invariants 5–6:** the Booking/Lead/Record-Link mutations go through one canonical command and atomically persist causal provenance, `DomainCommandExecution`, `EntityChange` rows, revision transitions, case resolution, and Booking Chain outbox intent.
- **Invariant 7:** replay/already-satisfied comparisons create no second aggregate mutation, `EntityChange`, or Sheet Sync intent.
- **Invariants 8–10:** source system, channel, ingestion origin, actor, and initiator remain distinct. Confirming/correcting a Record Link never rewrites Lead Source Company, Source Granularity, Ingestion Origin, CPL, or immutable snapshots.
- **Invariant 11:** Duplicate Form Leads and Bad Form Leads are ineligible for selection/booking, including all-scope search results.
- **Invariant 12:** case resolution is one-way; evidence refresh does not stale the form, and a resolved sequence is never reopened.

## 6. Deliverables and exact contract

### 6.1 Strict HTTP and service command

Add the exact strict Zod body under `src/validation/v1/granotLifecycle.validation.ts` and the Owner-only route:

```text
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking
```

```ts
type ConfirmBookingBody = {
  expected_case_revision: number; // integer >= 1
  selected_lead: {
    lead_model: "FormLead" | "CallLead";
    lead_id: string;              // ObjectId
  };
  out_of_scope_override_reason?: string; // trimmed 10–500 only when required
  official_booking_details: {
    book_date: string;            // strict calendar-valid YYYY-MM-DD
    agent_allocations: Array<{
      agent_id: string;           // ObjectId of active Agent
      binder_amount: number;      // finite, >= 0, <= 2 decimal places
    }>;
    total_binder_amount: number;  // finite, >= 0, <= 2 decimal places
    deposit_amount: number;       // finite, >= 0, <= 2 decimal places
    merchant_id: string;          // ObjectId of active Merchant
  };
};
```

The route obtains `case_id` only from `:id`; reject any body `case_id` or unknown key. Require exactly one `Idempotency-Key` header matching 8–200 printable non-whitespace-bounded characters. Derive trusted Owner actor/initiator, command ID, request ID, and SHA-256 checksum of the stable canonical `{ command_name, case_id, validated_body }` server-side. The service command contains `case_id` plus the validated body and context; clients cannot supply provenance, revisions other than `expected_case_revision`, official Job/source/contact, or a selected-Lead revision.

Allocations contain 1–20 unique Agent IDs. Convert each submitted decimal representation to integer cents before equality checks; reject truncation/rounding and more than two fractional digits. `sum(agent binder cents) === total binder cents` exactly. Resolve Agent/Merchant ObjectIds with `active:true` inside the command transaction, then persist Agent name snapshots and the canonical Merchant name string required by `BookedLead`.

### 6.2 Canonical command and response

Implement `GranotBookingReconciliation.confirmBooking(input)` under `src/services/granotLifecycle/bookingReconciliation.ts`. It invokes the Unit 10/11 executor exactly once. Use stable stored command name `confirmGranotBooking` as narrow issue-author guidance because Section 23.4 names the deep `confirmBooking` interface but is silent on the persisted command string; lock it in tests and handoff.

The command result returned to the route is:

```ts
type BookingOwnerCommandResult = {
  case_id: string;
  case_state: "resolved";
  case_revision: number;
  outcome: "booking_created" | "already_satisfied";
  command_execution_id: string;
  decision_id: string;
  booking_ref: { id: string; domain_revision: number };
  record_link_ref: { id: string; domain_revision: number };
  entity_refs: Array<{ model: string; id: string }>;
  replayed: boolean;
};
```

Fresh creation returns `201 { ok:true, data }`. Exact replay returns stored `200` data with `replayed:true`; an already-satisfied resolution returns `200`. Persisted command result remains `{ status:"applied", entity_refs, warnings }`; `replayed` is transport metadata, never a rewritten stored status. Include at least the case, Booking, selected Lead, and active Record Link refs in the durable result.

This response shape is narrow issue-author guidance because the final specification names `OwnerCommandResult` without defining its fields. For stable causal provenance, anchor the owner command to the case sequence's first append-only `CaseEvidence` Observation/Decision pair (the specification does not select among refreshed evidence). Do not insert a second `SynchronizationDecision` for the later Owner command. Evidence-only refresh may not change the checksum/context or stale the form. Provenance must satisfy the `granot_lifecycle` fixed processor actor contract while preserving the authenticated Owner as initiator; no browser-supplied actor snapshot is trusted.

### 6.3 Submit-time eligibility and current-state revalidation

Inside the executor transaction, re-read and validate all of the following before any write:

1. case ObjectId exists, `action_kind:"booked"`, `mode:"create_missing_booking"`, `state:"open"`, and `case_revision === expected_case_revision`;
2. `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED` is true in the injected runtime posture and the case's current reviewed Registry source/scope remains active and permits the standard source-scoped Booking path;
3. selected Lead exists in the declared model, is current, not Duplicate/Bad, and remains eligible under the Unit 22 candidate/source-scope policy; exact Source Scope is normal, all-scope is permitted only to Owner with the required override reason;
4. out-of-scope status is recomputed server-side; require trimmed 10–500 when out of scope. Ignore the optional reason for eligibility when the Lead is in scope, while retaining it only as non-authoritative command/audit metadata. Never record it on the Lead or treat it as source authority;
5. the case's Record Link, when present, is still the active provider/normalized-Job link and has no incompatible Lead/Booking/source claim. If no active link exists, the command may establish it under the unique active-link guard; a permitted explicit selection may confirm or case-specifically correct `lead_ref`. None of these paths changes Lead Source Scope;
6. no Booking exists for the normalized Job. Also reject a conflicting Booking already attached to the selected Lead. Do not call the legacy create-upsert behavior;
7. selected Lead and Record Link are re-read immediately before CAS. The server loads their current revisions; the HTTP schema does not invent an extra expected-Lead token. Concurrent mutation must fail the guarded write/retry as the correct `DOMAIN_REVISION_CONFLICT` or `GRANOT_IDENTITY_CONFLICT`;
8. every Agent and Merchant still exists and is active at command execution.

### 6.4 Atomic creation/effect set

In the single Mongo transaction:

- create exactly one standard non-Referral/non-leadless `BookedLead` using normalized Job Number and Booking source from the case/current reviewed case-source projection, permitted relationship/customer facts from the selected Lead, and only the submitted official Booking details;
- never copy Granot move date, estimate, payment, balance, contact, source, Priority, or suggested Agent into official Booking fields;
- mirror the Booking relation and derived deposit thresholds to the selected Lead through transaction-bound Booking internals without changing source/origin/CPL/immutable evidence;
- establish/confirm/case-specifically correct active `GranotRecordLink.lead_ref`, set `booking_ref`, append causal evidence, and advance its revision under the active-link uniqueness guard;
- resolve the case with `state:"resolved"`, `resolution.outcome:"booking_created"`, `command_execution_id`, Owner actor, `entity_ref` to the Booking, and one `resolved_at`; increment `case_revision` exactly once and leave `evidence_revision` unchanged;
- persist one `EntityChange` for every changed aggregate (Booking, selected Lead when mirrored fields change, and Record Link), with exact before/after revision, safe changed paths, case/receipt/Observation/Decision provenance, and no raw contact/address values;
- persist the `DomainCommandExecution` and exactly one queued Booking Chain Sheet Sync intent atomically. External Sheet work/finalization runs only after commit.

If a duplicate normalized-Job race is reread and the existing Booking has the same selected Lead and identical official desired state, resolve the still-open case as `already_satisfied` with the command execution but no aggregate `EntityChange`/outbox. Any different Booking identity or official state is a conflict; never overwrite or create a second Booking. A failure at any step leaves no Booking, mirror/link delta, case resolution, Change, Command, or outbox visible.

### 6.5 Error and Admin contract

Map errors to the final Section 28.4 envelope with safe `request_id`/structured issues: `400 GRANOT_VALIDATION_FAILED`, `403 GRANOT_OWNER_REQUIRED`, `404 GRANOT_CASE_NOT_FOUND`, `409 DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT`, `409 GRANOT_CASE_REVISION_CONFLICT`, `409 DOMAIN_REVISION_CONFLICT`, `409 GRANOT_IDENTITY_CONFLICT`, and `422 GRANOT_POLICY_BLOCKED`. As narrow fail-closed issue-author guidance: malformed, unknown, or inactive submitted Agent/Merchant IDs are `400 GRANOT_VALIDATION_FAILED`; disabled command/source policy is `422 GRANOT_POLICY_BLOCKED`; stale aggregate CAS is `409 DOMAIN_REVISION_CONFLICT`; incompatible Job/Lead/link/source identity is `409 GRANOT_IDENTITY_CONFLICT`. Duplicate Job/Lead/link races must resolve into these stable codes, not raw Mongo errors.

Extend Unit 23's `lib/api/granotLifecycle.ts`, `booking-command-form.tsx`, case detail, and query keys. The form:

- starts every official Booking field blank and displays Granot estimate/payment/balance only under `Granot evidence — not official Vantage values`;
- requires explicit eligible Lead selection even when a high-confidence candidate is visually preselected; medium confidence is display-only and ambiguity selects nothing;
- shows the exact out-of-scope warning and reason only after the server-compatible scope result;
- uses active catalog IDs, exact decimal inputs, labeled error summary/focus/keyboard behavior, review screen, and final button `Create Booking`;
- submits the currently loaded `case_revision` but does not clear local form state on evidence-only refresh;
- on any `409`, refetches case/candidates/current facts, explains which revision/identity changed, and preserves every unsent official/selection/reason value. It never automatically resubmits.

On success invalidate case list/detail, Job timeline, selected Lead detail/timeline, the previously linked Lead detail/timeline when correction changed the Lead ref, Booking lists/details, relevant analytics, and catalog-dependent projections. Use Unit 23's exported invalidation helpers rather than ad hoc keys.

Extend the Admin BFF proxy authorization for this exact POST path: an authenticated Owner may forward it with trusted signed admin headers, every non-Owner is denied, browser secrets/forged actor headers are stripped, and the lifecycle client never calls the server directly.

## 7. Explicitly out of scope

- Existing Booking replacement and Booking No Action (Unit 25); Release commands (Unit 27); Referral case/Booking (Unit 28).
- General discrepancy persistence/re-evaluate/no-action or arbitrary Record Link correction (Unit 29). This unit owns only the correction inseparable from a successful explicit create-missing selection.
- Case open/refresh/sequence/candidate policy/indexes (Unit 22) and read DTO/timeline/list/navigation foundations (Unit 23), except consuming/extending them.
- Automatic Booking creation/update, Cancellation/un-cancellation, Granot-supplied official defaults, background Lead attachment, bulk actions, or changing Job/Lead/source identity.
- New persistent model/index/backfill, production migration apply, flag enablement, deployment, live payload/customer inspection, or external sends.
- Raw payload, headers, credentials, unmasked contact/address, or customer data in issue/handoff text, fixtures, logs, errors, changes, reports, or agent output.

## 8. Flags and runtime posture

Start and checked-in end defaults remain exactly:

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

`GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` may already be separately enabled in a reviewed runtime after Unit 23, but this issue does not alter that inherited environment value or the checked-in default.

The confirm route/service fail closed with `GRANOT_POLICY_BLOCKED` unless `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=true`. Tests inject it only in the disposable environment. Because Unit 24 is only half of S16 and the flag is shared with Unit 25, do not operationally enable it after this unit. Unit 25 owns completion of the S16 command rollout gate. Referral and every Release/email flag remain false.

## 9. Migration and indexes

**None.** Unit 22 owns the five Booking-case indexes; Units 09–11 own aggregate revisions, Booking normalized-Job uniqueness, `DomainCommandExecution`, `EntityChange`, and outbox foundations. Unit 24 adds no collection/index/backfill and must not duplicate them.

Before test/staging proof, run the read-only `pnpm migration:granot-lifecycle:indexes -- --verify` and verify the Booking normalized-Job, active Record Link, case, Command, Change, and outbox contracts. No `--apply` is authorized.

## 10. Acceptance criteria

- [ ] **AC-20 (owner-form portion):** evidence refresh changes only evidence revision/timeline and never stales `expected_case_revision` or clears form input; resolved sequence cannot accept another command.
- [ ] **AC-21 (confirm portion):** two concurrent confirm commands have one winner; exact winner replay returns the stored result; loser returns the correct conflict or safely resolves already-satisfied with no second mutation.
- [ ] **AC-22:** explicit eligible Lead, strict Book Date, 1–20 unique active Agents, exact Binder cents sum, nonnegative two-decimal Deposit, and active Merchant are mandatory; Granot display fields never default official fields.
- [ ] **AC-23 (confirm portion):** all-scope selection requires the 10–500 character override reason and case-specific Record Link correction/owner evidence, while Lead Source Company/Granularity/Ingestion Origin/CPL remain unchanged.
- [ ] **AC-32 (mutation boundary):** the created Booking chain has Receipt → Observation → Decision → Command → Change references; replay/already-satisfied/no-op emits no extra Change or Sheet work.
- [ ] Exactly one Booking exists for the normalized Job; selected Lead/current link/Registry/catalog eligibility is revalidated; different-identity duplicate races fail closed.
- [ ] Admin auth, strict schema/header, blank-by-default review, accessibility, safe errors, success invalidation, and `409` unsent-input preservation are proven.
- [ ] No automatic Booking/Cancellation, second Booking, source reassignment, raw-data exposure, Referral/Release/discrepancy effect, or email occurs.

## 11. Required tests and commands

Name focused tests with AC-20, AC-21, AC-22, AC-23, and AC-32. Required server proof:

- strict Zod/header/route/auth/status/error tests, including forbidden body fields and money lexical edge cases;
- pure cents tests for 0, two-decimal values, duplicate IDs, 20/21 allocations, excess fractional digits, and exact sum mismatch;
- module tests for every submit-time revalidation, normal/all-scope selection, stable first-evidence provenance, active catalog ID snapshots, blank Granot defaults, and already-satisfied/different-state behavior;
- real replica-set tests for concurrent confirms, idempotent replay/checksum conflict, Booking unique-index race, case/Lead/link revision races, rollback at each write, and one atomic Booking/Lead/link/case/Command/Change/outbox chain;
- explicit collection/field counts proving all forbidden effects absent and source/origin/CPL/snapshots unchanged.

Admin proof includes API response/error and BFF proxy ACL/header-stripping tests, active catalog ID binding, blank form/review, high/medium/ambiguous selection, override warning/reason, cents validation, evidence refresh, `409` state preservation/refetch without resubmit, exact invalidations, accessible labels/focus/keyboard/error summary, and final button text.

Run:

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test src/validation/v1/granotLifecycle.validation.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts src/services/domainCommands/domainCommands.test.ts
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test:granot-lifecycle:replica -- --unit=24
pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck

# vantage-admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Use landed focused filenames if different and record them. UI/mocked tests cannot replace the replica-set transaction/uniqueness proof.

## 12. Live/staging verification

With redacted synthetic data in test-mode/staging, queued Sheet mode, and Booking commands injected true, exercise: blank create form; active/inactive/duplicate catalog IDs; exact Binder cents; high/medium/ambiguous and all-scope Lead selection; evidence refresh during edit; selected-Lead/link/Registry/case races; simultaneous confirm; exact replay; same-state already-satisfied; and different-state duplicate conflict. Inspect only bounded case/Booking/Lead/link/Command/Change/outbox IDs, revisions, changed paths, outcomes, and counts. Stub post-commit delivery, verify exactly one queued Booking Chain intent, and prove no external call.

Keep the operational flag false after proof. No production case command is authorized in Unit 24. Stop on any Granot default entering official fields, inactive catalog acceptance, floating-point sum behavior, duplicate Booking, wrong Lead/link/source, missing causal ref, non-atomic residue, lost Admin draft, raw-data exposure, or automatic/later-unit effect.

## 13. Rollback

Leave/set `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false` first and hide/roll back the Admin confirm caller if needed. Keep Booking cases/read UI available. Preserve receipts, Observations, Decisions, activation, Record Links/history, cases/evidence/resolutions, audits, Domain Commands, Entity Changes, outbox evidence, and every committed official Booking/Lead fact.

Never delete or reverse a committed Booking automatically, reopen a resolved case, decrement revisions, detach/correct links, purge evidence, or enqueue compensating Sheet work. Any data repair requires a separate report-first reviewed command.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-24-COMPLETION.md` using Runbook Section 13. Include verified Units 10–11/22–23 and Owner-review evidence; both repositories/branches; behavior-grouped server/Admin files; exact schema/cents/catalog/selection/revalidation/command/result/error contracts; invariants and AC allocation; migration `none` plus index verify; flags before/after; focused/full/replica/lint/typecheck/build results; masked concurrency/replay/already-satisfied/atomicity/outbox/privacy/forbidden-effect proof; final Git statuses; and an explicit external-action statement.

Successful implementation makes Unit 25 contract-permitted but does not operationally enable the shared Booking command flag. Unit 25 must independently reverify the landed confirm workflow before completing S16.
