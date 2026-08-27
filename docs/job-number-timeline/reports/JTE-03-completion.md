# JTE-03 completion

Closed 2026-08-27 on `job-timeline-enhancement` in `vantage-main-server`.

The production module is the only evaluator of `current_outcome`,
`stage_assessments`, `attention`, `limitations`, `summary`, and
`freshness`. Admin was not started. The route still only calls
`createJobNumberTimelineModule({ loader }).read`.

## Outcome decision table

Specification §4.2 precedence — not last-event-wins. An intake case never
becomes the official outcome.

| Outcome | Fixture / builder | Job | Why |
| --- | --- | --- | --- |
| `cancelled` | `goldenCancelledRows` | `6004004` | Official Cancellation after official Booking |
| `cancellation_intake_open` | `goldenOpenCancellationIntakeRows` | `6004004` | Open release case + official Booking, no official Cancellation |
| `booked` | `goldenBookedRows` | `6004004` | Official Booking, no official Cancellation |
| `booking_intake_open` | `goldenWordpressRows` / `wordpressRows` | `9001001` | Open Booking intake, no official Booking |
| `lead_active` | `goldenGranotRows`, `goldenRingCentralRows`, `goldenResolvedBookingWithoutFactRows` | `8002002`, `7003003`, `5005006` | Resolved Lead, no official fact (or resolved case without fact) |
| `contradictory` | `goldenContradictoryChronologyRows` | `6004004` | Official Cancellation clock is before official Booking |
| `unknown` | observations-only `8802` | `8802` | Unresolved Lead and no official fact |

Cancellation via snapshot without a Booking (`7702`) is also
`contradictory` + `CONTRADICTORY_OFFICIAL_STATE` — incompatible official
facts. Intake-only shapes stay intake outcomes.

## Attention codes and the test that hits each

One server evaluator per specification §8 code. No extra attention codes.

| Code | Test |
| --- | --- |
| `LEAD_UNRESOLVED` | `unresolved lead without official fact is unknown and lead unresolved` |
| `BOOKING_CASE_RESOLVED_WITHOUT_FACT` | `resolved finalizing booking case without fact yields attention` |
| `CANCELLATION_CASE_RESOLVED_WITHOUT_FACT` | `resolved release case without cancellation yields attention` |
| `ORPHAN_CANCELLATION_REFERENCE` | `orphan cancellation without snapshot yields orphan attention` and `orphan cancellation is not attached without durable job snapshot` |
| `SHEET_SYNC_PENDING_TOO_LONG` | `sheet sync pending too long uses the module default threshold` (default `SHEET_SYNC_PENDING_TOO_LONG_MS` = 1 hour; no `process.env`) |
| `SHEET_SYNC_TERMINAL_FAILURE` | `terminal sheet failure yields sheet sync terminal failure` |
| `CONTRADICTORY_OFFICIAL_STATE` | `contradictory official chronology yields contradictory outcome` |
| `SOURCE_SCOPE_CONFLICT` | `disagreeing source scopes yield source scope conflict` |
| `PROCESSING_EVIDENCE_GAP` | `applied decision without entity change yields processing evidence gap` |

`ordinary booked job has no cancellation attention` proves an active
Booking without Cancellation work is `not_started`, not a gap.

## Limitation codes and the test that hits each

| Code | Test |
| --- | --- |
| `MULTI_QUERY_READ` | `move completion and multi query appear only as limitations` (always) |
| `MOVE_COMPLETION_UNAVAILABLE` | same; never a stage or event |
| `GOOGLE_DESTINATION_UNVERIFIED` | `synced sheet job still reports google destination unverified` (always; `freshness.google_destination_readback` stays `not_performed`) |
| `WORDPRESS_RECEIPT_UNAVAILABLE` | `wordpress-born golden includes wordpress receipt limitation` and `wordpress creation reports no invented receipt event` |
| `RINGCENTRAL_CURSOR_BOUNDED` | `ringcentral-born golden bounds confidence with the cursor` (`ringcentral_covered_through` + `ringcentral_cursor_lag_seconds`) |
| `TIMELINE_TRUNCATED` | `event cap returns explicit truncation limitation` (kept from JTE-02; not a §8 code; not silently dropped) |

## Golden pages for JTE-04

Row builders in `src/services/jobNumberTimeline/golden-pages.ts`. JTE-04
treats these as fixtures: run them through
`createJobNumberTimelineModule({ loader }).read` — do not recompute codes.

| Builder | Job | Outcome | Extra limitation / attention |
| --- | --- | --- | --- |
| `goldenWordpressRows` | `9001001` | `booking_intake_open` | `WORDPRESS_RECEIPT_UNAVAILABLE` |
| `goldenGranotRows` | `8002002` | `lead_active` | — |
| `goldenRingCentralRows` | `7003003` | `lead_active` | `RINGCENTRAL_CURSOR_BOUNDED` |
| `goldenBookedRows` | `6004004` | `booked` | delivery `unverifiable` even though Sheet is `synced` |
| `goldenCancelledRows` | `6004004` | `cancelled` | — |
| `goldenPolicySkipRows` | `5005005` | `lead_active` | engagement `not_applicable` |
| `goldenResolvedBookingWithoutFactRows` | `5005006` | `lead_active` | `BOOKING_CASE_RESOLVED_WITHOUT_FACT` |
| `goldenResolvedReleaseWithoutFactRows` | `6004004` | `booked` | `CANCELLATION_CASE_RESOLVED_WITHOUT_FACT` |
| `goldenContradictoryChronologyRows` | `6004004` | `contradictory` | `CONTRADICTORY_OFFICIAL_STATE` |
| `goldenOpenCancellationIntakeRows` | `6004004` | `cancellation_intake_open` | — |

`GOLDEN_EXPECTATIONS` and `ALWAYS_LIMITATION_CODES` document the filled
assessments. Every origin/outcome golden has seven stage assessments.

## Route seam

`src/routes/job-number-timeline-admin.routes.ts` remains authorize →
validate → `createJobNumberTimelineModule({ loader }).read` → respond.
Evaluators live in `outcome.ts` and `attention.ts`. The projector calls
them. No evaluation in the route.

On `ok`, `page` stays `EnhancedJobTimelinePage` with
`schema_version: "job_timeline.v2"`. Every v1 field and every JTE-02
event field remains.

## Named-test output

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  "src/services/jobNumberTimeline/**/*.test.ts" \
  "src/routes/job-number-timeline-admin.routes.test.ts"
# 63 pass, 0 fail

✔ text policy skip is not applicable rather than attention
✔ open booking intake yields active stage and no official booking
✔ resolved finalizing booking case without fact yields attention
✔ ordinary booked job has no cancellation attention
✔ resolved release case without cancellation yields attention
✔ official cancellation determines cancelled outcome
✔ contradictory official chronology yields contradictory outcome
✔ synced sheet job still reports google destination unverified
✔ wordpress-born golden includes wordpress receipt limitation
✔ ringcentral-born golden bounds confidence with the cursor
✔ move completion and multi query appear only as limitations
✔ event cap returns explicit truncation limitation
✔ v1 fields remain populated on enhanced events

pnpm test:prototype:job-number-timeline
# 6 pass, 0 fail

pnpm typecheck
# tsc --noEmit exit 0
```

JTE-01 and JTE-02 regressions still pass (45 prior focused tests plus
the new evaluator tests).

## What this issue did not do

- Admin UI, coverage-chip replacement, or evidence expansion — JTE-04.
- Notification delivery or acknowledgement.
- Google Sheets read-back. `google_destination_readback` stays
  `not_performed`.
- New attention codes beyond specification §8.
- JTE-06 snapshot writes or a production snapshot index.
- WordPress receipt writes — JTE-07.
- Move completion as a stage or event.

No Command, EntityChange, case, outbox row, or notification was produced.
Do not describe Admin UI as shipped.

JTE-01 residual stands: CLI company/granularity mismatch prints
`filtered_out` (exit 0). Not reverted.

JTE-02 residuals stand: module stamps `assembled_at` with
`input.now ?? new Date()`; RingCentral `source_received` is qualified
ledger statuses only; Mongo does not query orphan Cancellations by
snapshot (no field, no index — JTE-06).

## Files

New: `outcome.ts`, `attention.ts`, `evaluators.test.ts`.

Extended: `projector.ts`, `types.ts`, `golden-pages.ts`, `v2.test.ts`,
`index.ts`.

Seam unchanged: `createJobNumberTimelineModule({ loader }).read`.
