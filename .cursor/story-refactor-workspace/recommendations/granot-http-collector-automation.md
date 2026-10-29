# Collect The Requested Tables And Optionally Preview What Those Follow Up And Booked Jobs Rows Would Do — No Run Document

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotHttpCollector/automation.ts`
- Current declared exports: `GranotAutomationMode`, `GranotAutomationResult`, `runGranotAutomation`.
- Evidence: `src/services/granotHttpCollector/automation.ts`, `docs/knowledge/services/granot-http-collector.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Keep `runGranotAutomation` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** The default mode collects; preview additionally calls enrichment and booking reconciliation previews. The includeRows flag controls whether detailed payloads and preview operations are returned.

## Source-verified implementation constraints (2026-10-29)

This standalone helper defaults collect, builds payloads even when includeRows=false and only invokes Call enrichment/Booked reconciliation preview for mode=preview, in sequential batches of 100. includeRows controls returned payload/details, not whether preview runs. It writes no run/receipt/Lead and does not run the Form workflow or Estimates collector. Preserve summarized status counts and not-observed labels. Prove collect omits operations, preview without includeRows still computes counts, and >100 rows batch in order.
