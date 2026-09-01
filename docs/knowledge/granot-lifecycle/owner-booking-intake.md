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
  - vantage-admin/app/(dashboard)/bookings
  - vantage-admin/components/bookings/booking-stored-lead-section.tsx
  - src/services/granotLifecycle/connectBookingToLead.ts
owners: [team:main-server, team:vantage-admin]
sources:
  - id: spec
    resource: docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
    title: Owner booking intake and lead attachment
generated:
  by: process:docs-keeper
  at: 2026-08-28T19:15:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [`owner-booking-intake-and-lead-attachment-specification.md`](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md)

# Owner booking intake and lead attachment

This file is a **Reference** pointer only. It does not copy contract rules.

- [Release into booking intake](../../granot-lead-lifecycle/release-into-booking-intake-specification.md) — Releas / Release land on the booking intake; Live Events can link to that case. **Wins on Release routing.**
- [Owner booking intake and lead attachment](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) — even Binder, Confirm without a required Lead, Connect Booking to Lead, owner-readable Intakes. **Prerequisite for Owner Daily.**
- [Booking intake robustness pack](../../booking-intake-lead-attachment/README.md) — BILA-01–BILA-03 shipped. **Wins on the Connect surface** (`/bookings` only; not `/bookings/reconciliation`). Live values: [`PROGRESS.md`](../../booking-intake-lead-attachment/PROGRESS.md).

**Landed:** §5 even Binder — one Binder, at most two Agents, server even-cent split. See [`agent-allocation.md`](../services/agent-allocation.md) and [`booking-reconciliation.md`](./booking-reconciliation.md). **BILA-01** — Form candidate `q` is any-known-contact; DTO carries `known_contacts`; intake shows Form submitted vs Granot. See [`projections.md`](./projections.md). **BILA-02** — Confirm `selected_lead` is optional; unique high-confidence auto-attach or official [Leadless Booking](../../../../CONTEXT.md); later Booked opens `review_existing_booking`. See [`booking-reconciliation.md`](./booking-reconciliation.md) and [`bookings.md`](../services/bookings.md). **BILA-03** — Connect Booking to Lead from `/bookings`: Owner searches eligible unbooked Leads, connects one, and the command writes EntityChange plus `booking_chain` / `booked_lead.connect_lead`. Referral and cancelled Bookings have no Connect. See [`bookings.md`](../services/bookings.md).

**Not implemented:** owner-intake unmasking and the rest of the 2026-08-24 spec. Connect is not on `/intakes`, Daily Completed, or `/bookings/reconciliation`.

Current-state service docs for remaining sections: [`booking-reconciliation.md`](./booking-reconciliation.md), [`bookings.md`](../services/bookings.md), [`employee-bookings.md`](../services/employee-bookings.md), [`projections.md`](./projections.md).
