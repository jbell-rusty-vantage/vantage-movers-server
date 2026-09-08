# EJBA-04 — Knowledge pointers

> **Contract maturity: implementation-ready.** Session 4. Describe the
> code that shipped. Do not invent new product rules.

## 1. Authority and required reading

- **Pack specification:** [`../exact-job-booking-attach-specification.md`](../exact-job-booking-attach-specification.md)
  — §12.
- Invoke **docs-keeper**. Update only the matching knowledge layer and
  the glob-scoped rule that already owns those files.

## 2. Objective

`employee-bookings.md`, `bookings.md`, `owner-booking-intake.md`,
`docs/index.md` (if the pointer sentence drifted), and Admin
`project-organization.mdc` describe Exact Job Booking Attach and
`owner_booking` cases as they landed.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server`, `vantage-admin` rules.
- **Prerequisites:** EJBA-02 and EJBA-03 `complete`.

## 4. Deliverables

1. Employee auto-match table is job-only; rematch reasons include
   `no_match`.
2. Bookings from-source Call Lead: no phone fallback, no unmatched
   stub on the Owner path; leadless Owner create opens a case.
3. Owner-booking-intake pointer: Precise Form pending ≠ Granot official
   Leadless; Connect unchanged for Confirm.
4. Admin rule: Precise Form pending notice + origin on the
   reconciliation desk.

## 5. Out of scope

- New runtime behavior.
- Copying the specification into knowledge bodies.

## 6. Acceptance criteria

- [ ] Knowledge sentences match the shipped code, not the next idea.
- [ ] Glossary terms used; no new synonyms.
