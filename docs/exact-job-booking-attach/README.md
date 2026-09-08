---
type: Delivery Pack
title: Exact Job Booking Attach — delivery index and session ledger
description: >-
  Navigation and status ledger for four issues that make Employee Booking
  Submission and the Precise Booking Form attach a Lead only on unique Job
  Number, always file the Booking, and open a Booking Lead Reconciliation
  Case when nothing exact attaches.
tags:
  - booking
  - employee-booking
  - call-lead
  - owner-dashboard
  - delivery
status: ready
stale_after: 2026-12-08
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/employeeBookings/**
  - src/services/bookings/bookingSourceResolver.ts
  - src/services/bookings/leadlessBooking.service.ts
  - vantage-admin/components/forms/booking-form.tsx
  - vantage-admin/components/reconciliation/**
---

# Exact Job Booking Attach — delivery pack

Four shippable issues. This pack follows
`docs/booking-intake-lead-attachment/` and `docs/lead-no-sync/`: same
rule that **repository state is authoritative and this ledger is a
navigation aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue →
record the result in [`PROGRESS.md`](PROGRESS.md).

This pack does **not** change Confirm Granot Booking, open a Booking
Lead Reconciliation Case from `/intakes`, move Connect onto
`/bookings/reconciliation`, or change Best Relocation import matching.

## Authorities

Resolve paths from the `vantage-main-server` repository root unless an
issue names `vantage-admin`.

| Order | Authority |
| --- | --- |
| 1 | [`exact-job-booking-attach-specification.md`](exact-job-booking-attach-specification.md) — **wins on every conflict** |
| 2 | Current repository code, migrations, and tests |
| 3 | Workspace-root `CONTEXT.md` |
| 4 | This pack's issues — sequencing and scope only |

Where this pack and the specification disagree, the specification wins
and the issue author fixes this pack in the same change.

## Session map

| Session | Issue | Repos | Why this size |
| --- | --- | --- | --- |
| **1** | [EJBA-01](issues/EJBA-01.md) | server | Policy + employee + rematch. Owner form still old. |
| **2** | [EJBA-02](issues/EJBA-02.md) | server | Precise Form from-source / leadless + Connect fence. |
| **3** | [EJBA-03](issues/EJBA-03.md) | admin | Form copy, optional phone, success link. |
| **4** | [EJBA-04](issues/EJBA-04.md) | server docs | Knowledge after runtime. |

Do not start EJBA-02 before EJBA-01 is `complete`. Do not start EJBA-03
before EJBA-02 returns a case id on pending Owner create. Do not start
EJBA-04 before EJBA-02 and EJBA-03 are `complete`.

## Language

Use workspace-root `CONTEXT.md`. Say
[Exact Job Booking Attach](../../../CONTEXT.md),
[Precise Booking Form](../../../CONTEXT.md),
[Booking Lead Reconciliation](../../../CONTEXT.md),
[Leadless Booking](../../../CONTEXT.md).
Do not call Connect Booking to Lead “reconciliation.”
Do not call a case a Booking.
Do not print `owner_booking` or `created_on_unmatched` in Owner UI.

## Unit ledger

Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [EJBA-01](issues/EJBA-01.md) | Job-only employee match and rematch | spec | ready | ready |
| [EJBA-02](issues/EJBA-02.md) | Precise Form create + `owner_booking` case + Connect fence | EJBA-01 | blocked | ready |
| [EJBA-03](issues/EJBA-03.md) | Precise Booking Form UI | EJBA-02 | blocked | ready |
| [EJBA-04](issues/EJBA-04.md) | Knowledge pointers | EJBA-02, EJBA-03 | blocked | ready |

## What this pack deliberately does not do

- Confirm Granot Booking attach or Leadless (BILA-02).
- Connect on `/intakes`, Daily, or `/bookings/reconciliation`.
- Best Relocation import phone match / Unmatched Call Lead mint.
- RingCentral Call Qualification.
- Auto-creating a Lead from a Granot Booked payload.

## Layout

```text
docs/exact-job-booking-attach/
├── exact-job-booking-attach-specification.md   ← the contract
├── README.md                                   ← you are here
├── AGENT-PROTOCOL.md
├── PROGRESS.md
├── issues/
│   ├── EJBA-01.md
│   ├── EJBA-02.md
│   ├── EJBA-03.md
│   └── EJBA-04.md
└── reports/                                    ← one completion report per issue
```
