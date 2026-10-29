# Dispatch Compatibility Analytics Reports

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/analytics.service.ts`
- Current declared exports: `AnalyticsPayload`, `AnalyticsResponse`, `getAnalyticsReport`.
- Evidence: `src/services/analytics/analytics.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Consider renaming `getAnalyticsReport` to `runThisAdminDashboardAnalyticsReport` if the live callers still benefit; keep `getAnalyticsReport` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope. `getAnalyticsReport` dispatches against `getAdminModels()` and preserves report names and response shape.

## Parity checks

Read the target and current callers before applying any change. Add or identify operation-level tests that invoke `getAnalyticsReport` and prove report dispatch, forwarded query, response shape and error propagation. The existing helper tests do not establish dispatcher coverage. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors.

**Existing helper checks:** Preserve these behaviors, which do not invoke the dispatcher: analytics validation accepts report filters and rejects invalid report names; sourceGranularityMatch filters derived key only and wins over source_company; analytics booked lead filters start with a leading date match. See `src/services/analytics/analytics.service.test.ts`.
