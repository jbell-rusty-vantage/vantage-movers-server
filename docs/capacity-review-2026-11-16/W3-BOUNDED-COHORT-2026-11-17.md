# W3 bounded 25-job evidence and deferred cleanup decision — November 17, 2026

This work closes a small exact-export prerequisite. It does **not** establish that these records are safe to delete or authorize cleanup. Live-context same-key replay and producer-readiness gates remain open; no deletion approval is requested yet. No production document, policy, index, TTL, or stamp was changed.

## Exact read-only cohort

- Collection: `vantagemovers.sales_intelligence_jobs`; dataset fields `deployment=csi-production`, `database=vantagemovers`.
- Observation: November 17, 2026 at 10:25:55.157 a.m. New York (`2026-11-17T15:25:55.157Z`). Fixed completion cutoff `2026-11-14T15:18:09.332Z`, strictly older than three days at selection.
- Bounded native-driver traversal: `completed_at < cutoff`, existing `csi_job_completed_ttl` hint, ascending completion time, maximum 1,000 documents, cursor batch one, 5,000 ms server query limit, 16 MiB cumulative read budget, one connection. Stopped after 271 read documents once 25 qualified review-candidates were found.
- Exact selected class: **25 `outreach_evaluate:unchanged`**. Status completed; correctly typed completion Date before cutoff; matching dataset; no lease owner or expiry; recognized complete result shape, positive publication revision, valid subject ID and next-evaluation timestamp; no purge date or prior manifest stamp. Updated results, admissions, other stages and malformed/unknown shapes were excluded. This is stricter than merely filtering old/unchanged rows.
- Completion range: `2026-11-14T01:04:52.486Z` through `2026-11-14T01:05:05.635Z` (November 13, 8:04:52–8:05:05 p.m. New York). These are roughly 3.6-day-old queue results, not historical customer records.
- The earlier 902 candidates among a first-1,000 sample were review candidates only. The current exact cohort was freshly selected; it is not a claim that all 902 have been exported, restored, or qualified.

Exact serialized source-document bytes total **19,536**; the BSON envelope is **19,683 bytes**. These are measured logical serialization lengths, not storage allocation or reclaim estimates. WiredTiger could return **zero filesystem bytes** from removing this small set. No physical saving or meaningful capacity relief is promised; this is potential canary evidence.

Export SHA-256: `e5c99ec8b3a8df56e0afc1f700a9d01eb890584106d454a2c3f9b4331f1aefc8`.

Private nonapply manifest-v2 file SHA-256: `c3599d0f0ba15b34db4cfe89f614ffd120ef2008ec3ba9368d4d66e6d904ca5c`.

Protected local directory: `C:/Users/Pinda/.codex/private/capacity-w3-2026-11-17-f2f20d08b3ca4382a2d96846c6916518`. Payloads and exact IDs exist only there, outside all Git repositories. Directory inheritance is disabled; its sole explicit allow rule grants the current Windows owner full control. All five initial artifact files were inspected: each has only the owner's inherited allow rule. No payloads/IDs were emitted to chat or Git. [Public aggregate evidence](evidence/w3-private-export-summary-2026-11-17.json) contains counts, dates, checksums and the local recovery path only.

The initial manifest used `BSON.calculateObjectSize` on wrapper-preserving records and reported 21,636 bytes. Independent serialization showed its estimate overcounted these numeric wrappers. Original files were preserved, and a create-only `candidate-manifest-v2.ejson`/`summary-v2.json` corrects the basis to the sum of exact serialized document lengths. The exported BSON itself is unchanged. Do not use the initial summary for byte claims. The existing W3 stamp tooling has similar calculated-size metadata; that is not authoritative physical or exact serialized-byte evidence.

## Why deletion is still held

The live job documents contain references and dedupe identity, not the complete evaluator state. Removing an old completed key allows a later same-key enqueue to create a new job. The real evaluator can read current subject/policy/configuration, call coverage, contacts, Pool duties and retained SMS-performance evidence. An `unchanged` old result does not prove a replay is harmless under today's inputs.

The source audit identifies admissions reads (excluded here), queue dispatch's missing-ID behavior, existing-job-key sweep suppression, insert-only dedupe/conflict checks and evaluator effects. Existing synthetic real-service replay tests exercise several changed-input cases but do not recreate the exact production context for these 25 jobs. No related customer/contact/Pool/SMS records were exported or replayed to manufacture that proof. Independent exact-byte restoration is a necessary backup proof, not proof of business replay safety.

The production remains on the existing job TTL; this work did not install a terminal-retention policy or approve a class. The plan additionally holds W3 until producer readiness and its observation prerequisites. The W0/W5 canary does not close W2's W1 prerequisite or release W3.

## Conditional operation boundary, not executable approval

If class/cause dependencies, production-shaped replay and observation gates later pass, the smallest cleanup candidate is the exact 25 IDs and per-document source hashes in `candidate-manifest-v2.ejson`, never a fresh broad age query. Re-read each selected document; skip missing, changed, noncompleted, newly owned/leased or separately stamped rows. A later approval must bind that exact checksum, verified restore result, operation type, target and maximum count. Any changed manifest requires a new review.

No production apply command currently accompanies this proposal. Existing stamp tooling requires policy/class approval and a separately reviewed TTL migration; using a global TTL migration merely to remove this small test cohort would expand the operation substantially. A direct bounded executor would also require independent implementation/review before an actionable approval. Neither route is authorized here.

For any later qualified operation, stop on hash/selection mismatch, a protected class, unexpected lease or dedupe effect, replica lag/latency pressure, error growth, backup mismatch or inability to restore. Monitor selected/skipped/applied counts separately from physical allocation/free-page changes. Preserve the source export and manifest throughout the recovery window.

Recovery starts by verifying the exact export checksum, decoding without numeric/binary promotion, and restoring all 25 documents into a new isolated local database for byte/read verification. A real production restore is a separate reviewed operation: verify destination dataset and exact IDs, refuse collisions/different current content, retain original dedupe/operation fields, and avoid overwriting live queue state. Do not assume restoring deleted rows automatically undoes any intervening replay effects.

## Independent restoration

At `2026-11-17T15:27:47.248Z`, a separate validator verified both artifact/manifest checksums and all 25 per-document hashes/lengths, then restored into a newly nonexistent disposable database on the verified sole-member loopback `capacityp1` replica. All 25 reread documents and the complete BSON envelope were byte-identical with BSON numeric/binary types preserved. Only that owned fixture database was removed afterward. Zero production mutations/provider calls; no application handlers or customer effects were invoked. [Independent restore proof](evidence/terminal-job-restore-proof-2026-11-17.json).

This verifies this local export's restore/read fidelity. It does not qualify live-context same-key replay, production restoration, or deletion safety. Source payload and exact IDs remain local and protected.

The independent validator also reran the existing synthetic real-service manifest/replay matrix: process exit 0 in 13.75 seconds. [Synthetic replica result](evidence/release-terminal-manifest-replica-2026-11-17.json) and [log](evidence/release-terminal-manifest-replica-2026-11-17.txt) are separate supporting evidence; the synthetic matrix did not execute these 25 exported jobs in their actual production context and does not remove the hold.
