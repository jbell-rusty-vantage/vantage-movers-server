# Server integration evidence

Repository `vantage-main-server`, branch `slim/server-admin`, base `6a374fab`, uncommitted (the coordinator commits).

## Integration (wave 1)

Date: 2026-10-04. Inputs: lanes S-HIST, S-GRANOT, S-OBS, S-NUM and DATA, their independent reviews, and the coordinator's must-fix list. During this run the integrator owned the whole server tree. Daily Operations files were not edited: `git status` shows no change under `src/services/dailyOperations`, `src/models/DailyOperations*` or `src/config/domain/dailyOperations.ts`.

### Recovery

A previous integrator run crashed when its host process died. Before continuing, this run read its partial edits with `git status`, file mtimes and the scratchpad outputs. They were kept, not redone:

- The legacy Sales Intelligence and ops modules compile again. The new `src/services/salesIntelligence/legacyNumberFields.ts` type bridge covers the removed ContactNumber fields. It is used only by `analysis/*`, `outreach/reads.ts` and `ops/{lib/full-backfill,lib/call-log-repair,full-backfill.replica.test}.ts`, and wave 2 deletes it with them.
- The Sales Intelligence fixture and test updates in `analysis`, `assessment`, `story` and `casefile`.
- The SLIM-09 doc pass: `docs/index.md`, `services/{admin-search,analytics,catalog,form-lead,operations-registry}.md`, `granot-lifecycle/{projections,release-into-booking-intake}.md`, and `granot-lifecycle/live-receipts.md` (deleted).
- The stale `historicalConsolidation` comment in `outreach/leadInstant.ts` was removed.
- Must-fix 1, below.
- `healthState.ts` now fences a missed write at once (`fenceMissedWriteNow`).

### Must-fix list and review findings

| # | Finding | Decision | Change |
|---|---|---|---|
| 1 | `granot-webhook.routes.test.ts` still used the OperationalEvents sink | Done (crashed run), verified | The test uses `captureGranotLifecycleLogs()` and asserts the single `granot_lifecycle.capture.failed` line. The route keeps the `emitGranotLifecycleEvent` capture.failed call, which feeds the Health `capture_unavailable` counter. |
| 2 | S-GRANOT medium: `command_conflicts_last_24h` was `[]` while unknown | Fixed | Server `projections.ts`: the field is `Array \| null`, and it is `null` whenever the 24-hour window is unknown. `counter_coverage` is unchanged. **Admin** (required by this DTO change): `lib/api/granotLifecycle.ts` accepts `null` (still throws on any other non-list) and `lifecycle-health.tsx` shows "Unknown — warming up…" instead of "No command conflicts". The Rollout alerts card gains a coverage line for an unknown 24-hour or 1-hour window ("Alerts that depend on an unknown window read Insufficient data, not OK"). The Queue/cron copy no longer cites "operational run events". Tests: `granot-lifecycle-admin.routes.test.ts` (unknown fixture is `null`), and Admin `tests/granot-lifecycle-components.test.ts` (null parse, warming render, malformed value). Docs: `granot-lifecycle/{projections,observability}.md`. |
| 3 | Form Lead fast wake missing | Fixed | `leadTrigger.ts`: new `wakeLeadAttachmentsAfterLeadCommand`. It reads the EntityChanges the command committed, by their preallocated ids and scoped to the Lead. It raises the same `attachment-lead:` job identity as the durable scan, publishes one wake per runnable job, is bounded by `LEAD_COMMAND_WAKE_TIMEOUT_MS` (2 s), is gated by `SALES_INTELLIGENCE_ATTACHMENT_REFRESH` and never throws. It shares the enqueue/publish loop with the Granot wake. It is wired in `domainCommands/existingWrites.ts`, the only place Form Lead create and correction EntityChanges are written, rather than in `formLead.service.ts`, which writes none. It runs in the post-commit `finalize` of `runExistingCreateFormLead` (skipped for a reused/duplicate submission) and of `runExistingUpdateSourceOwnedLead` (Form Lead only; finalize runs only when a change committed, and never on replay). A no-op update, a replay, a non-phone change and an already-run job wake nothing. The durable EntityChange scan and the `updatedAt` watermark stay as backstops. Tests are in `leadTrigger.test.ts`: enqueue+wake, the duplicate/replay/no-op/flag-off cases, never-throws, the timeout bound, and a source check that the wake sits in `finalize`. |
| 4 | `refresh.ts` lead-change scan unguarded | Fixed | New `guardedLeadChangeScan()`: a failed scan is logged (`sales_intelligence.attachment.lead_change_scan_failed`) and returns `null`, and the watermark pass and drain still run. `runAttachmentRefreshOnce` uses it. Covered by a test in `leadTrigger.test.ts`. |
| 5a | DATA: tautological Blob backup check | Fixed | `downloadBlob` now returns the byte count and sha256 of the bytes streamed into the file, not `result.blob.size`. The new `verifyBlobBackupFile` (backup.ts) checks the file's stat size against the listed size and its read-back sha256 against the stream hash. `purge.ts` aborts on any mismatch and writes `blob-backup.json` (key, bytes, sha256) into the run directory. |
| 5b | DATA: unlisted `conversations/` objects | Fixed | `unlistedBlobProblems` (purge-rules.ts): any object under `conversations/` that is not in the manifest is a problem in `assertState`, so step (a) and step (g) both abort. |
| 5c | DATA: drops not idempotent on resume | Fixed | `verifiedFullBackupProblem` (purge-rules.ts). On `--resume`, `reconcileAbsentDrops` records an absent, unrecorded drop target as dropped only if this run's full backup of it matches the manifest count and verifies on disk (count + sha256). The database is handled the same way, through all its collections. `dropTargets` applies the same rule when a target vanishes after step (a). With no verified backup, the run still aborts. Tests are in `ops/slimming/lib/slimming.test.ts` (`purge hardening`). |
| 6 | Registry compatibility-read copy claimed a cross-instance gate | Fixed | In `queries/health.ts` the summary now says the count covers "this server instance since it started" and that other instances are not counted, and it names the log key `operations_registry.compatibility_read` for the full count. The `removal_blocked_until_zero` evidence key is replaced by `full_count_log_key`. The remediation asks for a log-search check before removing the list. `findingTranslation.ts` Owner copy and Admin `compatibility-observation-statement.tsx` (Admin edit, same copy rule) no longer say "blocked until this count holds at zero". `overview.ts` has no copy left (S-OBS removed its OE read). Test: `queries/health.test.ts`. Doc: `services/operations-registry.md`. No persisted counter was added. |
| S-HIST medium | `GET /admin/agents` and `/:id` dropped `database_scope=historical\|combined` with a 200 | Fixed | New `rejectRetiredDatabaseScope` middleware, using `adminScopeOnlyQuerySchema` (admin.validation.ts, exported from v1.validation.ts). It validates only the scope, before `connectMongo`, on those two GETs. The extension routes (`catalog/agents`, POST, PATCH) are unchanged. Both paths were added to `SCOPED_READS` in `v1-admin-database-scope.routes.test.ts`, which proves the 400 for a retired scope and no 400 for an omitted or production scope. |
| S-HIST low | SLIM-03 needs a driver-spy proof | Fixed | New `src/services/admin/noHistoricalDb.test.ts`. It spies `mongoose.Connection.prototype.useDb` and `MongoClient.prototype.db`, loads the read modules after the spy, and runs browse/detail/CSV for all four resources, search, facets, the filter catalog, every Analytics report and its CSV, and Overview against an unconnected Mongoose. It asserts that the main database was selected through the spy and that `vantagemovershistorical` never was. |
| S-GRANOT medium | Missed-write gap marker is process-local | Narrowed, not closed | The crashed run had already added `fenceMissedWriteNow` (a failed write while Mongo is connected writes `coverage.gap_at` at once). This run adds `installReconnectFence`: after the first miss, the process fences the remembered miss on Mongo's next `connected`/`reconnected` event, not only on its next health write. Test: `healthState.test.ts` ("fenced into coverage.gap_at on the next reconnection"). Residual risk: a process frozen or recycled before it reconnects or writes again still loses the marker (see Remaining issues). |

### Cross-lane requests resolved in this repo

- S-GRANOT: `test:granot-lifecycle:replica` pointed at `scripts/test-granot-lifecycle-replica.ts`, which was deleted in `a8937b41` because `scripts/*` is gitignored. The runner was restored as the tracked `ops/test-granot-lifecycle-replica.ts`, with the same safety guards (TEST_MODE, disposable `testvantagemovers*` DB, replica set) and the same safe gate env. It runs every `granotLifecycle/*.replica.test.ts` plus the RingCentral, leadProvenance and present local migration proofs in one serial `--test-force-exit` pass, then the queued-effect pass. `package.json` was repointed. The refusal path was exercised; the sweep itself was **not run** (replica down).
- S-GRANOT: the webhook capture.failed emit is kept, and its test was ported (must-fix 1).
- S-OBS: `adminSheetSync.service.test.ts` no longer imports the sink (S-HIST). `granot-webhook.routes.test.ts` was ported. The only remaining sink user is `ops/test-setup.ts` (`installTestObservabilitySink`), which wave 2 deletes with the observability core, because Sales Intelligence conversations still write OperationalEvents.
- S-HIST docs pass: completed by the crashed run (listed above).
- S-OUT: the `leadInstant.ts` comment is fixed.

### Leftover sweep

`rg -n "vantagemovershistorical|registerHistoricalModels|historicalConsolidation|models/historical|receiptSearch|liveReceipt|admin/observability|exports/observability|notification-cron|notificationDigest|agentSalesReport|agent-sales|analyticsMerge|agentBrowseMetrics|adminObservability|operationalReports" src api ops scripts package.json vercel.json`

Every hit was classified. No real leftover remains.

- Negative tests: `v1-admin-database-scope.routes.test.ts` (agent-sales 404s) and `noHistoricalDb.test.ts`.
- The purge itself: `ops/slimming/{policy,inventory,purge}.ts`, `lib/purge-rules.ts` and `deletion-manifest.json`.
- Refusal guards that must stay: `scripts/migrations/*` (`HISTORICAL_DATABASE`, "never target vantagemovershistorical").
- Wave 2: `src/services/observability/*.md` (the observability core and its docs).
- A local gitignored, self-contained aggregation script: `scripts/dev_ops/test-create-google-spreadsheet.ts` ("agent-sales" tab). It imports none of the retired services.

Two more sweeps:

- `rg -n "database_scope" src api ops` (non-test): only the production-only validation, the new scope middleware, and `database_scope=production` hrefs/URLs, which are valid.
- `rg -n "outreach/reads" src/services/numberActivity`: no imports.

### Commands and results

All server commands ran in `C:/Users/Pinda/Proyectos/vantage/vantage-main-server`. No stash, checkout, reset, commit, add or install was run.

| Command | Result |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` | **exit 0, 0 errors** (final run, after every edit) |
| `pnpm lint` (`eslint src api ops/quality --max-warnings 0`) | **exit 0** |
| `DOTENV_CONFIG_PATH=C:/nonexistent.env pnpm test` | **3146 tests: 3006 pass, 3 fail, 0 cancelled, 137 skipped** (replica/env-gated), 531 s |
| Rerun of the 3 failing files alone (`node --import tsx --import ./ops/test-setup.ts --test <file>`) | `ops/lib/form-lead-numbers-backfill.test.ts` 2/2, `src/middleware/requestTelemetry.test.ts` 1/1, `src/services/salesIntelligence/overview/teamIntelligence.test.ts` 7/7: **all pass** |
| `node --import tsx --test ops/slimming/lib/slimming.test.ts` (not in the `pnpm test` glob) | **18/18 pass** (4 new `purge hardening` tests) |
| Focused: `leadTrigger.test.ts`, `domainCommands.test.ts`, `granot-lifecycle-admin.routes.test.ts` | 53/53 pass |
| Focused: `operationsRegistry/queries/{health,findingTranslation}.test.ts` | 12/12 pass |
| Focused: `v1-admin-database-scope.routes.test.ts`, `adminDatabaseScope.test.ts` | 11/11 pass |
| Focused: `granotLifecycle/healthState.test.ts` | 6/6 pass |
| Focused: `services/admin/noHistoricalDb.test.ts` | 1/1 pass |
| `node --import tsx ops/test-granot-lifecycle-replica.ts` with `TEST_MODE=false` | exits 1 with "Refusing replica runner: TEST_MODE must be true." before any connection |
| Admin, `node node_modules/typescript/bin/tsc --noEmit` | **exit 0** |
| Admin, `node --import tsx --test "{lib,server,tests}/**/*.test.ts"` | **1080 tests: 896 pass, 0 fail, 184 skipped** |
| Admin, eslint on the 4 Admin files changed here | exit 0 |
| Replica suites (Granot lifecycle sweep, `ops/numbers-slim.replica.ts`, drainer requeue provenance) | **NOT RUN.** The local Docker `csi01` replica is unresponsive (coordinator instruction). |

### Baseline comparison

The baseline is `scratchpad/baseline/server-test.txt`, `server-typecheck.txt` and `server-baseline-failures.txt`, from a clean `6a374fab` worktree.

| | Baseline | Now |
|---|---|---|
| Typecheck | exit 0 | exit 0 |
| Tests | 3119 | 3146 |
| Pass | 2950 | 3006 |
| Fail | **34** | **3** |
| Skipped | 135 | 137 |

The 34 baseline failures were file-level crashes and timeouts under machine load, such as googleapis `Cannot find module` inside node_modules and the spawn timeouts. None of those files fails in this run, except two that time out again under load and pass alone:

- `ops/lib/form-lead-numbers-backfill.test.ts`: the M6 CLI spawn timed out at 45 s.
- `src/middleware/requestTelemetry.test.ts`: `spawnSync ETIMEDOUT` at 60 s.

The third failure, `teamIntelligence.test.ts` "OI-C … warm pure read p95 budget" (1046 ms under load), is a performance budget. It is not in the baseline list, but it also failed in the crashed integrator's full run. It passes 7/7 alone, and no slimming change touches `overview/teamIntelligence`.

**No new deterministic failure remains.** The test count grew by 27, the net of the deleted lane tests and the new ones.

### Remaining known issues

1. **Wave 1 is not deployable alone.** S-NUM removed fields from the ContactNumber schema, which is `strict: "throw"`. The legacy wave-2 writers are still dispatched (`jobDispatch.ts`: `analysis`, `outreach_ensure`, `recording_discovery`, `rep_identity_reevaluate`), and their crons are still in `vercel.json`: `analysis/apply`, `outreach/ensure`, `analysis/run` and others. Those writers would now throw `StrictModeError` (verified: `$inc rollups.outreach_records_total`, `$inc evidence_fence`, `$set intelligence_schedule|running_summary`). The throw happens before any write, so jobs dead-letter and no data is corrupted. Ship wave 1 together with wave 2, or keep those stages off.
2. **Deploy order (Admin and server together):**
   - The slim server sends `command_conflicts_last_24h: null` during warm-up. A pre-slimming Admin bundle rejects it as a malformed Health projection, so the Health page errors (it fails closed and does not claim "no conflicts").
   - Old Admin bundles that send `database_scope=historical|combined`, now including on `/admin/agents`, get 400s.
3. **Health warm-up:** the 24-hour counters read unknown for 24 h after cutover (or after a recorded gap), and the claim window for 1 h. Admin now shows "Unknown — warming up".
4. **Gap marker residual:** a process that notes a missed health write while Mongo is unreachable, and is frozen or recycled before it reconnects or writes again, still loses the marker. The 20-minute staleness rule catches only a total writer outage.
5. **Replica proofs not run:**
   - the Granot lifecycle sweep, including the drainer requeue-provenance proof and the healthState/operations replica proofs, now via `pnpm test:granot-lifecycle:replica`;
   - `node --import tsx ops/numbers-slim.replica.ts`;
   - the DATA purge, which ran only as a dry run in the lane.

   Run them once `csi01` responds.
6. **Attachment latency:** Form Lead creates and phone changes now wake their attachment job post-commit. Without a queue, the backstop is the `*/5` attachment-refresh cron. S-NUM recommends moving that cron to every minute when wave 2 removes `sales-intelligence-outreach-ensure`.
7. **Wave 2:** delete the observability core, models and the `ops/test-setup.ts` sink install; delete the legacy AI/Outreach modules together with `legacyNumberFields.ts`.
