# Project Priority 5 around actual Booked evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/bookingPriorityPairing.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/projections.md`

## Current operation and boundaries

Pairing describes evidence order, never triggers cases or official Bookings. Actual Booked snapshots pairing; Release preserves it; historical priority_5 does not become a live trigger. Order is captured_at then Observation id.

The priority_5_then_booked class requires Booked itself to carry canonical valid priority 5 as well as a preceding priority-5 Observation; otherwise the class is booked_without_priority_5 even if preceding evidence exists.

## Remaining recommendation

Keep pure projection and safe DTO conversion together; name preceding/carries/no-prior-5 branches clearly. Preserve stored class strings and null/absence semantics.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`BookingPriorityPairingClass`; `BookingPriorityPairingRef`; `BookingPriorityPairing`; `BookingPriorityPairingProjection`; `BookingPriorityPairingListItem`; `BookingPriorityPairingJobObservation`; `isCanonicalPriorityFive`; `projectBookingPriorityPairing`; `toBookingPriorityPairingProjection`; `toListPriorityPairing`

## Parity proof

Priority before/same/after Booked; id tie; Release-only null; Release append preserves pairing; exact replay and pairing alone never increment case_revision.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
