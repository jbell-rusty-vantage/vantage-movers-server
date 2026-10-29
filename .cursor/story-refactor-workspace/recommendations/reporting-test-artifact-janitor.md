# Scan The Dedicated Export Root For Leftover Harness Folders This Registry Still Authorizes, Trash Only Those Aged Marked Containers After The Fence, Then Ask Later-Evaluate To Mark A Run Completed When Every Registered Folder Is Gone — Never A Spreadsheet, Never Official Delivery Trash, Never A Drive Listing Alone — operational story

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/reporting/live/testArtifactJanitor.ts`
- Domain evidence: `docs/knowledge/services/reporting.md`
- Current exported operations/constants: `selectTestArtifactsForCleanup`, `runTestArtifactJanitor`.
- Current exported types: `TestArtifactCandidate`, `TestArtifactJanitorResult`.
- Direct import sites found: `src/routes/reporting-cron.routes.ts`, `src/services/reporting/live/liveTestSecurity.test.ts`, `src/services/reporting/live/testArtifactJanitor.test.ts`.
- Related tests: `src/services/reporting/live/testArtifactJanitor.test.ts`

## Current boundary and parity

Reporting definitions, immutable revisions, confirmed runs and Google delivery remain live. Preserve the Owner gate, destination checks, leased execution and cleanup boundaries. Live-test harnesses and their safety checks remain operational tooling. Reporting signals are structured logs; do not recreate the retired Operational Events persistence or notification pipeline.

The target and its direct callers are the authority for the exact implementation. Preserve the public signatures, persisted identifiers, transaction and side-effect ordering, error shapes, and idempotency while migrating callers. Keep any existing public name as an alias until its callers move. Do not introduce an additional service class or move policy into a route.

## Remaining cleanup

Read the exported operations above in their actual order and rename only an operation whose name obscures its current outcome or scope. Keep separate operations separate where their callers own different decisions; extract a private helper only when it gives a real decision a clearer name. Migrate the direct callers together, then cover the existing success, refusal, retry and side-effect boundaries relevant to this module with targeted tests. This is a behavior-preserving naming and module-shape pass, not authorization to add effects or change business policy.

## Specific implementation checks from the original brief

1. **Decide whether later janitor may run** — `isReportingLiveTestEnabled` false → `{ ok: true, skipped: true }` bag `janitor-noop` / `live_test_disabled`. Prereq `!ok` → `{ ok: false, skipped: false, errors: 1 }` bag `janitor-skipped` / `prerequisites` failed with `prereq.code`. Neither path **asks** refuse / Drive / registry / tell. Cron maps `skipped` to 200 with a canned reason; `ok: false` to 503 with the full result.

2. **Prove the connected test owner and the dedicated export root** — `rejectServiceAccountCredentialsForLiveTest`, `assertLiveTestOAuthPrincipal`, `validateDedicatedExportRoot` with `GOOGLE_OAUTH_OWNER_EMAIL`, `createLiveTestGoogleAdapters` keeping `driveApi` only. The wrap **asks** refuse again. This file never **asks** `google.auth.getClient` itself.

3. **Select leftover harness folders this registry still authorizes** — `listJanitorEligibleHarnessRunTags` `{ exportRootFolderId }` for `pending` / `needs_janitor`. Drive `files.list` interpolates the export-root id into `q` (`in parents and trashed = false and mimeType = folder`). `pageSize` is `min(limit, 100)`; cron always passes `limit: 50`. No `nextPageToken`. `selectTestArtifactsForCleanup` skips already-trashed, not under the export root, not `isPositivelyMarkedHarnessContainer` (role `harness_container`, folder MIME, aged `artifactMaxAgeMs`, run-tag prefix), missing run tag, or a run tag not in `authorizedRunTags`. Wave B’s mark already requires `vantage_reporting_run_id` and `vantage_reporting_destination_id`.

4. **Trash each authorized leftover folder after the fence — or count it on dry-run; on fail mark needs janitor and keep going** — `dryRun` increments `skippedCount` and `continue` (no fence, no trash). Else `getLiveTestHarnessRun` missing → `errors += 1` and `continue` (does **not** **ask** mark-needs). Else `assertHarnessContainerSafeToTrash` then `trashHarnessContainerWithConfirmation`. Catch: `errors += 1`, **asks** `markLiveTestHarnessRunNeedsJanitor` `.catch(() => undefined)`, **keeps going** (unlike trash-the-set, which **breaks** on first fail). `touchedRunTags` adds success and fail run tags.

5. **Ask later-evaluate to mark a run completed when every registered folder is gone, then hand the owner a masked bag and tell** — `markJanitorEligibleRunsCompletedWhenFullyCleaned` `{ drive, runTags: authorized ∪ touched, getHarnessRun, markCompleted }`. Dry-run still **asks** evaluate. Bag `janitor-run` sets `artifactIds` to every eligible file id (not only trashed). `cleanup_outcome` / `janitor_status` are `failed` if `errors > 0`, else `completed` — never `partial`. Scan / select steps always `passed`. Then `recordReportingLiveTestJanitorOutcome` `{ ok: errors === 0, scanned, eligible, trashed, errors, dryRun }`. Return `ok: errors === 0`.

`TestArtifactCandidate` / `TestArtifactJanitorResult` are the bags cron already reads, not extra owner operations.

1. **Dry-run still asks later-evaluate.** `dryRun` increments `skippedCount` then still **asks** `markJanitorEligibleRunsCompletedWhenFullyCleaned`. A dry-run cron can flip `pending` → `completed` if Drive already says every registered folder is gone (or 404 cleaned). Name dry-run still marks. Do **not** silently skip evaluate on dry-run so “dry means read-only.”

2. **Missing registry after select increments errors and does not mark needs janitor.** Select already required `authorizedRunTags`. Then `getLiveTestHarnessRun` can still be `null` (another walker completed the row, or the row vanished). The catch path **asks** mark-needs; this path does not. Name the race. Do **not** silently **ask** mark-needs here so “every miss writes needs_janitor.”
