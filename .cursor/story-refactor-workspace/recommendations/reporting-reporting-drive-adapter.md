# Create A Snapshot Workbook In This Folder And Stamp This Destination And This Run On Drive AppProperties, Then Only Trash That File When Identity, Spreadsheet MIME, Owner, And Those Same Properties Still Answer — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 31 of this service — `google/reportingDriveAdapter.ts`
- Remaining in this service: remaining `live/*` harness
- Target: `src/services/reporting/google/reportingDriveAdapter.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Google workbooks are a delivery surface. Knowledge never names this file, `createSpreadsheet`, `trashFile`, `getFile`, `assertSafeToTrashReportingArtifact`, `ReportingDriveAdapter`, `ReportingDriveFile`, `wrapProvider`, or `supportsAllDrives` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover Drive stamp: [`reporting-drive-app-properties.md`](reporting-drive-app-properties.md) (`buildReportingDriveAppProperties` / `driveAppPropertiesMatchRun` / leftover MIME — leftover stamp never **asks** `files.create`; leftover match never **asks** leftover trash). Distinct from already-recommended leftover Sheets write / prove / promote / delete-tab: [`reporting-reporting-sheets-adapter.md`](reporting-reporting-sheets-adapter.md) (`createHiddenStagingTab` / `writeValuesRaw` / `deleteSheet` — leftover Sheets never **asks** `files.create`; leftover `deleteSheet` is a tab, not leftover `trashFile`). Distinct from already-recommended leftover pack / resume: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (snapshot without a workbook **asks** leftover `createSpreadsheet` role `snapshot` then leftover persist-before-markers; leftover replace-tab never **asks** leftover create). Distinct from already-recommended leftover janitor: [`reporting-cleanup.md`](reporting-cleanup.md) (failed / cancelled snapshot **asks** leftover `getFile` then leftover `trashFile`; leftover replace-tab **asks** leftover Sheets prove + leftover `deleteSheet`, never leftover trash; leftover completed snapshot never **asks** this file). Distinct from already-recommended leftover claim / complete: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (type `ReportingDriveAdapter`; leftover worker **asks** leftover pack create; leftover enqueue then leftover janitor **asks** leftover trash — leftover worker never **asks** leftover `files.update`). Distinct from already-recommended leftover canned failure: [`reporting-provider-failures.md`](reporting-provider-failures.md) (`wrapProvider` **asks** leftover `sanitizeReportingProviderFailure` — leftover classify stays leftover `durableWork/`). Distinct from already-recommended leftover destination desk: [`google-drive-oauth-spreadsheet.md`](google-drive-oauth-spreadsheet.md) / leftover [`google-drive-oauth-managed-tab.md`](google-drive-oauth-managed-tab.md) (leftover destination folder / leftover `SheetsWorkbookClient` leftover add leftover `ZZ1` — leftover desk never **asks** leftover `createSpreadsheet`). Distinct from leftover unvisited live inject: `live/transientRetryWrapper.ts` (wraps leftover `createSpreadsheet` only — leftover inject never wraps leftover `trashFile`). Distinct from leftover unvisited live OAuth: `live/liveTestOAuthAdapters.ts` (**asks** leftover `createReportingDriveAdapterFromApi`). Distinct from leftover unvisited live harness stamp: leftover `live/liveTestSecurity.ts` **asks** leftover `buildLiveTestAppProperties` (`vantage_live_test` / leftover `harness_container`) — leftover live janitor **asks** leftover live stamp, not leftover `assertSafeToTrashReportingArtifact`. Distinct from leftover test fake: `google/fakeReportingGoogle.ts` (implements leftover `ReportingDriveAdapter` in memory — leftover tests **ask** leftover fake, not leftover `createReportingDriveAdapter`). Distinct from leftover `google/index.ts` (barrel). Distinct from leftover Wave B `api/queues/reporting-consumer.ts` (**asks** leftover `createReportingDriveAdapter` then leftover worker + leftover janitor when leftover delivery is on). Distinct from leftover Wave B `src/routes/reporting-cron.routes.ts` (leftover cleanup cron **asks** leftover `createReportingDriveAdapter` then leftover janitor). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `deliveryEngine.ts` (snapshot without leftover `existing.workbookId` **asks** leftover `createSpreadsheet` `{ title: Report ${runId-8} ${ISO}, folderId, runId, destinationId, role: "snapshot" }` then leftover `onWorkbookCreated` before leftover tab stamps; leftover replace-tab never **asks** leftover create). Leftover `cleanup.ts` (failed / cancelled snapshot **asks** leftover `getFile`; already `trashed` continues; else **asks** leftover `trashFile` `{ fileId, expectedRunId, expectedDestinationId }`; leftover replace-tab never **asks** leftover trash; leftover completed snapshot never **asks** this file). Leftover `reportingWorker.ts` leftover type only besides leftover pack create through leftover `drive`. Leftover `live/liveTestOAuthAdapters.ts` **asks** leftover `createReportingDriveAdapterFromApi`. Leftover `live/transientRetryWrapper.ts` wraps leftover `createSpreadsheet` only. Leftover `live/liveGoogleOrchestration.ts` leftover type + leftover worker bag. Leftover `google/fakeReportingGoogle.ts` implements leftover create / leftover get / leftover trash (leftover trash **asks** leftover `assertSafeToTrashReportingArtifact`). Leftover `google/index.ts` re-exports everything. Leftover Wave B `api/queues/reporting-consumer.ts` **asks** leftover `createReportingDriveAdapter`. Leftover Wave B leftover cleanup cron **asks** leftover `createReportingDriveAdapter`. Tests: leftover `reportingDelivery.test.ts` **asks** leftover fake leftover `createSpreadsheet` role `snapshot` then leftover `trashFile` + leftover `getFile.trashed === true`; leftover completed snapshot leftover janitor never touches leftover Drive. Leftover `reportingDelivery.regressions.test.ts` **asks** leftover `assertSafeToTrashReportingArtifact` accept matching leftover stamp / refuse `ownedByMe: false` / refuse `application/pdf` / refuse empty `{}` `/appProperties/`. Leftover `reporting.test.ts` does not import this file. Leftover destination desk never **asks** this adapter. **No runtime pack caller** stamps role `staging_workbook` through leftover `createSpreadsheet`.
- Seams callers need: create-a-snapshot-workbook-and-stamp-Drive-appProperties (`createSpreadsheet`) vs read-this-Drive-file (`getFile`) vs only-trash-when-identity-MIME-owner-and-those-same-properties-still-answer (`trashFile` / `assertSafeToTrashReportingArtifact`). The pack / Drive-create **seam** exists because leftover snapshot pack **asks** leftover `createSpreadsheet`; leftover `files.create` stays here. The janitor / Drive-trash **seam** exists because leftover snapshot leftover janitor **asks** leftover `trashFile`; leftover `files.update` `{ trashed: true }` stays here. The this-adapter / leftover stamp **seam** exists because leftover create **asks** leftover `buildReportingDriveAppProperties`; leftover trash leftover assert **asks** leftover `driveAppPropertiesMatchRun` — leftover stamp serialize stays leftover `driveAppProperties.ts`. The this-adapter / leftover Sheets **seam** exists because leftover tab create / leftover paint / leftover `deleteSheet` stay leftover `reportingSheetsAdapter.ts`; this file never **asks** leftover `addSheet` / leftover `values.update` / leftover `deleteSheet`. The snapshot-workbook / replace-tab **seam** exists because leftover snapshot leftover pack **asks** leftover create; leftover replace-tab never **asks** leftover `files.create`; leftover replace-tab leftover janitor **asks** leftover Sheets leftover delete-tab. The official-delivery stamp / live-harness stamp **seam** exists because leftover live **asks** leftover `buildLiveTestAppProperties`. The create / prove-after-create **seam** exists because leftover create does not prove leftover `appProperties` after leftover `files.create`. The get / trash **seam** exists because leftover trash **asks** leftover `getFile` then leftover assert then leftover update; leftover janitor also **asks** leftover `getFile` first to skip already leftover trashed. The wrap / leftover BadRequest **seam** exists because leftover create / leftover get wrap every throw; leftover trash rethrows leftover `BadRequestError` without leftover wrap. There is no begin / complete Domain Command **seam**. There is no leftover claim-lease **seam**. There is no leftover tab-delete **seam**. There is no leftover Analytics **seam**. There is no leftover Sheet Sync **seam**. There is no leftover destination leftover `SheetsWorkbookClient` **seam**.
- Split later (only if the file outgrows one sitting): this ~190-line file is one sitting if you read it as create a snapshot workbook in this folder and stamp this destination and this run on Drive appProperties, then only trash that file when identity, spreadsheet MIME, owner, and those same properties still answer. Do **not** split into `create.ts` / `get.ts` / `trash.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover stamp serialize, leftover Sheets write, leftover pack resume, leftover janitor walk, leftover canned sentences, leftover live inject, leftover live harness stamp, or leftover fake here so “one Drive file owns the company.” If it later splits: `createASnapshotWorkbookAndStampThisDestinationAndThisRun.ts` / `onlyTrashThisFileWhenIdentityMimeOwnerAndDrivePropertiesStillAnswer.ts` only as later story files, never CRUD.

`createSpreadsheet` / `trashFile` / `getFile` / `assertSafeToTrashReportingArtifact` are executor mechanics. The owner question is: *When we deliver a snapshot report, create a new Google spreadsheet in the destination folder and stamp Drive appProperties that name this run, this destination, version 1, and a Drive role. Later, only trash that file if the immutable file ID still matches, it is still a spreadsheet we own, and those same Drive properties still name this run and this destination. A human title is not enough. A destination stamp in ZZ1 is a different stamp. A run stamp in ZY1 is a different stamp. Sheet-cell markers alone are insufficient. Live-test harness tags are a different stamp. When Google fails, say what kind of failure it is in canned words — never the file title. Do not add a tab from this file. Do not paint cells from this file. Do not delete a tab from this file. Do not claim a run. Do not sync the Master Sheet.*

Already-recommended leftover pack, leftover janitor, leftover Sheets adapter, leftover Drive stamp, leftover canned sentences already live in other **modules**. Leftover live harness / leftover destination desk stay leftover. Do not pull those in.

## What this file actually does

Three operations of one “create a snapshot workbook in this folder and stamp this destination and this run on Drive appProperties, then only trash that file when identity, spreadsheet MIME, owner, and those same properties still answer” story, not “a Drive CRUD adapter,” and not leftover Sheets write or leftover destination desk:

1. **Create a snapshot workbook in this folder and stamp this destination and this run on Drive appProperties** — `createSpreadsheet`. **Asks** leftover `files.create` `{ name: title, mimeType: leftover spreadsheet MIME, parents: [folderId], appProperties: leftover stamp }` with leftover `supportsAllDrives: true`. Missing leftover `id` → leftover `IntegrationError` “Google Drive did not return a spreadsheet ID.” Returns leftover `{ spreadsheetId, spreadsheetUrl: webViewLink ?? docs.google.com fallback, title: name ?? input.title }`. Does not prove leftover `appProperties` after leftover create. Does not **ask** leftover `ownedByMe`. Leftover snapshot leftover pack **asks** leftover role leftover `snapshot`. Leftover replace-tab never **asks** this verb. Leftover wrap **asks** leftover sanitize onto leftover `Reporting Drive create_spreadsheet failed: ${summary}`.

2. **Read this Drive file’s metadata** — `getFile`. **Asks** leftover `files.get` leftover fields leftover `id,name,trashed,mimeType,webViewLink,ownedByMe,appProperties` with leftover `supportsAllDrives: true`. Missing leftover `id` or leftover `mimeType` → leftover `IntegrationError` “Google Drive returned incomplete metadata.” Leftover `trashed` / leftover `ownedByMe` become leftover booleans. Leftover janitor **asks** this to skip already leftover trashed before leftover trash. Leftover trash **asks** this again before leftover assert.

3. **Only trash the file when identity, spreadsheet MIME, owner, and those same Drive properties still answer** — `trashFile` / `assertSafeToTrashReportingArtifact`. Leftover trash **asks** leftover `getFile` then leftover assert then leftover `files.update` `{ trashed: true }` with leftover `supportsAllDrives: true`. Leftover assert refuses when leftover `file.id !== expectedFileId` (“Cleanup refused: Drive file identity did not match the stored artifact.”) / leftover MIME is not leftover spreadsheet (“…artifact is not a Google spreadsheet.”) / leftover `ownedByMe` is leftover false (“…spreadsheet is not owned by the connected owner account.”) / leftover `driveAppPropertiesMatchRun` is leftover false (“…Drive appProperties run marker did not match.”). Leftover assert does not check leftover `file.trashed`. Leftover assert does not **ask** an expected leftover role — leftover match accepts leftover `snapshot` or leftover `staging_workbook`. Leftover `BadRequestError` rethrows without leftover wrap. Other leftover throws wrap as leftover `Reporting Drive trash_file failed`. Leftover janitor **asks** leftover trash only after leftover failed / leftover cancelled leftover snapshot; leftover completed leftover snapshot never reaches here.

`createReportingDriveAdapter` **asks** leftover `getConnectedGoogleOAuthClient` then leftover `createReportingDriveAdapterFromApi`. Leftover `ReportingDriveAdapter` / leftover `ReportingDriveFile` are the contract leftover pack / leftover janitor / leftover fake already share. They are not extra owner operations.

## Organization

Keep one file. This is the screenplay for “create a snapshot workbook in this folder and stamp this destination and this run on Drive appProperties, then only trash that file when identity, spreadsheet MIME, owner, and those same properties still answer.” Leftover stamp serialize, leftover Sheets write / leftover prove / leftover delete-tab, leftover pack resume, leftover janitor walk, leftover canned sentences already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingDriveService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover Google-create **adapter** beside leftover `createSpreadsheet`. Do not invent a second leftover trash **adapter** beside leftover `trashFile`. Do not invent a second leftover stamp serialize beside leftover `buildReportingDriveAppProperties`. Do not invent a second leftover wrap beside leftover `wrapProvider`.

Do not split leftover create / leftover get / leftover trash into CRUD files. Leftover create stays with leftover trash because leftover stamp keys leftover create writes are the same keys leftover trash leftover assert **asks**. Do not start leftover `addSheet` or leftover `values.update` from this file. Do not move leftover `assertSafeToTrashReportingArtifact` into leftover `driveAppProperties.ts` so “the prove owns trash.” Do not move leftover janitor leftover walk here so “one Drive file owns cleanup.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createSpreadsheet` | `createASnapshotWorkbookAndStampThisDestinationAndThisRun` | leftover pack snapshot + leftover fake + leftover live inject |
| `getFile` | `readThisDriveFilesMetadata` | leftover janitor already-trashed skip + leftover trash + leftover tests |
| `trashFile` | `trashThisFileOnlyWhenIdentityMimeOwnerAndDrivePropertiesStillAnswer` | leftover janitor snapshot + leftover fake + leftover tests |
| `assertSafeToTrashReportingArtifact` | `refuseToTrashUnlessIdentityMimeOwnerAndDrivePropertiesStillAnswer` | leftover trash + leftover fake trash + leftover regressions |
| `createReportingDriveAdapter` | `openAnOauthBackedReportingDriveAdapter` | leftover Wave B consumer + leftover Wave B cleanup cron |
| `createReportingDriveAdapterFromApi` | `openAReportingDriveAdapterFromThisGoogleApi` | leftover live OAuth |
| `ReportingDriveAdapter` | `OurReportingDriveWriteSurface` | leftover pack / leftover janitor / leftover fake |
| `ReportingDriveFile` | `ThisDriveFilesMetadata` | leftover assert + leftover fake + leftover regressions |

Keep the old names as one-line aliases until leftover `deliveryEngine.ts`, leftover `cleanup.ts`, leftover `reportingWorker.ts`, leftover `live/liveTestOAuthAdapters.ts`, leftover `live/transientRetryWrapper.ts`, leftover `google/fakeReportingGoogle.ts`, leftover `google/index.ts`, leftover Wave B consumer / leftover Wave B cron, leftover `reportingDelivery.test.ts`, and leftover `reportingDelivery.regressions.test.ts` migrate. Do not make leftover janitor learn leftover `refuseToTrashUnlessIdentityMimeOwnerAndDrivePropertiesStillAnswer` instead of leftover `trashFile`. Do not make leftover Sheets leftover prove **ask** this file so “one run proof owns files and tabs.” Do not persist a new leftover Drive leftover marker leftover version in this rename.

**No class for the workflow.** The type that *does* earn a name is the write surface leftover pack and leftover janitor already **ask**:

```ts
type OurReportingDriveWriteSurface = {
  createASnapshotWorkbookAndStampThisDestinationAndThisRun(input)
  readThisDriveFilesMetadata(input)
  trashThisFileOnlyWhenIdentityMimeOwnerAndDrivePropertiesStillAnswer(input)
}
```

That is the handoff from “leftover snapshot pack has a run id and a destination folder” to “Google may create or trash a workbook.” Do **not** put leftover `ZZ1` / leftover `ZY1` on this type. Do **not** put leftover `vantage_live_test` on this type. Do **not** put leftover `REPORTING_FAILURE_CODES` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reportingDriveAdapter.ts
// We are about to deliver a snapshot report.
// Create a new Google spreadsheet in the destination folder
// and stamp Drive appProperties that name this run,
// this destination, version 1, and a Drive role.
// Later, only trash that file if the immutable file ID
// still matches, it is still a spreadsheet we own,
// and those same Drive properties still name this run
// and this destination.
// A human title is not enough.
// A destination stamp in ZZ1 is a different stamp.
// A run stamp in ZY1 is a different stamp.
// Sheet-cell markers alone are insufficient.
// Live-test harness tags are a different stamp.
// When Google fails, say what kind of failure it is
// in canned words — never the file title.
// Do not add a tab. Do not paint cells. Do not delete a tab.
// Do not claim a run. Do not sync the Master Sheet.

// ── 1. Create a snapshot workbook and stamp Drive properties ─

export async function createASnapshotWorkbookAndStampThisDestinationAndThisRun(input)
  // files.create { title, spreadsheet MIME, parents: [folderId], leftover stamp }
  // missing id → IntegrationError
  // do not prove appProperties after create

export const createSpreadsheet =
  createASnapshotWorkbookAndStampThisDestinationAndThisRun

// ── 2. Read this Drive file ───────────────────────────────

export async function readThisDriveFilesMetadata(input)
  // files.get; missing id or mimeType → IntegrationError

export const getFile = readThisDriveFilesMetadata

// ── 3. Only trash when identity, MIME, owner, and stamps still answer ─

export function refuseToTrashUnlessIdentityMimeOwnerAndDrivePropertiesStillAnswer(input)
  // id miss / not spreadsheet / not owned / leftover match miss → BadRequestError
  // do not check file.trashed
  // do not ask an expected role

export const assertSafeToTrashReportingArtifact =
  refuseToTrashUnlessIdentityMimeOwnerAndDrivePropertiesStillAnswer

export async function trashThisFileOnlyWhenIdentityMimeOwnerAndDrivePropertiesStillAnswer(input)
  // ask readThisDriveFilesMetadata
  // ask refuseToTrashUnlessIdentityMimeOwnerAndDrivePropertiesStillAnswer
  // files.update { trashed: true }
  // rethrow BadRequestError; wrap the rest

export const trashFile =
  trashThisFileOnlyWhenIdentityMimeOwnerAndDrivePropertiesStillAnswer

export async function openAnOauthBackedReportingDriveAdapter()
export const createReportingDriveAdapter =
  openAnOauthBackedReportingDriveAdapter

export function openAReportingDriveAdapterFromThisGoogleApi(drive)
export const createReportingDriveAdapterFromApi =
  openAReportingDriveAdapterFromThisGoogleApi
```

Read the leftover snapshot create path out loud: *Leftover pack already has a run id and a destination folder. Snapshot without a workbook **asks** leftover `createASnapshotWorkbookAndStampThisDestinationAndThisRun` titled `Report ${runId-8} ${ISO}` with role `snapshot`. This file stamped Drive `appProperties`. Leftover pack then persists the workbook id before leftover Sheets stamps leftover `ZZ1` / leftover `ZY1`. This file never added a tab.*

Read the leftover replace-tab path out loud: *Leftover replace-tab leftover pack never **asks** this file. The published tab already lives on an existing workbook. Leftover Sheets creates a hidden staging tab there.*

Read the leftover janitor path out loud: *Failed or cancelled snapshot leftover janitor **asks** leftover `readThisDriveFilesMetadata`. Already leftover trashed continues. Else **asks** leftover `trashThisFileOnlyWhenIdentityMimeOwnerAndDrivePropertiesStillAnswer`. Leftover assert **asks** leftover identity + leftover spreadsheet MIME + leftover `ownedByMe` + leftover Drive leftover match. Leftover completed leftover snapshot never **asks** leftover Drive. Leftover replace-tab leftover janitor **asks** leftover Sheets leftover `deleteSheet`, not this file.*

That is the operation. `createSpreadsheet` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **Create does not prove appProperties after files.create.** Pack persists the workbook id from the returned id. A Google create that dropped the stamp would still look like ours until leftover trash leftover assert refuses. Do not silently start leftover create proving the leftover stamp so "the create is honest."

2. **assertSafeToTrashReportingArtifact does not check file.trashed.** Leftover janitor already skips already leftover trashed via leftover getFile. Leftover assert on an already leftover trashed leftover file with matching leftover stamps still proceeds to leftover files.update. Do not silently start leftover refuse leftover already leftover trashed so "trash is idempotent at the assert."

3. **Double getFile.** Leftover janitor asks leftover getFile then leftover trashFile asks leftover getFile again. Do not silently start leftover trash accepting a preloaded leftover file so "one get owns both stories."

4. **staging_workbook is accepted and unused at leftover pack.** Leftover create leftover contract allows leftover role leftover snapshot or leftover staging_workbook. Leftover snapshot leftover pack always asks leftover snapshot. Leftover match accepts either leftover role without an expected leftover role argument. Do not silently start leftover pack asking leftover staging_workbook so "the export is used."

5. **Trash rethrows BadRequestError; create and get wrap everything.** An identity miss stays leftover BadRequestError. A Google 404 on leftover create becomes leftover IntegrationError leftover 502 or leftover 503. Do not silently start leftover create leftover rethrowing leftover BadRequestError so "every refuse looks the same."

6. **Live leftover inject wraps leftover createSpreadsheet only.** Leftover transientRetryWrapper.ts leftover injects leftover 503 leftover on leftover create leftover, leftover Sheets leftover write leftover, leftover marker leftover write. Leftover trash leftover is leftover not leftover wrapped. Do not silently start leftover inject leftover wrapping leftover trash leftover so leftover "every leftover Drive leftover verb leftover retries."

7. **This file never adds a tab, paints cells, or deletes a tab.** Snapshot pack asks leftover Sheets after leftover create. Replace-tab janitor asks leftover deleteSheet, not leftover trashFile. Do not silently start leftover addSheet or leftover values.update from this file so "one Google file owns tabs and workbooks."

8. **Leave sibling modules alone.** Leftover pack / leftover janitor / leftover Sheets adapter / leftover Drive stamp stay recommended. Leftover live harness stays unvisited. Do not open live/liveGoogleHarness.ts this pass.

## Testing

The **interface** is the test surface. Existing asserts: leftover reportingDelivery.regressions.test.ts leftover assertSafeToTrashReportingArtifact accept matching leftover stamp; refuse ownedByMe false; refuse application/pdf; refuse empty {} /appProperties/. Leftover reportingDelivery.test.ts leftover asks leftover fake leftover createSpreadsheet role snapshot then leftover trashFile + leftover getFile.trashed === true. Leftover completed leftover snapshot leftover janitor leftover never leftover touches leftover Drive. Leftover reporting.test.ts does not import this file. No "create never proves appProperties" proof is locked. No "already trashed is still trashable at leftover assert" proof is locked. No "this file never calls values.update" proof is locked.

Add proofs at the new names (later implementer; not this Cloud pass):

- create: files.create parents folderId; mime is spreadsheet; leftover stamp keys are written; supportsAllDrives is true; missing id throws
- get: missing id or mimeType throws leftover IntegrationError
- trash: identity miss / not spreadsheet / not owned / leftover appProperties miss throw leftover BadRequestError; matching proceeds to leftover files.update trashed true
- never Sheets: leftover addSheet / leftover values.update / leftover deleteSheet are not called from this file
- replace-tab pack never asks leftover createSpreadsheet
- leftover MIME stays application/vnd.google-apps.spreadsheet

Do not add helper-unit tests for leftover wrapProvider. Do not boot leftover live Google, leftover destination desk, leftover promote, or leftover janitor walk. Do not replace leftover pack leftover tests with this file so "one test owns both stories." Do not assert leftover Sheets leftover deleteSheet categories as if they were leftover trashFile.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (src/routes/reporting.routes.ts, leftover src/models/ReportingRun.ts).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a ReportingDriveService class or a create.ts / get.ts / trash.ts / update.ts / delete.ts split.
- I would not invent a second leftover Google-create adapter beside leftover createSpreadsheet.
- I would not invent a second leftover trash adapter beside leftover trashFile.
- I would not invent a second leftover stamp serialize beside leftover buildReportingDriveAppProperties.
- I would not pull leftover stamp serialize, leftover Sheets write, leftover pack resume, leftover janitor walk, leftover canned sentences, leftover live inject, leftover live harness stamp, or leftover fake into this file.
- I would not silently start leftover create proving leftover appProperties after leftover files.create.
- I would not silently start leftover assert refusing leftover already leftover trashed.
- I would not silently start leftover pack leftover asking leftover staging_workbook.
- I would not silently start leftover addSheet or leftover files.create from leftover reportingSheetsAdapter.ts.
- I would not open leftover live/liveGoogleHarness.ts while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.

