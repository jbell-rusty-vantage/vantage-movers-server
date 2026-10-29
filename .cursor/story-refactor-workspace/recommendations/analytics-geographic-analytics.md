# Split Matching Bookings By Local Vs Long-Distance, Rank Form And Call Pickup-To-Delivery Lanes, And Rank Matching Leads By Pickup Or Delivery State

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/geographicAnalytics.service.ts`
- Current declared exports: `getLocalVsLongDistance`, `getGeographicLanes`, `getStatePerformance`.
- Evidence: `src/services/analytics/geographicAnalytics.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Keep `getLocalVsLongDistance` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

Retain all three operations: local/long-distance aggregates Bookings and their official cancellation pointer; lanes returns separate Form and Call arrays; state performance merges Form/Call counts before deriving rate and ranking. Lead lanes/states use Lead booked/cancelled refs, not booking-dollar joins. Preserve unknown null/blank locations, 50-row lane/state caps and ties (leads then booked); prove a state occurring in both lead types sums before rate calculation and Lead-type filtering excludes the other collection.
