# Chart This Period's Bookings By Day Or Month

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/revenueTrend.service.ts`
- Current declared exports: `getRevenueTrend`.
- Evidence: `src/services/analytics/revenueTrend.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Consider renaming `getRevenueTrend` to `chartThisPeriodsBookingsByDayOrMonth` if the live callers still benefit; keep `getRevenueTrend` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

The prefix filters by `book_date`; only afterward `report_date` falls back to `timestamp` for bucketing. Preserve UTC day/month strings, ascending periods, rounded money, cancellation pointer counts and zero-denominator rate. A missing book date may bucket without a date filter but is excluded by a book-date range; prove that distinction instead of silently broadening the filter.
