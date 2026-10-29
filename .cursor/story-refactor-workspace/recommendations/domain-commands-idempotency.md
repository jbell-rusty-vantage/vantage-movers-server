# Execute a Domain Command Idempotently

- Status: reviewed starter, 2026-10-29
- Target: `src/services/domainCommands/idempotency.ts`
- Current declared exports: `StoredCanonicalCommandExecution`, `CanonicalCommandExecutionStore`, `CanonicalCommandTransactionRunner`, `createIdempotentCanonicalCommandExecutor`, `executeIdempotentCanonicalCommand`, `executeCanonicalCommandWithPostCommit`.
- Evidence: `src/services/domainCommands/idempotency.ts`, `docs/knowledge/services/domain-commands.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `createIdempotentCanonicalCommandExecutor` to `buildTheCommandApplyOnce` if the live callers still benefit; keep `createIdempotentCanonicalCommandExecutor` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: [AC-21] replica executor: exact stored-result replay, checksum conflict, and no second mutation; [AC-21] replica executor: same-key commit race has one winner and exact replay of the stored result; [AC-21] replica executor: expected-revision loser is DOMAIN_REVISION_CONFLICT with no Decision/Command. See `src/services/domainCommands/idempotency.integration.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Preserve executor factory, default executor and post-commit wrapper as distinct seams. Clock and execution id are allocated once before transaction retries. Lookup identity is origin + idempotency key; exact replay returns stored applied result, never re-enters operation or finalizer. Name/checksum mismatch conflicts, including duplicate-key race recovery; absent raced execution rethrows. Mutations, Change and Command persist together. Finalize only non-replay when pending is defined, including falsey defined values; empty-diff adapters omit pending. Prove rollback and retry-stable IDs, exact replay/race, mismatch conflict and no finalizer on replay/no-op; source inspection is not evidence those integration assertions passed.
