# Walk The Latest Uploaded Granot CSVs, Dry-Run By Default, Then Apply Form Quoted/Cuft, Follow Up Enrichment, Or Booked Reconciliation Only When Asked — Never Create A Lead From Here

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotCrmCsv/sync.service.ts`
- Current declared exports: `GranotCrmCsvSyncOptions`, `GranotCrmCsvRowOutcome`, `GranotCrmCsvSyncResult`, `runGranotCrmCsvSync`.
- Evidence: `src/services/granotCrmCsv/sync.service.ts`, `docs/knowledge/services/operations-registry.md`, `docs/knowledge/services/form-lead-search.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Keep `runGranotCrmCsvSync` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Default to dry run, select the newest uploaded ingestion per workspace and CSV kind, preserve per-row outcomes and counts, and persist a failed run before rethrowing a failure.

## Source-verified implementation constraints (2026-10-29)

This compatibility CSV path is not sealed HTTP lifecycle apply. A row is classified Form only when ref_no is a valid Mongo id, which is used as _id rather than exact persisted Tracking Reference. Other rows route by CSV kind to Call preview/sync; do not import HTTP's exact-reference ladder here as a cleanup. Form prior 0 sets quoted=false; 1/5 sets true and optional cubic feet; duplicate Forms never update. Dry-run differing Form rows report unchanged with changes, not updated. Pick latest uploaded ingestion per workspace/kind but fetch mutable s3_latest_key; there is no checksum/history verification in this function. Preserve per-row limit, run/outcome persistence and whole-run failure rethrow. Prove Form/Call routing, prior downgrade, no dry-run Lead mutation and distinct Follow Up/Booked call adapters.
