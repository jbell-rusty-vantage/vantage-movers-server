# Service operability qualification — November 17, 2026

Owner outcome: reduce repeated application work and let a fresh agent inspect, reproduce and verify a workflow without production credentials or private setup explanations. This slice starts with Sheet Sync; other workflows are mapped in the [operations entrypoint](README.md).

## Source and production identity

- Working checkout: `C:/Users/Pinda/.codex/worktrees/capacity-qualified-release/vantage-main-server`.
- Dedicated branch: `optimization/service-operability-2026-11-17`, based on `868db09443681753390c25d0e6cec2160a130795`.
- Remote: `https://github.com/jbell-rusty-vantage/vantage-movers-server.git`; `origin/main` independently matched that base at task start.
- The separate `capacity-phase-one` checkout at `491ab2a0` contains preserved unpublished later-wave work. It was consulted, not reset or deployed.
- Read-only Vercel inspection under the verified `vantage-4d3db9ef` scope found canonical production alias still on READY deployment `dpl_384JZ1Fn3N22ZnFRTAhqdC1XgLhm`. The release record identifies its application commit as `7d12c4b3e09ef1e0e87c16dabbb8cc816427d73a`. Database health returned `ok: true`, ready state 1 and `vantagemovers`. Initial Vercel inspection used an unrelated default account scope and failed; the explicit correct scope succeeded.
- Local toolchain: Node `24.18.0`, pnpm `10.13.1`. Local Mongo proofs use isolated Docker Mongo 8 replica sets bound only to loopback. No provider writes or production data mutations were requested.

## Implemented scope

Sheet metadata persistence groups overlapping planned documents at their final surviving occurrence. Each physical document receives one combined update; every logical job retains its outcomes, attempts and completion semantics. The last loaded snapshot and final-document ordering are preserved. Metadata failure still makes confirmed subscribers retryable; uncertain writes remain deferred. No model, index, TTL, retention, cadence, approval or expiry contract changes.

The operator CLI provides credential-free discovery and local Sheet inspection/trace with bounded, projected data. It explicitly labels incomplete history and partial evidence. Production diagnostics and repairs are unsupported in this slice. The local launcher uses a verified loopback PRIMARY replica, an allowlisted child environment, and an isolated working directory. It does not load a private `.env` or token cache. This is isolation from inherited configuration, not a universal network sandbox.

## Evidence and remaining qualification

The first slice is locally implemented, integrated and independently reviewed. Four GPT-6 Astra agents covered efficiency, operator tooling, setup and a fresh-context rehearsal. Root integrated the changes and independently reviewed the persistence change. [Independent review](INDEPENDENT-REVIEW-2026-11-17.md) records authorship separation and corrected findings. Earlier capacity-release test totals do not qualify this diff.

| Proof | Result and scope |
| --- | --- |
| [Final complete default suite](evidence/full-tests-final-2026-11-17.txt) | 4,048 discovered; **3,872 passed, zero failed/cancelled, 176 gated skips**, exit 0, 313.96 seconds. Node ran the package's five registered test groups with the standard setup and an allowlisted local child environment. |
| [Every skipped test](evidence/skipped-tests-2026-11-17.json) | All 176 names retained. Their gated durable/provider proofs did not run in the default suite; the separate Sheet replica result does not qualify other skipped workflows. |
| Sheet/Google/Admin/cron regression | 160 passed, zero skips; see [efficiency evidence](../efficiency/sheet-metadata-2026-11-17.md). |
| Supported service proof | 78 fast tests and seven real-Mongo recovery scenarios passed with zero skips on Windows and Linux. Provider effects were faked. |
| [Operator proof](evidence/operator-validation-2026-11-17.json) | 17 setup/operator tests passed; actual diagnostic monitoring observed only five read commands, excluded seeded sensitive/malformed fields, and retained explicit truncation/history limits. Privilege-denial cases were injected, not an authenticated production-role rehearsal. |
| [Fresh-agent rehearsal](FRESH-AGENT-REHEARSAL-2026-11-17.md) | A new Astra agent used only onboarding in a separate source snapshot, diagnosed a seeded retry obligation without inventing its cause, ran 78 fast / 17 safety / seven replica proofs and typecheck, and supplied two reviewed runbook clarifications. Dependencies and local replicas had already been provisioned. |
| [Windows and fresh Linux setup](SETUP-EVIDENCE-2026-11-17.md) | Actual API `/db` identity verified; fresh Linux Dockerfile build and frozen install succeeded. Hostile inherited credentials and a synthetic private `.env` did not enter the API child; `.env` stayed byte-identical. Child termination and temporary-directory cleanup passed. Hosted Cursor adoption remains unverified. |
| [Final focused check](evidence/focused-final-2026-11-17.txt) | 26 operator/setup/runtime-configuration tests passed, zero skips. |
| Static checks | Whole-project typecheck, full lint including operator/launcher/recovery-harness paths, and `git diff --check` passed. Final logs: [typecheck](evidence/typecheck-final-2026-11-17.txt), [lint](evidence/lint-final-2026-11-17.txt). |

The observed synthetic overlap fixture has three logical subscribers to one Form document. Baseline made three metadata updates on both uncertain delivery and recovery; the changed implementation made one in each case. Update-document BSON bytes were **879 → 293** and **792 → 264** respectively. One physical append and all three eventual job completions were preserved. These are command/update-payload measurements on synthetic Mongo fixtures, not wire-byte totals, production latency gains or disk reclamation. [Before/after logs and explanation](../efficiency/sheet-metadata-2026-11-17.md); [final source hashes](evidence/source-manifest-2026-11-17.json).

### Failed attempts retained

The [first broad run](evidence/full-tests-2026-11-17.txt) reported 3,867 passes, one failure and 176 skips (4,044 then-discovered tests). An existing default-database test inherited the deliberately isolated `testvantagemovers_agent` name, so its default-name assertion failed. Root made that test explicitly unset the override for its default case and added a test proving the override cannot change the production database. Runtime selection code is unchanged; the CLI author independently reviewed the correction, nine focused configuration tests passed, and the complete final run above passed. Concurrently completed test additions explain the remaining discovery-count difference. The first output used Node's spec reporter, so the coordinator's initial TAP-only summary extraction returned no summary; its actual log and exit 1 were retained. The final run explicitly selected TAP.

Other corrected attempts are recorded in setup/operator evidence: Windows restoring an omitted USERPROFILE, invalid existing Cloud JSONC, dotenv/token-cache exposure, a tsx grandchild, a cold-start deadline under contention, and missing lint coverage. No failed attempt is counted as a pass.

### Local resource handback

The task-owned Windows proof containers `vantage-operability-agent-proof` and `vantage-operability-sheet-proof` were verified by their task label and stopped after all database proofs. Their synthetic data remains available for an explicit restart; no unrelated container was changed. The separate Linux rehearsal container was stopped/removed and its built image retained. The exported rehearsal checkout remains at the path in its report, without private owner configuration. No API listener is required for the finished artifact.

## Rollout and rollback

This work is uncommitted local implementation. No commit, push, merge, deployment, production enablement or sustained production qualification is claimed. Repository release rules require explicit owner approval for a rollout; this task prepares a reviewable result first.

Application rollback restores the preceding drainer implementation and preserves all jobs, attempts and metadata. It restores duplicate metadata write cost but needs no data migration or environment changes. The local `pnpm dev` behavior intentionally becomes synthetic-only; provider-specific development remains outside the safe onboarding path. Reverting that tooling would reintroduce inherited-environment exposure, so retain the safety wrapper when rolling back only the runtime optimization.

Production qualification still needs an authorized release, normal traffic with overlapping plans, comparable update/latency observations, and recovery/queue health. W1 observation gates and later-wave release dependencies remain unchanged. Backup/recovery work and destructive capacity operations remain separately scoped.
