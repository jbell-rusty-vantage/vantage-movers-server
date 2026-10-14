# Rep desk Phase 1 verification

Authority: [`../knowledge/overnight-rep-desk-and-pool.md`](../knowledge/overnight-rep-desk-and-pool.md), Owner request of October 13, 2026 America/New_York.

Status: implementation and independent application review complete; final checks, browser proof, PRs and deployments are still pending. No Phase 1 merge or deployment is claimed here. Pool discovery remains gated on Phase 1 completion and merges.

## Baselines and safe execution

- Fetched server `origin/main`: `eb532d96ce657f8bdca8a643774a5d98a8510f23`.
- Fetched admin `origin/main`: `db93ec999910ef1cb94998949a9aeda085ff0c07`.
- Clean worktrees: `/workspace/work/vantage-movers-server` and `/workspace/work/vantage-admin`, branch `codex/phase1-owner-sales-control`; original snapshots preserved.
- Initial Git network failure was command sandbox access to the configured proxy. The supported per-command network permission resolved it; proxy and network policy were unchanged.
- Local MongoDB 8.0 replica `csi01` is bound to `127.0.0.1:27189`; test harnesses must select synthetic test databases and disable external side effects. No production Mongo experimentation is authorized.
- Normal server production deploy is `.github/workflows/vercel-main-server-production.yml` on `main` push. Preview runs typecheck and full tests; Quality also runs lint and quality tooling tests.
- Vercel team `team_tVdLH8ZMMtS3MsmAdbRsoGDv`, server project `prj_K1he4MhLkTAbudfQ3EsZzMTOdcvM`, admin project `prj_0Y3DtyhbrQNY2ZP9KZf5BOWSSAbW` are resolved through authenticated project metadata.
- Before implementation, authenticated deployed GET `/configuration` returned HTTP 200, revision **26**, codes **2 and 3 → daily**, 0 → new, 1 → quoted, 5/7/8 → closed, unmapped → none and official Booking → closed. GET `/capabilities` and `/health` also returned 200. These were read-only probes with runtime-bound credentials; no policy PATCH was sent.
- Initial production Vercel evidence: server deployment `dpl_DWkYTubEPmP3wbhSNEiJj9mofQTL` READY at `c12592f6cf31a0491801efa5d82d0ff0dfe82e99`; admin `dpl_DTfVkUfgrS2KeUaQVAoji5QtUiqm` READY at `db93ec999910ef1cb94998949a9aeda085ff0c07`. These are baseline deployments, not Phase 1 delivery evidence.

## Source and eligibility findings

`evaluateDeskEligibility` closes subjects with `booked_id` before other closure checks. That rule is correct for cadence and unsuitable for the Owner's assigned-Lead potential metric. Phase 1 uses a dedicated read predicate over current canonical `receiver_agent`; it does not reopen subjects or change cadence. `FormLead.booked` and `CallLead.booked` supply the attached `BookedLead.total_binder_amount`; lean reads do not include the compatibility virtual `binder_amount`.

Official credit is the stable Agent's allocation slice, independent of current Lead assignment. Assigned potential is the Booking total and is not earned commission. Duplicate cross-model links must not multiply a Booking total across Leads or Reps; missing, dangling, and conflicting links must have explicit coverage evidence.

## Acceptance evidence

Passed so far:

- Focused money/live: 15 named tests; signed HTTP read/DTO: 10 named tests. Rep self 200/foreign Agent 403; selected Owner/Manager 200, missing selection 400; generic Admin/unsigned/unlinked denied. Stable allocation cents, 650 historical Booking fixtures and 350 assigned Leads prove no page/ranking cap. New York January/year/DST boundaries, genuine zero, unknown/dangling/mismatched coverage, priorities 7/8/9, canonical Cancellation anchors and current-assignment changes are covered.
- Real Mongo metrics, committed combined change stream, transaction rollback, old/new assignment and allocation owners, foreign scope and ids-only hints: [`phase1-local-integration.md`](phase1-local-integration.md). Synthetic records only.
- Move sort: 360 queue plans, ties/nulls across pages of sizes 1–4, combined search/date/priority/workflow filters; assigned/team indexed query explains with no blocking sort; correct order/paging with both new indexes absent: [`MOVE-DATE-VERIFICATION.md`](MOVE-DATE-VERIFICATION.md).
- Independent review found and resolved linkage, cancellation, mock-read and table placeholder issues: [`REVIEW.md`](REVIEW.md).
- Admin full offline suite: 1,191 tests, 1,176 passed, 15 skipped, zero failed (157.5 seconds). Latest admin typecheck and changed-file lint passed. Full admin lint reproduces six `react-hooks/set-state-in-effect` errors and five warnings in untouched current-main files; it is not a Phase 1 regression. Diagnostics are retained in the Admin presentation evidence.
- Server full lint passed; quality-tool suite passed all 33 tests. Final server typecheck/offline suite remain running.
- Canonical packet validators pass in both repositories: 104 release files; all 105 files including manifest match bytes; all 34 generated DTO examples match Admin test fixtures. Policy decision revision and the prior Daily amendment are unchanged.

Local test-run setup corrections: an initial isolated database suffix contained an extra underscore and was rejected by the database guard before connection. The offline suite was then run with injected provider/Mongo configuration removed, rather than enabling optional replica checks implicitly. The Admin invite tests initially inherited `ADMIN_PUBLIC_BASE_URL`; the clean offline run above passed without changing that untouched service/test.

Pending: final server full checks, real UI/browser filter/relative/live/reconnect proof; PRs/merges; normal deployment workflows and deployed reads/UI. No incomplete item above is claimed as shipped.

## Production operations

No policy PATCH, enrollment, Pool apply, customer message, or production data backfill has been performed. If the new query requires declared production indexes, record the concrete index plan and repository approval requirement before execution. Sorting is designed to read the existing authoritative `display.move_date`, avoiding a projection backfill.

## Handoff gate

Phase 2 may start only after Phase 1 is complete and merged. Owner approval remains required before any production Pool creation, reprioritization, reassignment, enrollment, sync, deduplication, reconciliation, cadence configuration change, or Pool feature implementation.
