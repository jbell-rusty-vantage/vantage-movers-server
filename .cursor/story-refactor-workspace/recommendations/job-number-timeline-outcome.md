# Decide current official outcome and stage assessments

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/jobNumberTimeline/outcome.ts`
- Knowledge: `docs/knowledge/services/job-number-timeline.md`

## Current operation and boundaries

Outcome uses domain precedence, not last event wins. Intake is not official Booking/Cancellation. Snapshot-correlated Cancellation with missing Booking remains cancelled plus attention, not contradictory; delivery remains unverifiable without Google readback.

## Remaining recommendation

Keep evaluateCurrentOutcome, assessStages and headline/status helpers pure. Name per-stage assessment by expectation, preserving exact reason codes/headlines and absence versus contradiction.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`STAGE_REASON`; `OUTCOME_HEADLINE`; `officialFactsContradict`; `evaluateCurrentOutcome`; `outcomeHeadline`; `isPolicySkipMessage`; `assessStages`; `stageState`

## Parity proof

Official Booking/Cancellation precedence; intake-only; missing Booking after Cancellation; genuinely contradictory facts; policy-skipped messaging; delivery unverifiable; unknown/unverifiable stages.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
