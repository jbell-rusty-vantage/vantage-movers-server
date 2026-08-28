# Write The Planned Sheet Rows Per Tab — Update In Place, Append New, Delete High To Low — Quota Exhaustion Defers The Tab Without Burning An Attempt — operational story

- Status: recommended
- Service: `sheetSync` (Wave A, in-progress)
- Pass: 8 of this service — `drainer/batchWriter.ts`
- Remaining in this service: `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`
- Target: `src/services/sheetSync/drainer/batchWriter.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (queued step 5: batch write per tab via this file + `QuotaLimiter`; quota `deferred` → drain retries in 60s without burning an attempt). Distinct from already-recommended mode-aware persist / finalize / unmigrated schedule: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md). Distinct from already-recommended outbox coalesce + tombstone: [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md). Distinct from already-recommended wake-up: [recommendations/sheet-sync-queue.md](sheet-sync-queue.md). Distinct from already-recommended legacy `document.save()` remember: [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md). Distinct from already-recommended live lookup-then-write: [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md) (legacy `upsertRow` / `deleteRowsFromTargets` is the other write **adapter**; queued never imports it). Distinct from already-recommended take-the-seat / claim / finalize: [recommendations/sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (this file is the write **adapter**; the drain asks it once for the whole planned bag, then `updateOne`s `sheet_sync[]` from the outcomes). Distinct from already-recommended reload-and-plan: [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md) (this file does not choose tabs). Distinct from later tab map / quota: `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`. Distinct from Google Sheets tabs / projections / dual Source Company writes: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (this file calls `ensureTabsAndHeaders` and writes cells; it does not project a Lead). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names queued batch vs legacy per-row upsert; do not “fix” that in this rename.
- Callers: **one runtime import site, plus the drainer barrel, plus the folder test.** Drain: `drainer/runSheetSyncDrain.ts` asks `writeBatchedTargets({ sheets, writes: allWrites, quota })` once after every representative is planned — default `ensureHeaders: true`; empty `allWrites` skips this file. Barrel: `sheetSync/drainer/index.ts` re-exports `writeBatchedTargets`. Service barrel `sheetSync/index.ts` does **not** re-export this file. Coordinator, outbox, queue, persistence, source lookup, and the planner do **not** import it. Tests: `drainer/drainer.test.ts` is this **interface** (update+append one call each, delete high-to-low, missing delete is synced no-op, read-quota defer, update fail + append still synced, append split by `SHEET_SYNC_MAX_ROWS_PER_BATCH`). The same file also locks later `buildTabRowMap` and later `QuotaLimiter` — those are not this **interface**. There is no `knownRowNumber` test and no `ensureHeaders` test on this file.
- Seams callers need: per-write `synced` / `failed` / `deferred` (drain finalizes the job from those); `action` + `rowNumber` (drain remembers `sheet_sync[]` and `SheetSyncAttempt`); injected `sheets` / `quota` (drain and tests); `ensureHeaders` default true on the live drain, false in today’s tests; one Google read per tab, then update → append → delete
- Split later (only if the file outgrows one sitting): this ~400-line file is one sitting if you read it as group-by-tab → read the tab once → update in place → append new → delete high-to-low. If it later splits: `updateTheRowsWeAlreadyKnow.ts` / `appendTheRowsWeDoNotKnow.ts` / `deleteTheRowsHighToLow.ts` — never `upsert.ts` / `delete.ts` / `create.ts` / `update.ts`, and never merge drain claim, planner tab choice, later `buildTabRowMap`, later `QuotaLimiter`, or legacy `upsertRow` into this file

`writeBatchedTargets` is executor mechanics. The owner question is: *The drain already claimed the jobs. The planner already decided which tabs. Group those writes by spreadsheet and tab. Read the tab once. Update the rows the tab still knows, append the rows it does not, then delete high-to-low so an earlier delete never shifts a later one. A remembered row number is not a second lookup — the tab map is the lookup. If that remembered row now belongs to a different Mongo id, append a new row; do not overwrite the stranger. A delete of a row the tab no longer has is success. If we cannot reserve the one read, the whole tab comes back deferred so the drain can retry in a minute without burning an attempt. This file does not claim. This file does not choose tabs. This file does not mark the job.*

Coordinator persist / finalize, outbox coalesce, queue wake-up, legacy lookup-then-write, drain seat / claim / finalize, planner tab choice, later tab map, later quota limiter, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a writer CRUD service,” and not the drain / the planner / the live lookup:

1. **Write the planned sheet rows per tab** — `writeBatchedTargets({ sheets, writes, quota, ensureHeaders? })`. Group `writes` by `spreadsheetId:tabName` (first write’s `headers` win). Per tab: optionally `ensureTabsAndHeaders` (default on; a throw fails every write on that tab as `ensure_headers`). Reserve one `read`. Denied → every write on that tab is `deferred` (`quota_budget_exhausted`, log `sheet_sync.drain.quota_deferral`). Granted → ask sibling `buildTabRowMap`. Map throw fails the tab as `lookup`. Then split: upserts whose `mongoId` is on the map (or whose remembered row still belongs to that same id) become in-place `values.batchUpdate` chunks; the rest become `values.append` chunks (`USER_ENTERED`, `INSERT_ROWS`); deletes whose `mongoId` is missing from the map are `synced` with no Google call; remaining deletes resolve the tab’s `sheetId` (unmetered `spreadsheets.get`), sort high-to-low, and `spreadsheets.batchUpdate` `deleteDimension` chunks. Each write chunk reserves one `write`; denied → those writes `deferred`, later chunks still try. A Google throw fails that chunk only — an update fail does not skip the appends. Append `rowNumber` is `updatedRange` first row plus index. `readsUsed` / `writesUsed` are always `0`. This function does not claim a job. This function does not mark synced / retrying / failed. This function does not choose Forms vs Duplicates vs Booked Deals.

There is no second mutate operation. Mode, wake-up, claim, plan, remember, and outbox coalesce are other files. Legacy `upsertRow` / `deleteRowsFromTargets` are a different **adapter** for the same owner cells, not this file.

## Organization

Keep one file as the screenplay for “write the planned sheet rows per tab — update in place, append new, delete high-to-low — quota exhaustion defers the tab without burning an attempt.” Drain seat / claim / finalize, planner tab choice, later tab map, later quota limiter, legacy per-row upsert, coordinator, outbox, queue, and Google Sheets projections already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncBatchWriterService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and the drain’s `updateOne`. Do not invent a second live-write **adapter** beside already-recommended `upsertRow`. Do not invent a second remember **adapter** beside already-recommended `syncAndStore` / the drain’s `updateOne`.

Do not split this into `upsert.ts` / `delete.ts` / `write.ts`. Those are beats of one tab write. Do not move this into `runSheetSyncDrain.ts` so “the drain already writes.” Do not move this into `googleSheets/rowLookup.ts` so “one upsert owns every mode.” Do not silently call `upsertRow` so “queued reuses legacy.”

**External interface** stays small (this is the test surface). Group, read, update, append, and delete are one story’s write, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `writeBatchedTargets` | `writeThePlannedSheetRowsPerTab` | drain asks once for the whole planned bag |

Keep the old name as a one-line alias until the drain, the drainer barrel, and `drainer.test.ts` migrate. Do not make callers learn `groupByTab` / `buildTabRowMap` / `QuotaLimiter` as the domain language.

**Principle: old exports stay as aliases.** `writeBatchedTargets` remains the imported name until `runSheetSyncDrain` points at the story name.

`PlannedWrite` / `PlannedWriteOutcome` stay in already-skipped `drainer/types.ts`. Do not grow this **interface** with a write-row type the planner already owns.

**No class for the workflow.** The type that *does* earn a name is the per-tab bag we will read once, then write:

```ts
type PlannedSheetTab = {
  spreadsheetId: string
  tabName: string
  headers: readonly string[]
  writes: PlannedWrite[]
}
```

That is the handoff from “the planner returned a flat write list” to “one read, then update / append / delete on this tab.” Do **not** add `status: "synced"` so “the writer can finish the job,” do **not** add `published: true` so “the writer can prove the queue,” and do **not** add `official_booking_details` so “a booked write can confirm.”

`quota` and `sheets` stay on the args because they are a real injected **adapter**, not a second persistence. Default `ensureHeaders` stays `true` because the live drain does not pass `false`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// drainer/batchWriter.ts
// The drain already claimed the jobs.
// The planner already decided which tabs.
// Group those writes by spreadsheet and tab.
// Read the tab once.
// Update the rows the tab still knows.
// Append the rows it does not.
// Delete high-to-low so an earlier delete never shifts a later one.
// A remembered row number is not a second lookup — the tab map is the lookup.
// If that remembered row now belongs to a different Mongo id, append.
// Do not overwrite the stranger.
// A delete of a row the tab no longer has is success.
// If we cannot reserve the one read, the whole tab comes back deferred.
// This file does not claim.
// This file does not choose tabs.
// This file does not mark the job.
// Legacy per-row upsert already writes the same cells.
// Do not silently switch this file to that path.

// ── 1. Write the planned sheet rows per tab ───────────────

export async function writeThePlannedSheetRowsPerTab(args)
export const writeBatchedTargets = writeThePlannedSheetRowsPerTab

function groupTheWritesBySpreadsheetAndTab(writes)
  // first write's headers win

async function writeOneTab(sheets, tab, quota, ensureHeaders)
  // maybe provision the tab
  // reserve one read or defer the whole tab
  // sibling buildTabRowMap
  // update → append → delete

async function updateTheRowsTheTabStillKnows(sheets, tab, updates, quota)
async function appendTheRowsTheTabDoesNotKnow(sheets, tab, appends, quota)
async function deleteTheRowsHighToLow(sheets, tab, deletes, rowMap, quota)
  // missing mongoId → synced, no Google call
  // remaining deletes: unmetered sheetId lookup, then high-to-low chunks

function findTheRowOnThisTab(write, rowMap)
  // map wins
  // remembered row only refuses overwrite when that row now belongs to someone else

function refuseToOverwriteARowThatNowBelongsToSomeoneElse(write, rowMap)
function chunkSoWeStayInsideTheMinute(items, payloadForItem)
function thisWriteSynced(write, action, rowNumber)
function thisWriteFailed(write, action, error)
function thisWriteDeferred(write, action)   // quota_budget_exhausted
```

Read the primary path out loud: *The drain already claimed the jobs and flattened every planned write into one bag. We group that bag by spreadsheet and tab. We read Calls once. The rows the tab still knows we update in place, in as few `batchUpdate`s as the row and payload ceilings allow. The rows it does not know we append together. Then we delete high-to-low so removing row 5 never shifts row 2 out from under us. If the minute is out of reads, we do not write this tab at all — we hand the drain `deferred` so it comes back in sixty seconds without burning an attempt. We do not mark the job. The drain will remember the row numbers we return.*

Read the remembered-row beat out loud: *The planner may have handed us last month’s row number. We do not write there just because we remember it. We look the Mongo id up on the tab we just read. If the tab has that id, that is the row. If the tab does not have that id, and the remembered row now shows a different Mongo id, we append. We do not overwrite the stranger. A delete never uses the remembered number — if the tab map missed the id, we call the delete a success.*

Read the partial-failure beat out loud: *An update chunk can fail and the appends on that same tab still go out. A write-quota deny on one chunk still tries the next chunk. A missing delete is already done. The drain, not this file, decides whether that mix is retrying, deferred, or synced.*

That is the operation. `writeBatchedTargets` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two write **adapters**, one owner cell.** Legacy `upsertRow` / `deleteRowsFromTargets` read-or-write one document at a time through the googleSheets facade. This file reads a tab once and batches. Knowledge already names both. Keep both **adapters**. Do not silently route `syncFormLeadToSheets` through `writeThePlannedSheetRowsPerTab` so “one writer owns every mode,” and do not call `upsertRow` from this file so “queued reuses legacy.”

2. **Update → append → delete is load-bearing.** In-place updates use the row numbers from the read we already did. Appends go at the end (`INSERT_ROWS`). Deletes run last and high-to-low so they never shift an update we just wrote or a later delete we still have to do. Do not delete first so “the tab is clean before we write.” Do not append before update so “new rows are visible first.”

3. **The tab map is the lookup. `knownRowNumber` is a refuse-overwrite, not a fast-path.** `rowMap.get(mongoId) ?? validatedKnownRow(...)` only reaches the remembered number when the map missed that id. If that remembered row now belongs to a different Mongo id, we return `undefined` and append. If the remembered row is empty on the map, we also append — we never write a remembered number the map did not confirm as ours. The type comment still says “fast-path / validation.” Name the refuse. Do not start writing `knownRowNumber` when the map missed us so “we match legacy `rowNumberContainsMongoId`.” Do not drop the refuse so “the map is enough” without a test — the overwrite guard is the reason the function exists.

4. **Deletes ignore `knownRowNumber`.** A delete is `rowMap.get(mongoId)` or “already gone.” A shifted-header row the map missed is reported `synced` and left on the tab. Do not teach deletes to trust `knownRowNumber` in this rename so “we match upserts.” Do not fail a missing delete so “gone must be loud” — the test already locks the no-op.

5. **`ensureTabsAndHeaders` and `resolveSheetId` are unmetered Google calls.** The one tab `values.get` reserves a `read`. Each update / append / delete chunk reserves a `write`. Provisioning the tab and looking up `sheetId` do not reserve. Do not start metering them in this rename so “every Google call is honest” without a drain-budget decision. Do not drop `ensureHeaders` so “the planner already named the tab” — live drain uses the default `true`.

6. **Read-quota deny defers the whole tab, including deletes that would have been no-ops.** We reserve the read before we know whether the map would have found anyone. Name that. Do not skip the read when the bag is delete-only so “gone deletes need no lookup” in this rename.

7. **Partial failure is per chunk, not per tab.** Update fail + append success is locked. Write-quota deny on chunk one still tries chunk two. `ensure_headers` / `lookup` fail the whole tab. Keep those three shapes. Do not fail the tab after one update error so “one Google throw is enough.”

8. **First write’s headers win the group.** Two planned writes to the same `spreadsheetId:tabName` with different `headers` silently use the first. Do not merge header lists in this rename so “the later Form wins.”

9. **`readsUsed` / `writesUsed` always lie.** Every outcome stamps `0`. The drain’s `SheetSyncAttempt` does not persist those fields. Do not start incrementing them in this rename so “the type becomes true,” and do not delete the fields from `types.ts` in this pass — that type is skipped and shared.

10. **Append row numbers come from `updatedRange`, then `+ index`.** A split batch’s second chunk starts at whatever Google returns for that call, not `firstRow + alreadyAppended`. The row-guardrail test’s `[2, 3, 2]` is the fake always returning start row 2. Do not “fix” the fake so “row numbers look sequential.”

11. **`USER_ENTERED` and `INSERT_ROWS` are load-bearing.** Same options as legacy `upsertRow`. Do not switch to `RAW` so “we stop interpreting formulas.” Do not drop `INSERT_ROWS` so “overwrite the leftover block.”

12. **Chunk ceilings are the min of rows, subrequests, and payload bytes.** `chunkByLimits` rereads `getSheetSyncDrainGuardrails()` / `getSheetSyncBudgets()` per chunking. Name the three knobs. Do not collapse to row count so “one env is enough.”

13. **Log message shape is load-bearing.** `sheet_sync.drain.quota_deferral` is the only log this file writes. The drain’s job-level event is `sheet_sync.write.deferred_quota`. Rename functions; keep the strings until log searches are migrated on purpose.

14. **Leave sibling modules alone.** `buildTabRowMap` stays in later `tabRowMap.ts`. `QuotaLimiter.reserve` stays in later `quotaLimiter.ts`. `ensureTabsAndHeaders` / `columnLetter` stay in later `googleSheets/tabs`. `planJobWrites` stays on the already-recommended planner. `runSheetSyncDrain` stays on the already-recommended drain. `upsertRow` stays on later `googleSheets/rowLookup`. `syncAndStore` stays on already-recommended persistence. This file orchestrates group → read once → update / append / delete.

## Testing

The **interface** is the test surface: `writeThePlannedSheetRowsPerTab` (today `writeBatchedTargets`). `{ write, status, action, rowNumber?, error? }` is part of that **interface**. Inject `sheets` and `quota`; do not boot Google Sheets or Mongo.

`drainer.test.ts` already locks update+append batching, delete high-to-low, missing delete as synced no-op, read-quota defer, update fail + append still synced, and append split by `SHEET_SYNC_MAX_ROWS_PER_BATCH`. That is the right **interface**. It is not enough. The same file also tests later `buildTabRowMap` and later `QuotaLimiter` — leave those for those passes; do not treat them as coverage of this file.

**Write the planned sheet rows per tab**
- Existing `mongoId` on the tab → one `values.batchUpdate`, `action: "update"`, `rowNumber` from the map (already locked).
- Missing `mongoId` → one `values.append`, `action: "append"`, `rowNumber` from `updatedRange` + index (already locked).
- Mixed existing + new → one update call and one append call (already locked).
- Two deletes → one `spreadsheets.batchUpdate`, `startIndex` high-to-low (already locked).
- Delete of a `mongoId` the map does not have → `synced`, no delete API call (already locked).
- Read reservation denied → every write on that tab `deferred`, `error: "quota_budget_exhausted"` (already locked).
- Update chunk throws → those writes `failed`; appends on the same tab still `synced` (already locked).
- `SHEET_SYNC_MAX_ROWS_PER_BATCH=2` → appends split 2 then 1 (already locked).
- Remembered `knownRowNumber` whose tab row now shows a **different** Mongo id → append, do not `batchUpdate` that row.
- Remembered `knownRowNumber` whose `mongoId` is already on the map at another row → update the **map** row, not the remembered one.
- Write reservation denied on the first update chunk → those writes `deferred`; later chunks still reserve.
- `ensureHeaders: true` (live drain default) → `ensureTabsAndHeaders` is asked before the read; a throw fails the tab as `ensure_headers` and does not read.
- Two tabs in one bag → two reads, outcomes tagged with each `tabName`.
- Empty `writes` → `[]`, no Google call.

**Not this interface**
- Persist / finalize / unmigrated schedule stay on [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md).
- Remember-or-fold / tombstone enqueue stay on [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md).
- Wake-up stays on [recommendations/sheet-sync-queue.md](sheet-sync-queue.md).
- Legacy `save()` remember stays on [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md).
- Live lookup-then-write / `upsertRow` stay on [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md) and later `googleSheets/`.
- Take-the-seat / claim / empty-plan→`synced` / quota defer **of the job** stay on [recommendations/sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md).
- Reload current Mongo / unmatched skip / vanished Booking stay on [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md).
- Mongo-id column vs shifted-cell fallback stays on later `drainer/tabRowMap.ts` (the `buildTabRowMap` test in this file moves with that pass).
- Token-bucket grant / deny / rollback stays on later `drainer/quotaLimiter.ts` (the limiter test in this file moves with that pass).
- Projection cell values stay on later `googleSheets/projections`.

Do **not** add a test per helper (`groupTheWritesBySpreadsheetAndTab`, `chunkSoWeStayInsideTheMinute`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file marks a job `synced` — it must not. Do not add a test that queued mode calls `upsertRow` — it must not. Do not add a test that a missing delete is `failed` — it must not. Do not add a test that `knownRowNumber` is written when the map missed us and the remembered row is empty — it must not.

`ensureHeaders` stays on the args because the tests are a real **adapter**, not a test leak. Live drain keeps the default `true`.

## What I would not do

- A `SheetSyncBatchWriterService` class with `upsert` / `append` / `delete`.
- Thirty two-line functions that only wrap `quota.reserve`.
- Moving this into a CRUD folder, or into `runSheetSyncDrain.ts` / `jobPlanner.ts` / `googleSheets/rowLookup.ts` “for cleanliness.”
- Breaking the update → append → delete **seam**. Order is the owner story.
- Treating `persistSheetSyncIntent` / `publishSheetSyncWakeup` / `syncAndStore` / `syncSourceLeadById` / `planJobWrites` / `runSheetSyncDrain` as this story.
- Inventing a live-write **seam** that has only one **adapter** here.
- Silently routing this file through `upsertRow`, or silently writing a remembered row the tab map did not confirm as ours, or silently failing a missing delete.
- Writing a whole-folder recommendation for `sheetSync`.
- Jumping to `googleSheets` while this checklist has unchecked modules.
- Marking the job `synced` from this file, or making the Form Lead 201 wait on a batch write.
