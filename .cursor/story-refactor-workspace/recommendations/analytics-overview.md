# Build the Compatibility Analytics Overview

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/overview.service.ts`
- Current declared exports: `OverviewPeriod`, `OverviewTotals`, `OverviewAllTime`, `OverviewLast7Days`, `OverviewResponse`, `rollingLast7DaysWindow`, `getOverviewReport`.
- Evidence: `src/services/analytics/overview.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Consider renaming `getOverviewReport` to `paintTheAdminDashboardHomeOverview` if the live callers still benefit; keep `getOverviewReport` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: overviewQuerySchema accepts production only; rollingLast7DaysWindow spans seven days ending now. See `src/services/analytics/overview.service.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Preserve all-time and last-seven-days sections, both always including summary, top-five agents and stamped lead cost; only the latter has source sales rows and a period. `rollingLast7DaysWindow` subtracts seven with local `setDate` and floors the start with local `setHours`, ending at current time: it is neither a fixed 168-hour span nor an Insights New York date range. Its helper/schema tests do not prove `getOverviewReport` assembles the sections; assert assembly separately before refactoring.
