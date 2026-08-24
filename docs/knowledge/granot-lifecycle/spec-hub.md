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
generated:
  by: process:okf-docs-conversion
  at: 2026-08-21T02:17:00Z
---

# Granot lead-lifecycle spec hub

This file is a **Reference** hub only. It points at the locked contract and owner runbooks. It does not restamp those files and does not copy FINAL SPEC rules, invariants, or unit text.

- [FINAL SPECIFICATION GRANOT LEAD LIFECYCLE](../../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) — locked contract (do not OKF-ify).
- [Booking Reconciliation Booked-only trigger and Priority pairing](../../granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md) — delta that supersedes FINAL SPEC §19 trigger and AC-18.
- [Lifecycle activation flags and source policies](../../granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md)
- [Owner operator runbook](../../granot-lead-lifecycle/[REDACTED]-operator-runbook.md)
- [Sprint progress through Unit 25](../../granot-lead-lifecycle/sprint-progress-through-unit-25.md)

Service concepts for capture, apply, processor, and cases stay in the inventory files listed from [`docs/index.md`](../../index.md). Query with `pnpm okf:query --tag granot-lifecycle`.
