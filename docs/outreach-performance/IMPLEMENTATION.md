# Implementation and operating instructions

October 16, 2026. Implements the [approved specification](SPECIFICATION.md); the [exploration](EXPLORATION.md) remains the design provenance.

## Runtime shape

- Server read: `src/services/salesOutreach/performance/read.ts`, with pure scoring/ranking in `compose.ts` and strict response/query contracts in `src/validation/v1/salesOutreachPerformance.ts`.
- Evidence: `performance/evidence.ts` writes within existing source/evaluation transactions. It retains logical SMS volume independently of subject matching, on-time/missed SMS obligations with deadline responsibility, certified coverage and explicit capped-input gaps. No cadence calculator is duplicated.
- Storage: `sales_outreach_sms_volume_contributions`, `sales_outreach_sms_requirement_days`, `sales_outreach_performance_policies` and `sales_outreach_performance_state`. Policies are shared by fingerprint. Existing daily call projections remain authoritative. The model registry declares eight additive indexes; startup/GET never creates them.
- Capacity: first-time capture writes current-day subject snapshots rather than 30 empty history dates per Lead. Old empty markers are removed; meaningful past obligation outcomes remain. No message bodies, media or duplicated policy blobs per day. No new environment variables.
- Admin: `components/outreach-desk/views/rep-performance.tsx`; separate week query keys and exact Manager GET proxy permission. Rank computation and responsibility stay on the server. Existing queue filters do not change the full-team comparison.

## History limits

Call history reuses actual retained all-outbound counts and frozen daily goals. A legacy eligible-only row without an all-outbound count is pending, not a miss. Disabling today's goal metrics does not remove old frozen targets.

SMS reliable dates begin when reporting capture is established. First-time reconstruction does not claim historical priority-policy truth. Previous unsupported weeks remain navigable and visibly pending. Retained certified outcomes survive queue history truncation, source retention and disabling current capture. Capped inputs mark the affected date provisional; unknown obligations are never called No texts due.

## Verification

- Focused server route/calculation checks cover access, week validation, day-goal arithmetic, weighted required-text completion, helper credit, absences, partial-day goals, unknown/zero distinctions, ties, DST, capped-input gaps and historical capture/goal toggles.
- Dedicated loopback replica proof: `node --import tsx ops/sales-outreach/performance.replica.ts`. It uses only `127.0.0.1:27204`, replica set `performance01`, a disposable uniquely named test database, and scrubs provider credentials. Start that isolated replica before running. It proves actual persistence replay, failed-send reversal, unassociated volume, helper responsibility, history beyond 30 dates, frozen policy, obsolete slots and evaluator no-op materialization.
- Admin production build, typecheck, focused client/proxy/cache/render checks and a Manager browser regression pass. Desktop and 390px screenshot evidence is in the [Admin evidence folder](../../../vantage-admin/docs/outreach-performance/evidence/). The browser test exercises channel/keyboard focus, expansion through refresh, historical navigation and contained mobile scrolling.
- A small independent review found unknown legacy call counts, historical goal toggles, capped-input gaps and capture toggles; fixes and regressions are included.

The ordinary local typecheck also sees an unrelated ignored `ops/output/pool-active-canonical-audit.ts` scratch file with pre-existing errors. Tracked-source typechecking excludes that output directory; no unrelated scratch file was edited. The full unit suite must run with opt-in Granot replica tests disabled; those separate tests require their own isolated launcher and refuse production settings.

Release check results: server full suite 3,610 passed / 145 skipped / 0 failed; Admin full suite 1,195 passed / 15 skipped / 0 failed. The final focused server route/scoring set passes 23/23, and the actual Mongo proof passes ten persistence scenarios. Admin build/typecheck and the desktop/narrow Manager browser test pass. Reliable call history starts no earlier than the first frozen goal date; unresolved text senders keep the volume tie-breaker provisional.

## Release and initialization

Both repositories use `main` at the Owner's explicit request. Preserve unrelated `.quality.config.json` edits and the pre-existing deleted server `SALES-OUTREACH-DESK.md`.

1. Run focused checks/typecheck and the isolated replica proof; inspect the additive index plan with `pnpm outreach:indexes --target=vantagemovers` (no writes).
2. Commit/push server main through the existing Vercel Production workflow. Build declared indexes with `pnpm outreach:indexes --target=vantagemovers --apply` under the deployed-writer guard. Additive indexes may be prebuilt with the guard's explicit schema-drift option when the deployment does not yet contain the new writers; no existing index/data is changed.
3. Initialize reporting with `node --env-file=.env --import tsx ops/sales-outreach/performance-backfill.ts --target=vantagemovers --limit=100` in report mode. It reports bounded inventory, storage sizes and estimated per-page additions. Apply uses `--apply`; verify uses `--verify`. Follow returned `sms_after`/`subject_after` cursors exactly. The PowerShell wrapper `performance-backfill.ps1 -Target vantagemovers -Mode apply -MaxPages 20` is bounded and prints restart cursors if its budget is reached.
4. Mark inventory complete only after both bounded walks exhaust and no capped subject is accepted as complete. The normal caught-up SMS sweep, rather than backfill wall time, certifies freshness. Verify reports no missing reporting facts in the retained range.
5. Commit/push Admin main through its Vercel Production workflow and confirm the deployment reaches Ready. Until server initialization finishes, the added card honestly reports pending evidence. Existing Desk activity and goals continue unchanged.

The initializer uses two indexed existence lookups per page and at most four independent transactions, avoiding serialized existence checks while reserving a fifth connection for out-of-transaction index-fence checks. For an operator-only tooling update against the already deployed identical runtime schema, `-AllowSchemaDrift` forwards the existing production-writer guard's explicit override; it does not relax target or checkpoint checks. A stopped page can be replayed from the last committed checkpoint, since individual writes remain idempotent and the page cursor advances only after all workers finish.

Rollback removes/hides the new read and card while retaining additive reporting facts. No policy, customer contact, Lead mutation, financial value or Sheet Sync change is part of this feature. Older code can ignore the new collections; no configuration namespace needs removal.
