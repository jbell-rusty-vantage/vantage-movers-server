# Match These Dashboard Chips To Bookings, Cancellations, And Leads

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/analyticsFilters.ts`
- Current declared exports (local declarations; re-exports are additional): `AnalyticsRow`, `dateMatch`, `bookedLeadPrefix`, `cancelledLeadPrefix`, `leadMatchForQuery`, `leadMatch`, `bookedLeadSourceLookups`, `normalizeDimension`, `normalizeDimensionKey`, `normalizeSourceDimension`, `roundMoney`, `rate`, `numberValue`, `trendDateExpression`, `sourceGranularityMatch`.
- Evidence: `src/services/analytics/analyticsFilters.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Consider renaming `bookedLeadPrefix` to `matchTheseDashboardChipsToBookings` if the live callers still benefit; keep `bookedLeadPrefix` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

Keep booking, cancellation and lead filter builders distinct. Booking fields match before lookups; cancellation first joins its Booking and falls back to that Booking's Lead. Source derivation prefers employee snapshot, then joined Form/Call fields, then booking source. Granularity overrides Source Company; lead granularity matching includes submitted `source_company` in addition to key/snapshot/catalog id, while booking granularity matches only the derived key. Preserve inclusive `$lte to`, booking `book_date`, cancellation `cancel_date`, Lead `timestamp`, alias-aware exact company regexes, and `is_cancelled` from the Booking pointer. Prove each pipeline and precedence explicitly; do not replace these compatibility date cuts with Insights periods.
