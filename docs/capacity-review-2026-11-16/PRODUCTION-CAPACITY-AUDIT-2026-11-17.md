# Production capacity and recovery audit — November 17 owner run

**Outcome still needed:** durable growth reduction without weakening Sheet Sync, Sales Outreach, Granot automation or recovery. Fresh read-only evidence closes the Atlas identity, all-member disk and supported compact-estimate gaps. It does **not** qualify cleanup: the independent logical backup has failed eight successive days, restore readiness is not current, retention still has unexplained failures, and the measured compact benefit is small. No database mutation, index change, TTL change, policy change, compact, failover or capacity resize was performed.

Observations below were taken November 17, approximately **10:13–10:19 a.m. New York / 15:13–15:19 UTC**. The older November 16 findings are not substituted for these readings.

## Exact target and health

- Organization: **Russell's Org - 2026-05-11**, `6a01f6ddedaf2c1b4a6583ee`.
- Project: **vantage movers**, `6a0206364e1d94dbdf522948`.
- Cluster: **vantagecluster**, `6ab2e5f9a6a220a26f8f99b2`; `IDLE`, not paused.
- Database: **vantagemovers**, 127 collections and 610 indexes in the primary snapshot.
- **M10, MongoDB 8.0.37, replica set, three electable AWS US_EAST_1 nodes, 13 GiB configured per node, 3,000 configured IOPS**. No read-only or analytics nodes. Disk autoscaling enabled; compute autoscaling disabled.
- Worker stamp at 15:10:02.595 UTC: commit `3327b31ce7b5a2f001e74febb0b2d3be79e47543`, deployment `dpl_55kau2rKsicyWmnBx6Quyb2R7JgP`. This is a worker attestation, not an independent Vercel alias proof; the release owner records alias/HTTP health separately.
- Zero open Atlas alerts returned. Enabled configurations include 90% data-disk utilization, no-primary, oplog-window, disk autoscaling and scaling-failure alerts. Zero open alerts is not evidence of adequate future runway.
- Last 24-hour hourly secondary lag samples: maxima under 0.010 seconds. No connection establishment rate-limit rejections in those samples. Hourly aggregation can conceal short spikes; this is not a production p95/SLO qualification.

Atlas MCP explicitly reported organization-level AI/MCP access disabled. The authorized existing `MONGO.env` OAuth credentials succeeded directly against Atlas Admin API; the existing runtime Mongo credential supported metadata and non-mutating estimates. Credentials remained in-process, were not copied or printed, and no additional permissions or access-list changes were made.

## All-member capacity

Direct `hello` verified each expected host and replica membership before reads. All nodes share total filesystem size **13,853,786,112 bytes**. Values below are bytes measured around 15:15 UTC; short node-to-node timing differences and natural writes apply.

| Member suffix / role | Filesystem used | Used % | Filesystem free | Application files + indexes | Internal reusable application allocation |
|---|---:|---:|---:|---:|---:|
| `00-00` secondary | 10,059,259,904 | 72.61% | 3,794,526,208 | 4,905,779,200 | 860,971,008 |
| `00-01` primary | 11,771,154,432 | 84.97% | 2,082,631,680 | 4,863,414,272 | 812,732,416 |
| `00-02` secondary | 11,786,014,720 | **85.07%** | 2,067,771,392 | 4,890,574,848 | 830,124,032 |

These are member-local allocation values, not three independent logical datasets. Internal free pages are already part of file allocation; do not add them to filesystem free space or call them reclaimed bytes. Primary oplog allocation was **4,138,729,472 bytes**, with **2,144,772,096 bytes internally free**. No oplog reclaimability was inferred and no oplog compact was attempted.

Atlas hourly seven-day endpoints show filesystem growth of **241.5 / 236.6 / 228.7 decimal MB/day** for members `00-00 / 00-01 / 00-02`. Their most recent approximately 24-hour deltas were **187.4 / 104.4 / 165.7 MB**. Latest hourly samples were around 14:18 UTC and therefore differ from the direct readings above. These endpoint calculations are estimates of net historical growth, not gross arrival rates or W1 causal savings. The direct worst member would reach 90% in roughly **three days** if its seven-day net rate continued. Autoscaling and nonlinear reuse can change that trajectory; this is not a predicted failure time.

**Immediate decision:** no evidence requires emergency compaction, deletion or compute-tier expansion now. Retain autoscaling, ship only qualified load reductions, repair recovery readiness, and remeasure worst-member utilization/growth within 24 hours. Do not wait seven days without a fresh capacity check. A new 90% alert, unexpectedly accelerating growth, failed autoscaling, replication lag or business latency/error increase requires an immediate capacity reassessment. Configured storage/cost changes remain separate owner decisions.

## Backup and restore readiness

Atlas backup and PIT are enabled. The latest observed scheduled snapshot **`6afc698aa63f20401680622f`** completed, created **2026-11-17T14:52:11Z**, expiry **November 24T14:55:41Z**, MongoDB 8.0.37, recorded snapshot storage **10,062,536,704 bytes**. The preceding 08:52 and 02:52 snapshots also completed. Schedule exposes six-hour snapshots and a seven-day PIT restore window, with daily/weekly/monthly/yearly policy entries. The bounded restore-job listing returned no jobs: this does not prove nobody has ever restored elsewhere, but supplies no current restore-drill evidence.

The independent GCS logical backup is **not healthy**. Cloud Run `vantage-mongodb-backup` in project `vantage-sheets-496816`, region `us-east1`, failed on every daily execution **November 10–17**; latest successful execution in the ten-entry listing was **November 9**. November 17's two recorded attempts reported the sanitized error `mongodump failed with exit 1: no output`. That does not establish whether memory, storage, networking or permissions caused failure. The current error wrapper discards the child's termination signal and uses `--quiet`; no diagnostic guess is promoted to a cause. No November 17 success manifest exists under the expected prefix.

A surviving November 8 weekly archive was verified by object metadata: **741,165,628 bytes**, generation **`1794122319625695`**, `gs://vantage-mongodb-backups-496816/backups/mongodb/vantagemovers/weekly/schema-v1/2026/45/vantagemovers-20261108T071524Z-tools-100.17.0.archive.gz`. It is old and was not downloaded or restored. The September 1 restore drill documented in `docs/mongodb-backup-automation/deployment-record.md` is historical; it does not qualify today's 127-collection dataset.

**Before destructive work:** diagnose/fix the daily logical backup, obtain a fresh successful immutable archive+manifest, verify its exact generation/checksum, and restore into an isolated database/cluster. Check counts, required indexes/BSON types and representative Sheet Timeline, Outreach admissions/replay and Granot closed-run reconstruction. An Atlas restore to a disposable target is an alternative full-system proof, with a separately approved target/cost. No production restore or backup-triggering mutation was run in this audit.

## Current storage and bounded candidate evidence

Primary collection measurements at 15:13 UTC; allocation includes collection and indexes. Counts are measured, but not certified deletable counts.

| Collection / group | Documents | Allocation, decimal MB | Treatment |
|---|---:|---:|---|
| `granot_webhook_receipts` | 1,902,778 | 1,523.49 | Preserve current winners, references, webhooks, effects and recovery; certified whole-chain archival only |
| `granot_observations` | 1,902,779 | 802.14 | Same whole-chain boundary |
| `synchronization_decisions` | 1,911,818 | 487.66 | Immutable decisions; no independent deletion |
| `granot_automation_runs` | 16,725 | 671.78 | Existing seven-day TTL; expiry/closure change is a separate decision |
| `sales_intelligence_jobs` | 404,570 | 552.52 | Existing 14-day completion TTL; only strictly qualified terminal classes considered |
| `sales_intelligence_audit_events` | 23,438 (15:15) | 208.67 primary | Existing 90-day audit retention; no shortening proposed |
| Sheet jobs / attempts / runs | 163,916 / 458,811 / 107,824 | 92.32 combined | Preserve operational/retry/history evidence; no blanket expiration |
| `entity_changes` | 177,992 | 63.14 | Preserve canonical audit/provenance references |
| `daily_operations_events` | 512,154 | 166.44 | Preserve reconstruction; existing 400-day TTL |

At cutoff **2026-11-14T15:18:09.332Z**, the indexed completed-job census found 50,432 `outreach_evaluate` or `outreach_lead_change` rows with `updated`/`unchanged` outcome, **39,327,358 logical BSON bytes**. This is an opportunity upper bound, **not** eligibility: complete result shape, dataset, absent leases, age, reader/replay and exact export requirements still apply. The same census found 2,041 `not_admitted` and 34 `created` outcome rows (17 in each of the two Outreach stages); protect their full supported 14-day history. Other stages remain excluded. The first 1,000 oldest completions passed through the strict local candidate classifier: **902 candidates, estimated 727,815 client-represented BSON bytes**, all evaluation outcomes; 98 excluded. No export/restore or exact apply manifest was made, so even those 902 are not authorized for deletion. Their observation fingerprint is in the evidence file; a fresh approved export must be generated before action.

Sheet jobs with ObjectId creation time before **2026-10-18T15:18:09.332Z**: **18,115 synced** (8,061,866 logical bytes) and **3 cancelled** (1,875 bytes). This is an indexed age proxy, not a timestamp/terminal-fact certification. Timeline terminal facts, attempt relations, uncertain delivery/retry state and explicit history policy remain prerequisites. The small upper bound gives no reason to rush history deletion.

The full automation status+logical-byte aggregate reached its five-second server limit and was stopped; its counts are **unknown**, not zero. A narrower indexed active/error census succeeded at 15:19 UTC:

| Status | Count | Expired | Expired with approval | Purge within next 24h |
|---|---:|---:|---:|---:|
| queued | 453 | 388 | 0 | 64 |
| applying | 30 | 0 | 0 | 0 |
| failed | 305 | 266 | 0 | 38 |
| planning / awaiting approval / completed with errors | 0 | 0 | 0 | 0 |

Earliest queued/failed purge dates are **November 18 around 04:00 a.m. New York**. These **102 unfinished/error records** demonstrate existing TTL exposure, not permission to alter it. No observed expired approved cohort justifies broad post-expiry action execution. Recommend retaining the existing execution-expiry boundary; assess any separately authorized preservation/terminal-closure design independently. The first-ID 100-run preflight sampled an estimated 15.37 MB of client-represented BSON and found no pending receipts or expired-approved application in that sample; it is not a fleet-wide receipt proof.

Future Granot retention remains `shadow` with unchanged cutoff **2026-11-03T17:30:42.610Z**. November 17: 28,800 reviews, 28,799 qualified counter increments, 450 comparisons, **7 failures**, zero mismatches and zero TTL stamps at the snapshot. November 16 had 17 failures. Current deployed day rows have no `last_failure`, stage or code fields, so database counters cannot establish causality. Do not promote retention or call seven clean days complete. Full protected/historical eligible chain counts require the bounded holder/closure census; no age-only count can substitute.

## Bounded operations for later specific approval — none executed

**A. Compaction: defer at today's measured yield.** Actual supported `compact: <collection>, dryRun: true, maxTimeMS: 5000` ran only on the two current secondaries; no `force` was used. Estimates:

| Collection | `00-00` estimated bytes freed | `00-02` estimated bytes freed | Logical rows removed |
|---|---:|---:|---:|
| `sales_intelligence_audit_events` | 12,337,152 | 11,812,864 | 0 |
| `sales_intelligence_jobs` | 72,531,968 | 73,060,352 | 0 |

Only about **84.87 MB per secondary** is predicted, despite much larger reusable allocation; the audit collection is below MongoDB's default 20 MB compact threshold. Recommendation: do not approve it now. If later approved after restore proof and renewed dry-run, bound the first canary to `vantagemovers.sales_intelligence_jobs` on secondary `00-00`, then observe and separately proceed to `00-02`; one operation at a time, no primary/oplog/system collections, no forced compaction, no retention change. Record before/after disk/collection stats, latency, lag and backup health. Halt further work on lag >30 seconds, business errors, representative p95 >2× baseline for five minutes, unexpected disk pressure, hash/parity mismatch or competing backup/maintenance. Stopping a running operation needs its own known operation ID and reviewed procedure; termination can leave no reclaimed space. There is no logical-data rollback for compaction; disaster recovery is the verified backup/replica recovery procedure.

Current MongoDB documentation supports dry-run from 8.0 and explains that Atlas does not support `rs.stepDown()`/member-priority reassignment. Do not transplant a self-managed rolling-stepdown runbook. The former primary needs a separately reviewed Atlas-supported maintenance/failover plan, or an explicit primary-compaction decision. The latter is **not recommended here**. [MongoDB compact command](https://www.mongodb.com/docs/manual/reference/command/compact/)

**B. Diagnostic index retirement: qualification first.** Exactly two receipt indexes: `granot_observation_receipt_payload_sha256_diag` (`payload_sha256:1,captured_at:-1`) and `granot_observation_receipt_route_event_captured` (`route_event_class:1,captured_at:-1`). Current primary allocations **191,877,120 + 24,596,480 = 216,473,600 bytes**; secondary totals 217.69–217.91 MB. Both show zero operations on all three nodes since November 14 restarts (~67 hours), which does not cover a week/incident cycle or external consumers. Preserve full definitions from member evidence. Before any approval, finish external-consumer audit, daily rebuild/Timeline/Health/replay explains and a realistic hide/rebuild rehearsal. A future approval should first hide **one named index**, observe through representative workflows, unhide immediately on query/SLO regression, then separately authorize drop after removing recreation declarations. Hiding saves no disk; rebuilding a dropped index costs time/resources and is the recovery method. No hide/drop/rebuild was run.

**C. Terminal-job cleanup: no broad three-day deletion.** Scope a future canary to at most **25 exact IDs** from the 902 strict candidates, fixed dataset `csi-production/vantagemovers`, completed before the fixed cutoff, recognized complete evaluation result, absent owner/lease, unchanged per-record BSON hash. Bind an independent exact BSON export/restore proof and manifest digest. Current client-size estimate is <0.73 MB for all 902; physical savings are unmeasured and may be zero until reuse/compact. Preserve admissions, dedupe/recovery stages and active/retry/dead-letter rows. W3 producer observation, deployed-declaration/index migration, disabled policy, exact manifest approval and grace-date stamping are separate prerequisites. Do not change the live 14-day TTL just to execute this canary. Pausing stamps does not cancel already-expiring dates. Recovery is exact cohort restoration with replay/dedupe proof. No canary is ready for approval until those artifacts exist.

**D. Granot archival/retention:** no approved removal count today. A future-only canary is at most one existing 64-chain page, strictly after the immutable cutoff and beyond mature working-set age, completed HTTP automation, one allowed no-effect Decision, newer accepted winner, no protected holder references, exact verified archive/closed-run receipt reconstruction, and a final transactional source/reference recheck. Historical pre-cutoff work requires its own exact manifest and approval. Recovery must retain generation-pinned GCS archives, catalogs, closure evidence and compatible readers. Failures must be explained and promotion gates met; no deletion/TTL stamp is proposed as immediately executable.

**E. Sheet history:** preserve all current records until terminal-fact/backfill and consumer parity are deployed and qualified and the owner approves an explicit history window. A future canary should be at most 25 exact old synced job IDs with immutable terminal facts, verified Google outcome, no active/uncertain successor/retry dependency and exact export+restore. The 18,115 old synced rows are merely a measured upper-bound category. Attempts/runs keep their current 90-day TTL. No new TTL, history deletion or retention-policy change is authorized.

## Reproducible evidence and limits

- [Atlas metadata, alerts, snapshots and hourly member metrics](evidence/atlas-owner-run-2026-11-17.json)
- [Fresh capacity and retained control/day counters](evidence/capacity-owner-run-2026-11-17.json)
- [Direct member metadata, index definitions/usage and non-mutating estimates](evidence/member-owner-run-2026-11-17.json)
- [Bounded age/cohort probes and stopped aggregate](evidence/cohorts-owner-run-2026-11-17.json)
- [Exact indexed active/error automation exposure](evidence/automation-exposure-owner-run-2026-11-17.json)
- [Backup execution outcomes](evidence/backup-executions-owner-run-2026-11-17.json), [sanitized failure categories](evidence/backup-errors-owner-run-2026-11-17.json), [surviving weekly object metadata](evidence/backup-object-owner-run-2026-11-17.json)

The original integrated capacity checkout retains the new fixed read-only probes under `ops/capacity/*owner-readonly*`; they are excluded from the isolated W0/W5 application release. They use the raw Mongo driver without model initialization, one pooled connection per target, five-second server bounds and exclusive output creation. Atlas probes save allowlisted metadata only. These are observation tools, not cleanup executors. No current full-system backup was restored and no live business effect was replayed. The later [25-job local export/restore proof](W3-BOUNDED-COHORT-2026-11-17.md) is separately bounded; it does not establish full-system recovery or deletion safety. No storage/cost saving is claimed.

## Independent numerical reconciliation

The four completed updated/unchanged outcome groups sum to 50,432 rows and 39,327,358 server-measured `$bsonSize` bytes. Both created-outcome groups are protected: 17 evaluation plus 17 lead-change rows, 34 total. The 902-candidate and first-100 automation sizes were calculated client-side with `BSON.calculateObjectSize`, not exact raw-server BSON lengths; they remain estimates. The immutable evidence field name `logical_bson_bytes` is not authority to treat those client samples as exact. The later 25-document export uses actual serialized byte lengths and independent byte-identical restore evidence.
