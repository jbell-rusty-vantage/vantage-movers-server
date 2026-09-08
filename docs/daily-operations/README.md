---
type: Delivery Pack
title: Daily Operations — Owner business-day board
description: >-
  Navigation and status ledger for Daily Operations: Mongo day
  projection, after-commit facts, Redis doorbell, SSE, the Owner
  /daily category-panel board, and the complementary Arrivals strip.
tags:
  - daily-operations
  - owner-dashboard
  - admin-dashboard
  - delivery
status: complete
stale_after: 2026-12-06
owners: [team:main-server, team:vantage-admin]
applies_to:
  - vantage-main-server/src/services/dailyOperations/**
  - vantage-main-server/src/models/DailyOperationsEvent.ts
  - vantage-main-server/src/models/DailyOperationsDay.ts
  - vantage-main-server/src/config/domain/dailyOperations.ts
  - vantage-main-server/src/routes/daily-operations-admin.routes.ts
  - vantage-main-server/src/routes/daily-operations-cron.routes.ts
  - vantage-admin/app/(dashboard)/daily/**
  - vantage-admin/components/daily/**
  - vantage-admin/components/daily/arrivals-stream.tsx
  - vantage-admin/lib/api/dailyOperations.ts
  - vantage-admin/lib/api/dailyOperationsLive.ts
  - vantage-admin/lib/api/dailyOperationsBoard.ts
  - vantage-admin/app/api/daily-operations-live/route.ts
  - vantage-admin/server/auth/authorization.ts
---

# Daily Operations

Ten shippable issues (DOP-01–10 shipped). Arrivals is on `/daily` as a live rail.
This pack follows
`docs/lead-costs-owner-editing/` and `docs/operational-surfaces/`:
same fourteen-section issue contract, same rule that **repository state
is authoritative and this ledger is a navigation aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue →
record the result in [`PROGRESS.md`](PROGRESS.md).

**Contract:** [`daily-operations-specification.md`](daily-operations-specification.md)
wins on every conflict.

This pack does **not** replace Live Events, Overview, Analytics, or
Intakes. It does not implement the 2026-08-19 Owner Daily Operations
View (24h/48h tabs, conversations, deposit). Arrivals is on `/daily`
as the complementary newest-20 live rail (not a Daily Operations Panel).
Not Daily View. Not Live Events.

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`daily-operations-specification.md`](daily-operations-specification.md) — **wins on every conflict** |
| 2 | Workspace-root `CONTEXT.md` — [Daily Operations](../../../CONTEXT.md), [Daily Operations Event](../../../CONTEXT.md), [Daily Operations Panel](../../../CONTEXT.md), [Arrivals](../../../CONTEXT.md) |
| 3 | [`0001-mongodb-system-of-record.md`](../../../docs/adr/0001-mongodb-system-of-record.md) |
| 4 | Current hook-point code named in the spec — the seams each issue extends |
| 5 | This pack’s issues — sequencing and scope only |

Background only (do not implement from these):

- [`daily-operations-pre-specification.md`](daily-operations-pre-specification.md) — superseded
- [`daily-operations-workspace.md`](daily-operations-workspace.md) — orientation memo
- [`../granot-lead-lifecycle/owner-daily-operations-view-specification.md`](../granot-lead-lifecycle/owner-daily-operations-view-specification.md)

Where this pack and the specification disagree, the specification
wins and the issue author fixes this pack in the same change.

## Session map

| Session | Issue | Repos | Why this size |
| --- | --- | --- | --- |
| **1** | [DOP-01](issues/DOP-01.md) | vantage-main-server | Models + writer + Redis client. Nothing else can increment. |
| **2** | [DOP-02](issues/DOP-02.md) | vantage-main-server | Form / Call / Booking / Cancellation / Lead Message hooks, including deferred texts and zip miss. |
| **3** | [DOP-03](issues/DOP-03.md) | vantage-main-server | Granot capture / decision / intake. Separate so Lead hooks stay reviewable. |
| **4** | [DOP-04](issues/DOP-04.md) | vantage-main-server | Snapshot GET, events page, rebuild, close cron. Admin cannot paint without this. |
| **5** | [DOP-05](issues/DOP-05.md) | vantage-main-server | SSE + Redis doorbell. Copy Live Events isolate. |
| **6** | [DOP-06](issues/DOP-06.md) | vantage-admin | Chrome, auth, BFF, headline, origins, companies, pace. |
| **7** | [DOP-07](issues/DOP-07.md) | vantage-admin | Category panels, cards, links, Quiet priorities. The Owner board. |
| **8** | [DOP-08](issues/DOP-08.md) | both (proof + docs) | Browser walk and pointers. |
| **9** | [DOP-09](issues/DOP-09.md) | vantage-admin | Complementary Arrivals strip on `/daily`. |
| **10** | [DOP-10](issues/DOP-10.md) | both (snapshot + board) | Owner-requested live workspace: focus expands in place, trend % vs yesterday / day before, full-fact cards, kind colours, Live Events polish. |

DOP-01–10 shipped. Pack reopened 2026-09-08 for the Arrivals append
(DOP-09) and again the same day for the Owner's live-workspace review
(DOP-10); closed after DOP-10. Do not start leftover pack work. Agents
may use 21st.dev on DOP-06, DOP-07, DOP-09, and DOP-10 against the
named craft targets only.

## Unit ledger

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [DOP-01](issues/DOP-01.md) | Models, writer, Redis client | current server | complete | complete |
| [DOP-02](issues/DOP-02.md) | Domain hooks | DOP-01 | complete | complete |
| [DOP-03](issues/DOP-03.md) | Granot hooks | DOP-01 | complete | complete |
| [DOP-04](issues/DOP-04.md) | Snapshot, events, rebuild, close | DOP-01 | complete | complete |
| [DOP-05](issues/DOP-05.md) | SSE live + Redis doorbell | DOP-01, DOP-04 | complete | complete |
| [DOP-06](issues/DOP-06.md) | Admin chrome, tiles, mix, pace | DOP-04, DOP-05 | complete | complete |
| [DOP-07](issues/DOP-07.md) | Category panels, cards, links | DOP-06 | complete | complete |
| [DOP-08](issues/DOP-08.md) | Browser proof and docs | DOP-02, DOP-03, DOP-07 | complete | complete |
| [DOP-09](issues/DOP-09.md) | Arrivals band on /daily | DOP-07 | complete | complete |
| [DOP-10](issues/DOP-10.md) | Live workspace: focus without loss, trend %, full cards, kind colours | DOP-09 | complete | complete |

DOP-02 and DOP-03 may run in parallel after DOP-01. DOP-04 may start
after DOP-01 (snapshot can return zeros until hooks land). DOP-06
waits for DOP-04 and DOP-05 so the page has a real snapshot and a live
pipe. DOP-09 waits for DOP-07 so cards, Quiet priorities, and the
single EventSource already exist. DOP-10 waits for DOP-09 so it
reorganises a board that already has Arrivals.

## Ready queue

Empty. Pack issues DOP-01–10 are `complete`.

## Standing constraints for every issue

- **Glossary words.** Daily Operations, Daily Operations Event, Daily
  Operations Panel, Arrivals, Lead, Form Lead, Call Lead, Duplicate Lead,
  Unmatched Call Lead, Ingestion Origin, Source Company, Lead Message,
  Granot Observation Receipt, Granot Booking Reconciliation Case,
  Booking, Cancellation, Job Number. Do not say Daily View, Owner Daily,
  ODR, SMS (except when naming Twilio), partner, webhook event
  (unqualified).
- **After-commit only.** Never inside `operation()` / `withTransaction`.
  Never Granot 202 for Lead / Booking / Decision counts.
- **Mongo is the book.** Redis is a doorbell. Do not `INCR` Redis as
  the Owner-visible total.
- **No mutations** from Daily Operations reads.
- **Quiet hours** are midnight–6:59 AM Eastern, send-at 8:00 AM, via
  Twilio scheduling. Cards render the resolved `send_at`.
- **Zip miss** is an Exception and a Lead-card chip. The Lead still
  counts.
- Ordinary checks use redacted synthetic data. Do not paste seed
  passwords.
- No commit, push, deploy, production flag change, or live payload
  read unless the user explicitly asks.
- After server changes: focused tests + typecheck in
  `vantage-main-server`.
- After Admin UI changes: `pnpm test`, `pnpm typecheck`, and
  `pnpm lint` in `vantage-admin`. Verify in the browser at
  **http://localhost:3000** ([`LOCAL-ADMIN.md`](LOCAL-ADMIN.md)). The
  local API is on **3001**.
- After ship, invoke **docs-keeper** so the admin map and knowledge
  pointer describe the code that actually landed.

## What this pack deliberately does not do

- Lead cost / binder / deposit
- Lead Conversations on this board
- Replacing Live Events or Overview
- TCP Redis subscribe
- Confirm Granot Booking on `/daily`
- The 2026-08-19 24h/48h tabbed Daily View

## Layout

```text
docs/daily-operations/
├── daily-operations-specification.md   ← the contract
├── daily-operations-pre-specification.md
├── daily-operations-workspace.md
├── README.md                           ← you are here
├── AGENT-PROTOCOL.md
├── LOCAL-ADMIN.md
├── PROGRESS.md
├── issues/
│   ├── DOP-01.md … DOP-10.md
└── reports/
```
