# Rank Agents by Compatibility Deposit Credit

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/agentPerformance.service.ts`
- Current declared exports: `getTopAgentsByDeposit`, `getAgentPerformance`.
- Evidence: `src/services/analytics/agentPerformance.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Keep `getAgentPerformance` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Unwind booking allocations; sum each allocation binder, but credit the full booking deposit to each allocation in this compatibility report. Preserve unknown agent handling, ordering and the 50-row cap; Insights uses a different split-credit calculation.

## Source-verified implementation constraints (2026-10-29)

Keep both `getAgentPerformance` and `getTopAgentsByDeposit`; the latter slices the shared 50-row aggregate to the requested limit (default five). A two-agent booking credits the full deposit to each allocation and only each allocation's binder, so totals deliberately differ from Insights split credit. Prove a split booking, null/exact-empty agent fallback (whitespace-only strings remain names), deterministic deposit/bookings/name ordering and the separate top-N wrapper.
