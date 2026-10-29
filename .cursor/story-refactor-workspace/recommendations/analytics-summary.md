# Count This Period's Leads, Bookings, And Cancellations

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/summary.service.ts`
- Current declared exports: `getSummary`.
- Evidence: `src/services/analytics/summary.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Keep `getSummary` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

Count all matching Form/Call Leads (no blanket duplicate/unmatched exclusion here). Booking totals and cancelled-Booking count come from Booking aggregation; separate Cancellation totals/refunds come from Cancellation aggregation. Preserve max(bookings - cancelled_bookings,0), booking rate bookings / all Leads, cancellation rate cancelled Bookings / bookings, zero-safe rates and rounded money. Prove an unlinked Cancellation changes cancellations/refunds without changing cancelled_bookings; empty collections return a populated zero totals object.
