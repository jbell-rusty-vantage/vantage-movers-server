# 06 Search, Enrichment, And Reconciliation Services Refactor

## Purpose

Organize the existing operational service files that already sit outside `v1.service.ts` and make their dependencies point to the new domain modules.

This is mostly a cleanup and dependency-boundary task after lead, booking, cancellation, and sheet sync modules exist.

## Read First

- `api/services/formLeadSearch.service.ts`
- `api/services/callLeadSearch.service.ts`
- `api/services/callLeadEnrichment.service.ts`
- `api/services/bookedCallLeadReconciliation.service.ts`
- `api/services/bookedCallLeadReconciliation.service.test.ts`
- `api/services/v1.service.ts`
- `api/validation/v1.validation.ts`
- new `api/services/leads/`, `api/services/bookings/`, and `api/services/sheetSync/` folders if available

## Current Services

- `formLeadSearch.service.ts`: weighted form lead search behavior.
- `callLeadSearch.service.ts`: call lead search and summary projection.
- `callLeadEnrichment.service.ts`: preview/sync updates from CRM/browser-extension rows.
- `bookedCallLeadReconciliation.service.ts`: preview/sync Booked Jobs rows against call leads and bookings.

## Target Files

```text
api/services/search/
  formLeadSearch.service.ts
  callLeadSearch.service.ts
  index.ts

api/services/enrichment/
  callLeadEnrichment.service.ts
  callLeadEnrichmentRows.ts
  index.ts

api/services/reconciliation/
  bookedCallLeadReconciliation.service.ts
  bookedCallLeadRows.ts
  index.ts
```

If this feels too broad for one agent, split into:

1. Search services.
2. Call lead enrichment.
3. Booked call lead reconciliation.

## Dependency Cleanup

After domain modules exist:

- Enrichment should call `services/leads/callLead.service.ts` or narrow helpers for call lead updates.
- Reconciliation should call booking/source resolver or booking lifecycle services where appropriate.
- Both enrichment and reconciliation should call `services/sheetSync/` for scheduling instead of importing from `v1.service.ts`.
- Shared row parsing helpers should remain local to enrichment/reconciliation unless both services truly share the same parsing behavior.

## Compatibility Strategy

You may keep the original files as re-export facades:

```text
api/services/formLeadSearch.service.ts
api/services/callLeadSearch.service.ts
api/services/callLeadEnrichment.service.ts
api/services/bookedCallLeadReconciliation.service.ts
```

This keeps route imports stable while the folder structure settles.

## Agent Instructions

1. Move search services first; they are mostly read-only and isolated.
2. Move enrichment second; update sheet sync imports to use `services/sheetSync/`.
3. Move reconciliation third; reuse domain services only when it does not change behavior.
4. Preserve preview versus sync behavior exactly.
5. Preserve batch limits and row-level result shapes.
6. Keep tests close to the moved reconciliation service.
7. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- Search scoring and limits must not change.
- Enrichment preview must not write.
- Enrichment sync must still report per-row statuses.
- Reconciliation preview must not write.
- Reconciliation sync must still report per-row statuses.
- Any sheet sync triggered by these services must remain background-safe and test-mode aware.

## Suggested Tests

- Keep existing reconciliation tests passing after move.
- Add tests only around import-boundary changes or row parser extraction.
- Mock domain services if testing sync orchestration.

## Handoff To Next Agent

Report:

- Which old service files are now facades.
- Whether route imports were left unchanged.
- Any remaining direct import from `v1.service.ts`.

After this task, the service layer should be ready for utility, validation, and config cleanup.
