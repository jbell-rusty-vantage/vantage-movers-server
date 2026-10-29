# Submit the Saved Form Lead to Granot

- Status: reviewed starter, 2026-10-29
- Target: `src/services/crm/crm.service.ts`
- Current declared exports: `submitFormLeadToCrm`.
- Evidence: `src/services/crm/crm.service.ts`, `docs/knowledge/services/form-lead.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`

## Recommendation

Consider renaming `submitFormLeadToCrm` to `postTheSavedFormLeadToGranot` if the live callers still benefit; keep `submitFormLeadToCrm` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

The historical database, Operational Events and Lead Conversations were retired. Keep only effects and dependencies present in the live module; do not restore retired side effects.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: submitFormLeadToCrm POSTs to the Granot lead gateway with the urlencoded payload; submitFormLeadToCrm reports ok=true with the response body and payload on HTTP 200; submitFormLeadToCrm reports ok=false with response body on HTTP error. See `src/services/crm/crm.service.test.ts`.

**Further parity:** `submitFormLeadToCrm` builds and URL-encodes the Form Lead payload and posts it to Granot; HTTP failures return the response and network failures return status 0. Both record a CRM-failed Daily Operations fact. Preserve masked endpoint and payload logging. Payload construction and failure-fact recording can themselves throw, so do not promise an unconditional never-throw contract.

## Source-verified implementation constraints (2026-10-29)

Keep payload construction/log sanitization outside the request try as currently implemented; do not strengthen the old never-throws JSDoc into a blanket error-swallowing contract. Fetch/response read/HTTP-failure fact errors enter the catch, which records a failure fact before returning status 0; failures of that catch-side fact can still propagate. Preserve URL-encoded POST, raw response in result, HTTP status versus network status 0, sanitized endpoint/payload logs and Daily Operations failure fact. Prove HTTP failure and fetch failure separately with the actual fact helper mocked; avoid catch-all tests that pass on an unintended exception.
