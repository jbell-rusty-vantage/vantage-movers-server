# Build the v2 Owner timeline page

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/jobNumberTimeline/projector.ts`
- Knowledge: `docs/knowledge/services/job-number-timeline.md`

## Current operation and boundaries

projectEnhancedPage wraps assembled v1 evidence into job_timeline.v2, assigns activities/causality, evaluates outcomes/attention/freshness, and applies event-cap truncation with explicit omitted counts. Grouping never deletes evidence; Booking/Cancellation keep independent activity identity.

## Remaining recommendation

Keep one page projection above the pure evaluators. Name assignActivityIds/applyCausality/truncationLimitation by their observable output; retain module interface and server-owned decision arrays.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`ProjectEnhancedPageInput`; `projectEnhancedPage`

## Parity proof

V1 fields retained; dual clocks; deterministic groups; official facts separate; 250 cap with TIMELINE_TRUNCATED/counts; assembled_at injection and safe serialized golden pages.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
