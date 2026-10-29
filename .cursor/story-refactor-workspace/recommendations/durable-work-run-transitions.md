# Apply Fenced Durable Run Transitions

- Status: reviewed starter, 2026-10-29
- Target: `src/services/durableWork/runTransitions.ts`
- Current declared exports: `MongoDurableRunModel`, `StatusGraph`, `InvalidRunTransitionError`, `MongoDurableRunStore`.
- Evidence: `src/services/durableWork/runTransitions.ts`, `docs/knowledge/services/ingestion.md`, `docs/knowledge/services/reporting.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/reporting/reporting.service.ts`

## Recommendation

Keep `InvalidRunTransitionError` and the Mongo store interface; clarify transition decision beats only when needed. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Best Relocation sheet ingestion is not live. Keep this shared module: inspect its actual live callers before changing names or contracts; Granot automation, reporting, Sheet Sync, lifecycle and other services use parts of durable work. Preserve fencing, serialization, retry and error semantics where applicable.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Keep status graph validation, checkpoint/counter monotonicity and owner/epoch/expiry compare-and-set checks separate. A stale fence or failed expected state cannot advance the run.

## Source-verified implementation constraints (2026-10-29)

Retain InvalidRunTransitionError as an error class with stable name/code; it is not an operation to rename into a sentence. Mongo store distinguishes missing run, unexpected status, illegal graph hop and stale lease, then CASes status, owner/epoch/expiry, checkpoint version and supplied counter values. Failed CAS reloads to classify missing/status/lease loss. Preserve partial counters and failure undefined-versus-null. Prove competing counter/checkpoint writer cannot overwrite progress and graph violation throws, rather than returning generic lease_lost.
