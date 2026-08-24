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
  - vantage-admin/components/granot-lifecycle/booking-update-form.tsx
  - vantage-admin/components/granot-lifecycle/referral-booking-form.tsx
  - vantage-admin/components/granot-lifecycle/official-binder-agents-fields.tsx
  - vantage-admin/app/(dashboard)/intakes
owners: [team:main-server, team:vantage-admin]
sources:
  - id: spec
    resource: docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
    title: Owner booking intake and lead attachment
generated:
  by: process:docs-keeper
  at: 2026-08-24T18:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [`owner-booking-intake-and-lead-attachment-specification.md`](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md)

# Owner booking intake and lead attachment

This file is a **Reference** pointer only. It does not copy contract rules.

- [Owner booking intake and lead attachment](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) — even Binder, Confirm without a required Lead, Connect Booking to Lead, owner-readable Intakes. **Prerequisite for Owner Daily.**

**Landed:** §5 even Binder only — one Binder, at most two Agents, server even-cent split. See [`agent-allocation.md`](../services/agent-allocation.md) and [`booking-reconciliation.md`](./booking-reconciliation.md).

**Not implemented:** optional Lead on Confirm, Connect Booking to Lead, owner-intake unmasking, and the rest of that spec.

Current-state service docs for remaining sections: [`booking-reconciliation.md`](./booking-reconciliation.md), [`bookings.md`](../services/bookings.md), [`employee-bookings.md`](../services/employee-bookings.md), [`projections.md`](./projections.md).
