# Choose occurred and recorded clocks for each event

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/jobNumberTimeline/clocks.ts`
- Knowledge: `docs/knowledge/services/job-number-timeline.md`

## Current operation and boundaries

occurred_at comes from event.event_at. Recorded time uses evidence-specific fallback: WordPress receipt createdAt then received_at; Granot receipt createdAt then captured_at; RingCentral processed-call updatedAt then firstProcessedAt; each finally falls back to occurred_at. Other event kinds use their own evidence clocks. The comparator compares occurred_at strings lexically, then type priority and id; it does not parse dates.

## Remaining recommendation

Keep selection and comparison pure. Name receipt/processed-call lookup helpers by clock evidence; preserve null/unavailable and existing ISO serialization.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`selectEventTime`; `compareOccurredThenPriority`

## Parity proof

Missing/blank evidence clocks and fallback labels; lexical ordering of date-only versus instant strings; ingress receipt versus processed call; equal-time event priorities/id ties and stable chronological output.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
