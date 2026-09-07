# Create A Hidden Staging Tab And Stamp This Destination And This Run, Paint The Report As RAW Cells — Never A Formula — Then Only Call A Tab This Run's When Both Cells Still Answer, And Either Promote It Onto The Published Name Or Delete A Still-Hidden Leftover By Immutable ID — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 30 of this service — `google/reportingSheetsAdapter.ts`
- Remaining in this service: `google/reportingDriveAdapter.ts`, remaining `live/*` harness
- Target: `src/services/reporting/google/reportingSheetsAdapter.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Execution package mandates literal `RAW` spreadsheet writes, literal headers/cells, `formulasAllowed: false`. Knowledge never names this file, `createHiddenStagingTab`, `writeValuesRaw`, `verifyRange`, `promoteStagingTab`, `findSheetByRunMarker`, `verifyPublishedManagedTab`, `verifyOwnershipMarkerBySheetId`, `assertBoundedWrite`, `wrapProvider`, or `SheetsWorkbookClient` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover pack / resume / write / verify / swap: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (`createOrResumeDeliveryArtifact` **asks** `findSheetByRunMarker` then `createHiddenStagingTab`; snapshot then `hideSheet({ hidden: false })`; replace-tab **asks** `verifyPublishedManagedTab` before create; `writeBoundedReportingBatch` **asks** `writeValuesRaw` then `verifyRange` on a retryable catch; `verifyStagingContents` **asks** `verifyOwnershipAndRunMarkers` + `readValues`; `promoteOrRecoverReplaceTab` **asks** `promoteStagingTab` — leftover pack never **asks** `files.create`). Distinct from already-recommended leftover claim / complete: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (post-promote **asks** `verifyOwnershipMarkerBySheetId` then `verifyOwnershipAndRunMarkers` on the published title — leftover worker never **asks** `values.update`). Distinct from already-recommended leftover inspect: [`reporting-promotion.md`](reporting-promotion.md) (`inspectReplaceTabPromotion` **asks** `listSheets` only — leftover inspect never **asks** `promoteStagingTab`). Distinct from already-recommended leftover janitor: [`reporting-cleanup.md`](reporting-cleanup.md) (replace-tab **asks** `verifyOwnershipAndRunMarkers` then `deleteSheet` by `sheetId`; snapshot **asks** leftover Drive `trashFile`, not this file). Distinct from already-recommended leftover paint: [`reporting-cell-serialization.md`](reporting-cell-serialization.md) (`writeValuesRaw` / `readValues` **ask** `a1Range`; marker ranges **ask** `quoteSheetTitle` + `ZZ1` / `ZY1`; `serializeLiteralCell` allows `"=SUM"`; `assertBoundedWrite` refuses it). Distinct from already-recommended leftover destination stamp: [`reporting-ownership-marker.md`](reporting-ownership-marker.md). Distinct from already-recommended leftover run stamp: [`reporting-run-marker.md`](reporting-run-marker.md). Distinct from already-recommended leftover canned failure: [`reporting-provider-failures.md`](reporting-provider-failures.md) (`wrapProvider` **asks** `sanitizeReportingProviderFailure` — leftover classify stays leftover `durableWork/`). Distinct from already-recommended leftover managed-tab destination client: [`google-drive-oauth-managed-tab.md`](google-drive-oauth-managed-tab.md) (`SheetsWorkbookClient` `listSheets` / add / rename / prove `ZZ1` only — leftover destination desk **asks** that client, not this adapter). Distinct from leftover unvisited Drive write / trash: `google/reportingDriveAdapter.ts` (`createSpreadsheet` / `trashFile` **ask** leftover Drive `appProperties` — this file never **asks** `files.create`). Distinct from leftover unvisited live inject: `live/transientRetryWrapper.ts` (wraps `writeValuesRaw` / `writeOwnershipAndRunMarkers` only). Distinct from leftover unvisited live OAuth: `live/liveTestOAuthAdapters.ts` (**asks** `createReportingSheetsAdapterFromApi`). Distinct from leftover test fake: `google/fakeReportingGoogle.ts` (implements `ReportingSheetsAdapter` in memory — leftover tests **ask** leftover fake, not `createReportingSheetsAdapter`). Distinct from leftover `google/index.ts` (barrel). Distinct from leftover Wave B `api/queues/reporting-consumer.ts` and leftover Wave B `src/routes/reporting-cron.routes.ts` (both **ask** `createReportingSheetsAdapter`). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `deliveryEngine.ts` (resume **asks** `listSheets` + `verifyOwnershipAndRunMarkers` by immutable `stagingSheetId`; snapshot **asks** `findSheetByRunMarker` then `createHiddenStagingTab` then `hideSheet({ hidden: false })`; replace-tab **asks** `verifyPublishedManagedTab` then `findSheetByRunMarker` then `createHiddenStagingTab`; pack write **asks** `writeValuesRaw`; retryable catch **asks** `verifyRange` then maybe a second `writeValuesRaw`; verify **asks** `readValues`; promote **asks** `verifyOwnershipMarkerBySheetId` + `promoteStagingTab`). Leftover `reportingWorker.ts` (post-promote **asks** `verifyOwnershipMarkerBySheetId` + `listSheets` + `verifyOwnershipAndRunMarkers`; leftover type otherwise). Leftover `cleanup.ts` (replace-tab **asks** `listSheets` + `verifyOwnershipAndRunMarkers` + `deleteSheet`). Leftover `promotion.ts` **asks** `listSheets`. Leftover `live/liveTestOAuthAdapters.ts` **asks** `createReportingSheetsAdapterFromApi`. Leftover `live/liveGoogleOrchestration.ts` **asks** `listSheets` + `readValues`. Leftover `live/transientRetryWrapper.ts` wraps `writeValuesRaw` + `writeOwnershipAndRunMarkers`. Leftover `google/index.ts` re-exports everything. Leftover Wave B `api/queues/reporting-consumer.ts` **asks** `createReportingSheetsAdapter`. Leftover Wave B `src/routes/reporting-cron.routes.ts` cleanup cron **asks** `createReportingSheetsAdapter`. Tests: leftover `reportingDelivery.test.ts` **asks** leftover fake through `createOrResumeDeliveryArtifact` for RAW write / replay; `assertBoundedWrite([["=SUM(A1:A2)"]])` throws `/formula/`; `renameSheet` then `verifyOwnershipAndRunMarkers` rejects an unmarked human tab `/ownership marker|run marker/`. Leftover `reportingDelivery.regressions.test.ts` **asks** leftover fake `writeOwnershipAndRunMarkers` with role `published`; `verifyPublishedManagedTab` wrong id throws `/immutable ID/`; also **asks** `writeValuesRaw` + `promoteStagingTab`. Leftover `reporting.test.ts` does not import this file. Leftover destination desk **asks** leftover `SheetsWorkbookClient`, not this adapter. **No runtime pack caller** of `renameSheet` (leftover `promoteStagingTab` owns the two renames).
- Seams callers need: create-a-hidden-staging-tab-and-stamp-both-cells (`createHiddenStagingTab`) vs paint-this-report-as-RAW-cells (`writeValuesRaw`) vs read-back-and-say-whether-this-range-still-matches (`readValues` / `verifyRange`) vs prove-this-tab-is-still-this-destination’s-and-this-run’s (`verifyOwnershipAndRunMarkers`) vs find-the-tab-that-still-answers-both-stamps (`findSheetByRunMarker`) vs prove-the-published-tab-is-still-ours-by-immutable-id-and-title-and-ZZ1 (`verifyPublishedManagedTab`) vs prove-ZZ1-only-after-the-title-changed (`verifyOwnershipMarkerBySheetId`) vs promote-the-staging-tab-onto-the-published-name (`promoteStagingTab`) vs delete-a-still-hidden-leftover-by-immutable-id (`deleteSheet`). The pack / Google-write **seam** exists because leftover pack **asks** these verbs; `values.update` / `batchUpdate` stay here. The this-adapter / leftover Drive **seam** exists because leftover snapshot create **asks** leftover `createSpreadsheet`; this file never **asks** `files.create`. The this-adapter / leftover destination `SheetsWorkbookClient` **seam** exists because leftover destination desk `listSheets` is a different client (leftover `ZZ1` add / prove only). The title-write / immutable-id **seam** exists because `writeValuesRaw` **asks** the tab title; `promoteStagingTab` / `deleteSheet` **ask** `sheetId`. The both-stamp prove / published ZZ1 **seam** exists because `verifyOwnershipAndRunMarkers` **asks** `ZZ1` + `ZY1`; `verifyPublishedManagedTab` **asks** id + title + `ZZ1` only. The create-hidden / snapshot-unhide **seam** exists because `createHiddenStagingTab` always writes `hidden: true`; leftover snapshot pack then **asks** `hideSheet({ hidden: false })`. The paint / formula-fence **seam** exists because leftover `serializeLiteralCell` allows `"="`; `assertBoundedWrite` refuses it at write time. The wrap / pack-sanitize **seam** exists because `wrapProvider` **asks** leftover sanitize first; leftover pack catch **asks** leftover sanitize again. There is no begin / complete Domain Command **seam**. There is no leftover claim-lease **seam**. There is no leftover Drive trash **seam**. There is no leftover Analytics **seam**. There is no leftover Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~658-line file is one sitting if you read it as create a hidden staging tab and stamp this destination and this run, paint the report as RAW cells — never a formula — then only call a tab this run's when both cells still answer, and either promote it onto the published name or delete a still-hidden leftover by immutable ID. Do **not** split into `create.ts` / `write.ts` / `verify.ts` / `promote.ts` / `delete.ts` / `update.ts`. Do **not** pull leftover pack resume, leftover worker claim, leftover Drive create / trash, leftover destination `SheetsWorkbookClient`, leftover stamp serialize, leftover paint serialize, leftover canned sentences, leftover live inject, or leftover fake here so “one Sheets file owns the company.” If it later splits: `createAHiddenStagingTabAndStampThisDestinationAndThisRun.ts` / `paintThisReportAsRawCellsThenSayWhetherTheyStillMatch.ts` / `proveThisTabIsStillThisRunsThenPromoteOrDeleteByImmutableId.ts` only as later story files, never CRUD.

`createHiddenStagingTab` / `writeValuesRaw` / `verifyOwnershipAndRunMarkers` / `promoteStagingTab` are executor mechanics. The owner question is: *When we deliver a report onto Google Sheets, create a hidden staging tab and stamp this destination on ZZ1 and this run on ZY1. Paint the report as RAW cells — never a formula. Later, only call a tab this run's when both cells still answer. Only call the published tab ours when the immutable sheet ID, the published title, and ZZ1 still answer. Then either promote the staging tab onto the published name (the old tab becomes a recovery title) or delete a still-hidden leftover by immutable ID. When Google fails, say what kind of failure it is in canned words — never the cell values. Do not create the workbook from this file. Do not trash a file from this file. Do not claim a run. Do not sync the Master Sheet.*

Already-recommended leftover pack, leftover worker, leftover janitor, leftover inspect, leftover paint, leftover stamps, leftover canned sentences already live in other **modules**. Leftover Drive write / leftover destination client stay leftover. Do not pull those in.

## What this file actually does

Five operations of one “create a hidden staging tab and stamp this destination and this run, paint the report as RAW cells — never a formula — then only call a tab this run's when both cells still answer, and either promote it onto the published name or delete a still-hidden leftover by immutable ID” story, not “a Sheets CRUD adapter,” and not leftover Drive create or leftover destination desk:

1. **Create a hidden staging tab and stamp this destination and this run** — `createHiddenStagingTab`. **Asks** `listSheets`; same title → `BadRequestError` “A staging tab title collision was detected; choose another run tag.” Then `spreadsheets.batchUpdate` `addSheet` `{ title, hidden: true }`. Missing `sheetId` → `IntegrationError` “Google Sheets did not return a staging tab ID.” Then **asks** `writeOwnershipAndRunMarkers` with role `snapshot` when strategy is `snapshot`, else `staging`. Does not prove after the stamp. Leftover snapshot pack then **asks** `hideSheet({ hidden: false })`. Leftover replace-tab stays hidden until `promoteStagingTab`.

2. **Paint this report as RAW cells — never a formula — then read them back and say whether they still match** — `writeValuesRaw` / `readValues` / `verifyRange` / `assertBoundedWrite`. `assertBoundedWrite` refuses empty, more than `REPORTING_WRITE_BATCH_ROWS` (1000) rows, a ragged width, a non-literal cell, or a string that starts with `=`. `writeValuesRaw` **asks** leftover `a1Range`, then `values.update` with `REPORTING_VALUE_INPUT_OPTION` `"RAW"`. `readValues` **asks** leftover `a1Range` and `UNFORMATTED_VALUE`; `normalizeCell` treats `undefined` / `null` / `""` as `null`. `verifyRange` **asks** `readValues` then `rangesEqual`. Leftover pack write **asks** `writeValuesRaw`. Leftover pack retryable catch **asks** `verifyRange`; a match returns without a second write. Leftover verify contents **asks** `readValues`, not `verifyRange`.

3. **Prove this tab is still this destination's and this run's — or find the tab that still answers both stamps** — `writeOwnershipAndRunMarkers` / `verifyOwnershipAndRunMarkers` / `findSheetByRunMarker`. Write **asks** leftover ownership serialize onto `{quotedTitle}!ZZ1` and leftover run serialize onto `{quotedTitle}!ZY1` in one `values.batchUpdate` (`RAW`). Verify **asks** `values.batchGet` on those two cells; leftover ownership match miss → `BadRequestError` “Reporting ownership marker mismatch for destination.”; leftover run match miss → `BadRequestError` “Reporting run marker mismatch.” `findSheetByRunMarker` walks leftover `listSheets` and **asks** leftover verify per title; any throw continues; none match → `null`. Leftover pack resume and leftover replace-tab / leftover snapshot miss **ask** leftover find. Leftover janitor **asks** leftover verify then leftover `deleteSheet`.

4. **Prove the published tab is still ours by immutable ID + title + ZZ1 — or prove ZZ1 only after the title changed** — `verifyPublishedManagedTab` / `verifyOwnershipMarkerBySheetId`. Published prove **asks** leftover `listSheets` by `immutableSheetId`; missing → “The published managed reporting tab is missing by immutable ID.”; title mismatch → “The published managed reporting tab title no longer matches.”; then leftover `values.get` on `ZZ1` only (never `ZY1`). By-sheet-id prove **asks** leftover `listSheets` by `sheetId`; missing → “Sheet missing by immutable ID for ownership verification.”; then leftover `ZZ1` only. Leftover replace-tab create **asks** leftover published prove before staging. Leftover promote and leftover worker post-promote **ask** leftover by-sheet-id on the old tab.

5. **Promote the staging tab onto the published name — or hide / rename / delete a tab by immutable ID** — `promoteStagingTab` / `hideSheet` / `renameSheet` / `deleteSheet` / `listSheets`. Promote is one `batchUpdate`: old `sheetId` → leftover `recoveryTitle`; staging `sheetId` → leftover `publishedTitle` + `hidden: false`. Does not rewrite `ZY1`. Does not delete the old tab. `hideSheet` leftover snapshot pack **asks** with `hidden: false` after create. `renameSheet` has no leftover pack / leftover worker / leftover janitor caller. `deleteSheet` leftover janitor **asks** after leftover both-stamp prove on a still-hidden tab. `listSheets` is the walk leftover create / leftover find / leftover published prove / leftover by-sheet-id / leftover inspect / leftover janitor already share. `createReportingSheetsAdapter` leftover **asks** leftover `getConnectedGoogleOAuthClient`; leftover `createReportingSheetsAdapterFromApi` leftover live leftover **asks**. `wrapProvider` leftover **asks** leftover sanitize onto leftover `IntegrationError` (`Reporting Sheets ${operation} failed: ${summary}`); leftover `BadRequestError` leftover create / leftover verify leftover rethrow leftover without leftover wrap.

`REPORTING_VALUE_INPUT_OPTION` / `REPORTING_WRITE_BATCH_ROWS` / `ReportingSheetsAdapter` are the contract leftover pack and leftover fake already share (`"RAW"`, `1000`, the method bag). They are not extra owner operations.

## Organization

Keep one file. This is the screenplay for “create a hidden staging tab and stamp this destination and this run, paint the report as RAW cells — never a formula — then only call a tab this run's when both cells still answer, and either promote it onto the published name or delete a still-hidden leftover by immutable ID.” Leftover pack resume, leftover worker claim, leftover Drive create / trash, leftover destination `SheetsWorkbookClient`, leftover stamp serialize, leftover paint serialize, leftover canned sentences already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingSheetsService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover Google-write **adapter** beside leftover `writeValuesRaw`. Do not invent a second leftover prove **adapter** beside leftover `verifyOwnershipAndRunMarkers`. Do not invent a second leftover destination leftover `listSheets` beside leftover `SheetsWorkbookClient`. Do not invent a second leftover wrap beside leftover `wrapProvider`.

Do not split leftover create / leftover write / leftover prove / leftover promote into CRUD files. Leftover create stays with leftover stamp because leftover `addSheet` then leftover `writeOwnershipAndRunMarkers` must agree on the same title. Leftover write stays with leftover read-back because leftover pack leftover replay leftover **asks** leftover `verifyRange` on the same write bag. Do not start leftover `files.create` or leftover `trashFile` from this file. Do not move leftover `ZZ1` / leftover `ZY1` serialize here so “one Sheets file owns every stamp.” Do not move leftover `assertBoundedWrite` into leftover paint so “formula refuse lives with serialize.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createHiddenStagingTab` | `createAHiddenStagingTabAndStampThisDestinationAndThisRun` | leftover pack snapshot + leftover pack replace-tab + leftover fake |
| `writeValuesRaw` | `paintThisReportAsRawCellsOnThisTab` | leftover pack write + leftover pack replay + leftover live inject |
| `readValues` | `readTheseCellsBackAsLiterals` | leftover pack verify contents + leftover live orchestration |
| `verifyRange` | `sayWhetherThisRangeStillMatchesWhatWeWrote` | leftover pack retryable catch |
| `writeOwnershipAndRunMarkers` | `stampZz1AndZy1OnThisTab` | leftover create + leftover tests (role `published`) + leftover live inject |
| `verifyOwnershipAndRunMarkers` | `proveThisTabIsStillThisDestinationsAndThisRuns` | leftover pack resume + leftover pack verify + leftover janitor + leftover find |
| `findSheetByRunMarker` | `findTheTabThatStillAnswersBothStamps` | leftover pack snapshot / leftover pack replace-tab resume |
| `verifyPublishedManagedTab` | `proveThePublishedTabIsStillOursByImmutableIdAndTitleAndZz1` | leftover pack replace-tab before staging |
| `verifyOwnershipMarkerBySheetId` | `proveZz1IsStillThisDestinationsAfterTheTitleChanged` | leftover pack promote + leftover worker post-promote |
| `promoteStagingTab` | `promoteTheStagingTabOntoThePublishedName` | leftover pack promote |
| `deleteSheet` | `deleteThisStillHiddenTabByImmutableId` | leftover janitor |
| `hideSheet` | `hideOrShowThisTabByImmutableId` | leftover snapshot pack unhide |
| `renameSheet` | `renameThisTabByImmutableId` | leftover tests; unused at leftover pack runtime |
| `listSheets` | `listTheTabs` | leftover create / leftover find / leftover prove / leftover inspect / leftover janitor |
| `createReportingSheetsAdapter` | `openAnOauthBackedReportingSheetsAdapter` | leftover Wave B consumer + leftover Wave B cleanup cron |
| `createReportingSheetsAdapterFromApi` | `openAReportingSheetsAdapterFromThisGoogleApi` | leftover live OAuth |
| `assertBoundedWrite` | `refuseAWriteThatIsEmptyTooTallRaggedOrFormulaShaped` | leftover write + leftover fake + leftover RAW test |
| `rangesEqual` | `sayWhetherTheseTwoRangesAreTheSameLiterals` | leftover `verifyRange` + leftover fake |
| `REPORTING_VALUE_INPUT_OPTION` | `theRawWriteOptionWeAlwaysSend` | leftover pack + leftover fake + leftover RAW test |
| `REPORTING_WRITE_BATCH_ROWS` | `theWriteBatchRowCap` | leftover `assertBoundedWrite` + leftover pack batches |
| `ReportingSheetsAdapter` | `OurReportingSheetsWriteSurface` | leftover pack / leftover worker / leftover janitor / leftover fake |

Keep the old names as one-line aliases until leftover `deliveryEngine.ts`, leftover `reportingWorker.ts`, leftover `cleanup.ts`, leftover `promotion.ts`, leftover `live/liveTestOAuthAdapters.ts`, leftover `google/fakeReportingGoogle.ts`, leftover `google/index.ts`, leftover Wave B consumer / leftover Wave B cron, leftover `reportingDelivery.test.ts`, and leftover `reportingDelivery.regressions.test.ts` migrate. Do not make leftover janitor learn leftover `proveThisTabIsStillThisDestinationsAndThisRuns` instead of leftover `deleteSheet`. Do not make leftover destination desk **ask** this adapter so “one listSheets owns both stories.” Do not persist a new leftover `RAW` string in this rename.

**No class for the workflow.** The type that *does* earn a name is the write surface leftover pack already **asks**:

```ts
type OurReportingSheetsWriteSurface = {
  createAHiddenStagingTabAndStampThisDestinationAndThisRun(input)
  paintThisReportAsRawCellsOnThisTab(input)
  proveThisTabIsStillThisDestinationsAndThisRuns(input)
  promoteTheStagingTabOntoThePublishedName(input)
  deleteThisStillHiddenTabByImmutableId(input)
}
```

That is the handoff from “leftover pack has a run id and a destination id” to “Google may write tabs.” Do **not** put leftover Drive `appProperties` on this type. Do **not** put leftover `SheetsWorkbookClient` leftover add on this type. Do **not** put leftover `REPORTING_FAILURE_CODES` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reportingSheetsAdapter.ts
// We are about to deliver a report onto Google Sheets.
// Create a hidden staging tab and stamp this destination
// on ZZ1 and this run on ZY1.
// Paint the report as RAW cells — never a formula.
// Later, only call a tab this run's when both cells still answer.
// Only call the published tab ours when the immutable sheet ID,
// the published title, and ZZ1 still answer.
// Then either promote the staging tab onto the published name
// (the old tab becomes a recovery title)
// or delete a still-hidden leftover by immutable ID.
// When Google fails, say what kind of failure it is
// in canned words — never the cell values.
// Do not create the workbook. Do not trash a file.
// Do not claim a run. Do not sync the Master Sheet.

export const theRawWriteOptionWeAlwaysSend = "RAW" as const
export const theWriteBatchRowCap = 1000
export const REPORTING_VALUE_INPUT_OPTION = theRawWriteOptionWeAlwaysSend
export const REPORTING_WRITE_BATCH_ROWS = theWriteBatchRowCap

// ── 1. Create a hidden staging tab and stamp both cells ─

export async function createAHiddenStagingTabAndStampThisDestinationAndThisRun(input)
  // listTheTabs; same title → collision
  // addSheet { title, hidden: true }
  // stampZz1AndZy1OnThisTab role snapshot | staging
  // do not prove after the stamp

export const createHiddenStagingTab =
  createAHiddenStagingTabAndStampThisDestinationAndThisRun

export async function stampZz1AndZy1OnThisTab(input)
export const writeOwnershipAndRunMarkers = stampZz1AndZy1OnThisTab

// ── 2. Paint RAW cells, then say whether they still match ─

export function refuseAWriteThatIsEmptyTooTallRaggedOrFormulaShaped(values)
export const assertBoundedWrite =
  refuseAWriteThatIsEmptyTooTallRaggedOrFormulaShaped

export async function paintThisReportAsRawCellsOnThisTab(input)
  // ask refuseAWriteThatIsEmptyTooTallRaggedOrFormulaShaped
  // ask leftover a1Range
  // values.update RAW

export const writeValuesRaw = paintThisReportAsRawCellsOnThisTab

export async function readTheseCellsBackAsLiterals(input)
export const readValues = readTheseCellsBackAsLiterals

export async function sayWhetherThisRangeStillMatchesWhatWeWrote(input)
  // ask readTheseCellsBackAsLiterals
  // ask sayWhetherTheseTwoRangesAreTheSameLiterals

export const verifyRange = sayWhetherThisRangeStillMatchesWhatWeWrote

// ── 3. Prove both stamps — or find the tab that still answers ─

export async function proveThisTabIsStillThisDestinationsAndThisRuns(input)
  // batchGet ZZ1 + ZY1
  // leftover ownership miss / leftover run miss throw

export const verifyOwnershipAndRunMarkers =
  proveThisTabIsStillThisDestinationsAndThisRuns

export async function findTheTabThatStillAnswersBothStamps(input)
  // walk listTheTabs; any throw continues; none → null

export const findSheetByRunMarker = findTheTabThatStillAnswersBothStamps

// ── 4. Prove the published tab — or ZZ1 after the title changed ─

export async function proveThePublishedTabIsStillOursByImmutableIdAndTitleAndZz1(input)
  // listTheTabs by immutableSheetId + title + ZZ1 only

export const verifyPublishedManagedTab =
  proveThePublishedTabIsStillOursByImmutableIdAndTitleAndZz1

export async function proveZz1IsStillThisDestinationsAfterTheTitleChanged(input)
  // listTheTabs by sheetId + ZZ1 only

export const verifyOwnershipMarkerBySheetId =
  proveZz1IsStillThisDestinationsAfterTheTitleChanged

// ── 5. Promote onto the published name — or hide / delete by id ─

export async function promoteTheStagingTabOntoThePublishedName(input)
  // old sheetId → recoveryTitle
  // staging sheetId → publishedTitle + hidden false
  // do not rewrite ZY1; do not delete the old tab

export const promoteStagingTab = promoteTheStagingTabOntoThePublishedName

export async function deleteThisStillHiddenTabByImmutableId(input)
export const deleteSheet = deleteThisStillHiddenTabByImmutableId

export async function hideOrShowThisTabByImmutableId(input)
export const hideSheet = hideOrShowThisTabByImmutableId

export async function listTheTabs(spreadsheetId)
export const listSheets = listTheTabs

export async function openAnOauthBackedReportingSheetsAdapter()
export const createReportingSheetsAdapter =
  openAnOauthBackedReportingSheetsAdapter
```

Read the leftover snapshot create path out loud: *Leftover pack already has a run id and a destination id. Snapshot without a marked tab **asks** leftover `createAHiddenStagingTabAndStampThisDestinationAndThisRun` titled `report_<runId-8>`, then leftover `hideOrShowThisTabByImmutableId({ hidden: false })`. This file stamped `ZZ1` and `ZY1`. Leftover Drive leftover `createSpreadsheet` already happened. This file never created the workbook.*

Read the leftover replace-tab create path out loud: *Leftover pack **asks** leftover `proveThePublishedTabIsStillOursByImmutableIdAndTitleAndZz1` on the managed tab before staging. Then leftover `findTheTabThatStillAnswersBothStamps`. A miss **asks** leftover `createAHiddenStagingTabAndStampThisDestinationAndThisRun` titled leftover `stagingTabTitle`. The new tab stays hidden.*

Read the leftover write / leftover replay path out loud: *Leftover `writeBoundedReportingBatch` **asks** leftover `paintThisReportAsRawCellsOnThisTab`. A retryable catch **asks** leftover `sayWhetherThisRangeStillMatchesWhatWeWrote` on the same write bag. A match returns `replay:<title>:<startRow>` without a second write. A miss leftover **asks** leftover paint again.*

Read the leftover promote path out loud: *Leftover pack leftover **asks** leftover `proveZz1IsStillThisDestinationsAfterTheTitleChanged` on the old tab, leftover `proveThisTabIsStillThisDestinationsAndThisRuns` on staging, then leftover `promoteTheStagingTabOntoThePublishedName`. The old tab becomes leftover `recoveryTitle`. The staging tab becomes the published title and visible. `ZY1` still says leftover `staging`. This file did not delete the old tab.*

Read the leftover janitor path out loud: *Leftover replace-tab leftover janitor leftover **asks** leftover `listTheTabs`, refuses a visible staging tab, leftover **asks** leftover `proveThisTabIsStillThisDestinationsAndThisRuns`, then leftover `deleteThisStillHiddenTabByImmutableId`. Leftover snapshot leftover janitor leftover **asks** leftover Drive leftover `trashFile`, not this file.*

That is the operation. `writeValuesRaw` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **`hideSheet` is used to unhide.** Snapshot pack calls `hideSheet({ hidden: false })` after create already wrote `hidden: true`. Do not silently start `createHiddenStagingTab` writing `hidden: false` for snapshot so "the create is honest."

2. **Promote never rewrites `ZY1` to `published`.** Create stamps role `staging` or `snapshot`. After promote the published title still has `role: "staging"` on `ZY1`. Tests call `writeOwnershipAndRunMarkers` with `published`. Do not silently rewrite `ZY1` at promote so "published tabs say published."

3. **`findSheetByRunMarker` swallows every throw.** A wrapped quota `IntegrationError` during the walk looks like "no tab found." Pack then asks create and can collide on the same title. Do not silently start find rethrowing `IntegrationError` so "quota is honest."

4. **A failed marker write after `addSheet` leaves an orphan hidden tab.** Create does not prove after the stamp. The next same-title create throws collision. Do not silently start create deleting that tab so "the create is atomic."

5. **Double sanitize can flip unknown into retryable.** `writeValuesRaw` wraps an unknown error as `IntegrationError` `statusCode` 502. Pack then asks leftover sanitize on that wrap. A non-retryable unknown can look retryable on the second pass. Do not silently stop wrapping so "retryable stays honest."

6. **`renameSheet` has no pack / worker / janitor caller.** Promote owns the two renames in one `batchUpdate`. Tests call `renameSheet` to set up a human title. Do not silently start pack asking `renameSheet` so "the export is used."

7. **Destination desk `listSheets` is a different client.** `SheetsWorkbookClient` lists tabs for capacity and managed-tab prove. This adapter lists tabs for staging / run stamps. Do not silently merge those clients so "one listSheets owns the company."

8. **This file never creates or trashes a workbook.** Snapshot create asks leftover Drive `createSpreadsheet`. Snapshot janitor asks leftover Drive `trashFile`. Do not silently start `files.create` from this file so "Sheets owns the workbook."

9. **`assertBoundedWrite` is the formula fence, not leftover paint.** `serializeLiteralCell` allows `"=SUM(A1:A2)"`. Write refuses it. Do not silently move the fence into leftover paint so "serialize owns RAW."

10. **Leave sibling modules alone.** Leftover pack / leftover worker / leftover janitor / leftover inspect stay recommended. Leftover Drive write stays unvisited. Leftover live harness stays unvisited. Do not open `google/reportingDriveAdapter.ts` this pass.

## Testing

The **interface** is the test surface. Existing asserts: leftover `reportingDelivery.test.ts` RAW write / replay through leftover pack; `assertBoundedWrite([["=SUM(A1:A2)"]])` throws `/formula/`; an unmarked human tab fails leftover `verifyOwnershipAndRunMarkers` `/ownership marker|run marker/`. Leftover `reportingDelivery.regressions.test.ts` leftover `verifyPublishedManagedTab` wrong id throws `/immutable ID/`; leftover `writeOwnershipAndRunMarkers` role `published` plus leftover `promoteStagingTab` through leftover fake. No "this file never calls `files.create`" proof is locked. No "find swallows quota" proof is locked. No "promote does not rewrite `ZY1`" proof is locked on this file.

Add proofs at the new names (later implementer; not this Cloud pass):

- create: same title throws collision; addSheet is hidden; role is `snapshot` or `staging`; no prove after stamp
- paint: empty / >1000 rows / ragged / `"=SUM"` throw; `valueInputOption` is `RAW`; range uses leftover `a1Range`
- read-back: `""` becomes `null`; leftover `verifyRange` match is true on the same write bag
- both-stamp prove: matching `ZZ1` + `ZY1` returns `{ ownershipMatched: true, runMatched: true }`; ownership miss / run miss throw
- find: matching tab returns the ref; no match returns `null`
- published prove: wrong id throws `/immutable ID/`; title miss throws; prove is `ZZ1` only
- by-sheet-id: title may have changed; prove is `ZZ1` only
- promote: old title becomes recovery; staging becomes published and visible; `ZY1` is not rewritten; old tab is not deleted
- janitor delete: still-hidden + both stamps then `deleteSheet` by `sheetId`
- never Drive: `files.create` / `trashFile` are not called from this file
- leftover RAW: `REPORTING_VALUE_INPUT_OPTION` stays `"RAW"`; leftover batch cap stays `1000`

Do not add helper-unit tests for leftover `normalizeCell` / leftover `wrapProvider` / leftover `normalizeReadValues`. Do not boot leftover live Google, leftover destination desk, leftover promote, or leftover janitor. Do not replace leftover pack tests with this file so "one test owns both stories." Do not assert leftover Drive `trashFile` categories as if they were leftover `deleteSheet`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, leftover `src/models/ReportingRun.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingSheetsService` class or a `create.ts` / `write.ts` / `verify.ts` / `promote.ts` / `delete.ts` / `update.ts` split.
- I would not invent a second leftover Google-write adapter beside leftover `writeValuesRaw`.
- I would not invent a second leftover prove adapter beside leftover `verifyOwnershipAndRunMarkers`.
- I would not invent a second leftover destination `listSheets` beside leftover `SheetsWorkbookClient`.
- I would not pull leftover pack resume, leftover worker claim, leftover Drive create / trash, leftover destination desk, leftover stamp serialize, leftover paint serialize, leftover canned sentences, leftover live inject, or leftover fake into this file.
- I would not silently start leftover `createHiddenStagingTab` writing `hidden: false` for snapshot.
- I would not silently rewrite leftover `ZY1` at leftover promote so leftover role becomes `published`.
- I would not silently start leftover find rethrowing leftover wrap.
- I would not silently merge leftover `SheetsWorkbookClient` into this file.
- I would not silently start leftover `files.create` or leftover `trashFile` from this file.
- I would not open leftover `google/reportingDriveAdapter.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
