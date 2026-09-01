# Phase 3 — Replica persist AC-R1, AC-R2, AC-R7, AC-R8

**Branch:** `lead-lifecycle`  
**Status:** done (tests written + skip-safe)  
**Date:** 2026-09-01

## Files changed

- `src/services/granotLifecycle/bookingReconciliation.replica.test.ts`
- `docs/temp_feat_workspace/BOARD.md`

Not committed. No production flags. FINAL SPEC untouched. Production persist / processor / confirmCancellation / admin / projections / knowledge docs not in this phase.

## Fixture gap (test-only)

`seedEvidence` now accepts `bookingAction: "booked" | "release" = "booked"` and an optional synthetic Booking hook `{ id, has_lead, officially_cancelled, referral }`.

`replicaStore().loadCurrentContext` reads `booking_action` from the Observation document (no longer hardcoded `"booked"`) and attaches `synthetic_booking` when seeded. Existing Booked replica tests stay on the default.

No production persist or store behavior changed. No Phase 1 bug found.

## Tests added

Same `replicaReady` skip pattern (`GRANOT_LIFECYCLE_REPLICA_TESTS=true`, TEST_MODE db, replica set).

- **[AC-R1]** Booked opens `create_missing_booking`; later Releas appends Release evidence on the same open case; `evidence_revision` +1; `case_revision` unchanged; `selectBookingIntakeLatestAction` → `"release"`; mode stays create-missing. `granot_release_reconciliation_cases` for the job stays 0.
- **[AC-R2]** Releas first opens create-missing with Release evidence and no pairing. Later Booked refreshes the same case; evidence has both actions; latest Booked exists. Pairing then computes (`booked_without_priority_5`) because this store inherits production `listJobObservations`. `preferred_booked` creating-observation wiring is Phase 5 — not asserted here.
- **[AC-R7]** After resolve (existing `$set` pattern), later Releas opens `sequence+1`. Create-missing when no Booking. Review when a synthetic active Booking is attached (`deterministic_booking_id` set). No Release case row either way. Historical Release case is not refreshed (count stays 0).
- **[AC-R8]** Exact same Release Observation replay returns `kind: "refreshed"` (same convention as Booked replay). Evidence length and `evidence_revision` do not increase. One Decision for that `observation_id`.

Kept: AC-18 / AC-20 / AC-28 / AC-P8 replica tests (skip-safe, unchanged assertions).

## Command + result

```
pnpm exec node --import tsx --test src/services/granotLifecycle/bookingReconciliation.replica.test.ts
```

10 skipped, 0 failed. Skip reason: `TEST_MODE` is not `true` before process start (`replicaReady` refuses non-`testvantagemovers` DBs). Did not invent a replica set. Did not run against production Mongo.

`.env` has `GRANOT_LIFECYCLE_REPLICA_TESTS=true`, but `TEST_MODE` is false, so the first gate that would connect still fails closed on the test DB name. Live replica commit is **not claimed**.

```
pnpm exec node --import tsx --test src/services/granotLifecycle/bookingReconciliation.test.ts src/services/granotLifecycle/bookingIntakeLatestAction.test.ts
```

28 passed, 0 failed. Fixture-only replica-file changes did not break unit persist.

```
pnpm exec tsc --noEmit
```

clean.

## Follow-ups for Phase 4

- Booking-case `confirmCancellation` (spec §6.5 / §7) + AC-R9.
- Succeeds only for AC-R3 posture: open `review_existing_booking`, deterministic Booking still active, `latest_action === "release"`, `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED`.
- Create-missing + latest Release must 409/422 and write no Cancellation.
- Replay idempotency on confirm-cancellation (`bookingOwnerCommands` / replica).
- Do not require Release case/command flags. Do not offer Confirm Cancellation on create-missing / create-referral.

## Spec notes (not contradictions)

- Replay “no-op” matches existing Booked replica convention: `kind: "refreshed"` without a second evidence row or revision bump. Persist does not return a dedicated no-op kind.
- AC-R2 pairing computed honestly via inherited `listJobObservations`. If a future synthetic store drops that method, pairing would stay null — do not fake it.
- No contradiction that required stopping.
