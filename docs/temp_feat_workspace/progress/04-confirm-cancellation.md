# Phase 4 — Booking-case Confirm Granot Cancellation (AC-R9)

**Branch:** `lead-lifecycle`  
**Status:** done  
**Date:** 2026-09-01

## Files changed

- `src/services/granotLifecycle/officialCancellationWrite.ts` (new)
- `src/services/granotLifecycle/releaseOwnerCommands.ts` (Release confirm now calls the shared writer)
- `src/services/granotLifecycle/bookingOwnerCommands.ts` (`confirmCancellation` + `assertBookingIntakeCancelAllowed`)
- `src/services/granotLifecycle/bookingConfirmation.ts` (result union: `cancellation_created` + `cancellation_ref`)
- `src/services/granotLifecycle/bookingReconciliation.ts` (re-export)
- `src/models/granotLifecycleSchemas.ts` (`cancellation_created` on booking-case outcomes)
- `src/routes/granot-lifecycle-admin.routes.ts` (`POST .../booking-cases/:id/confirm-cancellation`)
- `src/services/granotLifecycle/bookingOwnerCommands.test.ts` (new)
- `src/services/granotLifecycle/bookingOwnerCommands.replica.test.ts` (new)
- `src/routes/granot-lifecycle-admin.routes.test.ts`
- `docs/temp_feat_workspace/BOARD.md`

Not committed. No production flags. FINAL SPEC untouched. Admin UI / projections / Live Events / knowledge docs not in this phase.

Historical `POST .../release-cases/:id/confirm-cancellation` is unchanged and still wired to `releaseOwnerCommands.confirmCancellation`.

## Design

Extracted official-write + case-resolve CAS into `applyOfficialCancellationWrite` (`officialCancellationWrite.ts`).

Both paths call that helper after their own case load and gates:

- **Release (historical):** load Release case → `release_commands_enabled` → Release policy / identity / link → shared writer → resolve Release case.
- **Booking (new):** require `booking_commands_enabled` first → load open `review_existing_booking` case → booking-intake gates → booking identity / source / link → shared writer → resolve booking case.

Not copied: `createCancellationForVerifiedBookingInTransaction`, revision checks, already_satisfied chain, EntityChange, sheet intent. Release-case `confirmCancellation` remains for open historical Release cases.

`updateExistingBooking` and `noAction` on the booking case are unchanged.

## Gates (inside the transaction)

All required:

- `booking_commands_enabled` first → 422 `GRANOT_POLICY_BLOCKED` (does **not** require Release case/command flags)
- case `state === "open"` and `mode === "review_existing_booking"` (`loadOpenCase`)
- `selectBookingIntakeLatestAction(evidence) === "release"` (`assertBookingIntakeCancelAllowed`)
- deterministic Booking id present, still matches, official write then requires it active or exact already_satisfied
- existing official-field / identity / catalog checks from the shared writer

`create_missing_booking` and `create_referral_booking` fail closed (`GRANOT_CASE_REVISION_CONFLICT`) and write no Cancellation, even when `latest_action === "release"`.

Wrong latest action (e.g. Booked on review) is `GRANOT_CASE_REVISION_CONFLICT` (409). Did **not** add `INTAKE_POSTURE_CONFLICT`.

## Tests

**Unit** (`bookingOwnerCommands.test.ts`): `assertBookingIntakeCancelAllowed` — allow review+release; reject create-missing, create-referral, latest Booked, resolved.

**Route** (`granot-lifecycle-admin.routes.test.ts`): happy-path mock 201; create-missing posture 409 `GRANOT_CASE_REVISION_CONFLICT`; latest-Booked posture 409 `GRANOT_CASE_REVISION_CONFLICT`; extra body field 400. Historical Release confirm route still covered.

**Replica** (`bookingOwnerCommands.replica.test.ts`), `replicaReady` skip-safe:

1. AC-R3 posture + booking commands on, release flags off → official Cancellation + resolved booking case + same Idempotency-Key replay (`replayed` / same `command_execution_id`).
2. Create-missing + latest Release → 409, no Cancellation.
3. Review + latest Booked → 409 `GRANOT_CASE_REVISION_CONFLICT`, no Cancellation.
4. Booking commands off + release command flags on → 422 `GRANOT_POLICY_BLOCKED`, no Cancellation.

## Command + result

```
pnpm exec node --import tsx --test src/services/granotLifecycle/bookingOwnerCommands.test.ts src/services/granotLifecycle/bookingOwnerCommands.replica.test.ts src/services/granotLifecycle/bookingConfirmation.replica.test.ts src/services/granotLifecycle/releaseOwnerCommands.replica.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts src/services/granotLifecycle/bookingIntakeLatestAction.test.ts
```

57 passed, 24 skipped, 0 failed. Replica skips: `TEST_MODE` is not `true` before process start (same as Phase 3). Route + unit gates passed, including `[AC-R9] Owner booking-case confirm-cancellation`. Live replica commit is **not** claimed.

```
pnpm exec tsc --noEmit
```

clean.

## Follow-ups for Phase 5

- Projections: `capabilities.confirm_cancellation` true only for §7 review + latest Release. List `latest_action`. Default `/intakes` booking-only.
- Admin `/intakes`: one BookingIntakeWorkbench; three-command block on review+release; copy must not say Granot cancelled (AC-R10 / §8).
- `creatingObservation`: Release-only → `preferred_release`; Booked+Release → `preferred_booked`.
- Do not wire Live Events (Phase 7). Do not migrate historical Release cases (Phase 6).
