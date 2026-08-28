---
type: Delivery Pack
title: Booking intake robustness — delivery index and session ledger
description: >-
  Navigation and status ledger for three issues that make booking intake
  search any-known-contact, allow Confirm without a required Lead, and let
  the Owner connect a stored Lead to a Leadless Booking from the Bookings tab.
tags:
  - form-lead
  - booking-intake
  - owner-dashboard
  - granot-lifecycle
  - delivery
status: ready
stale_after: 2026-11-28
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/granotLifecycle/**
  - src/validation/v1/granotLifecycle.validation.ts
  - vantage-admin/components/intakes/**
  - vantage-admin/components/granot-lifecycle/**
  - vantage-admin/components/operational/operational-resource-page.tsx
---

# Booking intake robustness — delivery pack

Three shippable issues. This pack follows the conventions of
`docs/job-number-timeline/` and `docs/owner-daily-operations/`: same
fourteen-section issue contract, same rule that **repository state is
authoritative and this ledger is a navigation aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue → record
the result in [`PROGRESS.md`](PROGRESS.md).

This pack does **not** start Owner Daily, rewrite even Binder, or move
Connect onto `/bookings/reconciliation`.

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`booking-intake-lead-attachment-specification.md`](booking-intake-lead-attachment-specification.md) — **wins on every conflict** for the three slices |
| 2 | [`docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md`](../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) — command shapes, eligibility, Sheet Sync names, processor Leadless follow-through. Even Binder already shipped. |
| 3 | [`docs/form-lead-contact-snapshots-display-and-search-specification.md`](../form-lead-contact-snapshots-display-and-search-specification.md) — snapshot storage and shared path lists (shipped) |
| 4 | Current repository code, migrations, and tests — the actual seam each issue extends |
| 5 | Workspace-root `CONTEXT.md` and `vantage-admin/.cursor/rules/project-organization.mdc` |
| 6 | This pack's issues — sequencing and scope only, never new semantics |

Where this pack and the specification disagree, the specification wins and
the issue author fixes this pack in the same change.

The absorbed draft
[`docs/granot-lead-lifecycle/booking-intake-form-lead-contact-snapshots-specification.md`](../granot-lead-lifecycle/booking-intake-form-lead-contact-snapshots-specification.md)
is a pointer. Do not implement from it.

## Session map

| Session | Issue | Repos | Why this size |
| --- | --- | --- | --- |
| **1** | [BILA-01](issues/BILA-01.md) | both | Search + display first. Later issues reuse the DTO and cards. |
| **2** | [BILA-02](issues/BILA-02.md) | both | Optional Lead on Confirm. Needs the contact story on review. |
| **3** | [BILA-03](issues/BILA-03.md) | both | Connect command + Bookings-tab flow. Needs the shared helper. |

Do not start BILA-02 before BILA-01 is `complete`. Do not start BILA-03 UI
before BILA-01 is `complete`. If BILA-02 finishes with time, the Connect
**server** command may begin in the same session; mark that in
`PROGRESS.md` and do not open the Bookings UI until BILA-01's helper exists.

## Unit ledger

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [BILA-01](issues/BILA-01.md) | Intake any-known-contact search and Form submitted vs Granot display | current intake | complete | complete |
| [BILA-02](issues/BILA-02.md) | Confirm without a required Lead; high-confidence auto-attach | BILA-01 | ready | complete |
| [BILA-03](issues/BILA-03.md) | Connect Booking to Lead from `/bookings` | BILA-01; BILA-02 for Leadless follow-through | blocked | complete |

## Ready queue

- **BILA-01 is complete.** Next startable issue is BILA-02.
- BILA-02 is optional Lead on Confirm. The candidate DTO and contact cards are in place.
- BILA-03 waits on BILA-02 making a Granot Leadless Booking a legal,
  reviewable official Booking. The shared helper already exists.

## Standing constraints for every issue

These apply to all issues and are not repeated as scope in each one.

- **Glossary words.** [Form Submitted Contact](../../../CONTEXT.md),
  [Granot Contact Snapshot](../../../CONTEXT.md), [High-Confidence Booking Lead](../../../CONTEXT.md),
  [Leadless Booking](../../../CONTEXT.md), [Connect Booking to Lead](../../../CONTEXT.md).
  A case is not a Booking. Sheet `synced` is not Google-equals-Mongo.
- **Owner-facing labels only.** `Form submitted`, `Granot`,
  `Changed in Granot`, `No stored lead`, `Connect a lead`. Never print
  snapshot field names, `is_leadless_booking`, or `wordpress_form` in UI.
- **Reuse the shared path lists.** `FORM_LEAD_CONTACT_*_PATHS` in
  `src/services/search/leadBrowseShared.ts`. Do not copy the arrays.
- **Do not change** scored Form Lead Search, processor identity, Granot
  write planner, even Binder, or `/bookings/reconciliation`.
- **Medium confidence never auto-attaches** and is never pre-selected.
- **Connect is not Booking Lead Reconciliation.**
- Owner-only at both gates for candidates and Connect — server
  `requireRegistryOwnerActor` and Admin `canProxyVantagePath`.
- Build the server contract first. Admin consumes exported, tested DTOs.
- Ordinary checks use redacted synthetic data. Runtime reads require
  `TEST_MODE=true` and an explicit test database.
- No commit, push, deploy, production flag change, live payload read, or
  external send unless the user explicitly asks.
- After runtime TypeScript changes: `pnpm test` and `pnpm typecheck` in
  the repos you touched. After Admin UI changes, verify in the browser
  at **http://localhost:3000** ([`LOCAL-ADMIN.md`](LOCAL-ADMIN.md)). The
  local API is on **3001**.
- After ship, invoke **docs-keeper** so knowledge docs describe the code
  that actually landed.

## What this pack deliberately does not do

- Owner Daily View (`/daily`).
- Connect on `/intakes` finished cases or Daily Completed rows.
- Redirect `/ingestion/granot/lifecycle/cases/:id` → `/intakes`.
- Intake accordion / unmasking rewrite from the 2026-08-24 spec remainder.
- Auto-creating a Lead from a Granot Booked payload.
- Uneven binder splits or more than two Agents.
- Production flag enablement.

## Verified current state

Observed at pack creation 2026-08-28; BILA-01 bullets restamped 2026-08-28
after ship. Each remaining issue's §4 repeats the subset it depends on.
**Reverify before coding.**

- Admin `/form-leads` shows Form submitted vs Granot and searches both
  snapshots. Shared path lists exist in `leadBrowseShared.ts`. Intake
  reuses `GranotContactStatusChip` / `FormSubmittedGranotCards`;
  `/form-leads` still uses First/Last, empty “No Granot contact yet”,
  and a table chip “—” when Granot is missing.
- **BILA-01 shipped.** Form candidate `q` ORs imported
  `FORM_LEAD_CONTACT_*_PATHS` plus `job_no` / `ref_no`. Call `q` stays
  live-only. Form reads select `ingested_contact_snapshot` and
  `granot_contact_snapshot`. DTO adds `known_contacts` (`form_submitted`
  = live fields; `granot` only when the snapshot exists; stored
  `differs_from_ingested`; no `observation_id`). Empty `q` still pins
  ranked identity; explicit `q` pins nothing. Intake hero/search show
  Form submitted vs Granot via `intake-known-contacts.tsx`.
- `granotLifecycleConfirmBookingCommandSchema.selected_lead` is required.
  `bookingConfirmation.ts` always writes `is_leadless_booking: false`.
  `BookingCommandForm` blocks submit without a matched Lead.
  `pickBestCandidate` can pre-select medium confidence.
- `POST /api/v1/admin/bookings/:id/connect-lead` does not exist.
- `/bookings` is `OperationalResourcePage` with a Leadless filter and no
  Stored-lead chip / Connect section.
- `/bookings/reconciliation` is the employee path. Leave it alone.
- Even Binder (one Binder, two Agents, server even-cent split) has landed.

## Layout

```text
docs/booking-intake-lead-attachment/
├── booking-intake-lead-attachment-specification.md   ← the contract
├── README.md                                         ← you are here
├── AGENT-PROTOCOL.md
├── LOCAL-ADMIN.md
├── PROGRESS.md
├── issues/
│   ├── BILA-01.md
│   ├── BILA-02.md
│   └── BILA-03.md
└── reports/                                          ← one completion report per issue
```
