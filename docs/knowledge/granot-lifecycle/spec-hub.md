---
type: Reference
title: Granot lead-lifecycle spec hub
description: Link hub for the locked Granot lead-lifecycle FINAL SPEC and owner runbooks. Does not copy spec rules.
tags: [granot-lifecycle, spec]
status: draft
stale_after: 2027-02-17
resource: scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md
applies_to:
  - scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md
  - docs/granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md
  - docs/granot-lead-lifecycle/[REDACTED]-operator-runbook.md
  - docs/granot-lead-lifecycle/sprint-progress-through-unit-25.md
  - docs/granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md
  - docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
owners: [team:main-server]
sources:
  - id: final-spec
    resource: scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md
    title: FINAL SPECIFICATION GRANOT LEAD LIFECYCLE
  - id: activation-flags
    resource: docs/granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md
  - id: operator-runbook
    resource: docs/granot-lead-lifecycle/[REDACTED]-operator-runbook.md
  - id: sprint-progress
    resource: docs/granot-lead-lifecycle/sprint-progress-through-unit-25.md
  - id: booked-only-delta
    resource: docs/granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md
    title: Booking Reconciliation Booked-only trigger and Priority pairing audit
  - id: owner-booking-intake
    resource: docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
    title: Owner booking intake, even Binder, optional Lead, and Connect Booking to Lead
generated:
  by: process:docs-keeper
  at: 2026-08-28T19:15:00Z
---

# Granot lead-lifecycle spec hub

This file is a **Reference** hub only. It points at the locked contract and owner runbooks. It does not restamp those files and does not copy FINAL SPEC rules, invariants, or unit text.

- [FINAL SPECIFICATION GRANOT LEAD LIFECYCLE](../../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) — locked contract (do not OKF-ify).
- [Booking Reconciliation Booked-only trigger and Priority pairing](../../granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md) — delta that supersedes FINAL SPEC §19 trigger and AC-18.
- [Owner booking intake and lead attachment](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) — prerequisite for Owner Daily. §5 even Binder, BILA-01 intake any-known-contact search/display, BILA-02 optional Lead on Confirm, and BILA-03 Connect Booking to Lead from `/bookings` are current; unmasking is not implemented. Pointer: [`owner-booking-intake.md`](./owner-booking-intake.md).
- [Booking intake Form Lead contact snapshots](../../granot-lead-lifecycle/booking-intake-form-lead-contact-snapshots-specification.md) — **superseded.** BILA-01 shipped intake search/display. Do not implement from this draft. Remaining slices live in the [booking-intake robustness pack](../../booking-intake-lead-attachment/README.md).
- [Lifecycle activation flags and source policies](../../granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md)
- [Owner operator runbook](../../granot-lead-lifecycle/[REDACTED]-operator-runbook.md)
- [Sprint progress through Unit 25](../../granot-lead-lifecycle/sprint-progress-through-unit-25.md)

Service concepts for capture, apply, processor, and cases stay in the inventory files listed from [`docs/index.md`](../../index.md). Query with `pnpm okf:query --tag granot-lifecycle`.
