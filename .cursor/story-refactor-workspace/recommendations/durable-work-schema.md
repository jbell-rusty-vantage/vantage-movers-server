# Define Durable Run and Lease Fields

- Status: reviewed starter, 2026-10-29
- Target: `src/services/durableWork/schema.ts`
- Current declared exports: `durableRunControlFields`, `fencedLeaseFields`.
- Evidence: `src/services/durableWork/schema.ts`, `docs/knowledge/services/ingestion.md`, `docs/knowledge/services/granot-http-collector.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/reporting/reporting.service.ts`

## Recommendation

Keep `durableRunControlFields` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Best Relocation sheet ingestion is not live. Keep this shared module: inspect its actual live callers before changing names or contracts; Granot automation, reporting, Sheet Sync, lifecycle and other services use parts of durable work. Preserve fencing, serialization, retry and error semantics where applicable.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

Two schema factories return run-control and fenced-lease field maps. Preserve epoch default 0/minimum 0, nullable owner/expiry, checkpoint subdocument without _id, structured failure class enum and required cursor, plus unique named lease scope. They define schema shape, not lease acquisition or checkpoint validity; runtime stores perform those checks. Prove generated schema defaults/validators/index metadata through representative owning models before changing these exports.
