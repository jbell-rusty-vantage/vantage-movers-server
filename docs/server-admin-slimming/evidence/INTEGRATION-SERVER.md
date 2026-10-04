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

## Integration (wave 2)

Date: 2026-10-04. Inputs: lanes S-AI and S-OUT, their reviews (S-AI: no findings; S-OUT: 3 findings), their cross-lane requests, and the S-OBS wave-2 hand-off. The integrator owned the whole server tree. No stash, checkout, reset, commit, add or install was run. Daily Operations was not edited: `git status --short -- src/services/dailyOperations 'src/models/DailyOperations*' src/config/domain/dailyOperations.ts` prints 0 lines.

### Recovery

The host crashed again before this run. Nothing from the wave-2 integration had started: no tracked file was newer than `evidence/S-OUT.md`, and this file ended at wave 1. This run started from the lanes' finished tree.

### Review findings (S-OUT)

| # | Finding | Decision | Change |
|---|---|---|---|
| 1 (medium) | The fence's `retired` status was not terminal for the purge, and the fence's `completed_at` let the 14-day TTL delete rows before the purge backed them up | Fixed | `ops/slimming/lib/purge-rules.ts`: `TERMINAL_JOB_STATUSES` adds `retired`. `policy.ts`: `LEGACY_JOB_STAGES` now equals the server's `CSI_RETIRED_JOB_STAGES` (13 stages, adding `number_refresh`, `backfill`, `retention` and `rep_identity_reevaluate`); `SPLIT_JOB_STAGES` is empty. `jobs.ts` `retireLegacyCsiJobs` no longer sets `completed_at`, so the TTL never removes a fenced row and purge C2 backs it up and deletes it. Tests: `slimming.test.ts` (the stage list equals `CSI_RETIRED_JOB_STAGES`; the terminal filter includes `retired`) and a new `src/services/salesIntelligence/jobs.retire.test.ts` (exact filter and update, no `completed_at`, epoch +1, no write when nothing is runnable). |
| 2 (low) | The replica proof `proveRetiredStageFence` would fail on a leftover runnable retained row | Fixed, **not run** | `ops/test-csi-enqueue-replica.ts`: the proof first completes every runnable row left by `main()`, so the undirected-claim assertion is valid. It now asserts that a fenced row has no `completed_at`. Not run: the replica is down (below). |
| 3 (low) | A slim policy version written by `PATCH /settings` breaks a pre-slim rollback | Fixed for updates | New `CSI_RETIRED_POLICY_FIELDS`, `csiPersistedPolicySchema` and `withRetiredPolicyFields` (`validation/v1/salesIntelligence.ts`). `updateCsiPolicy` reads the active version and carries its 13 retired top-level fields and `retention.{audio_days,redacted_days}` forward. Retained values always win, retired capabilities are never re-enabled, and unknown fields are dropped. The version model validates with the persisted schema, so nothing else can be stored. The slim reader still ignores the carried fields, and `GET /settings` does not return them. Proof: `settings.test.ts` (+2 tests). A one-off check parsed a carried version with the **baseline `6a374fab` strict `csiPolicySchema`** (extracted from git into a temporary file under the gitignored `scripts/`, then deleted): `true`. Residual: `initializeCsiPolicy` with no previous version (a fresh environment only; production has an active pointer) still writes a version the old reader rejects. |

### Cross-lane requests resolved in this repo

- **S-AI → CallInteraction trim.** Removed `recordings[].lead_conversation_id` (it referenced `LeadConversation`) from the schema, `ProjectedRecording`, the projection merge and the stored mapper together. Both sides of the change check drop it, so no spurious `projection_revision` bump. Also removed the `recording_discovery` sub-document and the `call_interaction_discovery_state` index declaration. `efficiency.test.ts` now asserts the index is gone; the `ownerCoverage.ts` comment was updated.
- **S-AI → `migration:csi:indexes`.** The gitignored `scripts/migrations/sales-intelligence{.lib,-indexes}.ts` were rewritten to the retained registry (originals backed up to the scratchpad `local-scripts-backup/migrations/`). Removed: the `lead_conversations` inventory entry (so `--apply` can never recreate it), the conversation account back-fill and `--account-mappings`, the `outreach_followups` retired-unique check and the legacy recording-fence drop. Report version `csi-migration-v2`. It loads, and its printed inventory lists only retained collections. It typechecks (`tsc -p` with a temporary config, exit 0).
- **S-AI / S-OUT → purge policy** (`ops/slimming/policy.ts`, `inventory.ts`):
  - C4 audit kinds add `analysis.suggestion_applied` and `rep_identity.reevaluated` (39 kinds; `rg` finds no producer of any of them in `src`/`api`).
  - C3 adds the retired `backfill` and `backfill:call_log` scopes (deleted only if present).
  - C6 (Outreach cursors) is `final`.
  - C1 adds `rollups.last_meaningful_contact_at` and is `final`.
  - C4 and C5 are `final`.
  - **C5 no longer unsets `purged_at`.** The previous list would have unset the live purge marker that retention, Numbers search, timeline and history reads filter on, which would have resurfaced purged Numbers.
  - The Blob manifest takes the union of `lead_conversations.media.blob_pathname` and `result.pending_blob_delete` on completed `media_fetch` jobs.
- **Stale-manifest guard.** New `manifestPolicyDrift()` (purge-rules.ts). The dry run prints every difference between the manifest's cleanups and `policy.ts` (status, unset fields, C2 stages, C4 kinds), and `--apply` aborts on any of them. The checked-in `deletion-manifest.json` now reports 7 differences, including `C5 unsets purged_at` and `C2 stages differ`, so **it must be regenerated after quiescence**. `DELETION-MANIFEST.md` §2 was updated to match.
- **S-OUT → `BACKFILL_LEASE_SCOPE`.** Removed from `reconcileCallLog.ts` (no reader).
- **S-OUT → OwnerRepNudge.** Removed the `nudge_outreach_created` index declaration and the dangling `ref: "OutreachRecord"`. The `outreach_record_id` field stays, for historical rows only (the command schema refuses it).
- **`.gitattributes`** (its only rule targeted the deleted Case File fixtures): deleted.
- **Not done here (coordinator or other lanes):** dependency removal, the env inventory, the MCP contract (MCP lane) and the Service docs (wave 3). They are listed in the structured output.

### OperationalEvents subsystem deleted (step 2)

- Before deleting, `rg` over `src api ops scripts` (including gitignored files) found importers in only three places: `ops/test-setup.ts`, the local `scripts/dev_ops/test-setup.ts` and `scripts/dev_ops/test-csi-nudges.replica.test.ts` (sink), plus **one retained runtime caller**, `operationsRegistry/snapshotSanitizer.ts` (`sanitizeEventDetails`). No `src` code read the observability config exports through the `config/domain` barrel.
- The bounding logic moved into `snapshotSanitizer.ts`, with the former default byte budget of 16 KB fixed instead of `OBSERVABILITY_DETAILS_MAX_BYTES`. `snapshotSanitizer.test.ts` gained 2 tests (string truncation and unsupported values; truncation marker over budget): 5/5 pass.
- Deleted (all tracked and unmodified): `src/services/observability/**` (16 files, including both `.md` notes), `src/models/{OperationalEvent,OperationalIncident,NotificationDelivery,OperationalReportRun,observabilityModelFactory}.ts`, `src/config/domain/observability.ts` and its test, and `.cursor/rules/observability-service.mdc`. The `export * from "./domain/observability"` line was removed from `config/domain.ts`.
- Test bootstrap: `ops/test-setup.ts` and the local `scripts/dev_ops/test-setup.ts` no longer install the sink or set `OBSERVABILITY_*`, `ALLOW_*OBSERVABILITY*` or `EMAIL_NOTIFICATIONS_*`. They still mark the test runner, install the Daily Operations sink and disable sheet-sync publishes. Invite email never read the notification switches (its tests inject the sender).
- Stale env lines removed from `requireApiSecret.test.ts`, `crm.service.test.ts` and `ops/test-csi-enqueue-replica.ts`.
- Rules and skills: `project-organization.mdc`, `production-url.mdc`, `codebase.mdc`, `.cursor/index.md`, `.cursor/agents/docs-keeper.md` and `.cursor/skills/hit-vantage-api/SKILL.md` no longer list the observability subsystem or the `/admin/observability/**` routes. `.cursor/story-refactor-workspace/**` is a historical archive and was left as is.
- Retained mail config (`config/domain/mail.ts`: `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `ALERT_EMAIL_REPLY_TO`) is unchanged.
- The local `.env` still sets `OBSERVABILITY_ENABLED` and `ALLOW_TEST_OBSERVABILITY`. Nothing reads them; the file was not edited.

### Replica suites (step 4)

`timeout 20 docker exec csi01 mongosh --port 27189 --quiet --eval 'rs.status().ok'` → **exit 124 (no answer)**. Every replica suite is **NOT RUN (replica down)**: `test:granot-lifecycle:replica`, the retired-stage fence proof and the Numbers slim proof.

The `package.json` replica entries were audited anyway. All 17 `test:csi:*` / `test:si:*` replica entries pointed at gitignored `scripts/dev_ops` runners, and none could load:

- The runner file is missing: `csi:capture`, `csi:fanout`, `si:rollups`, `si:facts`, `si:suggest`, `si:numbers`, `si:numbers:form-only`, `si:reads`, `si:timeline`, `si:number`.
- The replica test file is missing: `csi:numbers`, `csi:attachment`.
- The suite imports deleted modules, and every runner loads the removed `./scripts/test-setup.ts` (pre-existing, also noted by S-NUM): `csi:replica` (foundation, 11 deleted imports), `csi:reads`, `csi:rep-identity`, `csi:nudges` (also the deleted observability sink), `csi:settings`.

All 17 entries were removed. Two tracked retained proofs got entries instead: `test:csi:fence:replica` (`ops/test-csi-enqueue-replica.ts`, local rs0) and `test:numbers:replica` (`ops/numbers-slim.replica.ts`, csi01).

Local runners of deleted subjects (25 gitignored files: csi15-budget/period/retention, csi-backfill, csi-intelligence(-reads), csi-media, csi-owner, csi-runtime, csi-transcription, si-desk, si-s11-prov-search, si-time-base) were copied to the scratchpad `local-scripts-backup/dev_ops/` and deleted. The local runners of retained subjects (foundation, reads, rep-identity, nudges, settings, the `*-local.ts` HTTP probes) were kept for a later port.

### Leftover proof (step 5)

Per term, `rg -c --fixed-strings <term> src api ops`, then the same with `--glob '!ops/slimming/**'`:

| Term | All | Outside `ops/slimming` | Remaining hits |
|---|---:|---:|---|
| `LeadConversation` | 4 | 1 | `aiRetirement.test.ts` (deleted-import guard) |
| `lead_conversations` | 17 | 4 | absence guards: `aiRetirement.test.ts`, `foundation.test.ts`, `live.test.ts`, `numbers-slim.replica.test.ts` |
| `intelligence_runs` | 6 | 4 | the same four guards |
| `move_assessment` | 14 | 6 | `CSI_RETIRED_JOB_STAGES`; fence replica fixture; absence guards (`reads.test.ts`, `foundation`, `aiRetirement`, `numbers-slim`) |
| `attention_snapshots` | 5 | 3 | absence guards |
| `attention_artifacts` | 7 | 2 | absence guards |
| `outreach_records` | 17 | 11 | absence guards, plus pre-slim rollup fixtures in `search`/`rebuild`/`history reads`/`numbers-slim` tests that prove the field is dropped |
| `outreach_followups` | 10 | 3 | absence guards |
| `outreach_band_transitions` | 4 | 2 | absence guards |
| `outreach_rep_days` | 4 | 2 | absence guards |
| `recordOperationalEvent` | 0 | 0 | none |
| `getOperationalEventModel` | 0 | 0 | none |
| `vantagemovershistorical` | 6 | 1 | `noHistoricalDb.test.ts` (driver-spy guard) |
| `@ai-sdk` | 1 | 1 | `aiRetirement.test.ts` vendor-import regex |
| `generateObject` | 0 | 0 | none |

No runtime reference remains. Also checked:

- `rg -e operational_events -e OperationalIncident -e NotificationDelivery -e OperationalReportRun -e observabilityModelFactory -e installTestObservabilitySink -e getCapturedOperationalEvents -e services/observability src api ops --glob '!ops/slimming/**'` → 1 hit, the `numbers-slim.replica.test.ts` absence list.
- `rg -n "recording_discovery|lead_conversation_id" src api ops --glob '!ops/slimming/**'` → only `CSI_RETIRED_JOB_STAGES`.
- **Local, gitignored:** `rg --no-ignore -l <deleted-module imports> scripts` → **55 files** still import deleted modules (they no longer load). This includes `scripts/dev_ops/test-csi-nudges.replica.test.ts`, which imports the deleted observability sink. Deleting them is the user's call.

### Commands and results

Heavy commands ran through the scratchpad `heavy.sh` lock.

| Command | Result |
|---|---|
| `heavy.sh env NODE_OPTIONS=--max-old-space-size=6144 node node_modules/typescript/bin/tsc --noEmit` | first run 5 errors (a newline inserted into a template literal in `purge.ts` by this run's edit), fixed; **final run exit 0, 0 errors** |
| `tsc --noEmit -p` (temporary config: `scripts/migrations/sales-intelligence{-indexes,.lib}.ts`, `scripts/dev_ops/test-setup.ts`) | exit 0 |
| `heavy.sh env NODE_OPTIONS=--max-old-space-size=6144 node node_modules/eslint/bin/eslint.js src api ops/quality --max-warnings 0` (`pnpm lint`) | **exit 0** |
| `heavy.sh env DOTENV_CONFIG_PATH=C:/nonexistent.env NODE_OPTIONS=--max-old-space-size=6144 node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=2 "src/**/*.test.ts" "api/queues/**/*.test.ts" "ops/lib/*.test.ts"` | **2592 tests: 2455 pass, 0 fail, 0 cancelled, 137 skipped** (replica/env-gated), 1205 s, exit 0 |
| `node --import tsx --test ops/slimming/lib/slimming.test.ts ops/numbers-slim.replica.test.ts` | 22 tests: 21 pass, 0 fail, 1 skipped (the replica test skips without `CSI_REPLICA_TEST`) |
| Focused: `snapshotSanitizer.test.ts` 5/5; `jobs.retire.test.ts` 2/2; `settings.test.ts` + `foundation.test.ts` 12/12 | pass |
| `timeout 20 docker exec csi01 mongosh --port 27189 ...` | exit 124: replica down |

### Baseline comparison

| | Baseline (`6a374fab`) | Wave 1 | Wave 2 |
|---|---|---|---|
| Typecheck | exit 0 | exit 0 | exit 0 |
| Tests | 3119 | 3146 | 2592 |
| Pass | 2950 | 3006 | 2455 |
| Fail | 34 | 3 | **0** |
| Skipped | 135 | 137 | 137 |

None of the 34 baseline failures remains. Most were load-induced file crashes and spawn timeouts; others were in files deleted since (`LeadConversation.test.ts`, `config/domain/observability.test.ts`, `ops/lib/{attention-storage-guard,backfill-csi-structured-analysis.lib,call-log-repair,full-backfill,form-lead-numbers-backfill}.test.ts`). The test count fell by 554, the net of the AI, Outreach, observability and backfill tests deleted with their modules and the tests added.

### Remaining known issues

1. **Regenerate the deletion manifest** after the slim server is deployed and quiescent. The checked-in manifest is stale against `policy.ts` (7 differences), and `purge.ts --apply` now refuses it.
2. **Replica proofs not run:** `test:granot-lifecycle:replica`, `test:csi:fence:replica` (the fixed fence proof), `test:numbers:replica`, and the DATA purge, which has only ever run as a dry run.
3. **No runnable replica suite** for the foundation, reads, rep-identity, nudges and settings subjects: the local runners need porting to retained modules and to `ops/test-setup.ts`.
4. **Policy rollback:** an update carries the retired fields forward; a first `initialize_settings` in a fresh environment does not.
5. **Wave 3 docs** still describe deleted modules and removed scripts. Examples: `services/number-activity-{reads,capture}.md` and `sales-intelligence-webhook-fanout.md` cite the removed `test:csi:*:replica` entries, and `project-organization.mdc` still describes CSI transcription.
