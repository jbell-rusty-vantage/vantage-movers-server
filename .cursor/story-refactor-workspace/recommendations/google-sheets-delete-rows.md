# Take This Document's Row Off Every Destination We Must Clear — Trust The Remembered Row Only If It Still Holds This Mongo ID — Missing Tab Or Missing Row Is Already Gone — Return Only The Names We Actually Took Off — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, in-progress)
- Pass: 6 of this service — `deleteRows.ts`
- Remaining in this service: `retry.ts`, `projections/formLeadRow.ts`, `projections/callLeadRow.ts`, `projections/bookedLeadRow.ts`, `projections/cancelledLeadRow.ts` (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/deleteRows.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (delete: resolve fallback + historical `sheet_sync`; find by Mongo ID, prefer cached `row_number` when it still matches; `batchUpdate.deleteDimension`; missing tab or missing row is a no-op). Distinct from already-recommended choose-tabs-then-write-or-take-off: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (that facade **asks** this file after it chose Forms or Duplicates / Calls or Duplicate Calls / Booked Deals / Cancelled Deals; it maps this file’s returned names onto `{ target, status: "deleted" }` and concatenates those stubs onto already-recommended write results). Distinct from already-recommended destination naming: [recommendations/google-sheets-targets.md](google-sheets-targets.md) (this file asks `getDeleteTargets`; it does not choose Master vs Source). Distinct from already-recommended one-tab ensure: [recommendations/google-sheets-tabs.md](google-sheets-tabs.md) (this file asks only `getExistingSheetId`; a missing tab is already gone — it does **not** create a tab). Distinct from already-recommended live write loop: [recommendations/google-sheets-sync-rows.md](google-sheets-sync-rows.md) (that file continues when one destination fails and never takes a row off). Distinct from already-recommended find-then-write: [recommendations/google-sheets-row-lookup.md](google-sheets-row-lookup.md) (this file asks the same hint check and scan and never writes). Distinct from later retry: later `retry.ts` (this file wraps `deleteDimension` in `withSheetsRetry("batchUpdate.deleteRow")` — do not pull that file in). Distinct from already-recommended queued plan: [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md) (queued Bad Leads delete only when remembered; this live path always asks for Master Bad Leads when the facade says the flag is off). Distinct from already-recommended queued batch write: [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) (same owner take-off, different **adapter**; queued never imports this file; queued deletes high-to-low in chunks and treats a missing tab as `failed`). Distinct from already-recommended remember-on-document: [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md) (`syncAndStore` never imports this file; it strips the facade’s delete-markers). Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). Distinct from leftover domain delete: [recommendations/form-lead.md](form-lead.md), [recommendations/leads-call-lead.md](leads-call-lead.md), [recommendations/bookings-booked-lead.md](bookings-booked-lead.md), [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md) (those files call the facade when `SHEET_SYNC_MODE` is not `queued`; queued enqueues a tombstone and never reaches here). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names queued vs legacy Bad Leads delete and that missing tab / missing row is idempotent; do not “fix” those in this rename.
- Callers: **one runtime import site, six call sites. No file test.** Already-recommended facade: `googleSheets.service.ts` — `syncFormLeadToSheets` (when `bad_lead` is falsy, always ask this file for Master Bad Leads, even when `sheet_sync[]` never had that target); `syncCallLeadToSheets` (always take the stale opposite Calls / Duplicate Calls tabs off, even when `sheet_sync[]` is empty); `deleteFormLeadFromSheets` (current Forms or Duplicates plus `master_bad_leads` in `syncedTargets`); `deleteCallLeadFromSheets` (current duplicate-aware primary only — stale opposite is the sync-time call); `deleteBookedLeadFromSheets` (Master Booked / Booked Deals); `deleteCancelledLeadFromSheets` (Master Booked / Cancelled Deals). Already-recommended `syncAndStore` / `writeBatchedTargets` / `planJobWrites` / leftover domain services / `v1.service.ts` do **not** import this file. There is no `deleteRows.test.ts`. Not this **interface**: already-recommended Forms-or-Duplicates choice, already-recommended Master-vs-source destination lists, already-recommended `getDeleteTargets` itself, already-recommended hint check / tab scan, already-recommended one-tab ensure, already-recommended continue-on-failure write, already-recommended queued high-to-low batch, later `*ToRow`, later backoff itself.
- Seams callers need: fallback now + remembered then vs this file’s find-and-take-off; remembered `row_number` hint vs full-tab scan; missing tab / missing row no-op vs a Google throw that aborts the rest; return the names we actually took off vs the facade’s `{ status: "deleted" }` stubs; this live per-document take-off vs already-recommended queued high-to-low batch; leftover document delete (void) vs sync-time take-off (returned names)
- Split later (only if the file outgrows one sitting): this ~80-line file is one sitting if you read it as take this document’s row off every destination we must clear, trust the remembered row only if it still holds this Mongo ID, missing tab or missing row is already gone, return only the names we actually took off. If it later splits: `findThisDocumentsRowOnThisReportingTab.ts` / `takeThisRowOffIfTheTabStillExists.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `remove.ts` as a CRUD dump, and never merge already-recommended `getDeleteTargets`, already-recommended `syncRowToTargets`, already-recommended `findRowNumberByMongoId`, already-recommended `writeBatchedTargets`, or leftover `deleteFormLeadFromSheets` into this file

`deleteRowsFromTargets` is executor mechanics. The owner question is: *The facade already chose Forms or Duplicates, Calls or Duplicate Calls, Booked Deals, or Cancelled Deals, and already named the destinations we intend now plus the names we used to write. Ask already-recommended destination naming for the overlay. For each destination, trust the remembered row only if the cell is still this Mongo ID; otherwise scan the tab. If we do not find the row, that destination is already gone — skip it and do not return its name. If we find the row, ask already-recommended `getExistingSheetId`. A missing tab is already gone — skip it and do not return its name. If the tab is still there, take that one row off with `deleteDimension`. Return only the destination names we actually took off so later remember can drop those hints. A Google throw stops the rest of the list and does not return the names we already took off. Do not throw on a miss. Do not persist. Do not write a row. Do not create a tab. Sheets are reporting. They are never the record. The queued writer already batches deletes high-to-low — do not silently switch this file to that path.*

Already-recommended facade tab choice, already-recommended destination naming, already-recommended find-then-write, already-recommended live write loop, already-recommended queued batch, and already-recommended remember-on-document already live in other **modules**. Do not pull those in.

## What this file actually does

Four beats of one “take this document’s row off every destination we must clear — trust the remembered row only if it still holds this Mongo ID — missing tab or missing row is already gone — return only the names we actually took off” story, not “a delete CRUD helper,” and not the facade’s Forms-or-Duplicates choice:

1. **Name the destinations we must take the row off** — `getDeleteTargets(document, fallbackTargets, syncedTargets)` from already-recommended `targets.ts`. Fallback list is the destinations the facade intends now. Overlay remembered `sheet_sync[]` entries whose name is in `syncedTargets`. Attach `knownRowNumber` from a matching hint. This file does not choose Forms vs Duplicates. This file does not decide Master vs Source. This beat does not talk to Google.

2. **Find this document’s row on that tab** — prefer `target.knownRowNumber` only when already-recommended `rowNumberContainsMongoId` is true. Otherwise already-recommended `findRowNumberByMongoId`. Falsy hint (`0` / `undefined`) skips the hint check. No row → `continue` (already gone; do **not** push the name). This beat does not write. This beat does not take a row off.

3. **Take the row off if the tab still exists** — `deleteSheetRow`. Ask already-recommended `getExistingSheetId`. Missing tab → return without throwing and without pushing the name. Otherwise `withSheetsRetry("batchUpdate.deleteRow")` → `spreadsheets.batchUpdate` `deleteDimension` `ROWS` `startIndex: rowNumber - 1`, `endIndex: rowNumber`. One row. One destination. This beat does not ensure a tab. This beat does not sort high-to-low (this file never takes two rows off the same tab in one call — already-recommended `getDeleteTargets` keys by `spreadsheetId:tabName`). This beat does not reserve quota.

4. **Return only the names we actually took off** — after a successful `deleteSheetRow`, push `target.target`. Return `string[]` in visit order. Empty list when every destination was already gone. The already-recommended facade maps those strings onto `{ target, status: "deleted" }`. Leftover `delete*FromSheets` discards the list (void). This beat does not emit the marker itself. This beat does not `document.save()`. This beat does **not** catch — a throw from hint check, scan, `spreadsheets.get`, or `deleteDimension` aborts the rest and never returns the names already pushed.

There is no fifth mutate operation. Tab **choice**, destination overlay itself, hint check / scan themselves, header heal, live write loop, queued high-to-low batch, and persist already live in other files. There is no second export.

## Organization

Keep one file as the screenplay for “take this document’s row off every destination we must clear — trust the remembered row only if it still holds this Mongo ID — missing tab or missing row is already gone — return only the names we actually took off.” Already-recommended facade tab choice, already-recommended `getDeleteTargets`, already-recommended `rowNumberContainsMongoId` / `findRowNumberByMongoId`, already-recommended `getExistingSheetId`, already-recommended `syncRowToTargets`, already-recommended `writeBatchedTargets`, and already-recommended `syncAndStore` already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleSheetsDeleteRowsService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and already-recommended `syncAndStore`. Do not invent a continue-on-failure **seam** beside already-recommended `syncRowToTargets` — this file throws. Do not invent a second queued-delete **adapter** beside already-recommended `writeBatchedTargets`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `remove.ts`. Those are HTTP verbs, not the owner story. Do not move this into `googleSheets.service.ts` so “the facade already takes rows off.” Do not move this into `rowLookup.ts` so “find already lives with take-off.” Do not move this into `batchWriter.ts` so “one delete owns every mode.” Do not silently catch per destination so “delete matches write.” Do not silently require a remembered Bad Leads row so “we match queued.”

**External interface** stays small (this is the test surface). Destination overlay, find, take-off, and the returned names are one story’s live take-off, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `deleteRowsFromTargets` | `takeThisDocumentsRowOffEveryDestinationWeMustClear` | already-recommended facade sync-time take-off + leftover document delete |

Keep the old name as a one-line alias until the already-recommended facade migrates. Do not make callers learn `getDeleteTargets` / `knownRowNumber` / `deleteDimension` as the domain language.

**Principle: old exports stay as aliases.** `deleteRowsFromTargets` remains the imported name until the six facade call sites point at the story name.

**No class for the workflow.** The type that *does* earn a name is the destination this file already walks before it talks to Google:

```ts
type ReportingDestinationWeMustClear = SyncTarget & {
  knownRowNumber?: number
}
```

That is the handoff from already-recommended “name the destinations we used to write” to “find this Mongo ID and take that row off.” Do **not** add `status: "deleted"` so “this file can persist the marker,” do **not** add `duplicate` so “this file can choose Forms or Duplicates,” and do **not** add `cells` so “take-off can write.”

There is no second public export. Do not add `deleteSheetRow` as a public **seam** so “tests can skip the find.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// deleteRows.ts
// The facade already chose the tab and named the destinations
// we intend now plus the names we used to write.
// Ask already-recommended destination naming for the overlay.
// For each destination, trust the remembered row only if the cell
// is still this Mongo ID; otherwise scan the tab.
// If we do not find the row, that destination is already gone.
// If we find the row, ask for the existing tab's sheet id.
// A missing tab is already gone.
// If the tab is still there, take that one row off.
// Return only the names we actually took off
// so later remember can drop those hints.
// A Google throw stops the rest of the list
// and does not return the names we already took off.
// Do not throw on a miss.
// Do not persist.
// Do not write a row.
// Do not create a tab.
// Sheets are reporting. They are never the record.
// The queued writer already batches deletes high-to-low.
// Do not silently switch this file to that path.

// ── 1. Name the destinations we must take the row off ─────

export async function takeThisDocumentsRowOffEveryDestinationWeMustClear(
  document,
  fallbackTargets,
  syncedTargets,
): Promise<string[]>
export const deleteRowsFromTargets =
  takeThisDocumentsRowOffEveryDestinationWeMustClear

function destinationsWeMustClear(document, fallbackTargets, syncedTargets)
  // already-recommended getDeleteTargets
  // fallback now + remembered then
  // knownRowNumber is a hint, not identity

function sheetsClientForThisTakeOff()

// ── 2. Find this document's row on that tab ───────────────

async function findThisDocumentsRowOnThisReportingTab(sheets, target, mongoId)
  // falsy knownRowNumber → scan
  // stale hint → scan
  // already-recommended thisRememberedRowStillHoldsThisMongoId
  // already-recommended findThisDocumentsRowByScanningTheTab
  // miss → undefined (already gone)

// ── 3. Take the row off if the tab still exists ───────────

async function takeThisRowOffIfTheTabStillExists(
  sheets,
  spreadsheetId,
  tabName,
  rowNumber,
)
  // already-recommended getExistingSheetId
  // missing tab → return (already gone, do not throw)
  // deleteDimension ROWS [rowNumber-1, rowNumber)
  // withSheetsRetry("batchUpdate.deleteRow")

// ── 4. Return only the names we actually took off ─────────

function rememberThatWeTookThisDestinationOff(deletedTargets, targetName)
  // push only after deleteDimension succeeded
  // a later throw never returns this list
```

Read the cleared-Bad-Leads path out loud: *The facade already decided this Form is not a Bad Lead and already named Master Bad Leads as the only fallback. We overlay any remembered `master_bad_leads` hint. Mongo remembers row 12. We read that row. The Mongo ID cell is still this document. The tab still exists. We take row 12 off and return `["master_bad_leads"]`. The facade turns that into `{ target: "master_bad_leads", status: "deleted" }`. Later remember drops the hint. We do not write Forms. We do not save the document.*

Read the already-gone path out loud: *The facade still asks for Master Bad Leads even when we never wrote one. The overlay finds no hint. The scan misses. We skip. We return `[]`. The facade concatenates nothing. That is success — the row was not there.*

Read the Call stale-opposite path out loud: *The facade already wrote Duplicate Calls and already named the stale Calls destinations, even when `sheet_sync[]` is empty. We scan Calls by Mongo ID, take that row off if we find it, and return those names. We do not also take Duplicate Calls off. Leftover Call document delete will ask only the current tab.*

Read the leftover Form delete path out loud: *The facade already chose Forms or Duplicates and listed `master_bad_leads` in `syncedTargets`. We take those rows off. The facade discards the returned names. Queued leftover delete never reaches this file — it already enqueued a tombstone.*

Read the throw path out loud: *Master Bad Leads already came off. Source Duplicates then 429s. We throw. The names we already took off never leave this function. Later remember never sees a delete-marker for Master. The next live refresh may try Master again and find the row already gone.*

That is the operation. `deleteRowsFromTargets` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`deleteRowsFromTargets` is executor mechanics.** The owner story is “take this document’s row off every destination we must clear, trust the remembered row only if it still holds this Mongo ID, missing tab or missing row is already gone.” Keep the old name as an alias. Do not grow a `DeleteRowsService` with `create` / `update` / `delete`.

2. **Two take-off adapters, one owner row.** Already-recommended `writeBatchedTargets` groups many documents on one tab, sorts deletes high-to-low, chunks, and reserves quota. This file takes one document off one destination at a time. Knowledge already names both. Keep both **adapters**. Do not silently route `syncFormLeadToSheets` through `writeBatchedTargets` so “one delete owns every mode.” Do not call `writeBatchedTargets` from this file so “live reuses queued.” Do not teach queued to call `deleteRowsFromTargets` so “queued reuses legacy.”

3. **Queued Bad Leads delete only when remembered. Legacy always asks.** Knowledge names both. Already-recommended planner: `!bad_lead && knownRowFor(master_bad_leads)`. Already-recommended facade always calls this file for Master Bad Leads when `bad_lead` is falsy. This file still no-ops when the scan misses. Keep both **adapters**. Do not start requiring a remembered row here so “we match queued.” Do not teach the planner to always plan Bad Leads delete so “we match legacy.”

4. **Call stale opposite is always asked. Leftover Call delete is current-tab only.** Already-recommended facade sync always asks this file for `callLeadTargetBase(!duplicate)`, even when `sheet_sync[]` is empty. Leftover `deleteCallLeadFromSheets` lists only the current primary. Knowledge already names that split. Do not start deleting the stale opposite from leftover Call delete so “one function owns every Call take-off.” Do not drop the sync-time stale delete so “hints are enough.”

5. **Missing tab and missing row are already gone. They are not returned.** Knowledge: missing tab or missing row is a no-op (idempotent). Already-recommended persist: the facade only emits a delete-marker after this file returns the name. Do not push the name on a miss so “remember can drop a hint we never wrote.” Do not throw on a miss so “the take-off is honest.” Queued marks a missing tab `failed` (`sheet tab not found`). Do not adopt that here so “adapters match” — live leftover delete would then fail a document whose tab was never provisioned.

6. **A Google throw aborts the rest and loses names already taken off.** Already-recommended write catches per destination and still returns the bag. This file has no `try`. Hint check, scan, `spreadsheets.get`, and `deleteDimension` can throw. Names already pushed never leave the function. Do not wrap each destination so “delete matches write” without an owner decision — leftover `deleteFormLeadFromSheets` currently fails the whole take-off when one destination 429s, and Mongo may already be gone. Do not return the partial list from a `finally` so “remember can drop Master” without a test that the facade still maps those names after a throw.

7. **Remembered `row_number` is a hint, not identity.** Same refuse as already-recommended write: `knownRowNumber && rowNumberContainsMongoId(...)`. Do not take the hint off without the check so “we save a read.” Do not skip the scan when the hint is missing so “we only clear known rows” — Call stale opposite and legacy Bad Leads always-clear depend on the scan.

8. **This file does not create a tab.** Already-recommended write calls `ensureTabsAndHeaders` before it writes. This file only asks `getExistingSheetId`. Do not start ensuring here so “delete is self-healing” — that would create an empty Bad Leads tab just to discover there is no row.

9. **`getExistingSheetId` is a second Google read after the find.** Hint check or scan already talked to the tab. Then `spreadsheets.get` asks for sheet ids. Queued resolve is the same extra read, then batches. Do not cache the sheet id on `SyncTarget` in this pass so “we save a get.” Do not skip `getExistingSheetId` and parse a sheet id out of the values range so “find already proved the tab” — values ranges do not carry `sheetId`.

10. **One row. One destination. No high-to-low sort.** Already-recommended `getDeleteTargets` keys by `spreadsheetId:tabName`, so this loop never takes two rows off the same tab. Queued sorts descending because one tab can hold many Mongo IDs. Do not sort this list by `knownRowNumber` so “we match queued.” Do not batch several destinations into one `batchUpdate` so “we save writes” — destinations are different spreadsheets or tabs.

11. **`startIndex` is `rowNumber - 1`.** Same 1-based-to-0-based conversion as already-recommended `deleteRequest`. Do not pass `rowNumber` through as `startIndex` so “Sheets is 1-based.” Do not delete `endIndex: rowNumber + 1` so “we clear a leftover pair.”

12. **Retry label stays `batchUpdate.deleteRow`.** Already-recommended queued delete uses `batchUpdate.deleteRows` (plural). Rename the function; keep the string until log / retry searches are migrated on purpose. Leave later `withSheetsRetry` on `retry.ts`. Do not change this label to the queued plural so “one search owns every delete.”

13. **This file does not persist and does not emit `{ status: "deleted" }`.** Already-recommended facade maps the returned strings. Already-recommended `syncAndStore` strips those markers and `remove`s the targets. Leftover document delete discards the list. Do not `document.save()` here so “the taker owns the hint.” Do not return `SheetSyncUpdateEntry[]` so “the facade can stop mapping.”

14. **This file does not reserve quota.** Already-recommended `QuotaLimiter` is a queued-drain **adapter**. Legacy live take-off is unmetered. Do not start reserving a write per destination so “every Google call is honest” without a live-path budget decision. Do not import `QuotaLimiter` so “live matches queued.”

15. **One Sheets client for the whole list.** `getSheetsClient()` runs once before the loop. Do not construct a client per destination so “each take-off is isolated.” Leave later `getSheetsClient` on `auth.ts`.

16. **Leave sibling modules alone.** Already-recommended `syncFormLeadToSheets` / `getDeleteTargets` / `rowNumberContainsMongoId` / `findRowNumberByMongoId` / `getExistingSheetId` stay where they are. Already-recommended `syncRowToTargets` / `writeBatchedTargets` / `syncAndStore` stay where they are. Later `withSheetsRetry` stays on `retry.ts`. This file orchestrates destination overlay → hint-or-scan → existing sheet id → `deleteDimension` → return the names we took off.

## Testing

The **interface** is the test surface: the one export (story name, old name as alias). Destination overlay pass-through, hint-then-scan, missing tab / missing row no-op, `deleteDimension` range, returned names, and throw-aborts-the-rest are part of that **interface**. Stub already-recommended `getDeleteTargets`, already-recommended `rowNumberContainsMongoId` / `findRowNumberByMongoId`, already-recommended `getExistingSheetId`, later `withSheetsRetry`, and `getSheetsClient` in-process; do not boot Google Sheets.

There is no `deleteRows.test.ts` today. That is not enough for a take-off this load-bearing.

Add tests that name the operation:

**Name the destinations we must take the row off**
- `fallbackTargets` + `syncedTargets` + the document are passed through to already-recommended `getDeleteTargets` unchanged (this file does not call `getLeadTargets`).
- Empty overlay → `[]`; no find, no `deleteDimension`.

**Find this document’s row on that tab**
- `knownRowNumber: 12` and hint `true` → no `findRowNumberByMongoId`; take off row 12.
- `knownRowNumber: 12` and hint `false` → scan; do **not** take off 12 unless the scan returns 12.
- `knownRowNumber: 0` / `undefined` → skip the hint check; scan.
- Scan returns `undefined` → no `getExistingSheetId`, no `deleteDimension`, name is **not** returned.

**Take the row off if the tab still exists**
- Found row, `getExistingSheetId` returns a sheet id → one `batchUpdate` with `deleteDimension` `ROWS` `startIndex: rowNumber - 1`, `endIndex: rowNumber`; retry label `batchUpdate.deleteRow`.
- Found row, `getExistingSheetId` returns `undefined` → no `batchUpdate`; name is **not** returned; no throw.
- Two destinations, first found, second missing row → return only the first name.

**Return only the names we actually took off**
- Successful take-off → `[target.target]` (the destination name, not `spreadsheetId:tabName`).
- Every destination already gone → `[]`.
- This file does not return `{ status: "deleted" }` and does not call `document.save()`.

**A Google throw aborts the rest**
- First destination succeeds, second `deleteDimension` throws → the promise rejects; the first name is **not** returned.
- Hint check / scan / `getExistingSheetId` throws → no later destination runs.

**Not this interface**
- Forms-or-Duplicates / Calls-or-Duplicate-Calls / always-clear Bad Leads / always-delete stale opposite stay on [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md).
- Fallback + historical overlay stay on [recommendations/google-sheets-targets.md](google-sheets-targets.md).
- Process-cache ensure / leftover clear stay on [recommendations/google-sheets-tabs.md](google-sheets-tabs.md).
- Hint check / tab scan / in-place write / append stay on [recommendations/google-sheets-row-lookup.md](google-sheets-row-lookup.md).
- Continue-on-failure write / `document.save()` stay on [recommendations/google-sheets-sync-rows.md](google-sheets-sync-rows.md) and [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md).
- Queued high-to-low batch / missing-tab `failed` / quota defer stay on [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) and [recommendations/sheet-sync-quota-limiter.md](sheet-sync-quota-limiter.md).
- Queued Bad Leads only-when-remembered stays on [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md).
- Cell values stay on later `projections/*Row.ts`.
- Backoff itself stays on later `retry.ts`.

Do **not** add a test per helper (`findThisDocumentsRowOnThisReportingTab`, `takeThisRowOffIfTheTabStillExists`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file chooses `Duplicates` from `duplicate=true` — it must not. Do not add a test that this file calls `ensureTabsAndHeaders` — it must not. Do not add a test that this file emits `{ status: "deleted" }` or `document.save()` — it must not. Do not add a test that this file reserves quota — it must not. Do not add a test that queued mode calls this file — it must not. Do not add a test that a missing tab is `failed` the way queued is — this file returns no name. Do not add a test that this file sorts high-to-low — one destination is one row.

## What I would not do

- A `GoogleSheetsDeleteRowsService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `deleteDimension`.
- Moving this into a CRUD folder, or into `googleSheets.service.ts` / `rowLookup.ts` / `batchWriter.ts` / `sheetSyncPersistence.ts` “for cleanliness.”
- Breaking the hint-then-scan **seam**, the missing-tab-or-missing-row-is-already-gone **seam**, or the return-only-names-we-took-off **seam**.
- Treating `syncFormLeadToSheets` / `getDeleteTargets` / `rowNumberContainsMongoId` / `writeBatchedTargets` / `syncAndStore` as this story.
- Inventing a continue-on-failure **seam** that has only one **adapter** here, or a quota-defer **seam** that has only one **adapter** here.
- Silently catching per destination so “delete matches write,” or silently requiring a remembered Bad Leads row so “we match queued,” or silently routing this file through `writeBatchedTargets`, or silently `document.save()`ing, or silently creating a tab, or silently taking the remembered row off without the hint check.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `retry.ts` in this same pass — unchecked `googleSheets` modules remain.
- Making the Form Lead 204 wait on `takeThisDocumentsRowOffEveryDestinationWeMustClear`.
