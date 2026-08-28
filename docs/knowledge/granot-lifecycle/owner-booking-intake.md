---
type: Reference
title: Owner booking intake and lead attachment
description: Pointer to the owner booking-intake contract. Does not copy spec rules.
tags: [granot-lifecycle, spec, booking, owner-dashboard]
status: draft
stale_after: 2027-02-28
resource: docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
applies_to:
  - docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
  - src/services/granotLifecycle/bookingConfirmation.ts
  - src/services/granotLifecycle/confirmAttachment.ts
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
  at: 2026-08-28T18:22:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [`owner-booking-intake-and-lead-attachment-specification.md`](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md)

# Owner booking intake and lead attachment

This file is a **Reference** pointer only. It does not copy contract rules.

- [Owner booking intake and lead attachment](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) — even Binder, Confirm without a required Lead, Connect Booking to Lead, owner-readable Intakes. **Prerequisite for Owner Daily.**
- [Booking intake robustness pack](../../booking-intake-lead-attachment/README.md) — remaining workspace for Connect from `/bookings`. **Wins on the Connect surface.** Live values: [`PROGRESS.md`](../../booking-intake-lead-attachment/PROGRESS.md).

**Landed:** §5 even Binder — one Binder, at most two Agents, server even-cent split. See [`agent-allocation.md`](../services/agent-allocation.md) and [`booking-reconciliation.md`](./booking-reconciliation.md). **BILA-01** — Form candidate `q` is any-known-contact; DTO carries `known_contacts`; intake shows Form submitted vs Granot. See [`projections.md`](./projections.md). **BILA-02** — Confirm `selected_lead` is optional; unique high-confidence auto-attach or official [Leadless Booking](../../../../CONTEXT.md); later Booked opens `review_existing_booking`. See [`booking-reconciliation.md`](./booking-reconciliation.md) and [`bookings.md`](../services/bookings.md).

**Not implemented:** Connect Booking to Lead (Bookings tab), owner-intake unmasking, and the rest of the 2026-08-24 spec. Implement Connect from the robustness pack, not from the absorbed snapshots draft. Do not treat Owner copy that a Lead can be connected later as a shipped `/bookings` Connect UI.

Current-state service docs for remaining sections: [`booking-reconciliation.md`](./booking-reconciliation.md), [`bookings.md`](../services/bookings.md), [`employee-bookings.md`](../services/employee-bookings.md), [`projections.md`](./projections.md).
