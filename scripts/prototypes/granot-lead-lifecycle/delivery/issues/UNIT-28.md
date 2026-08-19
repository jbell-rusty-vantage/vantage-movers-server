# Unit 28 — Referral Booking case and leadless canonical owner workflow

> **Contract maturity: implementation-ready; implementation remains blocked by reviewed Referral Registry classification.** Units 24–25 are complete. This is S19 only: a reviewed Referral `booked` observation may create explicit owner work and, only after Owner confirmation, one leadless official Referral Booking. No source, Lead, contact, Job, or official Booking value is guessed or client-supplied outside the locked contract.

## 1. Authority and required reading

- **Final specification:** Sections 1–8 (especially 8.1/8.3/8.4), 13, 18–19, 21.1–21.2/21.4–21.5, 23–25 (especially 23.4 and 24.3/24.5), 27–29, 34–41; AC-28 and Section 38/S19.
- **Acceptance ownership:** Unit 28 owns AC-28 end to end: Referral source policy to case/read/Admin, no-Lead owner command, active Record Link Booking ref, official Booking, and only the Master Booked projection. It also owns Referral-case No Action required by Section 19. Unit 27 owns cancellation of an already-active Referral Booking.
- **Approved split:** Unit 28 in `specs/lead_lifecycle_issue_breakdown_reccomendation.md`; do not fold Referral into standard source-scoped confirm or into legacy direct Admin Referral creation.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`, repository/Admin instructions and applicable rules, verified Units 05–06/22–25 completion evidence, and the current reviewed Registry state.

The final specification wins. Registry disposition `referral_booking` has no Lead routes and uses `observation_only`. Referral requires no Lead creation, match, search, selector, Source Scope override, or CPL/source attribution mutation.

## 2. Objective

Deliver S19 as a dedicated gated vertical path. A valid live actual `booked` Observation whose uniquely reviewed Registry source is `referral_booking`, with no existing Booking, opens/refreshes `GranotBookingReconciliationCase.mode="create_referral_booking"` with no Source Scope or Lead suggestion. Protected projections/Admin show immutable accepted Granot contact/Job evidence and official fields separately, with no candidate browser. An explicit Owner supplies only strict official Booking details; the canonical command loads Job/contact from the accepted Observation, creates exactly one `is_referral_booking:true` Booking with no Lead, sets the active Record Link `booking_ref` with no `lead_ref`, resolves the case, records causal command/change/revision evidence, and queues only the Master Booked projection. Referral No Action resolves with zero aggregate/Sheet effects.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle` and `vantage-admin` / `granot-lead-lifecycle`. Server policy/DTO/error contracts are authoritative. No extension work.
- **Prerequisites:** Units 24–25 complete and current; a uniquely matched, Owner-reviewed `GranotCrmSource` for the Referral label/approved aliases with `lifecycle_enabled=true`, `lifecycle_disposition:"referral_booking"`, `lead_created_policy:"observation_only"`, no Lead routes, and a recorded policy version. Reverify Operations Registry audit/cache evidence rather than assuming label text.
- As of 2026-08-19, Units 24–25 are complete, but `UNIT-STATUS.md` and the Unit 25 handoff still record the separate reviewed Referral classification as unsatisfied. This contract is complete but implementation remains blocked until that evidence exists.
- Reverify Unit 22 case open/refresh/sequence/Decision transaction, Unit 23 no-candidate Referral-shaped projections, Unit 24 exact Booking creation/Record Link/Customer/command transaction primitives, Unit 25 No Action/strict official update helpers, normalized-Job uniqueness, and `booked_lead` Sheet planner behavior.
- Runtime writes use redacted synthetic `TEST_MODE=true` data on an explicitly confirmed replica set, queued Sheet mode with delivery stubbed, and test-injected flags. No commit, push, deploy, production Registry change/migration/flag enablement, live payload/customer read, or external send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-19:

- `GranotCrmSource` validation already enforces `referral_booking` with no Lead routes and `observation_only`; the source-policy/identity seams carry `referral_leadless`. Reviewed runtime row contents must still be verified.
- `bookingReconciliation.ts` currently returns `referral_owned_by_unit_28` whenever the policy/Booking is Referral, so no Referral case opens. Extend this explicit seam; do not add a second processor or reconciliation model.
- `GranotBookingReconciliationCase` already supports `create_referral_booking`, `referral_booking_created`, optional Source Scope/Record Link/deterministic Booking, no suggestion, the required indexes, and sequence semantics. No new case collection is needed.
- `projections.ts` already makes candidate search unavailable for `create_referral_booking` and marks `capabilities.referral`, but standard command capabilities/actions exclude Referral. Admin hides Unit 24–25 actions for Referral. Extend these reserved contracts rather than adding a parallel page/query family.
- `CanonicalDomainCommands` does not yet expose final-spec `createReferralBooking`. Legacy `runExistingCreateReferralBooking`/`referralBooking.service.ts` accepts client-supplied Job, contact, local/source-adjacent values and persists command `createExistingReferralBooking`; it is not the lifecycle contract. Canonicalize/reuse its low-level transaction and Master Booked planner without routing lifecycle through the legacy public input.
- Current Referral service writes `source:"referral"`, `is_referral_booking:true`, no Lead, and a `resource:"booked_lead"` intent. `jobPlanner.ts` maps that resource only to `master_booked`; `booking_chain` would also project a linked source Lead and must not be used for Referral create.
- `BookedLead` permits Referral without `lead_ref/lead_model` and has normalized-Job uniqueness. `GranotRecordLink` permits `booking_ref` without `lead_ref/source_scope`; its current refresh allowlist and Unit 24 command-owned writer must be extended canonically rather than bypassed.

The implementing agent must date and correct this evidence if predecessor or Registry state changed.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo Registry, Observation, case, Record Link, Booking, Command, Change, and outbox rows are authoritative; a payload label or Admin client is not.
- **Invariant 2:** the Booked Observation opens owner work but never creates/updates a Booking by itself.
- **Invariant 3:** Referral/case/current Booking facts compose lifecycle; no status enum is introduced.
- **Invariant 4:** normalized Job uniqueness plus active Record Link reservation guarantees at most one Booking; races never create a second.
- **Invariants 5–6:** only canonical `createReferralBooking` mutates the Booking/Record Link and atomically records Decision provenance, Command, Changes/revisions, case resolution, and one Sheet outbox intent.
- **Invariant 7:** replay, already-satisfied, and No Action create no duplicate aggregate Change or Sheet work.
- **Invariants 8–9:** source system/channel/actor/initiator remain separate; immutable Observation/creation evidence is never overwritten by owner or legacy Referral input.
- **Invariant 10:** Referral never reassigns Source Company, Source Granularity, Ingestion Origin, or CPL and never fabricates those Lead axes.
- **Invariant 11:** no Lead is searched, suggested, selected, created, enriched, booked, or contact-matched.
- **Invariant 12:** one open Booked case per Job, evidence-only refresh, immutable resolved cases, and next sequence after resolution remain Unit 22 semantics. A later actual Booked action against an existing Referral Booking must not create a second Booking or be silently dropped.

## 6. Deliverables and exact contract

### 6.1 Referral source gate and case routing

Extend the existing processor/`GranotBookingReconciliation` seam only when all applicable gates are true:

1. processing is enabled, activation exists, and the Observation is post-cutoff `live`;
2. `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=true` and `GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=true`;
3. the uniquely resolved `GranotCrmSource` is operationally enabled, lifecycle-enabled, and exactly `lifecycle_disposition:"referral_booking"` with `observation_only`, no routes, and reviewed policy version;
4. the normalized action is actual `booked` and normalized Job Number exists.

Priority `5` alone never opens a Referral case. Payload `type=AUTO`, Paid Overflow, an unmatched/ambiguous label, a future source label `Auto`, source-scoped rows, or guessed alias never enters this path. Malformed Priority on an otherwise-valid Booked action does not suppress the independent action.

With no Booking for the normalized Job, classify/open `mode:"create_referral_booking"`, `action_kind:"booked"`, no `source_scope`, no `suggested_lead`, and no deterministic Booking. Preserve the exact `granot_crm_source_id` in Decision gate/source-policy evidence even though no Lead Source Scope is created. Use the existing first-open/refresh/sequence/index transaction from Unit 22 with `booking_case_opened`/`booking_case_refreshed` and `GranotBookingReconciliationCase` target.

The accepted case evidence is append-only `{ observation_id, decision_id, captured_at, action:"booked" }`; observed context is display evidence only. Refresh deduplicates Observation ID, increments only evidence revision unless owner-relevant state changes, never attaches a Lead, and never changes the case mode.

If one active Referral Booking already exists for the normalized Job, do not open another create-referral case. The locked Section 19 actual-Booked/existing-Booking rule still requires review work: route to the existing `review_existing_booking` mode with that deterministic Booking and no candidate search/Lead requirement. Reuse the Unit 25 update/No Action UI and transaction primitives, but make their revalidation Referral-safe only behind both Booking-command and Referral gates. It may update that Booking's official fields or resolve No Action; it may not add a Lead/source scope or create another Booking. This compatibility treatment is required because the current Unit 25 implementation rejects Referral Bookings.

An incompatible existing Booking/link/Job identity returns the appropriate Booking discrepancy seam for Unit 29; it is not converted to a Referral create case. An officially cancelled existing Booking follows `booked_after_official_cancellation`. Do not persist discrepancies here.

### 6.2 Referral read/Admin contract

Reuse Section 28.2 case list/detail and Job/Lead timeline endpoints and Unit 23 query keys. Referral list/detail must show `kind:"booking"`, `mode:"create_referral_booking"`, case sequence/revisions/evidence, masked contact, Job, reviewed Registry source label, and the exact warning `Granot evidence — not official Vantage values`.

For `create_referral_booking`:

- `candidate_search.available=false`, no suggestion, no Source Scope override, no Lead timeline link/selector/search, and no Employee Booking reconciliation substitution;
- accepted Granot contact/Job display separately from blank official Booking details; estimate/payment/balance/move/source/suggested Agent never default an official field;
- capability `referral=true`; create/No Action actions appear only when the case is open and the required Referral/Booking-command gates are true;
- existing-Referral `review_existing_booking` shows current Booking values and update/No Action but still no Lead selector;
- actual evidence, Decisions, case sequence, Record Link change, Entity Change, official Booking, and later Release/Cancellation facts remain separate timeline entries.

Admin uses existing lifecycle pages and components. Add explicit review forms/final buttons `Create Booking` and `Resolve — No Action`, correct loading/error/focus/keyboard/non-color behavior, pending double-submit protection, and no bulk action. Evidence refresh never clears drafts. A `409` refetches current case/link/Booking, preserves every unsent official/reason field, explains the stable conflict, and never auto-resubmits. Admin never computes Referral classification, loads contact/Job into the body, or calls the server outside the BFF.

### 6.3 Strict Owner inputs, methods, and responses

Add/use exactly:

```text
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/create-referral-booking
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/no-action
```

Create Referral body contains only:

```ts
type ReferralBookingBody = {
  expected_case_revision: number; // integer >= 1
  official_booking_details: OfficialBookingDetails;
};
```

`OfficialBookingDetails` is the Unit 24–25 strict calendar-valid Book Date, 1–20 unique active Agent IDs, exact nonnegative two-decimal allocation/total/deposit values with integer-cents Binder equality, and active Merchant ID. There is no selected Lead, expected Lead revision, source/Job/contact/local/move/customer field, accepted Observation ID, Record Link ID, or override reason in the HTTP body. The service derives them from immutable case/current state.

Referral No Action reuses the exact strict `{ expected_case_revision, reason_code?, reason_text? }` contract and Section 21.1 union. Extend Unit 25's Booking No Action mode allowance to `create_referral_booking` only behind the Referral/Booking-command gates; keep command name `resolveGranotBookingCaseNoAction` and zero-effect semantics.

Both routes require one exact 8–200 printable-character `Idempotency-Key`, trusted Owner auth, strict unknown-key rejection, and server checksum. Implement:

```ts
interface GranotBookingReconciliation {
  createReferralBooking(input: ReferralBookingCommand): Promise<BookingOwnerCommandResult>;
  noAction(input: NoActionCommand): Promise<BookingOwnerCommandResult>;
}

interface CanonicalDomainCommands {
  createReferralBooking(input: {
    normalized_job_no: string;
    accepted_observation_id: string;
    official_booking_details: OfficialBookingDetails;
    context: CanonicalCommandContext;
  }): Promise<CanonicalCommandResult>;
}
```

Persist exact command name `createReferralBooking`. Response extends Unit 24–25 result with `outcome:"referral_booking_created" | "no_action" | "already_satisfied"`; create returns `201`, No Action/already-satisfied `200`, and exact replay stored `200` with `replayed:true`. Use standard Section 28.4 validation/Owner/not-found/idempotency/case revision/domain revision/identity/policy codes; do not invent Referral-specific public codes.

### 6.4 Accepted Observation and current-state revalidation

As narrow issue-author guidance consistent with Units 24–25, the first immutable evidence entry is the stable accepted Observation/Decision for command provenance and contact/Job loading. Load the protected `GranotObservation` by that ID; never trust copied display context or ask the client to repeat/select an Observation. It must be a valid Booked action, belong to the case/receipt/Decision chain, normalize to the same Job, and resolve to the same reviewed Referral source. If not, fail closed with no write.

Inside the executor transaction revalidate:

- open `create_referral_booking` case and exact case revision;
- both Referral and Booking command flags, trusted Owner, live post-activation evidence, and current reviewed Registry classification;
- normalized Job from accepted Observation equals case Job;
- no current Booking exists for that normalized Job;
- active Record Link is absent or compatible: same provider/Job, no conflicting Lead/source scope/Booking, and correct current revision;
- active Agent/Merchant catalogs and exact cents still pass.

Use the normalized-Job Booking unique index and active Record Link unique index as final race guards. Duplicate-key race rereads: exact same Referral Booking/link state resolves `already_satisfied`; different identity is `GRANOT_IDENTITY_CONFLICT`. No source/company/granularity/Lead/contact match or payload-label inference is allowed.

### 6.5 Atomic Referral creation and projection

Refactor the legacy Referral transaction into a canonical internal primitive taking the verified normalized Job, accepted Observation contact, fixed reviewed Referral classification, official details, and transaction context. Do not invoke legacy `createExistingReferralBooking` or accept its broad public body.

In one `executeIdempotentCanonicalCommand` transaction:

1. create exactly one `BookedLead` with normalized/raw Job from the accepted Observation; accepted contact/customer data available from that Observation; submitted official details; canonical `source:"referral"`; `is_referral_booking:true`; `is_leadless_booking:false`; and no `lead_ref`, `lead_model`, Source Scope, Ingestion Origin, CPL, or fabricated local value;
2. create/update the active Granot Record Link with that `booking_ref`, no `lead_ref`, no source scope, preserved first/current Observation/Decision evidence, and a revision/`EntityChange`; reject any conflicting active link;
3. persist Booking revision/`EntityChange`, `DomainCommandExecution`, and case resolution `outcome:"referral_booking_created"` with Owner actor/entity ref;
4. persist exactly one queued `resource:"booked_lead"`, `operation:"referral_booking.create"` Sheet intent.

The `booked_lead` planner must target only `master_booked`. Assert no source Form/Call row, source-specific Booked projection, Cancellation, Lead mirror, Lead Change, `booking_chain`, notification, or email. External Sheet delivery occurs only after commit. Contact/address values in Change/audit data are reference-only; raw payload and unmasked contact never enter logs/projections/reports.

No Action writes only Command plus case resolution/reason and increments case revision once; it creates no Booking/Customer/Lead/Record Link revision/Change/outbox or later effect. Exact replay does not re-resolve.

### 6.6 Admin proxy, invalidation, and audit

Allow Owner-only BFF forwarding for the exact create-referral path and the existing No Action path when server capabilities allow it; deny Admin/non-Owner, forward exactly one idempotency key and trusted signed actor, and strip browser authority/secret headers. Mutation audit contains bounded case/command/outcome refs only—no contact, Job payload, money, catalog IDs, reason text, or response body.

Success invalidates lifecycle case list/detail, Job timeline, Booking lists/detail, relevant analytics/catalogs, and any Record Link-derived view. There is no selected Lead/Lead candidate invalidation for create-referral. Existing-Referral review update may invalidate a linked Lead only if one legitimately exists; it must not fabricate one.

## 7. Explicitly out of scope

- Standard source-scoped Booking confirmation/update behavior except the narrow Referral-safe existing-Booking compatibility required by Section 19; Release commands/cancellation (Units 26–27); discrepancies/correction (Unit 29).
- Registry guessing, migration-time enabling, unreviewed alias creation, Source Company/Granularity/CPL assignment, Lead creation/search/selection/attachment/enrichment, or Employee Booking reconciliation.
- Automatic Booking creation/update, Cancellation/un-cancellation, second Booking, Record Link correction across conflicting identity, partial official fields, or Granot defaults.
- Legacy public Referral route redesign/removal beyond extracting the canonical transaction primitive; optional email, health/certification, production rollout, and compatibility cleanup.
- New model/index/backfill, production Registry mutation/apply/deploy/flag action, live payload/customer inspection, raw payload/secret/unmasked contact/address in any output, or external sends.

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

Tests inject post-activation live, Booking cases/commands, and Referral only in disposable mode. Referral case opening requires Booking cases plus Referral; create/No Action/update require Booking commands plus Referral. Disabling Referral stops new Referral cases/commands but never deletes or hides existing evidence/cases/Bookings. After dedicated AC-28 test-mode acceptance, deployment/index verify, and separate rollout authorization, enable Referral for the one reviewed Registry source/effect only. Checked-in default and email/Release flags remain false.

## 9. Migration and indexes

**None.** Consume existing Booking-case, normalized-Job Booking, active Record Link, Command/Change, and outbox indexes. The prerequisite reviewed Referral classification must use the existing audited Operations Registry command; it is an external readiness gate, not an ad hoc Unit 28 migration or payload-label update.

Run read-only index verification before staging proof:

```text
pnpm migration:granot-lifecycle:indexes -- --verify
```

No report/apply, Registry mutation, backfill, or production change is authorized by issue assignment.

## 10. Acceptance criteria

- [ ] **AC-28:** a valid reviewed Referral Booked Observation opens/refreshes a leadless Referral case; no Lead search/selector appears; explicit Owner create produces exactly one leadless Referral Booking; and only the appropriate Master Booked projection syncs.
- [ ] False Referral flag, shadow/historical mode, unreviewed/ambiguous/deferred source, Priority-only evidence, missing Job, existing conflicting Booking/link, or disabled command gate produces no Referral official effect and no source guessing.
- [ ] Case/read/Admin proof preserves separate immutable evidence/current official fields, no Source Scope/suggestion/candidates, explicit review, draft-preserving conflict recovery, and zero automatic Booking behavior.
- [ ] Booking/link/Command/Changes/case/outbox commit atomically with full Receipt → Observation → Decision → Command → Change refs; replay/already-satisfied/No Action create no duplicate aggregate/Sheet work.
- [ ] Active Record Link has `booking_ref` and no `lead_ref/source_scope`; Booking has Referral flag/source and no Lead; no Form/Call/Lead Change/source projection exists.
- [ ] A later Booked action with an existing active Referral Booking enters review-existing without creating a second Booking and remains no-Lead-safe.

## 11. Required tests and commands

Name all focused tests with AC-28. Server proof must include:

- Registry/source-policy/classifier tests for exact reviewed Referral, flag/mode/action gates, malformed Priority independence, Priority-only no case, no Booking versus existing active/cancelled/conflicting Booking, and no alias/source guess;
- model/module tests for `create_referral_booking` open/refresh/sequence/replay, no Source Scope/suggestion/candidates, accepted first Observation loading, strict official input, and Referral No Action;
- route/projection tests for Owner/auth/idempotency/status/error/masking, blank official draft, no Lead endpoints/selector, Referral detail/timeline, capability gates, and forbidden-key scan;
- real replica tests for simultaneous case open, simultaneous create, create-vs-No Action, normalized-Job/link races, exact replay/checksum conflict, already-satisfied, rollback at every write boundary, and immutable resolved next sequence;
- exact before/after proof of one Booking, one active leadless link, case/Command/Changes, one `booked_lead` outbox with only `master_booked`, and zero Lead/Cancellation/source-sheet/discrepancy/notification/email work;
- regression tests for existing Referral Booked review-existing and Unit 27-compatible cancellation without changing standard Booking behavior.

Admin proof covers typed create/No Action clients, exact BFF ACL/header stripping/audit, no candidates/Lead selector, blank official fields, accepted contact/Job labels, explicit review/final buttons, evidence refresh, `409` draft preservation/refetch/no auto-submit, invalidations, accessibility, and double-submit prevention.

Run:

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test src/validation/v1/granotLifecycle.validation.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts src/services/granotLifecycle/referralBooking.test.ts src/services/domainCommands/domainCommands.test.ts src/services/sheetSync/drainer/jobPlanner.test.ts
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test:granot-lifecycle:replica -- --unit=28
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck

# vantage-admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Use landed focused filenames if different and record exact outcomes. Mocked/UI proof cannot replace replica transaction/race/outbox-target proof. Update Granot lifecycle/Booking behavior documentation and applicable organization/schema/owner-workflow rules.

## 12. Live/staging verification

First use a reviewed synthetic Referral Registry fixture, redacted accepted Observation, queued Sheet mode, and stubbed external delivery. Exercise disabled/enabled flags, open/refresh/sequence, no Lead rendering, strict create, No Action, replay/checksum conflict, create/No Action races, link/Job duplicate race, existing Referral review, and rollback boundaries. Inspect only bounded Registry/case/Observation/Decision/Booking/link/Command/Change/outbox IDs, revisions, flags, outcome/reason, and target names. Assert the target set is exactly `master_booked` and all Lead/Cancellation/later-effect counts stay zero.

Only after dedicated acceptance, deployment/index verification, and separate authorization may Referral be enabled for the one reviewed Registry source. Verify one test-mode Referral and its Master Booked target set before any reviewed live case. Production verification is read-only unless rollout is separately authorized and never reads raw payload/contact. Stop on unreviewed label routing, any Lead/source/CPL fabrication, duplicate Booking/link, wrong Sheet target, missing causal ref, automatic effect, lost Admin draft, raw-data exposure, or email/Release/discrepancy effect.

## 13. Rollback

Set `GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=false` first; if the fault is owner mutation, also keep/honor `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED` independently for standard cases. Disable the Referral caller/UI while preserving capture/processing, case reads, immutable evidence, and all already-created official Bookings. If source policy itself is wrong, set that Registry row `lifecycle_enabled=false` only through the audited Operations Registry command; do not edit/delete it directly.

Preserve receipts, Observations, Decisions, activation, Registry audits, Record Links/history, cases/evidence/resolutions, Bookings/Customers, Commands, Changes, revisions, and outbox records. Never delete a committed Referral Booking, attach a compensating Lead, reopen a case, decrement revisions, rewrite the link/evidence, or delete Sheet intent. Repair requires a separately reviewed report-first canonical command.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-28-COMPLETION.md` using Runbook Section 13. Include the exact reviewed Referral Registry evidence; both repositories/branches; verified Unit 24–25 primitives; behavior-grouped files; exact case/gate/input/accepted-Observation/command/link/Booking/Sheet contracts; invariants and AC-28 proof; migration `none` plus index verify; flags before/after; focused/full/replica/lint/typecheck/build results; masked disabled/no-Lead/race/replay/already-satisfied/No Action/atomicity/privacy/target-set/Admin proof; final Git statuses; and explicit external-action statement.

Successful implementation completes S19. It does not authorize production Referral enablement or unblock Unit 29, whose prerequisite remains Units 24–27; Unit 28 is not a prerequisite for Unit 29 in the approved spine.
