---
type: Delivery Pack
title: Dashboard delete live claims
description: >-
  One issue. Booking delete releases the active Granot Record Link
  booking_ref and an open booking case deterministic_booking_id.
  Cancellation delete keeps its current unwind.
tags:
  - granot-lifecycle
  - booking
  - cancellation
  - delivery
status: ready
stale_after: 2026-12-28
owners: [team:main-server]
applies_to:
  - vantage-main-server/src/services/bookings/bookedLead.service.ts
  - vantage-main-server/src/services/cancellations/cancelledLead.service.ts
---

# Dashboard delete live claims

One shippable issue. Repository state is authoritative. This ledger is
navigation.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → the issue →
record the result in [`PROGRESS.md`](PROGRESS.md).

The specification wins:
[`dashboard-delete-live-claims-specification.md`](dashboard-delete-live-claims-specification.md).

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`dashboard-delete-live-claims-specification.md`](dashboard-delete-live-claims-specification.md) |
| 2 | [`../knowledge/services/bookings.md`](../knowledge/services/bookings.md) |
| 3 | [`../knowledge/services/cancelled-lead.md`](../knowledge/services/cancelled-lead.md) |
| 4 | [`../knowledge/granot-lifecycle/booking-reconciliation.md`](../knowledge/granot-lifecycle/booking-reconciliation.md) |
| 5 | Workspace-root `CONTEXT.md` |
| 6 | [`issues/DLC-01.md`](issues/DLC-01.md) — sequencing only |

## Session map

| Session | Issue | Repo | Why this size |
| --- | --- | --- | --- |
| **1** | [DLC-01](issues/DLC-01.md) | vantage-main-server | Shared delete helper, replica tests, Delete section restamp |

## Unit ledger

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [DLC-01](issues/DLC-01.md) | Release live claims on dashboard delete | none | ready | ready |

## Ready queue

- [DLC-01](issues/DLC-01.md) — start here.
