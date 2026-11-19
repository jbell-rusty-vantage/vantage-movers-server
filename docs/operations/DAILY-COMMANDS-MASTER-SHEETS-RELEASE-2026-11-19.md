# Daily Operations, canonical commands and Master Sheets

## November 19, 2026 production release

The release keeps the 400-day board history, durable command outcomes, immutable entity revisions and recoverable Sheet delivery in MongoDB. The job number timeline now reads major milestones on demand. Two Master workbooks retain their existing spreadsheet and tab identities. The [raw measurements](evidence/operations-command-sheets-workload.json) include the primary counters, BSON sizes, indexed query shapes, target-level operations and timing cohorts.

### Operating day and primary sample

November 18 ran from midnight to midnight in America/New_York, 05:00 UTC to 05:00 UTC. Use the business clock for day membership and the ObjectId creation cutoff for backlog eligibility. The peak is each collection’s busiest hour starting at the stated local time. The close columns are counts in 23:00 and 00:00 on the measured day. Stock is from November 19 around 17:32. MiB is 1,048,576 bytes. Full-day per-collection operation counters were unavailable. The last column counts primary reads/writes in a separate 826–829 second sample ending around 17:46 and includes the measurement queries. Idle-period throughput is unsuitable for daily extrapolation. [Stock and index counters](evidence/operations-command-sheets-baseline.json) · [Business-clock hourly breakdown](evidence/operations-command-sheets-business-day.json)

| Collection | Documents | Logical / allocated data / indexes, MiB | Day rows / BSON bytes | Peak count @ ET | 23:00 / 00:00 | Sample reads / writes |
|---|---:|---:|---:|---:|---:|---:|
| daily_operations_events | 276,615 | 179.08 / 83.11 / 147.46 | 674 / 462,533 | 100 @ 22 | 12 / 10 | 21 / 1 |
| domain_command_executions | 168,378 | 224.67 / 45.92 / 13.88 | 244 / 332,878 | 28 @ 11 | 4 / 5 | 5 / 0 |
| entity_changes | 178,766 | 215.68 / 33.84 / 35.19 | 374 / 758,733 | 50 @ 22 | 6 / 9 | 89 / 0 |
| sheet_sync_jobs | 164,269 | 70.33 / 14.78 / 12.29 | 173 / 76,816 | 25 @ 22 | 4 / 2 | 22 / 3 |
| sheet_sync_attempts | 459,876 | 130.45 / 18.30 / 30.89 | 520 / 151,215 | 75 @ 22 | 12 / 3 | 5 / 0 |

Day volumes measure retained records, including coalesced jobs and completed attempts. Enqueue requests, wire retries and MongoDB updates can exceed new records. The earlier active traffic study measured 75.8 entity-change reads/second over two minutes. Read the two sampling windows separately. [Active traffic study](../../../storage-capacity-analysis-2026-11-17/post-granot-2026-11-19/REPORT.md)

### Daily Operations and job number timeline

The board reads a bounded card page, a bounded milestone page, three day documents and current counts of held messages and open intakes. Keep the existing 60-second demand-driven refresh and coalesced rebuild. At continuous demand that permits up to 60 builds per key/hour. A 120-second interval would permit 30 and add up to a minute of waiting. Rebuilding on every fact would introduce up to 100 refresh triggers in the busiest measured hour. Frozen day totals and late-arriving evidence serve different reporting needs. The unique event key and atomic counter update prevent duplicate business facts. A late correction belongs to its original New York date and preserves the frozen close. An isolated replica verified the boundary and duplicate replay.

A rebuild from current Leads and official rows would read at least the day’s 75 Lead records and four Bookings, plus message, intake, disposition and delivery sources. Current records cannot recover every prior card or first link time. For an alternative GCS export the measured 674 cards gzip to 43,029 bytes from 462,533 BSON bytes. Retaining just the dedupe keys in MongoDB would take 83,518 BSON bytes plus the 3,661-byte day, before lookup indexes, object generations and late amendments. At this day’s mix times 400, the alternatives are 176.4 MiB of events versus 16.4 MiB of compressed objects and at least 31.9 MiB of hot keys, before day documents. The export would add an upload and verification per closed day, archive reads on historical access and a merge for late facts. Keep current history in MongoDB and omit the empty Redis cursor. New GCS requests and stored objects for this release are zero. [Measured scenario](evidence/operations-command-sheets-scenarios.json)

At close, November 18 had 65 ordinary Forms, nine Calls, four Bookings, zero Cancellations and 173 completed Sheet jobs. Compare revision 470, the projected frozen snapshot and all 674 ordered cards in the before/after evidence. The historical reconstruction fixes the report clock and holds both current-only gauges at zero.

The Admin job timeline now orders Lead arrival, the first supported job-number link and each official Booking and Cancellation. It uses the canonical Lead arrival clock, immutable link establishment or supported change evidence, official record creation and separately labeled business dates. A unique legacy match or official snapshot supplies only the history it supports. An official record can stand alone. Detailed consumers retain their existing evidence. Across four production examples, provider read commands and BSON reply bytes changed as follows.

| Job | Detailed reads / bytes | Milestone reads / bytes | Events before → after |
|---|---:|---:|---:|
| Open | 14 / 22,396 | 11 / 8,518 | 12 → 2 |
| Booked | 16 / 31,447 | 12 / 15,762 | 17 → 3 |
| Booked then cancelled | 17 / 36,469 | 12 / 13,216 | 19 → 4 |
| Leadless official Booking | 14 / 9,346 | 12 / 6,308 | 5 → 1 |

This four-request mix saved 14 MongoDB reads and 55,854 BSON response bytes. Milestone queries took 193–461 ms from the measurement client. The timeline previously read shared evidence on demand. Its simplification saves **zero event writes and zero retained event bytes**. The board field compaction below is a separate saving. [Production milestone dates and counts](evidence/operations-command-sheets-verified-before.json)

### Lead, Booking and Cancellation commands

Canonical command execution writes the acceptance, outcome references, warnings, actor/initiator, origin, checksum, causal references and business mutation transactionally. Lead, Booking and Cancellation commands, RingCentral admission, Granot lifecycle and Admin paths use this ledger. The unique origin/idempotency-key lookup returns the original outcome on exact replay and rejects changed checksums. Existing receipts may carry a nested outcome. New receipts use the equivalent top-level fields. Preserve the key, checksum and outcome for the lifetime of possible retries. An age-only deletion or a cold archive would require a permanent hot uniqueness fence plus a verified synchronous result lookup.

Canonical commands and the Lead change recorder append immutable revisions. Granot history and reference protection, the detailed timeline, Sales Intelligence history, Desk evaluation and assignment reconstruction read those revisions. Outreach tails the (applied_at, _id) cursor with a two-minute overlap and reconciles current revisions. Number Activity also tails changes for Lead-to-number link recovery. Live Desk subscribers consume relevant changes. Advancing either checkpoint alone cannot release evidence still needed by the other readers. Preserve all entity_changes without a new expiry. [Outreach feed](../../src/services/salesOutreach/subjects/feed.ts) · [Number Activity recovery](../../src/services/numberActivity/leadLinkJobs.ts)

The isolated replica tested replay, checksum conflict, concurrent command acceptance, revision races and rollback after partial writes. The Outreach recovery test compacted the original command after persisting its change cursor, resumed, picked up a late commit behind the cursor and verified revision reconciliation. A read-only production replay of 78 compacted outcomes across 13 command names returned 78 originals, rejected 78 changed payloads and executed zero business operations. RingCentral queue qualification, saved historical qualification and protected historical exceptions remain the admission rules. Official Booking and Cancellation rows retain independent reporting, including leadless outcomes. An isolated qualification suite covered admissions, exclusions and official reporting. [Production replay](evidence/operations-command-sheets-replay.json) · [Additional replay sample](evidence/operations-command-sheets-additional-replay.json) · [Reproducible checkpoint test](../../ops/sales-outreach/subjects.replica.ts)

### Master Leads and Master Booked

The transactional outbox coalesces pending and retrying intents with the same business identity. In-flight intents retain their lease and a subsequent correction gets its own recoverable work. Each drain reloads current business state and writes destinations before stale removals. Actual row IDs supersede cached row numbers. A missing source has no upsert and a delete tombstone retains previous targets. Confirmed outcomes update per-document metadata. Ambiguous structural writes stop that drain and the next worker rediscovers physical rows. Deleting old attempts or intents on acknowledgement alone would lose admin evidence or recovery context. Keep attempts and run history on their existing 90-day TTL, and keep jobs, tombstones, active leases, error information and historical job IDs in MongoDB. Completed jobs omit the spent lease, and successful attempts omit an empty Google reasons array.

The worker now fetches the header and Mongo ID column in one Google request per tab. A shifted legacy identity column needs a second read. Matching headers need no rewrite, and an unexpected managed layout prevents an unsafe upsert. Across the first 101 rows or fewer of each tab, the wide and narrow response values totaled 124,885 and 21,055 uncompressed UTF-8 bytes, including headers in the latter. The reduction is 103,830 bytes (83.1%) in this sample. The values are payload estimates, excluding HTTP/JSON envelope and compression. Cold correctly configured tabs also avoid the header clear and update. Deletes that resolve to a physical row incur an additional per-chunk identity and annotation check. Ordinary absent-row removals skip it.

Full identity reads covered Forms, Calls, Duplicate Forms, Duplicate Calls, Bad Form Leads, Bad Call Leads, Booked Deals and Cancelled Deals. Five recorded identities per tab matched the canonical collection and stored destination. Read-only comparisons examined 40 identities, including five Cancelled Deals in a baseline with zero new Cancellations. Two Bad Form Lead IDs and four Booked Deal IDs each occupied two rows. Protected ranges, notes, formulas, rich text and extra values were inspected before selecting those six for canonical delivery. [Eight-tab baseline](evidence/operations-command-sheets-verified-before.json) · [Repair eligibility](evidence/operations-command-sheets-duplicates-preview.json)

On November 18, 452 drain runs included 156 nonempty runs. All 173 jobs completed and produced 520 target outcomes, including stale-target deletes. These are not individual Google RPCs. At one batchable target per job, 173 independent calls become at best 29 batches of six or 18 of ten. Different tabs, job arrival times, mutations, quotas and uncertainty reduce that opportunity. Existing batching and coalescing already realize part of it. Keep the three-second default debounce, queue wakes, cron recovery and bounded drain (default 500 jobs). The largest observed drain completed five jobs in 1.955 seconds. Other runs completed four in 3.308 seconds and three in 3.658 seconds. The queue contained no pending work at baseline.

### Backlog and recurring capacity

Cutoff was November 19 at 17:32 ET, using the leading timestamp of the original ObjectId. The procedure uses primary identity checks, 500-ID ascending batches, majority writes and rechecks eligibility during update. It can restart from the same cutoff. Exact nested result equality and a command/origin allowlist exclude unusual result shapes and historical source-import admissions. All original record IDs survive. WiredTiger may reuse space internally. Billed or allocated disk savings require an independent later measurement. [Exact eligibility preview](evidence/operations-command-sheets-final-preview.json) · [Maintenance command](../../ops/capacity/compact-service-fields.cjs)

| Collection | Eligible rows / prior BSON bytes | Redundant bytes | Other rows / bytes at cutoff | Retention reason |
|---|---:|---:|---:|---|
| Daily Operations events | 216,499 / 145,496,644 | 3,680,483 | 60,116 / 42,283,606 | All 60,116 have real Redis stream IDs |
| Command receipts | 165,835 / 232,226,001 | 32,380,331 | 2,219 / 2,922,237 | Other commands, origins or distinct outcome shapes |
| Entity changes | 0 | 0 | 178,766 / 226,160,544 | Immutable revision, replay, assignment and feed obligations |
| Sheet jobs | 164,266 / 73,747,531 | 3,613,852 | 3 / 1,875 | Three cancelled jobs retain their historical lease |
| Sheet attempts | 459,876 / 136,790,008 | 9,657,396 | 0 | Outcome, real errors and original TTL stay queryable |

The one-time eligible total was 1,006,476 records and 49,332,062 bytes (47.05 MiB). Recurring gross savings at the November 18 mix are approximately 674 × 17 + 46,764 + 173 × 22 + 520 × 21 = 72,948 BSON bytes/day. A 40-character deployment SHA adds 64 bytes per nonempty worker run, or 9,984 bytes at 156 runs, giving an estimated **62,964 net bytes/day**. This depends on the incidence of null cursors, eligible outcomes and empty arrays. Transactional command and Sheet intent writes still occur. No extra MongoDB write is needed for the SHA on the existing run update. The one-time maintenance issues an update of each eligible record with the existing indexes in place.

### Index baseline and latency interpretation

The origin/key point lookup examined one key and one receipt. The entity-history sample examined five keys and five documents. The applied-time cursor used entity_change_applied_scan. The board page used the day/time/ID index and examined ten keys for ten results. The day/kind milestone index examined one key. Coalescing and due-job selection used their respective compound indexes, and three job attempts required three keys. Empty cursor and due-job samples establish chosen plans only. Index utilization counters are scoped to the named primary and reset at restart. The next phase owns collection-wide index analysis. [Execution statistics](evidence/operations-command-sheets-workload.json)

On the operating day, canonical creation to the durable board fact had median/p95 of 471/695 ms for 65 Forms, 138/405 ms for nine Calls and 142/158 ms for four Bookings. Canonical creation to Google write acknowledgement across 73 unambiguous initial Master deliveries was 93.379/264.074 seconds. All 173 enqueues to MongoDB-recorded success measured 102.313/260.152 seconds. The acknowledgement proves provider acceptance. First observable owner API or spreadsheet reads have a separate sampling clock.

### Applied cleanup and live stock

The first pass removed 49,259,511 bytes. A review of the held command names identified 546 additional in-scope updates, adoptions, sibling changes and deletions with the same exact replay representation. A second preview and apply removed 72,551 bytes. The 2,219 retained command shapes belong to external historical admission, RingCentral final-log recording or Granot case, discrepancy and Record Link reconciliation. [Second command preview](evidence/operations-command-sheets-command-extension-preview.json) · [Second apply](evidence/operations-command-sheets-command-extension-apply.json)

The independent preview of the same cutoff returned zero eligible records and zero bytes in all four field rules. All 178,766 immutable revisions remained queryable. The table shows live stock after cleanup. New activity between samples can change counts and sizes. [Main apply](evidence/operations-command-sheets-apply.json) · [Sheet jobs apply](evidence/operations-command-sheets-jobs-apply.json) · [Repeated preview](evidence/operations-command-sheets-final-residual.json) · [After stock and index counters](evidence/operations-command-sheets-final-stock.json)

| Collection | Documents after | Logical MiB | Allocated data MiB | Index MiB |
|---|---:|---:|---:|---:|
| daily_operations_events | 276,617 | 175.57 | 83.11 | 147.46 |
| domain_command_executions | 168,378 | 193.79 | 75.43 | 13.88 |
| entity_changes | 178,766 | 215.68 | 33.84 | 35.19 |
| sheet_sync_jobs | 164,269 | 66.89 | 24.47 | 21.70 |
| sheet_sync_attempts | 459,876 | 121.24 | 27.02 | 30.89 |

The eight-tab cell comparison also matched all 40 canonical managed projections, including historical escaped text interpreted by Sheets as USER_ENTERED. [Managed-value read-back](evidence/operations-command-sheets-canonical-rows.json)

Across the five collections, logical BSON fell from 860,061,472 to 810,730,470 bytes during live traffic. Allocated data increased 47.92 MiB and indexes increased 9.41 MiB, for a **57.33 MiB increase in allocated data plus indexes** during this window. This run reduced logical retention and future growth but did not recover physical disk capacity in the measurement. The spent-lease field has an index and field updates can dirty or split existing pages. The counters alone cannot assign the increase to individual operations. Carry these physical measurements into the next index and same-hour disk analysis.

Quota accounting reserves a MongoDB token for each provider operation. The header/ID lookup substitutes one token for the previous wide read. Skipping two header writes also skips their quota reservations. Each applied physical row-removal chunk now pays for one additional Google read and its quota reservation. A missing ID, the common stale-target pattern, costs zero row-inspection calls. Each failed or deferred target retains its attempt and retryable job. A lost structural response consumes an additional identity lookup on the subsequent drain.

### Release qualification

Production runtime commit `62653f03` passed CI typechecking, the server test suite, the production build and the built-function verification. The deployment is `dpl_7BBnNSRUYXZ31PnFxBQidrRRhU23`. Focused testing passed 44 provider/planner cases, 10 isolated Sheet replica cases, 11 Daily Operations replica cases, eight command transaction cases and six qualification cases. The isolated Granot lifecycle suites passed 83 and 25 cases. The Outreach tail resumed from its original checkpoint after command compaction. Interruption after Google acceptance, lease takeover, a superseded correction, deleted sources and an annotated duplicate were exercised in testing. [Runtime deployment](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44634240765)

The signed production board returned 80 of 80 traceable cards per sampled read. The frozen snapshot and ordered-card digests both matched the pre-compaction values. Four signed API responses agreed with canonical milestone IDs, dates and clock sources for open, booked, booked-then-cancelled and leadless official jobs. Production health, database identity and the authenticated day-close handler returned 200. The Vercel alias and recovery worker agreed on the runtime deployment ID and SHA. [Vercel alias](evidence/operations-command-sheets-runtime-alias.json) · [Signed serving check](evidence/operations-command-sheets-serving.json) · [After read-back](evidence/operations-command-sheets-verified-after.json) · [Worker, database and day-close probes](evidence/operations-command-sheets-worker.json)

At 18:18:15 ET the durable outbox accepted six repairs. The 18:20 cron worker on this SHA claimed and completed all six in 6.471 seconds. The oldest queued job reached 113.570 seconds from enqueue to terminal acknowledgement. All six returned exactly one physical identity and matched every managed cell. Both workbooks then had zero duplicate IDs across the eight complete identity columns. The final queue had zero pending, retrying, processing or failed jobs. [Applied repairs](evidence/operations-command-sheets-duplicates-apply.json) · [Fresh duplicate scan](evidence/operations-command-sheets-duplicates-after.json)

| Production visibility interval | Median | p95 | Sample |
|---|---:|---:|---|
| Durable repair enqueue to first Google read showing a single row | 111.255 s | 121.718 s | Six actual Sheet repairs |
| Durable repair enqueue to first signed board read showing completion | 132.754 s | 132.849 s | Same six |
| Terminal Sheet job to first signed board read showing completion | 19.304 s | 19.357 s | Same six |
| Board fact to first signed board read showing completion | 19.298 s | 19.350 s | Same six |

The ten-second polling interval makes these first-observation upper bounds. Median averages the two middle values and p95 uses nearest rank on these six observations. Business-day acknowledgement figures above use their recorded empirical quantile order statistics. The six repairs updated existing records and supply no new customer milestone. [Google first observations](evidence/operations-command-sheets-repair-latency.json) · [Board first observations](evidence/operations-command-sheets-board-repair-lag.json)

**Daily Operations and timeline** are deployed and verified for historical accuracy, canonical milestones and live board delivery. The 17:49–18:20 New York observation window yielded no new qualifying Lead, official event or first job link visible to the change monitor. Production canonical-change-to-first-visible percentiles for those natural milestones therefore remain open. The exact remaining measurement is a monitor spanning a fresh job link or official record, and a fresh Lead for the business-arrival board sample. On a loopback replica, 32 newly majority-committed official Bookings appeared on their first milestone read, in 7.59 ms median and 18.20 ms p95. This covers the same timeline module and excludes HTTP, production load and human refresh time. [Natural activity sample](evidence/operations-command-sheets-natural-window.json) · [Replica timing](evidence/operations-command-sheets-replica-visibility.json)

**Lead, Booking and Cancellation commands** are deployed and qualified for replay, conflicts, rollback, qualification and checkpoint recovery. **Master Sheets** are deployed and qualified across all eight tabs, including the six live repairs. The worker-interruption and stale-correction proofs used an isolated replica and workbook. A naturally occurring busy-window sample can refine latency distributions. The next capacity assignment owns collection-wide index work and realized physical disk growth.
