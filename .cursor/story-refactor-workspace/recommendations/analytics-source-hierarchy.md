# Put These Counted Source Rows Under The Filter Catalog Tree

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/sourceHierarchy.ts`
- Current declared exports (local declarations; re-exports are additional): `SourceGranularityMetricRow`, `SourceCompanyMetricRow`, `SourceLabelIndex`, `NestSourceRowsOptions`, `sourceLabelIndexFromCatalog`, `catalogChannelFromLeadType`, `nestObservedSourceRows`, `buildSourceLabelIndex`, `nestSourceCompanyRows`, `sourceCompanyFromRow`, `sourceGranularityFromRow`, `resolveCompanyLabel`, `fallbackCompanyLabel`, `humanizeSourceKey`.
- Evidence: `src/services/analytics/sourceHierarchy.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Keep `nestObservedSourceRows` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: source hierarchy uses registry labels and rolls additive child metrics; source hierarchy retains unknown granularity in parent totals; source hierarchy folds normalized company and granularity collisions. See `src/services/analytics/sourceHierarchy.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Catalog seeding retains zero-valued feeds in the requested Form/Call channel scope; observed unknown or uncatalogued feeds remain as extras. Normalize keys, fold additive collisions, derive child rates, sum additive parent values, then derive parent rates rather than summing percentages. `nestObservedSourceRows` loads facets itself; pure `nestSourceCompanyRows` accepts supplied labels/catalog. Preserve both entry points, alphabetical child labels and caller-provided parent sort. Prove a zero catalog feed and unknown observed feed remain while normalized duplicates merge.
