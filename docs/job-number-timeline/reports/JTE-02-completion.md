# JTE-02 completion

Closed 2026-08-27 on `job-timeline-enhancement` in `vantage-main-server`.

## New event kind and priority

`source_received` is kind priority **5**, below `lead_created` (10). Oldest-first
origin therefore reads receipt then Lead when clocks collide. A stored Lead is
still `lead_created`. WordPress form creation never emits `source_received`.

Granot receipts emit only when a `granot_webhook_receipts` row is loaded for an
Observation already on the page. RingCentral emits only a processed-call ledger
row whose `callLeadId` is the resolved Call Lead and whose status is
`lead_created`, `lead_created_duplicate`, `lead_adopted`, or
`lead_adopted_duplicate`. `skipped` / `dry_run` rows are not origin events.

## Receipt, ledger, and cursor reads

Mongo + memory adapters both carry the new buckets.

| Source | Collection | What landed |
| --- | --- | --- |
| Granot Observation Receipts | `granot_webhook_receipts` | Batched by Observation `receipt_id`. Safe fields only: `captured_at`, `createdAt`, `route_event_class`, `observation_channel`, `channel_operation_kind`, `processing.state`. No `payload`, `headers`, or `processing.last_error`. |
| RingCentral processed-call ledger | `getRingCentralCollectionName("processedCalls")` | After Call Lead resolve, `{ callLeadId }`. Safe fields: `status`, `qualificationReason`, `firstProcessedAt`, `updatedAt`, `ingestionSource`, `duplicate`, `callLeadId`. Never phone, transcript, or recording. |
| Call Log cursor | `getRingCentralCollectionName("callLogSyncState")` | Singleton `{ key: "account" }`. Maps `lastSyncTo` / `lastSyncFrom` / `lastRunAt` / `lastRunStatus` onto `rows.call_log_cursor` so JTE-03 can publish freshness without reopening the adapter. `freshness.ringcentral_covered_through` is filled when present; `ringcentral_cursor_lag_seconds` stays `null`. |

Cancellation snapshot fields are mapped when already loaded (booking-linked
rows). The loader does **not** query `cancelled_leads` by
`normalized_job_no_snapshot` — the field does not exist in production and has
no index (JTE-02 §9). Assemble attaches snapshot orphans only when those rows
are injected (memory / tests). JTE-06 owns the write, index, and Mongo hop.

## Golden pages

Synthetic row builders in `src/services/jobNumberTimeline/golden-pages.ts`,
next to the module tests. JTE-03 and JTE-04 should reuse them.

| Builder | Job | Shape |
| --- | --- | --- |
| `goldenWordpressRows` | `9001001` | WordPress-born; no receipt event |
| `goldenGranotRows` | `8002002` | Granot-born; receipt + Lead + sheet job |
| `goldenRingCentralRows` | `7003003` | RingCentral-born; qualified ledger + Call Lead |
| `goldenBookedRows` | `6004004` | Official Booking chain |
| `goldenCancelledRows` | `6004004` | Official Booking then official Cancellation |

## §6 page-level fields stubbed for JTE-03

These types exist on every `ok` page. Evaluators are **not** shipped.

| Field | JTE-02 value | Owner |
| --- | --- | --- |
| `current_outcome` | `"unknown"` | JTE-03 |
| `summary.headline` | `""` | JTE-03 |
| `summary.origin_label` | source label or proof-shape placeholder | JTE-03 may replace |
| `summary.latest_activity_at` / `event_count` | derived from kept events | honest counts, not outcome |
| `summary.attention_count` | `0` | JTE-03 |
| `stage_assessments` | `[]` | JTE-03 |
| `attention` | `[]` | JTE-03 |
| `limitations` | `[]` except `TIMELINE_TRUNCATED` when the 250 cap drops rows | JTE-03 catalog; truncation is this issue |
| `freshness.consistency` | `"multi_query_best_effort"` | JTE-03 may emit `MULTI_QUERY_READ` |
| `freshness.ringcentral_cursor_lag_seconds` | `null` | JTE-03 |
| `freshness.google_destination_readback` | `"not_performed"` | stays |

Do not describe outcome, stage assessment, attention, or the limitation catalog
as shipped.

`assembled_at` / `freshness.mongo_read_at` are set after reads: the module
passes `input.now ?? new Date()`.

## Named-test output

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  "src/services/jobNumberTimeline/**/*.test.ts" \
  "src/routes/job-number-timeline-admin.routes.test.ts"
# 45 pass, 0 fail

✔ schema_version is job_timeline.v2 on ok pages
✔ source receipt and lead creation remain separate events
✔ wordpress creation reports no invented receipt event
✔ dual clocks order by occurred time and preserve recorded time
✔ related receipt decision change and sheet rows share activity id
✔ activity grouping does not remove original evidence events
✔ orphan cancellation is not attached without durable job snapshot
✔ cancellation snapshot restores exact job correlation
✔ event cap returns explicit truncation limitation
✔ serialized v2 page contains no forbidden fields or contact
✔ golden pages cover origin and official-fact shapes
✔ skipped ringcentral ledger row is not a source receipt
✔ v1 fields remain populated on enhanced events

pnpm test:prototype:job-number-timeline
# 6 pass, 0 fail

pnpm typecheck
# tsc --noEmit exit 0
```

Also ran spec §13.2 test 15 (`cancellation snapshot restores exact job
correlation`) because JTE-02 already reads snapshot fields when present.

## What this issue did not do

- Outcome precedence, stage-assessment labels, attention evaluators, limitation
  catalog, freshness lag semantics — JTE-03.
- Admin UI — JTE-04.
- Cancellation snapshot writes or a production snapshot index — JTE-06.
- WordPress receipt writes — JTE-07.
- Move completion.
- Querying Google.

No Command, EntityChange, case, outbox row, or notification was produced.

JTE-01 residual stands: CLI company/granularity mismatch prints `filtered_out`
(exit 0). Not reverted.

## Files

New: `projector.ts`, `evidence.ts`, `clocks.ts`, `golden-pages.ts`, `v2.test.ts`.

Extended: `types.ts`, `rows.ts`, `assemble.ts`, `module.ts`,
`mongo-evidence-loader.ts`, `index.ts`.

Seam unchanged: `createJobNumberTimelineModule({ loader }).read`.
