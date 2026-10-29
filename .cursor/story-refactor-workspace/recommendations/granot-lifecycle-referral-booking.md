# Create an official Referral Booking without a Lead

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/referralBooking.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/revisions.md`, `docs/knowledge/services/agent-allocation.md`, `docs/knowledge/services/domain-commands.md`

## Current operation and boundaries

Canonical and case-driven creation keep Owner/reviewed Referral authority, Booked-only minting, official input, atomic Booking/link/case/Change/Command/outbox. Release-first existing Referral review belongs to bookingOwnerCommands and never widens minting.

## Remaining recommendation

Distinguish canonical adapter from case-driven operation; name causal/catalog/link validation. Keep even-cent allocation and Leadless Referral identity without inventing source Leads.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`CREATE_REFERRAL_BOOKING_COMMAND_NAME`; `ReferralBookingInput`; `createReferralBookingCanonical`; `createReferralBooking`

## Parity proof

Booked-only mint; Referral policy; no source scope; active catalogs; replay/duplicate job race; no Form/Call creation; no observed money as official input; rollback before Sheets finalize.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
