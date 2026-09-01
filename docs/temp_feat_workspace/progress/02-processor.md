# Phase 2 — Processor: Release → booking case; retire Release owner open

**Branch:** `lead-lifecycle`  
**Status:** done  
**Date:** 2026-09-01

## Files changed

- `src/services/granotLifecycle/processor.ts`
- `src/services/granotLifecycle/processor.test.ts`
- `docs/temp_feat_workspace/BOARD.md`

Not committed. No production flags. FINAL SPEC untouched. Replica persist / booking-case confirmCancellation / admin / knowledge docs not in this phase.

## What landed

### Processor gate (`maybeReconcileBooking`)

- Replaced the Booked-only `actualBooked` guard with spec §6.1: `booked` **or** `release`, plus job number and invalid/unsupported checks.
- Booking gates stay `booking_reconciliation` / `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED`. Release case/command flags were not enabled.

### Release owner path

- **Removed** the `maybeReconcileRelease` call and the function itself. No shim remains.
- `createGranotReleaseReconciliation` is no longer invoked from the processor.
- `reconcileRelease` may still be injected on deps; it is never called.
- Identity / Record Link / Job / Source Scope conflicts still open the matching discrepancy (`release_*` or `booked_*`). Missing Booking + Release is not `release_without_vantage_booking`.

### `already_current`

- `maybeReconcileBooking` now special-cases `kind: "already_current"` the same way the old Release path did: outcome `already_current`, reason `booking_already_cancelled`, Booking or Cancellation target, empty effects. Returns that Decision. Does not fall through to lead create/sync.

### Discrepancy kind

- `booking_discrepancy_required` routes `discrepancy_kind` from the reason prefix: `release_*` → `"release"`, otherwise `"booking"`. Does not invent `release_without_vantage_booking`.

### Early return

- Existing Booked early-return (`if (bookingResult) return bookingResult`) now applies to Release-on-case. Opening or refreshing a booking case does not also `synchronizeLeadFromGranot` on that Observation.
- Priority 5 still never opens or refreshes a booking case (AC-18 / AC-R11).

## Tests added / rewritten

Kept:

- `[AC-18] processor does not invoke Booking reconciliation for Priority 5`
- `[AC-18] Priority 5 with booking cases enabled still applies lead desired-state`

Rewritten:

- `[AC-25][AC-26][AC-27][AC-P5]` — live + `booking_cases_enabled` Release invokes `reconcileBooking` (reasons `booking_case_opened` / `booking_case_refreshed`), not `reconcileRelease`. Disabled booking gate does not invoke `reconcileBooking`.
- `[AC-26][AC-27][AC-36][AC-R6]` — Release identity conflict goes through `reconcileBooking` → `booking_discrepancy_required` + `release_record_link_conflict`; discrepancy module opens a **release** discrepancy; no `release_without_vantage_booking`.

Added:

- `[AC-R4]` officially cancelled Booking + Release → `already_current` / `booking_already_cancelled` via `reconcileBooking`; no Release case; no `release_without_vantage_booking`.
- Release booking-case early-return does not invoke `synchronizeLeadFromGranot` on open or refresh.

`processor.replica.test.ts` had no Release-case-open assertions. `releaseReconciliation.test.ts` historical module tests were not rewritten.

## Command + result

```
pnpm exec node --import tsx --test src/services/granotLifecycle/processor.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts src/services/granotLifecycle/bookingIntakeLatestAction.test.ts src/services/granotLifecycle/discrepancies.test.ts
```

71 passed, 0 failed, 1 skipped (pre-existing replica opt-in).

```
pnpm exec tsc --noEmit
```

clean. No new tsc errors.

## Follow-ups for Phase 3

- Replica persist tests AC-R1, AC-R2, AC-R7, AC-R8 (`bookingReconciliation.replica.test.ts`).
- Processor now routes live Release to `reconcileBooking`; replica proofs should exercise persist through that path (Booked then Releas on one case; Releas first then Booked; sequence+1 after resolve; exact Observation replay).
- Do not rewrite historical `releaseReconciliation` module tests unless a leftover processor call still opens Release cases (it does not).

## Spec notes (not contradictions)

- `maybeReconcileRelease` was removed rather than shimmed. Spec §4.14 / §6.1 prefer that.
- No Release case/command flags were flipped to make a test pass (§4.16).
- No contradiction that required stopping.
