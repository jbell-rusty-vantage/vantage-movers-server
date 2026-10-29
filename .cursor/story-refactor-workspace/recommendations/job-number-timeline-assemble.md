# Assemble the Job Number chain from durable rows

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/jobNumberTimeline/assemble.ts`
- Knowledge: `docs/knowledge/services/job-number-timeline.md`

## Current operation and boundaries

Pure assembly correlates the first-hop job, walks linked evidence, and emits deterministic events. WordPress source_received requires an actual receipt, RingCentral requires accepted processed-call ledger status, and a Cancellation can recover job correlation through its immutable snapshot when Booking no longer exists.

## Remaining recommendation

Keep assembleJobNumberTimeline as the deep operation. Name first-hop, Lead resolution and evidence emission by domain stage, preserving snapshot-only Cancellation recovery and no invented Booking/ingress. module.read owns loading/redaction; this file must not become the Granot forensic timeline.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`assembleJobNumberTimeline`; `hasSuccessfulLeadMessage`

## Parity proof

Golden chains for Form/Call/Leadless/Referral; source evidence unavailable; snapshot-only cancellation found/cancelled; orphan without snapshot refused; stable sort/cap and no invented official fact.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
