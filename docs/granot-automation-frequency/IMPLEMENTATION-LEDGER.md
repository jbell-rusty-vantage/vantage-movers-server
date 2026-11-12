# Implementation evidence — November 4, 2026

Historical pre-release record. The Owner authorized integration/release November 5; implementation is committed as `6ed1aef6`. Current validation, additional Priority-only Sheet suppression and production evidence live in [the release review](RELEASE-REVIEW-2026-11-05.md). Uncommitted/undeployed statements below describe this original November 4 session.

The server patch closes the schedule/freshness defects and both pair-propagation gaps. Deployment and measured live Mongo/storage/convergence capacity remain outstanding. This is local engineering evidence, not production qualification.

## Baseline and boundaries

- Remote: `https://github.com/jbell-rusty-vantage/vantage-movers-server.git`.
- Base: `d63e512d0f1c157648b10dda41abe61742e3aadd`; working branch: `codex/granot-frequency-efficiency`.
- The packet and its `docs/index.md` pointer already existed as uncommitted Owner work. They were preserved and their implementation status updated.
- Patch is uncommitted; no new commit SHA is claimed. [PATCH-FILES.sha256](PATCH-FILES.sha256) identifies the reviewable files. [Release handoff](RELEASE-HANDOFF.md) records release/rollback and outstanding checks.
- No deployment, production mutation, external Sheet/provider call, import, backfill, financial change, new Call admission, or monitor was performed. Mongo writes were synthetic disposable loopback test databases only.

## Implementation and acceptance evidence

| Contract | Implemented behavior and proof |
| --- | --- |
| A1 schedule/replay | Shared New York gate: 08–20 hourly plus 22/00/02/04/06. Exact ordinary/spring/fall counts 18/17/18, midnight/year boundaries and old 08/13/18 identities in `estimatesCron.test.ts`. Real dispatcher interruption, frozen scope, same-slot idempotency and unchanged retry timestamps in `poolScheduling.replica.test.ts`. `vercel.json` unchanged. |
| A2 freshness/Pool | Compare fully collected scheduled instant with the grace-elapsed slot. Real persistent hourly failure, missing/partial children, newer complete coverage, held and suppressed effects, legacy manifest without `scheduled_at`, disabled Pool and independent 06:00 duties. Collection and completed effects reported separately. |
| A3 shared update | `synchronizeLead.replica.test.ts` uses the real lifecycle processor for webhook→automation and automation→webhook. Next-slot same values advance accepted temporal evidence without Lead business revision/EntityChange/Sheet churn; replay returns the same Decision; older capture loses. |
| A4 historical Calls | Existing qualification/reporting unit regressions and scoped automation replica cases pass. No admission code changed, no restamping or new Call creation path. Unsupported identity stays excluded. |
| A5 reporting/pair | `ops/granot-frequency/replica.ts` runs canonical mirror→queued outbox→actual synthetic Sheet planner for normal, Duplicate Calls, Bad Call Leads, No-Sync, never-delivered, Priority-only and unadmitted cases. Form Fill routes exclusively to Duplicate Calls. Replay leaves command/change/Sheet counts unchanged. |
| A6 related refresh | Same replica forces ambiguous Form refresh, completes its ordinary revision job, then mirrors the Call. Injected cursor-write failure rolls back nomination and cursor together. Committed tail/consumer clears held Form; replay creates no new period, Lead revision or job identity. Unit tests cover changed relation, invalid refs, absent/closed subjects and batched relation loading. |
| A7/A8 contacts/evidence | `cadenceConvergence.test.ts` joins actual subject refresh, contact derivation and evaluator in both orders, provisional→confirmed, outage at deadline, one credit, stable period and replay with zero event/projection writes. Existing contact pipeline/evaluation/coverage tests and disposable contact replica cover answered/outbound/SMS, protected assignment, number-link remapping, late evidence, watermark and sweep recovery. |
| A9 periods | Added same-value/2↔3 stability and both 0→5→0 consumption interleavings to `priorityPeriods.test.ts`; existing real subject replica proves atomic period transitions and uniqueness. If closure was consumed, no implicit reopening; if the transient state was coalesced away, it is not reconstructed. |
| A10 recovery | Pending-action replica proves receipts resume without recapture. Real subject replica covers tail overlap/revision reconcile/hold repair. Pair replica covers rollback and committed-job recovery. Best-effort post-commit mirror remains best-effort; the new durable wake starts only after a marker actually commits. |

Test paths above are under `src/services/granotHttpCollector`, `src/services/granotLifecycle`, or `src/services/salesOutreach/subjects` as named; the commands below identify the runnable scopes.

## Mongo and storage budget

| Repeated work | Write/query behavior |
| --- | --- |
| Retry identical scheduled slot/child | `$setOnInsert` with automatic update timestamps disabled; flags only update when changing false→true. Same identities and frozen windows; no retry timestamp writes. |
| Established Form/Call pair | Eligible equivalent Job matches decide the ladder, so no fallback phone query. Pure no-op exits before a canonical command or Sheet job. Ambiguity/protected receivers remain enforced. |
| Marker tail overlap/replay | One projected Call relation read per bounded page; deterministic EntityChange-based job identity, cursor and jobs in one transaction. No N+1 per changed row. |
| Fresh equal-valued observation | Retain acceptance clock/provenance and immutable Decision. No extra business mutation/Sheet update/period/contact credit. Subject observation bookkeeping and existing reconciliation jobs can still write. |
| Same contact/evaluation inputs | Existing fingerprint/CAS paths remain; joined test verifies no replay event or projection write. |

The schedule is six times the old daily slot count. The trailing 90 dates alone require 13 seven-day child windows: **39→234 ALL child scans/day**, before verified older dates, Pool refresh/discovery, retries and row-level evidence. This is a workload calculation, not a measured storage estimate. A fresh slot still produces observations/receipts and `SynchronizationDecision` evidence; these records are not eliminated by business no-ops. Decisions are append-only with update/delete guards and no TTL. Existing run/manifest retention remains unchanged. No raw-row hash shortcut, deduplication across distinct observation times, collection purge, retention change, new index or collection was introduced.

Therefore capacity is **unqualified** until live measurements show headroom. Before enabling/releasing this cadence, measure decisions/observations per slot, average document and index bytes, daily retained growth, write latency, lease contention, queue age and full-slot completion. If retained evidence growth is unacceptable, a separately designed evidence-compaction/retention contract is needed; deleting Decisions or skipping fresh temporal acceptance would change the system's audit/ordering semantics.

## Validation record

All new runners scrub provider variables, point dotenv at an asserted nonexistent file, and pin Mongo to loopback. Replica runners assert a unique test database and `csi01`, then drop only their own database. Sheet delivery is a synthetic planner/outbox proof, not Google delivery. A local Mongo 8.0.4 replica was used on port 27189.

```powershell
node --import tsx ops/granot-frequency/unit.ts
node --import tsx ops/granot-frequency/unit.ts "src/services/granotHttpCollector/*.test.ts" "src/services/granotLifecycle/*.test.ts" "src/services/salesOutreach/**/*.test.ts" "src/services/leads/*.test.ts" "src/services/sheetSync/*.test.ts" "src/services/googleSheets/*Targets*.test.ts"
node --import tsx ops/granot-frequency/replica.ts
node --import tsx ops/granot-frequency/collector-replica.ts
node --import tsx ops/sales-outreach/subjects.replica.ts
node --import tsx ops/sales-outreach/contact-events.replica.ts
pnpm lint
pnpm typecheck
```

- Pair/outbox/tail replica: PASS, including replay write counts and rollback.
- Scoped collector/lifecycle replica: **17 passed, zero failed/skipped**, including suppressed effects freshness.
- Existing subject replica: PASS (period atomicity, cursor overlap, revision/hold/decision recovery, contact re-derive, enrollment/expansion guards).
- Existing contact replica: PASS. Stale fixtures were corrected to use answered inbound calls for receiver filling, a Job Number for its unrelated C2C contact case, and the complete model registry when constructing the disposable database. Runtime RC policy was not changed to satisfy tests.
- Joined contact/Granot convergence: PASS. Final focused regression run: **1,651 tests; 1,530 passed, zero failed/cancelled, 121 opt-in replica skips**. Skips are covered only where a separate real replica result is listed; they are not counted as passes.
- Lint: PASS. Typecheck excluding the existing ignored `ops/output/**` audit artifacts: PASS. Plain `pnpm typecheck` remains blocked by four missing ESM extensions and one implicit-any in untouched `ops/output/pool-active-canonical-audit.ts`. The isolated check uses a temporary config extending `tsconfig.json` with its existing `ops/cloud/**` exclusion plus `ops/output/**`; no tracked compiler setting changed.
- Bounded full safe unit run: **4,000 tests; 3,824 passed, 9 failed, 3 cancelled, 164 skipped** (about nine minutes). Three database-dependent CPL tests hit the 60-second bound; the database-name assertion conflicts with the explicitly pinned safe test database; rolling-last-seven-days assumes a fixed duration across the November DST boundary; seven Windows Node test processes abort with `UV_HANDLE_CLOSING` after assertions. These untouched-area failures are disclosed, not counted as passes or claimed baseline-reproduced. Default replica skips are not evidence.
- The broader existing `ops/test-granot-lifecycle-replica.ts` run was also attempted: 109 tests, 92 passed/17 failed. Failures involve legacy Call creation/adoption fixtures under the retired qualification rules and one missing synthetic deployment ID. The latter passes in the scoped runner, which supplies it. This broad legacy suite is **not green** and was not rewritten to bypass current admission. No claim that all repository checks pass.

Final release review must consider these suite limitations alongside the targeted proofs. Owning Service/reference docs and the automation rule now describe the patch; they do not mark it deployed.
