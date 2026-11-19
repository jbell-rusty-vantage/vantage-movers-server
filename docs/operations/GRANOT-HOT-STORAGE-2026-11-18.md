# Granot hot storage and production relief

The Owner moved the Granot producer and archive drain ahead of the Booking and Cancellation cost study on November 18. The [capacity analysis](C:/Users/Pinda/Proyectos/vantage/storage-capacity-analysis-2026-11-17/GRANOT-PRESSURE-2026-11-18.md) gives the arrival census, fastest-growing collections, hot and cold costs, and 1×, peak-hour and 2× scenarios. The historical removal covered routine, completed, superseded HTTP automation evidence.

## Five scheduled Estimates runs per day

An independent production release switched the Estimates scheduler from 18 slots to 06:00, 09:00, 13:00, 17:00 and 21:00 New York on November 18 at 13:16:44. All 1,080 HTTP runs that produced receipts in the measured day joined to their scheduled slot. Four retained slots produced 28,581 receipts. Fourteen eliminated slots produced 91,837. The new 21:00 slot uses the midpoint of the observed 20:00 and 22:00 volumes. Real webhooks stay in the estimate. Its forecast is 35,628 total receipts/day, about 84,923 fewer than the old schedule. If the new evening slot differs by 20%, the estimated daily range is 34,245–37,010. The longest scheduled Estimates gap is now nine hours overnight. Later discovery of a change during the longer interval is a business tradeoff of that separate release.

| Daily workload in the same business mix | Observed prior schedule | Modeled five-slot schedule | Twice five-slot volume |
| --- | ---: | ---: | ---: |
| Total receipts | 120,550 | 35,628 | 71,255 |
| Gross receipt, observation and decision BSON at historical mean bytes/arrival | 557.3 MB | 164.7 MB | 329.4 MB |
| Compact replay BSON avoided | 9.87 MB | 2.91 MB | 5.82 MB |
| Routine successful certifications eligible for one fewer receipt update | 105,447 | 31,101 | 62,201 |

These are sequential savings. The schedule cuts the number of arrivals. The two writer changes apply to the remaining work. At 80% unique utilization, one 64-row page every two minutes can advance 36,864 chains/day. That leaves about 10,143/day for older work at 75% eligibility or about 1,394/day if every forecast routine result qualifies. At 2×, two pages at that utilization could sustain the projected daily flow. A retained 06:00 burst can still produce 7,831 receipts. A single page per tick cannot absorb that burst within its hour. Measure queue age and verified unique removals across all five slots before selecting extra catch-up capacity. The index-era shadow worker still produces zero TTL deletions. [Scheduled release](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44366102664) · [Slot attribution and sensitivity](evidence/granot-schedule-forecast-2026-11-18.json)

## Why closing a Sheet job is insufficient

The same Mongo collection holds real Granot webhooks and server-generated observations from HTTP automation. The deployed Registry returned one enabled creation route for Paid Overflow Form Leads. RingCentral qualification governs Call creation. The receipt finalizer and the archive operate after source policy and lifecycle decisions. A webhook that creates or changes a record is outside this removal.

Every successful observation still gets its original capture time. The winning Lead already holds the accepted observation ID and time and certified receipt and decision IDs. Current winners and references used for contact/move provenance, links, reconciliation, EntityChange and Sales Outreach remain in Mongo. A newer equal snapshot can supersede an older observation without a business revision or Sheet write. It can still order a subsequent late update or refresh an existing Outreach subject. Treating equal payloads as duplicate operations would change that behavior.

After supersession and run closure, the existing per-job archive catalog locates original history in checksum-addressed GCS objects. A separate closed-run entry reconstructs the exact operation by ID, kind and original payload hash. The proof uses actual GCS generation and SHA-256 for each recovery object. For a job, load the matching catalog pages and locate the original receipt or observation ID in decoded history. For a specific old receipt ID on its own, the private removal manifest maps it to the exact catalog hash and raw BSON. The production object path is `history/granot/v1/vantagemovers/<first two hash characters>/<sha256>.bson.gz` in `vantage-mongodb-backups-496816`. The catalog’s job key and capture dates narrow the lookup. The reader verifies the object hash, job identity and chain count. A new global per-receipt lookup index would impose a write for every poll. Updating every Lead with a historical archive location would also create extra writes and could overwrite its latest accepted pointer.

## Removal contract and recovery

Each selected chain has one completed HTTP receipt, a valid Lead snapshot, exactly one live no-effect decision and a later winner. A stale decision must specifically mean older than the temporal winner. The exact closed operation must reconstruct, with no active run or protected live reference. Each majority-committed deletion transaction checks the three source documents, their raw BSON hashes, current archive and closure pointers, references and the newer winner. A failed check holds the chain. The exports contain the three original BSON documents, their IDs and per-document digests, plus the application archive catalog, closure records and pinned GCS object generations.

Recovery starts with the generation-specific manifest and raw rollback archive. After decompression each BSON document has a one-byte collection selector, in receipt, observation, decision order starting at zero. Restore with BSON types into an empty isolated database and compare the sorted per-collection SHA-256 and counts to the manifest. Recover the catalog or closures from their separate bundle if needed. Before any production restoration, compare exact IDs and hashes against hot rows to preserve later work. A writer rollback keeps the mixed replay reader and can resume storing the full result immediately.

## Sustainable drain

1. Price the release against naturally completed operations. Compare the decoded reply with its actual decision and original observation. Record storage saved and distinguish it from concurrent physical disk movement.

2. The approved three-index trial is complete. Continue measuring production retention duration, cold publication and unique advances after the reference scan was removed. Stage attribution and the seven clean shadow-day promotion test still apply.

3. Size the archive worker by unique verified removals per day. Under the previous 18-slot workload, at 120,335 potentially eligible operations per day and 80% unique utilization, four 64-item pages every two minutes advance 147,456 unique chains per day. Six pages absorb the observed peak hour. Seven cover 2× daily demand. Measure GCS throughput and time per batch before increasing concurrency. The alert should use oldest eligible age and daily net hot bytes after catalog growth.

4. For a shorter hot window, publish a closed-run replay manifest as soon as a sealed terminal run is independently proven complete. Keep the active-run fence, per-action result identity, Outreach completion, original expiry and recovery paths. Start with effect-free, superseded Lead snapshots. Price growth and prove crash-before/after-publication, changed/late observations and cold replay before changing the current seven-day working window. Real webhooks, effect-bearing decisions, current winners and other protected history require separate evidence.

### What a shorter hot window buys

At the measured 543.13 MB/day gross flow across the three collections, a seven-day working set represents about 3.80 GB of logical BSON before protected exceptions, indexes and catalog growth. Moving 75% of that flow to verified cold storage after one day instead of seven would reduce the steady hot set by approximately 2.44 GB (543.13 MB × 0.75 × 6 days). At twice the measured flow the difference would be 4.89 GB. At the new five-slot estimate of 164.7 MB/day, the same 75% one-day design saves approximately 0.74 GB of steady hot BSON, or 1.48 GB at 2×. These are design scenarios. A completion timestamp by itself cannot establish qualification. The deciding experiment should measure the fraction whose run can actually close within one day, the time until a newer winner exists, and which of those chains has a downstream reference. Compare exact ordered Lead history and replay through a late correction and restore.

A production sample tested why a one-day archive cannot yet use the current closure code. In fifteen four-minute slices, the 24–25-hour window contained 66 sampled receipts and 63 completed routine HTTP results. All 63 already had a later winning observation. Their seven originating runs had terminal status and had passed action expiry. All seven still existed in the hot run collection, and none had a published closed-run pointer. At 48–49 hours the same pattern held for 70 routine results, and at 144–145 hours for 76. At 192–193 hours, all 70 sampled routine results had a newer winner, their original runs had expired out of Mongo and none yet had a closure pointer. These are time-stratified samples of surviving receipts under the prior 18-slot schedule. Repeat the one-day sample after a full day on the five-slot schedule because a later winning observation may take longer to arrive. They identify two distinct implementation opportunities. Seal and verify replay for a terminal, action-expired run while its summary is still retained, then schedule enough archive work to publish verified history promptly. This sample did not verify every downstream reference, action or catalog object. [Age and run-status evidence](evidence/granot-early-closure-sample-2026-11-18.json)

The separate Granot automation run collection measured 2.225 GB logical. Its seven-day TTL already bounds retained plans during normal operation. Measure age past expiry and inflight plan bytes before changing that contract. The current immediate opportunity is removing the receipt, observation and decision for each verified closed, superseded operation.

## Production release

Commit `69d6504d6fb67ec403a99748e37bbcbae8246b08` reached the production alias at 11:54:18 a.m. New York. The deployment and Mongo worker stamp matched. Both the public application and database readiness endpoints returned HTTP 200, with `vantagemovers` at ready state 1. The exact release passed the preview, production-configuration build, three compiled retention checks, typecheck and lint. Hosted application tests passed 3,851 cases with 177 opt-in skips. The separate loopback lifecycle sweep passed 110 disabled-Sheet cases and 40 queued-Sheet cases with provider delivery isolated. Focused replay coverage exercised both outcomes and both Lead targets, decision expiry, legacy caches and later reconciliation. [Pull request](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/225) · [Production workflow](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44350918834) · [Build qualification](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44349032666)

The writer keeps the decision ID, observation ID and target ID in BSON ObjectId form for the two routine HTTP Lead outcomes. The reader reconstructs the original result if the receipt still points at that decision. Every qualifying operation saves 82 retained BSON bytes, with the same count of Mongo writes. Archive publication uses the bytes already retrieved and checksummed for decoding and count verification, saving one GCS GET per newly published object. The object write and verify-before-publish ordering stay intact. The per-object read saving follows from the call paths. Production GCS request latency and billing need their own observation window.

## Execution evidence

The October 28–30 UTC window contained 56,669 observations. The preliminary replay screen admitted 50,620 candidates. The final exact-source manifest contained 50,600 chains, 216,089,532 logical bytes, SHA-256 `e500805080203f26c70962e1724704ee52b046f4afcf572b090231c82f5d286b`. An isolated restore reproduced all 151,800 original BSON documents byte for byte. See the operation results below for production deletions.

## Verified production outcome

The six exact-manifest operations removed **230,062 receipts, 230,062 observations and 230,062 synchronization decisions**. The 690,186 documents contained **1.038 GB of logical BSON**. This equals approximately 45.9 hours of gross input at the earlier 543.13 MB/day rate. Original IDs for all three document types were independently checked absent for every committed chain. The operation kept 34,072 prepared chains hot when the frozen proof no longer covered their current state. Earlier screening had already excluded unmatched history, changing pages, active runs, protected references and current winners.

| Collection | Removed documents | Removed MB | Start logical GB | End logical GB |
| --- | ---: | ---: | ---: | ---: |
| granot_webhook_receipts | 230,062 | 507.54 | 4.340 | 3.859 |
| granot_observations | 230,062 | 248.76 | 2.098 | 1.862 |
| synchronization_decisions | 230,062 | 281.93 | 2.422 | 2.155 |

Production continued writing during the measurement. The logical bytes removed above come from the transaction ledger. Hot catalog and closure BSON measured 3.07 MB before and 3.94 MB after. The exact raw rollback exports total 149.65 MB compressed, in addition to application archives, replay objects, manifests and catalog recovery bundles.

| Cohort | Exact export chains | Deleted | Held at removal | Removed MB | Raw export GCS generation |
| --- | ---: | ---: | ---: | ---: | --- |
| October 28-30 UTC | 50,600 | 50,600 | 0 | 216.09 | 1795019789924823 |
| November batch1 | 55,881 | 49,480 | 6,401 | 226.96 | 1795020402951173 |
| November batch2 | 53,394 | 45,479 | 7,915 | 208.56 | 1795020861438228 |
| November batch3 | 50,758 | 41,687 | 9,071 | 190.81 | 1795021360836951 |
| November batch4 | 48,824 | 38,924 | 9,900 | 178.05 | 1795021815843448 |
| November batch5 | 4,677 | 3,892 | 785 | 17.76 | 1795021836337359 |

The scheduled daily backup failed on November 18. These exact-manifest exports have independent recovery proof. A preceding full database dump restored 8,465,405 documents across 127 collections with zero reported failures. Each rollback export was restored and reread in an isolated Mongo database. The 792,402 restored documents include all subsequently held rows. Recovery sources, manifests and catalog bundles were downloaded by generation and SHA-256 checked. Eight removed samples from each cohort subsequently reconstructed through the application history and closed-run replay readers, for 48 successful checks. [Exact generations, checksums and count evidence](evidence/granot-hot-storage-2026-11-18.json) · [Private Cloud Storage recovery folders](https://console.cloud.google.com/storage/browser/vantage-mongodb-backups-496816/history/owner-relief/2026-11-18)

### Business behavior and physical disk

All 8,951 original Form Lead, 2,105 Call Lead, 1,069 Booking, 51 Cancellation and 3,754 Sales Outreach subject IDs survived. Both reporting destinations and all seven definitions retained their original IDs. Master Leads retained all six tab IDs and titles and Master Booked retained both. These checks establish document and tab identity. Physical sheet cell contents were outside the comparison. The cleanup wrote only archive metadata and the selected evidence chains in production. Final application and database probes returned HTTP 200 and HTTP 200 for the ready database.

Across the three target data files and their indexes, reported reusable space on the same member changed by **+310.05 MB**. All member volumes were 13.854 GB. Each free-space pair below is an observed whole-volume sample with other workloads, replication and maintenance running. Atlas billing savings and a physical-storage trend cannot be inferred from these pairs.

| Replica member | First observed free GB | Final free GB |
| --- | ---: | ---: |
| 00 | 3.419 | 3.350 |
| 01 | 1.749 | 1.576 |
| 02 | 1.687 | 1.730 |

The released cache produced 6,930 naturally completed compact results checked against their original decisions and observations between 2026-11-18T16:54:18.313Z and 2026-11-18T17:47:05.769Z. These retained **568,260 fewer BSON bytes**. The separate sample of business-changing outcomes found all 23 of 23 targeted Leads. The measured-day estimate is 9.87 MB. The five-slot projection is 2.91 MB/day.

Automatic retention ended in **shadow** with 0 TTL stamps recorded for the current UTC day. The three reference indexes are installed. The worker budget now depends on unique arrivals, verified archival and removal throughput. The existing seven-clean-day promotion gate remains active. November 18 already had six failures before the indexes. If November 19–25 UTC each record at least 100 qualifying chains, three successful Outreach comparisons, zero mismatches, zero failures and zero purge stamps, the earliest possible promotion check is November 26 at 00:00 UTC. Any failure moves that date. The first live proof after promotion is unique receipt, observation and decision removals against arrival bytes, including hot catalog growth.

## Production provenance indexes

Production now has the three approved sparse, ascending, non-unique indexes on the observation, decision and receipt fields under `entity_changes.provenance`. Each build committed across the three-member replica set with voting-member quorum. An isolated restore of the generation-pinned prebuild export verified all 178,390 EntityChanges and six original index definitions. No hints were added to the application query.

| Index | Finished, New York | Build seconds | Holder rows | Documents examined | Server execution ms |
| --- | --- | ---: | ---: | ---: | ---: |
| Original query | 12:48:15 | — | 34 | 178,390 | 300 |
| entity_change_granot_observation_ref_v1 | 12:48:35 | 2.24 | 34 | 178,390 | 352 |
| entity_change_granot_decision_ref_v1 | 13:03:59 | 2.14 | 34 | 178,393 | 372 |
| entity_change_granot_receipt_ref_v1 | 13:22:08 | 2.20 | 34 | 34 | 2 |

The fixed 64-seed cohort used both ObjectId and string choices, including 32 known holder records and 32 removed chains. It returned the same 34 EntityChange documents and exact projected reference digest before and after each build. The completed query uses all three indexes. The positive-only probe examined 34 documents, and the no-match probe examined 0. Over the first 15 minutes with all three indexes, eight natural shadow pages advanced 512 older receipts. The day’s failure count stayed at seven, with zero mismatches or TTL stamps. One partial-index run had timed out on EntityChanges at 13:14:33. The worker checks references twice per full page. At 720 pages/day the old full-scan path could examine roughly 257 million EntityChanges/day. The number of matching holders determines the indexed document count.

Combined named index allocation on members 00, 01 and 02 was 8.38, 8.38 and 8.38 MB respectively. Two members started above the earlier proposed 87% maintenance threshold. The trial used the actual 90% warning, a 1.4 GB minimum and a cumulative 100 MB loss guard measured from the original series baseline. Member 00 crossed the loss guard briefly during the second observation window. Free space recovered ahead of the next build. Prebuild Atlas data shows similar minute-scale reversals on this member. At the end of the observation window, free space was 3.237, 1.690 and 1.629 GB on members 00, 01 and 02. Members 00 and 02 were over 100 MB below initial volume headroom. The 90% disk alert threshold was clear on every member and continued capacity monitoring is warranted. At 13:56 New York a subsequent all-member check passed the original cumulative and absolute guards, with 3.365, 1.759 and 1.705 GB free. The exact source of the volume movement is unproven. [Production query, allocation, recovery and replica evidence](evidence/granot-provenance-indexes-2026-11-18.json)

During the index window the worker scheduled 1,536 distinct older receipts for review on the following day. Archive eligibility and TTL removals have their own counters. 6,952 receipts arrived during this partial window. The arrival process is concentrated in hourly automation batches.

Under all three indexes, 2,742 automated attempts completed at 98 ms p95, 672 Outreach evaluations completed at 45.98 s p95, and four working Sheet drains completed at 2.93 s p95. The final 15-minute interval recorded zero Vercel 5xx responses. Only nine EntityChange writes fell in the post-index histogram, so a precise production write penalty is still unmeasured. The restored comparison had shown +10.4% insert p95. [Business latency and observed errors](evidence/granot-index-business-windows-2026-11-18.json) · [Replica headroom chart](evidence/granot-index-member-headroom-2026-11-18.png)

## Single-write receipt completion

Production release `615ff367` reached the canonical alias at 13:47:15 New York. This release integrates certification commit ec5679d8 with the independently released five-slot Estimates scheduler. Accepted Lead evidence still stores the winner's observation, receipt and decision. The fenced completion now stores the reverse Lead reference on the same receipt update. A lost lease, rejected receipt mutation or transaction failure rolls back provisional Lead certification. The earlier separate scheduler release was already serving production from 13:16:44 New York. Subsequent reconciliation can still invalidate the certificate.

The loopback comparison executed the old and new finalizers on 300 measured winning Leads each. Both issued 600 decision/observation reads and 300 Lead updates. Receipt updates fell from 600 to 300. Finalizer p95 was 9.08 ms before and 9.43 ms after on this fixture. The reduction is one application update per successful certificate and retains the same business fields. Transaction commands, Atlas storage-engine writes and billing require their own measurements.

| Workload | Qualifying routine certificates | Receipt update commands avoided |
| --- | ---: | ---: |
| Observed 24 hours ending November 18 at 11:00 New York | 105,447 | 105,447/day |
| Busiest arrival hour, 06:00–07:00 New York | 6,921 | 6,921/hour |
| Twice the measured daily mix | 210,894 | 210,894/day |

The certification code passed all 150 loopback lifecycle cases. The integrated release passed 3,850 hosted application tests, three compiled retention checks and both preview and production readiness. The hosted suite skipped 177 opt-in cases. The production alias and worker both identified 615ff367. From promotion at 13:47:15 through 14:00:02 New York, zero new receipts arrived. The merged writer is deployed and tested. Its first natural certification and realized daily command reduction remain unmeasured. The Owner moved on to service slimming and asked to stop the watch. [Pull request](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/226) · [Production workflow](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44371805110) · [Measured local comparison](evidence/granot-certification-local-cost-2026-11-18.json) · [Production qualification](evidence/granot-certification-production-2026-11-18.json)
