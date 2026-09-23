# 25 — CSI job pruning and write reduction

Date: September 21, 2026. Status: proposed strategy, backed by production read-only measurements and source inspection. No production pruning, retention changes, runtime edits or deployments were performed for this analysis. Operational Event logging is owned by a separate active task.

## Existing documents

- [17 — Storage, throughput and LLM efficiency handoff](17-storage-throughput-and-llm-efficiency-handoff.md): original measurements and causes, especially sections 6 and 10.
- [18 — Efficiency implementation report](18-efficiency-implementation-2026-09-21.md): semantic repair keys, coalesced attachment fan-out, and explicit decision to retain the 14-day completed-job TTL. Current source contains these changes; source presence alone does not prove healthy deployed execution.
- [24 — Workflows and MongoDB recommendation](24-workflows-and-mongodb-recommendation-2026-09-21.md): separate orchestration proposal. Neither cleanup nor the first write reduction requires a workflow migration.

## Fresh production evidence

Read-only, non-atomic measurements at approximately 22:39–22:40 UTC (18:39–18:40 Eastern). MB below means decimal bytes / 1,000,000. Index savings cannot be assigned precisely to a subset of documents before deletion.

| Measurement | Result |
| --- | ---: |
| All CSI jobs | 97,059 |
| Job documents | 67,539,583 bytes |
| Job indexes | 13,385,728 bytes |
| Completed legacy Outreach Record repair jobs | 66,097 |
| Legacy repair document bytes | 45,408,639 |
| Last legacy repair insertion | 2026-09-21 19:21:45.375 UTC |
| Last legacy completion | 2026-09-21 19:21:51.374 UTC |
| Legacy insertions in preceding hour | 0 |
| New `OutreachRecord:<id>:r<revision>` jobs | 0 |
| Legacy non-completed, active-lease or pending-blob-cleanup rows | 0 |
| Legacy references from Intelligence Runs, Submissions, Number schedules or AI reservations | 0 in checked fields |
| Legacy references from CSI audit `command_id` (ObjectId/string) or `correlation_id` | 0 in checked fields |

The exact legacy key shape was verified against source at `f051d02`: the final component was `String(+cycle)`. Current source uses `r${revision}` for this one family. Do not apply this distinction to other repair families, which have different semantics.

Prior measurements at approximately 22:27 UTC: actual Outreach Records occupied 7.46 MB including indexes, Contact Numbers 0.87 MB, CSI audit 25.36 MB, and evidence snapshots 12.01 MB. Completed job history is the first storage target; deleting Numbers, Outreach, findings or transcripts would trade much more business value for less space.

Full aggregate evidence is saved locally at `../.local-backups/mongo-emergency-2026-09-21/csi-pruning-strategy-baseline.json` relative to the server repository. It contains counts and operational timestamps, not customer document bodies.

## 1. Verify worker health before interpreting lower growth as success

`outreach_ensure.cursor.last_sync_to` remained at 19:21:45 UTC. The Outreach Record repair cursor and Form Lead repair cursor also last advanced around that time. The lease document's `updatedAt` was approximately 22:39:58 UTC. Attention publication remained active separately.

This is evidence of no successful scan progress for more than three hours while the lease row is still being touched. It is not proof of the cause. New revision-keyed repair jobs are absent. Do not report that the new repair algorithm has passed production acceptance based only on the fall in insertions.

Before pruning, have the owning CSI agent verify deployed commit, feature flags, cron invocations and errors, lease acquisition/release, transaction outcomes, and advancing source cursors. Check whether the 19:21 boundary coincides with deployment or storage failures. Repair a failed worker before conducting the idle-corpus acceptance run. Do not turn the worker off to meet a storage target; official closure, source changes and wait expiry still need processing.

## 2. Immediate cleanup: retire only completed legacy cycle jobs

Proposed selector, to be rerun immediately before any separately authorized execution:

```javascript
{
  deployment: "csi-production",
  database: "vantagemovers",
  stage: "outreach_ensure",
  status: "completed",
  dedupe_key: {
    $regex: "^csi:outreach:repair:OutreachRecord:[a-f0-9]{24}:[0-9]{13}$"
  }
}
```

Require a real `completed_at` date, no active lease, no pending cleanup, and an inventory-locked set of IDs. Recheck references and status before each batch. Verify the deployed writer no longer creates this key family, with no legacy executor still in flight. Archive the exact candidate documents outside Atlas first; never back them up into another collection on the same constrained cluster. Delete in bounded, resumable batches (for example 500 IDs), write a manifest, verify counts and current `dataSize + indexSize`, and confirm cursor progress after cleanup.

The measured candidate removes approximately **45.4 MB of documents**, plus any measured index reduction. That is about two-thirds of current job document storage. Do not promise proportional index shrink or sum compressed file allocation with quota usage.

Preserve modern repair keys, pending/leased/retry/paused/dead-letter jobs, AI execution/application jobs, reservation and cleanup dependencies, audit, source evidence and business records. This is an obsolete-family cleanup, not a general completed-job purge. Current semantic keys and legacy cycle keys are not interchangeable deduplication receipts.

## 3. Make duplicate nominations stop updating documents

`enqueueCsiJob` in `src/services/salesIntelligence/jobs.ts` uses an upsert with `$setOnInsert`. However, `defineCsiModel` in `src/models/salesIntelligence/common.ts` enables Mongoose timestamps. The enqueue query does not disable them. Mongoose normally adds `$set: { updatedAt: now }` to `findOneAndUpdate`, including an upsert that finds an existing row. Thus deduplication can stop new documents while repeated scans still update retained jobs.

Proposed narrow change: disable automatic timestamps for this insert-only enqueue operation, explicitly set creation/update timestamps within `$setOnInsert`, and retain the existing unique key, transaction, payload-hash and dataset validation. Preserve timestamps for real claims, leases, retries and completion. Do not disable schema timestamps globally. A duplicate nomination should leave the existing document byte-for-byte unchanged.

Check the installed Mongoose version and generated command in a synthetic replica test before shipping. The general behavior is documented in [Mongoose timestamps](https://mongoosejs.com/docs/timestamps.html). This fixes mutation amplification, not scan reads or the historical storage backlog. A write command that matches without changing data still has execution cost.

Acceptance: duplicate enqueue leaves status, timestamps, lease and document unchanged; concurrent first enqueues converge; conflicting payload/dataset still fails; first insertion gets timestamps; queue wake-ups, completion and retries keep their semantics.

## 4. Separate repair memory from disposable execution history

Do not shorten the global completed-job TTL as the first fix. The current 14-day TTL uses `completed_at`, while the semantic job row also remembers that a revision was handled. If that row expires, a later repair sweep can enqueue the unchanged revision again. A one-day TTL would make that recurrence much more frequent.

Proposed next design, scoped to deterministic repair first:

- Persist the last successfully handled source fingerprint/revision independently of disposable job history, keyed by dataset, repair family and subject. Choose a minimal checkpoint or suitable existing source field after checking ownership and contention. Do not create one permanent receipt per sweep or per historical revision.
- Compare semantic source state during the repair scan. Unchanged completed state should need no enqueue and no checkpoint write.
- Retain bounded outstanding work and a durable newer requested generation. Completion must acknowledge only the generation actually processed; a source change during a lease must survive as successor work. Advance the completed checkpoint in the same transaction as successful effects.
- Keep a repair route for missed events and commits behind watermarks. Preserve explicit forced repair and version the fingerprint when processing semantics change.
- Use a monotonic generation to distinguish genuine A→B→A transitions where intermediate processing matters; a permanent content-hash receipt alone must not suppress required later work.
- Change retention only after all producers and consumers use the checkpoint. Proposed initial target: 48 hours for completed deterministic repair execution detail; retain checkpoint state while its source exists. This is a proposed policy, not a live setting or a rule for every job stage.

Use stage-specific expiry eligibility (for example, a proposed `expires_at`) rather than indiscriminately shortening the existing TTL. Migrate the old TTL deliberately: merely adding a second TTL index would not stop the original index expiring protected rows. AI/run references, uncertain provider spend, pending media deletion, backfill recovery and Owner reanalysis need their own retention review.

## 5. Reduce nominations and unnecessary repair work

Preserve improvements already in current source: revision/official-state fingerprints, exclusion of closed Outreach Records from periodic repair, explicit expired-wait nominations, and one paged Outreach replay per Number revision instead of one job per call.

Make source changes and explicit wait-expiry boundaries the prompt work paths. Retain a bounded repair sweep as recovery. After measuring how it catches missed work, reduce its frequency or use checkpoint comparisons to skip unchanged rows; do not delay wait expiry or official closures with a blanket slower cron.

A generic Outreach revision can change for fields irrelevant to a particular repair. Introduce a narrower fingerprint only after listing every actual dependency of `ensureLead` and `refreshRecord`. Exclude derived display timestamps and the repair's own bookkeeping. Preserve official status, Owner precedence, identity, action state and time-boundary behavior.

Full Attention bands remain derived with current time by the separate publication path. They do not all need new durable jobs when the clock advances. Attention compression and five-minute expiry are already visible in production and should be preserved.

## 6. Measure the right outcomes

Use `scripts/measure-csi-efficiency.ts` for the existing stage/status, family and hourly baseline; extend measurement to distinguish nomination attempts, inserted rows, dedupe hits, actual modified rows, meaningful effects, source cursor age and oldest actionable work. The current `scanned` count increments on nomination attempts, not only inserts.

Keep telemetry bounded: application counters/logs or fixed hourly aggregates, not another Mongo event per nomination. Compare complete windows with similar traffic; historical hourly drops are not a controlled causal estimate.

Release gates:

1. Healthy deployed scan and processing cursors, with no recurring lease/transaction error.
2. Zero legacy-family insertions after cutover and in-flight drain.
3. At least two complete frozen-corpus repair passes: zero new unchanged repair jobs, zero duplicate-enqueue document modifications, zero new no-op audit/effect rows.
4. A real source revision and an expired wait still produce and complete the required work; official closure and Owner precedence remain correct.
5. Source changes during a lease, concurrent workers, lease loss and failed transactions lose no successor work and create no duplicate business effects.
6. Expire execution history in a synthetic test, then sweep unchanged sources: no recreated work once persistent checkpoints exist. Real later changes and forced repair still execute.
7. Report collection data/index bytes and insertion/modification rates separately, alongside useful completions and queue age.

## Recommended execution order

Verify/repair Outreach worker health → archive/prune the exact obsolete cycle-keyed cohort → remove duplicate-enqueue timestamp mutations → verify healthy semantic repair over two complete passes → add bounded persistent repair checkpoints → adopt shorter stage-specific execution retention.

Keep AI evidence/audit retention and the Workflow migration outside this initial change. These can be evaluated later against separate recovery, replay and product-history requirements.
