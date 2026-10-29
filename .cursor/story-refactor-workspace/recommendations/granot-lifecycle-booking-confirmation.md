# Confirm a Booking with an optional eligible Lead

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/bookingConfirmation.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/revisions.md`, `docs/knowledge/services/agent-allocation.md`, `docs/knowledge/services/domain-commands.md`

## Current operation and boundaries

confirmBooking accepts optional selected_lead. resolveConfirmAttachment can choose unique high-confidence identity or an official Granot Leadless Booking. Owner supplies date/binder/deposit/merchant/agents; allocation splits cents server-side. Atomic command/Change/case/link/outbox writes precede finalize. Shared-job booking intake prefers Form.

The helper consumes one suggested Lead and auto-attaches only when confidence is high and match_method is allowlisted; uniqueness is established upstream, not checked by this helper. Owner selection wins.

## Remaining recommendation

Organize around the already-landed attached and Leadless branches. Name applyConfirmation, persistLeadlessConfirmation and causal/eligibility checks by outcomes. Keep resolveConfirmAttachment deep and persisted command/key/checksum formats stable.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`BookingOwnerCommandResult`; `ConfirmBookingInput`; `confirmBooking`

## Parity proof

Explicit selection/override; unique-high auto-attach; medium/none Leadless; failed CAS never falls back Leadless; shared-job Form preference; exact replay/checksum conflict; even-cent allocation and rollback before finalize.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
