# Rank These Receiver Agents By Received Leads, Chart Them Across Periods, And Break Them Down By Source And Lead Type

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/receiverAgentPerformance.service.ts`
- Current declared exports: `getReceiverAgentPerformance`, `getReceiverAgentTrend`, `getReceiverAgentSourceBreakdown`.
- Evidence: `src/services/analytics/receiverAgentPerformance.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Consider renaming `getReceiverAgentPerformance` to `rankTheseReceiverAgentsByReceivedLeads` if the live callers still benefit; keep `getReceiverAgentPerformance` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: receiver-agent analytics use persisted CPL without rate-period status. See `src/services/analytics/receiverAgentPerformance.service.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Preserve performance, trend and source-breakdown exports, which share aggregation but group differently. Received count includes duplicate/unmatched rows; billable cost and unresolved count exclude duplicate Forms and unmatched Calls. Booking/cancellation presence can also come from joined official documents. Both `average_cpl` and `cost_per_received_lead` divide cost by billable received Leads, not all received Leads; booking rate uses all received Leads. Preserve unassigned grouping, snapshot-first receiver name, trend sorting and catalog labels in source breakdown. Prove all three outputs and a row with received > billable so changing that denominator fails.
