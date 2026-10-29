# Verify a Domain Command Context

- Status: reviewed starter, 2026-10-29
- Target: `src/services/domainCommands/commandContext.ts`
- Current declared exports: `CommandContextVerifier`, `assertCommandContext`.
- Evidence: `src/services/domainCommands/commandContext.ts`, `docs/knowledge/services/domain-commands.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Keep `assertCommandContext` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Require command ID, idempotency key and SHA-256 checksum before checking provenance. Preserve the distinct trusted admin, Granot lifecycle, RingCentral and external-ingestion actor checks; the latter remains a compatibility path, not a live ingest.

## Source-verified implementation constraints (2026-10-29)

Keep fail-closed context validation before executor connection. Granot context requires the exact processor identity/label, receipt matching processor request, nonblank Observation and Decision, and channel/initiator agreement. In addition to webhook/Owner paths, current code accepts fixed `granot-estimates-in-process-cron` system initiator (origin vantage_admin, nonblank request) only on granot_http_automation. Trusted admin compatibility actors must match id AND request; RingCentral additionally delegates to verified provenance. Prove accepted Estimates cron and mismatched channel rejection; this newer exception is absent from the older Service table.
