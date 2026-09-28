---
type: Specification
title: Dashboard delete releases live Booking and Cancellation claims
description: >-
  Booking delete and Cancellation delete must drop live claims that later
  commands treat as the current Booking or Cancellation. The active Granot
  Record Link booking_ref is the claim that blocked Confirm after a dashboard
  Booking delete. Resolved case history stays.
tags:
  - granot-lifecycle
  - booking
  - cancellation
status: implementation-ready
stale_after: 2026-12-28
owners: [team:main-server]
applies_to:
  - src/services/bookings/bookedLead.service.ts
  - src/services/cancellations/cancelledLead.service.ts
  - src/services/domainCommands/existingWrites.ts
  - docs/knowledge/services/bookings.md
sources:
  - id: glossary
    resource: ../../../CONTEXT.md
    title: Platform glossary
  - id: bookings
    resource: ../knowledge/services/bookings.md
    title: Bookings service
  - id: cancelled-lead
    resource: ../knowledge/services/cancelled-lead.md
    title: Cancelled lead service
  - id: booking-reconciliation
    resource: ../knowledge/granot-lifecycle/booking-reconciliation.md
    title: Booking reconciliation
---

# Dashboard delete releases live Booking and Cancellation claims

> **Contract maturity: implementation-ready.** This file wins. File
> citations are evidence; reverify them before coding. Agents work from
> [`README.md`](README.md) → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) →
> [`issues/DLC-01.md`](issues/DLC-01.md).

**Prepared:** 2026-09-28
**Repo:** `vantage-main-server` only.
**Incident:** Job Number 5565003. Dashboard `deleteBookedLead` removed the
Booking and cleared the Lead `booked` pointer. The active [Granot Record
Link](../../../CONTEXT.md) kept `booking_ref` on the deleted Booking id.
The next [Confirm Granot Booking](../../../CONTEXT.md) returned `409
GRANOT_IDENTITY_CONFLICT` (`Record Link has an incompatible Booking or
source claim`) because `assertCompatibleLink` treats that field as a live
Booking. That job was rebooked after a one-off clear. This pack does not
repair production rows.

---

## 0. Authority

| Order | Authority | Wins on |
| --- | --- | --- |
| 1 | **This file** | Which claims a dashboard delete releases, and which history it leaves |
| 2 | [`bookings.md`](../knowledge/services/bookings.md) Delete | Lead clear, cascade, Sheet Sync tombstone. This file adds the Record Link release on top |
| 3 | [`cancelled-lead.md`](../knowledge/services/cancelled-lead.md) Delete | Cancellation unwind of `booking.cancelled` and Lead `cancelled` |
| 4 | [`booking-reconciliation.md`](../knowledge/granot-lifecycle/booking-reconciliation.md) | Confirm identity check. Do not loosen `assertCompatibleLink` |
| 5 | Workspace-root [`CONTEXT.md`](../../../CONTEXT.md) | Words |

## 1. Dashboard scope

The Owner dashboard deletes a [Booking](../../../CONTEXT.md) or a
[Cancellation](../../../CONTEXT.md). It does not delete a [Lead](../../../CONTEXT.md).

Those deletes enter:

- `DELETE /api/v1/booked-leads/:id` → `deleteBookedLead` /
  `deleteBookedLeadInTransaction`
- `DELETE /api/v1/cancelled-leads/:id` → `deleteCancelledLead` /
  `deleteCancelledLeadInTransaction`

Customer-delete and Lead-delete cascades that already call those same
functions get the same release. Do not add a second dashboard-only path.

## 2. Live claim and history

A **live claim** is a field a later command reads as the current Booking
or Cancellation.

| Field | On delete of | Action |
| --- | --- | --- |
| Lead `booked` | Booking | Already cleared by `clearBookingFromLead`. Keep that. |
| Lead `cancelled` | Cancellation | Already cleared by `clearCancellationFromLead`. Keep that. |
| Booking `cancelled` | Cancellation | Already `$unset`. Keep that. |
| Active Granot Record Link `booking_ref` | Booking, when it equals that Booking | **Release in this pack.** |
| Open [Granot Booking Reconciliation Case](../../../CONTEXT.md) `deterministic_booking_id` | Booking, when it equals that Booking | **Release in this pack.** |
| Resolved case `deterministic_booking_id`, `resolution.entity_ref` | either | **Leave.** History of the row that existed. |
| Superseded Record Link `booking_ref` | Booking | **Leave.** |
| Active Record Link `lead_ref`, `source_scope`, `state` | Booking | **Leave.** The link stays active. |
| Discrepancy `booking_id` / `cancellation_id` | either | **Leave.** Snapshot, not this pack. |
| Daily Operations facts | either | **Leave.** |

`assertCompatibleLink` stays strict. After this pack, a dashboard Booking
delete leaves no active `booking_ref` for the deleted id, so the next
Confirm on that job is not rejected for a ghost Booking.

## 3. Booking delete

Inside the same transaction as the Booking delete, before
`booking.deleteOne`, both `deleteBookedLead` and
`deleteBookedLeadInTransaction` call one shared helper.

### 3.1 Record Link

Load the active link with `provider: "granot"`, `state: "active"`, and
`booking_ref` equal to this Booking. Zero matches is success and writes
no link change.

On one match, `GranotRecordLink.collection.updateOne` with the delete
session:

- filter: `_id`, `state: "active"`, `booking_ref` this Booking,
  `domain_revision` the loaded value
- update: `$unset` `booking_ref`, `$inc` `domain_revision` by 1

`matchedCount` must be 1. Zero means the link moved; abort the
transaction. Do not delete the Booking after a lost compare-and-swap.

Do not call `GranotRecordLink.updateOne`. Query middleware rejects
`booking_ref` (`assertAllowlistedRecordLinkRefreshUpdate`). Do not add
`booking_ref` to that allowlist.

Keep `lead_ref`, `source_scope`, and `state: "active"`. Do not supersede
the link. Do not change `last_observation_id`.

Emit one EntityChange for model `GranotRecordLink`: `booking_ref` cleared,
`domain_revision` advanced. Canonical delete adds that mutation to the
list `runExistingDeleteBookedLead` already persists. Compatibility
`deleteBookedLead` persists the same change with the actor that path
already uses for its Lead change. A delete with no matching link emits
no link change.

Bump `preallocatedChangeIds` on the canonical delete so the extra
mutation fits. Reverify the current count before editing it.

### 3.2 Open booking case

For every [Granot Booking Reconciliation Case](../../../CONTEXT.md) with
`state: "open"` and `deterministic_booking_id` equal to this Booking
(expect zero or one; the open job+kind index is unique):

- `$unset` `deterministic_booking_id`
- `$inc` `case_revision` by 1
- filter includes `state: "open"`, that `deterministic_booking_id`, and
  the loaded `case_revision`
- `matchedCount` must be 1 or the transaction aborts

Leave `state: "open"`, `evidence`, `record_link_id`, `mode`, and
`resolution` unchanged. An in-flight owner command then sees
`GRANOT_CASE_REVISION_CONFLICT` and refreshes. Do not resolve the case
from the delete.

Granot Release Reconciliation Case `deterministic_booking_id` is
required on that schema. Do not `$unset` it. This pack does not migrate
retired release cases.

### 3.3 Cascade

When `cascade` deletes the linked Cancellation, run the existing
cancellation unwind, then the Booking release in §3.1–§3.2, then delete
the Booking. The active link `booking_ref` is still released.

Referral and leadless Bookings have no Lead clear. They still release a
matching active `booking_ref`.

## 4. Cancellation delete

`deleteCancelledLead` already `$unset`s `booking.cancelled` and clears
Lead `cancelled`, then deletes the Cancellation. Keep that order.

Do not clear an active Record Link `booking_ref` on Cancellation delete.
The Booking is still there. Do not write a Record Link EntityChange for
this delete.

Do not clear resolved case history or discrepancy `cancellation_id`.

## 5. Tests

Write the failing tests first. Name them with the AC ids. Use the
existing replica harness. Reverify fixture helpers in
`bookingConfirmation.replica.test.ts` before seeding Confirm.

| ID | Criterion |
| --- | --- |
| **AC-DLC-01** | Booking delete with an active link whose `booking_ref` is that Booking: Booking document gone, Lead `booked` unset, link `state` still `active`, `lead_ref` unchanged, `booking_ref` absent, `domain_revision` increased by 1. |
| **AC-DLC-02** | That delete writes one `GranotRecordLink` EntityChange whose `booking_ref` after-value is absent. |
| **AC-DLC-03** | Booking delete with no active link naming it succeeds and writes no Record Link change. |
| **AC-DLC-04** | An active link whose `booking_ref` is a different Booking is unchanged. |
| **AC-DLC-05** | A superseded link that still stores this Booking id is unchanged. |
| **AC-DLC-06** | An open booking case whose `deterministic_booking_id` is this Booking stays `open`, loses that id, increments `case_revision` by 1, and keeps `evidence` and `record_link_id`. |
| **AC-DLC-07** | A resolved booking case keeps `deterministic_booking_id` and `resolution.entity_ref`. |
| **AC-DLC-08** | After AC-DLC-01, Confirm Granot Booking on a new open `create_missing_booking` for that job and that link does not return `GRANOT_IDENTITY_CONFLICT` for an incompatible Booking claim. |
| **AC-DLC-09** | Cancellation delete unsets `booking.cancelled`, clears Lead `cancelled`, leaves the active link `booking_ref` on the surviving Booking, and writes no Record Link change. |
| **AC-DLC-10** | Booking delete with `cascade=true` removes the Cancellation and still satisfies AC-DLC-01. |
| **AC-DLC-11** | `GranotRecordLink` model `updateOne` still rejects a `booking_ref` update. |
| **AC-DLC-12** | No new `deleteOne` / `deleteMany` middleware on Booking, Cancellation, Lead, or Record Link. |

## 6. Knowledge

After the tests are green, add the Record Link release and the open-case
`deterministic_booking_id` release to the Delete section of
[`bookings.md`](../knowledge/services/bookings.md). State that
Cancellation delete does not clear `booking_ref`. Do not copy this
specification into that Service file.

## 7. Out of scope

- Mongoose pre/post query or document middleware as the mechanism.
- Loosening `assertCompatibleLink` or Confirm.
- Adding `booking_ref` to the Record Link refresh allowlist.
- Lead delete, `lead_ref` clearing, customer-delete behavior beyond the
  shared Booking delete helper.
- Discrepancy rows, Daily Operations facts, Sheet Sync planner changes.
- Admin UI copy.
- Production data repair, including job 5565003.
- Granot Release Reconciliation Case migration.
