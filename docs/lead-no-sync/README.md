---
type: Delivery Pack
title: No-Sync Lead — delivery index and session ledger
description: >-
  Navigation and status ledger for four issues that persist no_sync,
  default it on Manual create, delete Master Leads rows when marked,
  filter it on the desks, and make Owner contains say Not expected.
tags:
  - form-lead
  - call-lead
  - sheet-sync
  - owner-dashboard
  - delivery
status: ready
stale_after: 2026-12-06
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/sheetSync/**
  - src/services/googleSheets/expectedSheetTabs.ts
  - src/services/googleSheets/sheetContains.ts
  - src/services/leads/**
  - vantage-admin/components/manual/**
  - vantage-admin/components/operational/**
---

# No-Sync Lead — delivery pack

Four shippable issues. This pack follows
`docs/booking-intake-lead-attachment/` and
`docs/call-lead-contact-provenance/`: same fourteen-section issue
contract, same rule that **repository state is authoritative and this
ledger is a navigation aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue →
record the result in [`PROGRESS.md`](PROGRESS.md).

This pack does **not** exclude No-Sync Leads from lead-cost analytics,
change Bad Lead or Duplicate Lead sheet routing, apply `no_sync` to any
Master Leads tab other than Forms and Calls, or skip Booked Deals when
Booking Chain matches a No-Sync Lead. Booking Chain must still write
Booked Deals and must **not** upsert Forms or Calls for that Lead.

## Authorities

Resolve paths from the `vantage-main-server` repository root unless an
issue names `vantage-admin`.

| Order | Authority |
| --- | --- |
| 1 | [`lead-no-sync-specification.md`](lead-no-sync-specification.md) — **wins on every conflict** |
| 2 | Current repository code, migrations, and tests |
| 3 | Workspace-root `CONTEXT.md` |
| 4 | This pack's issues — sequencing and scope only |

Where this pack and the specification disagree, the specification wins
and the issue author fixes this pack in the same change.

## Session map

| Session | Issue | Repos | Why this size |
| --- | --- | --- | --- |
| **1** | [LNS-01](issues/LNS-01.md) | server | Field, create default, planner skip + delete, contains skip. Everything else sits on this. |
| **2** | [LNS-02](issues/LNS-02.md) | both | Owner PATCH + detail control. Needs the planner delete. |
| **3** | [LNS-03](issues/LNS-03.md) | both | Desk filter/column, Manual checkbox, contains copy. |
| **4** | [LNS-04](issues/LNS-04.md) | server docs | Knowledge. After the three runtime issues. |

Do not start LNS-02 before LNS-01 is `complete`. Do not start LNS-03
before LNS-01 is `complete`. LNS-02 and LNS-03 may run sequentially in
the same desk session after LNS-01. Do not start LNS-04 before LNS-02
and LNS-03 are `complete`.

## Language

Use workspace-root `CONTEXT.md`. Say [No-Sync Lead](../../../CONTEXT.md),
`no_sync`, Hide from Master Leads, Show on Master Leads, Hidden from
Master Leads. Do not call this an
[Unmatched Call Lead](../../../CONTEXT.md). Do not say Hide from
Sheets. Do not say Sheet `synced` means Google equals Mongo. Owner UI
never prints `no_sync`.

## Unit ledger

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [LNS-01](issues/LNS-01.md) | Field, Manual default, planner delete, contains Not expected | spec | ready | ready |
| [LNS-02](issues/LNS-02.md) | Owner mark / unmark via `updateSourceOwnedLead` | LNS-01 | blocked | ready |
| [LNS-03](issues/LNS-03.md) | Desk filter, column, Manual checkbox, contains copy | LNS-01 | blocked | ready |
| [LNS-04](issues/LNS-04.md) | Knowledge and pointer sentences | LNS-02, LNS-03 | blocked | ready |

## Standing constraints for every issue

These apply to all issues and are not repeated as scope in each one.

- **Glossary words.** No-Sync Lead is not an Unmatched Call Lead.
- **One skip owner.** Shared predicate in `planSourceLead` and
  `syncSourceLead`. Do not gate only `persistSheetSyncIntent`.
- **`no_sync` applies only to ordinary Forms and Calls.** Those are
  the only Master Leads tabs this pack may skip or delete. Duplicate
  Lead and Bad Lead sheet routing is untouched, even when the flag
  is stored.
- **Mark true deletes.** Empty skip is not enough. Delete Forms or
  Calls only — never “every Master Leads row.”
- **Master Booked still writes.** Mongo Lead ID stays on Booked Deals.
  Booking Chain must **not** upsert Forms or Calls for an ordinary
  No-Sync Lead. Do not gate only `persistSheetSyncIntent`.
- **Owner unmark is the only revival.** Other origins cannot mint
  `no_sync: true` from the client body.
- **Contains Not expected is the desk proof.** No leftover-row tab
  read. No post-mark full-tab sheet scan. Search is Find `q` plus
  the **Hidden from Master Leads** Status filter / column.
- **Hide / show is Actions-tab only**, with confirm and a success
  or failure message. Not on the row Actions cluster.
- **Contains skip ships with the planner.** Do not leave a window where
  contains says Missing.
- **CPL / analytics unchanged.**
- **Do not change** Bad dual-write, Call Duplicate stale-delete, Form
  leftover-Forms, scored `POST /form-leads/search`, or `identity.ts`.
  Do not delete Duplicates, Duplicate Calls, or Bad Leads.
- Ordinary checks use redacted synthetic data. Runtime reads require
  `TEST_MODE=true` and an explicit test database.
- No commit, push, deploy, production flag change, live payload read,
  or external send unless the user explicitly asks.
- After runtime TypeScript changes: `pnpm test` and `pnpm typecheck`
  in the repos you touched. After Admin UI changes, verify in the
  browser at **http://localhost:3000** ([`LOCAL-ADMIN.md`](LOCAL-ADMIN.md)).
  The local API is on **3001**.
- After ship, invoke **docs-keeper** so knowledge docs describe the
  code that actually landed (LNS-04 owns the sentences).

## What this pack deliberately does not do

- Lead-cost / CPL exclusion for No-Sync Leads.
- Booking Chain skipping Booked Deals, or upserting Forms/Calls
  because a No-Sync Lead matched.
- Moving Bad Leads off Forms, or deleting Duplicates / Duplicate
  Calls / Bad Leads as part of `no_sync`.
- Leftover-row contains verdict, post-mark full-tab sheet scan, or
  global-search badge.
- Setting `created_on_unmatched` on Manual create.
- Intake / Connect / employee submit changes.

## Verified current state

Observed at pack creation 2026-09-06. Each issue's §4 repeats the
subset it depends on. **Reverify before coding.**

- No `no_sync` field, filter, or UI.
- Only `created_on_unmatched` skips Master Leads. Empty plan does not
  delete leftover rows. Contains skipReason is that string only.
- Bad Form Lead dual-writes primary + Bad Leads. Call Duplicate upserts
  the new tab then deletes the stale opposite. Form Duplicate does not
  delete leftover Forms.
- Manual create POSTs `/api/v1/form-leads` or `/call-leads`. Origin
  `vantage_admin` is server-stamped. Both enqueue create Sheet Sync
  today.
- Desk tri-state Any / Yes / No exists for `booked` / `cancelled`.
- Owner PATCH command name is `updateSourceOwnedLead`.

## Layout

```text
docs/lead-no-sync/
├── lead-no-sync-specification.md   ← the contract
├── README.md                       ← you are here
├── AGENT-PROTOCOL.md
├── LOCAL-ADMIN.md
├── PROGRESS.md
├── issues/
│   ├── LNS-01.md
│   ├── LNS-02.md
│   ├── LNS-03.md
│   └── LNS-04.md
└── reports/                        ← one completion report per issue
```
