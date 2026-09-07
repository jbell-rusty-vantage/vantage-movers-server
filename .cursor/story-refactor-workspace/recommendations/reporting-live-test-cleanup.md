# Prove The Connected Test Owner, Stamp Only Harness Container Folders We Own, Then Trash Those Folders After The Fence Confirms — Never A Spreadsheet, Never Official Delivery Trash — Or Hand Them To Later Janitor — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 37 of this service — `live/liveTestCleanup.ts`
- Remaining in this service: `live/liveTestEnv.ts`, then remaining `live/*` harness
- Target: `src/services/reporting/live/liveTestCleanup.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `cleanupLiveTestHarnessContainers`, `tagHarnessContainerFolder`, `trashHarnessContainerWithConfirmation`, `assertNestedArtifactsWithinContainers`, `cleanupLiveTestArtifacts`, `tagLiveTestArtifactForCleanup`, `files.update` `{ trashed: true }`, or a live-test harness-folder trash — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (that file **asks** leftover `recordLiveTestHarnessRun`, then this stamp, then this trash-the-set; error path stamps again then **asks** this trash-the-set; this file never delivers, never **asks** leftover worker). Distinct from already-recommended leftover refuse / leftover principal / leftover trash fence: [`reporting-live-test-security.md`](reporting-live-test-security.md) (this file **asks** leftover principal, leftover refetch, leftover trash fence; leftover security never `files.update`). Distinct from already-recommended leftover wrap: [`reporting-live-test-oauth-adapters.md`](reporting-live-test-oauth-adapters.md) (this trash-the-set **asks** leftover prove-then-wrap and keeps `driveApi` only). Distinct from already-recommended official leftover janitor: [`reporting-cleanup.md`](reporting-cleanup.md) (failed / cancelled `ReportingDelivery` trash; a completed snapshot never trash; never **asks** this file). Distinct from already-recommended official Drive trash: [`reporting-reporting-drive-adapter.md`](reporting-reporting-drive-adapter.md) (`trashFile` **asks** leftover `assertSafeToTrashReportingArtifact` — spreadsheet MIME + official run match; this file **asks** leftover live fence then raw `files.update`). Distinct from already-recommended official Drive stamp: [`reporting-drive-app-properties.md`](reporting-drive-app-properties.md) (`vantage_reporting_run_id` / role `snapshot` | `staging_workbook`; this stamp **asks** Wave B `buildLiveTestAppProperties` + role `harness_container`). Distinct from already-recommended leftover tell: [`reporting-reporting-observability.md`](reporting-reporting-observability.md) (`recordReportingLiveTestJanitorOutcome` is leftover later janitor; this file never **asks** leftover tell). Distinct from unvisited later janitor: `live/testArtifactJanitor.ts` (Wave B `/api/cron/reporting-test-artifact-janitor` **asks** leftover later janitor; leftover later janitor **asks** leftover refuse / leftover principal / leftover export-root / leftover wrap / leftover trash fence, then this confirmed-trash only — it never **asks** this stamp or this trash-the-set). Distinct from unvisited leftover registry: `live/liveTestHarnessRunRegistry.ts` (this file **asks** leftover record / leftover mark-completed / leftover mark-needs-janitor; leftover trash fence **asks** leftover `isJanitorContainerAuthorized`). Distinct from unvisited leftover evaluate: `live/janitorCompletion.ts` (this file **asks** leftover `evaluateRegisteredContainersCleanup`; leftover later janitor **asks** leftover `markJanitorEligibleRunsCompletedWhenFullyCleaned`). Distinct from unvisited leftover mask: `live/piiSafeEvidence.ts` (`buildStructuredCleanupError` sanitizes leftover `message` and masks leftover `fileId`). Distinct from unvisited leftover env / leftover denylist / leftover picker / leftover synthetic page / leftover retry wrapper. Distinct from Wave B `src/config/domain/reportingLiveTest.ts` (`buildLiveTestAppProperties`; leftover later janitor age-select **asks** leftover `isPositivelyMarkedHarnessContainer` — this file never **asks** leftover age). Distinct from Wave B `src/routes/reporting-cron.routes.ts` (`/api/cron/reporting-test-artifact-janitor` **asks** leftover later janitor, not this file). Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (never imports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended `live/liveGoogleOrchestration.ts` (**asks** leftover `recordLiveTestHarnessRun`, then this stamp for each container, then this trash-the-set with leftover `nestedArtifactIds`; catch path stamps again — leftover tag throw is swallowed — then **asks** this trash-the-set). Unvisited `live/testArtifactJanitor.ts` (**asks** leftover trash fence then this confirmed-trash; never **asks** this stamp or this trash-the-set). No other `src/` import. Deprecated leftover `cleanupLiveTestArtifacts` / leftover `tagLiveTestArtifactForCleanup` have **no caller**. Tests: **no test imports this file**. `live/liveGoogleHarness.test.ts` **asks** leftover Wave B `buildLiveTestAppProperties` / leftover skip / leftover mask, not this file. `live/liveTestSecurity.test.ts` **asks** leftover fence helpers / leftover mask, not this file. `live/testArtifactJanitor.test.ts` **asks** leftover later-janitor select. `live/janitorCompletion.test.ts` **asks** leftover classify. `live/liveTestReleaseSafety.test.ts` **asks** leftover registry binding, not this file. `reporting.test.ts` / `reportingDelivery.test.ts` do not import this file. Owner HTTP confirm never **asks** this file. Official leftover janitor never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: stamp-a-harness-container-folder (`tagHarnessContainerFolder`) vs trash-one-harness-container-and-confirm-drive-says-trashed (`trashHarnessContainerWithConfirmation`) vs refuse-unless-nested-artifacts-sit-inside-those-containers (`assertNestedArtifactsWithinContainers`) vs trash-the-registered-harness-containers-or-hand-them-to-later-janitor (`cleanupLiveTestHarnessContainers`). The stamp / trash-the-set **seam** exists because leftover orchestration **asks** leftover stamp then leftover trash-the-set; leftover later janitor never stamps. The confirmed-trash / trash-the-set **seam** exists because leftover later janitor **asks** leftover confirmed-trash after leftover fence; leftover trash-the-set **asks** leftover fence then leftover confirmed-trash in a loop. The this-file-write / leftover-fence **seam** exists because leftover security **asks** leftover refetch and leftover registry and never `files.update`; this file is the only live `files.update` `{ trashed: true }`. The this-file-in-process / leftover-later-cron **seam** exists because leftover orchestration **asks** leftover trash-the-set now and leftover record so Wave B leftover test-artifact janitor can finish later. The this-file / official-leftover-janitor **seam** exists because leftover `cleanup.ts` **asks** leftover delivery workbooks / leftover hidden staging tabs; this file **asks** leftover harness_container folders. The this-file / official-Drive-trash **seam** exists because leftover `drive.trashFile` **asks** leftover spreadsheet MIME + leftover official run match; this file **asks** leftover folder MIME + leftover live markers + leftover registry. The leftover-refetch-confirm / leftover-evaluate **seam** exists because leftover confirmed-trash **asks** leftover `refetchDriveFileMetadata` and throws if not `trashed`; leftover evaluate **asks** leftover `fetchDriveFileMetadata` so 404 / 403 classify. The leftover-record / leftover-mark **seam** exists because leftover trash-the-set **asks** leftover record (`cleanup_status: "pending"`) before leftover fence, then leftover evaluate, then leftover mark-completed or leftover mark-needs-janitor. There is no begin / complete Domain Command **seam**. There is no official `ReportingDelivery.status` **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~210-line file is one sitting if you read it as prove the connected test owner, stamp only harness container folders we own, then trash those folders after the fence confirms — never a spreadsheet, never official delivery trash — or hand them to later janitor. Do **not** split into `tag.ts` / `trash.ts` / `cleanup.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover orchestration, leftover fence, leftover wrap, leftover later janitor, leftover official leftover janitor, leftover official Drive trash, leftover registry persist, leftover evaluate, or leftover mask here so “one cleanup file owns the company.” If it later splits: `stampAHarnessContainerFolderAsThisRun.ts` / `trashOneHarnessContainerAndConfirmDriveSaysTrashed.ts` / `refuseUnlessNestedArtifactsSitInsideThoseContainers.ts` / `trashTheRegisteredHarnessContainersOrHandThemToLaterJanitor.ts` only as later story files, never CRUD.

`cleanupLiveTestHarnessContainers` / `tagHarnessContainerFolder` / `trashHarnessContainerWithConfirmation` / `assertNestedArtifactsWithinContainers` are executor mechanics. The owner question is: *Prove the connected test owner. Stamp each harness folder as this run’s container — never stamp a spreadsheet. Then trash only those folders after leftover security says they are marked harness containers we registered. Confirm Drive says trashed. If a nested workbook sits outside those folders, stop and mark the run needs later janitor. If a trash fails, stop the remaining folders and mark needs janitor. When leftover evaluate says every registered folder is gone, mark the run completed. Never start official leftover `cleanup.ts`. Never **ask** leftover `drive.trashFile`. Never hit HTTP. Never sync the Master Sheet.*

Already-recommended leftover orchestration, leftover refuse / leftover principal / leftover trash fence, leftover wrap, leftover official leftover janitor, leftover official Drive trash, leftover official Drive stamp already live in other **modules**. Later janitor, leftover registry, leftover evaluate, leftover mask, leftover env, leftover denylist, leftover picker, leftover synthetic page, leftover retry wrapper, and Wave B config stay sibling **modules**. Do not pull those in.

## What this file actually does

Four operations of one “prove the connected test owner, stamp only harness container folders we own, then trash those folders after the fence confirms — or hand them to later janitor” story, not “a live-test cleanup CRUD helper,” and not leftover official leftover janitor / leftover later janitor / leftover fence:

1. **Stamp a harness container folder as this run** — `tagHarnessContainerFolder`. **Asks** leftover `assertLiveTestOAuthPrincipal`. **Asks** leftover `refetchDriveFileMetadata`. Already `trashed` → throw `"Harness container folder is already trashed."` **Asks** leftover Drive `files.update` `appProperties` merge: existing leftover metadata plus Wave B `buildLiveTestAppProperties` `{ runTag, runId, destinationId, role: "harness_container" }`. Does **not** refetch after the stamp. Does **not** **ask** leftover record. Leftover orchestration **asks** this **seam** on the happy path and again on the catch path (leftover tag throw is swallowed). Leftover later janitor never **asks** this **seam**. Deprecated leftover `tagLiveTestArtifactForCleanup` is this export.

2. **Trash one harness container and confirm Drive says trashed** — `trashHarnessContainerWithConfirmation`. **Asks** leftover Drive `files.update` `{ trashed: true }` with `supportsAllDrives: true`. **Asks** leftover `refetchDriveFileMetadata`. Not `trashed` → throw `"Container trash was not confirmed by Drive metadata refetch."` Does **not** **ask** leftover principal. Does **not** **ask** leftover trash fence. Leftover trash-the-set **asks** leftover fence first, then this **seam**. Leftover later janitor **asks** leftover fence first, then this **seam**. This is the only live `files.update` `{ trashed: true }`.

3. **Refuse unless nested artifacts sit inside those containers** — `assertNestedArtifactsWithinContainers`. For each leftover `nestedArtifactId`: skip when the id is itself a leftover container; else **ask** leftover `refetchDriveFileMetadata` and require leftover `parentFolderIds[0]` to be in the leftover container set. Missing leftover first parent or leftover first parent outside the set → throw `"Tracked nested artifact is outside a marked harness container folder."` Does not walk leftover other parents. Leftover trash-the-set **asks** this **seam** only when leftover `nestedArtifactIds` is non-empty. Leftover orchestration passes leftover replace-tab leftover workbook / leftover staging workbook / leftover snapshot leftover `workbook_id`.

4. **Trash the registered harness containers or hand them to later janitor** — `cleanupLiveTestHarnessContainers`. **Asks** leftover principal. **Asks** leftover `createLiveTestGoogleAdapters` and keeps leftover `driveApi` only. Dedupes leftover containers by leftover `folderId`. Empty leftover unique set → `{ outcome: "completed", attempted: 0, trashed: 0, errors: [] }` with no leftover record. Else **asks** leftover `recordLiveTestHarnessRun` `{ runTag: uniqueContainers[0].runTag, exportRootFolderId: config.exportRootFolderId, containerFolderIds }` — leftover record always `$set`s leftover `cleanup_status: "pending"`. If leftover nested ids exist: leftover nested refuse throw → leftover `markLiveTestHarnessRunNeedsJanitor`, return leftover `failed` / leftover `trashed: 0` / leftover `nested_artifact_outside_container` (leftover message sanitized, no leftover `fileId`). Then for each leftover unique container: leftover `assertHarnessContainerSafeToTrash` with leftover `HarnessContainerTrashExpectation` `{ runTag, runId, destinationId, exportRootFolderId, runTagPrefix }`, then leftover confirmed-trash. Leftover catch → leftover `container_trash_failed` with leftover masked `fileId`, then **break** (leftover remaining folders are not attempted). Leftover outcome is leftover `completed` only when leftover `errors` is empty and leftover `trashed === uniqueContainers.length`. Then leftover `evaluateRegisteredContainersCleanup` on leftover unique folder ids. Leftover `allCleaned` → leftover `markLiveTestHarnessRunCleanupCompleted`. Else if leftover outcome is leftover `failed` → leftover `markLiveTestHarnessRunNeedsJanitor`. Deprecated leftover `cleanupLiveTestArtifacts` is this export.

`LiveTestContainerRegistration` / `LiveTestCleanupResult` are the leftover bags leftover orchestration already holds, not extra owner operations.

## Organization

Keep one file. This is the screenplay for “prove the connected test owner, stamp only harness container folders we own, then trash those folders after the fence confirms — or hand them to later janitor.” Leftover orchestration, leftover refuse / leftover principal / leftover trash fence, leftover wrap, leftover official leftover janitor, leftover official Drive trash, leftover official Drive stamp, leftover later janitor, leftover registry, leftover evaluate, leftover mask already live in deeper **modules**. Do not pull those in. Do not invent a `LiveTestCleanupService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover official leftover-janitor **adapter** beside leftover `cleanup.ts`. Do not invent a second leftover Drive-trash **adapter** beside leftover `drive.trashFile`. Do not invent a second leftover `files.update` `{ trashed: true }` beside leftover confirmed-trash.

Do not split leftover stamp / leftover confirmed-trash / leftover trash-the-set into CRUD files. Leftover trash-the-set stays with leftover confirmed-trash because leftover trash-the-set **asks** leftover confirmed-trash after leftover fence. Do not move leftover `files.update` into leftover security so “the fence owns trash.” Do not start leftover `runTestArtifactJanitor` from this file so “one janitor owns Google.” Do not start leftover `cleanupDeliveryArtifacts` from this file so “every leftover Google trash lives together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `tagHarnessContainerFolder` | `stampAHarnessContainerFolderAsThisRun` | leftover orchestration happy path + leftover catch |
| `trashHarnessContainerWithConfirmation` | `trashOneHarnessContainerAndConfirmDriveSaysTrashed` | leftover trash-the-set + leftover later janitor |
| `assertNestedArtifactsWithinContainers` | `refuseUnlessNestedArtifactsSitInsideThoseContainers` | leftover trash-the-set when leftover nested ids exist |
| `cleanupLiveTestHarnessContainers` | `trashTheRegisteredHarnessContainersOrHandThemToLaterJanitor` | leftover orchestration happy path + leftover catch |

Keep leftover `cleanupLiveTestArtifacts` / leftover `tagLiveTestArtifactForCleanup` as the already-deprecated one-line aliases. Keep leftover `LiveTestContainerRegistration` / leftover `LiveTestCleanupResult` until leftover orchestration migrates. Keep the old names as one-line aliases until leftover `liveGoogleOrchestration.ts` / leftover `testArtifactJanitor.ts` migrate. Do not make leftover Wave B leftover test-artifact cron learn leftover `trashTheRegisteredHarnessContainersOrHandThemToLaterJanitor`. Do not persist a new leftover harness marker version in this rename.

**No class for the workflow.** The type that *does* earn a name is the leftover bag leftover orchestration already destructures:

```ts
type LiveTestHarnessCleanupWeMayReturn = {
  outcome: "completed" | "failed"
  attempted: number
  trashed: number
  errors: LiveTestCleanupError[]
}
```

That is the handoff from “leftover orchestration already stamped the leftover folders” to “Drive confirmed leftover trash, or leftover later janitor must finish.” Do **not** put leftover official `ReportingDelivery.status` on this type. Do **not** put leftover `ZZ1` / leftover `ZY1` on this type. Do **not** put leftover `trashed: true` as a leftover write helper on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// liveTestCleanup.ts
// Prove the connected test owner.
// Stamp each harness folder as this run's container —
// never stamp a spreadsheet.
// Then trash only those folders after leftover security
// says they are marked harness containers we registered.
// Confirm Drive says trashed.
// If a nested workbook sits outside those folders,
// stop and mark the run needs later janitor.
// If a trash fails, stop the remaining folders
// and mark needs janitor.
// When leftover evaluate says every registered folder is gone,
// mark the run completed.
// Never start official leftover cleanup.
// Never ask leftover drive.trashFile.
// Never hit HTTP. Never sync the Master Sheet.

// ── 1. Stamp a harness container folder ───────────────────

export async function stampAHarnessContainerFolderAsThisRun(input)
  // proveTheConnectedPrincipalIsTheConfiguredTestOwner
  // refetchDriveMetadataIncludingAppProperties
  // already trashed → throw
  // files.update appProperties merge
  //   buildLiveTestAppProperties role harness_container
  // do not refetch after the stamp
  // do not ask leftover record
export const tagHarnessContainerFolder =
  stampAHarnessContainerFolderAsThisRun
export const tagLiveTestArtifactForCleanup =
  stampAHarnessContainerFolderAsThisRun  // deprecated

// ── 2. Trash one folder and confirm Drive says trashed ────

export async function trashOneHarnessContainerAndConfirmDriveSaysTrashed(input)
  // files.update { trashed: true }
  // refetchDriveMetadataIncludingAppProperties
  // not trashed → throw
  // do not ask leftover principal
  // do not ask leftover trash fence
export const trashHarnessContainerWithConfirmation =
  trashOneHarnessContainerAndConfirmDriveSaysTrashed

// ── 3. Refuse unless nested artifacts sit inside ──────────

export async function refuseUnlessNestedArtifactsSitInsideThoseContainers(input)
  // skip when the id is itself a leftover container
  // else leftover first parent must be in the leftover container set
export const assertNestedArtifactsWithinContainers =
  refuseUnlessNestedArtifactsSitInsideThoseContainers

// ── 4. Trash the registered set or hand to later janitor ─

export async function trashTheRegisteredHarnessContainersOrHandThemToLaterJanitor(input)
  // proveTheConnectedPrincipalIsTheConfiguredTestOwner
  // proveTheConnectedTestOwnerThenWrapThoseAdapters — keep driveApi
  // unique leftover containers by folderId
  // empty → completed 0/0, no leftover record
  // recordLiveTestHarnessRun pending on uniqueContainers[0].runTag
  // leftover nested ids → refuseUnlessNestedArtifactsSitInsideThoseContainers
  //   throw → markLiveTestHarnessRunNeedsJanitor + failed 0 trash
  // for each leftover unique container:
  //   refuseToTrashUnlessThisFolderIsAMarkedHarnessContainerWeRegistered
  //   trashOneHarnessContainerAndConfirmDriveSaysTrashed
  //   leftover catch → container_trash_failed, then break
  // evaluateRegisteredContainersCleanup
  // allCleaned → markLiveTestHarnessRunCleanupCompleted
  // else if leftover failed → markLiveTestHarnessRunNeedsJanitor
export const cleanupLiveTestHarnessContainers =
  trashTheRegisteredHarnessContainersOrHandThemToLaterJanitor
export const cleanupLiveTestArtifacts =
  trashTheRegisteredHarnessContainersOrHandThemToLaterJanitor  // deprecated
```

Read the primary path out loud: *Prove the connected test owner. Wrap that OAuth client as Drive. Remember the folders on the harness-run row as pending. If a nested workbook’s first parent is not one of those folders, stop and mark needs janitor. Otherwise leftover security must say each folder is a marked harness container we registered. Then trash that folder and leftover refetch must say trashed. When leftover evaluate says every registered folder is gone, mark completed. If a trash fails, stop the remaining folders and mark needs janitor. Never trash a spreadsheet from this file. Never start official leftover janitor.*

Read the later-janitor path out loud: *Wave B test-artifact cron **asks** leftover later janitor, not this trash-the-set. Leftover later janitor **asks** leftover fence, then `trashOneHarnessContainerAndConfirmDriveSaysTrashed`. It never stamps. It never **asks** `cleanupLiveTestHarnessContainers`.*

That is the operation. `cleanupLiveTestHarnessContainers` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Orchestration records, then this file records again.** Leftover orchestration **asks** `recordLiveTestHarnessRun` before leftover stamp. Trash-the-set **asks** leftover record again and `$set`s `cleanup_status: "pending"`. Rename the second record so the reset is visible. Do not silently drop the inner record so “callers own the registry.”

2. **Principal runs twice on trash-the-set.** Trash-the-set **asks** leftover principal, then leftover prove-then-wrap **asks** leftover principal again (and leftover refuse three times — already named on leftover wrap). Stamp **asks** leftover principal on its own. Leftover orchestration already **asked** leftover principal before leftover stamp. Rename the nested prove so the pile-up is visible. Do not silently drop the inner **ask** so “callers own principal.”

3. **Confirmed-trash does not **ask** leftover fence.** Leftover later janitor and trash-the-set **ask** leftover fence first. A future caller that **asks** confirmed-trash alone would trash without the registry. Rename confirmed-trash so “confirm only” is visible. Do not silently **ask** leftover fence from confirmed-trash so “one function owns safety” — leftover later janitor already **asks** leftover fence.

4. **First trash fail breaks.** Remaining unique containers are not attempted. Then leftover evaluate walks all unique ids. Outcome `failed` marks needs janitor. Do not silently continue the loop so “every folder is attempted.”

5. **Completed trash with evaluate not `allCleaned` marks nothing.** Outcome `completed` requires empty `errors` and `trashed === uniqueContainers.length`. Mark-completed requires `evaluation.allCleaned`. Mark-needs-janitor requires outcome `failed`. If confirmed-trash “succeeded” but leftover evaluate sees `present` / `refetch_blocked`, neither mark runs. Rename that gap. Do not silently mark needs janitor on that path so “the registry cannot lie completed.”

6. **`uniqueContainers[0].runTag` binds the whole set.** Leftover record / nested-fail mark / evaluate mark all **ask** the first unique run tag. Leftover orchestration uses one `runTag` for both folders. Do not silently record per-container run tags so “mixed tags work.”

7. **Nested check uses `parentFolderIds[0]` only.** A workbook whose first parent is outside the container set fails even if another parent is a container. Do not silently walk all parents so “any parent counts.”

8. **Stamp does not refetch after `files.update`.** Confirmed-trash does. Leftover fence **asks** markers the stamp just wrote. A failed stamp would fail later at the fence. Do not silently refetch after stamp so “stamp matches trash confirm.”

9. **Empty unique set returns completed without leftover record.** Leftover orchestration’s catch skips trash-the-set when `containers.length === 0`. Do not silently record an empty run so “every ask writes Mongo.”

10. **No test imports this file.** Fence proofs stay in `liveTestSecurity.test.ts`. Later-janitor select stays in `testArtifactJanitor.test.ts`. Evaluate classify stays in `janitorCompletion.test.ts`. Deprecated aliases have no caller. That is not enough for a story that writes Google trash.

11. **Leave sibling modules alone.** `assertLiveTestOAuthPrincipal`, `assertHarnessContainerSafeToTrash`, `createLiveTestGoogleAdapters`, `recordLiveTestHarnessRun`, `evaluateRegisteredContainersCleanup`, `runTestArtifactJanitor`, `cleanupDeliveryArtifacts`, and `drive.trashFile` are already the right **depth**. This file stamps, confirms trash, and marks the registry.

## Testing

The **interface** is the test surface: `stampAHarnessContainerFolderAsThisRun`, `trashOneHarnessContainerAndConfirmDriveSaysTrashed`, `refuseUnlessNestedArtifactsSitInsideThoseContainers`, `trashTheRegisteredHarnessContainersOrHandThemToLaterJanitor` (today `tagHarnessContainerFolder` / `trashHarnessContainerWithConfirmation` / `assertNestedArtifactsWithinContainers` / `cleanupLiveTestHarnessContainers`).

Today **no test imports this file**. `liveGoogleHarness.test.ts` proves skip / `buildLiveTestAppProperties` / mask. `liveTestSecurity.test.ts` proves fence helpers / mask. `testArtifactJanitor.test.ts` proves later-janitor select. `janitorCompletion.test.ts` proves classify / 404 cleaned / 403 blocked. `liveTestReleaseSafety.test.ts` proves registry binding. That is not enough for a story that stamps and trashes Google folders.

Replace the missing coverage with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Stamp**
- Already trashed throws and never `files.update`.
- `files.update` `appProperties` merge Wave B `buildLiveTestAppProperties` role `harness_container`.
- Principal throw never reaches `files.update`.

**Confirmed trash**
- `files.update` `{ trashed: true }` then refetch `trashed: true` returns.
- Refetch `trashed: false` throws “not confirmed.”
- The leftover fence is not **asked** from this export.

**Nested refuse**
- Nested id equal to a container is skipped.
- First parent outside the container set throws `nested_artifact_outside_container` on trash-the-set and marks needs janitor with `trashed: 0`.

**Trash the registered set**
- Empty unique set returns completed 0/0 and does not **ask** leftover record.
- Fence throw records `container_trash_failed`, **breaks**, and marks needs janitor.
- Evaluate `allCleaned` **asks** mark-completed.
- Later janitor is not **asked**.
- Official `cleanupDeliveryArtifacts` / `drive.trashFile` are not **asked**.

Do **not** add a test per helper (the unique `Map`, the first `runTag`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot official leftover janitor, leftover worker, leftover queue publish, Analytics, or Sheet Sync inside these tests. Official leftover trash proofs stay `reportingDelivery.regressions.test.ts`. Live Google stays `pnpm reporting:live-google-harness`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/config/domain/reportingLiveTest.ts`, `src/routes/reporting-cron.routes.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `LiveTestCleanupService` class or a `tag.ts` / `trash.ts` / `cleanup.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second leftover official leftover-janitor **adapter** beside leftover `cleanup.ts`.
- I would not invent a second leftover Drive-trash **adapter** beside leftover `drive.trashFile`.
- I would not silently **ask** leftover fence from leftover confirmed-trash so “one function owns safety.”
- I would not silently drop the inner leftover record or leftover principal so “callers own registry.”
- I would not silently continue the trash loop after the first fail.
- I would not silently mark needs janitor when trash “succeeded” but leftover evaluate is not `allCleaned`.
- I would not silently merge this file with `testArtifactJanitor.ts` or leftover `cleanup.ts`.
- I would not silently move `files.update` `{ trashed: true }` into leftover security.
- I would not open `live/liveTestEnv.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
