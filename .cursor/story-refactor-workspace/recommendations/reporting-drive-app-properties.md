# Stamp This Drive File As This Run's On AppProperties, Then Only Call The File This Run's When Those Same Properties Still Name This Run, This Destination, Version 1, And A Known Drive Role — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 28 of this service — `google/driveAppProperties.ts`
- Remaining in this service: `google/providerFailures.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/google/driveAppProperties.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Knowledge never names this file, `appProperties`, `vantage_reporting_run_id`, `vantage_reporting_destination_id`, `vantage_reporting_role`, `vantage_reporting_marker_version`, `buildReportingDriveAppProperties`, `driveAppPropertiesMatchRun`, `snapshot`, or `staging_workbook` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover destination stamp: [`reporting-ownership-marker.md`](reporting-ownership-marker.md) (`ZZ1` nest `vantage_reporting_ownership`; leftover prove is destination + `managed: true` — leftover prove never **asks** `run_id`). Distinct from already-recommended leftover run-cell stamp: [`reporting-run-marker.md`](reporting-run-marker.md) (`ZY1` nest `vantage_reporting_run`; leftover match **asks** run + destination only — strategy and cell role ride along, they are not the prove; cell role vocab is `staging` | `snapshot` | `published`). Distinct from leftover unvisited Drive write / trash **adapter**: `google/reportingDriveAdapter.ts` (`createSpreadsheet` **asks** leftover stamp onto Drive `appProperties`; `trashFile` **asks** `assertSafeToTrashReportingArtifact` then leftover `files.update` `{ trashed: true }` — leftover assert **asks** identity + spreadsheet MIME + `ownedByMe` + leftover `driveAppPropertiesMatchRun`; leftover throw is “Cleanup refused: Drive appProperties run marker did not match.”). Distinct from leftover unvisited Sheets write / prove **adapter**: `google/reportingSheetsAdapter.ts` (`writeOwnershipAndRunMarkers` **asks** leftover `ZZ1` + leftover `ZY1` in one leftover `batchUpdate`; leftover `verifyOwnershipAndRunMarkers` never **asks** leftover Drive properties). Distinct from already-recommended leftover pack / resume: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (`createOrResumeDeliveryArtifact` snapshot **asks** leftover `createSpreadsheet` with role `snapshot` — leftover replace-tab never **asks** leftover create; leftover pack never **asks** leftover match). Distinct from already-recommended leftover cleanup: [`reporting-cleanup.md`](reporting-cleanup.md) (snapshot janitor **asks** leftover `drive.trashFile` with leftover `expectedRunId` / leftover `expectedDestinationId` — leftover janitor never **asks** leftover match from this file; leftover replace-tab **asks** leftover Sheets prove + leftover `deleteSheet`, never leftover trash). Distinct from leftover unvisited live harness stamp: leftover `live/liveTestSecurity.ts` / leftover `live/liveTestCleanup.ts` **ask** leftover `buildLiveTestAppProperties` (`vantage_live_test` / leftover `vantage_live_test_run_tag` / role `harness_container` | `snapshot` | `staging_workbook`) — leftover live janitor **asks** leftover live stamp, not leftover `driveAppPropertiesMatchRun`. Distinct from leftover test fake: `google/fakeReportingGoogle.ts` (**asks** leftover stamp on leftover create; leftover trash **asks** leftover `assertSafeToTrashReportingArtifact`). Distinct from leftover `google/index.ts` (barrel re-exports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `google/reportingDriveAdapter.ts` (**asks** leftover `buildReportingDriveAppProperties` + leftover `REPORTING_SPREADSHEET_MIME_TYPE` on leftover create; leftover `driveAppPropertiesMatchRun` + leftover MIME on leftover `assertSafeToTrashReportingArtifact` — leftover trash never **asks** leftover stamp). Leftover `google/fakeReportingGoogle.ts` (**asks** leftover stamp + leftover MIME on leftover create; leftover trash **asks** leftover assert). Leftover `google/index.ts` re-exports everything. Tests: leftover `reportingDelivery.regressions.test.ts` **asks** leftover stamp as fixture `appProperties` for leftover `assertSafeToTrashReportingArtifact` accept matching / refuse empty `{}` `/appProperties/`; leftover **asks** leftover `driveAppPropertiesMatchRun` `true` on matching leftover stamp; leftover `void serializeReportingOwnershipMarker` + leftover `void serializeReportingRunMarker` next to “Sheet-cell markers alone are insufficient — Drive appProperties required.” Leftover `reportingDelivery.test.ts` **asks** leftover `createSpreadsheet` role `snapshot` then leftover `trashFile` — leftover test never **asks** leftover match from this file. Leftover `reporting.test.ts` does not import this file. Leftover `deliveryEngine.ts` **asks** leftover `createSpreadsheet`, not this file. Leftover `cleanup.ts` **asks** leftover `trashFile`, not this file. **No runtime caller** stamps role `staging_workbook` through leftover `buildReportingDriveAppProperties`. **No parse export.**
- Seams callers need: stamp-this-Drive-file-as-this-run’s (`buildReportingDriveAppProperties`) vs say-these-Drive-properties-are-still-this-run’s (`driveAppPropertiesMatchRun`). The stamp / write **seam** exists because leftover snapshot create **asks** leftover stamp; leftover Google `files.create` stays leftover Drive adapter. The prove / trash **seam** exists because leftover janitor **asks** leftover `trashFile`; leftover assert **asks** leftover match — leftover `files.update` `{ trashed: true }` stays leftover Drive adapter. The Drive-appProperties / JSON-cell **seam** exists because leftover trash **asks** leftover `vantage_reporting_run_id` on leftover Drive `appProperties`; leftover Sheets prove **asks** leftover `ZZ1` then leftover `ZY1`. The written-role / proven-known-role **seam** exists because leftover stamp writes role `snapshot` or `staging_workbook`; leftover match **asks** that role is one of those two — leftover match never **asks** an expected-role argument. The official-delivery stamp / live-harness stamp **seam** exists because leftover live **asks** leftover `buildLiveTestAppProperties`. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no parse **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**. There is no leftover `ZZ1` stamp **seam**. There is no leftover `ZY1` stamp **seam**.
- Split later (only if the file outgrows one sitting): this ~49-line file is one sitting if you read it as stamp this Drive file as this run's on appProperties, then only call the file this run's when those same properties still name this run, this destination, version 1, and a known Drive role. Do **not** split into `build.ts` / `match.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover Drive create, leftover Drive trash assert, leftover Sheets cells, leftover pack resume, leftover cleanup janitor, leftover live harness stamp, or leftover MIME check here so “one Drive-marker file owns the company.” If it later splits: `stampThisDriveFileAsThisRuns.ts` / `sayWhetherTheseDrivePropertiesAreStillThisRuns.ts` only as later story files, never CRUD.

`buildReportingDriveAppProperties` / `driveAppPropertiesMatchRun` are executor mechanics. The owner question is: *When we create a snapshot workbook, stamp Drive appProperties that name this run, this destination, version 1, and a Drive role. Later, only call the file this run's — and only let leftover trash proceed — if those properties still name the same run id and destination id, still say version 1, and still carry snapshot or staging_workbook. A human title is not enough. A destination stamp in ZZ1 is a different stamp. A run stamp in ZY1 is a different stamp. Sheet-cell markers alone are insufficient. Live-test harness tags are a different stamp. Do not write Google from this file. Do not trash a file from this file. Do not delete a tab from this file.*

Already-recommended leftover pack / resume, leftover cleanup janitor, leftover ownership stamp, leftover run-cell stamp already live in other **modules**. Leftover Drive write / leftover trash assert, leftover Sheets write, leftover live harness stamp stay leftover. Do not pull those in.

## What this file actually does

Two operations of one “stamp this Drive file as this run's on appProperties, then only call the file this run's when those same properties still answer” story, not “a Drive helper,” and not leftover Drive create or leftover trash:

1. **Stamp this Drive file as this run's** — `buildReportingDriveAppProperties`. Flat keys `vantage_reporting_run_id` / `vantage_reporting_destination_id` / `vantage_reporting_role` (`snapshot` | `staging_workbook`) / `vantage_reporting_marker_version` `"1"`. Ids are not trimmed. Leftover Drive create **asks** this onto leftover `files.create` `requestBody.appProperties`. Leftover fake create **asks** the same object into memory. Leftover pack snapshot **asks** leftover `createSpreadsheet` with role `snapshot`. Leftover replace-tab never **asks** leftover create.

2. **Say whether these Drive appProperties are still this run's for this destination** — `driveAppPropertiesMatchRun`. `appProperties` null / undefined → `{}`. Then `runId ===` argument **and** `destinationId ===` argument **and** `markerVersion ===` `"1"` **and** role is `snapshot` or `staging_workbook`. Other run → `false`. Other destination → `false`. Missing version / unknown role / empty `{}` → `false`. Role is not compared to a caller expected role — there is no such argument. Leftover Drive trash assert **asks** this after identity + MIME + `ownedByMe`. This file does not throw. This file does not list Drive files.

`REPORTING_DRIVE_APP_PROPERTY_KEYS`, `REPORTING_DRIVE_MARKER_VERSION`, and `REPORTING_SPREADSHEET_MIME_TYPE` are the contract leftover adapters already share (`vantage_reporting_*` keys, `"1"`, `application/vnd.google-apps.spreadsheet`). They are not extra owner operations. Do not teach leftover destination desk to persist a Drive marker version — leftover desk persists `ownership_marker_version` only.

## Organization

Keep one file. This is the screenplay for “stamp this Drive file as this run's on appProperties, then only call the file this run's when those same properties still name this run, this destination, version 1, and a known Drive role.” Leftover Drive write / leftover trash assert, leftover Sheets write / leftover prove, leftover pack resume, leftover cleanup janitor, leftover live harness stamp already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingDriveAppPropertiesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a parse export beside leftover match. Do not invent a second leftover Google-write **adapter** beside leftover `createSpreadsheet`. Do not invent a second leftover trash **adapter** beside leftover `trashFile`. Do not invent a second leftover prove **adapter** beside leftover `driveAppPropertiesMatchRun`.

Do not split leftover stamp / leftover match into CRUD files. Leftover stamp stays with leftover prove because leftover create and leftover trash must agree on the same keys. Do not move leftover `ZZ1` or leftover `ZY1` into this file so “one marker file owns every proof.” Do not move leftover `assertSafeToTrashReportingArtifact` into this file so “the prove owns trash.” Do not start leftover `files.create` or leftover `files.update` from this file.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildReportingDriveAppProperties` | `stampThisDriveFileAsThisRuns` | leftover Drive create + leftover fake create + leftover trash fixture tests |
| `driveAppPropertiesMatchRun` | `theseDrivePropertiesAreStillThisRunsForThisDestination` | leftover Drive trash assert + leftover regressions prove |
| `REPORTING_DRIVE_APP_PROPERTY_KEYS` | `theDriveStampKeysWeWrite` | flat `vantage_reporting_*` keys leftover adapters already share |
| `REPORTING_DRIVE_MARKER_VERSION` | `theDriveStampVersionWeWrite` | `"1"` on leftover `vantage_reporting_marker_version` |
| `REPORTING_SPREADSHEET_MIME_TYPE` | `theSpreadsheetMimeWeCreateAndRefuseToTrashWithout` | leftover Drive create + leftover trash MIME check |
| `ReportingDriveAppProperties` | `OurDriveFileStamp` | flat leftover `appProperties` stamp |

Keep the old names as one-line aliases until leftover `google/reportingDriveAdapter.ts`, leftover `google/fakeReportingGoogle.ts`, leftover `reportingDelivery.regressions.test.ts`, and leftover `reportingDelivery.test.ts` migrate. Do not make leftover janitor learn leftover `theseDrivePropertiesAreStillThisRunsForThisDestination` instead of leftover `trashFile`. Do not make leftover Sheets prove **ask** this file so “one run proof owns tabs.” Do not persist a new Drive marker version string in this rename.

**No class for the workflow.** The type that *does* earn a name is the flat stamp leftover create already writes:

```ts
type OurDriveFileStamp = {
  vantage_reporting_run_id: string
  vantage_reporting_destination_id: string
  vantage_reporting_role: "snapshot" | "staging_workbook"
  vantage_reporting_marker_version: "1"
}
```

That is the handoff from “leftover snapshot create has a run id” to “leftover trash may **ask** leftover `theseDrivePropertiesAreStillThisRunsForThisDestination`.” Do **not** put leftover `managed: true` on this type. Do **not** put leftover `vantage_reporting_run` JSON nest on this type. Do **not** put leftover `vantage_live_test` on this type. Do **not** put leftover cell role `staging` / leftover `published` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// driveAppProperties.ts
// We are about to create a snapshot workbook.
// Stamp Drive appProperties that name this run,
// this destination, version 1, and a Drive role.
// Later, only call the file this run's if those
// properties still name the same run id and destination id,
// still say version 1, and still carry snapshot
// or staging_workbook.
// A human title is not enough.
// A destination stamp in ZZ1 is a different stamp.
// A run stamp in ZY1 is a different stamp.
// Sheet-cell markers alone are insufficient.
// Live-test harness tags are a different stamp.
// Do not write Google. Do not trash a file. Do not delete a tab.

export const theDriveStampVersionWeWrite = "1"
export const theSpreadsheetMimeWeCreateAndRefuseToTrashWithout =
  "application/vnd.google-apps.spreadsheet"
export const REPORTING_DRIVE_MARKER_VERSION = theDriveStampVersionWeWrite
export const REPORTING_SPREADSHEET_MIME_TYPE =
  theSpreadsheetMimeWeCreateAndRefuseToTrashWithout
export const REPORTING_DRIVE_APP_PROPERTY_KEYS = {
  runId: "vantage_reporting_run_id",
  destinationId: "vantage_reporting_destination_id",
  role: "vantage_reporting_role",
  markerVersion: "vantage_reporting_marker_version",
} as const

// ── 1. Stamp this Drive file as this run's ───────────────

export function stampThisDriveFileAsThisRuns(input)
  // flat vantage_reporting_run_id / destination_id / role / marker_version
  // version "1"
  // run id + destination id as given — not trimmed
  // role snapshot | staging_workbook

export const buildReportingDriveAppProperties = stampThisDriveFileAsThisRuns

// ── 2. Say whether these Drive properties are still this run's ─

export function theseDrivePropertiesAreStillThisRunsForThisDestination(input)
  // null / undefined appProperties → {}
  // runId === and destinationId ===
  // marker_version === "1"
  // role is snapshot or staging_workbook
  // role is not compared to a caller expected role

export const driveAppPropertiesMatchRun =
  theseDrivePropertiesAreStillThisRunsForThisDestination
```

Read the leftover snapshot create path out loud: *Leftover pack already has a run id and a destination id. `createOrResumeDeliveryArtifact` **asks** leftover `createSpreadsheet` with role `snapshot`. Leftover Drive **asks** leftover `stampThisDriveFileAsThisRuns` and writes those keys onto Drive `appProperties`. This file never called Google. Leftover create does not **ask** leftover `theseDrivePropertiesAreStillThisRunsForThisDestination` after the write. Leftover replace-tab never **asks** leftover create.*

Read the leftover trash path out loud: *Leftover janitor **asks** leftover `trashFile` with the stored run id and destination id. Leftover assert **asks** leftover identity + leftover spreadsheet MIME + leftover `ownedByMe` + leftover `theseDrivePropertiesAreStillThisRunsForThisDestination`. Empty `{}` is not this run's. Another run id is not this run's. This file returns `false`. Leftover adapter throws “Cleanup refused: Drive appProperties run marker did not match.” Leftover Sheets leftover `ZZ1` / leftover `ZY1` were never read.*

That is the operation. `buildReportingDriveAppProperties` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **Match requires a known role, not the stamped role.** Stamp writes `snapshot` or `staging_workbook`. Match only asks that role is one of those two. Stamp `snapshot`, then change the property to `staging_workbook`, match still returns `true` for the same run and destination. Do not silently start matching an expected-role argument so "the stamp is honest."

2. **Runtime never stamps `staging_workbook` through this file.** Pack snapshot asks `createSpreadsheet` with role `snapshot`. Replace-tab never asks create. Live asks `buildLiveTestAppProperties`, not `stampThisDriveFileAsThisRuns`. Do not silently start pack stamping `staging_workbook` so "the type is used."

3. **There is no parse export.** Cell stamps ask parse then match. This file reads flat keys directly. Extra keys are not refused. Do not silently add parse so "every stamp has three verbs."

4. **Ids are not trimmed.** Stamp writes ids as given. Match is `===` the arguments. `" run "` can stamp and fail match against `"run"`. Do not silently trim both so "ids are canonical."

5. **Null appProperties become empty.** Match never throws. Trash assert throws after match returns `false`. Do not silently throw from this file so "the prove owns trash."

6. **MIME lives here because create and trash share it.** Drive adapter asks `REPORTING_SPREADSHEET_MIME_TYPE` on create and on trash mime check. Do not silently move the constant into `google/reportingDriveAdapter.ts` so "the adapter owns the mime."

7. **Cleanup never imports this file.** Janitor asks `drive.trashFile`. Regressions ask match next to "Sheet-cell markers alone are insufficient." Do not silently start the janitor asking match from this file so "run is checked twice."

8. **Drive role vocab is a different pair.** Cell role is `staging` | `snapshot` | `published`. Drive role is `snapshot` | `staging_workbook`. Cell match ignores role. Drive match requires a known role. Do not silently merge those proofs so "one run stamp owns trash."

9. **Version 1 is the only accepted stamp.** Match refuses any other `vantage_reporting_marker_version`. There is no v2 reader. Do not silently accept future versions so "the type is ready."

10. **Leave sibling modules alone.** Drive write and trash assert stay in `google/reportingDriveAdapter.ts`. Sheets write and prove stay there. Ownership stamp and run-cell stamp stay recommended. Pack and cleanup stay recommended. Live harness stamp stays unvisited. Do not open `google/providerFailures.ts` this pass.

## Testing

The **interface** is the test surface. Existing asserts: `assertSafeToTrashReportingArtifact` accepts a matching stamp; empty `{}` refuses `/appProperties/`; `driveAppPropertiesMatchRun` is `true` on a matching stamp; regressions void cell serialize next to "Sheet-cell markers alone are insufficient — Drive appProperties required." `reportingDelivery.test.ts` asks `createSpreadsheet` then `trashFile` through the fake. No other-run refuse is locked on this file. No `version: "2"` refuse is locked. No "role may be staging_workbook after a snapshot stamp and match still returns true" proof is locked. No "this file never writes Google" proof is locked.

Add proofs at the new names (later implementer; not this Cloud pass):

- stamp: keys are `vantage_reporting_run_id`, destination, role, and `vantage_reporting_marker_version`; version is `"1"`; ids are as given; role is as given
- still this run's: matching run + destination + version `"1"` + known role is `true`; other run `false`; other destination `false`; empty `{}` `false`; missing version `false`; unknown role `false`; null appProperties `false`
- written vs proven: stamp `role: "snapshot"` then match without a role argument still `true`; stamp `role: "staging_workbook"` then match still `true`
- never write Google: `files.create` / `files.update` / `trashFile` are not called from this file
- never cell stamps: `vantage_reporting_run` and `vantage_reporting_ownership` are not on this stamp
- never live harness tags: `vantage_live_test` is not on this stamp
- leftover version: `REPORTING_DRIVE_MARKER_VERSION` stays `"1"`; leftover MIME stays the spreadsheet mime

Do not add helper-unit tests for leftover `theDriveStampKeysWeWrite`. Do not boot leftover live Google, leftover destination desk, leftover promote, or leftover janitor. Do not replace leftover `assertSafeToTrashReportingArtifact` tests with this file so "one test owns both stories." Do not assert leftover cell `runMarkerMatches` categories as if they were leftover `theseDrivePropertiesAreStillThisRunsForThisDestination`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, leftover `src/models/ReportingDestination.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingDriveAppPropertiesService` class or a `create.ts` / `update.ts` / `delete.ts` / `build.ts` / `match.ts` split.
- I would not invent a second leftover Google-write adapter beside leftover `createSpreadsheet`.
- I would not invent a second leftover trash adapter beside leftover `trashFile`.
- I would not pull leftover Drive leftover assert, leftover Sheets leftover prove, leftover ownership leftover stamp, leftover run leftover cell leftover stamp, leftover pack leftover resume, leftover cleanup leftover janitor, or leftover live leftover harness leftover stamp into this file.
- I would not silently merge leftover `ZZ1` or leftover `ZY1` into this file.
- I would not silently start leftover match comparing a caller expected role.
- I would not silently start leftover pack leftover stamping leftover `staging_workbook`.
- I would not silently trim leftover ids so leftover stamp and leftover match agree.
- I would not silently add leftover parse.
- I would not open leftover `google/providerFailures.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
