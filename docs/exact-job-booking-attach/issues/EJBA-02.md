# EJBA-02 — Precise Form create, owner_booking case, Connect fence

> **Contract maturity: implementation-ready.** Session 2. Precise
> Booking Form server create: job-only Call Lead attach, Leadless +
> case, `booking_origin=owner_booking`, Connect refused.

## 1. Authority and required reading

- **Pack specification:** [`../exact-job-booking-attach-specification.md`](../exact-job-booking-attach-specification.md)
  — §3.3–3.4, §4.2–§4.6, §5.1, §5.3, §8, §9 Precise Form tests.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** [Precise Booking Form](../../../../CONTEXT.md),
  [Unmatched Call Lead](../../../../CONTEXT.md),
  [Connect Booking to Lead](../../../../CONTEXT.md)
- **Seams:** `bookingSourceResolver.ts`, `leadlessBooking.service.ts`,
  `BookingLeadReconciliationCase` origin enum, `connectLead.ts`,
  `confirmAttachment.ts` (`isGranotOfficialLeadlessBooking`),
  from-source / leadless Zod

## 2. Objective

Owner `/bookings/new` Call Lead create attaches only a unique Job
Number Call Lead. Otherwise the Booking is Leadless and a pending
Booking Lead Reconciliation Case (`origin=owner_booking`) opens.
Explicit Leadless does the same. Form Lead + Mongo ID still attaches
with no case. Referral stays referral. Connect and Granot official
Leadless exclude `owner_booking` and `employee_booking`.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Prerequisites:** EJBA-01 `complete` (shared Exact Job policy exists).

## 4. Current-state evidence (after this issue)

Updated 2026-09-08 at close. Coordinator inventory at start was still
accurate; these bullets are the post-EJBA-02 repository.

- Owner Call Lead (no `ingestion_source`) asks Exact Job Booking Attach
  via `evaluateEmployeeBookingMatch`. It does not phone-match or mint
  an Unmatched Call Lead. Best Relocation import still uses
  `resolveBookingSourceLead` (phone-match, unmatched mint, 409 on 2+
  job rows).
- Owner leadless always opens `origin=owner_booking`,
  `booking_origin=owner_booking`, sheet `owner_booking.create_pending`.
  Import leadless stays `external_sheet_ingestion` /
  `leadless_booking.create`.
- Case origin enum: `employee_booking` | `owner_booking` |
  `external_sheet_ingestion`. `BookedLead.booking_origin` includes
  `owner_booking`. List Zod origin includes `owner_booking`.
- `isConnectableLeadlessBooking` is official Granot Leadless **and** no
  open pending Booking Lead Reconciliation Case.
- `isGranotOfficialLeadlessBooking` is false for `employee_booking` and
  `owner_booking`. Missing origin is still official.
- Owner Call Lead Zod requires `call_job_no`. Phone-only remains valid
  only when `ingestion_source=best_relocation_sheet`.

## 5. Locked decisions

- Owner Call Lead path must not call `findBestCallLeadMatchByPhone`.
- Owner Call Lead path must not `CallLead.create` an Unmatched Call Lead.
- Best Relocation `ingestion_source=best_relocation_sheet` keeps today’s
  from-source / leadless behavior.
- Return the new case id on pending Owner create so EJBA-03 can link.
- One Booking per Job Number remains 409.
- An `owner_booking` pending case can be **dismissed with no Lead**.
  The Booking stays filed and Leadless. Do not invent a new action;
  use existing `dismiss`. This is a valid Owner close when they only
  wanted the Booking created.

## 6. Deliverables

1. From-source Call Lead (non-import): Exact Job Booking Attach or
   Leadless + `owner_booking` case. Set `booking_origin=owner_booking`.
2. Owner leadless create (non-import): always open `owner_booking` case.
   Set `booking_origin=owner_booking`.
3. Extend case `origin` enum. Fill submission snapshot per spec §4.6.
4. Fence Connect + `isGranotOfficialLeadlessBooking` per spec §5.3.
5. Tests in specification §9 Precise Form.

## 7. Out of scope

- Admin UI (EJBA-03).
- Knowledge (EJBA-04).
- Confirm Granot Booking.
- Changing Best Relocation phone match.

## 8. Acceptance criteria

- [x] Unique job Call Lead → linked, no case, `booking_origin=owner_booking`.
      Evidence: `ownerBookingAttach.test.ts`, `bookedLeadFromSource.service.test.ts`.
- [x] Two Call Leads with the same job → 201 Leadless + pending
      `multiple_matches` case (not 409). Coordinator review: evaluator
      no longer treats two job identities as `identity_conflict`.
- [x] Job with no Call Lead → 201 Leadless + case; zero new unmatched stubs.
      Evidence: Owner path never calls `resolveBookingSourceLead`.
- [x] Connect also rejects a Booking that has an open reconciliation case.
      Evidence: `connectLead.test.ts`; command + candidate list load pending case.
- [x] Phone of a different Call Lead does not attach.
      Evidence: `ownerBookingAttach.test.ts` pending `identity_conflict`.
- [x] Form Lead + id → linked, no case.
      Evidence: `bookedLeadFromSource.service.test.ts`.
- [x] Explicit Leadless → case `owner_booking`.
      Evidence: `leadlessBooking.service.test.ts`.
- [x] Referral → no case.
      Evidence: `referralBooking.service.test.ts`.
- [x] Connect rejects `owner_booking` and `employee_booking` Leadless.
      Evidence: `connectLead.test.ts` `IDENTITY_CONFLICT`;
      `confirmAttachment.test.ts` official predicate.
- [x] Targeted `node --test` (126/126) and `pnpm typecheck` recorded in
      `reports/EJBA-02-completion.md`.
- [x] Dismissing an `owner_booking` pending case leaves the Booking
      Leadless and does not require a Lead.
      Evidence: `bookingLeadReconciliation.service.test.ts`.

## 9. Commands

```bash
pnpm test -- src/services/bookings src/services/granotLifecycle/connectLead src/services/granotLifecycle/confirmAttachment
pnpm typecheck
```
