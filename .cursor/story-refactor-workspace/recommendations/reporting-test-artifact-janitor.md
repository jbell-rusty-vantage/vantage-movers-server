# Scan The Dedicated Export Root For Leftover Harness Folders This Registry Still Authorizes, Trash Only Those Aged Marked Containers After The Fence, Then Ask Later-Evaluate To Mark A Run Completed When Every Registered Folder Is Gone — Never A Spreadsheet, Never Official Delivery Trash, Never A Drive Listing Alone — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 45 of this service — `live/testArtifactJanitor.ts`
- Remaining in this service: `live/janitorCompletion.ts`
- Target: `src/services/reporting/live/testArtifactJanitor.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Skip / fail: “Run read failures — fixed safe envelopes; provider/source details are not exposed.” Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `runTestArtifactJanitor`, `selectTestArtifactsForCleanup`, `TestArtifactCandidate`, `TestArtifactJanitorResult`, `janitor-noop`, `janitor-run`, or `authorizedRunTags` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended official leftover janitor: [`reporting-cleanup.md`](reporting-cleanup.md) (`runReportingCleanupJanitor` / `cleanupDeliveryArtifacts` trash failed or cancelled `ReportingDelivery` workbooks / hidden staging tabs; Wave B `/api/cron/reporting-cleanup-janitor` **asks** that file, not this one). Distinct from already-recommended stamp / trash-the-set: [`reporting-live-test-cleanup.md`](reporting-live-test-cleanup.md) (orchestration **asks** stamp then trash-the-set; this file **asks** the fence then confirmed-trash only — it never stamps, never **asks** `cleanupLiveTestHarnessContainers`). Distinct from already-recommended refuse / principal / export-root / trash fence: [`reporting-live-test-security.md`](reporting-live-test-security.md) (this file **asks** refuse / principal / export-root / fence; security never `files.update`). Distinct from already-recommended wrap: [`reporting-live-test-oauth-adapters.md`](reporting-live-test-oauth-adapters.md) (this file **asks** the wrap and keeps `driveApi` only). Distinct from already-recommended registry: [`reporting-live-test-harness-run-registry.md`](reporting-live-test-harness-run-registry.md) (this file **asks** list / get / mark-needs; evaluate inject **asks** get + mark-completed). Distinct from already-recommended bag: [`reporting-pii-safe-evidence.md`](reporting-pii-safe-evidence.md) (this file **asks** the bag on disabled / prereq fail / finished scan; scan step **asks** drop-keys + `maskGoogleFileId` for `export_root_masked`). Distinct from already-recommended tell: [`reporting-reporting-observability.md`](reporting-reporting-observability.md) (this file **asks** `recordReportingLiveTestJanitorOutcome` only after the scan — not on disabled skip or prereq fail). Distinct from leftover unvisited later evaluate: `live/janitorCompletion.ts` (this file **asks** `markJanitorEligibleRunsCompletedWhenFullyCleaned` after the trash loop; evaluate never lists Drive children). Distinct from already-recommended live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (never **asks** this file). Distinct from already-recommended official Drive trash: [`reporting-reporting-drive-adapter.md`](reporting-reporting-drive-adapter.md) (`trashFile` **asks** spreadsheet MIME + official run match; this file never **asks** `drive.trashFile`). Distinct from Wave B `src/config/domain/reportingLiveTest.ts` (`isReportingLiveTestEnabled` / prereq / `isPositivelyMarkedHarnessContainer` — age-select lives there; this file **asks** the mark, never ages a folder itself). Distinct from Wave B `src/routes/reporting-cron.routes.ts` (`/api/cron/reporting-test-artifact-janitor` **asks** this file `{ dryRun, limit: 50 }`; `skipped` → 200; `ok` → 200 else 503; catch → 500 canned sentence). Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (never imports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: Wave B `src/routes/reporting-cron.routes.ts` (`/api/cron/reporting-test-artifact-janitor` **asks** `runTestArtifactJanitor({ dryRun: query.dry_run === "true", limit: 50 })`). Already-recommended `live/liveTestSecurity.test.ts` **asks** `runTestArtifactJanitor` only for the disabled skip (`skipped: true`, `ok: true`). `live/testArtifactJanitor.test.ts` **asks** `selectTestArtifactsForCleanup` only (export-root / age / mark / authorized run tag / prefix). `live/janitorCompletion.test.ts` does not import this file. `live/liveGoogleHarness.test.ts` / `reporting.test.ts` / `reportingDelivery.test.ts` do not import this file. Orchestration never **asks** this file. Official leftover janitor never **asks** this file. Owner HTTP never **asks** this file. Queue consumer never **asks** this file. **No admin route** mounts this file.
- Seams callers need: decide-whether-later-janitor-may-run (`isReportingLiveTestEnabled` + prereq) vs select-leftover-harness-folders-this-registry-still-authorizes (`selectTestArtifactsForCleanup`) vs trash-each-authorized-folder-after-the-fence (the walk **asks** fence then confirmed-trash) vs ask-later-evaluate-to-mark-a-run-completed-when-every-registered-folder-is-gone (`markJanitorEligibleRunsCompletedWhenFullyCleaned`) vs hand-the-owner-a-masked-bag-and-tell (`buildMaskedLiveTestEvidence` + `recordReportingLiveTestJanitorOutcome`). The skip / 503 **seam** exists because cron maps `skipped` to 200 and `ok: false` to 503. The select / Drive-list **seam** exists because select never talks to Drive; the walk lists export-root direct children then **asks** select. The Drive-list / registry-list **seam** exists because a Drive listing alone is not enough — authorized run tags come from `listJanitorEligibleHarnessRunTags`. The fence / confirmed-trash **seam** exists because confirmed-trash never **asks** the fence; this file **asks** the fence first. The this-file / trash-the-set **seam** exists because in-process orchestration **asks** trash-the-set; cron **asks** this file. The this-file / official leftover janitor **seam** exists because `cleanup.ts` **asks** delivery workbooks. The dry-run / evaluate **seam** exists because dry-run increments `skippedCount` then still **asks** evaluate. The tell / early-return **seam** exists because disabled skip and prereq fail never **ask** tell. There is no begin / complete Domain Command **seam**. There is no official `ReportingDelivery.status` **seam**. There is no worker write **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~298-line file is one sitting if you read it as scan the dedicated export root for leftover harness folders this registry still authorizes, trash only those aged marked containers after the fence, then ask later-evaluate to mark a run completed when every registered folder is gone — never a spreadsheet, never official delivery trash, never a Drive listing alone. Do **not** split into `select.ts` / `janitor.ts` / `scan.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull official leftover janitor, trash-the-set, fence, registry persist, later evaluate, bag, wrap, or tell here so “one janitor file owns the company.” If it later splits: `decideWhetherLaterJanitorMayRun.ts` / `selectLeftoverHarnessFoldersThisRegistryStillAuthorizes.ts` / `trashEachAuthorizedLeftoverFolderAfterTheFence.ts` / `askLaterEvaluateToMarkARunCompletedWhenEveryRegisteredFolderIsGone.ts` only as later story files, never CRUD.

`runTestArtifactJanitor` / `selectTestArtifactsForCleanup` are executor mechanics. The owner question is: *When live Google testing leaves harness folders under the dedicated export root, cron later scans only that folder’s direct children. Trash only aged, positively marked harness_container folders whose run tag is still pending or needs_janitor on the harness-run registry. Fence again before trash. Confirm Drive says trashed. If a trash fails, mark that run needs janitor and keep going. After the walk, ask later-evaluate to mark a run completed only when every registered folder is gone. If live tests are off, skip. If the live-test desk is not ready, refuse. Never trash a spreadsheet. Never start official leftover cleanup. Never trust a Drive listing alone. Never hit Owner HTTP. Never sync the Master Sheet.*

Already-recommended official leftover janitor, stamp / trash-the-set, refuse / fence, wrap, registry, bag, and tell already live in other **modules**. Later evaluate stays a sibling **module**. Wave B cron / live-test config stay Wave B. Do not pull those in.

## What this file actually does

Five operations of one “scan the dedicated export root for leftover harness folders this registry still authorizes, then trash only those aged marked containers after the fence” story, not “a janitor CRUD helper,” and not official leftover janitor / trash-the-set:

1. **Decide whether later janitor may run** — `isReportingLiveTestEnabled` false → `{ ok: true, skipped: true }` bag `janitor-noop` / `live_test_disabled`. Prereq `!ok` → `{ ok: false, skipped: false, errors: 1 }` bag `janitor-skipped` / `prerequisites` failed with `prereq.code`. Neither path **asks** refuse / Drive / registry / tell. Cron maps `skipped` to 200 with a canned reason; `ok: false` to 503 with the full result.

2. **Prove the connected test owner and the dedicated export root** — `rejectServiceAccountCredentialsForLiveTest`, `assertLiveTestOAuthPrincipal`, `validateDedicatedExportRoot` with `GOOGLE_OAUTH_OWNER_EMAIL`, `createLiveTestGoogleAdapters` keeping `driveApi` only. The wrap **asks** refuse again. This file never **asks** `google.auth.getClient` itself.

3. **Select leftover harness folders this registry still authorizes** — `listJanitorEligibleHarnessRunTags` `{ exportRootFolderId }` for `pending` / `needs_janitor`. Drive `files.list` interpolates the export-root id into `q` (`in parents and trashed = false and mimeType = folder`). `pageSize` is `min(limit, 100)`; cron always passes `limit: 50`. No `nextPageToken`. `selectTestArtifactsForCleanup` skips already-trashed, not under the export root, not `isPositivelyMarkedHarnessContainer` (role `harness_container`, folder MIME, aged `artifactMaxAgeMs`, run-tag prefix), missing run tag, or a run tag not in `authorizedRunTags`. Wave B’s mark already requires `vantage_reporting_run_id` and `vantage_reporting_destination_id`.

4. **Trash each authorized leftover folder after the fence — or count it on dry-run; on fail mark needs janitor and keep going** — `dryRun` increments `skippedCount` and `continue` (no fence, no trash). Else `getLiveTestHarnessRun` missing → `errors += 1` and `continue` (does **not** **ask** mark-needs). Else `assertHarnessContainerSafeToTrash` then `trashHarnessContainerWithConfirmation`. Catch: `errors += 1`, **asks** `markLiveTestHarnessRunNeedsJanitor` `.catch(() => undefined)`, **keeps going** (unlike trash-the-set, which **breaks** on first fail). `touchedRunTags` adds success and fail run tags.

5. **Ask later-evaluate to mark a run completed when every registered folder is gone, then hand the owner a masked bag and tell** — `markJanitorEligibleRunsCompletedWhenFullyCleaned` `{ drive, runTags: authorized ∪ touched, getHarnessRun, markCompleted }`. Dry-run still **asks** evaluate. Bag `janitor-run` sets `artifactIds` to every eligible file id (not only trashed). `cleanup_outcome` / `janitor_status` are `failed` if `errors > 0`, else `completed` — never `partial`. Scan / select steps always `passed`. Then `recordReportingLiveTestJanitorOutcome` `{ ok: errors === 0, scanned, eligible, trashed, errors, dryRun }`. Return `ok: errors === 0`.

`TestArtifactCandidate` / `TestArtifactJanitorResult` are the bags cron already reads, not extra owner operations.

## Organization

Keep one file. This is the screenplay for “scan the dedicated export root for leftover harness folders this registry still authorizes, then trash only those aged marked containers after the fence.” Official leftover janitor, trash-the-set, fence, wrap, registry, later evaluate, bag, and tell already live in deeper **modules**. Do not pull those in. Do not invent a `TestArtifactJanitorService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second official leftover-janitor **adapter** beside `cleanup.ts`. Do not invent a second `files.update` `{ trashed: true }` beside confirmed-trash. Do not invent a second evaluate **adapter** beside `markJanitorEligibleRunsCompletedWhenFullyCleaned`.

Do not split select / walk into CRUD files. Select stays with the walk because the walk **asks** select after the Drive list. Do not start `cleanupLiveTestHarnessContainers` from this file so “one trash-the-set owns later janitor.” Do not start `cleanupDeliveryArtifacts` from this file so “every Google trash lives together.” Do not start `files.update` from this file so “later janitor owns trash.” Do not move age-select into Wave B config so “the mark owns the walk.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `selectTestArtifactsForCleanup` | `selectLeftoverHarnessFoldersThisRegistryStillAuthorizes` | the walk after Drive list + janitor tests |
| `runTestArtifactJanitor` | `trashLeftoverHarnessFoldersThisRegistryStillAuthorizes` | Wave B test-artifact cron + disabled-skip test |

Keep `TestArtifactCandidate` / `TestArtifactJanitorResult` until cron and tests migrate. Keep the old names as one-line aliases until Wave B cron / `liveTestSecurity.test.ts` / `testArtifactJanitor.test.ts` migrate. Do not make Wave B cron learn `trashLeftoverHarnessFoldersThisRegistryStillAuthorizes`. Do not persist a new harness marker version in this rename.

**No class for the workflow.** The type that *does* earn a name is the bag cron already JSON-encodes on 200 / 503:

```ts
type LaterJanitorWalkTheOwnerCanRead = {
  ok: boolean
  skipped: boolean
  scanned: number
  eligible: number
  trashed: number
  skippedCount: number
  errors: number
  evidence: MaskedLiveTestEvidenceTheOwnerCanLog
}
```

That is the handoff from “cron already authorized the walk” to “Drive may trash leftover folders, evaluate may mark completed, the owner can log the bag.” Do **not** put official `ReportingDelivery.status` on this type. Do **not** put a raw `fileId` on `evidence`. Do **not** put `ZZ1` / `ZY1` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// testArtifactJanitor.ts
// When live Google testing leaves harness folders under
// the dedicated export root, cron later scans only that
// folder's direct children.
// Trash only aged, positively marked harness_container
// folders whose run tag is still pending or needs_janitor
// on the harness-run registry.
// Fence again before trash. Confirm Drive says trashed.
// If a trash fails, mark that run needs janitor and keep going.
// After the walk, ask later-evaluate to mark a run completed
// only when every registered folder is gone.
// If live tests are off, skip.
// Never trash a spreadsheet.
// Never start official leftover cleanup.
// Never trust a Drive listing alone.

// -- 1. Decide whether later janitor may run --

function skipBecauseLiveGoogleTestingIsOff()
  // bag janitor-noop; no Drive; no tell
function refuseBecauseTheLiveTestDeskIsNotReady(prereq)
  // bag janitor-skipped; errors 1; no Drive; no tell

// -- 2. Select leftover harness folders this registry still authorizes --

export function selectLeftoverHarnessFoldersThisRegistryStillAuthorizes(input)
  // skip trashed / not under export root / not positively marked /
  // run tag missing or not in authorizedRunTags
export const selectTestArtifactsForCleanup =
  selectLeftoverHarnessFoldersThisRegistryStillAuthorizes

async function listDirectChildFoldersUnderTheExportRoot(drive, exportRootFolderId, limit)
  // files.list; pageSize min(limit, 100); no nextPageToken

// -- 3. Trash each authorized leftover folder after the fence --

async function trashThisAuthorizedLeftoverFolderAfterTheFence(artifact, config, drive)
  // get registry; missing -> errors, no mark-needs
  // fence; confirmed-trash
  // catch -> mark needs_janitor (swallowed); keep going

// -- 4. Ask later-evaluate, then hand the owner a bag and tell --

export async function trashLeftoverHarnessFoldersThisRegistryStillAuthorizes(input?)
  // skip / refuse / prove owner / list tags / scan / select /
  // dry-run or trash loop / evaluate authorized ∪ touched /
  // bag janitor-run / tell
export const runTestArtifactJanitor =
  trashLeftoverHarnessFoldersThisRegistryStillAuthorizes
```

Read the later-janitor path out loud: *If live tests are off, skip and do not touch Drive. If the live-test desk is not ready, refuse. Prove the connected test owner. List the run tags still pending or needs_janitor under this export root. List only that folder’s direct child folders. Keep a folder only when Wave B’s mark says it is an aged harness container and the registry still authorizes its run tag. On dry-run, count it and still ask later-evaluate. Otherwise fence again, trash, confirm Drive says trashed. If a trash fails, mark needs janitor and keep going. After the walk, ask later-evaluate to mark a run completed only when every registered folder is gone. Hand the owner a masked bag and tell observability. Never trash a spreadsheet. Never start official leftover cleanup. Never trust a Drive listing alone.*

That is the operation. `runTestArtifactJanitor` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Dry-run still asks later-evaluate.** `dryRun` increments `skippedCount` then still **asks** `markJanitorEligibleRunsCompletedWhenFullyCleaned`. A dry-run cron can flip `pending` → `completed` if Drive already says every registered folder is gone (or 404 cleaned). Name dry-run still marks. Do **not** silently skip evaluate on dry-run so “dry means read-only.”

2. **Missing registry after select increments errors and does not mark needs janitor.** Select already required `authorizedRunTags`. Then `getLiveTestHarnessRun` can still be `null` (another walker completed the row, or the row vanished). The catch path **asks** mark-needs; this path does not. Name the race. Do **not** silently **ask** mark-needs here so “every miss writes needs_janitor.”

3. **No pagination.** `files.list` `pageSize` is `min(limit, 100)` and there is no `nextPageToken`. Folders past the first page never enter select. Cron always passes `limit: 50`. Name first-page wins. Do **not** silently walk later pages in this rename so “every child is seen.”

4. **The bag never says partial.** `cleanup_outcome` / `janitor_status` are `failed` if any error, else `completed` — even when some folders were trashed. Scan / select steps always `passed`. The bag’s `SENSITIVE_KEY` still drops step `name` (already named on the bag pass). Name all-or-nothing bag. Do **not** silently set `partial` in this rename.

5. **Prereq fail does not tell.** Disabled skip and prereq fail return without `recordReportingLiveTestJanitorOutcome`. Cron 503 on prereq fail has no Operational Event. Name tell only after scan. Do **not** silently tell on the early returns so “every refuse pages the owner.”

6. **Catch swallows the reason.** No per-folder bag step. `markLiveTestHarnessRunNeedsJanitor` `.catch(() => undefined)` swallows a persist fail, then the walk continues. Name swallowed mark. Do **not** silently rethrow the mark fail so “the registry write must succeed.”

7. **This file keeps going after a trash fail; trash-the-set breaks.** In-process cleanup **breaks** remaining folders. Later janitor **keeps going**. Name the two loops. Do **not** silently **break** this loop so “both walkers match.”

8. **Drive `q` interpolates the export-root id.** A quote in the id would break the query. Name the string `q`. Do **not** silently parameterize the Drive query in this rename.

9. **Leave sibling modules alone.** `assertHarnessContainerSafeToTrash`, `trashHarnessContainerWithConfirmation`, `listJanitorEligibleHarnessRunTags`, `markJanitorEligibleRunsCompletedWhenFullyCleaned`, `buildMaskedLiveTestEvidence`, `recordReportingLiveTestJanitorOutcome`, `cleanupDeliveryArtifacts`, and `cleanupLiveTestHarnessContainers` are already the right **depth**. This file decides whether later janitor may run, selects leftover folders the registry still authorizes, fences, then **asks** confirmed-trash. Do not open unvisited `live/janitorCompletion.ts` this pass.

## Testing

The **interface** is the test surface: `trashLeftoverHarnessFoldersThisRegistryStillAuthorizes` (today `runTestArtifactJanitor`) and `selectLeftoverHarnessFoldersThisRegistryStillAuthorizes` (today `selectTestArtifactsForCleanup`).

Today `testArtifactJanitor.test.ts` **asks** select only (export-root / age / mark / authorized run tag / prefix) and also **asks** Wave B `isPositivelyMarkedHarnessContainer` / `isPositivelyMarkedLiveTestArtifact` — those are sibling **interfaces**. Today `liveTestSecurity.test.ts` **asks** the walk only for disabled skip. No test **asks** fence + trash, missing registry, dry-run still evaluate, prereq 503 bag, or tell after scan. That is helper-unit style for a story that writes Google trash.

Replace the helper style with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Decide whether later janitor may run**
- Live tests off → `skipped: true`, `ok: true`, bag `janitor-noop`, Drive / registry / tell never **asked**.
- Prereq fail → `ok: false`, `errors: 1`, bag `janitor-skipped` with `prereq.code`, tell never **asked**. Name that gap.

**Select**
- Direct child, aged, marked `harness_container`, authorized run tag → kept.
- Other parent / young / unmarked / spreadsheet role / unauthorized run tag / already trashed → dropped.
- Prefix mismatch dropped even when the unauthorized tag is in the authorized set? Today prefix is inside Wave B mark; the extra prefix test in this file proves mark, not a second filter.

**Walk**
- Dry-run increments `skippedCount`, never **asks** fence or confirmed-trash, still **asks** evaluate. Name that gap.
- Missing `getLiveTestHarnessRun` after select increments `errors` and does not **ask** mark-needs. Name that gap.
- Fence throw **asks** mark-needs (swallowed) and continues to the next folder. Trash-the-set is not **asked**. Official `cleanupDeliveryArtifacts` / `drive.trashFile` are not **asked**.
- After the loop, evaluate receives `authorized ∪ touched`.
- Finished scan **asks** tell with `ok: errors === 0`. Bag `artifact_ids_masked` never contains a raw file id. Scan / select steps claim `passed` even when trash failed. Name that gap.

Do **not** add a test per helper (`listDirectChildFoldersUnderTheExportRoot`, the `touchedRunTags` set). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot official leftover janitor, worker write, queue publish, Analytics, or Sheet Sync inside these tests. Official leftover trash proofs stay `reportingDelivery.regressions.test.ts`. Live Google stays `pnpm reporting:live-google-harness`. Later evaluate stays `janitorCompletion.test.ts`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting or Reporting Sheets.
- I would not open Wave B (`src/routes/reporting-cron.routes.ts`, `src/config/domain/reportingLiveTest.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `TestArtifactJanitorService` class or a `select.ts` / `janitor.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second official leftover-janitor **adapter** beside `cleanup.ts`.
- I would not invent a second `files.update` `{ trashed: true }` beside confirmed-trash.
- I would not silently skip evaluate on dry-run so “dry means read-only.”
- I would not silently **ask** mark-needs on a missing registry row so “every miss writes needs_janitor.”
- I would not silently paginate Drive so “every child is seen.”
- I would not silently set `partial` on the bag.
- I would not silently tell on disabled skip or prereq fail.
- I would not silently **break** this loop so it matches trash-the-set.
- I would not silently merge this file with `liveTestCleanup.ts` or `cleanup.ts`.
- I would not open leftover `live/janitorCompletion.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
