# Accept The Granot CSV Download, Skip S3 When The Bytes Have Not Changed, Otherwise Store Latest Plus History And Remember The Ingestion — Never Write A Lead From Here

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotCrmCsv/upload.service.ts`
- Current declared exports: `uploadGranotCrmCsv`.
- Evidence: `src/services/granotCrmCsv/upload.service.ts`, `docs/knowledge/services/operations-registry.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Use the existing operation names as the public seam; improve private names only where they clarify a decision in this story, preserving exports and callers. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Unchanged content still records a skipped ingestion but does not upload the objects. Changed content writes history, latest and metadata, records the ingestion and then updates the source snapshot.

## Source-verified implementation constraints (2026-10-29)

Preserve raw UTF-8 byte hash, not normalized-row hash; source resolution/path update happens before unchanged-content detection. Unchanged still creates skipped_unchanged ingestion and returns keys without S3 uploads or changing last-ingestion pointer. Changed writes history, latest and metadata in order, records uploaded ingestion, then saves source pointer; these S3/Mongo steps are not one atomic transaction, so do not promise rollback of prior objects. Caller-supplied row counts override parsed counts with nullish semantics (zero remains zero). Prove write order and unchanged branch, including failure after earlier object upload.
