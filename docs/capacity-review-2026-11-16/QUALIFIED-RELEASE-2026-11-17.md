# W0/W5 application release — November 17, 2026

The remaining outcome is sustained capacity relief with Sheet Sync, Sales Outreach and Granot behavior preserved. This release isolates capacity forecasting and Granot persistence efficiency; it does not finish the entire capacity action plan. Deployment and validation evidence will be recorded below only after verification.

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

Build-only qualification and production deployment remain pending. This document does not yet claim a new production release or completed capacity mission.
