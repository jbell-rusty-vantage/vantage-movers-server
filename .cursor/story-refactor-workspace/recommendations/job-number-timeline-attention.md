# Explain evidence gaps, limitations and freshness

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/jobNumberTimeline/attention.ts`
- Knowledge: `docs/knowledge/services/job-number-timeline.md`

## Current operation and boundaries

Evaluators return server-owned attention/limitation/freshness arrays. Always retain MULTI_QUERY_READ, MOVE_COMPLETION_UNAVAILABLE and GOOGLE_DESTINATION_UNVERIFIED; synced outbox is not Google readback. WordPress limitation clears only for WordPress receipt evidence.

## Remaining recommendation

Group evaluators by named code and retain separate attention versus limitation versus freshness decisions. hasProcessingEvidenceGap is a current exported seam that caller migration must include.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`SHEET_SYNC_PENDING_TOO_LONG_MS`; `evaluateAttention`; `evaluateLimitations`; `evaluateFreshness`; `hasProcessingEvidenceGap`

## Parity proof

Pending threshold boundary; terminal failure; missing official Booking after Cancellation; contradictory facts; WordPress receipt-specific clearing; RingCentral cursor lag; truncation; no move-completed fact or Google equality claim.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
