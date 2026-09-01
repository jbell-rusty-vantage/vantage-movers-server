# Mission: Release into Booking Intake

**Authority:** [`release-into-booking-intake-specification.md`](./release-into-booking-intake-specification.md)  
**Stop when:** every AC in spec §13 has an automated test, `/intakes` has one queue, Releas upserts onto that queue, and Live Events shows **Open booking intake** only for receipts whose Observation is on that case.

## Orchestration

The parent agent launches **one subagent at a time**. Each subagent:

1. Reads this file, [`BOARD.md`](./BOARD.md), the specification, and the previous phase's progress note.
2. Implements **only** its assigned phase.
3. Writes a progress note under `progress/` and updates `BOARD.md` before finishing.
4. Does **not** commit, push, or enable production flags.
5. Does **not** edit `FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`.

## Authority order (do not silently merge)

1. This specification (wins on Release routing, booking-intake upsert, cancellation-intake retirement, Confirm Granot Cancellation on a booking case, Live Events intake link, §8 / §14 copy).
2. [`docs/granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md`](../granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md) — still wins on Priority 5, pairing, AC-18 / AC-P1–P4 / AC-P6–P8. **AC-P5 is superseded.**
3. [`docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md`](../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) — Binder, optional Lead, Confirm without Lead, Connect Booking to Lead.
4. FINAL SPEC — uniqueness, revisions, Referral, official-field blankness, identity-conflict discrepancies. No longer wins on §20 Release owner surface, AC-27, AC-40 both-cases-open.
5. [`CONTEXT.md`](../../../../CONTEXT.md) — glossary terms only.

## Branches

- `vantage-main-server`: create or reuse `lead-lifecycle` from current `main`. Stack commits later if asked; do not commit unless the user asks.
- `vantage-admin`: create or reuse `lead-lifecycle` from current `main` when that repo is first edited (Phase 5+).
- Extension is out of scope.

## Glossary (use these words)

Granot Booking Action, Granot Booking Reconciliation Case, Confirm Granot Cancellation, Update Existing Booking, No Action, Granot Observation Receipt, Granot Observation, Granot Release Reconciliation Case (historical only), Granot Release Discrepancy.

Do **not** say Granot cancelled. Do **not** invent cancellation intake as a new noun.

## Phases

| Phase | Work | Progress file |
| --- | --- | --- |
| 1 | `selectBookingIntakeLatestAction` + classifier + persist evidence_action + AC-P5 / AC-R1–R6 unit tests | `progress/01-classifier-latest-action.md` |
| 2 | Processor: Release → `maybeReconcileBooking`; disable `maybeReconcileRelease` owner path | `progress/02-processor.md` |
| 3 | Replica persist tests AC-R1, AC-R2, AC-R7, AC-R8 | `progress/03-replica-persist.md` |
| 4 | Booking-case `confirmCancellation` + AC-R9 | `progress/04-confirm-cancellation.md` |
| 5 | Projections + creatingObservation + Admin `/intakes` tab/copy (AC-R10) | `progress/05-projections-admin-intakes.md` |
| 6 | Historical Release-case migrate helper (§10) | `progress/06-migrate-release-cases.md` |
| 7 | Live Events `intake_link` + SSE `receipt_updated` + Admin link (AC-L1–L5) | `progress/07-live-events.md` |
| 8 | Knowledge docs in spec §16 + promote spec pointer | `progress/08-docs.md` |

## Forbidden

- Production flag changes / enabling later effects to make a test pass.
- Auto Booking / auto Cancellation / prefilling official money from Granot.
- Dropping `granot_release_reconciliation_cases` or Release HTTP routes.
- Linking Live Events by `job_no` alone.
- Rewriting FINAL SPEC.
- Opening a second server or admin branch.
