# Phase 3 Lead intake release and storage qualification

Production promoted the reviewed commit `f28048cf7c47355b315e7fd6a6a75cf9d0e262db` at 22:49:03 New York on November 17. The canonical alias and 22:50 worker stamp identify READY deployment `dpl_FuZgQUBGAbJ7d8YRy1QQU8abtojt`. Both health endpoints returned HTTP 200 and the database reported `vantagemovers` at ready state 1. Release gate E is closed. [PR 224](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/224) · [Production workflow](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44231678691).

## Which storage changed

RingCentral re-polls final Call Log evidence for already-processed Calls. A newer identical result must advance its observation timestamp so an older correction cannot win. The same qualified Call now holds that ordering evidence with a fixed-width BSON date. Its transaction revalidates the exact provider identity and final facts after any write conflict. An actual correction still commits the command execution, revision, EntityChange and Sheet intent together.

In the 24 hours ending November 17 at 22:00 New York, 19 external Forms, 25 Granot-created Forms and seven RingCentral Calls arrived. Of 138 final-result commands across 12 Calls, the bounded oplog read confirmed 133 transactions whose only writes were the timestamp advance and its command receipt. Those receipts totaled 171,882 BSON bytes. Five unclassified receipts were excluded from the estimate. At the confirmed day's mix, the extrapolation is **171,882 logical BSON bytes and 133 inserts avoided per day**. Intake creates still retain their original content and reporting evidence. The estimate excludes index entries, journal/oplog, compression and filesystem effects. [Measured baseline and replica operations](https://github.com/jbell-rusty-vantage/vantage-movers-server/blob/f28048cf7c47355b315e7fd6a6a75cf9d0e262db/docs/operations/evidence/lead-intake-storage.json).

## Disposable replica

The same fixture ran against the old and reviewed source on a single-member Mongo 8 replica. Net documents and bytes include changes across every fixture collection. Write counts are issued application write commands, including attempts retried on conflicts. Provider delivery was isolated. A queued correction can replace an existing Sheet job under its coalescing key.

| Outcome | Net documents before → after | Net BSON bytes before → after | Writes before → after |
| --- | ---: | ---: | ---: |
| Qualified inbound Call | 5 → 5 | 5,944 → 5,944 | 6 → 6 |
| External Form matching the Call, including Form Fill | 6 → 6 | 8,073 → 8,073 | 11 → 11 |
| Replay of that Form command | 0 → 0 | 0 → 0 | 0 → 0 |
| Separate duplicate Form submission | 5 → 5 | 7,243 → 7,243 | 7 → 7 |
| Later identical final result | 1 → 0 | 1,197 → 0 | 2 → 1 |
| Five concurrent deliveries of that same later observation | 1 → 0 | 1,197 → 0 | 6 → 2 in this run |
| Exact replay or stale correction | 0 → 0 | 0 → 0 | 0 → 0 |
| Genuine correction | 2 → 2 | 2,354 → 2,354 | 6 → 6 |

The duplicate Form retained its separate Lead. Form Fill marked the qualified Call. A newer unchanged observation fenced a delayed correction. A genuine later correction advanced exactly one revision and produced one EntityChange and the expected queued update. Forcing the Sheet outbox write to fail left the Lead, revision, change, receipt and outbox at their prior state. Racing different observations converged on the latest one. Both builds passed the same assertions. The separately exercised rollback placed the old writer on the new writer's Call. The old writer rejected a delayed correction, accepted a later one, and stored a receipt on its next watermark-only poll. The new writer then accepted a still later correction. [Reproducible fixture](https://github.com/jbell-rusty-vantage/vantage-movers-server/blob/f28048cf7c47355b315e7fd6a6a75cf9d0e262db/ops/capacity/lead-intake-replica.cjs).

## Release evidence and rollback

An independent GPT-6.2 Astra reviewer signed off tree `d6346364959f823cab3214d2c598f1178f79ccaf` against fresh main `9bbe2c7c`, the byte evidence and rollback. The preview merge commit `206dd1465a4d315268f2f7401a3dc17956016b38` contained that exact tree. The protected preview returned healthy application and database reads. The integrated regression passed 3,850 cases with 177 opt-in skips and zero failures. The lifecycle replica sweep passed all 110 disabled-Sheet and 40 queued-Sheet cases. Reaching the full sweep required the repository's isolated database name, synthetic deployment ID and RingCentral write/adoption settings. Local typecheck, lint and hosted quality passed. The production-configuration build and deployed artifact each passed three retention checks. All 91 inherited diagnostics matched the serving artifact by file, code, message and multiplicity. Three moved line numbers mapped to the identical source text and column. Remote main still pointed at the reviewed parent immediately before fast-forward. [Hosted quality](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44230392158) · [Production configuration and retention](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44230373569) · [Preview](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44230392073).

The pre-rollout plan calls for investigation on wrong admission, wrong temporal winner, missing or duplicate canonical/reporting effects, health/identity failure or capacity watch escalation. For an attributable code regression, restore only `src/services/domainCommands/ringcentralFinalResult.ts` from `9bbe2c7c` and use the same gated release workflow. Existing records remain readable by both versions. The Granot expiry guard stays deployed. [Pre-rollout acceptance and rollback](https://github.com/jbell-rusty-vantage/vantage-movers-server/blob/f28048cf7c47355b315e7fd6a6a75cf9d0e262db/docs/operations/LEAD-INTAKE-QUALIFICATION.md).

## Natural production observations

From 22:49:03 through 23:00:54 New York, one external WordPress Form arrived. Its creation transaction inserted the Form, Form Fill work, Sheet intent, consent-related message records, EntityChange and command receipt. The original contact and move snapshots were present. The command referenced that Lead at revision 1. Its Sheet job recorded a synced append, two synced deletes and keyed completion. The Lead Message recorded provider delivery. CRM posting was disabled for this submission. The seven inserted documents totaled 8,930 BSON bytes at insert time, separate from the other updates in the transaction and later delivery metadata. The Form document itself was 1,737 BSON bytes on insert and 1,993 at the subsequent read.

At 23:00 four naturally reprocessed, RingCentral-qualified Calls advanced their final observation timestamps. All four deployment-scoped worker messages joined the exact Call identities. Each Mongo transaction contained just the Call update. Each Call's persisted observation advanced from 22:30:17 to 23:00:17. Direct BSON measurements immediately before and after the poll matched on each Call at 3,321, 3,247, 1,943 and 2,830 bytes. All four retained their prior revision. The worker, oplog and stored facts agree. The observation window contained zero final-result executions and zero final-result EntityChanges. The transactions requested zero Sheet writes.

Each of those four Calls had a confirmed pre-release timestamp-only transaction with a 1,293-byte receipt. Matched observed logical growth was **1,293 bytes before and zero afterward per operation**, or **5,172 fewer retained bytes across the four matched pairs**. Only the previous receipt size is used in this comparison. Original Call creation, genuine corrections, Form Fill, consent and official outcomes retain their normal writes. No new Call, final-result correction, official Booking or Cancellation arrived in this short window. Those paths have replica/regression coverage. Physical Google Sheets membership was not independently read. [Redacted live evidence](evidence/lead-intake-live-2026-11-17.json).

## Filesystem and outstanding proof

Direct member dbStats before promotion at 22:36:47 and after observation at 23:01:14 New York gave the following readings. Each member retained an allocation of 13,853,786,112 bytes.

| Member | Used bytes before | Used bytes after | Movement | Used after |
| --- | ---: | ---: | ---: | ---: |
| 00 | 10,241,400,832 | 10,266,644,480 | +25,243,648 | 74.107% |
| 01 | 11,883,880,448 | 11,994,288,128 | +110,407,680 | 86.578% |
| 02 | 11,956,936,704 | 11,924,213,760 | -32,722,944 | 86.072% |

The hottest reading went from 86.308% before promotion through 85.538% immediately after rollout to 86.578% at the final read. These are whole-member measurements across all workloads. The four matched operations establish logical BSON savings. A full post-release day, attributable index or compressed-storage savings, and a filesystem growth rate remain unmeasured. The November 18 New York capacity watch and W1 November 18/23 21:06:40 New York checkpoints had not elapsed. Granot's per-claim benefit and slower ALL tail remain separate. Sheet S6 and the integrated capacity checkout were preserved. Phase 4 was not started.
