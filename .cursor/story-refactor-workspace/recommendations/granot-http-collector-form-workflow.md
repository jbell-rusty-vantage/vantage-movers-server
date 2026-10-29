# Plan Form Lead Quote and Missing-Location Updates from Collected Rows

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotHttpCollector/formWorkflow.ts`
- Current declared exports: `GranotFormPatch`, `GranotFormPlanAction`, `GranotFormPlan`, `GranotFormWorkflowDependencies`, `planGranotFormWorkflow`, `buildGranotFormPatch`, `granotFormIdentityFields`.
- Evidence: `src/services/granotHttpCollector/formWorkflow.ts`, `docs/knowledge/services/granot-http-collector.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Keep `planGranotFormWorkflow` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: [AC-03] form identity vocabulary excludes lids while allowing Mongo id as a secondary lookup; [AC-03] form planning gives exact FormLead.ref_no priority over every fallback; exact identity wins but surfaces a source-company mismatch warning. See `src/services/granotHttpCollector/formWorkflow.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Preserve plan and patch seams: booked rows precede Follow Up rows per source and beforeRow runs for each. Planner emits schema v1 only; sealing occurs later. Quote/cubic-feet are not fill-only: priorities 1/5 propose quoted=true and any parseable cubic feet even if existing values differ; priority 0 does not unquote here (CSV sync differs). Locations use missing checks plus state/zip consistency, receiver proposes five fields only when absent. Existing all-zero ZIP passes isMissingZip but fillMissing still does not replace nonempty '00000'; preserve this actual limitation until separate fix. Same-value filtering creates patch plus expected values only for changes; current planRow never emits invalid. Prove present cubic-feet replacement, priority0, coherent/incoherent location fill, all-zero ZIP and unchanged plan.
