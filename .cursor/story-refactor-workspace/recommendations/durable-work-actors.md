# Create Durable Work Actor Snapshots

- Status: reviewed starter, 2026-10-29
- Target: `src/services/durableWork/actors.ts`
- Current declared exports: `durableActorFromRegistryActor`, `createBestRelocationIngestionActor`, `createReportingProjectionActor`, `createGranotLifecycleProcessorActor`, `createGranotWebhookInitiator`, `createBrowserExtensionOwnerInitiator`, `createRingCentralCallIngestActor`, `createDurableAuditEnvelope`, `sanitizeDurableMetadata`.
- Evidence: `src/services/durableWork/actors.ts`, `docs/knowledge/services/domain-commands.md`, `docs/knowledge/services/ingestion.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/reporting/reporting.service.ts`

## Recommendation

Keep `durableActorFromRegistryActor` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Best Relocation sheet ingestion is not live. Keep this shared module: inspect its actual live callers before changing names or contracts; Granot automation, reporting, Sheet Sync, lifecycle and other services use parts of durable work. Preserve fencing, serialization, retry and error semantics where applicable.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

Keep actor factories, audit envelope construction and metadata sanitization distinct. Registry system actors reject conversion; system work uses dedicated fixed identities/origins. Envelope fills absent ids with null and preserves occurred_at. Sanitizer recursively redacts sensitive-key object fields, including object items in arrays, while preserving Dates/nonrecord values; it is key-based and must not be advertised as arbitrary PII detection. Prove fixed identity snapshots, system-conversion rejection and nested raw_row/token redaction.
