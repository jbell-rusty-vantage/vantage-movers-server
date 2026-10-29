# Choose the best exact caller-phone candidate

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/leadPhoneMatching.ts`
- Knowledge: `docs/knowledge/services/bookings.md`, `docs/knowledge/services/call-lead.md`, `docs/knowledge/services/form-lead.md`

## Current operation and boundaries

Regex is a Mongo sieve only; normalized phone must match in memory. Fetch up to25 newest candidates with optional company scope, prefer unbooked+uncancelled, then timestamp recency with createdAt only as a fallback. Current adapter imports default CallLead, not selected-model getter.

Ranking uses timestamp, falling back to createdAt and then epoch; createdAt is not a tie-breaker when timestamp exists.

## Remaining recommendation

Make sieve/verification/eligibility/ranking readable without conflating this helper with source-scoped lifecycle identity, Form Fill or RingCentral duplicate guard. Preserve default adapter unless separately proven caller migration warrants change.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`buildPhoneRegex`; `findBestCallLeadMatchByPhone`

## Parity proof

Separators/country prefixes and false regex positives; scope; cap25; unbooked preference; all-ineligible fallback; timestamp/createdAt tie behavior; undefined no match.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
