# Stamp This Run On Cell ZY1, Then Only Call The Tab This Run's When That Same Run And Destination Still Answer — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 27 of this service — `google/runMarker.ts`
- Remaining in this service: `google/driveAppProperties.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/google/runMarker.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Knowledge never names this file, `ZY1`, `vantage_reporting_run`, `serializeReportingRunMarker`, `runMarkerMatches`, `strategy`, or `role` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover destination stamp: [`reporting-ownership-marker.md`](reporting-ownership-marker.md) (`ZZ1` nest `vantage_reporting_ownership`; `ownershipMarkerMatchesDestination` is destination + `managed: true` — leftover prove never **asks** `run_id`). Distinct from leftover unvisited Drive file stamp: `google/driveAppProperties.ts` (`vantage_reporting_run_id` / destination / role `snapshot` | `staging_workbook` on Drive `appProperties`; leftover trash **asks** `driveAppPropertiesMatchRun` — that match **does** require version + role; cell role vocab is `staging` | `snapshot` | `published`). Distinct from leftover Sheets write / prove **adapter**: `google/reportingSheetsAdapter.ts` (`writeOwnershipAndRunMarkers` **asks** leftover ownership serialize onto `ZZ1` **and** this serialize onto `ZY1` in one `batchUpdate`; `verifyOwnershipAndRunMarkers` **asks** leftover ownership match first, then `runMarkerMatches`; `createHiddenStagingTab` **asks** leftover write with role `snapshot` or `staging`; `findSheetByRunMarker` **asks** both proofs per title — the name says run, the prove is both; `verifyPublishedManagedTab` / `verifyOwnershipMarkerBySheetId` **ask** `ZZ1` only). Distinct from already-recommended leftover pack / resume / verify contents: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (`createOrResumeDeliveryArtifact` **asks** `findSheetByRunMarker` then `createHiddenStagingTab`; `verifyStagingContents` **asks** `verifyOwnershipAndRunMarkers` before leftover header labels; leftover promote **asks** leftover verify on the staging title then again on the published title after rename — leftover promote never imports this file). Distinct from already-recommended leftover worker complete: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (post-promote **asks** `verifyOwnershipMarkerBySheetId` on the old id then `verifyOwnershipAndRunMarkers` on the published title — leftover worker never imports this file). Distinct from already-recommended leftover cleanup: [`reporting-cleanup.md`](reporting-cleanup.md) (`positivelyMarkedForCleanup` **asks** `runMarkerMatches` only and **ignores** `ownershipRaw`; leftover janitor never **asks** that fold — replace-tab delete **asks** `verifyOwnershipAndRunMarkers`). Distinct from already-recommended leftover paint: [`reporting-cell-serialization.md`](reporting-cell-serialization.md) (`quoteSheetTitle` names `ZY1`; this file never **asks** `a1Range`). Distinct from leftover test fake: `google/fakeReportingGoogle.ts` (**asks** leftover serialize / leftover match; `void REPORTING_RUN_MARKER_CELL` then writes `cellKey(1, 701)`). Distinct from leftover `google/index.ts` (barrel re-exports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `google/reportingSheetsAdapter.ts` (**asks** `serializeReportingRunMarker` + `REPORTING_RUN_MARKER_CELL` on leftover write; `runMarkerMatches` on leftover verify — never **asks** `parseReportingRunMarker` or `buildReportingRunMarker`). Leftover `google/fakeReportingGoogle.ts` (**asks** leftover serialize + leftover match; the cell constant is `void`). Leftover `cleanup.ts` (**asks** `runMarkerMatches` from `positivelyMarkedForCleanup` — leftover janitor does not import this file). Leftover `google/index.ts` re-exports everything. Tests: leftover `reportingDelivery.test.ts` **asks** leftover serialize as fixture `runRaw` for `positivelyMarkedForCleanup` true / `"not a marker"` false. Leftover `reportingDelivery.regressions.test.ts` `void serializeReportingRunMarker` once next to “Sheet-cell markers alone are insufficient — Drive appProperties required.” Leftover `reporting.test.ts` does not import this file. **No runtime caller** of `buildReportingRunMarker` except leftover serialize. **No runtime caller** of `parseReportingRunMarker` except leftover match. **No runtime write** of `role: "published"` — only leftover tests **ask** `writeOwnershipAndRunMarkers` with that role; `createHiddenStagingTab` stamps `snapshot` or `staging`.
- Seams callers need: stamp-this-run-as-cell-text (`serializeReportingRunMarker`) vs read-the-cell-or-refuse (`parseReportingRunMarker`) vs say-this-cell-is-still-this-run’s (`runMarkerMatches`). The stamp / prove **seam** exists because leftover staging create **asks** leftover serialize; leftover resume / leftover verify contents / leftover promote / leftover janitor **ask** leftover match through `verifyOwnershipAndRunMarkers` — Google write stays in the leftover adapter. The run-cell / ownership-cell **seam** exists because `ZY1` names run + destination + strategy + role; `ZZ1` names destination + `managed: true`. The JSON-cell / Drive-appProperties **seam** exists because leftover trash **asks** leftover Drive properties, not `ZY1`. The written-strategy-and-role / proven-run-and-destination **seam** exists because leftover serialize writes all four fields; leftover match **asks** `run_id` + `destination_id` only. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**. There is no `ZZ1` stamp **seam**.
- Split later (only if the file outgrows one sitting): this ~79-line file is one sitting if you read it as stamp this run on cell ZY1, then only call the tab this run's when that same run and destination still answer. Do **not** split into `build.ts` / `parse.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover Sheets write, leftover ownership stamp, leftover Drive appProperties, leftover pack resume, leftover promote, leftover cleanup, or leftover paint here so “one marker file owns the company.” If it later splits: `stampThisRunOnCellZy1.ts` / `sayWhetherThisCellIsStillThisRuns.ts` only as later story files, never CRUD.

`buildReportingRunMarker` / `serializeReportingRunMarker` / `parseReportingRunMarker` / `runMarkerMatches` are executor mechanics. The owner question is: *When we create a hidden staging tab, put a JSON stamp in ZY1 that names this run, this destination, this strategy, and this role. Later, only call the tab this run's if that cell still parses as version 1 and still names the same run id and destination id. Strategy and role ride along on the stamp. They are not the prove. A human title is not enough. A destination stamp in ZZ1 is a different stamp. Drive appProperties are a different proof. After promote, the same ZY1 cell is still this run's even if the tab title is now the published name and the written role is still staging. Do not write Google from this file. Do not delete a tab from this file. Do not trash a workbook from this file.*

Already-recommended leftover ownership stamp, leftover paint, leftover pack / resume, leftover promote, leftover worker complete, leftover cleanup already live in other **modules**. Leftover Sheets write / leftover Drive appProperties stay leftover. Do not pull those in.

## What this file actually does

Three operations of one “stamp this run on cell ZY1, then only call the tab this run's when that same run and destination still answer” story, not “a run-marker helper,” and not leftover Sheets write or leftover Drive trash:

1. **Stamp this run as ours for cell ZY1** — `serializeReportingRunMarker` / `buildReportingRunMarker`. JSON `{ vantage_reporting_run: { version: 1, run_id, destination_id, strategy: "replace_tab" | "snapshot", role: "staging" | "snapshot" | "published" } }`. Ids are not trimmed. Leftover `createHiddenStagingTab` **asks** leftover serialize with role `snapshot` when strategy is snapshot, else `staging`. Leftover Sheets write **asks** this next to leftover `ZZ1`. `buildReportingRunMarker` is a beat of leftover serialize; it has no other caller.

2. **Read the cell as our run stamp or refuse** — `parseReportingRunMarker`. Non-string, blank, bad JSON, missing nest, `version !== 1`, empty / whitespace `run_id` or `destination_id`, strategy not `replace_tab` / `snapshot`, or role not `staging` / `snapshot` / `published` → `null`. Extra JSON keys are not refused. Runtime leftover prove **asks** leftover match, not leftover parse.

3. **Say whether this cell is still this run's for this destination** — `runMarkerMatches`. Leftover parse, then `run_id ===` argument **and** `destination_id ===` argument. Strategy and role are not compared. Other run → `false`. Unreadable cell → `false`. Leftover Sheets verify **asks** this on `ZY1` after leftover `ZZ1`. Leftover cleanup fold **asks** this only. This file does not throw. This file does not list tabs.

`REPORTING_RUN_MARKER_VERSION` and `REPORTING_RUN_MARKER_CELL` are the contract leftover adapters already share (`1`, `ZY1`). They are not extra owner operations. Do not teach leftover destination desk to persist a run-marker version — leftover desk persists `ownership_marker_version` only.

## Organization

Keep one file. This is the screenplay for “stamp this run on cell ZY1, then only call the tab this run's when that same run and destination still answer.” Leftover Sheets write / verify, leftover ownership stamp, leftover Drive appProperties, leftover pack resume, leftover promote already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingRunMarkerService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover Google-write **adapter** beside leftover `writeOwnershipAndRunMarkers`. Do not invent a second leftover prove **adapter** beside leftover `runMarkerMatches`.

Do not split leftover stamp / leftover parse / leftover match into CRUD files. Leftover stamp stays with leftover prove because leftover create and leftover verify must agree on `ZY1`. Do not move leftover `ZZ1` into this file so “one marker file owns both cells.” Do not move leftover Drive `appProperties` into this file so “every run proof lives together.” Do not start leftover `deleteSheet` or leftover `trashFile` from this file.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `serializeReportingRunMarker` | `stampThisRunOnCellZy1` | leftover Sheets write + leftover fake + leftover tests |
| `buildReportingRunMarker` | `buildThisRunStamp` | beat of leftover stamp; keep until leftover serialize is the only name |
| `parseReportingRunMarker` | `readThisCellAsOurRunStampOrRefuse` | beat of leftover prove; no runtime caller except leftover match |
| `runMarkerMatches` | `thisCellIsStillThisRunsForThisDestination` | leftover Sheets verify + leftover fake + leftover cleanup fold |
| `REPORTING_RUN_MARKER_VERSION` | `theRunMarkerVersionWeWrite` | nest `version` `1` |
| `REPORTING_RUN_MARKER_CELL` | `theRunMarkerCell` | `ZY1` leftover Sheets ranges |
| `ReportingRunMarkerV1` | `OurRunStamp` | JSON nest `vantage_reporting_run` |

Keep the old names as one-line aliases until leftover `google/reportingSheetsAdapter.ts`, leftover `google/fakeReportingGoogle.ts`, leftover `cleanup.ts`, leftover `reportingDelivery.test.ts`, and leftover `reportingDelivery.regressions.test.ts` migrate. Do not make leftover janitor learn `thisCellIsStillThisRunsForThisDestination` instead of leftover `verifyOwnershipAndRunMarkers`. Do not make leftover Drive trash **ask** this cell so “one run proof owns trash.” Do not persist a new run-marker version string in this rename.

**No class for the workflow.** The type that *does* earn a name is the nest leftover parse already requires:

```ts
type OurRunStamp = {
  vantage_reporting_run: {
    version: 1
    run_id: string
    destination_id: string
    strategy: "replace_tab" | "snapshot"
    role: "staging" | "snapshot" | "published"
  }
}
```

That is the handoff from “leftover staging create has a run id” to “leftover verify may **ask** `thisCellIsStillThisRunsForThisDestination`.” Do **not** put `managed: true` on this type. Do **not** put leftover Drive `appProperties` on this type. Do **not** put leftover `ownership_marker_version` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// runMarker.ts
// We are about to create a hidden staging tab.
// Put a JSON stamp in ZY1 that names this run,
// this destination, this strategy, and this role.
// Later, only call the tab this run's if that cell still
// parses as version 1 and still names the same run id
// and destination id.
// Strategy and role ride along. They are not the prove.
// A human title is not enough.
// A destination stamp in ZZ1 is a different stamp.
// Drive appProperties are a different proof.
// After promote, the same ZY1 cell is still this run's
// even if the tab title is now the published name.
// Do not write Google. Do not delete a tab. Do not trash a workbook.

export const theRunMarkerVersionWeWrite = 1
export const theRunMarkerCell = "ZY1"
export const REPORTING_RUN_MARKER_VERSION = theRunMarkerVersionWeWrite
export const REPORTING_RUN_MARKER_CELL = theRunMarkerCell

// ── 1. Stamp this run on ZY1 ─────────────────────────────

export function stampThisRunOnCellZy1(input)
  // nest vantage_reporting_run
  // version 1
  // run id + destination id as given — not trimmed
  // strategy replace_tab | snapshot
  // role staging | snapshot | published

export const serializeReportingRunMarker = stampThisRunOnCellZy1

export function buildThisRunStamp(input)
export const buildReportingRunMarker = buildThisRunStamp

// ── 2. Read the cell or refuse ───────────────────────────

export function readThisCellAsOurRunStampOrRefuse(raw)
  // non-string / blank / bad JSON → null
  // version !== 1 / empty ids → null
  // unknown strategy / role → null

export const parseReportingRunMarker = readThisCellAsOurRunStampOrRefuse

// ── 3. Say whether this cell is still this run's ─────────

export function thisCellIsStillThisRunsForThisDestination(raw, runId, destinationId)
  // parse, then run_id === and destination_id ===
  // strategy and role are not compared

export const runMarkerMatches = thisCellIsStillThisRunsForThisDestination
```

Read the leftover staging create path out loud: *Leftover pack already has a run id and a destination id. `createHiddenStagingTab` asks `stampThisRunOnCellZy1` with role snapshot or staging and writes that JSON RAW onto `{tabName}!ZY1` next to leftover `ZZ1`. This file never called Google. Leftover create does not ask `thisCellIsStillThisRunsForThisDestination` after the write.*

Read the leftover resume / leftover verify path out loud: *`findSheetByRunMarker` walks titles and asks both leftover `ZZ1` and leftover `ZY1`. Leftover verify contents and leftover promote ask leftover `verifyOwnershipAndRunMarkers`. Leftover match asks `thisCellIsStillThisRunsForThisDestination`. A missing nest, a wrong version, another run id, or another destination id is not this run's. Strategy and role may differ and leftover match still returns true. This file returns false. Leftover adapter throws “Reporting run marker mismatch.”*

Read the leftover cleanup path out loud: *Acceptance 17 asks leftover `positivelyMarkedForCleanup`, which asks `thisCellIsStillThisRunsForThisDestination` and ignores leftover `ownershipRaw`. Leftover janitor never asks that fold. Replace-tab delete asks both proofs then leftover `deleteSheet` by id.*

That is the operation. `serializeReportingRunMarker` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **Leftover match ignores strategy and role.** Leftover serialize writes both. Leftover parse refuses unknown values. `runMarkerMatches` never compares them. Do not silently start matching role so “the stamp is honest.”

2. **Runtime never stamps `role: "published"`.** `createHiddenStagingTab` writes `snapshot` or `staging`. Leftover tests write `published` through leftover `writeOwnershipAndRunMarkers`. After leftover promote the cell still says `staging` on the published title. Do not silently rewrite `ZY1` at leftover promote so “published tabs say published.”

3. **Leftover fake voids the cell constant.** Leftover `fakeReportingGoogle.ts` does `void REPORTING_RUN_MARKER_CELL` then writes `cellKey(1, 701)`. Do not silently start the fake asking `theRunMarkerCell` so “the fake is honest” — leftover column math stays leftover fake.

4. **Leftover parse allows extra JSON keys.** `JSON.parse` plus field checks. `{ vantage_reporting_run: { …, extra: 1 } }` still matches when ids agree. Do not silently refuse extra keys so “the type is closed.”

5. **Leftover ids are not one fold.** Leftover serialize does not trim. Leftover parse requires `run_id.trim()` and `destination_id.trim()` truthy, then leftover match is `===` the arguments. `" run "` can parse and fail match against `"run"`. Do not silently trim both so “ids are canonical.”

6. **Leftover cleanup ignores `ownershipRaw`.** `positivelyMarkedForCleanup` **asks** this file only. Leftover janitor **asks** leftover `verifyOwnershipAndRunMarkers`. Do not silently start leftover janitor asking leftover match from this file so “run is checked twice.”

7. **`findSheetByRunMarker` proves both cells.** Leftover adapter walks titles and **asks** leftover `verifyOwnershipAndRunMarkers`. A tab with a matching `ZY1` and a broken `ZZ1` is not found. Do not silently teach leftover match to scan tabs so “the name owns the walk.”

8. **Leftover Drive role vocab is a different pair.** Cell role is `staging` | `snapshot` | `published`. Drive `appProperties` role is `snapshot` | `staging_workbook`. Leftover Drive match requires version + role. This leftover match does not. Do not silently merge those proofs so “one run stamp owns trash.”

9. **Version 1 is the only accepted stamp.** Leftover parse refuses `version !== 1`. There is no v2 reader. Do not silently accept future versions so “the type is ready.”

10. **Leave sibling modules alone.** Leftover Sheets write / leftover verify stay in leftover `google/reportingSheetsAdapter.ts`. Leftover ownership stamp stays leftover. Leftover Drive appProperties stay leftover unvisited. Leftover pack / leftover promote stay leftover. Leftover cleanup stays leftover. Do not open unvisited leftover `google/driveAppProperties.ts` this pass.

## Testing

The **interface** is the test surface. Existing asserts: leftover `positivelyMarkedForCleanup` with leftover serialize is `true`; leftover `"not a marker"` is `false`; leftover regressions `void serializeReportingRunMarker` next to leftover Drive-required trash. Leftover `verifyOwnershipAndRunMarkers` accepts a matching pair and throws “Reporting run marker mismatch.” No empty-cell refuse is locked on this file. No `version: 2` refuse is locked. No “strategy / role may differ and leftover match still returns true” proof is locked. No “this file never writes Google” proof is locked.

Add proofs at the new names (later implementer; not this Cloud pass):

- stamp: JSON nest is `vantage_reporting_run`; `version` is `1`; run id and destination id are as given; strategy and role are as given
- read or refuse: non-string / blank / bad JSON → `null`; `version !== 1` → `null`; whitespace-only id → `null`; unknown strategy / role → `null`
- still this run's: matching run + destination `true`; other run `false`; other destination `false`; unreadable cell `false`
- written vs proven: stamp `role: "staging"` then leftover match without a role argument still `true`; stamp `strategy: "replace_tab"` then leftover match still `true`
- never write Google: `values.update` / `batchUpdate` / `deleteSheet` / `trashFile` are not called from this file
- never leftover ownership: `vantage_reporting_ownership` is not on this stamp
- never leftover Drive appProperties: `vantage_reporting_run_id` is not on this stamp
- leftover version: `REPORTING_RUN_MARKER_VERSION` stays `1`; leftover cell stays `ZY1`

Do not add helper-unit tests for leftover `buildThisRunStamp`. Do not boot leftover live Google, leftover destination desk, leftover promote, or leftover janitor. Do not replace leftover `verifyOwnershipAndRunMarkers` tests with this file so “one test owns both stories.” Do not assert leftover Drive `driveAppPropertiesMatchRun` categories as if they were leftover `thisCellIsStillThisRunsForThisDestination`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, leftover `src/models/ReportingDestination.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingRunMarkerService` class or a `create.ts` / `update.ts` / `delete.ts` / `build.ts` / `parse.ts` split.
- I would not invent a second leftover Google-write **adapter** beside leftover `writeOwnershipAndRunMarkers`.
- I would not pull leftover Sheets leftover verify, leftover ownership leftover stamp, leftover Drive leftover appProperties, leftover pack leftover resume, leftover promote, leftover cleanup, or leftover paint into this file.
- I would not silently merge leftover `ZZ1` into this file.
- I would not silently start leftover match comparing leftover strategy or leftover role.
- I would not silently rewrite leftover `ZY1` at leftover promote so leftover role becomes `published`.
- I would not silently trim leftover ids so leftover parse and leftover match agree.
- I would not silently refuse leftover extra JSON keys.
- I would not open unvisited leftover `google/driveAppProperties.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
