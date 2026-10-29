# Validate Checkpoints and Build Fenced Updates

- Status: reviewed starter, 2026-10-29
- Target: `src/services/durableWork/checkpoints.ts`
- Current declared exports: `NonMonotonicCheckpointError`, `assertCheckpointAdvance`, `buildCheckpointCompareAndSet`, `assertMonotonicCounters`.
- Evidence: `src/services/durableWork/checkpoints.ts`, `docs/knowledge/services/ingestion.md`, `docs/knowledge/services/granot-http-collector.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/reporting/reporting.service.ts`

## Recommendation

Keep `assertCheckpointAdvance`: it validates version/completed-unit progress, not cursor ordering. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Best Relocation sheet ingestion is not live. Keep this shared module: inspect its actual live callers before changing names or contracts; Granot automation, reporting, Sheet Sync, lifecycle and other services use parts of durable work. Preserve fencing, serialization, retry and error semantics where applicable.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Require increasing checkpoint versions, nondecreasing completed units and counters, and a named phase. The compare-and-set includes lease owner, epoch, unexpired clock and expected version.

## Source-verified implementation constraints (2026-10-29)

Keep advance validation, CAS construction and counters separate. Full advance checks positive integer version, nonnegative integer completed_units, nonblank phase and monotonic progress; CAS builder itself only rejects version reversal and builds owner/epoch/unexpired/expected-version filter. It does not inspect cursor ordering or invoke full validation. Preserve missing-current version filter [null,0] and partial counter validation (only supplied keys). Prove validation and constructed filter separately.
