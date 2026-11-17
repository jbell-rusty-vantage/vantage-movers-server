# W4 Atlas slow-query and planner follow-up

**What this closes:** fresh production evidence confirms the missing EntityChange provenance access path and real full scans of the same query shape. **What remains:** the five Vercel timeout failures cannot yet be conclusively assigned to this stage. No index was installed, no profiling/configuration was enabled, no worker was invoked and no production source/document was changed.

Captured November 17 at **15:24–15:26 UTC / 10:24–10:26 a.m. New York**, against the previously attested `vantagemovers` database and primary `atlas-khw1wz-shard-00-01.ccf491v.mongodb.net:27017`. The release reviewer separately found five `/api/cron/granot-storage-retention` HTTP 500 requests with `MongoServerError: operation exceeded time limit`, around **14:20:33, 13:26:33, 13:28:33, 07:16:33 and 05:04:33 UTC**. The database day documents contain failure counts but no stored stage/code diagnostics.

## Confirmed live access-path defect

Fresh `listIndexes` returns six `entity_changes` indexes: `_id_`, changed-path/applied-time, entity/revision unique, applied-time scan, command-execution identity, and entity/applied-time. **None indexes `provenance.observation_id`, `provenance.decision_id` or `provenance.receipt_id`.** This independently matches the earlier all-member audit.

Two production **`queryPlanner`-only** explains used synthetic IDs, a three-second bound, no hint and no `executionStats`:

| Shape | Synthetic choices per branch | Winning path | Query shape hash |
|---|---:|---|---|
| Observation-provenance branch alone | 384 ObjectId/string choices | projection → COLLSCAN | `C74A0F24` |
| Full observation/decision/receipt provenance OR | 384 choices in each of three branches | subplan → projection → COLLSCAN | **`B048EA80`** |

The three-branch query mirrors `retentionReferences.ts`: references may be ObjectId or legacy string, and none of the holder checks may be removed. These explains establish planner behavior, **not** measured execution time, examined rows or deletion eligibility. They did not scan a production cohort for results. No artificial index or plan cache change was installed.

## Actual slow-query evidence

Read-only Atlas Performance Advisor requests used ±60-second windows around each failure, capped at 100 logs/window. Three of five broad windows reached the cap, so their missing entries cannot be interpreted as absence. A namespace-filtered follow-up for `vantagemovers.entity_changes`, capped at 50/window, returned **0, 6, 8, 0 and 0** entries respectively. None reached that cap, but Advisor capture/sampling still limits coverage.

Two returned EntityChange log entries match the **full-reference query shape hash `B048EA80`**:

| UTC completion | Plan | Documents examined | Keys examined | Returned | Duration |
|---|---|---:|---:|---:|---:|
| 2026-11-17 13:26:35.925 | COLLSCAN | 177,963 | 0 | 0 | 2,057 ms |
| 2026-11-17 13:29:27.686 | COLLSCAN | 177,963 | 0 | 0 | 2,266 ms |

The stored sanitized log summaries expose the observation-provenance `$in` field and cardinality, and a matching query hash. Returned raw command text can be abbreviated; it is **not** used as proof that only one reference branch ran. All customer values, operation/lead IDs and raw log text were discarded in-process. No raw queries were written to the evidence files.

These successful full scans approach the source's **3,000 ms reference-query timeout** under live workload. Together with the missing indexes and local replica result (4,006 documents examined reduced to six with all three sparse indexes), this is a concrete performance defect and a credible timeout contributor. It does **not prove** either successful entry was the failing Vercel operation: no request correlation ID, timed-out query record or application stage was captured. Do not claim the five failures are resolved by the proposed indexes until before/after production canary evidence verifies that result.

Other pressure is visible. The broad log window around 13:26 shows `granot_automation_runs` scans examining approximately 16,721 runs, returning 100, and taking roughly **10–11 seconds**, shape `7B43E37B`. Advisor's bounded 04:00–16:00 UTC report lists 40 examples of an automation shape averaging **12,113 ms** and suggests `createdAt:1`. This establishes another access-path candidate, not the retention failure's origin and not permission to add that index. Other Advisor suggestions likewise remain unapplied.

## Qualified next step

1. Release the independently reviewed bounded W4 stage/code diagnostics, when its own application gates permit, without changing cutoff, retention mode, cadence, query timeouts or holder checks. Correlate the next natural failure to selection/reference/closure/archive/verification/transaction/Pool stage.
2. Prepare a **separate reviewed index-installation operation** for exactly the three existing proposals on `vantagemovers.entity_changes`: `entity_change_granot_observation_ref_v1`, `entity_change_granot_decision_ref_v1`, `entity_change_granot_receipt_ref_v1`, each sparse ascending on its matching provenance field. Capture live definitions, duplicate-equivalence checks, estimated write/storage cost and the independently tested rollback before approval. The local `granot-reference-indexes.ts` installer remains loopback-only and is not a production path.
3. After specific operational approval and healthy backup/restore readiness, install in a bounded maintenance window, monitor member lag/disk and Sheet/Outreach/Granot latency, and compare the same live query shape's plan and execution counters. Do not increase retention throughput or enable TTL stamping as part of an index build.
4. Confirm naturally executed retention work no longer times out, then restart the clean observation interval. Seven clean mature days, reference/hash/parity checks, restore proof and owner-authorized TTL/canary gates remain independent.

The positive observation is **access-path diagnosis**, not an application fix, production index release, repaired retention worker or completed capacity plan.

## Exact future index-creation proposal — approval required, not executed

An additional **single**, five-second-bounded aggregate completed in **4,003 ms** at 15:27 UTC. It counted field presence/types across **178,003** current EntityChanges without returning IDs or customer values. This is the latest count, not a contradiction of the 177,963 rows examined in earlier log windows.

| Proposed index | Exact ascending key | Present / intended index entries | Missing | Current type |
|---|---|---:|---:|---|
| `entity_change_granot_observation_ref_v1` | `provenance.observation_id` | 173,768 | 4,235 | all ObjectId |
| `entity_change_granot_decision_ref_v1` | `provenance.decision_id` | 173,507 | 4,496 | all ObjectId |
| `entity_change_granot_receipt_ref_v1` | `provenance.receipt_id` | 174,002 | 4,001 | all ObjectId |

No null/string/array/object values were observed for these fields. The current query must nevertheless keep legacy-string compatibility for future/other qualified records. Each index is **nonunique, sparse, no TTL, no partial filter, no custom collation**:

```json
[
  { "name": "entity_change_granot_observation_ref_v1", "key": { "provenance.observation_id": 1 }, "sparse": true },
  { "name": "entity_change_granot_decision_ref_v1", "key": { "provenance.decision_id": 1 }, "sparse": true },
  { "name": "entity_change_granot_receipt_ref_v1", "key": { "provenance.receipt_id": 1 }, "sparse": true }
]
```

**Measured sizing analogy, not a storage guarantee:** the same collection's existing single-ObjectId `entity_change_command_execution_id` index has 178,003 present keys and **2,908,160 bytes allocated**, or **16.3377 allocated bytes/key**. Linear scaling to the measured reference counts gives estimates **2,838,970 / 2,834,706 / 2,842,793 bytes**, approximately **8.52 MB additional index allocation per replica member**. This is an explicit estimate calibrated to an actual similar index, not a replica measurement of the proposed indexes. Distinct-key distribution, insertion order, prefix compression, page filling, sparse metadata and build/repl scratch space can differ. It provides no hard upper bound on build space. Physical benefit is **increased** index allocation in exchange for less scanning; no disk-saving claim applies.

**Bounded authorization to request only after prerequisites:** create these three exact indexes on **`vantagemovers.entity_changes`**, one index build at a time, in the order above, with no model-wide sync, TTL, drop, policy/cutoff/throughput change or other Advisor index. Index builds replicate across the replica set; this is one-at-a-time by index, not independent per-member DDL. Reinspect definitions immediately beforehand and refuse any name conflict or non-equivalent existing definition. If an equivalent index already exists, record it and skip the redundant build instead of changing it.

Prerequisites are a fresh verified backup/isolated restore, all-member health/headroom, no competing maintenance, the passed three-branch replica/reference tests, independent review of the exact production command/specification, an agreed maintenance window, and baseline business latency/error/replication metrics. The existing loopback-only rehearsal script is not to be repurposed into an unreviewed production installer.

Before the first build, pin a private representative fixed chain/reference cohort and record the exact returned holder-reference set/digest using the unchanged three-branch query. After each build, compare results and explain plans without adding a production hint. **Exact reference results must remain equal**: sparse indexes cannot omit a match because each branch only seeks non-null ObjectId/string identities. All three access paths are needed before expecting the OR to avoid the collection scan. Success criteria are result equality, appropriate indexed planning, materially fewer examined documents and naturally successful retention runs; a completed index command alone is not qualification.

Use the prior measured worst-member **85.07% / 2.07 GB free** only as the baseline to refresh, not permission to consume the remaining space. Pause before another build if a member reaches **87% used**, free space falls **100 MB more than its refreshed baseline** during this small-index operation, replication lag exceeds **30 seconds**, a member becomes unavailable, any business error increase or hash/reference mismatch occurs, or representative application p95 exceeds **2× its pre-window baseline for five minutes**. These are proposed conservative maintenance stop thresholds, not newly activated monitoring settings. Observe at least **15 minutes after each completed build**; require a separately reviewed operator procedure before attempting to interrupt an in-flight replicated index build.

**Rollback boundary:** stop the remaining builds first. No data format/record is changed, so the previous application remains compatible, but the planner may use an installed index immediately. Removing or hiding a regressing index is a separate database mutation requiring specific approval; do not call it an automatic rollback. Preserve exact definitions and the index-creation report. If the owner later authorizes dropping one of these newly created named indexes, recovery/retry is recreating its exact definition under the same load controls. A partially completed three-index set must be reported accurately and must not be mistaken for complete OR optimization.

This proposal supports a narrow future **index-create decision**, not bulk deletion or full W4 activation. The matched slow-query hash remains corroboration rather than proof that all five HTTP 500 failures share this cause.

## Evidence

- [Planner-only explains and exact current index definitions](evidence/w4-planner-owner-run-2026-11-17.json)
- [Namespace-filtered, sanitized Atlas slow-query summaries](evidence/w4-advisor-entity-owner-run-2026-11-17.json)
- [Broad bounded windows and sanitized Advisor suggestions](evidence/w4-advisor-owner-run-2026-11-17.json)
- [One bounded reference-presence census and live comparison-index allocation](evidence/w4-index-sizing-owner-run-2026-11-17.json)
- [MongoDB Atlas Return Slow Queries API](https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-listgroupprocessperformanceadvisorslowquerylogs) — milliseconds-based `since`/`duration`, namespace filtering and bounded `nLogs` were verified before requests.

The diagnostic helper scripts were temporary local tools outside the repository. Only this document and sanitized evidence were added for the follow-up; runtime source remains unchanged.
