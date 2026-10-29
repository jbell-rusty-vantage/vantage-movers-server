# Score Each Source Company On Matching Bookings, And Walk Matching Leads Through To Bookings

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/sourcePerformance.service.ts`
- Current declared exports: `getSourceCompanyPerformance`, `getSourceCompanyFunnel`, `getLeadSourcePerformance`.
- Evidence: `src/services/analytics/sourcePerformance.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Consider renaming `getSourceCompanyPerformance` to `scoreEachSourceCompanyOnMatchingBookings` if the live callers still benefit; keep `getSourceCompanyPerformance` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: source performance groups bookings by source company and granularity; source funnel recomputes company rates from granularity leaves. See `src/services/analytics/sourcePerformance.service.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Retain all three reports. Company performance and lead-source performance intentionally share Booking aggregation and return `booking_rate:null` because no Lead denominator is loaded. Funnel separately combines Lead pointer-based `sheet_*` counts with official `reconciled_*` Booking counts; rate uses reconciled bookings / total Leads. Preserve zero catalog rows and parent-rate recomputation. Prove a Lead booked pointer without an official Booking affects only sheet counts, and source performance never invents a numeric booking rate.
