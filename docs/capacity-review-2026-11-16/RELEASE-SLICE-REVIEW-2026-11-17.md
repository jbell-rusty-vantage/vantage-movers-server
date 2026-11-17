# Independent release-slice review — November 17, 2026

The immediate releasable outcome is a smaller, reviewable W0 forecasting correction and W5 persistence-efficiency canary. The full capacity mission remains open. This review does **not** qualify the entire uncommitted tree for deployment, authorize a database operation, or close elapsed-time production gates.

## Reviewed source and recommendation

The specified checkout is still `capacity/remaining-efficiencies-2026-11-17` at `491ab2a03d6f2706b6ecf5f75a62cd2a266f37da`. Existing worktrees were inventoried read-only. The target contains the prior integrated, uncommitted implementation. Preserve it and construct a separate exact release tree; do not deploy this working directory wholesale.

I found no blocking correctness defect in the W0/W5 subset below. Recommend releasing it only after typecheck, lint, offline regression, W5 replica recovery on the **exact isolated subset**, production build verification, and deployment identity checks pass. The source review is a canary recommendation, not a production benefit measurement.

Runtime files:

- `src/services/systems/capacity.ts`
- `src/services/systems/readers.ts`
- `src/services/systems/databaseForecast.ts`
- `src/services/systems/workflowCounters.ts`
- `src/services/granotHttpCollector/runWorkflow.ts`
- `src/services/granotHttpCollector/runPersistence.ts`

Changed/new tests and executable recovery proof:

- `src/services/systems/capacity.test.ts`
- `src/services/systems/databaseForecast.test.ts`
- `src/services/systems/workflowCounters.test.ts`
- `src/services/granotHttpCollector/runPersistence.test.ts`
- `src/services/granotHttpCollector/runRecovery.replica.test.ts`
- `ops/capacity/run-recovery.replica.ts`

Existing `runWorkflow.test.ts`, `automationApply.test.ts`, Systems route/snapshot/runway tests, and Granot lifecycle tests remain baseline dependencies. The recovery test imports baseline `prepareClosedRun`; prove it against the release subset without importing later W9 archive changes. Pure `capacityAlerts.ts`/test are optional preparation, have no runtime route, and are unnecessary for this canary.

Documentation in the release should describe this subset and its limits. The integrated Service-document edits contain other waves and must not be copied unqualified as shipped behavior. W5 and W0 implementation notes can accompany the release with a separate release record stating which code is actually live.

## Why this slice preserves the priorities

W0 changes the existing capacity response, preserving its nullable `breakdown` contract while suppressing an unsupported physical-reclaim claim. Current Admin `lib/api/systems.ts` accepts null; `components/systems/systems-model.ts` conditionally renders the old breakdown. Additional forecast/storage fields are optional. Failed allocation reads now produce unknown evidence rather than partial totals. These paths do not modify lead, Sheet Sync, Outreach or Granot business effects. Counters are bounded, process-local and explicitly incomplete; without broader producer hooks this slice must not claim workflow coverage or fleet totals.

W5 reduces advisory progress checkpoints and sends bounded receipt-array updates. Every existing renewal gate freshly reads primary account/run ownership and expiry. Renewal headroom is 1,350 seconds, longer than the configured 800-second invocation. Receipt replacement and append both obtain fresh run fences; matched-count success permits identical replay. Stored receipt shape, action identities, sealed checksums, approval, Outreach refresh ordering, collection/planning limits and external side-effect fences remain unchanged. Readers use action IDs, not replacement-array ordering. Existing network-side-effect TOCTOU limitations remain; no atomic external guarantee is claimed.

Neither slice changes a model, creates/drops an index, changes configuration defaults, modifies TTL or retention, alters cadence, or enables post-expiry work. Granot creation still assigns seven-day `purge_at`; approval and apply retain original 24-hour `expires_at` predicates. Binary rollback remains shape-compatible and needs no data migration. Reverting W0 should not re-label the old oplog subtraction as measured reclaimable bytes.

## Excluded behavior and remaining gates

- W2 A is not ready for this release: its explicit prerequisite is W1 qualification. The recorded 48-hour and seven-day checkpoints cannot finish before November 18 at 9:06:40 p.m. and November 23 at 9:06:40 p.m. New York respectively. Natural workload and genuine-change causal proofs are also required. W2 B additionally needs reviewed indexes and shadow parity before activation.
- W3 removes the universal TTL declaration locally and contains stamp/migration tooling. Existing live indexes would not be dropped by Mongoose, but the declaration release and any policy/TTL/stamp operation remain separate gates. Do not include it for convenience.
- W4 changes active shadow-worker behavior as well as opt-in throughput. Live failures, access-path evidence and restore/load prerequisites remain unresolved by offline passing tests.
- W6 includes default-on expired-processing reclamation and detached-retry handling, not merely disabled flags. Producer and drainer must travel together; an old producer ignores the detached marker, so rolling back while detached pending work exists needs a compatibility/settlement procedure. Optional active slots require separately installed indexes. Keep this lane separate pending its rollout qualification.
- W7 default-on summary work plus opt-in aging, W9 archive readers/writers and W10 shadow representation are independent later releases. Do not blend them into W0/W5.

New Outreach/CSI models use the existing `defineCsiModel` boundary with `autoIndex=false` and `autoCreate=false`; new Sheet slot indexes are explicit migration constants, not schema-installed indexes. This confirms that disabled models do not silently install their reviewed indexes, but is not sufficient to qualify their behavior for release.

## W5 lifecycle decision

Recommend **retaining the existing expiry and purge behavior in this capacity release**. The rejected proposal is not necessary to obtain checkpoint/receipt write efficiency. It could retain every newly flagged preview or completed run indefinitely until certification succeeds and allow previously approved, unexecuted selected actions after their original expiry. Disabling creation would not revoke existing v2 continuation. Those are distinct business and recovery policies, not an incidental optimization.

No rejected implementation was retried. The absence of `src/config/domain/granotAutomation.ts` and `src/services/granotHttpCollector/runRetention.ts`, unchanged `GranotAutomationRun.ts`, and existing expiry predicates were verified. A future lifecycle proposal should first demonstrate affected production cases and specify bounded closure/review, stale-action revalidation, flag-off handling and recovery. Explicit authorization is required if indefinite retention or post-expiry execution remains necessary. This review requests neither implicitly.

## Fresh independent verification and scope limits

The independent focused command ran Systems tests/routes, `runPersistence.test.ts`, `runWorkflow.test.ts` and `automationApply.test.ts`: **66 discovered; 65 passed; one explicitly opt-in replica skip; zero failures/cancellations; process exit 0**, 68.6 seconds. Log: [release-review-w0-w5-2026-11-17.txt](evidence/release-review-w0-w5-2026-11-17.txt). This run used the integrated working tree, so exact isolated-slice checks remain mandatory. Prior replica results are supporting evidence, not newly executed by this reviewer.

Two current W2 paths differ from the prior review manifest: `refreshWorker.ts` and `capacity-refresh-generations.replica.ts`. The newer change correctly separates historical evaluation `asOf` from real completion time: completion now lets `completeSubjectRefresh` evaluate lease expiry using its current wall clock. The added replica case expires the claim then supplies historical evaluation time and requires lease refusal. A fresh replica run exposed a stale expected status (`retry`) in that fixture: the runtime correctly returns `lease_lost`. The coordinating validator corrected only the assertion, added unchanged consumed-generation/pending assertions, and reran successfully (exit 0); the initial failing log remains preserved in the integrated checkout. The completion CAS still fences owner, epoch and generation. Preserve and revalidate this correction; old hashes/test totals do not qualify it. These files remain outside the immediate release slice.

Before production claim: independently inspect the final staged/release-tree diff, run the appropriate isolated replica proofs, verify production branch/workflow and built-function contract, record commit/deployment/alias/runtime SHA and health, and collect natural workload after rollout. Stop/revert on changed approval identity, lost receipt, unexpected lease refusal growth, processing/backlog regression or failed genuine downstream delivery. Production updates/bytes per action and representative load are still required before W5 efficiency is qualified; deployment alone does not finish W5 or the capacity mission.

## Isolated release-tree review addendum

The separate checkout `C:/Users/Pinda/.codex/worktrees/capacity-qualified-release/vantage-main-server`, branch `capacity/qualified-w0-w5-2026-11-17`, was independently inspected after assembly. All six recommended runtime files byte-match the reviewed integration versions. No other runtime changes or model/index/configuration changes are present in this slice. `git diff --check` passed.

The release-copy W0/W5 notes were narrowed to the actual subset; full original integrated notes remain preserved in the original capacity checkout. The Systems Service document no longer claims workflow capture hooks or an alert module that this release does not contain. Counter output is explicitly incomplete with no producer hooks. No extra broader implementation artifacts were copied to satisfy misleading links.

This final source review finds no blocking defect in the isolated W0/W5 slice. Actual exact-tree static/offline/replica results, build, commit, deployment, natural workload and health verification belong in the coordinating release record. This addendum does not substitute source inspection for those gates and does not qualify any excluded wave.

## Pre-production qualification workflow review

The later-added `.github/workflows/capacity-release-qualification.yml` was independently reviewed against the existing production workflow. It intentionally builds production configuration without a deployment. Both use Ubuntu, pnpm 10.13.1, Node 24, Vercel CLI 60.0.0, frozen dependency installation, standalone typecheck, offline tests, production `vercel pull`, the 12-GiB Node build heap, `vercel build --prod`, and the built Granot retention verifier. Qualification additionally runs lint.

The workflow grants only `contents: read` to GitHub, has a `capacity/qualified-*` push trigger and manual dispatch, and has no PR trigger, deploy, alias, promotion, artifact upload, environment-file upload, database migration or worker invocation. Production build configuration is pulled after tests. The verifier exercises emitted JavaScript against synthetic database objects rather than connecting to Mongo. Vercel project/org IDs come from the same repository secrets as production. No new production environment or index changes are requested.

Branch metadata necessarily differs from main; workflow-global author login and application API secret are omitted. These omissions do not alter the reviewed build/verifier logic; the production pull still supplies the configured project's build environment. The Vercel token remains workflow-global as in production; narrowing it to the pull/build steps would be optional least-privilege hardening, not a blocker to this trusted release.

A successful qualification run means its checks/build/verifier passed. **It does not automatically compare the 91 inherited diagnostic identities.** The operator must compare normalized file/code/message multisets against the deployed baseline before pushing main; unexplained new diagnostics block release. This workflow enables that gate without sending an unqualified build live. It does not replace the production pipeline or assert that environment configuration cannot drift between builds.

No blocking issue was found in this configuration-only addition. Exact application/test validation remains applicable because those files were unchanged; the workflow receives this separate configuration review, and its real execution/result still needs to be recorded.
