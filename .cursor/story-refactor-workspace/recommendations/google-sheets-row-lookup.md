# Find This Document's Row By Mongo ID — Trust The Remembered Row Only If It Still Holds This ID — Then Write In Place Or Append — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, in-progress)
- Pass: 5 of this service — `rowLookup.ts`
- Remaining in this service: `deleteRows.ts`, `retry.ts`, `projections/formLeadRow.ts`, `projections/callLeadRow.ts`, `projections/bookedLeadRow.ts`, `projections/cancelledLeadRow.ts` (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/rowLookup.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (upsert by Lead ID: lookup the `Mongo ID` column; update if found, else append; use `sheet_sync[].row_number` when it still contains that Mongo ID). Distinct from already-recommended choose-tabs-then-write-or-take-off: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (that facade never imports this file; it asks already-recommended `syncRowToTargets`, which asks this file). Distinct from already-recommended destination naming: [recommendations/google-sheets-targets.md](google-sheets-targets.md) (that file names Master / Source and later delete’s `knownRowNumber`; this file does not choose destinations). Distinct from already-recommended one-tab ensure: [recommendations/google-sheets-tabs.md](google-sheets-tabs.md) (leftover clear on a **data** row lives here as a call; leftover clear on header row 1 and `columnLetter` live there). Distinct from already-recommended live write loop: [recommendations/google-sheets-sync-rows.md](google-sheets-sync-rows.md) (that file ensures one tab, hands this file the remembered hint and the already-projected cells, and remembers synced / failed; this file finds the row and writes). Distinct from later `deleteDimension`: later `deleteRows.ts` (asks this file’s find / hint-check only, then `deleteDimension`; this file does not take a row off). Distinct from later retry: later `retry.ts` (this file wraps every Google call in `withSheetsRetry` — do not pull that file in). Distinct from already-recommended queued one-read map: [recommendations/sheet-sync-tab-row-map.md](sheet-sync-tab-row-map.md) (same owner identity, different **adapter**; queued never imports this file). Distinct from already-recommended queued batch write: [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) (same owner cells, different **adapter**; queued never imports this file). Distinct from already-recommended remember-on-document: [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md) (`syncAndStore` never imports this file). Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names queued one-read batch vs legacy per-row upsert and that `sheet_sync[].row_number` is a hint only; do not “fix” those in this rename.
- Callers: **two runtime import sites. No file test.** Already-recommended live write: `syncRows.ts` — one `upsertRow` per named destination after one-tab ensure, passing `document._id`, already-projected cells, and `existingSync?.row_number`. Later delete: `deleteRows.ts` — `rowNumberContainsMongoId` then `findRowNumberByMongoId` with `target.knownRowNumber` from already-recommended `getDeleteTargets`; missing row is a no-op, then later `deleteSheetRow`. Already-recommended facade / `writeBatchedTargets` / `buildTabRowMap` / `syncAndStore` / `v1.service.ts` do **not** import this file. There is no `rowLookup.test.ts`. Not this **interface**: already-recommended Forms-or-Duplicates choice, already-recommended Master-vs-source destinations, already-recommended one-tab ensure itself, already-recommended continue-on-failure loop, later `deleteDimension`, later `*ToRow`, already-recommended `buildTabRowMap` / `writeBatchedTargets`.
- Seams callers need: remembered `row_number` hint vs full-tab scan; in-place overwrite vs `INSERT_ROWS` append; `Mongo ID` column match vs `row.includes(thisId)` shifted-cell fallback; this live per-document lookup vs already-recommended queued one-read map; leftover clear on a data row vs leftover clear on header row 1; find-without-write (later delete) vs find-then-write (already-recommended live write)
- Split later (only if the file outgrows one sitting): this ~100-line file is one sitting if you read it as find this document’s row by Mongo ID, trust the remembered row only if it still holds this ID, then write in place or append. If it later splits: `thisRememberedRowStillHoldsThisMongoId.ts` / `findThisDocumentsRowByScanningTheTab.ts` / `writeThisDocumentsRowInPlaceOrAppendByMongoId.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `lookup.ts` as a CRUD dump, and never merge already-recommended `syncRowToTargets`, already-recommended `ensureTabsAndHeaders`, later `deleteRowsFromTargets`, already-recommended `buildTabRowMap`, or already-recommended `writeBatchedTargets` into this file

`upsertRow` / `findRowNumberByMongoId` / `rowNumberContainsMongoId` are executor mechanics. The owner question is: *Already-recommended write already named the spreadsheet and tab, already projected the cells, and already handed us a remembered `row_number` if Mongo has one. Find this document’s row by Mongo ID. Trust that remembered row only if the cell is still this Mongo ID. If we do not know the row, or the hint is stale, scan the tab from A to ZZ, skip the header, and take the first data row whose Mongo ID column — or any cell — equals this id. If we find it, clear leftover cells past today’s last column, then overwrite A…today with `USER_ENTERED`. If we do not find it, append a new row with `INSERT_ROWS` and return the row number Google reported. Later delete asks the same find and never writes. Sheets are reporting. They are never the record. The queued writer already reads the tab once and batches — do not silently switch this file to that path.*

Already-recommended facade tab choice, already-recommended destination naming, already-recommended one-tab ensure, already-recommended live write loop, later `deleteDimension`, later retry, already-recommended queued one-read map, and already-recommended queued batch write already live in other **modules**. Do not pull those in.

## What this file actually does

Four beats of one “find this document’s row by Mongo ID — trust the remembered row only if it still holds this ID — then write in place or append” story, not “a lookup CRUD helper,” and not the live write’s destination loop:

1. **Trust the remembered row only if it still holds this Mongo ID** — `rowNumberContainsMongoId(sheets, spreadsheetId, tabName, headers, mongoId, rowNumber)`. If `headers` has no `Mongo ID` column, return `false` without talking to Google. Otherwise one `values.get` of that row (`A{n}:ZZ{n}`) through `withSheetsRetry("values.get.rowCheck")`. True when `row[mongoIdIndex] === mongoId` **or** `row.includes(mongoId)`. Already-recommended write and later delete both ask this before they trust `sheet_sync[].row_number` / `target.knownRowNumber`. Falsy `knownRowNumber` (`0` / `undefined`) skips this beat. This beat does not scan the tab. This beat does not write.

2. **Scan the tab for this Mongo ID** — `findRowNumberByMongoId(sheets, spreadsheetId, tabName, headers, mongoId)`. One `values.get` of `escapedTab!A:ZZ` through `withSheetsRetry("values.get.lookup")`. Then, if `headers` has no `Mongo ID` column, return `undefined` (the read already happened). Skip index `0` (the header). First later row whose Mongo ID cell equals this id, **or** any cell equals this id (`row.includes(mongoId)`), wins. Empty / missing `values` → `undefined`. This beat does not write. This beat does not map every id.

3. **Write the already-projected cells in place** — inside `upsertRow`, after a found `rowNumber`. Ask already-recommended `clearLegacyTrailingCells` on **that data row** (Form leftover width 23, Call leftover width 19, Booked / Cancelled no-op). Then `values.update` `A{n}:{today}{n}` with `USER_ENTERED` through `withSheetsRetry("values.update.row")`. Return that row number. This beat does not append. This beat does not persist.

4. **Append a new row when the tab does not have this ID** — `values.append` on `A:{today}` with `USER_ENTERED` and `INSERT_ROWS` through `withSheetsRetry("values.append.row")`. Return `extractRowNumberFromRange(updatedRange)` — may be `undefined` if Google omitted the range. Already-recommended write still stores `synced` in that case and does not invent `0`. This beat does not clear leftover cells (a new row has none). This beat does not choose Forms vs Duplicates.

There is no fifth mutate operation. Tab **choice**, destination lists, header heal itself, destination loop / continue-on-failure, `deleteDimension`, queued one-read map, queued batch, and persist already live in other files. `upsertRow` is the write **adapter**. `findRowNumberByMongoId` / `rowNumberContainsMongoId` stay exported because later delete is a second real **adapter** that finds without writing.

## Organization

Keep one file as the screenplay for “find this document’s row by Mongo ID — trust the remembered row only if it still holds this ID — then write in place or append.” Already-recommended facade tab choice, already-recommended `getLeadTargets`, already-recommended `ensureTabsAndHeaders`, already-recommended `syncRowToTargets`, later `deleteRowsFromTargets`, already-recommended `buildTabRowMap`, and already-recommended `writeBatchedTargets` already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleSheetsRowLookupService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and already-recommended `syncAndStore`. Do not invent a second queued-map **adapter** beside already-recommended `buildTabRowMap`. Do not invent a second batch-write **adapter** beside already-recommended `writeBatchedTargets`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `lookup.ts`. Those are HTTP verbs, not the owner story. Do not move this into `syncRows.ts` so “the loop already upserts.” Do not move this into `deleteRows.ts` so “find already lives with delete.” Do not move this into `tabRowMap.ts` so “one lookup owns every mode.” Do not silently call `buildTabRowMap` so “live reuses queued.”

**External interface** stays small (this is the test surface). Hint check, tab scan, in-place write, and append are one story’s live row work, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `upsertRow` | `writeThisDocumentsRowInPlaceOrAppendByMongoId` | already-recommended live write after one-tab ensure |
| `findRowNumberByMongoId` | `findThisDocumentsRowByScanningTheTab` | live write fallback + later delete |
| `rowNumberContainsMongoId` | `thisRememberedRowStillHoldsThisMongoId` | live write hint + later delete hint |

Keep the old names as one-line aliases until already-recommended `syncRows.ts`, later `deleteRows.ts`, and a later test file migrate. Do not make callers learn `SHEET_ROW_LOOKUP_END_COLUMN` / `values.get.lookup` / `INSERT_ROWS` as the domain language.

**Principle: old exports stay as aliases.** `upsertRow` / `findRowNumberByMongoId` / `rowNumberContainsMongoId` remain the imported names until those two runtime sites point at the story names.

**No class for the workflow.** The type that *does* earn a name is the found row later write and later delete already need before they mutate the tab:

```ts
type ThisDocumentsReportingRow = {
  rowNumber: number
  mongoId: string
}
```

That is the handoff from “we found this Mongo ID on the tab” to “overwrite that row, or later take it off.” Do **not** add `status: "synced"` so “this file can persist,” do **not** add `tabName` so “this file can choose Forms or Duplicates,” and do **not** add `cells` so “find can write.”

`findRowNumberByMongoId` and `rowNumberContainsMongoId` stay exported because later delete is a second real **adapter**, not a test leak. Do not add `writeOneCell` as a public **seam** so “tests can skip the find.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// rowLookup.ts
// Already-recommended write already named the spreadsheet and tab,
// already projected the cells, and already handed us a remembered row
// if Mongo has one.
// Find this document's row by Mongo ID.
// Trust that remembered row only if the cell is still this Mongo ID.
// If we do not know the row, or the hint is stale, scan the tab from A to ZZ.
// Skip the header.
// Take the first data row whose Mongo ID column — or any cell — equals this id.
// If we find it, clear leftover cells past today's last column,
// then overwrite A…today.
// If we do not find it, append a new row.
// Later delete asks the same find and never writes.
// Sheets are reporting. They are never the record.
// The queued writer already reads the tab once and batches.
// Do not silently switch this file to that path.

// ── 1. Trust the remembered row only if it still holds this ID

export async function thisRememberedRowStillHoldsThisMongoId(
  sheets,
  spreadsheetId,
  tabName,
  headers,
  mongoId,
  rowNumber,
): Promise<boolean>
export const rowNumberContainsMongoId = thisRememberedRowStillHoldsThisMongoId

function mongoIdColumnOnTheseHeaders(headers)
  // missing → false, no Google call
async function readThisOneRowFromAToZz(sheets, spreadsheetId, tabName, rowNumber)
  // values.get.rowCheck
function thisRowHoldsThisMongoId(row, mongoIdIndex, mongoId)
  // column match OR row.includes(thisId)

// ── 2. Scan the tab for this Mongo ID ─────────────────────

export async function findThisDocumentsRowByScanningTheTab(
  sheets,
  spreadsheetId,
  tabName,
  headers,
  mongoId,
): Promise<number | undefined>
export const findRowNumberByMongoId = findThisDocumentsRowByScanningTheTab

async function readTheTabFromAToZz(sheets, spreadsheetId, tabName)
  // values.get.lookup — happens even when headers omit Mongo ID
function skipTheHeaderAndTakeTheFirstRowThatHoldsThisId(rows, headers, mongoId)
  // missing Mongo ID column → undefined (read already happened)
  // first includes(thisId) wins

// ── 3. Write in place ─────────────────────────────────────

export async function writeThisDocumentsRowInPlaceOrAppendByMongoId(
  sheets,
  spreadsheetId,
  tabName,
  headers,
  alreadyProjectedCells,
  mongoId,
  rememberedRowNumber?,
): Promise<number | undefined>
export const upsertRow = writeThisDocumentsRowInPlaceOrAppendByMongoId

function preferTheRememberedRowWhenItStillHoldsThisId(...)
  // falsy hint → scan
  // stale hint → scan

async function overwriteThisRowAfterClearingLeftoverCells(...)
  // already-recommended clearLegacyTrailingCells on this data row
  // values.update.row USER_ENTERED A…today

// ── 4. Append when the tab does not have this ID ──────────

async function appendANewRowAndReadTheRowNumberGoogleReported(...)
  // values.append.row USER_ENTERED + INSERT_ROWS
  // extractRowNumberFromRange — may be undefined
```

Read the live Form write path out loud: *Already-recommended write already decided this Form is a Duplicate Lead, already named Master Duplicates, already ensured that one tab, and already projected the cells. Mongo remembers row 40. We read A40:ZZ40. The Mongo ID cell is still this document. We clear leftover cells on row 40 (Form leftover width 23, so column W), overwrite A40…V40, and return 40. We do not also write Forms. We do not save the document.*

Read the stale-hint path out loud: *Mongo still says row 40, but row 40 is now a different Lead — someone sorted the tab. We scan A:ZZ, skip the header, and find this id on row 87 (column or a shifted cell). We overwrite 87, not 40. We do not invent a second row on 40.*

Read the append path out loud: *No remembered row, and the scan misses. We append with `INSERT_ROWS` and return the row Google reported. If Google omits `updatedRange`, we return `undefined`. Already-recommended write still stores `synced` and does not invent `0`.*

Read the later-delete path out loud: *Later delete already named the spreadsheet and tab and already has a remembered row. It asks the same hint check, then the same scan. A miss is a no-op. This file never calls `deleteDimension`.*

That is the operation. `upsertRow` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`upsertRow` is executor mechanics.** The owner story is “find this document’s row by Mongo ID, trust the remembered row only if it still holds this ID, then write in place or append.” Keep the old name as an alias. Do not grow a `RowLookupService` with `create` / `update` / `find`.

2. **Two lookup adapters, one owner identity.** Already-recommended `buildTabRowMap` reads the tab once and maps every id. This file re-reads the tab (or one remembered row) for a single id. Knowledge already names queued one-read vs legacy per-row. Keep both **adapters**. Do not silently route `upsertRow` through `buildTabRowMap` so “one lookup owns every mode.” Do not call `buildTabRowMap` from this file so “live reuses queued.” Do not teach the queued map to call `findRowNumberByMongoId` so “queued reuses legacy.”

3. **Two write adapters, one owner cell.** Already-recommended `writeBatchedTargets` reads a tab once and batches. This file writes one document. Knowledge already names both. Keep both **adapters**. Do not silently route `syncFormLeadToSheets` through `writeBatchedTargets` so “one writer owns every mode.” Do not call `writeBatchedTargets` from this file so “live reuses queued.”

4. **Remembered `row_number` is a hint, not identity.** Sheet-sync knowledge: identity is always the `Mongo ID` column; `sheet_sync[].row_number` is a hint only. `knownRowNumber && rowNumberContainsMongoId(...)` is that refuse. Do not write the hint without the check so “we save a read.” Do not skip the scan when the hint is missing so “we only refresh known rows.” Do not treat `0` as a real row — it is already falsy and skipped.

5. **This file’s shifted fallback is `includes(thisId)`, not any 24-hex.** Already-recommended `buildTabRowMap` maps **any** 24-hex cell when the Mongo ID column is empty. This file looks for the **requested** id anywhere on the row, even when the Mongo ID column has a different string. On Booked Deals / Cancelled Deals (`Mongo ID` + `Lead Mongo ID` / `Mongo Lead ID`), a scan for the booking id will not treat the source Lead’s id as a hit unless that cell equals the booking id. Do not “fix” this scan to the 24-hex map so “adapters match” — that would make a booking lookup miss and append, or a later Lead lookup overwrite a booking row. Do not drop `includes` so “the column is enough” without a shifted-cell test.

6. **Missing `Mongo ID` header still reads the tab, then returns `undefined`.** `findRowNumberByMongoId` calls `values.get` **before** it checks `headers.indexOf("Mongo ID")`. `rowNumberContainsMongoId` checks the header **first** and skips Google. Name both. Do not silently move the scan’s header check before the read in this rename so “we save a read” without a test — that changes the Google call count on booked-shaped caller mistakes. Do not start scanning 24-hex when the header is missing so “we match the queued map.”

7. **First scan hit wins.** The loop returns the first data row. A duplicate Mongo ID later on the tab is ignored. Already-recommended `buildTabRowMap` last-wins on the column path. Do not collapse to last-wins here so “adapters match.” Do not throw on a second hit so “duplicates are honest” without an owner decision.

8. **`A:ZZ` is load-bearing.** Same end column as already-recommended `buildTabRowMap`. The fallback needs cells past today’s headers. Do not shrink the range to `columnLetter(headers.length)` so “we only read what we project” — a shifted id past that letter would vanish. Do not invent a shared `ZZ` **module** in this pass so “one constant owns every mode.” Leave the queued copy on `tabRowMap.ts`.

9. **Header row is always skipped.** Scan index starts at `1`. Do not start treating a first row that looks like this Mongo ID as data so “headerless tabs update.”

10. **Leftover clear runs only on in-place write.** Already-recommended `clearLegacyTrailingCells` is identity-checked (`headers === FORM_SHEET_HEADERS` → 23, `=== CALL_SHEET_HEADERS` → 19, else no-op). Append does not clear. Do not clear on append so “new rows are clean” — a new row has no leftover. Do not inline the clear so “write owns leftover” — leftover width already lives on `tabs.ts`. Do not skip the clear so “update already overwrites A…today” — column W on a Form row would keep the old leftover.

11. **`USER_ENTERED` and `INSERT_ROWS` are load-bearing.** Same options as already-recommended `writeBatchedTargets`. Do not switch to `RAW` so “we stop interpreting formulas.” Do not drop `INSERT_ROWS` so “overwrite the leftover block.”

12. **Append may return `undefined`.** `extractRowNumberFromRange` is best-effort. Already-recommended write still stores `synced` and omits or keeps `row_number` undefined. Do not invent `0`. Do not throw so “a missing range is a failed write.” Do not `values.get` the last row so “we always return a number.”

13. **This file does not persist and does not take a row off.** Already-recommended `syncAndStore` `save()`s. Later `deleteRowsFromTargets` calls `deleteDimension`. This file only returns a row number or `undefined`. Do not `document.save()` here so “the writer owns the hint.” Do not call `deleteSheetRow` here so “one file owns find and take-off.”

14. **Ensure is the caller’s job.** Already-recommended write calls `ensureTabsAndHeaders` with one tab before this file. This file does not create a tab. Do not start ensuring here so “upsert is self-healing” — that would rewrite the one-tab-vs-sibling split.

15. **This file does not reserve quota.** Already-recommended `QuotaLimiter` is a queued-drain **adapter**. Legacy live write is unmetered. Do not start reserving a read + write so “every Google call is honest” without a live-path budget decision. Do not import `QuotaLimiter` so “live matches queued.”

16. **Retry labels stay `values.get.lookup` / `values.get.rowCheck` / `values.update.row` / `values.append.row`.** Already-recommended queued map uses `values.get.tabMap`. Rename functions; keep the strings until log / retry searches are migrated on purpose. Leave later `withSheetsRetry` on `retry.ts`.

17. **Leave sibling modules alone.** Already-recommended `syncRowToTargets` / `ensureTabsAndHeaders` / `clearLegacyTrailingCells` / `columnLetter` stay where they are. Later `deleteRowsFromTargets` stays on `deleteRows.ts`. Already-recommended `buildTabRowMap` / `writeBatchedTargets` stay where they are. Later `withSheetsRetry` stays on `retry.ts`. `escapeSheetTitleForRange` / `extractRowNumberFromRange` stay in `utils/googleSheets/ranges`. This file orchestrates hint check → scan → leftover clear + update, or append.

## Testing

The **interface** is the test surface: the three exports (story names, old names as aliases). Hint refuse, tab scan, in-place write, and append are part of that **interface**. Inject `sheets`; stub already-recommended `clearLegacyTrailingCells` / `withSheetsRetry` in-process; do not boot Google Sheets.

There is no `rowLookup.test.ts` today. That is not enough for a find-then-write this load-bearing.

Add tests that name the operation:

**Trust the remembered row only if it still holds this Mongo ID**
- Remembered row, Mongo ID cell equals this id → `true`; range is `escapedTab!A{n}:ZZ{n}`; no tab-wide `values.get`.
- Remembered row, Mongo ID cell is a different id, but another cell equals this id → `true` (`includes`).
- Remembered row, no cell equals this id → `false`.
- Headers omit `Mongo ID` → `false`; **no** Google call.
- `upsertRow` with `knownRowNumber: 40` and hint `true` → no `values.get.lookup`; update row 40.
- `upsertRow` with `knownRowNumber: 40` and hint `false` → scan; do **not** update 40 unless the scan returns 40.
- `upsertRow` with `knownRowNumber: 0` / `undefined` → skip the hint check; scan.

**Scan the tab for this Mongo ID**
- Header plus this id in the Mongo ID column on row 3 → `3`.
- Mongo ID column empty / other string, another cell equals this id → that row (shifted fallback).
- Empty / missing `values` → `undefined`.
- Headers omit `Mongo ID` → still one `values.get`, then `undefined` (do not scan 24-hex).
- Same id on rows 3 and 8 → **3** (first wins).
- Header row containing this id → not returned (index starts at 1).
- Range is `escapedTab!A:ZZ`.

**Write in place**
- Found row → `clearLegacyTrailingCells` is called with that `rowNumber` **before** `values.update`.
- Update range is `escapedTab!A{n}:{todayLetter}{n}` and `valueInputOption: "USER_ENTERED"`.
- Return that row number.
- Does not call `values.append`.

**Append when the tab does not have this ID**
- Scan misses → `values.append` with `USER_ENTERED` and `INSERT_ROWS`; no leftover clear.
- `updatedRange` `Duplicates!A41:V41` → return `41`.
- Missing / unparseable `updatedRange` → `undefined` (do not invent `0`).
- Does not call `values.update`.

**Not this interface**
- Forms-or-Duplicates / Calls-or-Duplicate-Calls choice stays on [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md).
- Master-vs-source destination lists stay on [recommendations/google-sheets-targets.md](google-sheets-targets.md).
- Process-cache ensure / leftover header clear / leftover width identity stay on [recommendations/google-sheets-tabs.md](google-sheets-tabs.md).
- One-tab loop / continue-on-failure / `document.save()` stay on [recommendations/google-sheets-sync-rows.md](google-sheets-sync-rows.md) and [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md).
- `deleteDimension` stays on later `deleteRows.ts`.
- Queued one-read map stays on [recommendations/sheet-sync-tab-row-map.md](sheet-sync-tab-row-map.md).
- Queued batch / quota defer stay on [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) and [recommendations/sheet-sync-quota-limiter.md](sheet-sync-quota-limiter.md).
- Cell values stay on later `projections/*Row.ts`.
- Backoff itself stays on later `retry.ts`.

Do **not** add a test per helper (`thisRowHoldsThisMongoId`, `preferTheRememberedRowWhenItStillHoldsThisId`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file chooses `Duplicates` from `duplicate=true` — it must not. Do not add a test that this file calls `ensureTabsAndHeaders` — it must not. Do not add a test that this file emits `{ status: "deleted" }` or `document.save()` — it must not. Do not add a test that this file reserves quota — it must not. Do not add a test that queued mode calls this file — it must not. Do not add a test that a missing `Mongo ID` header maps 24-hex the way `buildTabRowMap` does — this file returns `undefined`.

`findRowNumberByMongoId` / `rowNumberContainsMongoId` stay exported because later delete is a second real **adapter**, not a test leak.

## What I would not do

- A `GoogleSheetsRowLookupService` class with `create` / `update` / `find`.
- Thirty two-line functions that only wrap `values.get`.
- Moving this into a CRUD folder, or into `syncRows.ts` / `deleteRows.ts` / `tabRowMap.ts` / `batchWriter.ts` “for cleanliness.”
- Breaking the hint-then-scan **seam**, the column-or-`includes(thisId)` **seam**, or the in-place-then-append **seam**.
- Treating `syncRowToTargets` / `ensureTabsAndHeaders` / `deleteRowsFromTargets` / `buildTabRowMap` / `writeBatchedTargets` / `syncAndStore` as this story.
- Inventing a quota-defer **seam** that has only one **adapter** here.
- Silently routing this file through `buildTabRowMap`, or silently teaching queued write to call `upsertRow`, or silently writing the remembered row without the hint check, or silently shrinking `A:ZZ` to today’s last column, or silently switching the fallback to any 24-hex cell, or silently `document.save()`ing, or silently calling `deleteDimension`.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `deleteRows.ts` in this same pass — unchecked `googleSheets` modules remain.
- Making the Form Lead 201 wait on `writeThisDocumentsRowInPlaceOrAppendByMongoId`.
