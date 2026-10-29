# Verify RingCentral Telephony Provenance

- Status: reviewed starter, 2026-10-29
- Target: `src/services/domainCommands/ringcentralProvenance.ts`
- Current declared exports: `RingCentralTelephonyProvenanceInput`, `verifyTrustedRingCentralTelephonyProvenance`.
- Evidence: `src/services/domainCommands/ringcentralProvenance.ts`, `docs/knowledge/services/domain-commands.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `verifyTrustedRingCentralTelephonyProvenance` to `proveThisTelephonyIsServerVerified` if the live callers still benefit; keep `verifyTrustedRingCentralTelephonyProvenance` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** A blank receipt ID fails; a matching call-log connection key is accepted, while webhook provenance additionally requires the stored session to match. Preserve these distinct trust paths.

## Source-verified implementation constraints (2026-10-29)

The call-log branch accepts the exact server-generated connection string without looking up a webhook session. The webhook branch requires the matching stored telephony session. Qualification, active-route/scope checks and bounded identity are enforced elsewhere in shared ingest/adoption; this function is not a 120-second qualification check. Prove call-log acceptance does not query the session store and mismatched/missing webhook session rejects.
