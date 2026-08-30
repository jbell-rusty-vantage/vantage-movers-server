# JTE-05 live proof

Read-only masked proof against **`testvantagemovers`**. No production
confirm flag. Generated 2026-08-27. Job Numbers are aliased (`JOB-n`).
Machine JSON (gitignored): `scripts/output/job-number-timeline/proof-2026-08-27T21-09-24.021Z.json`.

Command:

```text
pnpm prototype:job-number-timeline -- proof --max-jobs 200 --warm-runs 12
```

| Fact | Value |
| --- | --- |
| Database | `testvantagemovers` |
| Jobs seen / scanned / ok pages | 75 / 75 / 67 |
| Count-stable | yes — every loader collection delta is 0 |
| Forbidden-field scan | pass on all 67 serialized pages |
| Activity grouping | preserves event counts on all 67 pages |
| Warm p95 | **471 ms** (55 warm samples; median 351 ms) |
| Writes | none |

Loader collection counts were identical before and after (including
`granot_release_reconciliation_cases` = 3, `cancelled_leads` = 25,
`ringcentral_processed_calls` = 0).

## §13.3 answers

### Each origin shape can render

Live `ok` pages in this database:

- `wordpress_born` — JOB-4 and many later WordPress-born pages
- `other` — JOB-1 and other unresolved / legacy-origin pages

Live `granot_born` and `ringcentral_born` pages were **not** present in
the 67 ok reads. `ringcentral_processed_calls` and
`ringcentral_call_log_sync_state` counts were 0. Those two origin shapes
still render from the v2 goldens (`goldenGranotRows`,
`goldenRingCentralRows`) under
`serialized v2 page contains no forbidden fields or contact`.

### At least one pre-Job-number Lead chain walks back

JOB-4: `lead_created`, `source_received`, `job_number_acquired`,
`granot_observation`. Coverage is not `job_number_at_create`. The Lead
row exists before the Job Number acquisition event. JOB-5 / JOB-6 are
the same shape with a Synchronization Decision added.

### At least one chain includes Booking intake and official Booking

JOB-8: `booking_intake` and `official_booking` on the same page
(outcome `cancelled`; official Cancellation is independently present).
JOB-9 is the booked variant of the same pair.

### At least one chain includes Cancellation intake

**Not present on any of the 67 live ok pages.** The test database has 3
`granot_release_reconciliation_cases` rows; none of the assembled pages
emitted a `cancellation_intake` event. The open-intake golden
(`goldenOpenCancellationIntakeRows`) still renders that event. This is
a test-data / correlation gap, not a new semantic. JTE-06 snapshot
correlation remains deferred.

### At least one historical chain includes official Cancellation

JOB-2 (`official_booking` + `official_cancellation`) and JOB-8 (same,
plus Booking intake).

### Activity grouping preserves event counts

`activity_grouping_preserves_counts: true` on every ok page.
`summary.event_count` equals `events.length`. Every `activities[].event_ids`
member exists on the page.

### Attention codes correspond to inspected source rows

JOB-9 attention `SHEET_SYNC_PENDING_TOO_LONG`:

| Field | Inspected value |
| --- | --- |
| Event | present |
| Kind | `sheet_sync` |
| Safe status | `pending` |
| Evidence refs | 1 |

That matches the evaluator: a live Sheet Sync row older than one hour.
No contact, Sheet ID, or raw error was read into the report.

Other live attention on this database is mostly `LEAD_UNRESOLVED` on
pages whose coverage.lead is unresolved (including zero-event job-scoped
rows). Those codes have no origin event to cite; they name the missing
Lead, not an invented one.

### No database collection count changes

Before and after counts matched for every collection the loader reads.
`collection_count_deltas` is `{}`.

### No forbidden data in serialized output

`assertPageSafe` plus the §12 token scan passed on all 67 live pages
and on all ten v2 goldens. Tokens asserted absent: `spreadsheet_id`,
`last_error`, `phone_raw`, `normalized_phone`, `email_raw`, `"body"`,
`transcript`, `recording_url`, plus fixture contact strings on goldens.

## What this proof did not do

- Production `vantagemovers` (no user approval, no confirm flag).
- A live `granot_born` or `ringcentral_born` page (absent from this
  test database).
- A live `cancellation_intake` event (absent from assembled pages).
- Any write, index apply, or notification.
