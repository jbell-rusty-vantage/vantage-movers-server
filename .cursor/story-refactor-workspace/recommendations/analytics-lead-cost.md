# Price These Matching Form And Call Leads By Stored CPL, Grouped By Source Company

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/leadCost.service.ts`
- Current declared exports: `LeadCostResult`, `getLeadCost`.
- Evidence: `src/services/analytics/leadCost.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Keep `getLeadCost` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope. This compatibility helper currently sums stamped `cpl`, with null counted unresolved; Insights instead reads the applicable feed schedule live. Do not silently change either calculation.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: lead cost excludes duplicate form leads and unmatched call leads. See `src/services/analytics/leadCost.service.test.ts`.

**Specific parity:** Exclude duplicate Form Leads and unmatched Call Leads; group by Source Company and Source Granularity, count null CPL as unresolved, sum stored values with null as zero, then nest source rows and round the total.
