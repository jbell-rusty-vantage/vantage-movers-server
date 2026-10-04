# Migration, backfill, rollout and recovery runbook

This is execution preparation. No production command is run by this task. New dedicated migration CLI must default to report, expose mutually exclusive report/apply/verify, validate exact database/deployment identity, require explicit approved manifest hash/cohort and matching target confirmation for apply. Never reuse legacy full CSI backfill activation: it enqueues recording discovery/media/AI. Never execute an undocumented apply flag.

## Before a migration can be admitted

Capture target version/index inventory, rollback reader version, policy/config/algorithm version, fixed reference instant and activation boundary, source/identity/assignment/priority/coverage revisions, input watermarks, planned write bytes/count/time, complete candidate partition and manifest hash. Store immutable scope and stable keyset pagination. Resolve migration telemetry from measured production baseline, not universal guessed thresholds. warning_oplog_window_seconds must exceed min_oplog_window_seconds; hard floor must exceed maximum intended outage/lag plus recovery margin. Require replication/consumer lag, incremental bytes/sec, storage/CPU and live backlog measurements. Missing telemetry pauses admission. Persist all controls in configuration, never env.

Inventory partitions are mutually exclusive under documented precedence: terminal/excluded; unsupported/missing priority; ambiguous identity/assignment/attachment; missing/ambiguous time; missing required coverage; unassigned eligible; ready. Every candidate has one reason and source references. No-Sync alone is not excluded. Duplicate/Bad Form Lead and unmatched number-only eligibility follow approved lifecycle policy; do not invent Bad Call workflow.

At cutover preserve normalized original age, record observed-baseline limits and first enforceable future deadline/partial-day rule. No new preactivation penalties. No inference of historic zero from absent events or fictitious priority transition. Carry explicit human callback only through an approved mapped schedule; never carry AI promise as human instruction automatically.

## S5 rehearsal sequence

1. Pin approved isolated replica target; no cloud-injected Atlas connection. Report produces manifest and zero DB writes, audit/job/media/model/provider work.
2. Detect uniqueness conflicts read-only; build required indexes in isolated fixture before writers; examine query plans at realistic fixture volume. Unique active period, transition, evidence, config, projection, rep/day and checkpoints verified. Preserve old-reader compatibility; no automatic broad timestamp rewrite.
3. Canary includes New day bands, Quoted future date, unassigned, shared phone, missing Job Number, terminal, late receipt, invalid timestamp and reassignment race. Expected projections calculated independently from approved policy examples.
4. Apply bounded batches, crash after committed batch and before checkpoint, expire lease, race live priority/closure/assignment, change config/pause and retry. Replay must cause zero semantic changes, no duplicated audit/period/credit, and catch up skipped/raced IDs.
5. Rehearse persisted-controls reader/producer rollback and resume from checkpoint. Restore old readers only if compatible snapshot exists. Never delete historical data or reenable AI automatically.

## S6 batch and reconciliation sequence

One initial writer, size 25 (max 100), ten-second admission spacing as conservative defaults, with measured byte/time/headroom budgets. Keyset cursor plus lease epoch; re-read current authoritative closure/assignment/priority and input revisions before each write. Upsert only changed fingerprints; commit then checkpoint. If crash occurs between row commit and checkpoint, replay the same page idempotently. A stale lease or CAS failure cannot overwrite newer live state. Catch-up starts at frozen manifest watermark and closes at an explicitly recorded later live watermark.

Provider historical capture and Mongo projection backfill have separate budget/checkpoint/coverage manifests. Rep SMS gaps require mailbox proof and successful interval/page coverage. Use spare provider capacity; live capture wins; honor Retry-After and shared Heavy/SMS budgets. No media discovery, transcription, model execution, customer send or official domain rewrite is allowed in deterministic path.

Measurable release gates, all mandatory for the promoted cohort:

- inventory_total = ready + unassigned + quarantined + excluded; zero unclassified records and reason/owner for every exception.
- zero duplicate active periods, duplicate semantic transitions or duplicated credited canonical provider identities; zero phone-based multi-opportunity automatic credit.
- zero resurrected closed subjects; zero stale backfill overwrite under races; zero dry-run writes and zero second-run semantic changes.
- ready-cohort manifest/projection counts and eligible rep/day evidence counts match exactly; every discrepancy classified, repaired or moved out of cohort. No unexplained differences.
- all activated subjects have approved policy/time/priority/current assignment provenance (unassigned stays Owner-visible), channel gap-aware coverage and explainable independent requirements. Unknown coverage is visible and prevents false verified failure.
- catch-up processed through recorded watermark, no unreconciled dirty item at/before it; later arrivals remain durably queued with monitoring.
- quoted schedule/cutover/prior policy outcomes preserve audit/history; no manufactured preactivation misses.
- Daily Operations parity for wall-clock and true-instant Leads at midnight/DST, canonical Granot Lead creation replay counted once, overnight-created next-day-sent automated confirmation by actual send time, rebuild concurrent increment preserved. Current rebuild is open-day only; do not rewrite closed-day append-only history. Unsupported historic reconstruction is labelled/owned and excluded from certified metrics.
- role/foreign-ID/reassignment/shared-number denial, integrated UI/API metric parity, measured live/fallback freshness and configuration reload across instances pass F evidence.

Unknown history does not need to be fabricated to release a clean cohort. Quarantine must be visible, owned and approved out of rollout; rejected records cannot disappear as zero-ready.

## S7 rollout preparation and operator handoff

Compatible additive readers/models first with controls disabled -> verified indexes -> shadow projections -> proved authorized SMS capture and goal metrics -> canary policy period with competing planners fenced for same cohort -> bounded backfill+catch-up -> reconciliation/readiness approval -> limited desk roster -> wider cohort. Config change dependencies are validated and recorded. This packet performs only isolated rehearsal and prepares approval evidence; deployment/live execution requires separate user authorization.

Operator receives exact versioned manifest, target/cohort, decisions/proofs, measured threshold values, monitor ownership, pause/resume steps, source/projection freshness, backlog/lag alarms, exceptions, checkpoint and rollback version. Daily operations and outreach remain distinct units. A release status is blocked until all activation gates have signoff.

| Failure | Required response/recovery |
| --- | --- |
| telemetry absent/oplog warning/lag or backlog rising | stop admission, checkpoint committed work, prioritize live capture; resume only after measured recovery and manifest/input validity |
| stale input/config/lease or closure race | reject write, queue bounded fresh reconciliation; no overwrite/reopen |
| duplicate/index conflict | stop migration before writers; classify source issue, repair approved isolated manifest and rerun inventory |
| count mismatch | halt cohort promotion, retain evidence, identify scope/time/identity/dedupe cause; recompute affected slice |
| provider 429/unavailable/expired subscription | bounded retry/backoff and gap-aware degraded health; no assumed completion/zero |
| lost change-stream token | scoped authoritative resnapshot + watermark reconciliation; no unbounded replay |
| new policy/UI regression | pause backfill/enforcement; retain capture evidence; switch compatible readers via persisted revision; preserve additive data and old outcomes |
| rollback requires old planner | explicit review of task effects and old snapshot compatibility before unpausing; no automatic AI restart |

Migration rollback is behavior/read routing, not delete-all. Data corrections are versioned bounded compensation/rebuild with prior fingerprints and retained history. Final handoff names who can approve production actions; no credential values are written into artifacts.


## Finalized manual launch — P10b

[MANUAL-START.md](MANUAL-START.md) defines a selected-ID current-Lead pilot, preview/shadow, fixed-boundary activation, working-date verification, prospective automatic intake and reviewed existing-Lead expansion. No new actual Leads/contacts or live writes here. Goal metrics retain full approved daily scope or honest pending/partial coverage. Existing admission/headroom/report/apply/verify/rollback safeguards remain mandatory.


Automatic prospective intake uses its own disabled-by-default persisted admission gate, effective boundary/watermark and membership dedup. Historical migration pause/selection never silently becomes automatic full-corpus enrollment. Run [end-to-end checklist](END-TO-END-RUN.md) before production promotion.
