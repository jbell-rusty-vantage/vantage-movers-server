# Update Booking, confirm Cancellation, or resolve without a fact

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/bookingOwnerCommands.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/revisions.md`, `docs/knowledge/services/agent-allocation.md`, `docs/knowledge/services/domain-commands.md`

## Current operation and boundaries

Current exports include updateExistingBooking, noAction AND confirmCancellation. New cancellation work belongs to a booking case whose latest action is Release; Owner supplies official refund/date. Referral review may begin with Release, while Referral minting remains elsewhere.

## Remaining recommendation

Organize the existing behavior as three command stories. Share causal/policy/revision checks; leave officialCancellationWrite as the deeper atomic seam. Preserve stored command names, envelopes and Owner CTA policy.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`UPDATE_BOOKING_COMMAND_NAME`; `BOOKING_NO_ACTION_COMMAND_NAME`; `UpdateExistingBookingInput`; `BookingNoActionInput`; `ConfirmCancellationInput`; `assertBookingIntakeCancelAllowed`; `updateExistingBooking`; `noAction`; `confirmCancellation`; `isAcceptedReferralPolicyAction`

## Parity proof

Case/Booking stale revision; wrong latest action blocks cancel; replay/conflict; Leadless/Referral review; explicit refund/date and immutable cancellation snapshots; official-field replacement; No Action writes no official fact/outbox.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
