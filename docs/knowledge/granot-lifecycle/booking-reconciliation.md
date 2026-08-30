---
type: Service
title: "Granot Booking reconciliation (`granotLifecycle/bookingReconciliation`)"
description: Booking-case open/refresh plus gated Owner confirm, update, referral, and No Action commands.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/bookingReconciliation.ts
applies_to:
  - src/services/granotLifecycle/bookingReconciliation.ts
  - src/services/granotLifecycle/bookingPriorityPairing.ts
  - src/services/granotLifecycle/bookingConfirmation.ts
  - src/services/granotLifecycle/confirmAttachment.ts
  - src/services/granotLifecycle/bookingOwnerCommands.ts
  - src/services/granotLifecycle/referralBooking.ts
  - src/models/GranotBookingReconciliationCase.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/bookingReconciliation.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-08-28T19:15:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority (trigger and pairing):** [`booking-reconciliation-booked-only-specification.md`](../../granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md). FINAL SPEC still wins on modes, uniqueness, revisions, Owner commands, Referral, and discrepancies.  
**Primary code:** `src/services/granotLifecycle/bookingReconciliation.ts`, `bookingPriorityPairing.ts`, `bookingConfirmation.ts`, `confirmAttachment.ts`, `bookingOwnerCommands.ts`, `referralBooking.ts`, `src/models/GranotBookingReconciliationCase.ts`, `src/services/granotLifecycle/processor.ts`
**Domain terms used:** [Granot Booking Reconciliation Case](../../../../CONTEXT.md), [Booking Priority Pairing](../../../../CONTEXT.md), [Referral Booking](../../../../CONTEXT.md), [Leadless Booking](../../../../CONTEXT.md), [Update Existing Booking](../../../../CONTEXT.md), [No Action](../../../../CONTEXT.md), [Synchronization Decision](../../../../CONTEXT.md), [Granot Observation](../../../../CONTEXT.md), [Source Scope](../../../../CONTEXT.md)

# Granot Booking reconciliation (`granotLifecycle/bookingReconciliation`)

**Role:** Persist evidence-backed owner work for actual Booked observations. A case is not a Booking. Official Booking changes occur only through explicit Owner commands. [Booking Priority Pairing](../../../../CONTEXT.md) is an audit projection on the case, not a trigger.

## Trigger and routing

The channel-neutral processor is the only **automatic** caller (`maybeReconcileBooking`). `discrepancyOwnerCommands.ts` may also call `reconcileBookingCaseAfterDiscrepancy` after an Owner discrepancy correction. Automatic open/refresh passes only immutable Observation/Decision IDs after activation, live-mode classification, source policy/identity, and the exact Booking-case gate snapshot. Historical shadow, live shadow, disabled gates, Release, missing Job, and unsupported evidence create no case.

| Current evidence/fact | Result |
| --- | --- |
| Priority `5` without Booked | `not_booking_evidence`; no case; Observation may apply lead desired-state |
| actual Booked, no Booking | open/refresh `create_missing_booking`; ambiguous Lead means no suggestion |
| actual Booked, one active Booking | open/refresh `review_existing_booking` with its ID |
| Booking without Lead, `booking_origin=employee_booking` (or existing employee case) | delegate to that `BookingLeadReconciliationCase`; persist Decision and stop if the employee case is missing (`employee_reconciliation_missing`). Employee pending Leadless path unchanged |
| Booking without Lead, Granot official Leadless | open/refresh `review_existing_booking` with the Booking ID. Do not fail closed. Confirm does not open a `BookingLeadReconciliationCase` |
| officially cancelled Booking | `booked_after_official_cancellation` → processor persists a discrepancy (no Booking case) |
| actual Booked from exact reviewed Referral, no Booking | open/refresh `create_referral_booking`; no Source Scope, suggestion, or Lead search |
| actual Booked with one active Referral Booking | open/refresh `review_existing_booking` with its ID and no Lead requirement |
| Priority-only Referral | no case |
| identity/Job/source conflict on actual Booked | typed discrepancy classification; processor persists via `createGranotDiscrepancies` |

Classifier `evidence_action` for new traffic is `booked` only; it never emits `priority_5`. Stored evidence still allows historical `priority_5` rows. Priority validity never suppresses a valid actual Booked action. Persist and `reconcileBookingCaseAfterDiscrepancy` fail closed unless the classification is actual Booked. Booking work never reads, closes, or mutates Release work.

On Booked open or a new Booked evidence append, the same transaction writes an optional `priority_pairing` snapshot from `projectBookingPriorityPairing`: pairing class (`priority_5_then_booked` | `booked_carries_priority_5` | `booked_without_priority_5`), creating Booked Observation id and Priority flags, and preceding Priority 5 Observation id/time when one exists. `later_priority_5` is never stored. Exact Observation replay does not rewrite the snapshot. Pairing never increments `case_revision` by itself. Historical Priority-5-only cases keep their evidence and have no pairing snapshot.

## Transaction, uniqueness, and revisions

Within one Mongo transaction the service rereads the Observation, active link, current Unit 14 identity, deterministic Booking/Cancellation facts, and current employee reconciliation work. It finds the open `{job, booked}` case; otherwise it allocates `max(sequence_number)+1`. The case write and effect-bearing immutable Decision commit together. Duplicate/open/sequence races receive at most one explicit retry.

The exact unique indexes are open `{normalized_job_no, action_kind}` (partial on `state:"open"`) and `{normalized_job_no, action_kind, sequence_number}`. Three additional read indexes cover state/evidence time, Booking/state, and suggested Lead/state. Migration report masks Job/document identifiers, reports collisions before unique creation, creates non-unique definitions first, and never applies without explicit authorization.

Open starts with `case_revision=1`, `evidence_revision=1`. A new Observation appends the four-field evidence tuple and increments only `evidence_revision`; exact replay changes nothing. Suggestion/current-work changes increment `case_revision`. Resolved rows cannot be reopened or otherwise modified, and later evidence creates the next sequence. Evidence refresh therefore never stales an Owner draft keyed by `case_revision`.

## Owner commands

| Method | Path | Command | HTTP |
|--------|------|---------|------|
| `POST` | `/api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking` | `confirmGranotBooking` | 201 (200 on replay/`already_satisfied`) |
| `POST` | `.../update-booking` | `updateBooking` (route telemetry `updateGranotBooking`) | 200 |
| `POST` | `.../create-referral-booking` | `createReferralBooking` (route telemetry `createGranotReferralBooking`) | 201 (200 on replay/`already_satisfied`) |
| `POST` | `.../no-action` | `resolveGranotBookingCaseNoAction` (route telemetry `resolveGranotBookingNoAction`) | 200 |

Every command requires `requireRegistryOwnerActor`, one strict `Idempotency-Key`, the first case-evidence Receipt/Observation/Decision chain, an enabled Booking-command gate, and current reviewed Registry/source facts. Flag-off is **422** `POLICY_BLOCKED`. Stale case/Booking revision is **409** `CASE_REVISION_CONFLICT` / `DOMAIN_REVISION_CONFLICT`. Checked-in command defaults remain false.

- Official `official_booking_details` accept `book_date`, `deposit_amount`, `total_binder_amount`, `merchant_id`, `primary_agent_id`, and optional `secondary_agent_id`. Per-agent `agent_allocations[]` is rejected. Stored `BookedLead.agent_allocations` come from `officialBookingAllocations` (even-cent split). See [`agent-allocation.md`](../services/agent-allocation.md). Confirm `selected_lead` is optional. Connect Booking to Lead ships from `/bookings` ([`bookings.md`](../services/bookings.md)); unmasking is not implemented.
- `confirmGranotBooking` resolves an open `create_missing_booking` case. Official details are required. Attachment is server-owned in `resolveConfirmAttachment`: Owner `selected_lead` always wins (Duplicate/Bad/cancelled rejected; all-scope needs a 10–500 override); unique high suggestion auto-attaches only when `confidence === "high"` and the match method is in `HIGH_CONFIDENCE_BOOKING_MATCH_METHODS`; medium / none / `source_scoped_contact` is Leadless. Attached persist is unchanged eligibility/override/CAS; a lost claim fails closed (`IDENTITY_CONFLICT` / `DOMAIN_REVISION_CONFLICT`) and does not fall through to Leadless. Leadless persist writes official `is_leadless_booking: true`, no `lead_ref`, customer from Observation contact, booking-only Record Link, Master Booked intent, and `owner_notice`. Same-state existing Booking plus matching Record Link is `already_satisfied`.
- `updateBooking` is available only for open `review_existing_booking`. It revalidates the deterministic active Booking, normalized Job, linked Lead/source **or** Granot official Leadless (`isGranotOfficialLeadlessBooking`: leadless, not referral, not `employee_booking` origin, no `lead_ref`/`lead_model`), optional active Record Link, exact Booking/case revisions, and active Agent/Merchant IDs. It fully replaces only Book Date, Agent allocations, total Binder, Deposit, and Merchant; derived deposit thresholds alone may mirror to an already-linked Lead. One transaction writes aggregate Change(s), case resolution, Command, and one coalescible queued intent (`booking_chain` / `booked_lead.update` when attached; `booked_lead` / `booked_lead.update` when Leadless). Identity/source/contact/local/submission/cancellation fields cannot change.
- `resolveGranotBookingCaseNoAction` is available for open standard create-missing or review-existing cases. Optional reason code/text are metadata only. Its transaction writes the Command plus one case resolution/revision and creates no aggregate revision, `EntityChange`, Sheet Sync intent, link, discrepancy, notification, or replacement case.
- `createReferralBooking` is available only for open `create_referral_booking` behind both Booking-command and Referral gates. It derives the accepted first Observation/Decision and exact reviewed Referral source from immutable evidence, accepts only complete blank-entered official fields, and atomically creates one no-Lead Referral Booking, one active booking-only Record Link, two Changes, case resolution, Command, and one `booked_lead` / `referral_booking.create` intent. The planner targets only Master Booked.
- Existing Referral `review_existing_booking` reuses full official update and No Action, but revalidates the Referral Decision/source policy, never attaches or mutates a Lead/Source Scope, and queues `referral_booking.update` as a master-only Booking write.

Exact replay returns the durable result. A same-state update resolves `already_satisfied` without aggregate Change/outbox. Case and Booking compare-and-swap filters produce one winner; stale case, stale/cancelled Booking, and link/Job/source incompatibility fail closed. External Sheet delivery is post-commit only.

## Suggestions, privacy, and posture

Suggestions are projections of the current Unit 14 identity result. Record Link, exact Form, exact Call Job, and Booking-owner evidence are high confidence; Source Scope contact is medium; ambiguity has no suggestion. Unit 23's case-scoped browser additionally queries current eligible Leads for Owner review, defaults to Source Scope, and marks all-scope rows with override-warning metadata. Duplicate Form and Bad Form rows are excluded server-side. Browsing and the 24-hour identity refresh never attach or correct a Lead.

Evidence contains IDs, capture time, and action only. Bounded display context is separate and never becomes an official Booking input. Open/refresh events contain masked IDs; `granot_lifecycle_open_cases{kind="booking",mode}` is recomputed cardinality, so evidence refresh does not increment it.

Checked-in `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false`, `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false`, and `GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=false`; Release/email flags also remain false. Referral reads remain visible when evidence exists, while create/update/No Action capabilities require the command and Referral gates. Deployment, production index verification, and narrow source/effect enablement remain separately authorized. // pragma: allowlist secret
