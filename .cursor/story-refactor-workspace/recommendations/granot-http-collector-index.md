# Log Into Granot, Collect The Requested Source Tables, And Turn Them Into The Rows The Company Already Uses For Follow Up And Booked Jobs

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotHttpCollector/index.ts`
- Current declared exports (local declarations; re-exports are additional): `GranotSectionKey`, `GranotReportRow`, `GranotSourceCollection`, `GranotCollectorCredentials`, `GranotCollectionRequest`, `GranotCollectionResult`, `GranotOperationPayloads`, `GranotCollectorDependencies`, `GranotSessionRequest`, `GranotAuthenticatedSession`, `GranotCollectorError`, `collectGranotReport`, `getGranotDateWindowProblem`, `parseGranotSourceReport`, `buildGranotOperationPayloads`, `openGranotAuthenticatedSession`.
- Evidence: `src/services/granotHttpCollector/index.ts`, `docs/knowledge/services/granot-http-collector.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Consider renaming `collectGranotReport` to `collectTheRequestedGranotSourceTables` if the live callers still benefit; keep `collectGranotReport` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Preserve date-window validation, authenticated collection, source report parsing and operation-payload construction. Test requested sections and source labels, session failures and invalid windows at the exported collector boundary.

## Source-verified implementation constraints (2026-10-29)

Retain collector, authenticated session seam, date validation, source parser and payload builder. Network then user login shares cookies/token and removes SAVEPASS; retry entire session once only for invalid_session. Requests stay same-origin, manual redirects preserve POST only on 307/308, use 20-second timeout and 10,000,000-byte declared/stream limits. Sources match requested exact labels; unobserved labels report separately. A recognized table needs job_no/customer headers; data also needs numeric no and job or customer. Section empty/missing is tolerated only with at least one recognized table and no invalid-header section. Payloads retain source-prefixed row identity, separate user/rep fallback, cities and Booked section/priority/date. Prove two-page session/cookies, redirect refusal, invalid schema/window and mapping without invoking persistence. Estimates shares login only and uses its own parser/query.
