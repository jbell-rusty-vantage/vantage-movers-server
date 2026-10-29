# Show the evidence that opened an intake

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/creatingObservation.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/projections.md`

## Current operation and boundaries

Creating evidence is distinct from latest action. Booking intake accepts Booked and Release; old cancellation-intake rows remain readable. Projection includes Observation contact and identity, and returns the receipt statement after credential-key redaction; it is not a generally contact-masked projection or official write input.

## Remaining recommendation

Name evidence selection separately from snapshot projection. Retain historical readers without reviving cancellation-intake creation; never use first evidence in place of latest_action capability checks.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`BookingIntakeEvidenceAction`; `CreatingObservationSelection`; `BookingIntakeEvidenceItem`; `CreatingObservationSnapshot`; `BookingIntakeCreatingObservation`; `CreatingObservationCaseRow`; `CreatingObservationLoaders`; `selectCreatingObservationEvidence`; `selectReleaseCreatingObservationEvidence`; `getBookingIntakeCreatingObservation`; `getCancellationIntakeCreatingObservation`; `getIntakeCreatingObservation`

## Parity proof

Unsorted/equal-time evidence; Booked/Release selection; missing Observation/Decision; safe money context; historical read; no receipt payload or credentials.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
