---
type: Service
title: Daily Operations
description: Pointer to the Owner Daily Operations contract. Category panels plus complementary Arrivals on /daily. Not Daily View. Not Live Events. Not a second specification.
tags: [daily-operations, owner-dashboard, admin-dashboard]
status: draft
stale_after: 2026-12-08
resource: src/services/dailyOperations/recordDailyOperationsFact.ts
applies_to:
  - src/services/dailyOperations/**
  - src/models/DailyOperationsEvent.ts
  - src/models/DailyOperationsDay.ts
  - src/config/domain/dailyOperations.ts
  - src/routes/daily-operations-admin.routes.ts
  - src/routes/daily-operations-cron.routes.ts
  - vantage-admin/app/(dashboard)/daily/**
  - vantage-admin/components/daily/**
  - vantage-admin/components/daily/arrivals-stream.tsx
  - vantage-admin/lib/api/dailyOperations.ts
  - vantage-admin/lib/api/dailyOperationsLive.ts
  - vantage-admin/lib/api/dailyOperationsBoard.ts
  - vantage-admin/app/api/daily-operations-live/route.ts
  - vantage-admin/server/auth/authorization.ts
owners: [team:main-server, team:vantage-admin]
sources:
  - id: spec
    resource: docs/daily-operations/daily-operations-specification.md
    title: Daily Operations specification
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:docs-keeper
  at: 2026-09-08T17:09:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [`daily-operations-specification.md`](../../daily-operations/daily-operations-specification.md) — **working contract; wins on every conflict.**  
**Pack:** [`daily-operations/README.md`](../../daily-operations/README.md)  
**Admin map:** [`vantage-admin/.cursor/rules/project-organization.mdc`](../../../../vantage-admin/.cursor/rules/project-organization.mdc)  
**Domain terms used:** [Daily Operations](../../../../CONTEXT.md), [Daily Operations Event](../../../../CONTEXT.md), [Daily Operations Panel](../../../../CONTEXT.md), [Arrivals](../../../../CONTEXT.md), [Lead Message](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md)

# Daily Operations

This file is a **Service pointer** only. It does not copy contract rules, hook tables, or wire shapes.

- [Daily Operations specification](../../daily-operations/daily-operations-specification.md) — Owner category panels plus complementary Arrivals on `/daily`. Mongo day projection, after-commit facts, Redis doorbell, SSE. **Wins.**
- [Pack README](../../daily-operations/README.md) — DOP-01–08 shipped. Arrivals is on `/daily`. Pointers only; not a second spec.
- [Pre-specification](../../daily-operations/daily-operations-pre-specification.md) — superseded one mixed feed. Do not implement from it.
- [2026-08-19 tabbed layout](../../granot-lead-lifecycle/owner-daily-operations-view-specification.md) — not this board. Do not implement 24h/48h tabs, conversations, or deposit here.

**Shipped:** Owner-only `/daily` after Overview. Category panels plus complementary Arrivals. Confirm stays on `/intakes`, not `/daily`. Admin is 403. Reads do not mutate. Mongo is the book; Redis is a doorbell only. Not Daily View. Not Live Events.

**Primary code (server):** `src/services/dailyOperations/**`, `src/models/DailyOperationsEvent.ts`, `src/models/DailyOperationsDay.ts`, `src/config/domain/dailyOperations.ts`, `src/routes/daily-operations-admin.routes.ts`, `src/routes/daily-operations-cron.routes.ts`.

**Primary code (admin):** `app/(dashboard)/daily/**`, `components/daily/**` (`arrivals-stream.tsx` is the complementary Arrivals strip, not a Daily Operations Panel), `lib/api/dailyOperations.ts`, `lib/api/dailyOperationsLive.ts`, `lib/api/dailyOperationsBoard.ts` (`eventsForDailyOperationsArrivals`), `app/api/daily-operations-live/route.ts`. Owner BFF/proxy gates live in `server/auth/authorization.ts` (`/daily` and `/api/v1/admin/daily-operations`). Hydration events fetch is all-lanes so a remount on `?lane=` cannot empty Arrivals.

**Known gap (record only — do not “fix” on `granot.minted`):** `createLeadFromGranot` writes the Lead directly and never calls `completeFormLeadIngestion` / `completeCallLeadIngestion`. `granot.minted` correctly omits `leads.*`, so Granot-minted Lead volume is not incremented on the live board. Do **not** add a Lead increment on `granot.minted`. This is a gap versus spec §23 narrative (“Twenty minted from Granot lead_created”), not a DOP-08 feature.
