# Build Trusted Context for Existing Writes

- Status: reviewed starter, 2026-10-29
- Target: `src/services/domainCommands/existingWriteContext.ts`
- Current declared exports: `VANTAGE_API_SECRET_ACTOR_LABEL`, `VANTAGE_SCOPED_API_KEY_ACTOR_LABEL`, `existingWriteContextFromRequest`, `createVantageApiSecretActor`, `createVantageScopedApiKeyActor`, `fingerprintScopedApiKey`.
- Evidence: `src/services/domainCommands/existingWriteContext.ts`, `docs/knowledge/services/domain-commands.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Keep `existingWriteContextFromRequest` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: existing write context maps an Owner extension user to an owner actor; existing write context maps Owner plus Sales to an owner actor. See `src/services/domainCommands/existingWriteContext.test.ts`.

## Source-verified implementation constraints (2026-10-29)

This request adapter builds context, not domain policy. Preserve server-generated command id; submission id gives existing:<command>:<submission> while missing/blank id gives request:<command>:<requestId>. Checksum includes command, resource id and canonical payload (sorted keys, ISO dates, omitted undefined; arrays keep order). Owner extension users, trusted owner/admin headers on primary secret, scoped-key fingerprint and bare API secret retain distinct actors; nonowner user fails. Keep credentials out of stored provenance. Prove equivalent key ordering checksums and resource-specific checksum differences, plus each authorization path.
