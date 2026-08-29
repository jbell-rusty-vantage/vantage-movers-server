# Make Sure This Tab Exists And The Header Row Is Current — Once This Process Has Already Done It — Then Clear Leftover Cells Past Today's Last Column — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, in-progress)
- Pass: 3 of this service — `tabs.ts`
- Remaining in this service: `syncRows.ts`, `rowLookup.ts`, `deleteRows.ts`, `retry.ts`, `projections/formLeadRow.ts`, `projections/callLeadRow.ts`, `projections/bookedLeadRow.ts`, `projections/cancelledLeadRow.ts` (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/tabs.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (per-row ensure is the **single tab being written**, not sibling provisioning; sibling provisioning is already-recommended `ensureAllConfiguredSheetTabs`; upsert / `deleteDimension` are later files). Distinct from already-recommended choose-tabs-then-write-or-take-off: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (bootstrap asks this file with the full sibling set; per-row write asks later `syncRowToTargets`, which asks this file with one tab). Distinct from already-recommended destination naming: [recommendations/google-sheets-targets.md](google-sheets-targets.md) (that file names Master / Source / sibling **lists**; this file talks to Google). Distinct from already-recommended queued batch write: [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) (asks this file once per tab, unmetered; a throw fails the tab as `ensure_headers`). Distinct from already-recommended quota: [recommendations/sheet-sync-quota-limiter.md](sheet-sync-quota-limiter.md) (`ensureTabsAndHeaders` is **not** a reserved read/write). Distinct from later upsert: later `syncRows.ts` / `rowLookup.ts` (`clearLegacyTrailingCells` on a data row lives here; finding Mongo ID does not). Distinct from later `deleteDimension`: later `deleteRows.ts` asks only `getExistingSheetId`. Distinct from later retry: later `retry.ts` (`withSheetsRetry` wraps every Google call here — do not pull that file in). Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). Distinct from reporting `columnLetters` and Best Relocation's local `columnLetter` — those are other **modules**. Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names that bootstrap has no `src/` / `scripts/` caller on this disk and that rewriting every sibling header on every row used to blow the write quota; do not “fix” those in this rename.
- Callers: **five runtime import sites, plus the folder test.** Already-recommended facade: `googleSheets.service.ts` — `ensureAllConfiguredSheetTabs` asks this file three ways (Master Leads sibling set, Master Booked sibling set, each Source Company sibling set that has a container id). Later write: `syncRows.ts` — one `{ tabName, headers }` per target, never `target.ensureTabs`. Already-recommended writer: `sheetSync/drainer/batchWriter.ts` — same one-tab ensure (default on; throw → `ensure_headers`) plus `columnLetter` for update / append ranges. Later lookup: `rowLookup.ts` — `clearLegacyTrailingCells` on an in-place data row, plus `columnLetter` for the update / append range. Later delete: `deleteRows.ts` — `getExistingSheetId` only; missing tab is a no-op. Tests: `tabs.test.ts` locks expand-an-undersized-Forms-grid-to-23 plus Timestamp format on column 0 starting at row 1 — not the process cache, not leftover clear, not the already-exists race, not Booked / Cancelled. `v1.service.ts` does **not** re-export this file. Not this **interface**: already-recommended Forms-or-Duplicates choice, already-recommended Master-vs-source destinations, later upsert-by-Mongo-ID, later `deleteDimension`, later `withSheetsRetry` itself, reporting `columnLetters`.
- Seams callers need: bootstrap the sibling set vs ensure the one tab this row is writing; once-per-process cache hit vs cold-start self-heal; leftover clear on header row 1 vs leftover clear on a later data row; find the existing tab’s sheet id (delete) vs create-if-missing (ensure); this Google tab work vs later retry / later upsert / later `deleteDimension`
- Split later (only if the file outgrows one sitting): this ~290-line file is one sitting if you read it as make sure the tab exists and the header is current once per process, then clear leftover cells past today’s last column, then hand later delete the existing sheet id. If it later splits: `makeSureThisReportingTabExistsOncePerProcess.ts` / `clearLeftoverCellsPastTodaysLastColumn.ts` / `findTheExistingTabsSheetId.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `tabs.ts` as a CRUD dump, and never merge already-recommended facade tab choice, already-recommended `getLeadTargets`, later `syncRowToTargets`, later `upsertRow`, later `deleteRowsFromTargets`, or later `withSheetsRetry` into this file

`ensureTabsAndHeaders` / `getExistingSheetId` are executor mechanics. The owner question is: *The facade or the writer already chose Forms or Duplicates, Calls or Duplicate Calls, Booked Deals, or Cancelled Deals, and already named the spreadsheet. Make sure that tab exists and its header row is today’s header — but only once this process has already done it. Rewriting every sibling header on every row used to burn five-plus writes per source-sheet sync and leave source sheets failing 429 while Master, written first, still succeeded. On a cold start we still self-heal: create a missing tab, widen the grid if leftover width is wider than today’s columns, format Timestamp as `M/d/yyyy HH:mm:ss` from row 2 down, clear leftover header cells past today’s last column, then write today’s header. We do not shrink a wider grid. When later upsert writes a data row in place, it also clears leftover cells on that row. When later delete takes a row off, it only needs the existing tab’s sheet id — a missing tab is a no-op. Booked Deals and Cancelled Deals have no leftover width. Sheets are reporting. They are never the record.*

Already-recommended facade tab choice, already-recommended destination naming, later upsert / delete cells, and later retry already live in other **modules**. Do not pull those in.

## What this file actually does

Four beats of one “make sure this tab exists and the header row is current — once this process has already done it — then clear leftover cells past today’s last column” story, not “a tabs CRUD helper,” and not the facade’s Forms-or-Duplicates choice:

1. **Make sure this tab exists and the header row is current — once this process has already done it** — `ensureTabsAndHeaders(sheets, spreadsheetId, tabs)`. For each tab, skip when `spreadsheetId:tabName` is already in the process `Set`. Otherwise: find or add the tab; widen the grid to `max(today’s header length, leftover width)` and never shrink; format the Timestamp column from row 2 down (`M/d/yyyy HH:mm:ss`); clear leftover header cells on row 1; write today’s header with `USER_ENTERED`; then remember the key. Per-row callers pass **one** tab. Bootstrap passes the sibling set from already-recommended `getMasterLeadsTabs` / `getMasterBookedTabs` / `getSourceLeadTabs`. This beat does not choose Forms vs Duplicates. This beat does not write a document row. This beat does not reserve quota.

2. **Clear leftover cells past today’s last column** — `clearLegacyTrailingCells(sheets, spreadsheetId, tabName, headers, rowNumber)`. Leftover width is 19 when `headers === CALL_SHEET_HEADERS`, 23 when `headers === FORM_SHEET_HEADERS`, otherwise today’s length. If leftover width is not greater than today’s length, return. Otherwise `values.clear` from the next column after today through the leftover column on that row. Operation 1 calls this on row 1. Later `upsertRow` calls this on an in-place data row before it overwrites A…today. A copied `[...FORM_SHEET_HEADERS]` array is **not** the form const, so leftover healing is skipped. Booked / Cancelled never hit leftover width. This beat does not append a row. This beat does not delete a dimension.

3. **Find the existing tab’s sheet id** — `getExistingSheetId(sheets, spreadsheetId, tabName)`. One `spreadsheets.get` of `sheetId` / `title` / `columnCount`. Title match only. Missing tab → `undefined`. Later `deleteSheetRow` no-ops on `undefined`. This beat does **not** add a tab. This beat does **not** consult the process cache (the cache stores keys, not sheet ids).

4. **Name the A1 column letter** — `columnLetter(n)` (1 → `A`, 26 → `Z`, 27 → `AA`). Later lookup and already-recommended batch writer use this for update / append ranges. Reporting has its own `columnLetters`. Best Relocation ingest has its own `columnLetter`. This beat does not talk to Google.

There is no fifth mutate operation. Tab **choice**, destination lists, upsert-by-Mongo-ID, `deleteDimension`, and retry backoff are other files. `resetEnsuredTabsCache` is the test / maintenance **seam** that empties the process `Set` so the next ensure talks to Google again.

## Organization

Keep one file as the screenplay for “make sure this tab exists and the header row is current — once this process has already done it — then clear leftover cells past today’s last column.” Already-recommended facade tab choice, already-recommended `getLeadTargets`, later `syncRowToTargets` / `upsertRow` / `deleteRowsFromTargets`, and later `withSheetsRetry` already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleSheetsTabsService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator. Do not invent a second destination-list **adapter** beside already-recommended `getLeadTargets`. Do not invent a second upsert **adapter** beside later `upsertRow`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `get.ts`. Those are HTTP verbs, not the owner story. Do not move this into `googleSheets.service.ts` so “bootstrap already provisions.” Do not move this into `syncRows.ts` so “write already ensures.” Do not silently ensure `target.ensureTabs` on every row so “siblings stay fresh.” Do not silently drop the process cache so “headers stay fresh.”

**External interface** stays small (this is the test surface). Once-per-process ensure, leftover clear, existing sheet id, and the A1 letter are one story’s tab work, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `ensureTabsAndHeaders` | `makeSureThisReportingTabExistsAndItsHeaderIsCurrentOncePerProcess` | bootstrap sibling set + per-row one-tab write + queued batch write |
| `clearLegacyTrailingCells` | `clearLeftoverCellsPastTodaysLastColumn` | header row 1 here; later in-place data row on `rowLookup.ts` |
| `getExistingSheetId` | `findTheExistingTabsSheetId` | later delete — missing tab is a no-op |
| `columnLetter` | keep | A1 letter for later lookup + already-recommended writer ranges |
| `resetEnsuredTabsCache` | keep | test / maintenance — empty the process `Set` |

Keep the old names as one-line aliases until the already-recommended facade, later `syncRows.ts`, already-recommended `batchWriter.ts`, later `rowLookup.ts`, later `deleteRows.ts`, and `tabs.test.ts` migrate. Do not make callers learn `ensuredTabs` / `LEGACY_FORM_SHEET_HEADER_LENGTH` / `spreadsheetId:tabName` as the domain language.

**Principle: old exports stay as aliases.** `ensureTabsAndHeaders` / `clearLegacyTrailingCells` / `getExistingSheetId` remain the imported names until those five runtime sites point at the story names.

**No class for the workflow.** The type that *does* earn a name is the process cache key later writers already need before they skip Google:

```ts
type ReportingTabAlreadyEnsuredThisProcess = {
  spreadsheetId: string
  tabName: string
}
```

That is the handoff from “we already healed this tab in this process” to “do not rewrite the header again.” Do **not** add `headers` so “a later header change re-ensures,” do **not** add `sheetId` so “delete can skip `spreadsheets.get`,” and do **not** add `duplicate` so “this file can choose Forms or Duplicates.”

`columnLetter` stays exported because later lookup and already-recommended batch writer are real **adapters**, not a test leak. Do not add `nameTheA1Range` in this pass so “range building lives here.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// tabs.ts
// The facade or the writer already chose the tab and named the spreadsheet.
// Make sure that tab exists and its header row is today's header.
// Do that only once this process has already done it.
// Rewriting every sibling header on every row used to burn five-plus writes
// per source-sheet sync and leave source sheets failing 429
// while Master, written first, still succeeded.
// On a cold start we still self-heal:
// create a missing tab, widen the grid if leftover width is wider than today,
// format Timestamp, clear leftover header cells, write today's header.
// We do not shrink a wider grid.
// When later upsert writes a data row in place, it also clears leftover cells
// on that row.
// When later delete takes a row off, it only needs the existing tab's sheet id.
// Booked Deals and Cancelled Deals have no leftover width.
// Sheets are reporting. They are never the record.

// ── 1. Make sure this tab exists — once per process ───────

export async function makeSureThisReportingTabExistsAndItsHeaderIsCurrentOncePerProcess(
  sheets,
  spreadsheetId,
  tabs,
)
export const ensureTabsAndHeaders =
  makeSureThisReportingTabExistsAndItsHeaderIsCurrentOncePerProcess

function alreadyEnsuredThisTabThisProcess(spreadsheetId, tabName)
async function findOrAddTheTab(sheets, spreadsheetId, tabName)
  // exists → return sheetId + columnCount
  // missing → addSheet; 400 "already exists" → refetch, do not throw
async function widenTheGridIfLeftoverWidthIsWiderThanToday(sheets, sheet, requiredColumnCount)
  // never shrink
async function formatTimestampFromRowTwoDown(sheets, sheet, headers)
async function writeTodaysHeaderRow(sheets, spreadsheetId, tab)
function rememberWeEnsuredThisTabThisProcess(spreadsheetId, tabName)

export function resetEnsuredTabsCache()

// ── 2. Clear leftover cells past today's last column ──────

export async function clearLeftoverCellsPastTodaysLastColumn(
  sheets,
  spreadsheetId,
  tabName,
  headers,
  rowNumber,
)
export const clearLegacyTrailingCells = clearLeftoverCellsPastTodaysLastColumn

function leftoverWidthForTheseHeaders(headers)
  // headers === CALL_SHEET_HEADERS → 19
  // headers === FORM_SHEET_HEADERS → 23
  // otherwise → headers.length
  // a copied array is not the const — leftover healing is skipped

// ── 3. Find the existing tab's sheet id ───────────────────

export async function findTheExistingTabsSheetId(sheets, spreadsheetId, tabName)
export const getExistingSheetId = findTheExistingTabsSheetId
  // missing → undefined; later delete no-ops
  // does not add a tab
  // does not read the process cache

// ── 4. Name the A1 column letter ──────────────────────────

export function columnLetter(columnNumber)
```

Read the per-row path out loud: *Later write already decided this Form belongs on Master Duplicates. We look up `spreadsheetId:Duplicates` in this process. First time: find or add Duplicates, widen to 23 if the grid is narrower, format Timestamp, clear leftover header cells past column 22, write today’s 22 form headers, remember the key. Second time this process: skip Google. We do not also ensure Forms, Calls, Duplicate Calls, or Bad Leads. That sibling set is bootstrap.*

Read the leftover-clear path out loud: *Later upsert found the Mongo ID on row 40. Before it overwrites A40…V40, it asks us to clear leftover cells on row 40. Form headers are the form const, leftover width is 23, so we clear W40. A copied form-header array would skip that clear. Booked Deals never ask for leftover width.*

Read the delete path out loud: *Later delete already named the spreadsheet and tab. We only look up the existing sheet id. No tab means no delete. We do not create Duplicates so “delete can run.” We do not reuse the process cache — it does not store sheet ids.*

That is the operation. `ensureTabsAndHeaders` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`ensureTabsAndHeaders` / `getExistingSheetId` are executor mechanics.** The owner story is “make sure this tab exists and the header is current once per process — then clear leftover cells past today’s last column.” Keep the old names as aliases. Do not grow a `TabsService` with `create` / `update` / `get`.

2. **The process cache is load-bearing.** The file comment names the old bug: every row sync rewrote every sibling header, multiplied writes, and blew the per-minute quota so source sheets 429’d after Master succeeded. Do not drop the `Set` so “headers stay fresh on every write.” Do not key the cache by spreadsheet only so “one key owns the container.” Do not key it by headers so “a later header-array identity change rewrites.”

3. **Per-row callers pass one tab. Bootstrap passes the sibling set.** Later `syncRowToTargets` and already-recommended `writeBatchedTargets` pass `[{ tabName, headers }]`. Already-recommended `ensureAllConfiguredSheetTabs` passes `getMasterLeadsTabs()` / `getMasterBookedTabs()` / `getSourceLeadTabs(slug)`. Knowledge already names that split. Do not start walking `target.ensureTabs` inside later write so “siblings stay provisioned.” Do not delete bootstrap so “the first row will create every tab.”

4. **Leftover width is an identity check, not a length check.** `headers === CALL_SHEET_HEADERS` → 19. `headers === FORM_SHEET_HEADERS` → 23. Anything else, including `[...FORM_SHEET_HEADERS]` or Booked / Cancelled consts, returns `headers.length` and the clear no-ops. Today’s form list is 22 columns and leftover is 23, so exactly column W is cleared. Today’s call list is 15 columns and leftover is 19, so columns P–S are cleared. Do not switch to `headers.length === 22` so “any 22-col row is leftover.” Do not switch to `headers.includes("Bad Lead")` so “a booked sheet with Timestamp is leftover.” Do not silently drop the identity check so “copied arrays also heal.”

5. **We widen. We never shrink.** `ensureColumnCapacity` returns when `columnCount >= required`. The folder test locks expand-from-`length-1`-to-23. Do not add a shrink so “extra columns go away.” Do not change the test’s 23 to `FORM_SHEET_HEADERS.length` so “we only need today” — 23 is leftover width, not today’s 22.

6. **Already-exists is a refetch, not a throw.** `addSheet` can lose a race. Status 400 plus message containing `already exists` (case-insensitive) refetches properties. Any other 400 still throws. Do not swallow every 400 so “create is best-effort.” Do not treat the race as fatal so “the next row will retry.”

7. **`getExistingSheetId` does not create and does not read the cache.** Later delete no-ops on a missing tab. The process `Set` stores keys, not `sheetId`. Do not call `ensureTabsAndHeaders` from later delete so “delete also heals headers.” Do not start caching `sheetId` in this rename so “delete can skip `spreadsheets.get`” without a later-delete decision.

8. **Timestamp format starts at row 2.** `startRowIndex: 1`, column = `headers.indexOf("Timestamp")`. Missing Timestamp or missing `sheetId` skips. Pattern is `M/d/yyyy HH:mm:ss`. Do not format row 1 so “the header looks like a date.” Do not change the pattern so “ISO is cleaner.”

9. **Ensure is unmetered on the queued writer.** Already named on [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) and [recommendations/sheet-sync-quota-limiter.md](sheet-sync-quota-limiter.md). Do not start reserving a write per ensure so “every Google call is honest” without a drain-budget decision. Do not drop `ensureHeaders` on the writer so “the planner already named the tab.”

10. **`columnLetter` is this file’s A1 helper, not the company’s.** Reporting `columnLetters` and Best Relocation’s local `columnLetter` stay where they are. Do not import those. Do not move this helper into `utils/googleSheets/ranges.ts` in this pass so “one letter function owns the repo.”

11. **`resetEnsuredTabsCache` is a real test seam.** Without it, a second `ensureTabsAndHeaders` in the same process is a cache hit and the expand test would not see `batchUpdate`. Do not hide the helper. Do not reset inside `ensureTabsAndHeaders` so “tests do not need it.”

12. **Leave sibling modules alone.** Already-recommended `ensureAllConfiguredSheetTabs` / `getMasterLeadsTabs` stay where they are. Later `syncRowToTargets` / `upsertRow` / `deleteRowsFromTargets` stay on their files. Later `withSheetsRetry` stays on `retry.ts`. This file orchestrates cache-or-heal → leftover clear → existing sheet id.

## Testing

The **interface** is the test surface: the five exports (story names, old names as aliases). Process-cache skip, leftover identity, already-exists refetch, and missing-tab id are part of that **interface**. Stub the Sheets client in-process; do not boot Google Sheets.

Today’s `tabs.test.ts` only locks expand-an-undersized-Forms-grid-to-23 plus Timestamp format on column 0 starting at row 1. That is not enough for a quota-healing story this load-bearing.

Replace the “grid grew” style with tests that name the operation:

**Make sure this tab exists — once per process**
- First call on Forms with the form const → `spreadsheets.get`, maybe expand, Timestamp format, leftover clear on row 1, header `values.update`, then the key is remembered.
- Second call in the same process on the same spreadsheet:tab → no Google calls.
- After `resetEnsuredTabsCache`, the next call talks to Google again.
- Per-row one-tab list does **not** also ensure sibling tabs (do not assert a `Calls` `addSheet` when the caller passed only `Duplicates`).
- Missing tab → `addSheet`; reply without `sheetId` still writes the header (column / Timestamp format skip).
- `addSheet` 400 `already exists` → refetch, do not throw.
- `addSheet` 400 with any other message → throw.
- Existing grid already ≥ required width → no expand `batchUpdate`.
- Existing grid narrower than leftover width → expand to leftover width (Forms → 23, not 22).
- Never send a shrink.

**Clear leftover cells past today’s last column**
- Form const on row 1 → clear `W1` (column 23) only.
- Call const on row 40 → clear `P40:S40` (columns 16–19).
- `[...FORM_SHEET_HEADERS]` → no clear (identity miss).
- `BOOKED_SHEET_HEADERS` / `CANCELLED_SHEET_HEADERS` → no clear.
- `legacyHeaderLength <= headers.length` → no `values.clear`.

**Find the existing tab’s sheet id**
- Title match → that `sheetId`.
- Missing title → `undefined` (later delete no-ops).
- Does not call `addSheet`.
- Does not consult the process cache.

**A1 column letter**
- Keep a 1 → `A`, 26 → `Z`, 27 → `AA` lock if you already have one; otherwise one example is enough. Do not add a table through `ZZ`.

**Not this interface**
- Forms-or-Duplicates / Calls-or-Duplicate-Calls choice stays on [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) and [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md).
- Master-vs-source destination lists stay on [recommendations/google-sheets-targets.md](google-sheets-targets.md).
- Upsert-by-Mongo-ID stays on later `rowLookup.ts`.
- `deleteDimension` stays on later `deleteRows.ts`.
- Retry / 429 backoff stays on later `retry.ts`.
- Quota reserve stays on already-recommended `QuotaLimiter`.
- Cell values stay on later `projections/*Row.ts`.

Do **not** add a test per helper (`alreadyEnsuredThisTabThisProcess`, `leftoverWidthForTheseHeaders`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file chooses `Duplicates` from `duplicate=true` — it must not. Do not add a test that this file writes a document row — it must not. Do not add a test that this file reserves quota — it must not.

`columnLetter` / `resetEnsuredTabsCache` stay exported because later lookup / the queued writer / the folder test are real **adapters**, not a test leak.

## What I would not do

- A `GoogleSheetsTabsService` class with `create` / `update` / `get`.
- Thirty two-line functions that only wrap `spreadsheets.get`.
- Moving this into a CRUD folder, or into `googleSheets.service.ts` / `syncRows.ts` / `batchWriter.ts` / `deleteRows.ts` “for cleanliness.”
- Breaking the once-per-process cache **seam**, the one-tab-vs-sibling-set **seam**, or the leftover-clear-on-header-and-data-row **seam**.
- Treating `syncFormLeadToSheets` / `syncRowToTargets` / `upsertRow` / `deleteRowsFromTargets` / `withSheetsRetry` as this story.
- Inventing a destination-list **seam** that has only one **adapter** here.
- Silently ensuring `target.ensureTabs` on every row, or silently dropping the process cache, or silently switching leftover width to a length check, or silently shrinking a wider grid, or silently creating a tab from `getExistingSheetId`.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `syncRows.ts` in this same pass — unchecked `googleSheets` modules remain.
- Making the Form Lead 201 wait on `makeSureThisReportingTabExistsAndItsHeaderIsCurrentOncePerProcess`.
