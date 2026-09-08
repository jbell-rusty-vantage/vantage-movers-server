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

## 4. Current-state evidence to verify

Observed 2026-09-08; **reverify at implementation**.

- `resolveBookingSourceLead` phone-matches then mints
  `created_on_unmatched`.
- `createLeadlessBooking` opens a case only for Best Relocation import.
- Case origin enum: `employee_booking` | `external_sheet_ingestion`.
- `isConnectableLeadlessBooking` does not look at `booking_origin`.
- `isGranotOfficialLeadlessBooking` excludes only `employee_booking`.
- Zod already allows Call Lead with only `call_job_no`.

## 5. Locked decisions

- Owner Call Lead path must not call `findBestCallLeadMatchByPhone`.
- Owner Call Lead path must not `CallLead.create` an Unmatched Call Lead.
- Best Relocation `ingestion_source=best_relocation_sheet` keeps today’s
  from-source / leadless behavior.
- Return the new case id on pending Owner create so EJBA-03 can link.
- One Booking per Job Number remains 409.

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

- [ ] Unique job Call Lead → linked, no case, `booking_origin=owner_booking`.
- [ ] Two Call Leads with the same job → 201 Leadless + `multiple_matches` case (not 409).
- [ ] Job with no Call Lead → 201 Leadless + case; zero new unmatched stubs.
- [ ] Connect also rejects a Booking that has an open reconciliation case.
- [ ] Phone of a different Call Lead does not attach.
- [ ] Form Lead + id → linked, no case.
- [ ] Explicit Leadless → case `owner_booking`.
- [ ] Referral → no case.
- [ ] Connect rejects `owner_booking` and `employee_booking` Leadless.
- [ ] `pnpm test` and `pnpm typecheck` recorded.

## 9. Commands

```bash
pnpm test -- src/services/bookings src/services/granotLifecycle/connectLead src/services/granotLifecycle/confirmAttachment
pnpm typecheck
```
