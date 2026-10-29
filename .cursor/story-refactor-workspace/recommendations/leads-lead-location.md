# Resolve states and derive Move Type with current fallbacks

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/leadLocation.service.ts`
- Knowledge: `docs/knowledge/services/booked-call-lead-reconciliation.md`, `docs/knowledge/services/call-lead.md`, `docs/knowledge/services/form-lead.md`

## Current operation and boundaries

Required Form location resolves both ZIPs, then caller state, then not_found. Form derivation treats either not_found as local. Optional Call location may omit ZIPs and retains supplied local when both states are not known. These distinct current rules are behavior, not rename cleanup.

## Remaining recommendation

Name required/optional resolution and Form sentinel derivation plainly. Keep parallel ZIP lookup and current diagnostics; do not invent a special live Best Relocation ingest path or silently remove the optional explicit-local fallback.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`LocationWorkflowContext`; `RequiredLocationInput`; `RequiredLocationResult`; `resolveRequiredLocation`; `OptionalLocationInput`; `OptionalLocationResult`; `resolveOptionalLocation`; `deriveLocal`; `deriveFormLeadLocal`; `normalizeState`

## Parity proof

ZIP precedence/state normalization; not_found preserved; Form sentinel local; same/different states; partial Call state keeps explicit local; unknowns/log level and return shape unchanged.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
