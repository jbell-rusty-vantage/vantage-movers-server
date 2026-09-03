---
type: Completion Report
title: GLS-03 — Receipts tab on Granot Lifecycle
status: complete
closed: 2026-09-03
owners: [team:vantage-admin]
---

# GLS-03 completion

Repository: `vantage-admin` on current `main`. No commit. Server runtime unchanged.

## Files

Added: `app/(dashboard)/granot-lifecycle/receipts/page.tsx`, `components/granot-lifecycle/receipt-search.tsx`, `tests/granot-lifecycle-receipts.test.ts`.

Modified: Granot Lifecycle index (Receipts), copy, subnav, `lib/api/granotLifecycle.ts`, `queryKeys.granotLifecycle.receipts`, related tests, Admin map pointers.

## Filter query params

`ref_no`, `job_no`, `name`, `phone`, `email`, `source_company_id`, `route_event_class`, `booking_action`, `captured_from`, `captured_to`, `processing_state`, `cursor`, `limit`.

Source Company is the reviewed catalog. Booked / Release shows when event type is unset or Booking status changed.

## Auth / proxy

Admin: `/granot-lifecycle` and `/granot-lifecycle/receipts` denied; `/granot-lifecycle/health` allowed. Admin GET list proxy denied. Sidebar href stays `/granot-lifecycle`. `pageTitleForPath` stays Granot Lifecycle.

## Commands

`pnpm test`: 466 pass. `pnpm typecheck`: pass.

## Live Events and Health

Live Events unchanged. Health remains at `/granot-lifecycle/health`.

## Browser

Verified locally at http://localhost:3000 as Owner (local seed). No live customer contact pasted.

- Ingestion subnav: Granot workflow, then Best Relocation + Deprecated badge. Banner: “Best Relocation sheet ingest is deprecated. Use Granot workflow for new ingestion.”
- System: Observational → Operations Registry → Granot Lifecycle → Ingestion → Extension → Audit Log.
- `/ingestion/granot` is HTTP Automation only (no inner nest).
- `/granot-lifecycle` defaults to Receipts. Filter URL `?route_event_class=lead_created` hides Booked/Release. Health tab exclusive.
- `/granot-lifecycle/health` still renders Health. Observational “Granot lifecycle health” → `/granot-lifecycle/health`.
- Redirects: `/ingestion/granot/lifecycle` → `/intakes`; old Health → `/granot-lifecycle/health`; `/ingestion/granot/lifecycle/jobs/SYNTHETIC-JOB` → `/job-timeline?job=SYNTHETIC-JOB`.
- Live Events still at `/live-events`.
- Receipts list did not load rows: Admin `.env` proxies to the deployed API, which does not yet have `GET .../receipts`. Local `:3001` was not running. UI error is the proxy 404, not a client contract miss.

## Docs-keeper

Invoked after GLS-01/02 and after GLS-03. Admin map and `live-receipts.md` describe Receipts as wired.
