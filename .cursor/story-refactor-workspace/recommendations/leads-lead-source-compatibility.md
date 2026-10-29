# Classify existing source compatibility without resolving it

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/leadSourceCompatibility.ts`
- Knowledge: `docs/knowledge/services/employee-bookings.md`

## Current operation and boundaries

Classification returns exact_granularity/same_company/unassigned/conflict using Registry ids where available and legacy slug/key fallback. Normalization accepts legacy unknown-shaped identifiers. It does not query or mutate Registry.

## Remaining recommendation

Clarify the small comparable/expected input contracts and local normalizers using current Registry types only where actual callers permit. Avoid a broad utils extraction or making stronger ObjectId validation silently change fallback outcomes.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`SourceCompatibility`; `classifyLeadSourceCompatibility`

## Parity proof

Id versus slug priority; same company/different granularity; missing/not_provided; object/string identifier normalization; exact result strings and no source reassignment.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
