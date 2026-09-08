# EJBA-03 — Precise Booking Form UI

> **Contract maturity: implementation-ready.** Session 3. Owner form
> copy, optional Call phone, pending success link. **No server policy.**

## 1. Authority and required reading

- **Pack specification:** [`../exact-job-booking-attach-specification.md`](../exact-job-booking-attach-specification.md)
  — §7, §9 Admin tests.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Seams:** `vantage-admin/components/forms/booking-form.tsx`,
  `vantage-admin/app/(dashboard)/bookings/new/page.tsx`,
  Connect section on `/bookings` if it appears on `owner_booking` rows

## 2. Objective

The Precise Booking Form lets the Owner file a Call Lead booking
without a phone. When the server opened a case, the success notice
links to `/bookings/reconciliation?case=`. Connect stays hidden on
Employee and Precise Form pending Bookings.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` (and proxy types if the create
  response gains `reconciliation_case_id`).
- **Prerequisites:** EJBA-02 `complete`.

## 4. Current-state evidence to verify

Observed 2026-09-08; **reverify at implementation**.

- `/bookings/new` title is “Precise Booking Form”.
- Call Lead mode requires `call_phone_number` in the client
  `missingFields` list. “Book this lead” from the Call desk sends
  `?lead_type=CallLead&call_phone_number=`.
- Success copy does not mention Booking Reconciliation.
- Connect lives on `/bookings` stored-lead section (BILA-03).

## 5. Locked decisions

- Job Number stays required.
- Phone is optional helper text, not a submit gate.
- Owner-visible strings in one copy module. Never print
  `owner_booking` or `is_leadless_booking`.

## 6. Deliverables

1. Drop the Call Lead phone required check. Keep job required.
2. Pending success → reconciliation deep link.
3. Hide Connect when the Booking has an open Booking Lead
   Reconciliation Case or `booking_origin` is `employee_booking` /
   `owner_booking` (consume whatever EJBA-02 put on the DTO).
4. Component tests for the copy and the missing-fields change.

## 7. Out of scope

- Server match rules.
- Redesign of `/bookings/reconciliation`.
- Knowledge (EJBA-04).

## 8. Acceptance criteria

- [ ] Call Lead submit without phone is allowed when job is present.
- [ ] Pending success includes `/bookings/reconciliation?case=`.
- [ ] Connect is not offered on these pending rows.
- [ ] Browser check at http://localhost:3000/bookings/new (Call Lead
      job-only submit, and Leadless submit) recorded.

## 9. Commands

```bash
pnpm test -- tests/granot-lifecycle-components.test.ts
# plus any booking-form test file added
pnpm typecheck
```

Verify in the browser per [`LOCAL-ADMIN.md`](../../lead-no-sync/LOCAL-ADMIN.md)
credentials rule (read `vantage-admin/.env`; do not paste secrets).
