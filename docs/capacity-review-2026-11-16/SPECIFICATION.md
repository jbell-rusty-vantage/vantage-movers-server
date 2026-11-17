# Sustainable database growth — specification and Owner decision memo

**Date:** November 16, 2026, America/New_York. Live probes began at 8:13 p.m.; their UTC dates are November 17. **Status at the original review: plan only.** Current W1 release evidence is in [PHASE-ONE-RELEASE.md](PHASE-ONE-RELEASE.md); later phases remain planned. Production access during the original review was read-only. No deletes, configuration/index changes, credentials/roles changes, deployments or external messages were performed.

## Decision

Keep the existing business cadence as the intended service level. First fix a verified false-change path and reduce duplicate downstream work; then qualify a retention engine that can keep up. Do not start by weakening Granot audit evidence, deleting business records, or buying a larger compute tier.

The immediate implementation recommendation is **W1: correct Call Lead move-date comparison**, followed by **W2: eliminate duplicate Outreach evaluation nomination**, **W3: targeted terminal-job cleanup**, and **W4: repair and qualify retention**. Monitoring starts alongside W1. Physical compaction follows measured reclamation. Lossless evidence compaction is the longer-term design, with its own compatibility proof.

An optional emergency service tradeoff remains available: temporarily return Estimates slot admission to 08:00, 13:00 and 18:00 New York if the Owner prefers slower freshness to an imminent disk expansion. This is not necessary to implement the correctness fixes, and this plan does not enact it. Do not silently reverse the Owner-approved cadence.

## What this mission closes

This review supplies a fresh cluster/collection/index baseline, exact recent workload counts, a reproduced logic defect, a measured retention query bottleneck, collection policies, a safe-removal specification and an ordered release plan. It replaces several unsupported assumptions in the earlier brief. Production savings, replica concurrency/load qualification, the exact historical retention-failure causes and the eventual steady-state growth rate remain unproved.

Read with [ACTION-PLAN.md](ACTION-PLAN.md), the full [collection register](COLLECTIONS.md), and the detailed reviews: [Granot and retention](GRANOT-RETENTION.md), [Outreach and RingCentral](OUTREACH-RINGCENTRAL.md), [ingestion and Sheets](INGESTION-SHEETS.md). The original [brief](../capacity-2026-11-16-team-brief.md) remains historical context; the corrections below govern this proposed mission.

## 1. Measured baseline

Source code inspected: server `b926311ee9b8ceb16be57dad9435624f1ad8beac`, remote `jbell-rusty-vantage/vantage-movers-server`. The linked `vantage-call-review` directory is an older worktree of that same repository (`190be6fa`), not another deployed service. The live deployment SHA was not independently attested in this mission; behavior attribution combines current code with live aggregate evidence.

Atlas Admin API, using the new service account, confirms `vantagecluster`: **M10, MongoDB 8.0.37, three AWS US_EAST_1 nodes, 13 GiB configured per node, 3,000 IOPS, disk auto-scaling enabled, compute auto-scaling disabled, backup and PIT enabled**. No open alerts were returned. Existing alert configurations include 90% disk use and disk-auto-scale events; the missing improvement is earlier warning and application growth/backlog alerting, not creating alerts from nothing.

| Measure | Observation | Interpretation |
|---|---:|---|
| Main database collections / indexes | 127 / 610 | Full inventory, not a selected sample |
| Logical BSON | 13.33 GB | Uncompressed document bytes; not billed disk usage |
| Collection allocation + index allocation | 4.79 GB | 3.38 GB data files + 1.41 GB indexes |
| Reusable allocation inside application files | 441 MB including indexes | Already part of allocation, not additional disk |
| Direct filesystem reading | 11.62 GB / 13.85 GB, 83.9% | One member at collection measurement time |
| Latest hourly primary disk measurement | 11.68 GB / 13.85 GB, 84.3% | Different timestamp/source; do not add the two |
| Latest seven daily snapshot slope | +262.7 MB/day filesystem; +245.4 MB/day application allocation | November 10–16 daily snapshots; endpoint Atlas trend is about 250 MB/day |
| Oplog allocation / internal free bytes | 4.14 GB / 2.16 GB | Potential reuse/reclaim, not guaranteed compact yield |
| Primary normalized CPU user, hourly samples | mean 6.1%, maximum 38.0% | Does not establish a compute-upgrade need; hourly aggregation can hide short bursts |
| Primary connections, hourly samples | mean 93, maximum 209 | No connection establishment rate-limit rejection in collected samples |

Decimal MB/GB are used for bytes in this report. Atlas's configured 13 uses GiB even when its UI labels it GB. Per-node disk figures are not multiplied into the runway. Cost forecasting must account for all billed replica nodes and backup/archive usage.

### Where the application allocation is

| Collection / group | Documents | Data + indexes |
|---|---:|---:|
| Granot Observation Receipts | 1,851,649 | 1,483.7 MB |
| Granot Observations | 1,851,641 | 781.4 MB |
| Synchronization Decisions | 1,860,659 | 475.9 MB |
| Granot automation runs | 16,708 | 671.8 MB |
| Sales Intelligence durable jobs | 1,475,643 | 554.7 MB |
| Sales Intelligence audit events | 23,403 | 208.7 MB; data file has 124.5 MB already free |
| Daily Operations events | 510,956 | 166.1 MB |
| RingCentral webhook events | 35,962 | 69.0 MB |
| EntityChanges + command executions | 344,501 | 125.2 MB |
| Sheet jobs + attempts + runs | 728,067 | 92.5 MB |

The top five account for about 83% of application allocation. This is evidence concentration, not a completion percentage or a claim that 83% is deletable.

### Recent workflow arrivals

Complete New York dates November 14 and 15 were measured with indexed ObjectId creation-window queries, then grouped by stored timestamps where available. These are new retained rows in that window, not counts of every update, retry, physical disk write or historical import. Decisions can differ from receipts because attempts and completion cross boundaries.

| Retained work | Nov 14 | Nov 15 |
|---|---:|---:|
| HTTP automation receipts | 117,215 | 117,613 |
| Other Granot webhook receipts | 59 | 63 |
| All durable CSI jobs | 114,267 | 114,718 |
| Estimates-refresh jobs across lead-change + evaluation | 61,536 | 61,756 |
| Evaluations with `unchanged` result, all causes | 63,696 | 63,928 |
| Synced Call Lead update jobs | 8,742 | 8,777 |
| Daily Operations `granot.linked` facts | 8,822 | 8,847 |
| Daily Operations Sheet-completed facts | 8,825 | 8,872 |

Of 235,033 Decisions in this two-day ID window, 217,233 (92.4%) were `already_current` or `stale` with no effects. The three chain collections added about **1.086 GB logical BSON over two days**, excluding their indexes and subsequent updates. This does not mean 543 MB/day of new physical disk: compression, index maintenance, TTL and internal reuse differ.

### Corrections to the earlier brief

1. **There is a high-value correctness fix before audit redesign.** Equal-date Call snapshots can produce false business updates, described below.
2. **Three-day deletion cannot cover every completed CSI job.** Some results are the supported 14-day admissions/refusal history.
3. **Automation runs already have a live seven-day TTL.** Their 672 MB is a rotating working set, not necessarily an unbounded leak. The current closure function deliberately waits until a run has expired; zero closures among still-present runs is expected. The brief's closure-before-delete command sequence cannot execute unchanged.
4. **Future retention does not mean purge every existing chain.** Its immutable cutoff is `2026-11-03T17:30:42.610Z`; older chains require a separate historical manifest. Effects and protected references also exclude chains.
5. **The current Systems code uses 30 measured points when available.** There are enough snapshots now. The present flaw is an old 30-day trend blending the growth regime and previous reclamation, not demonstrably the 4 MB seed alone. Current reconstructed slopes are 62.7 MB/day disk and 123.3 MB/day application over 30 points, versus 262.7/245.4 over seven. Do not describe the current UI response as tested; this was an offline reconstruction of its inputs/code.
6. **Disk scaling is upward automatically, but not necessarily permanently irreversible.** Current MongoDB documentation permits supported manual reduction. Deleting data/compacting does not itself lower provisioned storage or the bill. Tier and storage are separate: disk growth can eventually force a tier increase even when compute auto-scaling is disabled. [MongoDB storage scaling](https://www.mongodb.com/docs/atlas/cluster-autoscaling-storage)

## 2. Server behavior specification

### W1 — eliminate false Call Lead changes while preserving fresh acceptance

**Defect.** `granotLifecycle/processor.ts` includes `move_date` in the Form projection but omits it in the Call projection. `leadDesiredState.ts` compares a valid observed Call date to that projection and sees a missing value. The command applies planned move-field work, advances provenance and requests Sheet Sync even when the stored date is already equal.

**Live corroboration.** Exactly 17,512 `synchronizeLeadFromGranot` Call EntityChanges over November 14–15 contain only `current_move_provenance` and `last_accepted_granot_observation`, spread across 502 Leads, maximum 38 per Lead. In that window there were 17,624 applied Decisions requesting Sheet Sync. This strongly identifies the false-change population; exact end-to-end removable work still requires a replay proof, not just matching totals.

**Reproduced.** The saved [pure planner reproduction](evidence/move-date-planner-repro.cjs) returns `applied` with `move_date` when the equal stored date is omitted, and `already_current` with no changed paths when supplied. Both retain `temporal_winner_should_advance: true`. [Output](evidence/move-date-planner-repro.json)

**Required behavior.** Project every field consumed by the planner for both Lead kinds. Equal normalized move dates alone must not request a business update, Sheet Sync, or a Daily Operations link/change fact when no other canonical change is needed and the exact Record Link is already current. Preserve legitimate first linking, priority/receiver changes and sibling repairs. A newer equal observation must still commit the existing temporal-acceptance behavior and remain protected against a later-arriving older changed observation. Do not use `updatedAt` or raw-row hash to skip the lifecycle.

Add adapter-level projection parity and command-level semantic-diff defense. Compute reportable effects from actual canonical changes, not only planned paths. Preserve real date changes, priority/receiver changes, Form-to-qualified-Call mirroring, no-sync policy, current winner CAS and audit ordering. Do not retroactively rewrite existing append-only Decisions or EntityChanges to pretend these updates never occurred.

If the command-time semantic diff becomes empty, replan under the canonical transaction fence or commit the existing `already_current` acceptance path with one correct Decision. Merely suppressing Sheet writes while leaving a false `applied` result/provenance churn is insufficient. Returning early without temporal acceptance is also incorrect. Test a concurrent writer making the date equal between planning and command execution.

### W2 — reduce Outreach work without losing transitions or repair

Estimates refresh nominates `outreach_lead_change` by receipt identity; it then requests an evaluator even when subject sync has already requested one. The pair accounts for about 61,646 job rows/day. About 63,812 evaluations/day across all causes return unchanged, but that is an opportunity population, not an automatic deletion/suppression rule: time, coverage, policy, uncertainty and repair can legitimately require evaluation. Explicit Estimates evaluations updated projections 147 and 153 times on the measured dates.

First make subject sync report whether it already requested evaluation within the transaction. Avoid the second nomination only when the first is durably guaranteed. Preserve the explicit unchanged-subject repair path. In a separate change, introduce durable requested/consumed generations per canonical subject with owner/lease fences and a complete semantic input fingerprint. A request racing completion must remain pending. Keep a separate accepted-evidence freshness watermark; no loss of Granot acceptance or Pool authority.

Do not debounce transitions merely because the latest priority returns to its original value: `0 → 5 → 0`, closures, contact evidence, assignment and policy changes need explicit parity tests. Likewise cache repeated admission refusals only against all policy and Lead eligibility inputs; approximately 4,526 old-intake refusals/day alone do not authorize ignoring a changed policy.

### W5 — make automation progress writes proportional to work

Current planning performs a lease renewal touching two records plus a checkpoint update per planned row. Apply also reads/replaces the growing embedded receipts array per action. Keep the durable per-operation identity/result as the recovery source. Renew leases by elapsed safety margin, checkpoint bounded progress at explicit chunk boundaries, and write only the settled action's receipt/result rather than serializing the entire array repeatedly.

The module must hide heartbeat, checkpoint, resume and closure rules from callers. A crash before/after every checkpoint or external response must replay without a new Granot effect, duplicate canonical command or lost approval checksum. Never replace durable progress with process memory or use unsafe fire-and-forget batches.

### W6 — Sheets and ingestion

The Sheet queue was healthy at measurement: 163,401 synced, three cancelled, four pending; zero processing/retrying/failed. Its 92.5 MB total is secondary to Granot. Correct upstream false changes first.

Then deduplicate per-Lead Mongo metadata writes after combining coalesced physical sheet outcomes; add safe expired-processing recovery under the global lease and a fresh physical row reread; constrain Admin retry to eligible terminal jobs; establish race-safe active-key coalescing before making its index unique. A unique index alone can fail on existing duplicates and does not define in-flight supersession.

Preserve uncertain Google structural-write handling, row identity, reporting eligibility, official Bookings/Cancellations and source/master routing. Empty drain suppression and index tuning follow measured invocation/query evidence. Completed Sheet jobs support Owner Job Timeline; retain a compact terminal delivery record before introducing expiration.

Best Relocation ingestion remains retired and its Source Company stays active unless the Owner separately changes it. The final reconciliation evidence is not cleanup exhaust. WordPress receipt and Form Fill work collections were empty; the reviewed WordPress receipt writer is test-database gated. Neither is the measured production growth source.

### W7 — RingCentral and long-term retention

Existing Call projection and SMS evidence already have material-equality/stale guards. Preserve these plus immutable Call Qualification, provider identities, interaction aliases, tombstones and retained rep-performance facts. Do not resurrect retired Call creation paths or strip historical qualification.

Optimize repeated Contact Number summary reads first by checking whether a call's summary contribution actually changed. Keep full recomputation for corrections, merges, member changes and retention. Measure before designing an incremental counter.

Call activity retention currently handles 50 Calls/day by default, at most 100, once daily. That can fall behind future aging intake; it is not established as today's growth cause. Introduce bounded cursor-based processing whose measured service rate exceeds eligible arrivals, preserving redaction/tombstone semantics and configured business-history horizons.

## 3. Immediate removals and reclamation candidates

These are **proposed first implementation cohorts**, not authorization to execute from this document. The Owner previously approved broad terminal-job cleanup in principle but held it for the larger solution; the new narrower specification protects newly identified readers. Every apply needs a fresh count/manifest at execution time.

| Candidate | Evidence / approximate benefit | Admission rule and guard |
|---|---|---|
| Completed `outreach_evaluate` jobs older than three days | 620,960 rows; about 233 MB allocated-equivalent using collection-average bytes/row | Fixed cutoff; completed; correct database/deployment; all result/read/replay consumers checked; preview and export/restore proof. Approximation is not an OS reclaim promise. |
| Completed Estimates lead-change refresh jobs | 264,729 older than three days before result-level narrowing; additional potential about 100 MB | Only positively recognized `updated`/`unchanged`; preserve `created`, `not_admitted`, `deferred`, unknown shapes and active/failed work. Never infer eligibility from key text alone. |
| Receipt payload-hash diagnostic index | 187.35 MB; zero observed reads since Nov 14 15:19 New York on this node | Nonunique diagnostic index; audit all application/operator readers, collect usage across members and representative period, hide/observe, then remove declaration + drop in controlled migration. Keep the stored hash and unique operation index. |
| Receipt route/time diagnostic index | 23.92 MB; same short zero-use observation | Same qualification; not currently proven unnecessary. |
| Free pages in CSI audit | 124.49 MB already free in data file, additional index reclaim unmeasured | No document deletion needed; compact dry-run estimate, per-member maintenance proof. |
| Mature eligible Granot chains | Largest recurring opportunity; exact removable count not yet certified | Archive, replay closure, newer winner, no protected references, transaction recheck, original cutoff; only retention engine stamps TTL. |

Do **not** immediately delete Leads, Bookings, Cancellations, EntityChanges, command executions, interaction identities, admissions history, active jobs, unknown-result jobs, automation runs en masse, or all Granot Decisions by age. Do not drop small or empty collections on appearance alone; Operations pricing shares this database and owns its four validated collections.

For one-time data pruning: export or verified backup restoration to an isolated target, positive eligibility, immutable selection checksum, bounded `_id` batches, terminal-state recheck, throttling, stop on latency/replication error, and an execution ledger. Pausing a manual deleter stops its additional deletions; pausing stamp generation does not stop MongoDB TTL from deleting already-stamped records. The default rollback lets previously certified stamps drain while stopping new ones; any cancellation of unexpired eligibility requires a separately designed guarded procedure. Neither pause restores deleted records. Do not activate a new TTL over a huge historical cohort all at once. MongoDB warns that TTL changes can release a large deletion workload. [TTL behavior](https://www.mongodb.com/docs/manual/core/index-ttl/)

## 4. Retention and evidence-compaction contract

### Current state and failure diagnosis

Live policy is `shadow`, armed November 3, with zero TTL stamps. November 16 UTC recorded 44,672 reviewed chains, 17 failed batches and zero recorded Pool mismatches. These are batch counters, not unique processed or removed records. Shadow can revisit the same chains.

At 64 reviews every two minutes the nominal ceiling is 46,080/day, below the measured 117,414 HTTP automation receipts/day. Even perfect availability and eligibility cannot catch up at today's cadence. Simply promoting does not repair this.

The reference checker queries several collections twice per page. A bounded live explain of its `entity_changes` OR shape using a synthetic absent ID scanned **177,376 documents, zero keys, 2,328 ms**, against the implementation's 3,000 ms limit. It proves a missing access path and proximity to timeout, not the cause of all historical failures. Start by testing three sparse/nonunique provenance-reference indexes or an equivalent complete access path on the replica; all OR branches need coverage. Do not remove reference protection to make it fast.

The final certification transaction also competes with archive I/O and a fixed ten-minute lease; stage-specific errors are not persisted. Correlate available runtime logs, then instrument bounded failure stage/code, duration, qualified/held reasons, unique archive counts, stamps, actual observed TTL removals and oldest due age. A failed full cutoff census in this mission hit its 20-second limit; it was stopped, not retried unbounded. Exact backlog partitions remain a prerequisite to apply.

### Throughput design

Keep the existing fixed cutoff. Introduce a versioned Mongo policy for pause/mode, page size, pages/time budget, limited archive concurrency, in-flight bytes and retry/backlog budget. Use renewable owner-fenced leases, independent small transactions and network calls outside transactions. Start with multiple bounded 64-chain pages, not one massive page.

During catch-up, seek qualified expiry service rate at least twice the **measured eligible unique arrivals**, while respecting latency and replication guards. Four pages/two minutes gives 184,320 nominal reviews/day; eight gives 368,640. Neither is qualified capacity until measured availability, eligible yield, repeated reviews, archive work and protected records are included. Define backlog slope and oldest age as release evidence, not configured batch size.

The existing closure-after-run-expiry path can remain for a first bounded release. A stronger later contract closes terminal, lease-free, checksum-locked runs before assigning purge dates, retaining the existing legacy reconstruction path. It requires implementation; the current operator cannot perform it unchanged. The live run TTL has no overdue rows at this measurement, but its creation-based expiry also deserves a separate check for unfinished/recoverable work.

Promotion requires archive restore/replay/freshness/reference parity and explained failure classes. Prefer the existing seven complete clean UTC days; an explicit Owner override may change the timing gate, never individual chain safety checks. Do not make an entire archive-format redesign a prerequisite to a bounded v1 relief release if v1 load and economics can first be qualified.

### Archive efficiency

`appendHistoryMonth` rewrites a whole immutable page when new chains append and switches the Mongo pointer; old content-addressed objects remain. A 512-chain page appended one chain at a time can serialize 131,328 cumulative chain copies before compression rather than 512. This is a structural upper illustration, not measured billing. The object count is not simply chain count divided by 512.

Live bucket metadata confirms Standard storage in US-EAST1, private access, seven-day soft deletion, and lifecycle deletion only for daily/manifests and weekly backup prefixes. `history/granot/v1` has no matching expiry rule. Actual archive object count, current reachable/orphan bytes and request billing remain unmeasured; moving growth to GCS without bounding amplification is not completion.

Design immutable new-chain chunks, verified publication handles, versioned catalog switch and bounded job/time grouping, then periodic immutable consolidation. Garbage collection must mark reachable objects from current/retained catalogs, closed runs, manifests and active reader generations, wait a grace/rollback interval, and preview unreachable generations. Never use prefix-wide deletion or apply the backup lifecycle to history. Include soft-delete cost and restore reads in the budget.

### Lossless evidence v2

The default longer-term contract preserves exact per-operation receipt identity, observation timestamp/ID, decision result, payload hash, policy/source/target meaning and temporal acceptance, while sharing repeated immutable statement bytes. Fresh equal observations still advance the temporal winner atomically with durable evidence. Stale observations retain their result without advancing state. The tuple and tie-breaker remain unchanged.

Expose one deep evidence-storage module owning acceptance, replay, shared payloads, hot/cold lookup and reconstruction. Planners and commands consume the existing domain contract; they do not choose persistence shortcuts. Initially keep full chains for effects, ambiguity/conflicts, webhooks and protected current evidence. Dual-read old/new versions before enabling compact writes, shadow-compare decisions/history/replay, and prove a lossless materializer for rollback.

Reject a raw-row hash shortcut before temporal acceptance and reject last-seen/count-only replacement under the present contract. At 10:00 an unchanged observation can legitimately block a delayed changed 09:00 observation; skipping the 10:00 acceptance can admit stale state. Count-only history also cannot answer exact per-operation replay.

## 5. Collection and index configuration

The [127-collection register](COLLECTIONS.md) records actual size, indexes and TTL fields for every collection. Only 23 collections have a TTL index; absence is not itself a defect—many are canonical business/history data. Four database validators belong to the separate Operations pricing domain.

Use `purge_at: Date` plus a zero-second TTL for newly classified terminal exhaust only after qualification. Keep admission facts for the supported 14-day contract or move them to a canonical compact ledger before shortening jobs. Existing 14-day CSI TTL constrains any new promise longer than 14 days until explicitly migrated. Preserve uniqueness, retry ownership, command idempotency and business reporting contracts. No indiscriminate compressor changes, time-series conversions or TTLs on core history.

Index work is a measured tradeoff: 1.41 GB of indexes already costs write I/O. First priority is the demonstrated retention reference scan. Atlas Advisor also reports a recoverable-run query averaging 10.38 seconds over 72 samples, priority-uncertainty Observation queries averaging 281 ms over 297 samples, and a Call Interaction shape averaging 1.21 seconds over ten samples. These are Advisor observations, not endpoint benchmarks, and may include operational inspection traffic. Match each shape to real callers before building.

Test run recovery's status/last-attempt/creation/waiting predicate while preserving least-recent-attempt fairness; test a selective invalid-priority/job/time access path; test exact interaction lookup. Avoid automatically accepting the Advisor's very wide Call qualification suggestion. For Sheet Timeline align entity-model/entity-ID predicates with existing compound keys before adding another index. Record executionStats, result parity, p95 workload latency and index bytes before/after each candidate. Short `$indexStats` windows cannot justify dropping unique/TTL or safety indexes.

## 6. Physical compaction and Atlas cost control

Separate three results: removing logical documents, creating reusable WiredTiger pages, and returning blocks to the filesystem. None alone reduces configured Atlas storage. Do not use `oplog storageSize - maxSize` as a reclaim estimate: the current UI formula yields about 3.10 GB, while measured internal free bytes are about 2.16 GB; `maxSize` is not an equivalent physical footprint. Preserve the roughly 24-hour observed oplog window and PIT/replication requirements.

After write reductions and controlled deletion settle, inventory all members, run supported compact estimates, rehearse on the disposable replica, and compact secondaries one at a time with replication/disk/latency checks. Only schedule a primary step-down/failover as part of a reviewed maintenance runbook. Verify the database user's compact privileges separately from Atlas Project roles; service-account permissions do not imply `local` database compact authority. Do not widen roles during this planning mission.

Prioritize already-fragmented application audit data, then post-cleanup collections; oplog reclamation comes after purge churn subsides. Compaction can affect performance and is per node; estimates and free bytes are not guarantees. Preserve backups, confirm restore proof, and abort/pause according to the maintenance plan if lag or latency breaches limits. [MongoDB compact](https://www.mongodb.com/docs/manual/reference/command/compact/)

Atlas storage auto-scales near 90% on any member toward approximately 70% utilization. At the present slope, that is roughly three days away, around November 19–20 New York, not an exact event prediction. A 13 GiB disk at 90% would require roughly 16.7 GiB to reach 70%, subject to Atlas rounding/constraints. This is initially a storage expansion; the documented M10 AWS storage range extends to 128 GB. Do not tell the Owner that the next expansion necessarily changes M10 to M20. [Storage scaling](https://www.mongodb.com/docs/atlas/cluster-autoscaling-storage), [AWS tier ranges](https://www.mongodb.com/docs/atlas/reference/amazon-aws)

No dollar savings are asserted: invoices/rates, backup storage and archive requests were not reconciled. Use `incremental configured GiB × replica-node storage rate + backup/PIT delta + archive retained GB-month + object operations/egress`, then distinguish avoided future growth from an actual reduced invoice. Keep auto-scaling as the availability safeguard; turning it off is not an efficiency fix.

## 7. Monitoring and qualification

Replace stale long-history runway with clearly labeled 7-day and 30-day rates plus a conservative forecast that detects resize/compaction boundaries. Show filesystem allocation, application allocation, internal free pages, oplog allocation/window and observed configured tier/storage separately. Unknown/stale readings must remain visible. Suppress neither failures nor zero-growth uncertainty behind a seed estimate.

Add Owner-visible warning at 80% worst-member disk use, escalation at 85% or forecast 90% within seven days, and application growth warning above 150 MB/day sustained over a defined window. These are proposed operational thresholds, not new configured alerts. Measure per-workflow logical bytes/rows, inserts and updates per business change, indexes, unique eligible retention throughput, backlog age, actual expirations, archive byte/request amplification and pending/failed jobs. Use bounded counters/daily summaries; do not create another append-only event for every no-op.

Release success has two levels:

- **Behavior proven:** equal-date Call path has no business/Sheet/Daily-Operations churn while acceptance advances; no duplicate evaluator nomination; all ordering, reporting, replay, history and sheet-uncertainty tests pass.
- **Capacity qualified:** representative seven-day window after retention working sets stabilize shows eligible backlog falling during catch-up then bounded, unchanged business freshness, no hidden failures, and substantially reduced daily application allocation/oplog traffic. A provisional design target is **≤50 MB/day net application allocation** after steady state, to be accepted or revised using workload-normalized measurements. It is not a forecast or a measured result. Track permanent protected/audit/archive growth separately.

Use real before/after workload-normalized bytes and rows per capture and per actual business change. Do not count a one-time compact or a bulk deletion as sustainable growth improvement. Do not promise four-year runway from a new TTL setting.

## 8. Evidence and remaining proof

- [Inventory](evidence/inventory.json): all collection options/index definitions, sizes, policy/counters, job states and daily history. Stats were sequential, not one transactional snapshot.
- [Atlas](evidence/atlas.json), [summary](evidence/summary.json): settings, alerts, hourly process/disk measurements and sanitized Advisor statistics. Query examples and credentials are excluded.
- [Workload probes](evidence/probes.json), [logic probes](evidence/logic-probes.json), [derived figures](evidence/derived.json): aggregate-only business evidence; no customer payloads.
- [Archive bucket](evidence/archive-bucket.json): actual lifecycle/storage metadata; not an object inventory.
- [Planner reproduction](evidence/move-date-planner-repro.json): synthetic current-code demonstration, not an end-to-end or production fix.

Remaining: deployed-revision attestation; exact original failure logs; full indexed/chunked backlog partition and archive reachability/cost census; per-member reclaim estimates and database-role check; replica regression/concurrency/load/restore proof; controlled release and measured steady state. These are explicit tasks in the action plan, not reasons to defer the confirmed correctness work.
