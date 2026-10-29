# Normalize full names and partial corrections

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/leadName.service.ts`
- Knowledge: `docs/knowledge/services/call-lead.md`, `docs/knowledge/services/customer.md`, `docs/knowledge/services/form-lead.md`

## Current operation and boundaries

buildLeadNameFromParts, normalizeLeadName and normalizeLeadNameUpdate serve creation and patch semantics. Missing property differs from an explicit empty component; rebuilding the name must retain current precedence and whitespace treatment.

## Remaining recommendation

Keep one small pure module with meaningful create versus update entry points; name hasOwnInput by patch-presence purpose if helpful. Avoid general person-name parsing or changing first/last policy.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`buildLeadNameFromParts`; `normalizeLeadName`; `normalizeLeadNameUpdate`

## Parity proof

Full versus parts precedence; whitespace; missing/empty/null cases; one-sided correction; unchanged patch and no generated invented contact.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
