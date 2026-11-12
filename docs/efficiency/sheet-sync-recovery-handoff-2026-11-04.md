# Sheet Sync structural recovery — November 4, 2026

The first efficiency slice protects reporting membership when Google commits an append or positional delete but its response is lost. Owner policy, qualification, routing and official financial eligibility are unchanged. Local implementation and qualification are complete; production deployment and physical post-release verification are separate release gates. D1 is proposed next and is unimplemented.

## Revision and scope

- Remote: `https://github.com/jbell-rusty-vantage/vantage-movers-server.git`.
- Baseline: fetched current main `190be6fae483a6d5ffb1a48660fd539041916068`, including the integrated Call review. Its production deployment was not established by this task.
- Implementation branch/worktree: `fix/sheet-sync-uncertain-recovery`, `C:/Users/Pinda/Proyectos/vantage/vantage-sheet-recovery`.
- Scoped commit subject: `Fix queued Sheet Sync recovery after uncertain structural writes [skip ci]`. The commit containing this handoff identifies the final revision without a self-referential hash. The chat's final report records the exact hash and verified main/push state.
- Owner extended the original local-commit instruction to include integration, push and a clean main checkout. The existing main-push workflow deploys production, so `[skip ci]` preserves the explicitly retained no-deployment boundary. No workflow configuration was changed. Local checks replace the skipped push CI for this commit.

Only queued Sheet Sync delivery, its necessary header-validation seam, subscriber finalization, tests and contracts changed. No production data, historical cleanup, ingestion, schema/index/TTL, environment, cadence, Desk, Granot worker, narrow-read or retention change was performed. Best Relocation final reconciliation remains complete, recurring ingestion/Granot creation retired, and the Source Company active for the Owner's separate deactivation. Form Fill continuation in the existing cron is preserved.

## Changed behavior

`deliveryRequests.ts` is a drain-local provider boundary covering the writer and its existing tab/header helpers. Each actual request, including a safe explicit retry, reserves quota and checks deadline, drain ownership and topology fence before sending. Both Google transport retry controls are overridden. Installed sources reviewed: googleapis-common 8.0.1 enables transport retry by default; Gaxios 7.1.4 can honor `retryConfig` even when `retry=false`. The actual Google client is tested with an offline adapter and deliberately enabled POST retries. Service-account JWT auth refreshes credentials before sending; its separate OAuth retry branch is restricted to explicit 401/403 rejection, not backend/lost-response outcomes.

Queued append/delete has one attempt per known plan. Backend/no-response errors, invalid append confirmation and uncertain delete outcomes defer work and stop **all further provider requests in that writer invocation**. This conservative boundary avoids using any cached structural positions; it may delay otherwise unrelated unfinished targets until the next drain. Confirmed earlier outcomes remain recorded. Explicit HTTP 400/401/403/404/429 rejection follows existing failed-attempt handling, with no inline structural reissue. Uncertainty/guard/quota deferrals retain attempts and retry after 60 seconds; ordinary failures keep the existing bounded backoff and Admin retry.

Next drain reloads canonical Mongo and fresh tab identities. It updates an existing destination rather than appending again, and satisfies a reliably absent deletion without touching its old position. Unconfirmed upsert metadata hints are cleared; historical delete positions remain hints and are never execution identities. A destination must succeed before stale membership is deleted. Duplicate-row cleanup uses the same single-attempt request boundary and descending positions. Mongo metadata failure after confirmed provider success remains retryable through fresh identity reconciliation.

Every claimed job receives an independent plan and outcome, including same-key jobs whose retry hints/tombstones differ. Identical physical writes still coalesce. Duplicate keys keep representative-only Daily Operations emission within a drain; actual facts retain per-job dedupe keys. Unfinished subscribers cannot inherit success merely because a representative was processed.

Identity evidence requires exactly one actual `Mongo ID` header and a valid topology/row response. A failed read is not absence. Cold initialization validates identity before rewriting a header, then reuses that read. Confirmed new empty tabs can initialize. Shifted legacy ID lookup still supports deletes; upserts/header rewrites that would move identity fail closed for operator correction rather than silently replacing a neighboring identity. No layout migration is included.

## Reproduction and measurements

The stateful workbook fake actually inserts/deletes before throwing a synthetic 503, with `retry-after: 0`. The two named committed/lost-response tests failed against the baseline writer before implementation. A second isolated baseline probe loaded the exact `190be6fa` writer and recorded:

| Fixture | Baseline physical mutations/result | Final physical mutations/result after recovery |
| --- | --- | --- |
| Append A, committed response lost | 2 appends; A twice; incorrectly synced | 1 append; A once; first deferred, both subscribers synced after fresh lookup/update |
| Delete A with a neighbor, committed response lost | 2 deletes; A and neighbor gone; incorrectly synced | 1 delete; A absent, neighbor preserved; next drain verifies absence |
| Successful overlapping jobs | Existing one-append coalescing | One append, outcomes for every subscriber |
| Cold/warm healthy tab batch | One tab identity read | One tab identity read; cold validation read is reused |

Recovery adds a fresh tab read and, for a committed append, an idempotent update. It does not claim read reduction, production damage, exactly-once network delivery or a percentage improvement in database/latency/storage. Per-request Mongo guard checks and accurate helper/retry quota charging are correctness costs.

## Validation

All provider operations used stateful synthetic workbooks or an offline Google transport adapter. No production credentials were loaded into tests and no customer workbook/provider was called.

- Focused Sheet Sync/Google Sheets/cron regressions: 149 passed, zero failures/skips. Daily Operations fact tests: 27 passed, zero failures/skips.
- Typecheck: passed. Lint: passed. Final affected checks were rerun after review fixes.
- Full repository suite with `--test-concurrency=3`: 3,984 tests: 3,822 passed, zero failures, 162 explicit skips; 568.343 seconds. Skipped integration checks are not counted as passes.
- `node --import tsx ops/sheet-sync-recovery/replica.ts`: seven proofs passed on disposable MongoDB 8.0.4 at `127.0.0.1:27129`, replica `sheetRecoveryProof`, PID-scoped `testvantagemovers_sheetrecovery*` database; dropped after the run. Covers atomic intent rollback, lost append/subscriber recovery from changed Mongo, tombstone delete/neighbor survival, independent financial retry hints, metadata failure after destination+stale-delete, competing drain/lease takeover and a newly held topology fence.
- Daily Operations completion inputs were replayed through the real Mongo stores, proving event dedupe rather than relying only on an in-memory count. Existing unrelated opt-in replica suites were not rerun; a broad replica campaign was not needed for this slice.

Repeat focused checks from the repository root:

```powershell
node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=3 "src/services/sheetSync/**/*.test.ts" "src/services/googleSheets/**/*.test.ts" src/routes/sheet-sync-cron.routes.test.ts
pnpm typecheck
pnpm lint
node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=3 "src/**/*.test.ts" "api/queues/**/*.test.ts" "ops/lib/*.test.ts"
```

For the replica harness, start a disposable Mongo instance bound only to `127.0.0.1:27129`, initiate replica `sheetRecoveryProof`, then run the standalone command above without dotenv. The harness pins its own local URI/test database and fails closed on the wrong connection. Synthetic logs and the baseline probe are retained locally under ignored `ops/output/sheet-sync-recovery/` in the implementation checkout.

## Reviews and resolutions

Correctness review inspected the completed writer, request boundary, Google transport/auth sources, tab/header helpers, row identity map, planner, job/metadata finalization, lease store and Daily Operations emission. Findings and triggers:

1. A shared Google `retryConfig` can still retry POST despite `retry=false`. Override both; actual-client append and delete tests prove one attempt even with adversarial POST retry defaults.
2. Real googleapis resource properties are nonconfigurable; a proxy that substitutes nested resources fails. Use a minimal guarded facade that binds the real method receiver and leaves the shared cached client untouched; actual-client tests pass.
3. A duplicate claimed key was unconditionally marked synced after representative failure/defer. Plan/finalize every logical job and coalesce physical requests afterward. Replica proofs cover pending recovery, metadata failure and different same-key financial hints.
4. Rewriting a missing/shifted identity header before reading rows can manufacture apparent absence. Read/validate before cold rewrite; reject malformed/ambiguous identity and unsafe projection layouts even with a warm header cache. Keep trustworthy shifted-ID delete coverage.
5. Quota reservations and asynchronous guards can yield past ownership/deadline. Recheck after reservation and after asynchronous guard work. Deterministic barriers/clocks cover between-chunk changes and lease takeover while a provider request is in flight.
6. Duplicate cleanup resolves numeric tab IDs outside the mutation catch. A stopped request boundary could otherwise discard earlier outcomes through that path. Catch that lookup as per-target failed/deferred outcomes; stateful cleanup/chunk tests preserve unrelated rows.

Clean-code review kept request/retry uncertainty policy in one small internal module, removed writer-level duplicate quota bookkeeping and the redundant recorded-row scan, retained the existing physical coalescer, and preserved existing external retry behavior. No generalized scheduler or mixed-intent resolution framework was added. No unresolved concrete regression was found in the final review; release limitations below remain explicit.

The first broad run found one obsolete source-shape assertion that required the removed unconditional duplicate-completion loop (3,821 passed, one failed, 162 skipped). That assertion was removed in favor of the real Mongo subscriber/fact proofs; the remaining Daily Operations hook assertions were preserved and all 27 tests passed. Final broad rerun evidence appears above.

## Release, recovery and rollback

Implemented/tested/committed/integrated/pushed evidence must be distinguished from deployment. The Owner authorized main integration and push; exact final Git evidence is in the chat report. Production deployment and live membership are **not** established here; this push deliberately skips automatic deployment. The Call review's collection/index/cron release checks must be verified before this slice is promoted.

1. Verify that the Call review prerequisite is actually deployed, including Form Fill work collection/index and the existing cron continuation.
2. Deploy this exact qualified main revision through the approved release workflow. No environment or schema migration is required.
3. Exercise append/delete recovery and subscriber completion in a synthetic/disposable workbook; verify attempt reasons, retained retry hints, no processing leak, unchanged ordinary request counts and the Form Fill continuation. Separately inspect authorized live membership if needed; local tests do not qualify production rows.
4. Missing/ambiguous headers, unsafe shifted upsert layouts or malformed topology need operator correction under the existing topology protocol; do not infer absence, reset stuck processing jobs or delete historical rows. Ordinary terminal failures use existing Admin retry after the cause is fixed.
5. Roll back the application to `190be6fa` if required, retaining durable jobs, attempts, metadata and Form Fill work. That revision restores the original unsafe structural retry, so pause queued delivery through the existing mode if necessary while preparing a corrective release. No data purge or reverse import is part of rollback.

Lease/fence checks cannot cancel requests already sent. A current owner must reconcile any late old-owner completion, and topology operators still acquire both leases and wait out older invocations. Multiple outstanding in-flight provider calls are not an exactly-once protocol. Historical production duplicate or neighbor damage was not investigated or repaired.

The legacy/direct `googleSheets/rowLookup.ts` retry behavior remains unchanged and retains its earlier structural retry risk. This is a queued-delivery qualification, not a claim that all compatibility writers have been hardened.

## Clean main and preserved work

The Owner requested a clean main checkout in `vantage-main-server`. Its pre-existing unrelated tracked/untracked edits are preserved locally in stash `pre-sheet-sync-recovery-main-cleanup-2026-11-04`, protected by local ref `refs/preserved/pre-sheet-sync-recovery-20261104`; its committed branch `fix/ringcentral-call-billing` is retained. This saved work is not part of the recovery commit or push. Restore it on its original branch or in a separate worktree, not by blindly popping it onto current main. The final chat report verifies the preservation hash and clean main state after integration. Ignored packet/operator files and credentials remain in place.

## Remaining efficiency work and proposed next slice

This bounded uncertain-write part of S1 is complete. Existing physical coalescing and trusted duplicate repair remain in place. Full S1 merged metadata persistence once per document with a newer-state guard, cross-intent conflict reconciliation and any broader metadata/hint redesign remain separate work. S2 narrow-column reads, idle drain changes, job compaction/indexes/TTLs, command ownership, retention and the other efficiency slices are unimplemented. I1 recurring Best Relocation ingestion optimization is retired.

Recommend D1 next; this slice exposed no remaining Sheet Sync correctness dependency blocking its separate implementation. D1 is not implemented here. Preserve the original D1 instructions below verbatim, including old/new attribution and concurrent-duty proof requirements. Its relative links refer to the ignored original efficiency packet.

```markdown
## D1 · Suppress unnecessary Pool duty nominations

**Implement in** `contacts/apply.ts` and its store contract; leave the admission API and canonical duty computation unchanged. Derive separate effects from a contact revision: subject evaluation, rep-day correction, retained SMS volume, receiver fill, and Pool duty repair. The latter is a set of (subject ID, NY business date); a subject evaluated for SMS is not automatically a call-duty repair.

1. Derive every requested source as today, including retained SMS, even if no contact event changes. For the *contact apply caller*, nominate zero Pool pairs for SMS→SMS and for exact SMS replay. For any material call draft, include both previous and new non-null subject/day pairs, deduplicated. First release retains today's exact-call replay repair behavior. Never narrow to just current qualifying winners: a demotion, change of caller, restriction, deletion/exclusion or move also retracts credit. Unclassified input falls back to the old path.
2. Leave [duty serialization](../../src/services/salesOutreach/pool/duties.ts) in the source transaction. Distinct calls race on the shared work write; the retry must re-read committed evidence, apply the same episode/calendar/roster and earliest-time/ID ordering, and persist corrections. Keep invalidation after material duty changes, receiver fill on its own terms, and old/new rep-day and subject jobs. No parallel Mongo operations on one transaction session.
3. Keep the [Pool projection](../../src/services/salesOutreach/pool/projection.ts) and admission recounts for evaluation, episode transitions, policy/roster/restriction changes, no-contact-number state, and open/close/midnight. An SMS that changes cadence may still lead to a *separate* evaluation and duty read. Do not advertise removal of all such reads. Only later bypass identical call replays after a repair inventory proves every old/new date can be recounted independently, including missing historical duties within the existing creation rules.
4. Qualification: the [offline baseline](reproduce-desk-recount.cjs) calls the real contact apply with an in-memory store. Exact SMS replay produced zero event changes, zero evaluation jobs and **one** Pool pair. After the change expect zero Pool pairs on both first SMS and retry, with all other persisted outputs identical. Replica tests: simultaneous eligible calls in reverse event order, same-time tie, transfer, pending→confirmed→excluded, event moved to yesterday or a different subject, blocked/closed day, owner restriction, first call racing episode exit. Compare actual caller, team/assigned due/completed, correction list, goal count, live topics and visible queue.
```
