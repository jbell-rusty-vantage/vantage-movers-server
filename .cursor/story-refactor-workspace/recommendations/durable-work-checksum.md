# Serialize and Verify Durable Work Checksums

- Status: reviewed starter, 2026-10-29
- Target: `src/services/durableWork/checksum.ts`
- Current declared exports: `CanonicalSerializationError`, `ChecksumMismatchError`, `canonicalJson`, `computeChecksum`, `assertChecksum`.
- Evidence: `src/services/durableWork/checksum.ts`, `docs/knowledge/services/ingestion.md`, `docs/knowledge/services/granot-http-collector.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/reporting/reporting.service.ts`

## Recommendation

Consider renaming `canonicalJson` to `foldThisBagIntoOneStableString` if the live callers still benefit; keep `canonicalJson` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Best Relocation sheet ingestion is not live. Keep this shared module: inspect its actual live callers before changing names or contracts; Granot automation, reporting, Sheet Sync, lifecycle and other services use parts of durable work. Preserve fencing, serialization, retry and error semantics where applicable.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Canonical serialization and versioned envelope checksums support live lifecycle and reporting callers. Preserve deterministic ordering and rejection of unsupported values, plus checksum mismatch errors.

## Source-verified implementation constraints (2026-10-29)

Preserve canonicalJson, envelope hashing and checksum assertion exports; generic bag wording obscures a persisted wire format. Object keys sort, array order remains, Dates become ISO, -0 becomes 0; nonfinite/undefined/function/symbol/bigint/nonplain objects/cycles throw CanonicalSerializationError. assertChecksum trims/lowercases expected digest and compares timing-safely after length check. Prove permutation-invariant object digest, order-sensitive array digest, unsupported value errors and mismatch code without replacing this strict serializer with the command adapter's undefined-omitting serializer.
