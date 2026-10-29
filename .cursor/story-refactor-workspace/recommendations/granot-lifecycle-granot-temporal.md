# Compare accepted Observation tuples and build the CAS

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/granotTemporal.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/desired-state.md`, `docs/knowledge/granot-lifecycle/processor.md`

## Current operation and boundaries

Order is captured_at then a trimmed lowercase Observation id, across every channel and priority. Exact tuple is replay; older evidence never advances winner. The Mongo filter implements the same ordering.

Comparator trims and lowercases IDs and compares them without validating ObjectId shape; the Mongo CAS filter specifically requires 24-character hex.

## Remaining recommendation

Keep comparator/filter together; clarify missing-winner and exact-tuple branches without changing normalization or null semantics.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`GranotTemporalTuple`; `GranotTemporalOrder`; `normalizeTemporalObservationId`; `compareGranotTemporal`; `olderTemporalWinnerFilter`

## Parity proof

Missing winner; equal time/lower-higher id; uppercase normalization; invalid id rejected by the Mongo filter; exact replay; comparator and Mongo filter agree for valid ObjectIds.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
