# Resolve source attribution and stamp its snapshots

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/leadSourceCompany.ts`
- Knowledge: `docs/knowledge/services/bookings.md`, `docs/knowledge/services/call-lead.md`, `docs/knowledge/services/form-lead.md`, `docs/knowledge/services/operations-registry.md`

## Current operation and boundaries

The adapter calls operationsRegistry.resolveSourceAttribution, then maps ids/keys/label snapshots. Missing/not_provided falls back main_site; explicit company controls label fallback. Registry errors translate to ValidationError with source_company metadata; unrelated failures propagate.

The adapter accepts inbound_phone_number and requireActive but does not forward them to resolveSourceAttribution; preserve that behavior during a naming-only cleanup.

## Remaining recommendation

Name input translation, assignment fields and error translation. Preserve currently unused accepted inbound_phone_number/requireActive inputs rather than pretending they are passed through; wiring them would be separate behavior work.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`resolveLeadSourceAssignment`

## Parity proof

Explicit company/granularity; main_site default; legacy label fallback flag; id/snapshot mapping; Registry code preserved in error metadata; technical error identity preserved.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
