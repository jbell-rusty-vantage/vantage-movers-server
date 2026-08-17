**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/cancellations/cancelledLead.service.ts`, `cancellationResolver.ts`  
**Domain terms used:** Cancellation, Booking, Cancellation Chain, Sheet Sync, Referral Booking, Agent, System of Record

# Cancelled Lead Service

**System of Record:** MongoDB `cancelled_leads`. **Cancellations** attach to an existing lead-attached **Booking**; they snapshot booking/customer/source fields at create time so reporting stays stable if the booking is later mutated or deleted.

**Three modules — one lifecycle:**

| File | Role |
|------|------|
| `cancelledLead.service.ts` | CRUD: create, update, delete, list |
| `cancellationResolver.ts` | Resolve target booking + enforce lead/booking match invariants |
| `cancellationMirror.service.ts` | Stamp/clear `cancelled` on linked form/call lead (see dedicated doc) |

Owner reporting via **Sheet Sync**: **Cancellation Chain** refreshes booking + source lead rows, then the `Cancelled Deals` row. Details: [`googleSheets.service.md`](googleSheets.service.md), [`sheetSync.service.md`](sheetSync.service.md).

## HTTP entry points

| Route | Service |
|-------|---------|
| `POST /api/v1/cancelled-leads` | `createCancelledLead` |
| `PATCH /api/v1/cancelled-leads/:id` | `updateCancelledLead` |
| `DELETE /api/v1/cancelled-leads/:id` | `deleteCancelledLead` |
| `GET /api/v1/cancelled-leads` | `findAllCancelledLeads` (last 200 by `createdAt`) |

## Create (`createCancelledLead`)

```
Request (booked_lead and/or lead_id)
        │
        ▼
resolveBookedLeadForCancellation
        │
        ▼
runSheetSyncWrite (txn)
  ├─ insert CancelledLead (snapshot fields from booking)
  ├─ booking.cancelled = cancellation._id
  ├─ mirrorCancellationToLead
  └─ persistSheetSyncIntent → cancellation_chain / cancelled_lead.create
        │
        ▼
finalizeSheetSync → syncCancellationChainById
  ├─ booking chain (Master Booked + source lead)
  └─ cancellation row (Cancelled Deals)
```

### Resolver (`cancellationResolver.ts`)

| Input | Behavior |
|-------|----------|
| `booked_lead` only | Load booking via `getBookedLeadForCancellation` |
| `lead_id` only | Resolve source lead → require `lead.booked` → load that booking |
| Both | **409** if booking ids disagree (`booked_lead does not match the source lead booking`) |
| Neither | **400** |
| Source lead not booked | **409** |
| Booking `lead_ref`/`lead_model` ≠ source lead | **409** (`Booked lead does not match the source lead`) |

`getBookedLeadForCancellation` also enforces:

- **404** when booking missing
- **409** when `booking.cancelled` already set
- **409** for **Referral Bookings** or bookings missing `lead_ref`/`lead_model`

Create repeats the referral guard after resolve (defense in depth).

### Snapshot fields (at create)

Copied from the populated booking so cancellation rows remain usable independently:

| Field | Source |
|-------|--------|
| `booked_lead`, `lead_ref`, `lead_model` | Booking linkage |
| `customer`, `customer_name` | Booking customer |
| `agent` | `primaryAgentName(booking)` — first `agent_allocations[]` snapshot |
| `book_date`, `job_no`, `merchant`, `source` | Booking |
| `cancel_date` | Input or defaults to `timestamp` |
| `timestamp` | Input or `new Date()` |
| `refund_amount`, `reason`, `notes`, `cancelled_by` | Request |

Update does **not** re-snapshot booking fields; patch only cancellation-owned columns.

### Lead mirror on create

`mirrorCancellationToLead` sets `lead.cancelled = cancellation._id`. The source lead **keeps** `booked` — cancellation is additive to the booking, not a replacement. See `cancellationMirror.service.md`.

## Update (`updateCancelledLead`)

- Patchable: `timestamp`, `cancel_date`, `refund_amount`, `reason`, `notes`, `cancelled_by`.
- **404** when id unknown.
- Txn + `cancellation_chain` / `cancelled_lead.update`; does not touch booking or lead refs.

## Delete (`deleteCancelledLead`)

Unwinds all state the cancellation owns. Order matters for sheet/Mongo consistency.

**Queued mode:**

1. Txn: `$unset` `booking.cancelled` (when booking still exists).
2. `clearCancellationFromLead(..., syncAfterClear: false)` — mutate lead only.
3. Tombstone `delete_cancelled_lead` with prior sheet targets from `cancellation.sheet_sync`.
4. Enqueue refresh:
   - **`booking_chain`** when booking + lead metadata survive → clears cancelled flags on booked/source sheet rows.
   - Else **`source_lead`** when only `lead_ref` is known.
5. Delete `CancelledLead` document.
6. `finalizeSheetSyncDelete()`.

**Legacy mode:**

1. `deleteCancelledLeadFromSheets(cancellation)` first (sheet before Mongo).
2. `$unset` `booking.cancelled`.
3. `clearCancellationFromLead(..., syncAfterClear: false)`.
4. Inline `syncBookingAndSource` or `syncSourceLeadById`.
5. Delete cancellation document last (upstream wipes settle even if final delete fails).

**404** when cancellation missing. Missing `leadId` on old rows → lead clear is a no-op (preserved behavior).

## Sheet Sync

| Path | Resource | Operation |
|------|----------|-----------|
| Create | `cancellation_chain` | **Cancellation Chain** — `cancelled_lead.create` |
| Update | `cancellation_chain` | `cancelled_lead.update` |
| Delete | `delete_cancelled_lead` tombstone + follow-up | `delete_cancelled_lead` |

`syncCancellationChainById` (drainer/legacy): **booking chain first**, then `syncCancelledLeadToSheets` → Master Booked `Cancelled Deals`.

Delete tombstone coalesces with pending `cancellation_chain` upserts for the same entity id.

## Cross-module interactions

| Module | Interaction |
|--------|-------------|
| `bookings/bookedLead.service.ts` | Booking delete with `cascade=true` removes linked cancellation first; mirrors cleared on lead |
| `bookings/bookingMirror.service.ts` | `clearBookingFromLead` also clears `cancelled` on lead delete |
| `agentAllocation.service.md` | Agent on cancellation = primary agent snapshot at create |
| Analytics | `cancel_date`-scoped cancellation reports (`analytics.service.md`) |

## Invariants

- **One cancellation per booking** — enforced at resolve/create (`booking.cancelled` must be unset).
- **Lead-attached Bookings only** — **Referral Bookings** blocked (409); same as booking update/delete limits.
- **Traceability** — every cancellation stores `booked_lead`, `lead_ref`, `lead_model` for admin search and sheet linkage.
- **Do not bypass** `resolveBookedLeadForCancellation`, mirror helpers, or sheet-sync txn scheduling.
- Cancellation create/update/delete are high-risk; add focused tests when changing unwind order or referral guards.
- `domain_revision` defaults to `0`. `change_history_started_at` is a write-once server boundary. Public/admin DTOs cannot set revision metadata. Canonical compare-and-swap / `EntityChange` enforcement is incomplete until Unit 11.

## Operational events

| Path | Event |
|------|-------|
| Create | `cancellation.created` (`workflow: cancellation_create`) |
| Route failures | `cancellation.route.failed` |

## Related modules

- Lead mirror semantics: `cancellationMirror.service.md`
- Booking lifecycle: `bookings.service.md`
- Sheets: `syncCancelledLeadToSheets`, `deleteCancelledLeadFromSheets`
- Resolver exports: `getBookedLeadForCancellation` for reuse
