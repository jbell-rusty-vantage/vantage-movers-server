# Phase 8 — Knowledge docs + spec promotion

**Branches:** `vantage-main-server` `lead-lifecycle`; `vantage-admin` `lead-lifecycle` (no admin file change)  
**Status:** done  
**Date:** 2026-09-01

Not committed. No production flags. FINAL SPEC untouched. No runtime code.

## Spec promotion

Copied `docs/temp_feat_workspace/release-into-booking-intake-specification.md` → `docs/granot-lead-lifecycle/release-into-booking-intake-specification.md` so `spec-hub.md` and `release-into-booking-intake.md` links resolve. Left the temp copy in place (mission workspace). Did not edit FINAL SPEC.

## Files updated (`vantage-main-server`)

- `docs/knowledge/granot-lifecycle/processor.md` — booking-case gate is Booked or Release; `maybeReconcileRelease` removed; early-return on open/refresh/`already_current`; cancelled Booking + Release is `already_current` / `booking_already_cancelled`; identity `release_*` still open.
- `docs/knowledge/granot-lifecycle/booking-reconciliation.md` — trigger table includes Release; `latest_action`; evidence `booked|release`; Confirm Granot Cancellation on booking case; pairing Booked-only; missing Booking is not `release_without_vantage_booking`.
- `docs/knowledge/granot-lifecycle/release-reconciliation.md` — owner surface retired; historical HTTP routes; migrate helper `scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.ts` (not claimed applied).
- `docs/knowledge/granot-lifecycle/projections.md` — default list booking-only; `latest_action`; `capabilities.confirm_cancellation`; creating-observation booking-first for Owner Intakes.
- `docs/knowledge/granot-lifecycle/live-receipts.md` — `observation_id`, `intake_link`, `receipt_updated`; join by evidence Observation id; index defined, not applied to prod.
- `docs/knowledge/granot-lifecycle/spec-hub.md` — `generated.at` refreshed; canonical spec path unchanged.
- `docs/knowledge/granot-lifecycle/release-into-booking-intake.md` — pointer now says Service docs describe current behavior.
- `.cursor/rules/granot-lifecycle-capture.mdc` — module table no longer claims Release reconciliation opens owner work.

## Skipped (already accurate)

- `CONTEXT.md` — glossary already restated (Granot Booking Reconciliation Case from Booked or Release; Release case retired; Confirm Granot Cancellation on a booking case; no `release_without_vantage_booking` for missing Booking). No new nouns.
- `vantage-admin/uxdocs/live-events-tab-specification.md` — already pointers Part B to the Release-into-intake spec and says that spec **does** require server DTO/`receipt_updated`. Tab-move “No server change” is still only about the sidebar move.

## Documented deltas (this spec wins; FINAL SPEC not merged)

1. FINAL SPEC §20 / AC-27: no Booking → `release_without_vantage_booking`. Code: booking intake; do not open that reason for missing Booking.
2. FINAL SPEC AC-40: Booking and Release cases may both stay open. Code: one open booking intake; processor does not open Release cases.
3. FINAL SPEC §1 owner surface: Release Reconciliation. Code: historical only; new Release lands on the booking case.
4. Booked-only AC-P5: `opposite_action_kind`. Code: Release writes booking-case evidence.
5. Confirm Granot Cancellation for new work is on `/booking-cases/:id/confirm-cancellation` (Release-case route remains historical).

## Follow-ups (operators; not this phase)

- Run the Release-case migrate helper when authorized (`--confirm-production` matching the connected name).
- Apply `granot_booking_case_evidence_observation_id` via the existing indexes CLI.
- Do not enable production lifecycle effect flags from this work.
