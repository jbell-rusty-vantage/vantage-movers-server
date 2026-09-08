---
type: Delivery Pack
title: Granot Lifecycle surfaces — delivery index and session ledger
description: >-
  Navigation and status ledger for three issues that clean Ingestion,
  move Granot lifecycle Health to a System tab, and add searchable
  Granot Observation Receipts for the webhook channel.
tags:
  - granot-lifecycle
  - owner-dashboard
  - admin-dashboard
  - ingestion
  - delivery
status: ready
stale_after: 2026-12-01
owners: [team:main-server, team:vantage-admin]
applies_to:
  - vantage-admin/components/layout/dashboard-nav.tsx
  - vantage-admin/components/ingestion/**
  - vantage-admin/components/granot-lifecycle/**
  - vantage-admin/app/(dashboard)/ingestion/**
  - vantage-admin/app/(dashboard)/granot-lifecycle/**
  - src/services/granotLifecycle/**
  - src/routes/granot-lifecycle-admin.routes.ts
---

# Granot Lifecycle surfaces — delivery pack

Three shippable issues. This pack follows the conventions of
`docs/job-number-timeline/` and `docs/booking-intake-lead-attachment/`:
same fourteen-section issue contract, same rule that **repository state
is authoritative and this ledger is a navigation aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue → record
the result in [`PROGRESS.md`](PROGRESS.md).

This pack does **not** start Owner Daily, fold Job Timeline into Granot
Lifecycle, or change Live Events SSE / Intakes commands / HTTP
Automation apply.

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`granot-lifecycle-surfaces-specification.md`](granot-lifecycle-surfaces-specification.md) — **wins on every conflict except the historical list DTO** |
| 2 | Current repository code — the actual seam each issue extends |
| 3 | [`../knowledge/granot-lifecycle/live-receipts.md`](../knowledge/granot-lifecycle/live-receipts.md) — live SSE **and** the current Owner list GET (unmasked contact + credential-redacted `granot_statement`; supersedes pack spec §6) |
| 4 | [`../knowledge/granot-lifecycle/observability.md`](../knowledge/granot-lifecycle/observability.md) — Health GET (URL moves, projection does not) |
| 5 | Workspace-root `CONTEXT.md` and `vantage-admin/.cursor/rules/project-organization.mdc` |
| 6 | This pack's issues — sequencing and scope only, never new semantics |

Where this pack and the specification disagree, the specification wins and
the issue author fixes this pack in the same change.

## Session map

| Session | Issue | Repos | Why this size |
| --- | --- | --- | --- |
| **1** | [GLS-01](issues/GLS-01.md) | vantage-admin | IA first. Health must have a home before Receipts. |
| **1 (parallel)** | [GLS-02](issues/GLS-02.md) | vantage-main-server | Search API has no Admin dependency. |
| **2** | [GLS-03](issues/GLS-03.md) | vantage-admin | UI consumes the API and the new tab chrome. |

GLS-01 and GLS-02 may start together in different repos. Do not start
GLS-03 before both are `complete`.

## Unit ledger

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [GLS-01](issues/GLS-01.md) | Ingestion cleanup and Granot Lifecycle Health home | current nav | complete | complete |
| [GLS-02](issues/GLS-02.md) | Owner webhook receipt search API | current receipts | complete | complete |
| [GLS-03](issues/GLS-03.md) | Receipts tab on Granot Lifecycle | GLS-01, GLS-02 | complete | complete |

## Ready queue

- **Pack complete.** GLS-01, GLS-02, and GLS-03 are `complete`.

## Standing constraints for every issue

These apply to all issues and are not repeated as scope in each one.

- **Glossary words.** [Granot Observation Receipt](../../../CONTEXT.md),
  [Granot Observation](../../../CONTEXT.md),
  [Granot Booking Action](../../../CONTEXT.md),
  [Observation Channel](../../../CONTEXT.md),
  [Synchronization Decision](../../../CONTEXT.md),
  [Source Company](../../../CONTEXT.md),
  [Granot CRM Source](../../../CONTEXT.md).
  A receipt is not a Lead. A case is not a Booking. Live Events is not
  historical search.
- **Owner-facing labels only.** Receipts, Health, Lead created, Priority
  updated, Booking status changed, Booked, Release. Never print
  `route_event_class`, `booking_action`, or `granot_webhook_receipts`
  in UI.
- **Job Timeline stays `/job-timeline`.** Deep-link with
  `buildJobTimelineHref`. Do not nest it under Granot Lifecycle.
- **Health is not Operations Registry and not an Observational tab.**
- **Do not change** capture, normalize, processor, Intakes commands,
  Live Events SSE, Job Timeline evaluation, or HTTP Automation apply.
- Owner-visible strings live in a copy module. Do not inline Owner
  sentences in JSX.
- Ordinary checks use redacted synthetic data. Runtime reads require
  `TEST_MODE=true` and an explicit test database.
- No commit, push, deploy, production flag change, live payload read, or
  external send unless the user explicitly asks.
- After runtime TypeScript changes: `pnpm test` and `pnpm typecheck` in
  the repos you touched. After Admin UI changes, verify in the browser
  at **http://localhost:3000** ([`LOCAL-ADMIN.md`](LOCAL-ADMIN.md)). The
  local API is on **3001**.
- After ship, invoke **docs-keeper** so knowledge docs and the Admin map
  describe the code that actually landed.

## What this pack deliberately does not do

- Owner Daily View (`/daily`).
- Renaming the Ingestion subtab to HTTP Automation.
- Redirecting `/ingestion/granot/lifecycle/cases/:id` → `/intakes`.
- A discrepancies tab.
- Cancellation intakes.
- Searching extension or HTTP-automation receipts.
- Receipt writes. The original “no payload drawer / no unmasking” pack
  constraint is **superseded** for the Owner list GET — see
  [`../knowledge/granot-lifecycle/live-receipts.md`](../knowledge/granot-lifecycle/live-receipts.md).
- Atlas Search.

## Verified current state

Observed at pack creation 2026-09-01. **Reverify before coding.**

- Ingestion subnav is Best Relocation (`/ingestion`) then Granot
  workflow (`/ingestion/granot`). Default `/ingestion` page is Best
  Relocation.
- `GranotNavigation` tabs: Automation, Lifecycle, Intakes, Job
  timeline, Health. Intakes and Job Timeline are also sidebar items.
- Lifecycle page is a second Booking/Release case queue
  (`LifecycleDashboard`). Intakes is the Owner workbench on the same
  cases.
- Health lives at `/ingestion/granot/lifecycle/health`. Observational
  overview links there. Admin may open Health; other `/ingestion/granot`
  pages are Owner-only.
- `/ingestion/granot/lifecycle/jobs/[jobNo]` renders
  `GranotJobTimelinePage`. Intakes `intake-copy.ts` deep-links there.
  Owner Job Timeline is `/job-timeline?job=` (`buildJobTimelineHref`).
- Live Events is `/live-events` (SSE, ~30 minutes). No historical
  receipt list API exists — only
  `GET /api/v1/admin/granot-lifecycle/receipts/live`.
- Receipts collection is `granot_webhook_receipts`. Webhook rows require
  `route_event_class`. Observation is 1:1 on `receipt_id`. Booking Action
  is `booked` | `release` on the Observation, not a second route class.
- Operations Registry tabs: overview, agents, merchants, sources,
  granot-sources, ringcentral, cpl, changes. Observational tabs:
  overview, events, incidents, reports, notifications, sheet-sync.

## Layout

```text
docs/granot-lifecycle-surfaces/
├── granot-lifecycle-surfaces-specification.md   ← the contract
├── README.md                                    ← you are here
├── AGENT-PROTOCOL.md
├── LOCAL-ADMIN.md
├── PROGRESS.md
├── issues/
│   ├── GLS-01.md
│   ├── GLS-02.md
│   └── GLS-03.md
└── reports/                                     ← one completion report per issue
```
