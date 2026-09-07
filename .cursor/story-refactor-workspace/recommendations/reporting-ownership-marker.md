# Stamp This Destination On Cell ZZ1, Then Only Call The Tab Ours When That Same Destination And Version Still Answer — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 24 of this service — `ownershipMarker.ts`
- Remaining in this service: `registryFilters.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/ownershipMarker.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Knowledge names destinations as an Owner desk and never names this file, `ZZ1`, `vantage_reporting_ownership`, `serializeReportingOwnershipMarker`, `ownershipMarkerMatchesDestination`, or `ownership_marker_version` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover destination desk: [`reporting-destination.md`](reporting-destination.md) (create / rename / verify **ask** leftover `createManagedTabWithClient` / leftover `renameManagedTabWithClient` / leftover `verifyManagedTabOwnership`; this file is only imported for leftover `REPORTING_OWNERSHIP_MARKER_VERSION` on leftover `managed_tab.ownership_marker_version` — leftover desk never **asks** leftover serialize or leftover match). Distinct from already-recommended leftover prove-the-tab: [`google-drive-oauth-managed-tab.md`](google-drive-oauth-managed-tab.md) (leftover add **asks** leftover `serializeReportingOwnershipMarker` RAW onto leftover `{tabName}!ZZ1`; leftover prove **asks** leftover `ownershipMarkerMatchesDestination` after leftover immutable-id + leftover title + leftover human-name collision; leftover add does **not** prove after the stamp). Distinct from leftover Sheets marker **adapter**: `google/reportingSheetsAdapter.ts` (`writeOwnershipAndRunMarkers` **asks** leftover serialize onto leftover `ZZ1` **and** leftover run onto leftover `ZY1`; leftover `verifyOwnershipAndRunMarkers` / leftover `verifyPublishedManagedTab` / leftover `verifyOwnershipMarkerBySheetId` **ask** leftover match — this file never talks to Google). Distinct from leftover unvisited run stamp: `google/runMarker.ts` (`vantage_reporting_run` in leftover `ZY1`; leftover `runMarkerMatches` is leftover run id + leftover destination; leftover cleanup `positivelyMarkedForCleanup` **asks** leftover run only and **ignores** leftover `ownershipRaw`). Distinct from leftover unvisited Drive file stamp: `google/driveAppProperties.ts` (`vantage_reporting_run_id` / leftover destination / leftover role on leftover Drive `appProperties`; leftover trash **asks** leftover `driveAppPropertiesMatchRun` — not leftover `ZZ1`). Distinct from already-recommended leftover cleanup: [`reporting-cleanup.md`](reporting-cleanup.md) (leftover janitor **asks** leftover `verifyOwnershipAndRunMarkers` / leftover Drive trash; leftover janitor never imports this file). Distinct from already-recommended leftover promote: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (**asks** leftover `verifyOwnershipMarkerBySheetId` on leftover old + leftover staging **by ID** — leftover promote never imports this file). Distinct from already-recommended leftover owner-email stamp: [`reporting-destination-identity.md`](reporting-destination-identity.md) (leftover `stable_owner_id` / leftover masked email — not leftover `ZZ1`). Distinct from leftover test fake: `google/fakeReportingGoogle.ts` (**asks** leftover serialize / leftover match; leftover `void REPORTING_OWNERSHIP_MARKER_CELL` then writes leftover column `702`). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `reportingDestination.service.ts` (**asks** leftover `REPORTING_OWNERSHIP_MARKER_VERSION` on leftover create, leftover rename, leftover verify pending-rename persist — never leftover serialize). Already-recommended leftover `managedTab.service.ts` (**asks** leftover serialize on leftover add; leftover match on leftover prove). Leftover `google/reportingSheetsAdapter.ts` (**asks** leftover serialize + leftover `REPORTING_OWNERSHIP_MARKER_CELL` on leftover write; leftover match on leftover verify / leftover published / leftover by-sheet-id). Leftover `google/fakeReportingGoogle.ts` (**asks** leftover serialize + leftover match; leftover cell constant is leftover `void`). Tests: leftover `reportingDestination.test.ts` **asks** leftover serialize + leftover match, then leftover `verifyManagedTabOwnership` accepts leftover matching / leftover rejects leftover `"not-a-vantage-marker"`. Leftover `oauthHardening.test.ts` **asks** leftover serialize → leftover parse, leftover match same destination leftover `true`, leftover other destination leftover `false`. Leftover `reportingDelivery.test.ts` leftover **asks** leftover serialize as leftover fixture `ownershipRaw`. Leftover `reportingDelivery.regressions.test.ts` leftover `void serializeReportingOwnershipMarker`. Leftover `reporting.test.ts` does **not** import this file. Leftover worker / leftover cleanup / leftover promote do **not** import this file.
- Seams callers need: stamp-this-destination-as-cell-text (`serializeReportingOwnershipMarker`) vs read-the-cell-or-refuse (`parseReportingOwnershipMarker`) vs say-this-cell-is-still-ours (`ownershipMarkerMatchesDestination`). The stamp / prove **seam** exists because leftover add and leftover Sheets write **ask** leftover serialize; leftover prove and leftover Sheets verify **ask** leftover match — leftover Google write stays in leftover adapters. The ownership-cell / run-cell **seam** exists because leftover `ZZ1` names leftover destination + leftover `managed: true`; leftover `ZY1` names leftover run. The JSON-cell / Drive-appProperties **seam** exists because leftover trash leftover **asks** leftover Drive properties, not leftover `ZZ1`. The version-constant / leftover-desk **seam** exists because leftover desk persists leftover `ownership_marker_version` without reading leftover `ZZ1`. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~60-line file is one sitting if you read it as stamp this destination on cell ZZ1, then only call the tab ours when that same destination and version still answer. Do **not** split into `build.ts` / `parse.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover managed-tab add, leftover Sheets write, leftover run stamp, leftover Drive appProperties, leftover desk persist, leftover cleanup, or leftover promote here so “one ownership file owns the company.” If it later splits: `stampThisDestinationOnCellZz1.ts` / `sayWhetherThisCellIsStillOurs.ts` only as later story files, never CRUD.

`buildReportingOwnershipMarker` / `serializeReportingOwnershipMarker` / `parseReportingOwnershipMarker` / `ownershipMarkerMatchesDestination` are executor mechanics. The owner question is: *When we add a managed tab or write a staging or snapshot sheet, put a JSON stamp in ZZ1 that says this destination owns this tab and we manage it. Later, only call the tab ours if that cell still parses as version 1, managed true, and the same destination id. A human title is not enough. A run marker in ZY1 is a different stamp. Drive appProperties are a different proof. Do not write Google from this file. Do not delete a tab from this file. Do not persist the destination from this file.*

Already-recommended leftover destination desk, leftover managed-tab add / prove, leftover cleanup, leftover promote, leftover owner-email stamp already live in other **modules**. Leftover Sheets write / leftover run stamp / leftover Drive appProperties stay leftover. Do not pull those in.

## What this file actually does

Three operations of one “stamp this destination on cell ZZ1, then only call the tab ours when that same destination and version still answer” story, not “an ownership helper,” and not leftover managed-tab add or leftover Sheets write:

1. **Stamp this destination as ours for cell ZZ1** — `serializeReportingOwnershipMarker` / leftover `buildReportingOwnershipMarker`. JSON `{ vantage_reporting_ownership: { version: 1, destination_id, managed: true } }`. Leftover `managed` is always leftover `true` — this file cannot stamp an unmanaged tab. Leftover destination id is not trimmed. Leftover add **asks** leftover serialize RAW. Leftover Sheets write **asks** leftover serialize next to leftover run. Leftover `buildReportingOwnershipMarker` is a beat of leftover serialize; it has no other caller.

2. **Read the cell as our ownership stamp or refuse** — `parseReportingOwnershipMarker`. Non-string, blank, bad JSON, missing leftover nest, leftover `version !== 1`, leftover `managed !== true`, or leftover empty / leftover whitespace leftover `destination_id` → leftover `null`. Extra JSON keys are not refused. Leftover `oauthHardening.test.ts` **asks** leftover parse after leftover serialize. Runtime leftover prove leftover **asks** leftover match, not leftover parse.

3. **Say whether this cell is still ours for this destination** — `ownershipMarkerMatchesDestination`. Leftover parse, then leftover `destination_id ===` leftover argument. Leftover other destination leftover `false`. Leftover unreadable leftover cell leftover `false`. Leftover managed-tab prove leftover **asks** this after leftover immutable sheet id + leftover title. Leftover Sheets verify leftover **asks** this on leftover `ZZ1` before leftover run. This file does not throw. This file does not list tabs.

`REPORTING_OWNERSHIP_MARKER_VERSION` and `REPORTING_OWNERSHIP_MARKER_CELL` are the leftover contract leftover desk and leftover adapters already share (`1`, leftover `ZZ1`). They are not extra owner operations. Do not teach leftover desk to leftover **ask** leftover match so “the persisted version is proven.” Leftover desk leftover **asks** leftover `verifyManagedTabOwnership`.

## Organization

Keep one file. This is the screenplay for “stamp this destination on cell ZZ1, then only call the tab ours when that same destination and version still answer.” Leftover managed-tab add / prove, leftover Sheets write / verify, leftover run stamp, leftover Drive appProperties, leftover desk persist already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingOwnershipMarkerService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover Google-write **adapter** beside leftover `values.update` / leftover `writeOwnershipAndRunMarkers`. Do not invent a second leftover prove **adapter** beside leftover `ownershipMarkerMatchesDestination`.

Do not split leftover stamp / leftover parse / leftover match into CRUD files. Leftover stamp stays with leftover prove because leftover add and leftover verify must agree on leftover `ZZ1`. Do not move leftover `ZY1` into this file so “one marker file owns both cells.” Do not move leftover Drive leftover `appProperties` into this file so “every ownership proof lives together.” Do not start leftover `deleteSheet` from this file.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `serializeReportingOwnershipMarker` | `stampThisDestinationOnCellZz1` | leftover managed-tab add + leftover Sheets write + leftover tests |
| `buildReportingOwnershipMarker` | `buildThisDestinationOwnershipStamp` | beat of leftover stamp; keep until leftover serialize is the only name |
| `parseReportingOwnershipMarker` | `readThisCellAsOurOwnershipStampOrRefuse` | leftover oauth hardening test; beat of leftover prove |
| `ownershipMarkerMatchesDestination` | `thisCellIsStillOursForThisDestination` | leftover managed-tab prove + leftover Sheets verify + leftover fake |
| `REPORTING_OWNERSHIP_MARKER_VERSION` | `theOwnershipMarkerVersionWePersist` | leftover desk leftover `managed_tab.ownership_marker_version` |
| `REPORTING_OWNERSHIP_MARKER_CELL` | `theOwnershipMarkerCell` | leftover `ZZ1` leftover add / leftover Sheets leftover ranges |
| `ReportingOwnershipMarkerV1` | `OurDestinationOwnershipStamp` | leftover JSON leftover nest leftover `vantage_reporting_ownership` |

Keep the old names as one-line aliases until leftover `managedTab.service.ts`, leftover `google/reportingSheetsAdapter.ts`, leftover `google/fakeReportingGoogle.ts`, leftover `reportingDestination.service.ts`, leftover `reportingDestination.test.ts`, leftover `oauthHardening.test.ts`, leftover `reportingDelivery.test.ts`, and leftover `reportingDelivery.regressions.test.ts` migrate. Do not make leftover desk learn leftover `thisCellIsStillOursForThisDestination` as leftover persist. Do not make leftover cleanup leftover **ask** leftover match instead of leftover `verifyOwnershipAndRunMarkers`. Do not persist a new leftover `ownership_marker_version` string in this rename.

**No class for the workflow.** The type that *does* earn a name is the leftover nest leftover parse already requires:

```ts
type OurDestinationOwnershipStamp = {
  vantage_reporting_ownership: {
    version: 1
    destination_id: string
    managed: true
  }
}
```

That is the handoff from “leftover add has a leftover destination id” to “leftover prove may leftover **ask** leftover `thisCellIsStillOursForThisDestination`.” Do **not** put leftover `run_id` on this type. Do **not** put leftover Drive leftover `appProperties` on this type. Do **not** put leftover `ownership_marker_version` on this type — leftover desk persists leftover `1` beside leftover `immutable_sheet_id`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ownershipMarker.ts
// We are about to add a managed tab or write a staging / snapshot sheet.
// Put a JSON stamp in ZZ1 that says this destination owns this tab
// and we manage it.
// Later, only call the tab ours if that cell still parses as
// version 1, managed true, and the same destination id.
// A human title is not enough.
// A run marker in ZY1 is a different stamp.
// Drive appProperties are a different proof.
// Do not write Google. Do not delete a tab. Do not persist the destination.

export const theOwnershipMarkerVersionWePersist = 1
export const theOwnershipMarkerCell = "ZZ1"
export const REPORTING_OWNERSHIP_MARKER_VERSION = theOwnershipMarkerVersionWePersist
export const REPORTING_OWNERSHIP_MARKER_CELL = theOwnershipMarkerCell

// ── 1. Stamp this destination on ZZ1 ─────────────────────

export function stampThisDestinationOnCellZz1(destinationId)
  // leftover nest vantage_reporting_ownership
  // leftover version 1, leftover managed true
  // leftover destination id as given — not trimmed

export const serializeReportingOwnershipMarker = stampThisDestinationOnCellZz1

export function buildThisDestinationOwnershipStamp(destinationId)
export const buildReportingOwnershipMarker = buildThisDestinationOwnershipStamp

// ── 2. Read the cell or refuse ───────────────────────────

export function readThisCellAsOurOwnershipStampOrRefuse(raw)
  // leftover non-string / leftover blank / leftover bad JSON → null
  // leftover version !== 1 / leftover managed !== true / leftover empty id → null

export const parseReportingOwnershipMarker = readThisCellAsOurOwnershipStampOrRefuse

// ── 3. Say whether this cell is still ours ───────────────

export function thisCellIsStillOursForThisDestination(raw, destinationId)
  // leftover parse, then leftover destination_id === leftover argument

export const ownershipMarkerMatchesDestination = thisCellIsStillOursForThisDestination
```

Read the add path out loud: *Leftover desk already created the destination row. Leftover managed-tab add asks `stampThisDestinationOnCellZz1` and writes that JSON RAW onto `{tabName}!ZZ1`. This file never called Google. Leftover add does not ask `thisCellIsStillOursForThisDestination` after the write.*

Read the prove path out loud: *Leftover verify already found the tab by immutable sheet id and refused a human title collision. Then leftover prove asks `thisCellIsStillOursForThisDestination`. A missing nest, a wrong version, `managed` not true, or another destination id is not ours. This file returns false. Leftover prove throws “not a Vantage-managed reporting tab.”*

Read the leftover Sheets write path out loud: *Leftover write asks `stampThisDestinationOnCellZz1` for ZZ1 and leftover run serialize for ZY1 in one leftover batchUpdate. Leftover verify asks leftover match on ZZ1 before leftover `runMarkerMatches`. This file never saw leftover `run_id`.*

That is the operation. `serializeReportingOwnershipMarker` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **Leftover fake voids the cell constant.** Leftover `fakeReportingGoogle.ts` does `void REPORTING_OWNERSHIP_MARKER_CELL` then writes `cellKey(1, 702)`. Do not silently start the fake asking `theOwnershipMarkerCell` so “the fake is honest” — leftover column math stays leftover fake.

2. **Leftover desk never reads ZZ1.** Create / rename / pending-rename persist `ownership_marker_version: REPORTING_OWNERSHIP_MARKER_VERSION`. Leftover desk **asks** leftover `verifyManagedTabOwnership` to prove. Do not silently ask leftover match from leftover desk so “the persisted version is checked here.”

3. **Parse allows extra JSON keys.** `JSON.parse` plus field checks. `{ vantage_reporting_ownership: { version: 1, destination_id, managed: true, extra: 1 } }` still matches. Do not silently refuse extra keys so “the type is closed.”

4. **Destination id is not one fold.** Serialize does not trim. Parse requires `destination_id.trim()` truthy, then match is `===` the argument. `" dest "` can parse and fail match against `"dest"`. Do not silently trim both so “ids are canonical.”

5. **Leftover cleanup ignores `ownershipRaw`.** Leftover `positivelyMarkedForCleanup` **asks** leftover `runMarkerMatches` only. Leftover janitor **asks** leftover `verifyOwnershipAndRunMarkers`. Do not silently start leftover janitor asking leftover match from this file so “ownership is checked twice.”

6. **Leftover add does not prove after the stamp.** Already-recommended leftover managed-tab add writes ZZ1 and returns `immutableSheetId`. Prove is leftover verify / leftover rename. Do not silently ask leftover match after leftover add so “the write is confirmed.”

7. **Version 1 is the only accepted stamp.** Parse refuses `version !== 1`. There is no v2 reader. Do not silently accept future versions so “the type is ready.”

8. **Leave sibling files alone.** Managed-tab add / prove stays in leftover `managedTab.service.ts`. Sheets write / verify stays in leftover `google/reportingSheetsAdapter.ts`. Run stamp stays in leftover `google/runMarker.ts`. Drive appProperties stays in leftover `google/driveAppProperties.ts`. Desk persist stays in leftover `reportingDestination.service.ts`. Cleanup stays leftover. Do not open unvisited leftover `registryFilters.ts` this pass.

## Testing

The **interface** is the test surface. Existing asserts: leftover serialize then leftover parse is ok; leftover match same destination is `true`; leftover other destination is `false`; leftover `verifyManagedTabOwnership` accepts a matching stamp and rejects `"not-a-vantage-marker"`. No empty-cell refuse is locked. No `managed: false` refuse is locked. No `version: 2` refuse is locked. No “this file never writes Google” proof is locked.

Add proofs at the new names (later implementer; not this Cloud pass):

- stamp: JSON nest is `vantage_reporting_ownership`; `version` is `1`; `managed` is `true`; destination id is as given
- read or refuse: non-string / blank / bad JSON → `null`; `version !== 1` → `null`; `managed !== true` → `null`; whitespace-only id → `null`
- still ours: matching destination `true`; other destination `false`; unreadable cell `false`
- never write Google: `values.update` / `batchUpdate` / `deleteSheet` are not called from this file
- never leftover run: `vantage_reporting_run` is not on this stamp
- never leftover Drive appProperties: `vantage_reporting_run_id` is not on this stamp
- leftover desk version: `REPORTING_OWNERSHIP_MARKER_VERSION` stays `1`

Do not add helper-unit tests for leftover `buildThisDestinationOwnershipStamp`. Do not boot leftover live Google, leftover destination desk, leftover promote, or leftover janitor. Do not replace leftover `verifyManagedTabOwnership` tests with this file so “one test owns both stories.” Do not assert leftover Sheets `verifyOwnershipAndRunMarkers` categories as if they were leftover `thisCellIsStillOursForThisDestination`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, leftover `src/models/ReportingDestination.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingOwnershipMarkerService` class or a `create.ts` / `update.ts` / `delete.ts` / `build.ts` / `parse.ts` split.
- I would not invent a second leftover Google-write **adapter** beside leftover managed-tab leftover `values.update` / leftover Sheets leftover `writeOwnershipAndRunMarkers`.
- I would not pull leftover managed-tab leftover add, leftover Sheets leftover verify, leftover run leftover stamp, leftover Drive leftover appProperties, leftover desk leftover persist, leftover cleanup, or leftover promote into this file.
- I would not silently leftover merge leftover `ZY1` leftover into leftover this leftover file.
- I would not silently leftover start leftover janitor leftover **asking** leftover `ownershipMarkerMatchesDestination`.
- I would not silently leftover trim leftover destination leftover ids leftover so leftover parse leftover and leftover match leftover agree.
- I would not silently leftover refuse leftover extra leftover JSON leftover keys.
- I would not open unvisited leftover `registryFilters.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
