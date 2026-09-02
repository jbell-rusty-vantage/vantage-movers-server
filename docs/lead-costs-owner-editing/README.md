---
type: Delivery Pack
title: Operations Registry Lead Costs — Owner date-range editing
description: >-
  Navigation and status ledger for five issues that add set_range and
  make the Lead Costs Advanced desk a From / Through / Amount form.
tags:
  - operations-registry
  - cpl
  - admin-dashboard
  - delivery
status: ready
stale_after: 2026-12-02
owners: [team:main-server, team:vantage-admin]
applies_to:
  - vantage-main-server/src/services/operationsRegistry/cplSchedule.ts
  - vantage-admin/components/operations-registry/cpl-manager.tsx
---

# Lead Costs — Owner date-range editing

Five shippable issues. This pack follows
`docs/booking-intake-lead-attachment/` and
`docs/operational-surfaces/`: same fourteen-section issue contract,
same rule that **repository state is authoritative and this ledger is
a navigation aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue →
record the result in [`PROGRESS.md`](PROGRESS.md).

This pack does **not** rewrite stamped Lead CPL on schedule save,
change Simple’s construction, change CPL Correction worker rules, or
touch Legacy CPL.

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`lead-costs-owner-editing-specification.md`](lead-costs-owner-editing-specification.md) — **wins on every conflict** |
| 2 | [`.cursor/rules/cpl-operations.mdc`](../../.cursor/rules/cpl-operations.mdc) — continuity, exclusive storage, schedule-never-rewrites-Leads |
| 3 | Current `cplSchedule.ts` / `cpl-manager.tsx` — the seams each issue extends |
| 4 | Workspace-root `CONTEXT.md` and the Owner language deck |
| 5 | This pack’s issues — sequencing and scope only |

Where this pack and the specification disagree, the specification
wins and the issue author fixes this pack in the same change.

## Session map

| Session | Issue | Repos | Why this size |
| --- | --- | --- | --- |
| **1** | [LCE-01](issues/LCE-01.md) | vantage-main-server | `set_range` construction. Admin cannot ship the default form without it. |
| **2** | [LCE-02](issues/LCE-02.md) | vantage-admin | By date default form + timeline without IDs. The confirmed Owner request. |
| **3** | [LCE-03](issues/LCE-03.md) | vantage-admin | Current rates / Existing leads copy, language, URL, handoff. |
| **4** | [LCE-04](issues/LCE-04.md) | vantage-admin | Structured rebuild. JSON textarea dies here. |
| **5** | [LCE-05](issues/LCE-05.md) | both (proof + docs) | Browser walk and pointers. |

Do not start LCE-02 before LCE-01 is `complete`. Do not parallelize
LCE-02–04; they share `cpl-manager.tsx`. Agents may use 21st.dev on
LCE-02 and LCE-04 against the named craft targets only.

## Unit ledger

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [LCE-01](issues/LCE-01.md) | Server `set_range` | current schedule module | ready | complete |
| [LCE-02](issues/LCE-02.md) | By date default form | LCE-01 | blocked | complete |
| [LCE-03](issues/LCE-03.md) | Copy, language, URL, handoff | LCE-02 | blocked | complete |
| [LCE-04](issues/LCE-04.md) | Structured rebuild; no JSON | LCE-02 | blocked | complete |
| [LCE-05](issues/LCE-05.md) | Browser proof and docs | LCE-02, LCE-03, LCE-04 | blocked | complete |

## Ready queue

- **LCE-01 is the only startable issue.**

## Standing constraints for every issue

- **Glossary words.** [CPL](../../../CONTEXT.md),
  [CPL Schedule](../../../CONTEXT.md),
  [CPL Rate Period](../../../CONTEXT.md),
  [CPL Correction](../../../CONTEXT.md),
  [Source Company](../../../CONTEXT.md),
  [Source Granularity](../../../CONTEXT.md).
  Owner-facing: Lead cost, Feed, Lead source, Current rates, By date,
  Existing leads.
- **Schedule edits never rewrite Leads.** Existing leads is the only
  backfill.
- **Do not remove** `add_future`, `split`, `correct_period`, or
  `replace_schedule` from the API.
- **Do not change** Simple construction, correction caps/leases, or
  Legacy CPL.
- Owner-visible Lead Costs strings that you touch go in a dedicated
  copy module if you extract one; otherwise keep them in `cpl-manager`
  and still pass the language deck.
- 21st.dev may craft the named shells (spec §6). It must not invent
  a second schedule API.
- Ordinary checks use redacted synthetic data. Do not paste seed
  passwords.
- No commit, push, deploy, production flag change, or live payload
  read unless the user explicitly asks.
- After server changes: `pnpm test` / the package’s CPL schedule
  tests, plus typecheck, in `vantage-main-server`.
- After Admin UI changes: `pnpm test`, `pnpm typecheck`, and
  `pnpm lint` in `vantage-admin`. Verify in the browser at
  **http://localhost:3000** ([`LOCAL-ADMIN.md`](LOCAL-ADMIN.md)). The
  local API is on **3001**.
- After ship, invoke **docs-keeper** so the admin map and knowledge
  pointer describe the code that actually landed.

## What this pack deliberately does not do

- Auto-start a CPL Correction job from a schedule save.
- Company-wide By date overlay.
- Analytics / sheet spend rewrites.
- Owner Daily View.
- Teaching exclusive ends or revision numbers to the Owner.

## Verified current state

Observed at pack creation 2026-09-02. **Reverify before coding.**

- Advanced default command is `add_future`. Four named operations in
  a `<select>`. `correct_period` / `split` require a pasted Period ID.
  `replace_schedule` is a JSON textarea.
- No `set_range` in `AdvancedCplOperation` or
  `advancedCplScheduleCommandSchema`.
- Mode tabs: Simple / Advanced / Corrections. Click does not write
  `cpl_mode`. Default `cpl_mode` is `simple`.
- Period lists show `ID: {objectId}`.
- Banner and Corrections copy name `correct_period`.
- Lead-source readiness opens `?tab=lead-costs` with no Feed
  preselect.

## Layout

```text
docs/lead-costs-owner-editing/
├── lead-costs-owner-editing-specification.md   ← the contract
├── README.md                                   ← you are here
├── AGENT-PROTOCOL.md
├── LOCAL-ADMIN.md
├── PROGRESS.md
├── issues/
│   ├── LCE-01.md
│   ├── LCE-02.md
│   ├── LCE-03.md
│   ├── LCE-04.md
│   └── LCE-05.md
└── reports/                                    ← one completion report per issue
```
