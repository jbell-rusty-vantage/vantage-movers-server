# Load bounded job-correlated evidence without a scan

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/jobNumberTimeline/mongo-evidence-loader.ts`
- Knowledge: `docs/knowledge/services/job-number-timeline.md`

## Current operation and boundaries

Mongo loader fetches typed rows by job/link/Lead and immutable Cancellation job snapshot. Optional maxRowsPerQuery applies sentinel+1 and five-second bounds; overflow throws EVIDENCE_LIMIT_REACHED instead of partial assembly. Owner consumers retaining default bounds must preserve their current behavior.

## Remaining recommendation

Keep createMongoEvidenceLoader as the adapter seam and pure assembly elsewhere. Name rowReader and mapping helpers by bounded query/projection purpose. Preserve safe projections, selected runtime DB, indexed hops and optional caller-specific budget.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`JobTimelineMongoReadBounds`; `JobTimelineEvidenceLimitError`; `loadCompanyGranularityIds`; `loadJobNumberTimelineRows`; `createMongoEvidenceLoader`

## Parity proof

Exact cap/overflow; single-record lookups; company/granularity filtering; snapshot-only Cancellation first hop; receipt-by-lead; no unbounded collection scan or forbidden payload/transcript/phone/spreadsheet fields.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
