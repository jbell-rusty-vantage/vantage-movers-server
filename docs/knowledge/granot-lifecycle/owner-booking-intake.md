---
type: Reference
title: Owner booking intake and lead attachment
description: Pointer to the owner booking-intake contract. Does not copy spec rules.
tags: [granot-lifecycle, spec, booking, owner-dashboard]
status: draft
stale_after: 2027-02-24
resource: docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
applies_to:
  - docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
  - src/services/granotLifecycle/bookingConfirmation.ts
  - src/services/granotLifecycle/bookingOwnerCommands.ts
  - vantage-admin/components/granot-lifecycle/booking-command-form.tsx
  - vantage-admin/app/(dashboard)/intakes
owners: [team:main-server, team:vantage-admin]
sources:
  - id: spec
    resource: docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
    title: Owner booking intake and lead attachment
generated:
  by: process:docs-keeper
  at: 2026-08-24T18:10:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [`owner-booking-intake-and-lead-attachment-specification.md`](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md)

# Owner booking intake and lead attachment

This file is a **Reference** pointer only. It does not copy contract rules.

- [Owner booking intake and lead attachment](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) — even Binder, Confirm without a required Lead, Connect Booking to Lead, owner-readable Intakes. **Prerequisite for Owner Daily.**

Current-state service docs until that spec is implemented: [`booking-reconciliation.md`](./booking-reconciliation.md), [`bookings.md`](../services/bookings.md), [`agent-allocation.md`](../services/agent-allocation.md), [`employee-bookings.md`](../services/employee-bookings.md), [`projections.md`](./projections.md).
