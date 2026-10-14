# Rep desk Phase 1 verification

Authority: [`../knowledge/overnight-rep-desk-and-pool.md`](../knowledge/overnight-rep-desk-and-pool.md), Owner request of October 13, 2026 America/New_York.

**Phase 1 shipped, merged and verified at `2026-10-14T03:07:37.572302+00:00`.** Both repositories are merged to `origin/main`, both normal production workflows completed with READY deployments, and authenticated deployed server reads passed. The Phase 2 discovery/design gate is open. Production Pool mutations and Pool feature implementation still require Owner approval.

The exact redacted records are [merge and CI evidence](evidence/phase1/merge-and-ci.json) and [deployed read verification](evidence/phase1/deployed-read-verification.json). They contain deployment/run identifiers, HTTP statuses, calendar windows, coverage counts and timings; no credentials, contact rows, Agent identifiers or dollar amounts. The `phase2_started: false` field records the Phase 1 completion checkpoint, before the subsequent discovery branch was created.

## Final merges, CI and production delivery

| Repository | PR | Final CI head | Merge on `main` |
| --- | --- | --- | --- |
| Server | [#218](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/218) | `9f781c59ebc131a765058ed27c9c94a69dd620e3` | `beadfd11872acad0eede2774148fa11db651178c` |
| Admin | [#7](https://github.com/jbell-rusty-vantage/vantage-admin/pull/7) | `3e9145ca0587fdf62a7f66d82d6f4b315f59315f` | `5fc16d9538a308e7086dc28e157b7788f6f4c107` |

Merge trees equal the final tested trees: server `a2d180a00c33f6d0ea5e5ee7562ff2f2ca129a39`; Admin `3a2e66dab0343934ad6198f97387e2e61eb2b1b0`. These were checked with `git show -s --format='%H %T'` for each merge and final CI head.

- Server Quality run [38502667749](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/38502667749) and Preview run [38502667919](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/38502667919) passed. Typecheck/lint passed; the full suite ran **3,687 tests: 3,546 passed, 141 opt-in/skipped, zero failed**. All 33 quality-tool tests passed. The redundant local full run was stopped after exact-head CI passed and is not claimed as a completed local full run.
- Admin Preview run [38502718613](https://github.com/jbell-rusty-vantage/vantage-admin/actions/runs/38502718613) passed typecheck, full tests, build and deploy: **1,193 tests: 1,178 passed, 15 skipped, zero failed**. Changed-file lint passed. Full local Admin lint reproduced six `react-hooks/set-state-in-effect` errors and five warnings in untouched current-main files; these were not Phase 1 regressions.
- Server normal production run [38503685749](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/38503685749) delivered READY deployment `dpl_DpKHwQG4dS2gc1wqRkbuNqGJBFBc`, serving `https://vantage-movers-main-server.vercel.app` and `vantage-movers-main-server-vantage-4d3db9ef.vercel.app`.
- Admin normal production run [38503192868](https://github.com/jbell-rusty-vantage/vantage-admin/actions/runs/38503192868) delivered READY deployment `dpl_23T8LKGLVZdAprWHmfFgf4drceyK`, serving `https://vantage-admin-rho.vercel.app` and `vantage-admin-vantage-4d3db9ef.vercel.app`.
- Independent application/helper review and Cursor Bugbot were clear. Admin Security automation passed. Server Security/Approval automated review could not start because of an environment parse failure; Vercel AI review skipped for insufficient credits. **Not all automated reviews ran.** The independent review findings and their resolved tests are retained in [REVIEW.md](REVIEW.md); its pre-merge status text is historical.

## Money source, coverage and preserved policy

Official gross credit uses the selected Rep's own `agent_allocations[].binder_amount` by stable Agent id, respecting allocation cents and split rules. Current assignment does not rewrite historical official credit. Official Booking dates are calendar dates, with Today, the entire previous Monday–Sunday week, the entire previous calendar month and All Time; cancelled bookings remain in the documented gross official basis.

Assigned potential uses current canonical `receiver_agent` over the complete eligible Lead scope, independently of outreach enrollment or loaded queue pages. Both `FormLead.booked` and `CallLead.booked` supply the attached `BookedLead.total_binder_amount`; lean reads do not rely on the compatibility virtual `binder_amount`. The Booking total is assigned potential, not earned commission. Priorities 7/8/9 and existing duplicate/bad/cancelled/ineligible rules remain excluded. Reciprocal linkage and canonical identity prevent cross-model aliases from multiplying the same Booking; unknown, dangling, mismatched, ambiguous and missing-amount coverage remains explicit, and stored zero is distinct from unknown.

The deployed selected Rep read reported **partial coverage: 254 eligible Leads, 76 linked Bookings, 178 missing links, zero dangling links, missing amounts, mismatched links or ambiguous identities**. This is one Rep's read-time coverage, not a system-wide total. Missing links do not acquire an invented forecast.

Cadence eligibility continues to close officially booked subjects; the separate assigned-potential read does not reopen them. Deployed configuration remained revision **26**, codes **2 and 3 → daily**, 0 → new, 1 → quoted, 5/7/8 → closed, unmapped → none, and official Booking → closed. No configuration PATCH was sent.

## Focused, replica and browser acceptance

- Focused money/live and signed HTTP/DTO tests prove Rep self access, foreign-Agent denial, selected Owner/Manager access and unsigned/unlinked/generic Admin denial. Stable allocation cents, 650 historical Booking fixtures and 350 assigned Leads prove no page/ranking cap. New York January/year/DST boundaries, stored zero, coverage distinctions, priorities 7/8/9, canonical Cancellation anchors and current-assignment changes are covered.
- Real Mongo metrics, committed combined change streams, old/new assignment and allocation owners, foreign scope, ids-only hints and rollback passed with synthetic records only: [phase1-local-integration.md](phase1-local-integration.md).
- Move-date sorting passed 360 queue plans, ties/nulls across page sizes 1–4 and composed search/date/priority/workflow/assignment filters. Assigned/team index explains had no blocking sort, and complete pagination remained correct after both new indexes were dropped locally: [MOVE-DATE-VERIFICATION.md](MOVE-DATE-VERIFICATION.md). Form Lead dates remain authoritative date-only values; Call Lead dates remain null. Date filtering does not alter cadence or closure rules.
- The indexed local acceptance rerun passed **3/3 actual browser tests** against the local login, BFF, API, Mongo and SSE, including Owner/Manager/Rep/Admin permissions, composed filters, reload persistence, cursor traversal, relative labels, committed money refresh and missed-change recovery after stream close/reopen. All nine live checks passed, including two consecutive mutation/restore cycles and idempotent no-op restoration. Real aggregate revisions and schema-validated receipts committed atomically under the declared unique EntityChange revision index. A deliberate duplicate revision failed with Mongo 11000; transaction rollback left aggregate revision and receipt count unchanged. The browser run took 51 seconds; seven synthetic screenshots are recorded in the Admin evidence. Chromium's transport-offline simulation did not close existing SSE, so a separate offline-caption browser assertion is not claimed.
- Canonical packet validators passed in both repositories: 104 release files; all 105 files including manifest matched bytes; all 34 generated DTO examples matched Admin test fixtures. Policy decision revision and the prior Daily amendment remained unchanged.

## Authenticated deployed read evidence and limits

The runtime-bound, signed, GET-only proof completed without production mutations. Owner and Manager selected-Rep metrics and Rep self metrics returned **200**; Rep foreign-Agent and generic Admin metrics returned **403**; Owner metrics without a selection returned **400**. Deployed Today was `2026-10-13`, Last Week `2026-10-05` through `2026-10-11`, and Last Month `2026-09-01` through `2026-09-30`, matching the New York date at verification. The DTO bases were `gross_own_allocation` and `current_assignment_attached_booking_total`.

All, Future, Past and Unknown Team move-date views each returned **200** with five sampled rows, correctly ordered with nulls last and a next cursor available. Observed queue request times were **0.397 s, 0.248 s, 0.251 s and 0.276 s**, respectively. These are sampled deployed reads, not a full production pagination or load test; complete paging was proved on the local replica.

The deployed live connection returned **200** with `text/event-stream`, a `connect` frame requesting `refetch: all`, then a 30-second `clock` frame requesting full refetch. Production committed-mutation/live refresh was not exercised; that behavior was verified against the indexed local replica/browser setup.

Admin production login and JavaScript asset probes returned **200**. **The authenticated deployed Admin desk was not walked.** The 3/3 browser acceptance result above is local, not deployed UI evidence. An optional anonymous BFF financial API fetch through a temporary Vercel link was not executed because automatic approval review rejected that action for financial-disclosure risk. Verification continued through the safer signed server GETs and persisted only redacted summary evidence.

The guarded repro script is [ops/sales-outreach/phase1-deployed-read-proof.py](../../ops/sales-outreach/phase1-deployed-read-proof.py), derived from the executed GET proof. It accepts only the fixed production alias and endpoint allowlist, explicitly creates GET requests, disables redirects and requires `--run`; importing it sends no requests. It expects the existing runtime-bound credential variables (`VANTAGE_API_SECRET`, `VANTAGE_ADMIN_PROXY_SIGNING_SECRET`, `VANTAGE_ADMIN_USER_ID`, `VANTAGE_ADMIN_EMAIL`) and never reads a secret file or prints raw response rows. Run only under the managed credential context:

```sh
python3 ops/sales-outreach/phase1-deployed-read-proof.py --run
```

The copied script was syntax/guard checked offline; the hardened copy was not rerun against production for this documentation handoff. It deliberately asserts the verified configuration revision/map and must be reviewed if subsequent authorized policy changes alter that state.

## Execution boundaries and next gate

Implementation baselines were server `eb532d96ce657f8bdca8a643774a5d98a8510f23` and Admin `db93ec999910ef1cb94998949a9aeda085ff0c07`. Clean Phase 1 worktrees preserved the original snapshots. Local MongoDB 8.0 replica `csi01` used loopback `127.0.0.1:27189`, unique synthetic test databases, `TEST_MODE=true` and disabled external effects. No production Mongo experimentation occurred.

The two additive move-date projection indexes are prepared through the existing report-first `outreach:indexes` process and **were not applied to production**. They improve query plans; correctness was proved without them. No automatic projection backfill is needed. The deployed queue sample timings above do not establish production index presence or load capacity.

No production policy PATCH, enrollment, Pool apply, customer message, data backfill or separate index write was performed. Phase 1 merge/deployment/read evidence satisfies the ordered task's prerequisite for read-only Pool discovery and an approval-ready design. The discovery worktree starts from server merge `beadfd11872acad0eede2774148fa11db651178c` on `codex/pool-discovery-approval`; Admin main is `5fc16d9538a308e7086dc28e157b7788f6f4c107`.

Owner approval remains mandatory before any production Pool creation, reprioritization, reassignment, enrollment, sync, deduplication, reconciliation, cadence configuration change or Pool feature implementation. Phase 2 discovery/design is not represented here as an approved implementation.
