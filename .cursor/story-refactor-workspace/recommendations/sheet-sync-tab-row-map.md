# Read The Tab Once And Map Each Mongo ID To Its Row — The Column Is Identity, A Shifted Cell Is The Fallback, This File Does Not Write — operational story

- Status: recommended
- Service: `sheetSync` (Wave A, in-progress)
- Pass: 9 of this service — `drainer/tabRowMap.ts`
- Remaining in this service: `drainer/quotaLimiter.ts`
- Target: `src/services/sheetSync/drainer/tabRowMap.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (queued step 5: the batch writer reads a tab once so it can update in place and append only new rows; sheet row identity is always **Lead ID** / the `Mongo ID` column; `sheet_sync[].row_number` is a hint only — that hint is refused on the already-recommended writer, not here). Distinct from already-recommended mode-aware persist / finalize / unmigrated schedule: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md). Distinct from already-recommended outbox coalesce + tombstone: [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md). Distinct from already-recommended wake-up: [recommendations/sheet-sync-queue.md](sheet-sync-queue.md). Distinct from already-recommended legacy `document.save()` remember: [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md). Distinct from already-recommended live lookup-then-write: [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md) (legacy `findRowNumberByMongoId` / `rowNumberContainsMongoId` in later `googleSheets/rowLookup.ts` is the other lookup **adapter**; queued never imports it; this file is the one-read map). Distinct from already-recommended take-the-seat / claim / finalize: [recommendations/sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md). Distinct from already-recommended reload-and-plan: [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md) (this file does not choose tabs). Distinct from already-recommended write-the-planned-rows: [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) (the writer reserved the read and asked this file; it owns update / append / delete and the remembered-row refuse). Distinct from later quota: `drainer/quotaLimiter.ts`. Distinct from Google Sheets tabs / projections / dual Source Company writes: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (this file reads cells; it does not project a Lead). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names queued one-read batch vs legacy per-row upsert; do not “fix” that in this rename.
- Callers: **one runtime import site, plus the drainer barrel, plus the folder test.** Writer: `drainer/batchWriter.ts` asks `buildTabRowMap(sheets, spreadsheetId, tabName, headers)` after it reserved one `read` and after optional `ensureTabsAndHeaders`. A throw fails the whole tab as `lookup`. Barrel: `sheetSync/drainer/index.ts` re-exports `buildTabRowMap`. Service barrel `sheetSync/index.ts` does **not** re-export this file. Drain, planner, coordinator, outbox, queue, persistence, and source lookup do **not** import it. Tests: `drainer/drainer.test.ts` has one direct test (`buildTabRowMap maps Mongo IDs to 1-based row numbers`) — header plus two data rows, `Mongo ID` in column 0. The same file’s writer tests call this file through `writeBatchedTargets` (update vs append vs missing delete). There is no shifted-cell test, no missing-header test, no duplicate-id test, and no empty-`values` test on this file. Later `QuotaLimiter` lives in the same test file and is not this **interface**.
- Seams callers need: `Map<mongoId, 1-based row>` (writer splits update / append / “already gone”); injected `sheets` (writer and tests); `headers` so the `Mongo ID` column can be found; one `values.get` from `A:ZZ` (the writer already reserved that read); a throw is a tab `lookup` failure, not an empty map
- Split later (only if the file outgrows one sitting): this ~55-line file is one sitting if you read it as read the tab once → skip the header → column first, shifted 24-hex if that cell is empty. Do not split into `read.ts` / `scan.ts` / `lookup.ts`. Never merge drain claim, planner tab choice, already-recommended `writeBatchedTargets`, later `QuotaLimiter`, or legacy `findRowNumberByMongoId` into this file

`buildTabRowMap` is executor mechanics. The owner question is: *The writer already reserved one read for this tab. Read Calls (or Forms, or Booked Deals) once, from A to ZZ. Skip the header. For every data row, if the Mongo ID column has a string, that string is the Lead ID for that row. If the column is missing or that cell is empty, scan the row for a 24-hex cell so a shifted-column legacy row still maps. The first shifted match keeps the earlier row. This file does not write. This file does not claim. This file does not reserve quota. A remembered row number is not this lookup — the writer already refuses overwrite from the map we return. Legacy still re-reads the whole tab for every document. Do not silently switch this file to that path, and do not silently make legacy call this map.*

Coordinator persist / finalize, outbox coalesce, queue wake-up, legacy per-row lookup, drain seat / claim / finalize, planner tab choice, already-recommended batch write, later quota limiter, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a map CRUD helper,” and not the writer / the drain / the live lookup:

1. **Read the tab once and map each Mongo ID to its row** — `buildTabRowMap(sheets, spreadsheetId, tabName, headers)`. One `values.get` on `escapedTab!A:ZZ` through `withSheetsRetry("values.get.tabMap")`. Empty `values` is an empty map. Skip index `0` (the header). For each later row: if `headers` names `Mongo ID` and that cell is a non-empty string, `map.set(cell, rowNumber)` and go to the next row — even when the string is not 24-hex. Otherwise walk every cell; a string matching `/^[a-f0-9]{24}$/i` is recorded only when that id is not already on the map (first shifted row wins). Column hits overwrite a later duplicate (`map.set`). This function does not reserve a `read`. This function does not write cells. This function does not look at `knownRowNumber`. This function does not mark a job.

There is no second mutate operation. Mode, wake-up, claim, plan, write, remember, and outbox coalesce are other files. Legacy `findRowNumberByMongoId` / `rowNumberContainsMongoId` are a different **adapter** for the same owner identity, not this file.

## Organization

Keep one file as the screenplay for “read the tab once and map each Mongo ID to its row — the column is identity, a shifted cell is the fallback, this file does not write.” Drain seat / claim / finalize, planner tab choice, already-recommended batch write, later quota limiter, legacy per-row lookup, coordinator, outbox, queue, and Google Sheets projections already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncTabRowMapService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and the drain’s `updateOne`. Do not invent a second live-lookup **adapter** beside later `findRowNumberByMongoId`. Do not invent a second write **adapter** beside already-recommended `writeBatchedTargets` / later `upsertRow`.

Do not split this into `read.ts` / `scan.ts` / `lookup.ts`. Those are beats of one read. Do not move this into `batchWriter.ts` so “the writer already reads.” Do not move this into `googleSheets/rowLookup.ts` so “one lookup owns every mode.” Do not silently call `findRowNumberByMongoId` so “queued reuses legacy.”

**External interface** stays small (this is the test surface). Column-first and shifted-cell fallback are one story’s read, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildTabRowMap` | `readTheTabOnceAndMapEachMongoIdToItsRow` | writer asks once per tab after it reserved the read |

Keep the old name as a one-line alias until the writer, the drainer barrel, and `drainer.test.ts` migrate. Do not make callers learn `SHEET_ROW_LOOKUP_END_COLUMN` / `withSheetsRetry` as the domain language.

**Principle: old exports stay as aliases.** `buildTabRowMap` remains the imported name until `writeBatchedTargets` points at the story name.

Do not grow this **interface** with `knownRowNumber` — the writer already refuses overwrite. Do not grow it with `quota` — the writer already reserved. Do not grow it with `op` / `writes` so “the map can finish the job.”

**No class for the workflow.** The type that *does* earn a name is the map we hand the writer:

```ts
type TabRowsByMongoId = Map<string, number>
```

That is the handoff from “we read Calls once” to “update the rows the tab still knows, append the rows it does not, treat a missing delete as already gone.” Do **not** add `status: "synced"` so “the map can finish the job,” do **not** add `knownRowNumber` so “the map can refuse overwrite,” and do **not** add `official_booking_details` so “a booked read can confirm.”

`sheets` stays on the args because it is a real injected **adapter**, not a second persistence. `headers` stays because the `Mongo ID` column is the identity the owner named.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// drainer/tabRowMap.ts
// The writer already reserved one read for this tab.
// Read the tab once, from A to ZZ.
// Skip the header.
// If the Mongo ID column has a string, that is the Lead ID for that row.
// If the column is missing or that cell is empty, scan for a 24-hex cell
// so a shifted-column legacy row still maps.
// The first shifted match keeps the earlier row.
// This file does not write.
// This file does not claim.
// This file does not reserve quota.
// A remembered row number is not this lookup.
// Legacy still re-reads the whole tab for every document.
// Do not silently switch this file to that path.

// ── 1. Read the tab once and map each Mongo ID to its row ─

export async function readTheTabOnceAndMapEachMongoIdToItsRow(
  sheets,
  spreadsheetId,
  tabName,
  headers,
): Promise<TabRowsByMongoId>
export const buildTabRowMap = readTheTabOnceAndMapEachMongoIdToItsRow

async function readEveryCellOnThisTab(sheets, spreadsheetId, tabName)
  // values.get A:ZZ through withSheetsRetry("values.get.tabMap")

function skipTheHeaderAndWalkEachDataRow(rows, headers)
function takeTheMongoIdColumnWhenItHasAString(row, mongoIdIndex)
function scanTheRowForAShiftedTwentyFourHexCell(row, map)
  // first shifted match keeps the earlier row
```

Read the primary path out loud: *The writer already reserved the one read. We ask Google for Calls from A to ZZ. We skip the header. Row 2 has `aaaaaaaaaaaaaaaaaaaaaaaa` in Mongo ID, so that id is row 2. Row 3 has `bbbbbbbbbbbbbbbbbbbbbbbb`, so that id is row 3. We hand the writer the map. We do not write. We do not mark the job. The writer will update the rows we found and append the ones we did not.*

Read the shifted-cell beat out loud: *A legacy row may have slid so the Lead ID is no longer under Mongo ID. If that cell is empty, we walk the rest of the row. The first 24-hex cell we have not already mapped is that row. If Mongo ID still has a string — even a junk string — we trust the column and we do not scan.*

Read the two-adapters beat out loud: *Legacy `findRowNumberByMongoId` still re-reads the whole tab for every document, and it looks for one id. This file reads once and maps every id. Both **adapters** stay. We do not call that scan from here so “queued reuses legacy,” and we do not teach legacy to call this map so “one lookup owns every mode.”*

That is the operation. `buildTabRowMap` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two lookup **adapters**, one owner identity.** Legacy `findRowNumberByMongoId` / `rowNumberContainsMongoId` re-read the tab (or one remembered row) for a single Mongo id. This file reads once and returns every id. Knowledge already names queued one-read vs legacy per-row. Keep both **adapters**. Do not silently route `upsertRow` through `readTheTabOnceAndMapEachMongoIdToItsRow` so “one lookup owns every mode,” and do not call `findRowNumberByMongoId` from this file so “queued reuses legacy.”

2. **The column is identity. The 24-hex scan is only for an empty or missing column.** A non-empty Mongo ID cell is recorded as-is and the row is not scanned. A missing `Mongo ID` header, or an empty / non-string cell, falls through to the scan. Name that. Do not start requiring 24-hex on the column path in this rename so “the map only holds Lead IDs” — a `"not provided"` cell would then fall through and might pick up a different 24-hex on that row. Do not drop the scan so “the column is enough” without a test — the comment says the scan exists for shifted legacy rows.

3. **Legacy `includes(mongoId)` is not this scan.** Legacy looks for the **requested** id anywhere on the row. This fallback maps **any** 24-hex cell. On Booked Deals (`Mongo ID` + `Mongo Lead ID`) and Cancelled Deals (`Mongo ID` + `Lead Mongo ID`), an empty booking Mongo ID cell would map the source Lead’s id to that booking row. The writer looking up the booking id would miss and append. A later source-lead write looking up that Lead id could treat the booking row as the Lead’s row. Do not “fix” the scan to `includes(requestedId)` in this rename — this file is not asked for one id. Do not start skipping `Mongo Lead ID` / `Lead Mongo ID` columns in this rename so “booked rows are safe” without a booked-tab test.

4. **Duplicate ids disagree with themselves.** A later column hit `map.set`s over an earlier row (last column win). A later shifted hit is ignored (`if (!map.has(cell))` — first shifted win). Name both. Do not collapse to first-wins everywhere in this rename so “the map is consistent.” Do not collapse to last-wins on the scan so “we match the column.”

5. **`A:ZZ` is load-bearing.** Same end column as later `rowLookup.ts`. The fallback needs cells past the named headers. Do not shrink the range to `columnLetter(headers.length)` in this rename so “we only read what we project” — a shifted id past that letter would vanish.

6. **Header row is always skipped.** Index starts at `1`. `ensureTabsAndHeaders` on the writer usually put a header in row 1. An empty first `values` row still burns that skip. Do not start treating a first row that looks like 24-hex as data in this rename so “headerless tabs map.”

7. **This file does not reserve quota.** The writer reserved the `read` before the call. A throw here is a tab `lookup` failure, not a `deferred`. Do not start calling `quota.reserve` from this file so “the map is honest about the read.” Do not catch Google errors and return `{}` so “a failed read is an empty tab” — the writer would then append every upsert and no-op every delete.

8. **Retry label is `values.get.tabMap`, not `values.get.lookup`.** Legacy uses `lookup` / `rowCheck`. Rename functions; keep the string until log / retry searches are migrated on purpose.

9. **`SHEET_ROW_LOOKUP_END_COLUMN` is copied.** `"ZZ"` lives here and on later `rowLookup.ts`. Do not invent a shared constant **module** in this pass so “one ZZ owns every mode.” Leave the googleSheets copy for that service.

10. **Leave sibling modules alone.** `writeBatchedTargets` / `validatedKnownRow` stay on already-recommended `batchWriter.ts`. `QuotaLimiter.reserve` stays in later `quotaLimiter.ts`. `findRowNumberByMongoId` / `rowNumberContainsMongoId` stay on later `googleSheets/rowLookup`. `planJobWrites` stays on the already-recommended planner. `runSheetSyncDrain` stays on the already-recommended drain. `escapeSheetTitleForRange` / `withSheetsRetry` stay where they are. This file orchestrates read once → column first → shifted fallback.

## Testing

The **interface** is the test surface: `readTheTabOnceAndMapEachMongoIdToItsRow` (today `buildTabRowMap`). `Map<string, number>` is part of that **interface**. Inject `sheets`; do not boot Google Sheets or Mongo.

`drainer.test.ts` already locks two column hits → rows 2 and 3. That is the right **interface**. It is not enough. The same file also tests already-recommended `writeBatchedTargets` and later `QuotaLimiter` — leave those; do not treat writer update-vs-append as coverage of this file’s fallback.

**Read the tab once and map each Mongo ID to its row**
- Header plus two Mongo ID strings → those ids are rows 2 and 3 (already locked).
- Empty `values` / missing `values` → empty map, still one `values.get`.
- `Mongo ID` cell empty, another cell is 24-hex → that id maps to that row.
- `Mongo ID` cell is a non-hex string (`"not provided"`) → that string is on the map; a 24-hex sibling cell on the same row is **not** added from the scan.
- Headers omit `Mongo ID` → every 24-hex cell is mapped via the scan; first occurrence wins.
- Same Mongo ID in the column on two rows → **last** row wins.
- Same 24-hex via the scan on two rows → **first** row wins.
- Booked-shaped row: empty `Mongo ID`, filled `Mongo Lead ID` 24-hex → today’s map holds the **Lead** id at that booking row (lock the current **adapter**; do not “fix” it here).
- Does not call `values.update` / `values.append` / `spreadsheets.batchUpdate`.
- Range is `escapedTab!A:ZZ` (or the equivalent escaped title).

**Not this interface**
- Persist / finalize / unmigrated schedule stay on [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md).
- Remember-or-fold / tombstone enqueue stay on [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md).
- Wake-up stays on [recommendations/sheet-sync-queue.md](sheet-sync-queue.md).
- Legacy `save()` remember stays on [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md).
- Live lookup-then-write / `upsertRow` / `findRowNumberByMongoId` stay on [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md) and later `googleSheets/`.
- Take-the-seat / claim / empty-plan→`synced` stay on [recommendations/sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md).
- Reload current Mongo / unmatched skip / vanished Booking stay on [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md).
- Update / append / delete / remembered-row refuse / read-quota defer stay on [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md).
- Token-bucket grant / deny / rollback stays on later `drainer/quotaLimiter.ts` (the limiter test in this file moves with that pass).
- Projection cell values stay on later `googleSheets/projections`.

Do **not** add a test per helper (`readEveryCellOnThisTab`, `scanTheRowForAShiftedTwentyFourHexCell`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file marks a job `synced` — it must not. Do not add a test that this file reserves quota — it must not. Do not add a test that a missing Mongo ID header returns `undefined` the way legacy `findRowNumberByMongoId` does — this file scans instead. Do not add a test that a failed Google read becomes `{}` — it must throw.

`sheets` stays on the args because the tests are a real **adapter**, not a test leak.

## What I would not do

- A `SheetSyncTabRowMapService` class with `get` / `scan` / `lookup`.
- Thirty two-line functions that only wrap `map.set`.
- Moving this into a CRUD folder, or into `batchWriter.ts` / `runSheetSyncDrain.ts` / `googleSheets/rowLookup.ts` “for cleanliness.”
- Breaking the column-first / shifted-fallback **seam**. Order is the owner story.
- Treating `persistSheetSyncIntent` / `publishSheetSyncWakeup` / `syncAndStore` / `syncSourceLeadById` / `planJobWrites` / `writeBatchedTargets` / `runSheetSyncDrain` as this story.
- Inventing a live-lookup **seam** that has only one **adapter** here.
- Silently routing this file through `findRowNumberByMongoId`, or silently teaching legacy `upsertRow` to call this map, or silently requiring 24-hex on the Mongo ID column, or silently swallowing a Google throw as an empty map.
- Writing a whole-folder recommendation for `sheetSync`.
- Jumping to `googleSheets` while this checklist has unchecked modules.
- Marking the job `synced` from this file, or making the Form Lead 201 wait on a tab read.
