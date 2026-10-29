# Rate Cancelled Bookings Against Matching Bookings, And Group Matching Cancellations By Reason

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/cancellationAnalytics.service.ts`
- Current declared exports: `getBookingCancellationRatio`, `getCancellationReasons`.
- Evidence: `src/services/analytics/cancellationAnalytics.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Keep `getBookingCancellationRatio` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

Two outputs have different populations: ratio counts Booking documents whose `cancelled` pointer is present; reasons groups Cancellation documents and joins Booking financial values. Ratio with no matches returns `overall:null`, while a nonempty overall with zero cancellations has a null booked-to-cancelled ratio. Source rows seed the catalog and recompute rates from additive children. Reasons normalize blank/null to unknown, retain unlinked cancellations, sort by count then reason and cap at 50. Prove both operations; do not replace pointer counts with Cancellation collection counts.
