---
type: Completion Report
title: GLS-01 — Ingestion cleanup and Granot Lifecycle Health home
status: complete
closed: 2026-09-03
owners: [team:vantage-admin]
---

# GLS-01 completion

Repository: `vantage-admin` on current `main` (unrelated Extension/Manual work was already dirty; no new branch). No commit.

## File map

Created: `ingestion-copy.ts`, `granot-lifecycle-copy.ts`, `granot-lifecycle-subnav.tsx`, `app/(dashboard)/granot-lifecycle/{layout,page,health/page}.tsx`, `tests/ingestion-subnav.test.ts`.

Modified: ingestion subnav + Best Relocation dashboard, granot layout (nest removed), old lifecycle/health/jobs pages (redirects), Health page href + back link, dashboard nav/shell, observational Health link, `intakeJobHref`, job-timeline GranotNavigation removal, authorization + tests, `next.config.ts`, nav/lifecycle/intakes tests, project-organization rule.

Deleted: `components/granot-lifecycle/granot-navigation.tsx`.

## Nav before / after

- Ingestion: Best Relocation then Granot workflow → **Granot workflow then Best Relocation** (Deprecated badge + page warning). `/ingestion` still Best Relocation.
- System (Owner): Observational, Operations Registry, **Granot Lifecycle**, Ingestion, Extension, Audit Log. Admin has no Granot Lifecycle item.
- `/ingestion/granot` is HTTP Automation only (no inner tabs).

## Redirects

| From | To |
| --- | --- |
| `/ingestion/granot/lifecycle` | `/intakes` |
| `/ingestion/granot/lifecycle/health` (+ `/*`) | `/granot-lifecycle/health` |
| `/ingestion/granot/lifecycle/jobs/:jobNo` | `/job-timeline?job=:jobNo` |
| `/ingestion/granot/live` | `/live-events` (kept) |

Cases and discrepancies were not redirected.

## Auth

- Admin Health: `/granot-lifecycle/health` true; `/granot-lifecycle` and `/granot-lifecycle/receipts` false; `/ingestion/granot` false.
- Admin proxy GET `/api/v1/admin/granot-lifecycle/receipts` false; Health GET still true.
- Shell Health exception checked before the `/granot-lifecycle` Owner prefix.

## Commands

`pnpm test`: 457 pass. `pnpm typecheck`: pass. `pnpm lint`: fails on pre-existing unrelated dirty files (Manual / operational / search). GLS-01 files are clean.

## Left for GLS-03

Receipts tab, default `/granot-lifecycle` → Receipts, search UI, `GRANOT_LIFECYCLE_RECEIPTS_HREF`. Health stays the other tab.

## Extra Owner ask

Best Relocation tab shows a Deprecated badge. Best Relocation page shows `INGESTION_COPY.bestRelocationDeprecatedStatement`. Apply/inspect remain enabled.
