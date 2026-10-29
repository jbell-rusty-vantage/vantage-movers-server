# Plant The Leftover Granot CSV Workspace Catalog, Show It, And Bind An Upload To An Existing Source Or A Disabled Review Row — Never Write Lifecycle, SMS, Or A Lead From Here

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotCrmCsv/registry.ts`
- Current declared exports: `GRANOT_CRM_SOURCE_SEEDS`, `seedGranotCrmSources`, `listGranotCrmSources`, `findSourceForUpload`, `ensureSourceForUpload`, `normalizeCrmOrigin`, `normalizeCsvPath`, `slugifyWorkspace`.
- Evidence: `src/services/granotCrmCsv/registry.ts`, `docs/knowledge/services/operations-registry.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Keep `seedGranotCrmSources` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Find an existing source by workspace, then CSV path, then case-insensitive label. An unrecognized upload creates a disabled source needing review; preserve normalized paths and the existing-source path update.

## Source-verified implementation constraints (2026-10-29)

Preserve seed, list, upload lookup and ensure as separate operations. Lookup priority is workspace, normalized CSV path, then escaped case-insensitive exact label within normalized origin. Ensure updates an existing source's path and creates unknown upload sources disabled for review. Seeds insert default mapping/enabled only when missing but may update configured csv_paths on existing rows; do not describe them as entirely insert-only. Origin normalization strips URL path, CSV path keeps query, and generated unmapped workspace allows slash. Prove priority collisions, existing-path update and disabled unknown source; this module does not evaluate HTTP automation Registry routes.
