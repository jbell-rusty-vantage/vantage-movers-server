---
type: Service
title: Cancelled Lead Service
description: Create, update, and delete Cancelled Leads with booking resolve, snapshots, and cancellation-chain sync.
tags: [cancellation, booking]
status: draft
stale_after: 2026-11-20
resource: src/services/cancellations/cancelledLead.service.ts
applies_to:
  - src/services/cancellations/cancelledLead.service.ts
  - src/services/cancellations/cancellationResolver.ts
  - src/services/cancellations/cancellationMirror.service.ts
  - src/routes/v1.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/cancellations/cancelledLead.service.ts
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
**Primary code:** `src/services/cancellations/cancelledLead.service.ts`, `cancellationResolver.ts`  
**Domain terms used:** [Cancellation](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation Chain](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Referral Booking](../../../../CONTEXT.md), [Agent](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Cancelled Lead Service

**System of Record:** MongoDB `cancelled_leads`. **Cancellations** attach to an existing **Booking**; they snapshot booking/customer/source fields at create time so reporting stays stable if the booking is later mutated or deleted.

Public mutating routes use canonical adapters (`createCancellation`, `updateCancelledLead`, `deleteCancelledLead`) and the executor ([`domain-commands.md`](./domain-commands.md)). `createCancelledLead` forces a Mongo transaction (`forceTransaction: true`).

**Three modules — one lifecycle:**

| File | Role |
|------|------|
| `cancelledLead.service.ts` | CRUD: create, update, delete, list |
| `cancellationResolver.ts` | Resolve target booking + enforce lead/booking match invariants |
| `cancellationMirror.service.ts` | Stamp/clear `cancelled` on linked form/call lead |

Owner reporting via **Sheet Sync**: **Cancellation Chain** refreshes booking + source lead rows, then the `Cancelled Deals` row. Details: [`google-sheets.md`](./google-sheets.md), [`sheet-sync.md`](./sheet-sync.md).

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
runSheetSyncWrite (txn, forceTransaction)
  ├─ insert CancelledLead (snapshot fields from booking)
  ├─ booking.cancelled = cancellation._id
  ├─ mirrorCancellationToLead (lead-attached only)
  ├─ dismiss pending BookingLeadReconciliationCase if present
  └─ persistSheetSyncIntent → cancellation_chain / cancelled_lead.create
        │
        ▼
finalizeSheetSync → syncCancellationChainById
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
- **409** `Standalone booking cancellation is not supported yet` for **Referral Bookings**, unauthorized leadless bookings, or bookings missing `lead_ref`/`lead_model` that are not leadless

Leadless cancel is allowed only when the caller passes `allowLeadless: true`. Public create sets that flag when `ingestion_source === "best_relocation_sheet"` (test: `getBookedLeadForCancellation allows explicitly authorized imported leadless booking`). Ordinary public cancel of leadless or referral stays 409.

Create repeats: if the booking is not leadless and still lacks lead metadata → **409** `Referral booking cancellation is not supported yet`.

**Known split (leave open):** gated Granot Release `createCancellation` can cancel a referral without a Lead mirror. Checked-in Release flags stay false. Do not merge that path into this public invariant (`public-v1-referral-cancel-vs-gated-release`).

Best Relocation import may also pass `requiredSourceConnectionKey`. Lead-attached bookings must be `best_relocation_leads`; leadless bookings must have a matching `createLeadlessBooking` command execution or create throws 400.

### Snapshot fields (at create)

Copied from the populated booking so cancellation rows remain usable independently:

| Field | Source |
|-------|--------|
| `booked_lead`, `lead_ref`, `lead_model` | Booking linkage (lead refs omitted when leadless) |
| `customer` | Booking customer id |
| `customer_name` | Populated `customer.full_name` only on this public path (not `booking.customer_name`) |
| `agent` | `primaryAgentName(booking)` — first `agent_allocations[]` snapshot |
| `book_date`, `job_no`, `merchant`, `source` | Booking |
| `cancel_date` | Input or defaults to `timestamp` |
| `timestamp` | Input or `tx.now` / `new Date()` |
| `refund_amount`, `reason`, `notes`, `cancelled_by` | Request |

The lifecycle primitive `createCancellationForVerifiedBookingInTransaction` is a separate CAS claim (`domain_revision` + `normalized_job_no` + unset `cancelled`). It may fall back to `booking.customer_name` and parses official `cancel_date` as UTC midnight. It is not the public route.

Update does **not** re-snapshot booking fields; patch only cancellation-owned columns.

### Lead mirror and cases on create

`mirrorCancellationToLead` runs only when `lead_ref` + `lead_model` exist. The source lead **keeps** `booked`. See [`cancellation-mirror.md`](./cancellation-mirror.md).

A pending `BookingLeadReconciliationCase` for the booking is set `dismissed` with `resolution_history.action=booking_cancelled`.

## Update (`updateCancelledLead`)

- Patchable: `timestamp`, `cancel_date`, `refund_amount`, `reason`, `notes`, `cancelled_by`.
- **404** when id unknown.
- Canonical `updateCancelledLeadInTransaction`: no `CANCELLED_LEAD_CHANGE_PATHS` diffs → **noop** (no save, no Sheet job).
- Public `updateCancelledLead` always `findByIdAndUpdate` + `cancellation_chain` / `cancelled_lead.update`. Does not touch booking or lead refs.

## Delete (`deleteCancelledLead`)

Unwinds all state the cancellation owns. **404** when missing. Missing `leadId` on old rows → lead clear is a no-op (schema also allows a cancellation without Lead metadata — test: unresolved employee booking).

**Queued mode:**

1. Txn: `$unset` `booking.cancelled` (when booking still exists).
2. `clearCancellationFromLead(..., syncAfterClear: false)` when lead metadata exists.
3. Tombstone `delete_cancelled_lead` with prior sheet targets from `cancellation.sheet_sync`.
4. Enqueue refresh:
   - **`booking_chain`** when booking + lead metadata survive.
   - Else **`source_lead`** when only `lead_ref` is known.
5. Delete `CancelledLead` document.
6. `finalizeSheetSyncDelete()`.

**Legacy mode:**

1. `deleteCancelledLeadFromSheets(cancellation)` first (sheet before Mongo).
2. `$unset` `booking.cancelled`.
3. `clearCancellationFromLead(..., syncAfterClear: false)`.
4. Inline `syncBookingAndSource` or `syncSourceLeadById`.
5. Delete cancellation document last (upstream wipes settle even if final delete fails).

## Sheet Sync

| Path | Resource | Operation |
|------|----------|-----------|
| Create | `cancellation_chain` | `cancelled_lead.create` |
| Update | `cancellation_chain` | `cancelled_lead.update` |
| Delete | `delete_cancelled_lead` tombstone + follow-up | `delete_cancelled_lead` |

`syncCancellationChainById` (drainer/legacy): **booking chain first**, then `syncCancelledLeadToSheets` → Master Booked `Cancelled Deals`.

Delete tombstone coalesces with pending `cancellation_chain` upserts for the same entity id.

## Cross-module interactions

| Module | Interaction |
|--------|-------------|
| `bookings/bookedLead.service.ts` | Booking delete with `cascade=true` removes linked cancellation first; mirrors cleared on lead |
| `bookings/bookingMirror.service.ts` | `clearBookingFromLead` also clears `cancelled` on lead delete |
| [`agent-allocation.md`](./agent-allocation.md) | Agent on cancellation = primary agent snapshot at create |
| Analytics | `cancel_date`-scoped cancellation reports ([`analytics.md`](./analytics.md)) |

## Invariants

- **One cancellation per booking** — enforced at resolve/create (`booking.cancelled` must be unset).
- **Public path:** Referral Bookings blocked (409). Leadless cancel only when Best Relocation import sets `allowLeadless`.
- **Traceability** — lead-attached cancellations store `booked_lead`, `lead_ref`, `lead_model`. Leadless/employee unresolved rows may omit lead refs (schema allows it).
- **Do not bypass** `resolveBookedLeadForCancellation`, mirror helpers, or sheet-sync txn scheduling.
- Cancellation create/update/delete are high-risk; add focused tests when changing unwind order or referral/leadless guards.
- `domain_revision` defaults to `0`. `change_history_started_at` is a write-once server boundary. Public/admin DTOs cannot set revision metadata. Canonical create/update/delete adapters persist append-only `EntityChange` rows and stamp `last_change_*` in the executor transaction.

## Operational events

| Path | Event |
|------|-------|
| Create | `cancellation.created` (`workflow: cancellation_create`) |
| Route failures | `cancellation.route.failed` |

## Tests

`cancellationResolver.test.ts` — authorized leadless cancel; CancelledLead validates without Lead metadata.

## Related modules

- Lead mirror semantics: [`cancellation-mirror.md`](./cancellation-mirror.md)
- Booking lifecycle: [`bookings.md`](./bookings.md)
- Sheets: `syncCancelledLeadToSheets`, `deleteCancelledLeadFromSheets`
- Resolver exports: `getBookedLeadForCancellation` for reuse
