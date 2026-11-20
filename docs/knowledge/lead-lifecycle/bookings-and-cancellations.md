---
okf_version: "0.2"
type: Reference
title: Bookings and Cancellations on Leads
description: How a Form Lead or Call Lead becomes booked, cancelled or re-booked at 9955430d, which flags each command writes, and how official Booking and Cancellation records stay reportable without a Lead.
tags: [lead-lifecycle, granot-lifecycle, form-lead, call-lead, sheet-sync]
status: current
stale_after: 2027-01-20
resource: docs/knowledge/lead-lifecycle/
verified_at: 9955430d
applies_to:
  - src/services/granotLifecycle/bookingConfirmation.ts
  - src/services/granotLifecycle/bookingReconciliation.ts
  - src/services/granotLifecycle/bookingOwnerCommands.ts
  - src/services/granotLifecycle/releaseOwnerCommands.ts
  - src/services/granotLifecycle/referralBooking.ts
  - src/services/granotLifecycle/officialCancellationWrite.ts
  - src/services/granotLifecycle/connectBookingToLead.ts
  - src/services/domainCommands/bookings.ts
  - src/services/domainCommands/existingWrites.ts
  - src/services/bookings/**
  - src/models/BookedLead.ts
  - src/services/cancellations/**
  - src/services/employeeBookings/**
  - src/services/reconciliation/**
  - src/routes/v1.routes.ts
  - src/routes/granot-lifecycle-admin.routes.ts
  - src/routes/booking-reconciliation-cron.routes.ts
owners: [team:main-server]
sources:
  - id: code
    resource: src/services/granotLifecycle/bookingConfirmation.ts
  - id: mirror
    resource: src/services/bookings/bookingMirror.service.ts
  - id: cancel
    resource: src/services/cancellations/cancelledLead.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
---

# Bookings and Cancellations on Leads

A Lead becomes **booked** when an official Booking (`BookedLead`) points at it and the Lead's `booked` holds that Booking's `_id`. It becomes **cancelled** when an official Cancellation (`CancelledLead`) exists for that Booking and the Lead's `cancelled` holds the Cancellation's `_id`. Granot priority 5 never books a Lead ([granot-effects.md](granot-effects.md#8-priority-5-means-booked-in-granot-not-booked)).

Owner directive (workspace `AGENTS.md`, Call Lead billing 2026-11-03): **official Booking and Cancellation rows remain reportable.** A Booking never qualifies a Call Lead, and a Booking does not need a Lead. Unmatched Call Lead creation is retired; a Booking without a stored Lead is a **Leadless Booking**.

All line ranges are at `9955430d`. Tab routing details are in [reporting-and-sheets.md](reporting-and-sheets.md); Desk effects in [downstream-consumers.md](downstream-consumers.md).

## 1. Flags written on the Lead

| Field | Meaning | Written by | Cleared by |
|---|---|---|---|
| `booked` | `_id` of the official Booking | `confirmGranotBooking`, `createBookingFromLead`, `connectBookingToLead`, `attachBookingToLead` / `resolveBookingLeadReconciliation` / `autoAttachBookingLead` / `submitEmployeeBooking` (via `claimAvailableLeadForBooking`), `updateBookedLead` (re-mirror) | `deleteBookedLead` and reconciliation `reassign` (`clearBookingFromLead`) |
| `cancelled` | `_id` of the official Cancellation | `createCancellation` (Granot case or `POST /api/v1/cancelled-leads`) | `deleteCancelledLead` (`clearCancellationFromLead`), `deleteBookedLead` / `reassign` (`clearBookingFromLead`) |
| `over_2000`, `over_4000` | Deposit thresholds (`deposit_amount > 2000`, `> 4000`) | All booking writers; both Granot `updateBooking` commands | `clearBookingFromLead` sets `false` |
| `local` | Move type copied from the Booking | `createBookingFromLead`, claim path | not cleared |
| CPL snapshot | Re-resolved by `mirrorBookingToLead` unless `preserveExistingCpl` | `createBookingFromLead`, `updateBookedLead`, attach paths re-resolving source | n/a |

No booking or cancellation command writes `job_no`, `normalized_job_no`, `granot_priority`, `duplicate`, `form_fill`, `bad_lead`, `created_on_unmatched` or `no_sync` on a Lead, with one exception: the Best Relocation `from-source` Call match rewrites `phone_number` and, on a phone match, `job_no` (§3.2). A cancelled Lead keeps `booked`; both fields are set together.

### Shared writers

| Function | Source | Rule |
|---|---|---|
| `claimAvailableLeadForBooking` | `bookings/bookingMirror.service.ts` L156–L188 | Guarded `updateOne`: `booked` null, `cancelled` null, `duplicate ≠ true`, and for Calls `created_on_unmatched ≠ true` (L168–L175). Sets `booked`, `over_2000`, `over_4000`, `local` (L177–L184). **Does not check `bad_lead`.** |
| `mirrorBookingToLead` | L108–L149 | `lead.save`: `booked`, `over_*`, `local`; Form source reassignment when the Booking source maps to another company; CPL snapshot unless `preserveExistingCpl`. |
| `clearBookingFromLead` | L198–L216 | `lead.save`: unsets `booked` **and** `cancelled`; `over_*` → `false`. |
| `mirrorCancellationToLead` | `cancellations/cancellationMirror.service.ts` L15–L24 | `lead.save`: `cancelled`. `booked` kept. |
| `clearCancellationFromLead` | L36–L51 | `lead.save`: unsets `cancelled` only. |

## 2. Granot official Booking (main production path)

### 2.1 Case opening (no Lead write)

**Source:** `granotLifecycle/processor.ts:maybeReconcileBooking` L558–L669 → `bookingReconciliation.ts:reconcilePreparedObservation` L270–L329, `reconcileInTransaction` L364–L570, `classifyBookingReconciliation` L1106–L1210, `toBookingLeadSuggestion` L1212–L1236.

- Trigger: an Observation whose `booking_action` is `booked` or `release`, with a job, via webhook, extension `booked-reconciliation/sync` or automation receipt. Gates: source policy `booking_reconciliation` effect.
- Classification precedence: already officially cancelled (Release → `already_current`; Booked → discrepancy `booked_after_official_cancellation`) → Referral source (`create_referral_booking` or review existing) → existing leadless Booking (employee reconciliation case or `review_existing_booking`) → identity conflict → discrepancy → existing Booking → `review_existing_booking`; else `create_missing_booking`.
- Suggested Lead: the Granot identity target when `target_eligibility = full`; `confidence` is `medium` for `source_scoped_contact`, else `high`.
- Effects: case insert or refresh, Decision `linked`, Daily Operations `recordGranotIntakeDailyOperationsFact` (not on replay). No Lead, no EntityChange on a Lead, no Sheet job.
- Idempotency: one open case per `normalized_job_no` and `action_kind`; evidence de-duplicated by Observation.

### 2.2 `confirmGranotBooking`

**Source:** `granotLifecycle/bookingConfirmation.ts:confirmBooking` L76–L178, `applyConfirmation` L180–L389, `persistLeadlessConfirmation` L391–L511, `persistLink` L570–L626, `resolveCase` L627–L646; attachment rule `confirmAttachment.ts:resolveConfirmAttachment` L34–L57.

| Aspect | Rule |
|---|---|
| Trigger | `POST /api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking` (`routes/granot-lifecycle-admin.routes.ts` L248–L276), Owner registry actor, one `Idempotency-Key`. All 449 production confirmations have an Owner `vantage_admin` initiator. |
| Preconditions | Case `action_kind: booked`, `mode: create_missing_booking`, open, `case_revision` matches; `booking_commands_enabled`; reviewed source scope still active (L216–L229, L520–L545); active Agents and Merchant; compatible Record Link (no other `booking_ref`, same scope). |
| Attachment (precedence) | Owner-selected Lead wins. Otherwise a unique `high` suggestion whose method is in `HIGH_CONFIDENCE_BOOKING_MATCH_METHODS` (`granot_record_link`, `form_ref_no_exact`, `form_mongo_id_compatibility`, `form_job_no_exact`, `call_job_no_exact`, `booking_job_no_exact`) auto-attaches. Medium, missing or ambiguous → **Leadless Booking**. |
| Lead guards | Selected Lead exists, `duplicate !== true`, `bad_lead` null (L250–L252); in scope or an override reason of 10–500 characters (L253–L259); not `cancelled` (L260–L262); not already booked and no other Booking holds it (L284–L289). The write repeats `duplicate ≠ true`, `booked`/`cancelled` empty, `bad_lead` empty for Forms, and the `domain_revision` CAS (L317–L331). `created_on_unmatched` and Call reporting eligibility are not checked. |
| Fields written | Lead: `booked`, `over_2000`, `over_4000` (L328). BookedLead: `job_no` from the case, `lead_ref`, `lead_model`, allocations, amounts, `merchant`, `source` (company slug), `local`, `is_referral_booking: false`, `is_leadless_booking` (L292–L315). Record Link: created or CAS-updated with `lead_ref`, `booking_ref`, `disputed: false` (L570–L626). Case → `resolved`, `booking_created`. |
| Existing Booking on the job | Same official details and same Lead and link → `already_satisfied`, no writes (L263–L283); otherwise `IDENTITY_CONFLICT`. |
| EntityChange | `confirmGranotBooking` on BookedLead, the Lead and the Record Link (L355–L370); leadless: BookedLead and Record Link only. |
| Sheet Sync | Intent persisted in the transaction, finalized after commit when not replayed: `booking_chain` / `booked_lead.create` with a Lead, `booked_lead` / `granot_booking.create_leadless` without (`confirmSheetIntent` `confirmAttachment.ts` L74–L81). The chain upserts Booked Deals and the Lead's own Master Leads row (Lead tab unchanged by `booked`; see [reporting-and-sheets.md](reporting-and-sheets.md)). |
| Outreach | Lead EntityChange with `booked` (an admission decision path): the Desk closes the subject as an official Booking. |
| Daily Operations | `recordBookingDailyOperationsFact`, `bookingKind: "granot_confirm"`, dedupe `booking:<id>:created` (L148–L153). |
| Idempotency | `executeIdempotentCanonicalCommand`, origin `granot_lifecycle`, Owner key; checksum over `{command_name, case_id, validated_body}`; one retry on duplicate key. |
| Time window | None. `book_date` is the Owner-entered calendar date stored at `T00:00:00.000Z`. |

Production (read 2026-11-20 12:47 New York): 449 confirmations (2026-08-25 to 2026-11-20 15:24 UTC): 230 attached a Form Lead, 144 a Call Lead and 75 were leadless. 559 Form Leads and 371 Call Leads carry `booked`.

### 2.3 Other Granot case commands

| Command | Source | Lead effect | Sheet / Daily Ops |
|---|---|---|---|
| `updateBooking` (booking case, mode `review_existing_booking`) | `bookingOwnerCommands.ts:updateExistingBooking` L105–L141, `applyUpdate` L205–L357 | `$set over_2000/over_4000` with filter `{_id, domain_revision, booked: booking}` only when they differ and the Booking is neither referral nor leadless (L257–L308). | `updateBookingSheetIntent` (`booking_chain`/`booked_lead.update`, leadless `booked_lead`/`booked_lead.update`, referral `booked_lead`/`referral_booking.update`). No fact. |
| `updateBooking` (release case) | `releaseOwnerCommands.ts:updateExistingBooking` L165–L309 | Same `over_*` write (L232–L249). | Always `booking_chain`/`booked_lead.update`. No fact. |
| `createCancellation` (booking case, latest evidence must be `release`) | `bookingOwnerCommands.ts:confirmCancellation` L164–L203 | See §5.1. | `cancellation_chain`/`cancelled_lead.create`; `recordCancellationDailyOperationsFact`. |
| `createCancellation` (release case) | `releaseOwnerCommands.ts:confirmCancellation` L97–L163 | See §5.1. | Same Sheet intent; **no** Daily Operations fact. |
| `createReferralBooking` | `referralBooking.ts:createReferralBooking` L93–L184 | **Not Lead-mutating.** BookedLead `source: "referral"`, `is_referral_booking: true`, no Lead; Record Link `booking_ref`. | `booked_lead`/`referral_booking.create`. No fact. |
| `resolveGranotBookingCaseNoAction`, `resolveGranotReleaseCaseNoAction` | `bookingOwnerCommands.ts:noAction` L143–L162; `releaseOwnerCommands.ts:noAction` L311–L346 | Not Lead-mutating: case `no_action`. | none |

Production: 19 `createReferralBooking` (to 2026-11-20 16:42 UTC), 136 `resolveGranotBookingCaseNoAction`, 1 `updateBooking` (2026-09-28).

## 3. Admin and API Booking commands (`/api/v1`, API secret)

Every route below runs `existingWriteContextFromRequest` (`domainCommands/existingWriteContext.ts` L21–L50): key `existing:<command>:<submission_id>` or `request:<command>:<requestId>`, origin `vantage_admin`, `executeCanonicalCommandWithPostCommit` (`domainCommands/idempotency.ts` L163–L188; a replay returns the stored result, a different checksum conflicts; `external_sheet_ingestion` is permanently rejected L86–L88). No Lead revision CAS.

### 3.1 `createBookingFromLead` — `POST /api/v1/booked-leads`

**Source:** `domainCommands/existingWrites.ts:runExistingCreateBookingFromLead` L267–L337 → `bookings/bookedLead.service.ts:persistBookedLeadCreateInTransaction` L252–L406.

- **Guards:** `local` required for Forms (L291–L296). **No Lead state guard**: `duplicate`, `bad_lead`, `booked`, `cancelled` and `created_on_unmatched` are not read. A second Booking for the same job is blocked by the unique `normalized_job_no` index (`models/BookedLead.ts` L120–L135).
- **Re-booking precedence:** if a Booking already exists for this `lead_ref`/`lead_model`, a matching `submission_id` is a no-op; otherwise that **same Booking is overwritten in place** (L307–L340). `cancelled` on the Booking and Lead is left as it was.
- **Writes:** BookedLead created or upserted; Lead via `mirrorBookingToLead` (`booked`, `over_*`, `local`, CPL, Form source reassignment).
- **EntityChange:** `createBookingFromLead` on BookedLead and the Lead (`existingWrites.ts` L287–L316).
- **Sheet:** `booking_chain` / `booked_lead.create`, or `booked_lead.upsert` on the upsert branch.
- **Daily Operations:** `bookingKind: "admin"`, dedupe `booking:<id>:created`.
- Production: 23 executions, all 2026-08-20 to 2026-09-06 (21 Form, 2 Call). Current, unused since September.

### 3.2 `createBookingFromLead` — `POST /api/v1/booked-leads/from-source`

**Source:** `existingWrites.ts:runExistingCreateBookedLeadFromSource` L639–L677 → `bookedLeadFromSource.service.ts:resolveFromSourceAttach` L52–L107, `createBookedLeadFromSourceInTransaction` L120–L285.

- Form Lead: loaded by ID, no eligibility check; `booking_origin: owner_booking` unless Best Relocation.
- Call Lead (non-Best-Relocation): owner match through `evaluateEmployeeBookingMatch` (`ownerBookingAttach.ts` L90–L110), whose candidate query includes Form Leads by job, so the Form preference below applies and a `CallLead` request can link a Form Lead; then `linkedLeadStillEligible` (`ownerBookingAttach.ts` L167–L185) rejects `cancelled`, `booked`, `duplicate`, `created_on_unmatched`. A rejection falls back to a **leadless owner-pending Booking** (`booked_lead`/`owner_booking.create_pending`, no Daily Operations fact).
- Call Lead with `ingestion_source: best_relocation_sheet`: matched by job, then phone, **no eligibility check**; rewrites the Call's `phone_number` and, on a phone match, `job_no` (`bookingSourceResolver.ts` L39–L98). The origin block in `idempotency.ts` L86–L88 never fires here, because this route's origin is always `vantage_admin` (`existingWriteContext.ts` L44), and the schema field is still accepted (`validation/v1/bookings.validation.ts` L87). The retired path is therefore still reachable (see [COVERAGE.md](COVERAGE.md#owner-directive-findings), finding 4).
- Best Relocation only: fills an empty receiver from the primary allocation (`bookedLead.service.ts` L146–L159).
- Otherwise as §3.1.

### 3.3 `createLeadlessBooking` — `POST /api/v1/leadless-bookings`

**Source:** `existingWrites.ts` L339–L409 → `bookings/leadlessBooking.service.ts` L131–L335.

- 409 when any Booking already has the raw `job_no` (L145–L152). `ingestion_source` forced undefined.
- BookedLead `is_leadless_booking: true`, `booking_origin: "owner_booking"`, plus an owner `BookingLeadReconciliationCase`. **Not Lead-mutating.**
- Sheet `booked_lead` / `owner_booking.create_pending`. Daily Operations `bookingKind: "leadless"`.
- `cancelledLead.service.ts` L249 also names `createLeadlessBooking` for the legacy Best Relocation leadless-cancellation path (unreachable: origin retired).
- Production: 1 (2026-09-08).

### 3.4 `createExistingReferralBooking` — `POST /api/v1/referral-bookings`

**Source:** `existingWrites.ts` L411–L459 → `bookings/referralBooking.service.ts:createReferralBookingInTransaction` L27–L85. 409 on an existing raw `job_no`; BookedLead `is_referral_booking: true`, `source: "referral"`. **Not Lead-mutating.** Sheet `booked_lead`/`referral_booking.create`; Daily Operations `referral`. Production: 0 rows.

### 3.5 `updateBookedLead` — `PATCH /api/v1/booked-leads/:id`

**Source:** `existingWrites.ts` L558–L597 → `bookedLead.service.ts:updateBookedLeadInTransaction` L555–L674. 409 for referral, leadless, or Lead-less Bookings. No cancelled check. Lead re-mirrored with `preserveExistingCpl: false` (CPL recomputed on every edit). EntityChange BookedLead + Lead. Sheet `booking_chain`/`booked_lead.update`. No fact. Production: 2 (2026-10-28).

### 3.6 `updateBooking` — canonical `domainCommands/bookings.ts:updateBooking` L70–L160

Registered only in `canonicalDomainCommands` (`domainCommands/index.ts` L45–L62), which has no runtime consumer. BookedLead only; it does not mirror `over_*` to the Lead. Sheet `booking_chain`/`booked_lead.update`. The single production `updateBooking` execution (2026-09-28) came from a Granot case command sharing the name.

### 3.7 `deleteBookedLead` — `DELETE /api/v1/booked-leads/:id?cascade=`

**Source:** `existingWrites.ts` L741–L770 → `bookedLead.service.ts:deleteBookedLeadInTransaction` L887–L1028; legacy `deleteBookedLead` L771–L880 (used by the customer and Form/Call delete cascades).

- 409 when the Booking has no Lead and is neither referral nor leadless; 409 when cancelled and `cascade` is false.
- Deletes the cascaded Cancellation; `clearBookingFromLead` (unsets `booked` and `cancelled`, `over_*` false); `releaseLiveBookingClaims` (`releaseLiveBookingClaims.ts` L22–L109) `$unset booking_ref` on the active Record Link and `deterministic_booking_id` on open cases; deletes the Booking.
- EntityChange: CancelledLead `$deleted`, Lead `booked` only (the `cancelled` and `over_*` clears are not recorded), Record Link, BookedLead `$deleted`.
- Sheet (queued mode): tombstones `delete_cancelled_lead` and `delete_booked_lead` remove the Cancelled Deals and Booked Deals rows from the tombstone's `previous_targets`; `source_lead`/`delete_booked_lead` re-plans the Lead's row. A removal outside this command leaves the row (no tombstone).
- Production: 3 Bookings (2026-09-28 to 2026-11-03).

## 4. Employee bookings and booking-Lead reconciliation

No path here creates a Call Lead. `call_qualification` and Call reporting eligibility are not read; candidates are all Call Leads matching job or phone (`employeeBookings/leadCandidateQueries.ts` L34–L58). Only `connectBookingToLead` rejects a `bad_lead` Form.

**Booking intake prefers the Form Lead** (Owner 2026-10-29): `employeeBookings/leadMatchEvaluator.ts:preferFormLeadForSharedJob` L292–L313, called from `evaluateEmployeeBookingMatch` L12–L57. When exactly one Form Lead and at least one Call Lead match the same `job_no`, the Call candidates matched by `job_no` are removed (a Call matched by phone only stays), the Form carries warning `call_lead_shares_job`, and the preferred model becomes `FormLead` even for a call-channel submission. Two Form Leads on the job → normal flow (usually `multiple_matches`). Callers that apply it: Employee Booking Submission, the Owner `POST /booked-leads/from-source` Call path (`ownerBookingAttach.ts` L90–L110, `bookedLeadFromSource.service.ts` L30, L63), the `autoAttachBookingLead` rematch cron (`reconciliationRematch.service.ts` L153) and the Owner refresh, pending-edit and reopen actions (`bookingLeadReconciliation.service.ts` L190, L273, L572). Callers that do not: the Owner resolve action, `connectBookingToLead`, and `confirmGranotBooking`, whose suggestion is the Granot identity target picked from the source policy model.

| Command | Trigger | Lead effect | Sheet | Daily Ops | Idempotency | Prod rows |
|---|---|---|---|---|---|---|
| `submitEmployeeBooking` (`submitEmployeeBooking.service.ts` L53–L417) | `POST /api/v1/employee-booking-submissions` (API secret, `x-public-client-key-hash`, throttle) | Linked: claim sets `booked`, `over_*`, `local` (L224–L232) after re-checking `cancelled`, `booked`, `duplicate`, Call `created_on_unmatched` (L172–L191). Pending: leadless Booking `booking_origin: employee_booking` + reconciliation case. | `booking_chain`/`employee_booking.create_linked` or `booked_lead`/`employee_booking.create_pending` | `booking.created` (`employee_linked`) or `booking.employee_pending` | unique `submission_id`; unique `normalized_job_no` → 409 | 0 |
| `resolveBookingLeadReconciliation` (`bookingLeadReconciliation.service.ts` L352–L547) | `POST /api/v1/admin/booking-lead-reconciliations/:id/resolve` (Owner) | `attach_existing` / `reassign`: claim on the new Lead; reassign clears the old Lead (`clearBookingFromLead`). `create_and_attach`: **creates a Form Lead** (`createAndAttachReconciliationFormLead`, `bookingLeadAttachment.service.ts` L118–L210: Owner input, Form duplicate check, CPL, `post_to_granot: false`, no `job_no`, no `ingestion_origin`) then claims it; flips matching Calls to `form_fill` via `markCallLeadFormFill`. `dismiss`: case only. | `booking_chain`/`booking_reconciliation.{attach_existing,create_and_attach,reassign}`, `source_lead`/`booking_reconciliation.detach_old` | none | case `revision` CAS | 0 |
| `attachBookingToLead` (`domainCommands/bookings.ts` L170–L296) | canonical registry only, no runtime consumer | Calls the resolve path with `attach_existing`. | as above | none | case revision | 0 |
| `autoAttachBookingLead` (`reconciliationRematch.service.ts:runDueBookingLeadRematches` L31–L291) | Cron `/api/cron/booking-reconciliation-rematch` every 5 min (`vercel.json`), `CRON_SECRET`; disabled when env `BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED=false` (default on, `config/domain/bookingReconciliation.ts` L28–L30) | Pending cases with reason `matching_unavailable` or `no_match`, due retry (5, 30, 120 min), batch 25, leases. Re-evaluates; a link claims the Lead (`booked`, `over_*`, `local`). | `booking_chain`/`booking_reconciliation.auto_attach_delayed` | none | leases + case revision | 0 |
| `connectBookingToLead` (`granotLifecycle/connectBookingToLead.ts` L63–L318) | `POST /api/v1/admin/bookings/:bookingId/connect-lead` (Owner, `Idempotency-Key`, `booking_commands_enabled`) | Granot-official Leadless Booking only, no open case (`connectLead.ts` L51–L59, L133–L195). Lead must not be duplicate, bad Form, cancelled, booked, or `created_on_unmatched` Call. Writes Lead `booked`, `over_*`; BookedLead `lead_ref`, `lead_model`, `is_leadless_booking: false`; existing Record Link `lead_ref`, `booking_ref`. | `booking_chain`/`booked_lead.connect_lead` | none | Owner key + booking revision | 0 |

Pending-Booking edit (not Lead-mutating): `bookingLeadReconciliation.service.ts:updatePendingEmployeeBooking` L217–L350, `PATCH /api/v1/admin/booking-lead-reconciliations/:id/booking` (Owner). It edits a pending leadless Booking: `job_no`, `normalized_job_no` and `local` on the BookedLead (`Object.assign`, L288–L297) and the case snapshot. Sheet `booked_lead`/`employee_booking.update_pending`. No EntityChange, case `revision` CAS.

Unwired: `reconciliation/bookedCallLeadReconciliation.service.ts:syncBookedCallLeadReconciliation` L98–L347 (would write Call `job_no`, contact, move, receiver and CPL from a Booked Jobs CSV; no EntityChange). Only `POST /api/v1/call-leads/booked-reconciliation/preview` is routed. It never sets `booked`.

## 5. Cancellations

### 5.1 `createCancellation`

Two entry points share the command name.

| Aspect | Granot case (`officialCancellationWrite.ts:applyOfficialCancellationWrite` L40–L168 → `cancelledLead.service.ts:createCancellationForVerifiedBookingInTransaction` L99–L222) | Admin (`POST /api/v1/cancelled-leads`; `existingWrites.ts:runExistingCreateCancellation` L461–L556 → `cancelledLead.service.ts:persistCancelledLeadCreateInTransaction` L224–L331) |
|---|---|---|
| Guards | Booking not cancelled and no CancelledLead (exact single match → `already_satisfied`, else conflict); booking `domain_revision`, job and not-cancelled CAS (L125–L135). | Resolver (`cancellationResolver.ts` L23–L91): 404 missing Booking; 409 already cancelled, referral, leadless, or Lead-less Booking; a given `lead_id` must be booked to this Booking. |
| Booking write | `$set cancelled` (CAS). | `booking.cancelled` via save, no revision check (L299–L300). |
| Lead write | When the Booking has `lead_ref`: Lead must have `booked === booking` (L184–L186); `$set cancelled` with filter `{_id, domain_revision, booked}` (L187–L203). | `mirrorCancellationToLead` (`cancelled`). Pending employee reconciliation cases → `dismissed`. |
| `booked` | Kept. | Kept. |
| Leadless Booking | Lead write skipped (L179): the Cancellation stands with no Lead. | Refused (409). |
| EntityChange | BookedLead, CancelledLead, Lead when written. | CancelledLead, BookedLead `cancelled`, Lead `cancelled`. |
| Sheet | `cancellation_chain` / `cancelled_lead.create`. | Same. |
| Daily Ops | Booking case: `recordCancellationDailyOperationsFact`; release case: none. | `recordCancellationDailyOperationsFact`, dedupe `cancellation:<id>:created`. |
| Idempotency | Owner key; contexts differ by `case_id`. | Existing-write key. |

Production: 3 `createCancellation` (2026-11-01, Form Leads). 8 Form Leads and 1 Call Lead carry `cancelled`.

### 5.2 `updateCancelledLead` and `deleteCancelledLead`

- `updateCancelledLead` — `PATCH /api/v1/cancelled-leads/:id` (`existingWrites.ts` L599–L637 → `cancelledLead.service.ts` L338–L381). CancelledLead only; **not Lead-mutating**. Sheet `cancellation_chain`/`cancelled_lead.update`. Production: 0.
- `deleteCancelledLead` — `DELETE /api/v1/cancelled-leads/:id` (`existingWrites.ts` L772–L799 → `cancelledLead.service.ts` L507–L620). BookedLead `$unset cancelled` (no revision check); Lead `cancelled` cleared, `booked` kept. EntityChange CancelledLead `$deleted`, BookedLead and Lead `cancelled`. Sheet tombstone `delete_cancelled_lead` (removes the Cancelled Deals row) plus `booking_chain`/`delete_cancelled_lead`. Production: 0.

### 5.3 The cancellation mirror, in short

- **Stamp:** `cancelled` on the source Lead equals the CancelledLead `_id`, set in the same transaction as the Cancellation (both paths).
- **Clear:** deleting the Cancellation clears it; deleting the Booking clears `booked` and `cancelled`; reassigning a reconciliation Booking clears the old Lead.
- **Never:** priority changes, Granot sync and re-booking do not touch `cancelled`.

## 6. Booked → cancelled → re-booked

| Step | What happens on the Lead | Sheet |
|---|---|---|
| Booked | `booked = B`, `over_*` | Booked Deals row upserted; the Lead stays on its own Master Leads tab (`booked` does not change the Lead's tab). |
| Cancelled | `cancelled = C`, `booked = B` kept | Cancelled Deals row added; the Booked Deals row stays (a BookedLead is always expected on Booked Deals, `googleSheets/expectedSheetTabs.ts` L179–L203). |
| Re-booked through `createBookingFromLead` | The existing Booking `B` is overwritten in place; `cancelled` stays set on `B` and the Lead. | `booked_lead.upsert`. |
| Re-booked through Granot, claim or connect paths | Refused: the Lead is `cancelled` or already `booked`. | none |
| True re-booking | Delete Booking `B` first (`deleteBookedLead`, cascade): Lead `booked` and `cancelled` unset; tombstones remove both rows. Then a new Booking can attach. | New Booked Deals row. |

Whether re-booking a cancelled Lead in place matches the Owner's intent is an open question in the R3 findings.

## 7. Reportable without a Lead

- **Leadless Booking:** `is_leadless_booking: true`, no `lead_ref`/`lead_model`. Origins: Granot confirm without a confident Lead (`granot_booking.create_leadless`), Owner leadless (`owner_booking.create_pending`), employee pending (`employee_booking.create_pending`), from-source fallback. Booked Deals still receives its row. `connectBookingToLead` can attach a Lead later (Granot-official only).
- **Referral Booking:** `is_referral_booking: true`, `source: "referral"`, never a Lead.
- **Cancellation of a leadless Booking:** allowed on the Granot path (no Lead write), refused on the admin path.
- **No Unmatched Call Lead:** no booking path creates a Call Lead or sets `created_on_unmatched`. Existing `created_on_unmatched` Calls are refused by the claim, connect and owner-attach guards.

Production (read 2026-11-20 12:48 New York, before the fixture purge below): 1,075 Booked Leads: 559 Form-linked, 371 Call-linked, 145 without a Lead (106 leadless, 36 referral, and 3 August certification fixtures with a boolean `cancelled: true` and job "U29 … REEVALUATE"). 51 Cancelled Leads: 36 Form-linked, 1 Call-linked, 14 without a Lead.

Why 36 Form-linked Cancellations but only 8 Form Leads carry `cancelled`: all 8 point at their own Cancellation (5 June legacy rows written before canonical commands, 3 `createCancellation` on 2026-11-01). The other 28 were written on 2026-08-19/20 without any EntityChange; both their `lead_ref` Form Lead and their Booking no longer exist. They are certification-era residue, not a mirror failure. One Booked Deals row (Booking created by `createBookingFromLead` on 2026-09-06 23:12 UTC for a manually created Call) has no Mongo record: the Booking and its Call were removed with no `deleteBookedLead`/`deleteCallLead` EntityChange and no tombstone job, so Sheet Sync never removed the row.

**Fixture purge, 13:40–13:50 New York, Owner-approved (by the session coordinator, not Track B).** The August 19–20 records were replica-test fixtures written to production: 37 Cancellations with job `^U2\d[ -]MT` (from `releaseOwnerCommands.replica.test.ts`) and the 3 Bookings with job `…REEVALUATE` (from `discrepancies.replica.test.ts`). No real Booking, Lead, customer or shared Job Number linked to any of them. Each Cancellation was deleted in a transaction with a `delete_cancelled_lead` tombstone, and all 37 tombstones synced. The orphan Booked Deals row was the September 6 LNS-03 synthetic test Booking (job `LNS03W01`) and was removed with an identity check. After the purge (read 13:51 New York): 1,072 Booked Leads (142 without a Lead) and 14 Cancelled Leads (9 linked to a Lead, 5 without one); Booked Deals and Cancelled Deals match Mongo exactly.

**Job Number on every Booking (Owner rule 2026-11-20).** Every Booking write that creates a Booking or changes its `job_no` is checked by the Booking Job Number rule in the `BookedLead` model (one enforcement point for §2–§4: Granot Confirm and Referral, `createBookingFromLead`, `createLeadlessBooking`, `createExistingReferralBooking`, `updateBookedLead`, Employee Booking Submission and the pending-Booking edit). The rule accepts every stored class (bare 7-digit, letter-prefixed such as `P`/`RF`/`AT`, Granot annotations such as `P5556759 new`, and separator/case/width variants) and rejects only values that cannot be a Job Number (missing, no digits, several numbers, digits followed by letters, a digit core outside 4–9). It ships in `shadow` (`booking_job_number_control` in Mongo): would-rejects are recorded in `booking_job_number_checks` (reason, write path and value length, never the value) and the write proceeds; in `enforce` the command answers 422 `booking.job_number_invalid` and writes nothing. A missing `job_no` is a rejection in `enforce` (production has none). Cancellation correlation and employee-booking Lead matching still use `jobNumberDigitCore`, so a separated or annotated Booking key (`P 5556759`, `P5556759 NEW`; none stored) does not correlate with `P5556759` there; that is a documented follow-up. Rule, class inventory and operator commands: [bookings.md](../services/bookings.md#job-number-validation-owner-rule-2026-11-20).

**Record fixes, 2026-11-20 (Owner-approved).** The September 8 employee-booking test Booking (`6aa06db849881cd89a397b13`) was deleted with the canonical `deleteBookedLead` route at 22:39 UTC; its `delete_booked_lead` tombstone synced and its Booked Deals row is gone. Its test Call Lead (`6aa06da749881cd89a397b10`) had no Calls, Duplicate Calls or Bad Call Leads row, no `call_qualification` and no Outreach or Pool admission, and was deleted with `deleteCallLead`. The August 10 Booking whose `job_no` holds the customer's name (`6a7a47dfc78f1e03f807d970`) is **unchanged**: no Job Number for that customer exists in Mongo (Form Lead, Record Links, Granot observations, receipts, cases, statements, Contact Numbers, other Leads) or in its Booked Deals row. It stays held from Pool by its `lead_ref`. The Owner must supply the Granot Job before it can be corrected with `updateBookedLead`.

## 8. Worked example: a Leadless official Booking on Booked Deals

Production read 2026-11-20 12:48 New York. Customer B, source company `tbm_leads`.

| Time (UTC, 2026-11-18) | Event |
|---|---|
| 19:42:47 | A Granot `booked` Observation (webhook) opens case `create_missing_booking`. No stored Lead matched with high confidence, so the case has no usable suggestion. |
| 19:47:11 | The Owner runs `confirmGranotBooking` with no selected Lead → `persistLeadlessConfirmation`. BookedLead: `is_leadless_booking: true`, `is_referral_booking: false`, `source: tbm_leads`, `merchant: Elavon`, deposit $564, binder $520, `over_2000: false`, `book_date` 2026-11-18, job 55677xx, `domain_revision` 1 after the revision stamp. EntityChange `confirmGranotBooking` on BookedLead and Record Link; no Lead change. Case → `resolved`, `booking_created`. Sheet intent `booked_lead` / `granot_booking.create_leadless`. |
| by 19:50:05 | Booked Deals row 1073 synced (`sheet_sync: master_booked, synced`). The Owner notice says a Lead can be connected later from Bookings. |

No Form or Call Lead changed, no Lead tab moved, and the Booking is reportable on Booked Deals.
