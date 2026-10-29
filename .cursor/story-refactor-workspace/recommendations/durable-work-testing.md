# Exercise Durable Work with In-Memory Stores

- Status: reviewed starter, 2026-10-29
- Target: `src/services/durableWork/testing.ts`
- Current declared exports: `InMemoryLeaseStore`, `InMemoryRun`, `InMemoryDurableRunStore`.
- Evidence: `src/services/durableWork/testing.ts`, `docs/knowledge/services/ingestion.md`, `docs/knowledge/services/sheet-sync.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/reporting/reporting.service.ts`

## Recommendation

Keep `InMemoryRun` and the store class names; they identify test-adapter contracts clearly. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Best Relocation sheet ingestion is not live. Keep this shared module: inspect its actual live callers before changing names or contracts; Granot automation, reporting, Sheet Sync, lifecycle and other services use parts of durable work. Preserve fencing, serialization, retry and error semantics where applicable.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** The in-memory stores implement the same lease and transition interfaces as production adapters. Keep stale-owner and expired-lease behavior explicit; do not infer Mongo adapter coverage from tests of the fake.

## Source-verified implementation constraints (2026-10-29)

Retain InMemoryRun as a type and both stores as explicit test adapters; avoid turning a structural type into an operation sentence. Lease epochs survive release, expired leases permit acquisition, token copies isolate returned expiry, and run seed/read use structuredClone. Transition performs graph/lease/monotonic checks before applying supplied fields. Preserve the actual fake's limitations: it does not implement Mongo CAS races or input validation equivalently to MongoLeaseStore. Prove stale token, release/reacquire epoch and read isolation; do not claim these tests qualify production atomicity.
