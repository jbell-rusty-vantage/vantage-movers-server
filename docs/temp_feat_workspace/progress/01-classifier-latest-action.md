# Phase 1 — Classifier + latest_action + persist evidence

**Branch:** `lead-lifecycle` (created from current `main`)  
**Status:** done  
**Date:** 2026-09-01

## Files changed

- `src/services/granotLifecycle/bookingIntakeLatestAction.ts` (new)
- `src/services/granotLifecycle/bookingIntakeLatestAction.test.ts` (new)
- `src/services/granotLifecycle/bookingReconciliation.ts`
- `src/services/granotLifecycle/bookingReconciliation.test.ts`

Not committed. No production flags. FINAL SPEC untouched. Processor / admin / replica / docs not in this phase.

## What landed

### Classifier (`classifyBookingReconciliation`)

- Deleted the `opposite_action_kind` return. `booking_action === "release"` is booking evidence.
- `evidence_action` is `context.booking_action` (`"booked" | "release"`), not hardcoded `"booked"`.
- Mode table matches spec §4.4 / §6.2:
  - No official Booking + non-referral → `create_missing_booking`
  - No official Booking + referral disposition → `create_referral_booking`
  - One active official Booking → `review_existing_booking`
  - Officially cancelled Booking + Release → `already_current` / `booking_already_cancelled`
  - Officially cancelled Booking + Booked → `booked_after_official_cancellation` (AC-26 / AC-R5)
- Identity `conflict` still returns `booking_discrepancy_required`:
  - Booked → existing `booked_*` via `discrepancyReason`
  - Release → `release_record_link_conflict` / `release_job_number_conflict` / `release_source_scope_conflict`
- Missing Booking + Release is not a conflict and does not open `release_without_vantage_booking`.
- Referral mismatch still uses today's `booked_booking_lead_conflict`.
- Leadless official Booking + Release opens `review_existing_booking`. Employee-origin Bookings still delegate to Employee Booking Lead Reconciliation.
- Priority 5 remains `not_booking_evidence` (AC-18).
- `"opposite_action_kind"` stays on the none-reason union but is unused.

### Persist

- `reconcileInTransaction` and `reconcileBookingCaseAfterDiscrepancy` accept `evidence_action` `"booked" | "release"`. Never invent `priority_5`.
- Release-only persist omits `priority_pairing` (does not throw). A later Booked on the same case computes pairing as today. A Release refresh does not wipe an existing pairing snapshot (`refreshCase` only `$set`s pairing when provided).
- `kind: "already_current"` writes a Decision (`already_current` / `booking_already_cancelled`) with Booking or Cancellation target. No case, no discrepancy.
- Decision reason codes stay `booking_case_opened` / `booking_case_refreshed`.
- Mongo context now loads `cancellation_id` when an official Cancellation exists (needed for the already-current Decision target).

### Helper (`selectBookingIntakeLatestAction`)

Pure helper in `bookingIntakeLatestAction.ts`. Ignores `priority_5` when any `booked` or `release` exists. Tie-break via `compareGranotTemporal` (Observation id hex). Empty → `undefined`. Not wired into projections (Phase 5).

## Tests added / rewritten

Rewritten:

- `[AC-40]` — suggestion/eligibility only. Release classification moved to AC-P5 / AC-R*.
- `[AC-P5]` — Releas/Release with no official Booking opens `{job, booked}` create-missing with `evidence.action === "release"`.

Added:

- Helper: empty, only `priority_5`, booked+release latest wins, same timestamp → higher hex, `priority_5` ignored when booked/release present.
- `[AC-R1]` Booked then Releas on the same open case; `evidence_revision` +1; `case_revision` unchanged; refresh; helper `latest_action === "release"`; pairing snapshot kept.
- `[AC-R2]` Releas first opens create-missing; later Booked refreshes; pairing then computes.
- `[AC-R3]` official active Booking + Releas → `review_existing_booking`, `evidence_action: "release"`.
- `[AC-R4]` officially cancelled + Releas → `already_current` / `booking_already_cancelled`; no case.
- `[AC-R5]` officially cancelled + Booked still `booked_after_official_cancellation`.
- `[AC-R6]` Release identity conflict → existing `release_*` reasons; no booking case.

Kept green: AC-18, AC-19, AC-P1–P4, AC-P6–P8 (pairing tests), plus existing AC-20 / AC-28 / AC-39 / leadless.

Also asserted Release referral create/review and Release on a Granot Leadless Booking → `review_existing_booking`.

### Command + result

```
pnpm exec node --import tsx --test src/services/granotLifecycle/bookingReconciliation.test.ts src/services/granotLifecycle/bookingIntakeLatestAction.test.ts
```

28 passed, 0 failed.

```
pnpm exec node --import tsx --test src/services/granotLifecycle/bookingPriorityPairing.test.ts
```

pairing tests passed (included in the earlier combined run: 38 passed).

```
pnpm exec tsc --noEmit
```

clean after fixing two test-only narrowing errors.

## Follow-ups for Phase 2

- Processor still calls `maybeReconcileRelease` first.
- `maybeReconcileBooking` still gates on `normalized === "booked"` (and still early-returns Release).
- Until Phase 2, live Release traffic will not reach this persist path. Unit tests call `reconcileObservation` directly.
- AC-R3 command capabilities / copy, AC-R2 creating-observation `preferred_booked`, and Live Events are later phases.

## Spec notes (not contradictions)

- Unmapped Release identity reasons (not record-link / job / source-scope) fall through to `not_booking_evidence`. The three mapped `release_*` reasons in AC-R6 are covered. Release module uses `identity_conflict_unmapped` for the same unmapped case; that none-reason is not on the booking union.
- Referral mismatch on Release still uses today's `booked_booking_lead_conflict` (spec: keep today's conflict discrepancy; no `release_booking_lead_conflict` exists).
- No contradiction that required stopping. This spec wins over Booked-only AC-P5 and FINAL SPEC AC-27 / AC-40 as written in §1.
