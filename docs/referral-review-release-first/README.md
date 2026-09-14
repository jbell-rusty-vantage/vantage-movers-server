---
type: Delivery Pack
title: Referral review Release-first owner commands
description: >-
  Navigation and status ledger for three issues that let Owner No
  Action, Update, and Cancel work on a Referral review case whose
  first evidence is Release.
tags:
  - granot-lifecycle
  - booking
  - referral
  - delivery
status: ready
stale_after: 2026-12-14
owners: [team:main-server, team:vantage-admin]
applies_to:
  - vantage-main-server/src/services/granotLifecycle/bookingOwnerCommands.ts
  - vantage-admin/components/granot-lifecycle/no-action-form.tsx
---

# Referral review Release-first owner commands

Three shippable issues. This pack follows
`docs/lead-costs-owner-editing/`: same issue contract, same rule that
**repository state is authoritative and this ledger is a navigation
aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue →
record the result in [`PROGRESS.md`](PROGRESS.md).

The specification wins:
[`referral-review-release-first-specification.md`](referral-review-release-first-specification.md).

This pack does **not** change Release-into-intake persist, mint a
second Booking, loosen Create Referral Booking, or rewrite production
evidence.

## Authorities

Resolve paths from the `vantage-main-server` repository root unless
the issue says `vantage-admin`.

| Order | Authority |
| --- | --- |
| 1 | [`referral-review-release-first-specification.md`](referral-review-release-first-specification.md) — **wins on every conflict** |
| 2 | [`../knowledge/granot-lifecycle/booking-reconciliation.md`](../knowledge/granot-lifecycle/booking-reconciliation.md) |
| 3 | [`../knowledge/granot-lifecycle/release-into-booking-intake.md`](../knowledge/granot-lifecycle/release-into-booking-intake.md) |
| 4 | Current `bookingOwnerCommands.ts` / Admin 409 forms — the seams each issue extends |
| 5 | Workspace-root `CONTEXT.md` |
| 6 | This pack’s issues — sequencing and scope only |

Where this pack and the specification disagree, the specification
wins and the issue author fixes this pack in the same change.

## Session map

| Session | Issue | Repos | Why this size |
| --- | --- | --- | --- |
| **1** | [RRF-01](issues/RRF-01.md) | vantage-main-server | TDD + `assertActiveReferralPolicy`. Unblocks the desk. |
| **2** | [RRF-02](issues/RRF-02.md) | vantage-admin | 409 copy. Server already correct; do not wait to ship RRF-01. |
| **3** | [RRF-03](issues/RRF-03.md) | vantage-main-server docs | docs-keeper restamp after RRF-01 is green. |

RRF-02 may start after RRF-01 is `complete`, or in parallel only if
the copy helper does not depend on a new server code. Prefer
**RRF-01 first**.

## Unit ledger

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [RRF-01](issues/RRF-01.md) | Server policy helper + tests | current owner commands | complete | complete |
| [RRF-02](issues/RRF-02.md) | Admin 409 copy | RRF-01 preferred | complete | complete |
| [RRF-03](issues/RRF-03.md) | Knowledge restamp | RRF-01 | complete | complete |

## Ready queue

- Pack complete. Live values: [`PROGRESS.md`](PROGRESS.md).

## Standing constraints for every issue

- **Glossary words.** [Referral Booking](../../../CONTEXT.md),
  [No Action](../../../CONTEXT.md),
  [Granot Observation](../../../CONTEXT.md),
  [Granot Booking Reconciliation Case](../../../CONTEXT.md),
  [Confirm Granot Cancellation](../../../CONTEXT.md).
- **Do not** change persist `$push`, `assertActiveSourceScope`, or
  Create Referral Booking minting.
- **Do not** mint a second Booking for Job 5558690.
- **Do not** rewrite production evidence.
- Ordinary checks use redacted synthetic data. Do not paste Owner
  passwords or live customer contact.
- No commit, push, deploy, production flag change, or live payload
  write unless the user explicitly asks.
- After server changes: package tests named in the issue, plus
  typecheck, in `vantage-main-server`.
- After Admin UI changes: `pnpm test`, `pnpm typecheck`, and
  `pnpm lint` in `vantage-admin`.
- After ship, invoke **docs-keeper** (RRF-03) so
  `booking-reconciliation.md` describes the helper that landed.

## What this pack deliberately does not do

- Release-into-intake classifier changes.
- Latest-Booked policy retarget.
- Historical Release-case command merge.
- Production one-off close of 5558690 as the “fix.”
- Owner Daily, Live Events, or Connect Booking to Lead.

## Verified current state

Observed at pack creation 2026-09-14. **Reverify before coding.**

- `assertActiveReferralPolicy` requires
  `observation.booking_action?.normalized !== "booked"` on
  `evidence[0]`.
- Called from `applyNoAction` (no Source Scope), `applyUpdate`
  (Referral Booking), `applyConfirmCancellation` (Referral Booking).
- `createReferralBooking` inlines its own Booked check.
- One open Referral review in `vantagemovers`: Job 5558690,
  `evidence[0] = release`.
- Source-scoped Release-first reviews already resolve (15 historical).
- `no-action-form.tsx` labels every 409 as case revision changed.

## Layout

```text
docs/referral-review-release-first/
├── referral-review-release-first-specification.md   ← the contract
├── README.md                                        ← you are here
├── AGENT-PROTOCOL.md
├── PROGRESS.md
├── issues/
│   ├── RRF-01.md
│   ├── RRF-02.md
│   └── RRF-03.md
└── reports/
    └── README.md
```
