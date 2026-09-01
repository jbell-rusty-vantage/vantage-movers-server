---
type: Delivery Pack
title: Operational surfaces — delivery index and session ledger
description: >-
  Navigation and status ledger for five issues that extract the shared
  Admin operational shell, tab the detail panel, cluster row actions,
  and group filters. Admin presentation only.
tags:
  - admin-dashboard
  - form-lead
  - call-lead
  - booking
  - cancellation
  - delivery
status: ready
stale_after: 2026-12-01
owners: [team:vantage-admin]
applies_to:
  - vantage-admin/components/operational/**
  - vantage-admin/components/ui/side-panel.tsx
  - vantage-admin/components/data-table/table-shell.tsx
  - vantage-admin/lib/api/url-state.ts
---

# Operational surfaces — delivery pack

Five shippable issues. This pack follows the conventions of
`docs/job-number-timeline/` and `docs/booking-intake-lead-attachment/`:
same fourteen-section issue contract, same rule that **repository state
is authoritative and this ledger is a navigation aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue → record
the result in [`PROGRESS.md`](PROGRESS.md).

This pack does **not** start Owner Daily, change main-server invariants,
or rewrite Search / Intakes / Observational.

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`operational-surfaces-specification.md`](operational-surfaces-specification.md) — **wins on every conflict** |
| 2 | Current `vantage-admin` code — the actual seam each issue extends |
| 3 | [`docs/form-lead-contact-snapshots-display-and-search-specification.md`](../form-lead-contact-snapshots-display-and-search-specification.md) — Form submitted vs Granot (shipped) |
| 4 | [`docs/booking-intake-lead-attachment/README.md`](../booking-intake-lead-attachment/README.md) — Connect Booking to Lead on `/bookings` (shipped) |
| 5 | Workspace-root `CONTEXT.md` and `vantage-admin/.cursor/rules/project-organization.mdc` |
| 6 | This pack's issues — sequencing and scope only, never new semantics |

Where this pack and the specification disagree, the specification wins and
the issue author fixes this pack in the same change.

## Session map

| Session | Issue | Repos | Why this size |
| --- | --- | --- | --- |
| **1** | [OSE-01](issues/OSE-01.md) | vantage-admin | Extract only. Highest risk if mixed with new UI. |
| **2** | [OSE-02](issues/OSE-02.md) | vantage-admin | Tabbed panel. The confirmed Owner request. |
| **3** | [OSE-03](issues/OSE-03.md) | vantage-admin | Rows: identity, chips, action cluster. |
| **4** | [OSE-04](issues/OSE-04.md) | vantage-admin | Grouped filter sidebar. |
| **5** | [OSE-05](issues/OSE-05.md) | vantage-admin | All eight routes, historical, deep links. |

Do not start OSE-02 before OSE-01 is `complete`. Do not parallelize
OSE-02–04; they share the extracted modules. Agents may use 21st.dev on
OSE-02, OSE-03, and OSE-04 against the named craft targets only.

## Unit ledger

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [OSE-01](issues/OSE-01.md) | Extract operational configs, filters, detail, and actions | current shell | ready | complete |
| [OSE-02](issues/OSE-02.md) | Tabbed detail panel; remove JSON dumps | OSE-01 | blocked | complete |
| [OSE-03](issues/OSE-03.md) | Row identity, status chips, Actions cluster | OSE-01, OSE-02 | blocked | complete |
| [OSE-04](issues/OSE-04.md) | Grouped filter sidebar | OSE-01, OSE-03 | blocked | complete |
| [OSE-05](issues/OSE-05.md) | Cross-route browser proof | OSE-02, OSE-03, OSE-04 | blocked | complete |

## Ready queue

- **OSE-01 is the only startable issue.**

## Standing constraints for every issue

These apply to all issues and are not repeated as scope in each one.

- **Glossary words.** [Form Lead](../../../CONTEXT.md),
  [Call Lead](../../../CONTEXT.md), [Booking](../../../CONTEXT.md),
  [Cancellation](../../../CONTEXT.md), [Bad Lead](../../../CONTEXT.md),
  [Lead Message](../../../CONTEXT.md), [Source Company](../../../CONTEXT.md),
  [Leadless Booking](../../../CONTEXT.md),
  [Connect Booking to Lead](../../../CONTEXT.md).
  Bad Call is planned — do not implement it. Sheet Sync is not
  Google-equals-Mongo.
- **Owner-facing labels only.** Tab names from spec §6.1. Never print
  `sms_message`, `lead_ref`, `source_granularity_key`, or “text message”
  as a tab.
- **One shell.** `OperationalResourcePage({ resource })` stays the page
  interface. Do not fork list pages.
- **No main-server changes.** No new endpoints, DTOs, or indexes.
- **Do not change** Form submitted vs Granot rules, Connect Booking to
  Lead, scored search, Intakes, Daily View, or `/bookings/reconciliation`.
- **No Sync button. No ConversationPanel embed. No Daily View tabs.**
- Owner-visible strings live in `operational-copy.ts`.
- 21st.dev may craft the four named shells (spec §9). It must not
  replace the page architecture.
- Ordinary checks use redacted synthetic data. Do not paste seed
  passwords.
- No commit, push, deploy, production flag change, or live payload read
  unless the user explicitly asks.
- After Admin UI changes: `pnpm test`, `pnpm typecheck`, and `pnpm lint`
  in `vantage-admin`. Verify in the browser at
  **http://localhost:3000** ([`LOCAL-ADMIN.md`](LOCAL-ADMIN.md)). The
  local API is on **3001**.
- After ship, invoke **docs-keeper** so the admin map and CONTEXT
  pointer describe the code that actually landed.

## What this pack deliberately does not do

- Owner Daily View (`/daily`) or its Details / Provenance / Conversation
  drawer.
- Embedding Lead Conversations on Call Leads.
- Search, Intakes, Observational, Audit Log rewrites.
- Main-server invariant or API changes.
- Bad Call, Sync button, new filter keys, in-panel Book / Cancel forms.

## Verified current state

Observed at pack creation 2026-09-01. **Reverify before coding.**

- Eight routes are three-line wrappers around
  `vantage-admin/components/operational/operational-resource-page.tsx`
  (~2,600 lines). No `OperationalRow` component. Rows are `DataTable`
  cells from `ColumnConfig` plus prepended `__book` / `__mark_bad` /
  `__cancel` / `__delete` / `__related` columns.
- Detail is `DetailPanel` inside that file: Summary → (Stored lead) →
  (Contacts + SMS) → Source Metadata → Linked Context → Related →
  Workflow Actions → Edit Production Record → Delete → Raw Identifiers
  JSON. SMS also dumps `JSON.stringify(smsMessage)`.
- No tabs. URL: `?record=` and Bookings `?connect=1`.
  `apiFiltersFromUrlState` strips `record` and `connect` only.
- Filters are a sticky sidebar (`OperationalFilterPanel`) with every
  field in one list. `FilterBar` is unused here.
- Duplicate read-only banner always says “Duplicate form leads”.
- Form submitted vs Granot and Connect Booking to Lead are shipped
  helpers. Leave their meaning alone.

## Layout

```text
docs/operational-surfaces/
├── operational-surfaces-specification.md   ← the contract
├── README.md                               ← you are here
├── AGENT-PROTOCOL.md
├── LOCAL-ADMIN.md
├── PROGRESS.md
├── issues/
│   ├── OSE-01.md
│   ├── OSE-02.md
│   ├── OSE-03.md
│   ├── OSE-04.md
│   └── OSE-05.md
└── reports/                                ← one completion report per issue
```
