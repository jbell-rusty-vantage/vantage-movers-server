# Keep The Exact Granot Labels The Owner Uses For HTTP Automation, And Only Hand Selected IDs To A Run When The Registry Says They May Be Applied

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotHttpCollector/sourceCatalog.ts`
- Current declared exports (local declarations; re-exports are additional): `GRANOT_AUTOMATION_SOURCE_LIMIT`, `GranotSourceOperation`, `DEFAULT_GRANOT_AUTOMATION_SOURCES`, `DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS`, `GranotAutomationSourceItem`, `GranotAutomationSourceConflict`, `GranotAutomationSourceLimitReached`, `GranotAutomationSourceValidationError`, `listGranotAutomationSources`, `createGranotAutomationSource`, `GranotSourceSeedResult`, `seedGranotAutomationSources`, `resolveGranotAutomationSources`, `canonicalizeGranotSourceIds`, `compatibilityOperationsForSource`, `partitionGranotAutomationSources`.
- Evidence: `src/services/granotHttpCollector/sourceCatalog.ts`, `docs/knowledge/services/granot-http-collector.md`, `docs/knowledge/services/operations-registry.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Keep `listGranotAutomationSources` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: source IDs canonicalize case before lookup and duplicate validation; source partitioning keeps only compatible IDs in each child snapshot; [AC-38] unavailable resolve issues keep INVALID_GRANOT_SOURCES and per-source codes. See `src/services/granotHttpCollector/sourceCatalog.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Preserve list/create/seed/resolve and both partition helpers. List filters active stored supported_operations then adds Registry compatibility; stored operations are compatibility inventory, Registry lifecycle routes are semantic apply authority for ID resolution. Canonicalize ids and reject duplicates/missing/inactive/unclassified before resolving referenced Registry row; missing/ambiguous/deferred/disabled/no-route rows fail with per-source issues. For a multioperation group, evaluate only routes actually permitted for a source, then require at least one source in each requested partition. New label starts missing_reference and does not auto-link Registry. Seeds update supported_operations but do not reactivate existing inactive rows. Prove stored-versus-Registry disagreement, mixed Form/Call partitions and new-source classification; keep label-only create's known gap in runWorkflow visible.
