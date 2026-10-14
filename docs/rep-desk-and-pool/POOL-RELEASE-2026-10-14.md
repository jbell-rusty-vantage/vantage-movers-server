# Priority Pool release — October14,2026

Owner approved [the current proposal](POOL-APPROVAL-2026-10-14.md) and requested implementation, merge and deployment. This release record separates implementation proof, selected pilot activation and deliberate later expansion. The verification worker performed no Pool feature activation, deployment, commit or customer contact. It performed the primary operator's explicitly reviewed correction of synthetic test records described below; feature release actions are recorded separately.

## Canonical review and pilot

Fresh read-only canonical inventory completed at `2026-10-14T20:55:39Z`, configuration revision26:

| Cohort | Leads | Meaning |
| --- | ---: | --- |
| Assigned to active eligible Desk Rep |453| Initial pilot candidates, subject to fresh exact-ID pins |
| Assigned to another receiver |56| Otherwise coherent shared Leads; retain receiver, review assignment separately |
| Unassigned |92| Otherwise coherent; retain Unassigned and review routing separately |
| Closed subject |1| Excluded; no automatic reopening |
| Canonical shared Lead eligibility |601| Sum of the three coherent cohorts; not automatic admission authority |

The [sanitized full report](evidence/release/expansion-review-2026-10-14.json) is sequential read-only review evidence. It inspects all602 existing stored priority9 Leads and supplements the canonical membership service with independent raw Booking/source/accepted-evidence/Sheet checks. It is not a new provider survey. The241 held provider rows from discovery remain outside this report and cannot create Leads.

The initial [pilot report](evidence/release/pilot-report-2026-10-14.json) selected20 assigned existing Leads,19Form and1Call, with zero holds. Exact identities remain in ignored `ops/output/pool-pilot-2026-10-14.json`. This captured manifest expires after30minutes and becomes stale on configuration or source/Lead/subject/link/Sheet pin changes. **Regenerate after deployment/index/configuration installation before any apply.** No historical capture is an apply manifest.

An independent live validation caught equivalent prefixed/numeric Job Numbers represented by coherent active Record Link aliases to the same Lead. The canonical inspector now accepts those aliases only when all equivalent links agree on canonical Lead/source and have no dispute/Booking conflict. It selects the accepted Observation's exact Job anchor before the stored Job anchor. Conflicting aliases remain holds.

## Implemented release gates

Tooling and exact commands: [ops/pool-production/README.md](../../ops/pool-production/README.md).

1. Merge compatible server and Admin changes with appropriate checks passing; deploy both and verify Ready/current commit stamps.
2. From the clean deployed server checkout, plan/build the additive indexes through `outreach:indexes` and the separate `pool-production/indexes.ts` collector TTL plan. Require the Lead/date/kind unique duty index, retained canonical source-event indexes and `granot_estimates_schedule_retention` (`purge_at`, TTL0). Never use schema-drift overrides.
3. Plan/install only the optional approved Pool configuration namespace. Keep `admission_enabled:false`; preserve the existing policy/calendar/goals/Sheet settings.
4. Generate a fresh at-most20 assigned-existing-Lead pilot manifest and review its hash/counts/holds. Run the activation CLI without `--apply` first.
5. The primary release operator applies the exact reviewed file/hash. Membership, audit and command ledger commit in one transaction, with current pins/configuration rechecked. No unmatched creation, reassignment or Sheet mutation belongs to activation.
6. Verify all roles, shared completion/actual caller attribution, webhook9/non9 transitions, scheduled lane health, source/official holds, ordinary queues/Sheets and live resnapshot recovery.
7. Review expansion deliberately after the pilot observation. The 56 other-receiver and 92 unassigned cohorts are explicit separate decisions; receiver readiness is not a canonical shared-Lead eligibility rule. `expansion.ts` requires a committed pilot, exact inventory/cohort hashes and a separately generated fresh at-most601 manifest, then revalidates/commits in batches of20. The primary operator's reviewed scope covers the three coherent cohorts, preserving every receiver/Unassigned; the closed subject and241 provider holds stay excluded. Never treat an inventory count alone as an apply request.
8. After verified expansion, explicitly plan/apply `configure --admission-enabled=true` with the fresh expected revision to enable prospective eligible Pool admission from webhook and scheduled collection. This is an explicit rollout decision; the initial pilot/configuration commands default false.

The hourly application cron retains the ALL lane and gates Pool lanes from approved configuration. Refresh runs at 08/13/18 New York after its frozen corresponding ALL collection scope; discovery runs at 06 New York over declared Open Dates 2020-01-01→today. Durable scope manifests retain missing children through interrupted dispatch. Foreground runs include trailing 90 dates and remembered older provider months; positive non9 evidence from ALL detects exits. Pool absence never proves exit. See the primary collector evidence for scope/request/recovery proofs. Each production child authenticates independently: 80 historical children at the observed six-request baseline imply approximately **480 HTTP requests**, before adaptive splits/retries, versus the shared-session 85-request discovery inspection. These are different execution shapes, not interchangeable traffic claims. Measure production traffic under the per-child collection/transport budgets.

## Verification evidence

[Replica evidence](evidence/release/shared-duty-replica.json) runs production services and the actual signed Express router against synthetic data on the fixed loopback replica, with Sheets/messaging disabled and no provider requests. It proves:

- Concurrent distinct canonical Call Interaction derivations produce one shared duty and preserve both real caller credits; same-source three-worker replay and retry-after-commit add no events/completion.
- Late earlier evidence corrects the stable winner; provider revocation and same-event timestamp correction retain an audit of the prior completion.
- Assignment remains unchanged; calls on unassigned Pool do not infer a receiver. Owner-off caller evidence does not fulfill shared work, and its event-time eligibility snapshot remains stable.
- Reviewed answered inbound fulfills shared duty with zero outbound goal credit; Pool does not enter `eligible_new_quoted`.
- Next-date quota has no catch-up debt; same-date exit/reentry retains completion;19:30inclusive cutoff, Sunday, explicit Owner closure, NewYork DST and no retroactive admission debt hold.
- Actual signed Pool queue/detail admit eligible non-assigned Reps; ordinary private queue remains private. Owner/Manager are admitted, generic Admin/unsigned/inactive actors denied. Exit immediately revokes foreign detail and evicts the row on resnapshot; the assigned Rep retains ordinary access.
- Real Mongo change streams deliver the committed Pool invalidation to two authorized Rep SSE connections. Connect frames require full resnapshot.
- The final hardened signed-queue run measured 20 records in 170ms/28 Mongoose queries, 100 in 306ms/28 queries, and 601 in 1,436ms/56 queries. A concurrent verification run had measured 13.7 seconds. Batching is proved, but local latency varies materially under contention and is not an Atlas guarantee. Raw-driver Booking lookup is additional to the Mongoose debug count; release acceptance must check deployed queue latency.

Manifest integrity/freshness/privacy/cohort tests pass. Typecheck passed on the verified working snapshot; final server/Admin CI and browser evidence are recorded by their owners. Provider capture merge/deduplication remains covered by retained capture tests; synthetic source fixtures do not certify external delivery or live customer calls. Browser cache eviction and deployed signed reads require release acceptance evidence.

## Production operator record

Pending primary release operator: server/Admin commit and PR links; Ready deployment stamps; index plan/apply; Pool configuration revision/hash; fresh pilot file hash and activation command receipt; deployed role/queue/live checks; observed collector lane freshness; pilot observation and any separately reviewed expansion.

Rollback uses a versioned `pool.enabled:false` configuration change with automatic admission false. The configuration transaction closes active Pool episodes at its disable boundary. Preserve Lead priorities, receivers, normal Sheet lineage, verified events/credits, completed duties and audit history. Historical provider corrections continue to recompute existing original duties; disabled sharing creates no new duties, and calls in a disabled interval cannot fulfill same-day reentry. No Lead deletion, closed-subject reopening, historical quota rewrite or automatic source-sheet restoration.

## Test-environment incident and exact correction

The primary operator's collector replica test inherited an opt-in flag with production database settings. One test lacked its own loopback/named-database assertion, so it wrote synthetic queue data to production. The verification worker's read-only audit found 507 synthetic runs and 15 synthetic manifests (including 11 deliberately backdated `disabled-*` fixtures). Deployed workers completed 93 empty provider collections, reporting 558 HTTP requests; all recorded plans had zero actions, zero approvable rows and zero run receipts.

The primary operator explicitly reviewed the exact private ID/actor scope and authorized reversible containment, then archival/removal of only those synthetic operational records. At `2026-10-14T21:13:33Z`, one Mongo transaction verified all 522 archive content hashes, copied originals/current records to `pool_test_quarantine`, and removed the exact pinned synthetic IDs with the matching `isolated-pool-test` initiator. Remaining synthetic operational runs/manifests are zero; ordinary non-synthetic run count stayed **129→129**. No Lead, lifecycle Receipt or Sheet records were changed. Private backups remain under ignored `ops/output`.

[Redacted incident evidence](evidence/release/TEST-INCIDENT-2026-10-14.json) records the archive digest/counts and before/after checks. The collector tests now assert an isolated named database and loopback URI before connecting and the actual connected database/host afterward. The shared-duty harness also disables automatic collection/index creation before imports and checks the actual connection and every chosen writable model database before its first write. No broader cleanup was performed.
