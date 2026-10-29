# Flatten This Named Analytics Report To A Spreadsheet

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/analyticsExport.service.ts`
- Current declared exports: `exportAnalyticsReportCsv`, `rowsForCsv`.
- Evidence: `src/services/analytics/analyticsExport.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Keep `exportAnalyticsReportCsv` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Preserve the named report's fixed CSV column order and the rows produced by the current dispatcher. CSV output is a compatibility interface and does not become an Insights export.

## Source-verified implementation constraints (2026-10-29)

Retain `rowsForCsv` as the report-shape adapter: summary emits one totals row; geographic lanes tag Form and Call rows; source reports emit each child (including zero rows) or a childless parent, never parent plus children. Cancellation ratio additionally emits its `overall` row. Keep report-specific column order and filenames. Prove the public CSV wrapper forwards the same query and an aggregate with children does not double-count parent totals.
