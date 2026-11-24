# Validated retirement: proposals for the Owner (November 23, 2026)

**Status: proposals only.** Nothing here is implemented, and nothing changes production without Owner approval. They answer Owner decisions 3, 7 and 8 ([decisions](SI-VALIDATED-RETIREMENT-RELEASE-2026-11-23.md#owner-decisions-for-next-session-2026-11-23-about-0055-new-york)) under the [validated retirement](../knowledge/validated-retirement.md) rule.

## Measurement

- **Where and when.** Production `vantagemovers`, read from a secondary on Nov 23 between 23:46 and 00:10 UTC, after the compaction in the [release record](VALIDATED-RETIREMENT-RELEASE-2026-11-23.md#compaction-owner-decision-4-nov-23-evening). Read-only scripts; nothing was written.
- **Units.** MB = 1,048,576 bytes.
  - *Logical* is BSON (`collStats.size`).
  - *Disk* is the compressed collection file plus its indexes, which is what Atlas bills against the 17.3 GB volume.
  - Insert rates come from `_id` timestamps per New York day.
- **Which rate.** The Oct 13–Nov 16 Granot re-snapshot incident (hourly cadence re-snapshots; [Nov 18 capacity record](DAYLIGHT-CAPACITY-AND-BOOKING-2026-11-18.md)) wrote most of today's stock. It stopped on Nov 17, so the **steady rate is Nov 17–22**. Bulk days (Nov 19 Granot re-import, Nov 20 Sheet resync) are shown separately. A 7-day average that includes Nov 16 overstates growth 3–10×.

| Collection | Rows | Logical MB | Disk MB (file + index) | Steady rows/day, Nov 17–22 | Retention today |
| --- | --- | --- | --- | --- | --- |
| `daily_operations_events` | 280,756 | 178.1 | 43.2 + 72.3 | 241–674 (bulk day 2,872) | TTL 400 d |
| `sheet_sync_jobs` | 167,130 | 68.1 | 15.7 + 13.0 | 74–173 (bulk day 2,491) | permanent |
| `sheet_sync_attempts` | 469,610 | 123.8 | 18.3 + 31.6 | 361–520 (bulk day 8,043) | TTL 90 d |
| `sheet_sync_runs` | 107,868 | 24.9 | 5.3 + 6.7 | 360–452 | TTL 90 d |
| `entity_changes` | 179,857 | 217.6 | 34.2 + 34.1 | 147–374 | permanent |
| `domain_command_executions` | 169,137 | 194.7 | 48.3 + 13.9 | 59–347 | permanent |
| `granot_observations` | 6,812 | 7.1 | 2.2 + 26.9 | 39–155 (bulk day 6,018) | retire on use, held |
| `synchronization_decisions` | 6,987 | 8.4 | 1.6 + 3.7 | 29–212 | retire on use, held |
| `granot_booking_reconciliation_cases` | 675 (621 resolved, 54 open) | 1.1 | 0.4 + 0.4 | about 5 | permanent |

**Capacity context.** Disk is 22.8–23.1% used (about 4.0 of 17.3 GB per member). Everything on this page totals about 370 MB on disk, about 2% of the volume. **None of these is urgent for capacity.** Their value is the standing directive: storage that stays bounded as volume grows, smaller indexes in RAM, and no incident stock kept for a year.

## 1. `daily_operations_events` (decision 3)

**What the readers need** (code inventory, Nov 23):
- The board, the events page, rebuild and the live stream read **today only** (`readView.ts:17-31`, `eventsPage.ts:131,224-249`, `rebuild.ts:89,94`, `liveStream.ts:219-270`).
- The three-day snapshot reads `daily_operations_days`, not events (`snapshot.ts:289-293`).
- Granot retire-on-use reads the day document (`retireOnUse.ts:97-98`).
- No historical board view exists.

**Facts about closed days.**
- The hourly :05 cron closes every open day before today (`closeDay.ts:39-55`).
- No path reopens a day.
- A late fact still inserts on a closed day, with `metric_touches: []` (`recordDailyOperationsFact.ts:146-151`). It needs only the unique `dedupe_key`, never old bodies.
- A closed day freezes its counters and hourly buckets only. No copy of the board cards is stored.

**Measured.**
- Lateness of events created in the last 30 days:
  - 99.8% landed on their day or the next;
  - 14 landed 8–30 days late;
  - 303 landed more than 31 days late (backfills).
- **90% of rows are two kinds.** `sheet_sync.completed` is 164,949 rows (58.8%) and `granot.linked` is 87,184 (31.1%).
- **Daily volume.** About 2,100–2,600 per day in late October; 7,700–18,200 per day Nov 5–16 (incident); 241–674 per day since Nov 17.
- **Row cost.** Body 665 B on average, plus about 270 B of index. The `dedupe_key` averages 44 B.

**Proof predicate.**
- The event's day has `status: "closed"` and `closed_at`, and it is at least 2 days before today.
- The day has `webhook_counts_version: 1`, so the webhook backfill can never need it.
- The event is in a verified day pack, catalogued by `day` and `_id`.

**Hot fence.** `{dedupe_key, day}` for 400 days, the current TTL. Two sources can re-emit an old key on an open day: an Admin retry of an old Sheet job (`sheet_sync:<jobId>:<outcome>`) and intake refresh revisions.

**Scenario math** (body 665 B + index 270 B ≈ 935 B per row; fence ≈ 130 B per row, key plus day plus `_id` plus the unique index):

| Scenario | Hot today (400-day TTL) | With retirement (3 days of bodies + fence) | Difference |
| --- | --- | --- | --- |
| Now (280,756 rows) | 250 MB logical + index | about 37 MB | about −213 MB now |
| Steady, 500/day for 400 d (200k rows) | about 187 MB | about 26 MB | about −160 MB |
| October rate, 2,300/day (920k rows) | about 860 MB | about 120 MB | about −740 MB |
| One more incident week at 18k/day | +118 MB kept 400 d | +16 MB | |

GCS cost: day packs compress about 13:1, the ratio measured on RingCentral packs. 178 MB becomes about 14 MB, and new days add about 25–115 KB per day, deleted after 90 days.

**Option B, cheaper and larger: stop storing one event per Sheet job.**
- `sheet_sync.completed` is 59% of the rows.
- Rebuild counts these events for today only (`rebuild.ts:340-344`), because they are the only record of that count (`daily-operations.md:111`).
- Recording the count on the day document instead would cut new rows by more than half, with no GCS packs.
- This is a design change to the board's Sheet lane, so it needs its own Owner decision.

**Risks.**
- It reverses the Nov 19 "keep in MongoDB" decision.
- A dropped fence key would double-count a re-emitted Sheet completion on today's board.
- Any future historical board must read packs, or be built only from day documents.

**Recommendation.** Approve the closed-day packs with a 400-day key fence, and decide on Option B separately. Medium risk. The one-time reclaim is about 213 MB logical, about 100 MB on disk.

## 2. Sheet Sync attempts, runs and jobs (decision 7)

**What the readers need.**
- Coalescing, the drainer and Sheet Contains read only `pending`, `retrying` and `processing` jobs (`sheetSyncOutbox.service.ts:22,93-94,200-201`; `runSheetSyncDrain.ts:401-405`; `sheetContains.ts:315-319`).
- Admin has no time window:
  - health groups every status across the collection;
  - the job list accepts any status;
  - retry accepts `job_ids` of any status;
  - run detail reads all attempts by `run_id` (`adminSheetSync.service.ts:25-133`).
- The Job Number Timeline reads every job for an entity, of any age (`mongo-evidence-loader.ts:574`). The audit missed this reader.
- **The `sheet_sync[]` entry on a Lead or Booking has no job ID** (`schemaHelpers.ts:35-73`). Only time links a job to its row.

**Proof predicates.**
- **Job:**
  - its status is `synced` or `cancelled`;
  - no active job shares its `coalescing_key`;
  - each target's entry is synced, with `last_synced_at ≥ job.updatedAt` and `updated_since_last_sync: false`;
  - a synced job's `sheet_sync:<id>:completed` Daily Ops event exists.
- **Attempts and runs:** the run is finished, and every `job_id` among its attempts passes the job predicate, or is `failed` and superseded by a later synced job on the same key. Pack the attempts with their run.

**Hot fence.**
- **Jobs:** a locator of about 200 B, holding `{_id, status, resource, operation, entity_model, entity_id, coalescing_key, createdAt, updatedAt}`, for the Timeline, Admin lookup by ID and the trace.
- **Runs:** keep 14 days hot for Admin's newest page.

**Scenario math.**
- **Attempts and runs shrink without any change.** Most of today's 469,610 attempts and 107,868 runs are incident stock. The 90-day TTL removes them by about mid-February 2027.
- The steady state is about 420 attempts per day (about 10 MB at 90 days, plus 2.5 MB of index) and 400 runs per day (about 8.6 MB plus 2.3 MB).
- With a 14-day hot window, the steady state becomes about 1.6 MB of attempts and 1.4 MB of runs. That saves about 20 MB steady, and about 150 MB earlier than the TTL would.

| Jobs, permanent today | Today | +1 year at 130/day plus four bulk resyncs of 2,500 | With locators after 30 days |
| --- | --- | --- | --- |
| Logical | 68.1 MB | +24 MB | about 33 MB now; +11 MB per year |

**Prerequisite (recommended).** Add `job_id` to the `sheet_sync[]` entry, so the proof checks identity instead of time.

**Risks.**
- Admin health counts change once synced jobs leave.
- A retry of a retired `job_id` re-queues 0, so it must say so.
- The Timeline must read the locator.

**Recommendation.** Low value for attempts and runs: let the TTL finish, then revisit. For jobs, add `job_id` to the entry first, then retire to locators. Low to medium risk; about 35 MB now and about 13 MB per year.

## 3. Granot booking webhooks (decision 7)

- **Today.**
  - Booking-route webhooks and `booking_action_apply` operations never retire (`PERMANENT_HOLDS`, `retireOnUse.ts:39`).
  - 45 hot receipts carry `route_event_class: booking_status_changed`, about 0.1 MB.
  - Cases arrive at about 5 per day.
- **Proof predicate.**
  1. Processing is complete, with a live Decision.
  2. For a webhook route, the day was counted under `webhook_counts_version: 1`.
  3. One of these holds:
     - the effect's case or discrepancy is `resolved` with a `resolution.command_execution_id`, its `evidence[]` contains this receipt's Observation and Decision, all three case copies exist, and any BookedLead or CancelledLead it created exists;
     - the receipt is `booking_already_cancelled`, and its CancelledLead exists;
     - a newer resolved case supersedes it.
  4. It is not the newest evidence of any open case.
- **Hot fence.** The existing `granot_archived_receipts` locator and its operation-unique key.
- **Scenario math.** About 12 KB per day, about 4.4 MB per year. The Observations stay hot through case references anyway, so only the receipt leaves.
- **Risk.** Under decision 2, a retired object is deleted 90 days after retirement. After that, a booking dispute can rely only on the pinned case copies, and receipts never chosen as evidence have none.
- **Recommendation.** **Keep as is for now.** The saving is negligible, and the dispute record weakens. Revisit only to apply the rule uniformly.

## 4. Decision 2 reader review (decision 8)

**Finding.** Relaxing `referencedChains` alone frees almost nothing.
- `releasable` needs both "not referenced" and "superseded" (`retireLeadEvidence.ts:164-167`).
- A chain named by `last_accepted_granot_observation` is that Lead's **current winner** by definition, so the winner rule keeps it hot either way. The Outreach subject and Pool references point at the same winner.

**Readers by field.** Every other path is GCS-safe today or never loads the Observation:
- subjects `priority.observation_id`, Pool `accepted_observation_id`, Record Links, `lead_messages` and `entity_changes.provenance.*` are only written or compared;
- case and discrepancy readers go through the case copies and then GCS (`caseEvidence.ts:32-68`).

Four readers load the winner:

| Reader | Path | Change needed |
| --- | --- | --- |
| Pool admission (`admission.ts:120,132-133`), inside the Pool and lead-change transactions | Hot | None for proven Leads: it skips the read when the Lead carries a v2 proof (`admission.ts:117-118`). Without a proof it must refuse, not read GCS inside a transaction |
| `ops/verify-granot-pool-evidence.ts:24` | Operator | GCS fallback by ID |
| Call move-date repair (`callLeadMoveDateRepair.ts:48,69`) | Operator | GCS fallback, or refuse |
| `ops/granot-accepted-evidence-backfill.ts:56-82` | Operator | Run before any relaxing |

**Measured.** Every hot winner already carries the v2 proof: 5,706 of 5,706 Form Leads and 525 of 525 Call Leads, 0 without. Pool admission would therefore not touch GCS for any current Lead.

**Proposal.** Relax both holds for winners older than 30 days whose Lead carries a v2 proof:
- the reference hold;
- the "a surviving Decision needs a later winner" rule (`capture.md:109`).

Pool refuses (`accepted_observation_conflict`, fail-closed) if a proof later disappears (`receiptDecisionPointer.ts:24-28`). Update `storage-retention-operations.md:75,81` in the same PR.

**Savings.**
- Up to about 6,231 chains now: 7.1 MB of Observations, 8.8 MB of Decisions and most of their 30.6 MB of index. The Observation index is 3.9 KB per row, which deserves its own index review.
- The **6,285 receipt objects** held by `observation_hot` (`endOfLife.ts:126-136`) unblock one for one. They and their locators (about 4.9 MB) reach their 90-day end of life.
- Growth avoided: about 41 new Leads per day × about 6.3 KB (Observation, Decision and index) ≈ 0.26 MB per day, about 95 MB per year.

**Risk.** Medium. Pool access fails closed for any Lead that loses its proof, and the winner rule's documentation changes.

## 5. `entity_changes` and `domain_command_executions` (decision 7, after the reader inventory)

### `entity_changes`

**Measured.**
- **The incident wrote 81% of the rows.** 1,100 Call Leads hold 145,605 revisions (159 MB), from `synchronizeLeadFromGranot` changing `last_accepted_granot_observation` and `current_move_provenance` 1,600–10,600 times a day, Oct 15–Nov 16.
- That stopped on Nov 17: 147–374 revisions per day since, all entities.
- Rows per entity: p50 1, p90 4, p99 268, max 318.
- 113,269 rows sit beyond each entity's newest 50.

**Readers.**

| Reader | Window | Path |
| --- | --- | --- |
| Outreach tail and lead-link scan (`feed.ts:307-349`, `leadLinkJobs.ts:93-129`) | After their cursor, 120 s overlap. A paused cursor reads arbitrarily old rows | Cron |
| Assignment reconstruction (`evaluation/store.ts:238-251`) | Every `receiver_agent` row since the first | Cron and desk detail |
| SI lead history (`history/reads.ts:82-83`) | Newest 50 | Admin/MCP |
| Granot lead and job timelines, Job Number Timeline (`projections.ts:623,1214`, `mongo-evidence-loader.ts:488-559`) | All history; creation and job-number rows required | Admin |
| Granot reference holds (`retentionReferences.ts:33-37`) | Any age | Cron |

**Proof predicate.**
1. A later revision exists for the entity.
2. Both cursors are past `(applied_at, _id)` by more than 120 s and are not paused.
3. The row is not the creation row, the job-number row or the latest `receiver_agent` row.
4. It is outside the newest 50.
5. No hot Granot record named in `provenance.*` remains.
6. It is packed and restorable by `_id` and by entity. The timelines get a GCS fallback by entity.

**Scenario math.**
- One-time: about 113k rows, about 140 MB logical (mostly Call Lead incident revisions), about 45 MB on disk.
- Steady growth is about 0.35 MB per day, about 126 MB per year, mostly retained by the newest-50 rule.

**Simpler alternative.**
- Retire only the incident revisions: Call Lead rows from `synchronizeLeadFromGranot` whose changed paths are only `last_accepted_granot_observation` or `current_move_provenance`, under the same predicate.
- That reaches the same 140 MB with one narrow rule.

### `domain_command_executions`

**Measured.**
- 97% of rows are `granot_lifecycle` (163,982).
- The rest: `vantage_admin` 2,785, `ringcentral` 1,551, `external_sheet_ingestion` 819 (retired origin).
- Steady 59–347 per day.

**Replay.**
- The replay check reads `{origin, idempotency_key}` and compares `command_name` and checksum (`idempotency.ts:122-136`). It has no time bound.
- Retry bounds by origin:
  - **Granot:** a replay needs its receipt or Observation, so retirement of the receipt ends it.
  - **RingCentral:** sync re-reads the last 12 hours in steady state, with no bound after an outage.
  - **Admin client keys:** no bound exists.
  - **System and Owner contexts:** each key embeds a fresh `command_id`, so it can never replay.

**Phased predicate.**
1. **Now, no bound needed:** `external_sheet_ingestion` rows and fresh-`command_id` keys.
2. **Granot:** once Granot retention has retired the row's source receipt and Observation.
3. **RingCentral:** older than an Owner bound. Proposed: 30 days, which is ≥ 12 h plus the overlap; the 90-day duplicate guard is the backstop.
4. **Admin client keys:** after an Owner bound. Proposed: 30 days, keeping a compact fence `{origin, key, command_name, checksum, entity_refs, warnings}`.

In every phase, `entity_refs` must resolve to live records.

**Scenario math.**
- Phases 1–2 reach about 185 MB logical (about 59 MB on disk) once their Granot sources have retired.
- Steady growth is about 0.2 MB per day, about 73 MB per year, which this removes.

**Risk.** High for both collections: several readers, the idempotency contract and Admin timelines. Do this last, as the audit ordered.

## 6. The 247,661 unreferenced older Granot objects (1.75 GB, GCS)

- **What they are.** Early per-chain archives that no MongoDB row names. Only operator manifests reference them ([storage retention](../knowledge/granot-lifecycle/storage-retention-operations.md)).
- **Cost.** They cost nothing in MongoDB. At GCS Standard prices, about 1.75 GB ≈ $0.04 per month.
- **Proposal.**
  1. Scan every locator collection, including closed runs, case copies, catalogs and receipts, for each object name.
  2. Confirm that each object's chain already has a newer content-addressed archive or a retired-by-use pack.
  3. Then start each object's 90-day recovery clock through `startRecoveryClock`, with its reference guard. Recovery by ID stays possible for 90 days.
- **Recommendation.** Approve for policy completeness. It is a single, bounded operator pass with no runtime change. Low risk.

## Owner decisions requested

1. `daily_operations_events`: closed-day packs plus a 400-day key fence. Yes or no? And separately, Option B (a Sheet completion count on the day document)?
2. Sheet Sync: let the attempt and run TTL finish, then add `job_id` to `sheet_sync[]` and retire jobs to locators. Yes or no?
3. Booking webhooks: keep as is. Agree?
4. Decision 2: relax the reference and winner holds for proven winners older than 30 days. Yes or no?
5. `entity_changes`: the narrow incident-revision rule first. Yes or no? `domain_command_executions`: phases 1–2 now? And what bound for RingCentral and Admin keys (proposed 30 days)?
6. The 247,661 objects: the scan, then the 90-day clock. Yes or no?
