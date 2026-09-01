# Mission complete — Release into Booking Intake

**Date:** 2026-09-01  
**Branches:** `vantage-main-server` `lead-lifecycle`, `vantage-admin` `lead-lifecycle`  
**Authority:** [`release-into-booking-intake-specification.md`](../release-into-booking-intake-specification.md) (canonical copy: `docs/granot-lead-lifecycle/release-into-booking-intake-specification.md`)

Phases 1–8 are done. Nothing is committed. Production flags were not flipped. `FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md` was **not** edited.

## What shipped (all eight phases)

| Phase | What landed |
| --- | --- |
| 1 Classifier + latest_action | `selectBookingIntakeLatestAction`. Classifier accepts Release as booking evidence. Mode table includes cancelled Booking + Release → `already_current` / `booking_already_cancelled`. Identity `release_*` discrepancies still open. Missing Booking is not `release_without_vantage_booking`. |
| 2 Processor | Release → `maybeReconcileBooking`. `maybeReconcileRelease` removed (not shimmed). Early-return (no `synchronizeLeadFromGranot`) when a booking case opens/refreshes or is already current. |
| 3 Replica persist | AC-R1, AC-R2, AC-R7, AC-R8 written + skip-safe. Live replica commit not claimed (`TEST_MODE` off). |
| 4 Confirm Granot Cancellation | `POST .../booking-cases/:id/confirm-cancellation`. Shared official-write helper. Gates: open review + latest Release + booking commands. Create-missing + Release fails closed. Historical Release-case route kept. |
| 5 Projections + Admin `/intakes` | Default list booking-only. `latest_action`. `capabilities.confirm_cancellation`. Creating-observation `preferred_release` on Release-only booking cases. One Intakes tab. Copy never says Granot cancelled. |
| 6 Migrate helper | `scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.ts`. Discrepancies left historical. **Not applied to production.** |
| 7 Live Events | `observation_id` + `intake_link` (join by `evidence.observation_id`, never job_no). SSE `receipt_updated`. Admin **Open booking intake** iff `intake_link`. Index defined, **not applied to prod.** |
| 8 Docs | Knowledge Service files + software map updated to current code. Spec promoted to the canonical path. Pointers and `CONTEXT.md` already aligned. |

## Remaining operator steps

1. **Run the migrate helper** when authorized — `pnpm migration:granot-lifecycle:release-cases-into-booking-intake` with `--confirm-production` matching the connected name. Historical DB is refused. Does not write official Bookings or Cancellations.
2. **Apply the booking-case evidence index** `granot_booking_case_evidence_observation_id` via the existing granot-lifecycle indexes CLI. The definition is in the model catalog; production apply is a separate authorization.
3. **Do not enable production flags** from this work (`GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED`, `BOOKING_COMMANDS_ENABLED`, and the other effect flags stay as checked-in / separately authorized).
4. **Do not enable Release case/command flags** to route new owner work. New Release evidence uses the booking-case flags only.

## Tests vs live replica

Unit/route tests for AC-P5, AC-R1–R11 (command/route/unit), and AC-L1–L5 are written. Replica persist and confirm-cancellation replica files are skip-safe; they did not run against a live replica set in this mission (`TEST_MODE` was not `true` before process start).

## FINAL SPEC

Untouched. This spec wins on Release routing, booking-intake upsert, cancellation-intake retirement, Confirm Granot Cancellation on a booking case, and Live Events intake link. FINAL SPEC still wins on uniqueness, revisions, Referral, official-field blankness, and identity-conflict discrepancies. Those deltas are documented in the Service files and spec §1 — not silently merged.
