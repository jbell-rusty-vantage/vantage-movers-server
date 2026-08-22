---
type: Service
title: Cancellation Mirror Service
description: Stamp or clear cancelled on the source Form Lead or Call Lead after a cancellation.
tags: [cancellation, sheet-sync]
status: draft
stale_after: 2026-11-20
resource: src/services/cancellations/cancellationMirror.service.ts
applies_to:
  - src/services/cancellations/cancellationMirror.service.ts
  - src/services/cancellations/cancelledLead.service.ts
  - src/services/bookings/bookingMirror.service.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/cancellations/cancellationMirror.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T02:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/cancellations/cancellationMirror.service.ts`  
**Domain terms used:** [Cancellation](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md)

# Cancellation Mirror Service

**Role:** Keep the linked source **Form Lead** / **Call Lead** aligned with **Cancellation** state on Mongo. Does not create cancellations, **Sheet Sync** directly, or clear `booked`.

**Called from:** `cancelledLead.service.ts` (create/delete) when the booking has `lead_ref` + `lead_model`. Leadless / referral cancellations skip this module. Booking delete clears `cancelled` through `clearBookingFromLead` in `bookingMirror.service.ts`, not through this file.

## Mental model

```
FormLead / CallLead
  booked     → BookedLead._id     (set by booking mirror)
  cancelled  → CancelledLead._id  (set by cancellation mirror)
```

Cancellation is **alongside** the **Booking**, not in place of it. **Reporting Sheets** show both Booked and Cancelled columns on lead rows; the **Cancellation** row lives on **Master Booked** `Cancelled Deals` tab.

## `mirrorCancellationToLead`

**When:** Cancellation create, inside the same Mongo transaction as booking + cancellation inserts, and only when the booking is lead-attached.

1. `getLinkedLead(leadModel, leadId, session)`.
2. Set `lead.cancelled = cancellationId`.
3. Save with optional session.

Does **not** modify `booked`, threshold flags, CPL, or other lead fields.

The lifecycle CAS primitive `createCancellationForVerifiedBookingInTransaction` writes `cancelled` with a collection `updateOne` (revision + `booked` filter) instead of calling this helper. Public create still uses this helper.

## `clearCancellationFromLead`

**When:** Cancellation delete (booking delete cascade uses `clearBookingFromLead` instead).

| Param | Default | Purpose |
|-------|---------|---------|
| `leadModel` | required | `FormLead` or `CallLead` |
| `leadId` | optional | No-op when missing (legacy / leadless rows without lead link) |
| `syncAfterClear` | `true` | Inline `syncSourceLead` after save |
| `session` | optional | Participate in caller txn |

**Delete path uses `syncAfterClear: false`** because `deleteCancelledLead` schedules its own follow-up:

- Queued: `booking_chain` or `source_lead` job with `delete_cancelled_lead`.
- Legacy: `syncBookingAndSource` or `syncSourceLeadById`.

This avoids double-sync and keeps sheet refresh batched with booking/source row updates.

## Invariants

- Always load via `getLinkedLead` — do not query form/call collections ad hoc.
- Never clear `booked` here; booking unlink is `clearBookingFromLead`.
- When adding a new cancellation write path, pair mirror set with txn + **Cancellation Chain** job when a lead exists (see [`cancelled-lead.md`](./cancelled-lead.md)).
- When adding a new cancellation unwind path, clear lead in txn and schedule sheet refresh explicitly if opting out of inline sync.

## Related modules

- Full cancellation CRUD + resolver: [`cancelled-lead.md`](./cancelled-lead.md)
- Booking mirror (also clears `cancelled` on booking delete): [`bookings.md`](./bookings.md) → `bookingMirror.service.ts`
- Employee lead claim (not a cancellation helper): `claimAvailableLeadForBooking` in `bookingMirror.service.ts`
- Sheet lead refresh: `syncSourceLead`, `syncBookingAndSource` in `sheetSync/`
