# W0/W5 application release — November 17, 2026

The remaining outcome is sustained capacity relief with Sheet Sync, Sales Outreach and Granot behavior preserved. The qualified capacity forecasting and Granot persistence subset is deployed and its identity and immediate health are verified. This does not finish the entire capacity action plan or establish sustained production savings.

## Source and scope

Release branch: `capacity/qualified-w0-w5-2026-11-17`, based on freshly fetched `origin/main` at `491ab2a03d6f2706b6ecf5f75a62cd2a266f37da`. The owner-specified checkout remains on `capacity/remaining-efficiencies-2026-11-17`; its existing work is preserved. The release checkout contains only the six independently reviewed runtime files listed in [the review](RELEASE-SLICE-REVIEW-2026-11-17.md), their tests/recovery proof and matching documentation.

W0 distinguishes connected-member measurements from cluster coverage and estimates, segments forecasts across allocation changes, and removes the unsupported oplog-reclaim calculation. The existing Admin accepts the nullable breakdown and additive fields. Process-local counters are explicitly incomplete; producer hooks and fleet alerts are not included.

W5 checkpoints advisory planning progress every 25 rows or five seconds and updates individual action receipts under fresh lease fences. It keeps the existing receipt layout, operation identity, approval checksum, 24-hour plan expiry and seven-day purge behavior. Primary ownership reads remain at every existing gate, with renewal inside 22.5 minutes of the earlier persisted lease expiry. No cadence, schema, index, configuration, TTL or retention policy changes.

Sheet Sync and Outreach runtime files are unchanged from the deployed W1 baseline. No Call admission path is added. W2–W4 and W6–W10 remain outside this application release. In particular, default-on Sheet reclamation/detached retry changes are not hidden inside a nominally disabled bundle.

## Qualification and delivery gates

1. Exact isolated release tree: full offline regression, typecheck, lint, W5 persistence and recovery replicas, and lifecycle regression on disposable loopback Mongo only. Record actual process exits, source hashes and every gated skip.
2. Independent review of the final source and scope. The review is complete; test/build outcomes remain separate evidence.
3. Build before production: compare normalized diagnostic identities with the deployed W1 build (91 inherited annotations), not just their count. New errors block release. Standalone typecheck and built-function retention verification must pass.
4. Recheck `origin/main`, push only the reviewed release, and use the existing GitHub Actions production pipeline. Verify exact commit, deployment, alias, runtime worker stamp and application/database health.
5. Observe naturally scheduled work; do not manufacture production effects. Compare recent queues, expired leases, receipt progression and completed slot children. Production update/byte savings need representative measurements and cannot be inferred from deployment or synthetic command sizes.

## W1 observations and remaining time gates

At approximately 10:15 a.m. Eastern, the November 16 10 p.m. and November 17 8/9 a.m. ALL and Pool-refresh slots each had 65 completed children. Read-only closed windows contained 6,877 overnight and 13,773 daytime completed receipts. Calls had 506 and 1,012 `already_current` Decisions respectively, no requested Sheet effects, and no Call EntityChanges/new Call update jobs. The daytime latest-20 sample retained exact current temporal winners; all 20 superseded overnight winners were explained by later accepted Decisions. These are bounded observations, not storage or fleet savings.

No genuine Call business change occurred in those sampled windows, so causal genuine-Call delivery proof remains open. The next-business-day observation, November 18 9:06:40 p.m. Eastern 48-hour checkpoint, and November 23 9:06:40 p.m. seven-day checkpoint remain separate. W2 A must wait for its W1 prerequisite; this W0/W5 subset has its own post-first-correctness-release gate.

## Rollback and stop conditions

For the isolated release, revert its application commit through the same production pipeline. Old and new W5 binaries understand the same stored receipt array and immutable plan/approval data. No data migration or database rollback is required. Preserve all recorded acceptance/history. The old capacity subtraction must not be interpreted as a measured reclaim estimate if the forecast code is reverted.

Stop rollout or revert on a new changed-file build diagnostic, failed health/identity verification, lost or duplicate action receipt, changed approval/operation identity, unexpected lease-refusal growth, or sustained worsening of current Sheet/Outreach/Granot queues. Distinguish the existing expired/unapproved Granot backlog from new failures. No database cleanup, index operation, compaction or retention activation accompanies this release.

## W5 denied proposal

Recommend retaining current expiry and purge behavior. The denied lifecycle proposal is unnecessary for this write-efficiency subset and was not retried. It would permit indefinite retention pending closure and execution of previously unexecuted selected actions after approval-plan expiry. Those consequences require specific authorization if later demonstrated necessary. Current read-only evidence found expired queued/failed runs without approvals, not a need for expired approved action execution.

## Execution record

Exact isolated-tree application qualification passed: 4,024 offline tests discovered, 3,848 passed, 176 explicitly gated skips, zero failures/cancellations, child exit 0. Whole-project typecheck, package lint and diff check exited 0. Focused W5 persistence/workflow/apply passed 20 tests with zero skips; W5 worker crash/unchanged-expiry/closure passed three with zero skips. The separate lifecycle replica proof passed 150 tests with zero skips, using explicit synthetic dataset configuration and disabled external delivery. The complete offline skip inventory is retained; these proofs do not claim real provider writes or every opt-in group.

[Frozen exact-tree validation, source hashes and skip inventory](QUALIFIED-VALIDATION-2026-11-17.md) records the actual child exits. A redundant lifecycle invocation without the required synthetic dataset failed as a harness configuration error; it is preserved separately and is not substituted for the successful explicitly configured 150-test run.

The added `Capacity Release Qualification` workflow was independently reviewed. It matches production tooling and build configuration, adds lint, has read-only GitHub permissions and no deploy/alias/worker/migration step. It downloads production build configuration only after tests and uploads no build/environment artifacts. Its success does not replace the manual diagnostic-identity comparison before the `main` push. Runtime/test sources were frozen during validation; this reviewed workflow is a separately recorded configuration addition.

Application commit: `7d12c4b3e09ef1e0e87c16dabbb8cc816427d73a`. [Build-only qualification run](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44116697063) passed typecheck, lint, full tests, production artifact build and built-retention verification. All 91 diagnostic identities and multiplicities match the deployed W1 baseline: no additions/removals. Only expected line shifts occur (`runWorkflow.ts` +2 lines; `readers.ts` +9). [Diagnostic comparison](evidence/w0-w5-qualification-build-parity-2026-11-17.json). This is inherited build-tooling debt, not a clean diagnostic log.

After refetching and verifying `origin/main` still exactly matched the expected base, the reviewed commit was fast-forwarded to `main`. The [production pipeline](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/44119191697) completed successfully, including built-function retention verification. Its 91 diagnostic identities/multiplicities also match the baseline with no additions/removals ([production comparison](evidence/w0-w5-production-build-parity-2026-11-17.json)).

Production deployment **`dpl_384JZ1Fn3N22ZnFRTAhqdC1XgLhm`**, created November 17 at approximately **11:00:49 a.m. Eastern**, is READY. The canonical alias `vantage-movers-main-server.vercel.app` points to it. Application and database health each returned HTTP 200 / `ok`; database ready state is 1. The database worker stamp at 11:05:00 a.m. Eastern agrees on both the full application commit and deployment ID. [Deployment and HTTP evidence](evidence/w0-w5-production-verification-2026-11-17.json).

At **11:05:43 a.m. Eastern**, the pending Sheet Sync job had drained: no current pending/retrying/processing/failed jobs and 15 new last-hour jobs synced. The CSI job queue had 116 pending jobs, oldest due approximately 37 seconds earlier, no expired leases or dead letters. Granot runs created in the last hour included 31 completed, 86 queued and 13 applying runs; the historical failed count remained 305, and no active expired lease was reported. One last-hour webhook receipt remained scheduled for matching retry: it was created at 10:25:24 a.m., last updated at 10:40:46 a.m., **before deployment**, with zero technical attempts, match attempt 4 and next attempt 11:25:24 a.m. No error code was present. It is unresolved pre-existing matching work, not evidence of a newly introduced technical failure. [Queue follow-up](evidence/service-health-followup-2026-11-17.json), [bounded retry metadata](evidence/receipt-retry-health-2026-11-17.json). These are short mixed-release-window observations; they do not qualify a full slot, provider delivery, production write savings or sustained capacity relief.

The existing credential also passed a raw-driver read-only rehearsal of the W0 data prerequisites: valid allocation statistics from all eight visible databases and valid oplog allocation/logical-limit values, with zero query failures. [Prerequisite evidence](evidence/w0-live-reader-prerequisites-2026-11-17.json). This is not an Owner-session UI or fleet-coverage test.

## Separate recovery decision

The [backup diagnosis and exact repair proposal](BACKUP-OOM-DIAGNOSIS-2026-11-17.md) now confirms OOM on both November 17 logical-backup attempts. Fresh Atlas snapshots remain available; current full-system restore proof remains absent. The proposed separate Cloud Run canary changes only the named job from 1 GiB to 2 GiB, permits one bounded execution under existing retry/time limits, and requires archive verification and an isolated local restore. It was not executed. Earlier failed days' causes remain unproved, and 2 GiB sufficiency is not assumed.

The [three-reference-index proposal](W4-ATLAS-DIAGNOSIS-2026-11-17.md) and [exact 25-job export/restore evidence](W3-BOUNDED-COHORT-2026-11-17.md) are separately bounded. Neither is permission for an index operation, retention change or deletion. At the measured current yield, compaction remains deferred.

The final delivery/recovery report was independently reviewed against the saved evidence. Queue wording preserves its actual scope (all CSI jobs and last-hour Granot runs, not a stage-filtered Outreach or manifest-joined complete-slot proof). No blocking source or reporting issue remained. The final documentation commit does not redeploy or change the application runtime.
