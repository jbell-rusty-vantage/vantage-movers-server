# Match a Collected Row to an Existing Form Lead

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotHttpCollector/granotFormLeadMatcher.ts`
- Current declared exports: `GranotFormLeadMatchMethod`, `GranotFormLeadLike`, `GranotFormLeadMatchInput`, `GranotFormLeadMatchResult`, `GranotFormLeadMatcherDependencies`, `resolveGranotFormLead`, `selectGranotFormFallback`.
- Evidence: `src/services/granotHttpCollector/granotFormLeadMatcher.ts`, `docs/knowledge/services/form-lead-search.md`, `docs/knowledge/services/granot-http-collector.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Keep `resolveGranotFormLead` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Exact reference wins, duplicate exact references conflict, and a valid Mongo ID is the next lookup. Fallback requires phone or email, excludes duplicates and reports ambiguity instead of choosing arbitrarily.

## Source-verified implementation constraints (2026-10-29)

Keep exact ref lookup before 24-hex Mongo id before contact fallback. Both exact paths exclude duplicates; exact source mismatch warns but does not reject. Contact fallback requires phone or email (name-only insufficient), scored search max 25/nonduplicate, then same mapped Source Company, top score and optional quoted tie-break for priorities 0/1/5. A remaining tie conflicts; do not select newest as an identity decision. Unknown source gates fallback but not exact identity. Prove all three paths, two exact refs, exact mismatch warning, name-only rejection, quoted tie and unknown-source behavior; Estimates canonical identity remains a different planner.
