# Resolve an Effective Capability

- Status: reviewed starter, 2026-10-29
- Target: `src/services/durableWork/capability.ts`
- Current declared exports: `resolveEffectiveCapability`.
- Evidence: `src/services/durableWork/capability.ts`, `docs/knowledge/services/ingestion.md`, `docs/knowledge/services/granot-http-collector.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/reporting/reporting.service.ts`

## Recommendation

Consider renaming `resolveEffectiveCapability` to `sayWhetherThisCapabilityIsActuallyOn` if the live callers still benefit; keep `resolveEffectiveCapability` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Best Relocation sheet ingestion is not live. Keep this shared module: inspect its actual live callers before changing names or contracts; Granot automation, reporting, Sheet Sync, lifecycle and other services use parts of durable work. Preserve fencing, serialization, retry and error semantics where applicable.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Effective capability requires all three inputs: configuration, deployment gate and owner intent. Preserve the collected reason for each disabled input.
