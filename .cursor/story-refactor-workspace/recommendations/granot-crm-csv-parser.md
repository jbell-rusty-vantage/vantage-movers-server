# Parse The Leftover Granot CSV Download Into Identifiable Data Rows, Skip Totals And Blanks, Then Key By Job, Mongo Ref, Or Phone — Never Apply A Lead From Here

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotCrmCsv/parser.ts`
- Current declared exports: `parseGranotCsv`, `cleanValue`.
- Evidence: `src/services/granotCrmCsv/parser.ts`, `docs/knowledge/services/form-lead-search.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Keep `parseGranotCsv` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: parseGranotCsv normalizes headers and skips total rows. See `src/services/granotCrmCsv/parser.test.ts`.

## Source-verified implementation constraints (2026-10-29)

This CSV parser is separate from HTTP/Estimates. Preserve row acceptance: any nonblank job, else 24-hex ref, else phone AND customer. It is not a generic totals-row keyword filter. Row key is job, Mongo ref, normalized last-ten-digit phone+email, phone, then fallback customer/no; rowIndex is the parsed-record index. Header/cell normalization and counts retain skipped blank/nondata rows; duplicate row keys are not deduplicated here. Prove quoted/multiline CSV, header normalization, totals without identity, provider ref with/without phone and repeated-key rows.
