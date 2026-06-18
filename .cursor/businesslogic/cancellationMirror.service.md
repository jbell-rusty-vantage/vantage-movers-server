# Cancellation Mirror Service (`cancellationMirror.service.ts`)

**Role:** Keep the linked source lead (`FormLead` / `CallLead`) aligned with cancellation state on Mongo. Does not create cancellations, sync sheets directly, or clear `booked`.

**Called from:** `cancelledLead.service.ts` (create/delete) and indirectly via booking delete through `clearBookingFromLead` in `bookingMirror.service.ts`.

## Mental model

```
FormLead / CallLead
  booked     → BookedLead._id     (set by booking mirror)
  cancelled  → CancelledLead._id  (set by cancellation mirror)
```

Cancellation is **alongside** the booking, not in place of it. Owner sheets show both `Booked` and `Cancelled` columns on lead rows; the cancellation row lives on Master Booked `Cancelled Deals`.

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
- When adding a new cancellation write path, pair mirror set with txn + `cancellation_chain` job (see `cancelledLead.service.md`).
- When adding a new cancellation unwind path, clear lead in txn and schedule sheet refresh explicitly if opting out of inline sync.

## Related modules

- Full cancellation CRUD + resolver: `cancelledLead.service.md`
- Booking mirror (also clears `cancelled` on booking delete): `bookings.service.md` → `bookingMirror.service.ts`
- Sheet lead refresh: `syncSourceLead`, `syncBookingAndSource` in `sheetSync/`
