---
type: Completion report
title: EJBA-02 — Precise Form create, owner_booking case, Connect fence
status: complete
closed: 2026-09-08
---

# EJBA-02 completion

Repo: `vantage-main-server`. Branch: `exact-job-booking-attach`. No commit, push, or deploy.

## What landed

Precise Booking Form server create now asks Exact Job Booking Attach for Call Lead mode. The Booking always files. A pending Booking Lead Reconciliation Case (`origin=owner_booking`) opens when nothing unique attaches. The Owner can later `dismiss` that case with no Lead; the Booking stays Leadless.

### From-source Call Lead (non-import)

- Does **not** call `findBestCallLeadMatchByPhone`.
- Does **not** `CallLead.create` an Unmatched Call Lead.
- Unique `call_job_no_exact` → linked, `booking_origin=owner_booking`, no case.
- Otherwise → Leadless + pending `owner_booking` case (HTTP 201). Ambiguous job is **not** 409.
- Returns `data.reconciliation_case_id` only on pending Owner create.
- Linked Form Lead + Mongo ID still attaches (Owner-selected), `booking_origin=owner_booking`, no case.

### Owner leadless (non-import)

- Always opens pending case `origin=owner_booking`, `reason=no_match`.
- Sets `booking_origin=owner_booking`.
- Sheet operation picked: `booked_lead` / `owner_booking.create_pending`.
- Best Relocation import stays `leadless_booking.create` + `external_sheet_ingestion`.

### Case snapshot (§4.6)

- `job_no` / `normalized_job_no` from submitted Job Number.
- `phone_number` from Call phone or customer phone, or literal `not provided`.
- `lead_name` from customer name or `Unknown`.
- `submission_id` = `owner-booking:{normalized_job_no}` (not an employee UUID).
- `source_assignment` from selected Source Company; channel `call` when Owner chose Call Lead or the source label matches inbound/call; else `form`.
- No invented LID.

### Connect fence (§5.3)

- `isGranotOfficialLeadlessBooking` is false for `owner_booking` and `employee_booking`. Missing origin stays official.
- `isConnectableLeadlessBooking` = official Granot Leadless **and** no open (`pending`) Booking Lead Reconciliation Case.
- Connect command and Connect candidate list both load the open-case check.

### Enums

- `BookingLeadReconciliationCase.origin` and list Zod: `owner_booking`.
- `BookedLead.booking_origin`: `owner_booking`.

## Exact Job Booking Attach reuse

- `evaluateEmployeeBookingMatch`
- `queryEmployeeBookingCandidates`
- `snapshotEmployeeBookingAutoMatchPolicy`
- `getEmployeeBookingMatchingConfig` (via the evaluator / rematch retry)

Preferred model is Call Lead for Call Lead mode (`channel: "call"`).

## Sheet operation pick (Owner leadless)

`owner_booking.create_pending` on `booked_lead`. Import stays `leadless_booking.create`. Linked Owner from-source keeps `booking_chain` / `booked_lead.create`.

## Command results

`pnpm typecheck` (exit 0):

```text
> vantage_movers_server@1.0.0 typecheck C:\Users\Pinda\Proyectos\vantage\vantage-main-server
> tsc --noEmit
```

`pnpm test -- src/services/bookings ...` is the package.json `test` script plus those paths, so it would also run the full `src/**/*.test.ts` glob. Recorded invocation instead. No live-slow `src/services/bookings` tests were excluded — that folder has none.

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/bookings/ownerBookingAttach.test.ts \
  src/services/bookings/bookedLeadFromSource.service.test.ts \
  src/services/bookings/leadlessBooking.service.test.ts \
  src/services/bookings/bookingSourceResolver.test.ts \
  src/services/bookings/referralBooking.service.test.ts \
  src/services/bookings/bestRelocationImportGuard.test.ts \
  src/services/bookings/bookingIdentity.test.ts \
  src/services/bookings/bookingMirror.test.ts \
  src/services/granotLifecycle/connectLead.test.ts \
  src/services/granotLifecycle/confirmAttachment.test.ts \
  src/services/employeeBookings/bookingLeadReconciliation.service.test.ts \
  src/services/employeeBookings/leadCandidateQueries.test.ts \
  src/validation/v1.validation.test.ts \
  src/validation/v1/employeeBookings.validation.test.ts
```

```text
ℹ tests 126
ℹ pass 126
ℹ fail 0
ℹ duration_ms 8246.2371
```

No customer names, phones, or secrets in the recorded output.

## §9 Precise Form evidence

| Spec test | Evidence |
| --- | --- |
| Call Lead + unique job → linked, no case, `booking_origin=owner_booking` | `ownerBookingAttach.test.ts` + `bookedLeadFromSource.service.test.ts` |
| Call Lead + job, no Call Lead row → 201 Leadless + `owner_booking` case. Zero unmatched stubs | Plan is `owner_pending`; Owner path never calls `resolveBookingSourceLead` / mint |
| Call Lead + job + phone of a different Call Lead → still Leadless + case | Evaluator pending `identity_conflict` (phone must not win) |
| Form Lead + id → linked, no case | `resolveFromSourceAttach` attach + `booking_origin=owner_booking` |
| Explicit Leadless → 201 + `owner_booking` case | `leadlessBooking.service.test.ts`; sheet `owner_booking.create_pending` |
| Referral → no case | `referralBooking.service.test.ts` (no Case import) |
| Connect rejects `owner_booking` / `employee_booking` (`IDENTITY_CONFLICT`) | `connectLead.test.ts` |
| `isGranotOfficialLeadlessBooking` false for `owner_booking` | `confirmAttachment.test.ts`; missing origin still true |
| Dismiss `owner_booking` pending leaves Booking Leadless | `bookingLeadReconciliation.service.test.ts` |

## What this issue did not do

- Admin Precise Booking Form UI (EJBA-03).
- Knowledge bodies (EJBA-04).
- Confirm Granot Booking attach rules / opening a case from Confirm / `HIGH_CONFIDENCE_BOOKING_MATCH_METHODS` / `identity.ts`.
- Changing Best Relocation phone match or unmatched mint.
- Connect on `/bookings/reconciliation`.
- A new case action besides `dismiss`.
- Daily ops `inferBookingKind`.

## Drift vs issue current-state

Coordinator inventory was still accurate at start. After this issue:

- Owner Call Lead no longer uses `resolveBookingSourceLead` phone-match / unmatched mint.
- Owner leadless always opens `owner_booking` (not only Best Relocation).
- Case / BookedLead / list Zod include `owner_booking`.
- Connect requires official Granot Leadless **and** no pending case.
- Owner Call Lead Zod requires `call_job_no`; phone-only remains valid only for Best Relocation import.

## Risks for EJBA-03

- DTO field name: `data.reconciliation_case_id` (string). Present only on pending Owner create (from-source miss or explicit leadless). Linked Form/Call and Referral omit it. Best Relocation import leadless does **not** return it on the rebuilt `existingWrites` DTO.
- Deep-link: `/bookings/reconciliation?case={reconciliation_case_id}`.
- Two Call Leads with the same Job Number open a pending case (not 409). Shared evaluator reason is `identity_conflict` (two primary job identities), not `multiple_matches`. Copy should not assume the reason is always `no_match`.
- Owner leadless sheet operation is `owner_booking.create_pending`, not `leadless_booking.create`.
