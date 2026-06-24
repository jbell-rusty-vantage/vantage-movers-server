**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `api/services/cancellations/cancellationMirror.service.ts`  
**Domain terms used:** Cancellation, Booking, Form Lead, Call Lead, Sheet Sync

# Cancellation Mirror Service

**Role:** Keep the linked source **Form Lead** / **Call Lead** aligned with **Cancellation** state on Mongo. Does not create cancellations, **Sheet Sync** directly, or clear `booked`.

**Called from:** `cancelledLead.service.ts` (create/delete) and indirectly via booking delete through `clearBookingFromLead` in `bookingMirror.service.ts`.

## Mental model

```
FormLead / CallLead
  booked     → BookedLead._id     (set by booking mirror)
  cancelled  → CancelledLead._id  (set by cancellation mirror)
```

Cancellation is **alongside** the **Booking**, not in place of it. **Reporting Sheets** show both Booked and Cancelled columns on lead rows; the **Cancellation** row lives on **Master Booked** `Cancelled Deals` tab.

## `mirrorCancellationToLead`

**When:** Cancellation create, inside the same Mongo transaction as booking + cancellation inserts.

1. `getLinkedLead(leadModel, leadId, session)`.
2. Set `lead.cancelled = cancellationId`.
3. Save with optional session.

Does **not** modify `booked`, threshold flags, CPL, or other lead fields.

## `clearCancellationFromLead`

**When:** Cancellation delete (and booking delete cascade via `clearBookingFromLead`).

| Param | Default | Purpose |
|-------|---------|---------|
| `leadModel` | required | `FormLead` or `CallLead` |
| `leadId` | optional | No-op when missing (legacy rows without lead link) |
| `syncAfterClear` | `true` | Inline `syncSourceLead` after save |
| `session` | optional | Participate in caller txn |

**Delete path uses `syncAfterClear: false`** because `deleteCancelledLead` schedules its own follow-up:

- Queued: `booking_chain` or `source_lead` job with `delete_cancelled_lead`.
- Legacy: `syncBookingAndSource` or `syncSourceLeadById`.

This avoids double-sync and keeps sheet refresh batched with booking/source row updates.

## Invariants

- Always load via `getLinkedLead` — do not query form/call collections ad hoc.
- Never clear `booked` here; booking unlink is `clearBookingFromLead`.
- When adding a new cancellation write path, pair mirror set with txn + **Cancellation Chain** job (see [`cancelledLead.service.md`](cancelledLead.service.md)).
- When adding a new cancellation unwind path, clear lead in txn and schedule sheet refresh explicitly if opting out of inline sync.

## Related modules

- Full cancellation CRUD + resolver: `cancelledLead.service.md`
- Booking mirror (also clears `cancelled` on booking delete): `bookings.service.md` → `bookingMirror.service.ts`
- Sheet lead refresh: `syncSourceLead`, `syncBookingAndSource` in `sheetSync/`
