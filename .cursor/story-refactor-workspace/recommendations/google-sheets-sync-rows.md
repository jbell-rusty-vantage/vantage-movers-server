# Write This Document's Row Onto Each Named Destination — One Tab At A Time — Continue When One Destination Fails — Remember Synced And Failed So Mongo Can Store The Hints — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, in-progress)
- Pass: 4 of this service — `syncRows.ts`
- Remaining in this service: `rowLookup.ts`, `deleteRows.ts`, `retry.ts`, `projections/formLeadRow.ts`, `projections/callLeadRow.ts`, `projections/bookedLeadRow.ts`, `projections/cancelledLeadRow.ts` (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/syncRows.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (for each target: ensure the **single tab being written**, upsert by Lead ID, use `sheet_sync[].row_number` when it still contains that Mongo ID, per-target failures stay on that result and other targets still attempt; sibling provisioning is already-recommended `ensureAllConfiguredSheetTabs`). Distinct from already-recommended choose-tabs-then-write-or-take-off: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (that facade **asks** this file after it chose Forms or Duplicates / Calls or Duplicate Calls / Booked Deals / Cancelled Deals and after later projections built the cells; it concatenates later `deleteRowsFromTargets` delete-markers onto this file’s write results). Distinct from already-recommended destination naming: [recommendations/google-sheets-targets.md](google-sheets-targets.md) (that file names Master / Source; this file writes them). Distinct from already-recommended one-tab ensure: [recommendations/google-sheets-tabs.md](google-sheets-tabs.md) (this file asks `ensureTabsAndHeaders` with **one** `{ tabName, headers }`, never `target.ensureTabs`). Distinct from already-recommended remember-on-document: [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md) (`syncAndStore` awaits the facade, not this file; this file logs `sheets.sync.target.*` / `sheets.sync.finished`; persistence logs `sheet_sync.document.*` — keep both). Distinct from already-recommended queued batch write: [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) (same owner cells, different **adapter**; queued never imports this file). Distinct from later upsert-by-Mongo-ID: later `rowLookup.ts` (this file only **hands** the remembered `row_number` and the already-projected cells). Distinct from later `deleteDimension`: later `deleteRows.ts`. Distinct from later retry: later `retry.ts` (later `upsertRow` / already-recommended ensure wrap Google; this file does not). Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names the one-tab-vs-sibling split and that rewriting every sibling header on every row used to blow the write quota; do not “fix” those in this rename.
- Callers: **one runtime import site, four call sites. No file test.** Already-recommended facade: `googleSheets.service.ts` — `syncFormLeadToSheets` (Master / maybe Source, plus Master Bad Leads when `bad_lead`); `syncCallLeadToSheets` (current Calls or Duplicate Calls only — stale opposite is later delete, not this file); `syncBookedLeadToSheets` (Master Booked / Booked Deals); `syncCancelledLeadToSheets` (Master Booked / Cancelled Deals). Already-recommended `syncAndStore` does **not** import this file — it injects those four facade writers. Already-recommended `writeBatchedTargets` does **not** import this file. `v1.service.ts` does **not** re-export this file. There is no `syncRows.test.ts`. Not this **interface**: already-recommended Forms-or-Duplicates choice, already-recommended Master-vs-source destinations, already-recommended one-tab ensure itself, later upsert-by-Mongo-ID, later `deleteDimension`, later `*ToRow`, already-recommended `planJobWrites` / `writeBatchedTargets`, already-recommended `syncAndStore` merge / `document.save()`.
- Seams callers need: write every named destination vs stop at the first Google throw; one-tab ensure vs sibling provision; remembered `row_number` hint vs later full-tab lookup; this live per-document write vs already-recommended queued batch write; return `SheetSyncEntry[]` (synced / failed only) vs the facade’s later delete-markers; this file’s per-target logs vs already-recommended document-level `sheet_sync.document.*`
- Split later (only if the file outgrows one sitting): this ~115-line file is one sitting if you read it as write this document’s row onto each named destination, one tab at a time, continue when one fails, remember synced and failed so Mongo can store the hints. If it later splits: `attemptThisNamedDestination.ts` / `rememberWhetherThisDestinationSyncedOrFailed.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `sync.ts` as a CRUD dump, and never merge already-recommended facade tab choice, already-recommended `getLeadTargets`, already-recommended `ensureTabsAndHeaders`, later `upsertRow`, later `deleteRowsFromTargets`, or already-recommended `writeBatchedTargets` into this file

`syncRowToTargets` is executor mechanics. The owner question is: *The facade already chose Forms or Duplicates, Calls or Duplicate Calls, Booked Deals, or Cancelled Deals, already named Master (and maybe the Source Company sheet, and maybe Master Bad Leads), and already projected the cells. For each named destination, make sure that one tab exists, then write or update this document’s row. Prefer the remembered `sheet_sync[].row_number` when we have one — later lookup still checks that the cell is still this Mongo ID. If Master succeeds and the Source Company sheet 429s, still return both results so later remember can store the failure. Do not walk `target.ensureTabs`. Rewriting every sibling header on every row used to burn five-plus writes per source-sheet sync and leave source sheets failing 429 while Master, written first, still succeeded. Do not throw. Do not persist. Do not take a row off. Sheets are reporting. They are never the record. The queued writer already batches the same cells — do not silently switch this file to that path.*

Already-recommended facade tab choice, already-recommended destination naming, already-recommended one-tab ensure, later upsert / delete cells, already-recommended queued batch write, and already-recommended remember-on-document already live in other **modules**. Do not pull those in.

## What this file actually does

Three beats of one “write this document’s row onto each named destination — one tab at a time — continue when one destination fails — remember synced and failed so Mongo can store the hints” story, not “a sync CRUD helper,” and not the facade’s Forms-or-Duplicates choice:

1. **Attempt this named destination — one tab only** — inside `syncRowToTargets`’s loop. Ask already-recommended `ensureTabsAndHeaders` with `[{ tabName, headers }]` for **this** target. Find `document.sheet_sync` whose `target` name matches. Hand later `upsertRow` the Sheets client, spreadsheet, tab, headers, already-projected cells, Mongo ID, and that remembered `row_number`. This beat does not choose Forms vs Duplicates. This beat does not walk `target.ensureTabs`. This beat does not persist. This beat does not reserve quota.

2. **Remember whether this destination synced or failed — do not throw** — success → `{ target, spreadsheet_id, tab_name, row_number, status: "synced", last_synced_at, updated_since_last_sync: false }` and `sheets.sync.target.ok`. Failure → format later `formatGoogleApiError`, keep `status: "failed"`, `last_error` (`message — hint` when a hint exists), `updated_since_last_sync: true`, **no** `row_number`, and `sheets.sync.target.failed`. Then continue to the next destination. An empty `targets` list returns `[]`. This beat does not emit `{ status: "deleted" }`. This beat does not abort the rest of the list.

3. **Return every destination’s result so later remember can merge onto `sheet_sync[]`** — log `sheets.sync.finished` with `synced` / `failed` counts. Return `SheetSyncEntry[]` in caller order. Already-recommended `syncAndStore` never imports this file; the facade does, then later remember merges these entries (failed still stores) and concatenates its own delete-markers from later `deleteRowsFromTargets`. This beat does not `document.save()`. This beat does not `updateOne`.

There is no fourth mutate operation. Tab **choice**, destination lists, header heal itself, upsert-by-Mongo-ID, `deleteDimension`, queued batch, and persist already live in other files. There is no second export.

## Organization

Keep one file as the screenplay for “write this document’s row onto each named destination — one tab at a time — continue when one destination fails — remember synced and failed so Mongo can store the hints.” Already-recommended facade tab choice, already-recommended `getLeadTargets`, already-recommended `ensureTabsAndHeaders`, later `upsertRow` / `deleteRowsFromTargets`, already-recommended `writeBatchedTargets`, and already-recommended `syncAndStore` already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleSheetsSyncRowsService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and already-recommended `syncAndStore`. Do not invent a second tab-choice **adapter** beside already-recommended `callLeadTargetBase`. Do not invent a second batch-write **adapter** beside already-recommended `writeBatchedTargets`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `sync.ts`. Those are HTTP verbs, not the owner story. Do not move this into `googleSheets.service.ts` so “the facade already writes.” Do not move this into `rowLookup.ts` so “upsert already loops.” Do not silently walk `target.ensureTabs` so “siblings stay fresh.” Do not silently throw on the first failed destination so “the write is atomic.” Do not silently call `writeBatchedTargets` so “queued reuses live.”

**External interface** stays small (this is the test surface). One-tab attempt, continue-on-failure, and the remembered result bag are one story’s live write, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `syncRowToTargets` | `writeThisDocumentsRowOntoEachNamedDestinationOneTabAtATime` | already-recommended facade Form / Call / Booking / Cancellation write |

Keep the old name as a one-line alias until the already-recommended facade migrates. Do not make callers learn `ensureTabsAndHeaders` / `upsertRow` / `sheet_sync[].row_number` as the domain language.

**Principle: old exports stay as aliases.** `syncRowToTargets` remains the imported name until the four facade writers point at the story name.

**No class for the workflow.** The type that *does* earn a name is the remembered destination result later persist already merges:

```ts
type RememberedReportingWrite = SheetSyncEntry & {
  status: "synced" | "failed"
}
```

That is the handoff from “we tried this spreadsheet:tab” to “later remember can merge it onto `sheet_sync[]` — a failed write still stores.” Do **not** add `status: "deleted"` so “this file can take a row off,” do **not** add `status: "deferred"` so “this file can honor quota,” and do **not** add `duplicate` so “this file can choose Forms or Duplicates.”

There is no second public export. Do not add `writeOneTarget` as a public **seam** so “tests can skip the loop.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// syncRows.ts
// The facade already chose the tab, named the destinations, and projected the cells.
// For each named destination, make sure that one tab exists,
// then write or update this document's row.
// Prefer the remembered row number when we have one.
// Later lookup still checks that the cell is still this Mongo ID.
// If Master succeeds and the Source Company sheet 429s,
// still return both results so later remember can store the failure.
// Do not walk sibling tabs.
// Rewriting every sibling header on every row used to burn five-plus writes
// per source-sheet sync and leave source sheets failing 429
// while Master, written first, still succeeded.
// Do not throw.
// Do not persist.
// Do not take a row off.
// Sheets are reporting. They are never the record.
// The queued writer already batches the same cells.
// Do not silently switch this file to that path.

// ── 1. Attempt this named destination — one tab only ──────

export async function writeThisDocumentsRowOntoEachNamedDestinationOneTabAtATime(
  document,
  targets,
  alreadyProjectedCells,
): Promise<RememberedReportingWrite[]>
export const syncRowToTargets =
  writeThisDocumentsRowOntoEachNamedDestinationOneTabAtATime

function sheetsClientForThisWrite()
function logThatTheLiveWriteStarted(documentId, targets)

async function attemptThisNamedDestination(sheets, document, target, alreadyProjectedCells)
  // ensure [{ tabName, headers }] only — never target.ensureTabs
  // remembered row_number is a hint, not a second identity
  // later upsertRow writes or appends

function rememberedRowNumberForThisTarget(document, target)

// ── 2. Remember whether this destination synced or failed ─

function rememberThisDestinationSynced(target, rowNumber)
function rememberThisDestinationFailed(target, error)
  // last_error = message — hint when a hint exists
  // no row_number
  // do not throw — the next destination still runs

// ── 3. Return every destination's result ──────────────────

function logThatTheLiveWriteFinished(documentId, results)
  // return caller order
  // empty targets → []
```

Read the Form dual-write path out loud: *The facade already decided this Form is a Duplicate Lead and already named Master Duplicates, then Source Duplicates because the flag is on. We ensure Duplicates on Master only, hand later upsert the remembered Master row if we have one, and store synced. Then we ensure Duplicates on the Source Company sheet only. If Google 429s, we store failed with the hint and keep going. We do not also ensure Forms, Calls, Duplicate Calls, or Bad Leads. We do not save the document. Later remember merges both entries.*

Read the Booking path out loud: *The facade already named one destination: Master Booked / Booked Deals. We ensure that one tab, upsert the already-projected booked cells, and return one synced or one failed entry. We do not follow `lead_ref`. We do not write Cancelled Deals.*

Read the continue-on-failure beat out loud: *A throw from ensure or upsert is this destination’s failure, not the write’s failure. Master can succeed after Source failed. Source can succeed after Master failed. An empty list is an empty result. We never return `{ status: "deleted" }` — taking a row off is later delete, concatenated by the facade.*

That is the operation. `syncRowToTargets` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`syncRowToTargets` is executor mechanics.** The owner story is “write this document’s row onto each named destination, one tab at a time, continue when one fails.” Keep the old name as an alias. Do not grow a `SyncRowsService` with `create` / `update` / `sync`.

2. **One tab only is load-bearing.** The file comment names the old bug: ensuring `target.ensureTabs` on every row rewrote five-plus header rows per source-sheet write and was the main driver of Sheets write-quota exhaustion. Full sibling provision stays on already-recommended `ensureAllConfiguredSheetTabs`. Knowledge already names that split. Do not start walking `target.ensureTabs` so “siblings stay provisioned.” Do not drop the ensure so “bootstrap already created the tab” — a cold process still self-heals the one tab being written.

3. **Per-target catch is the continue-on-failure seam.** Knowledge: “Per-target failures stay on that result; other targets still attempt.” Do not rethrow so “the write is atomic.” Do not wrap the whole `for` in one `try` so “one log owns the write.” Do not skip remaining targets after the first `failed` so “we stop wasting quota.”

4. **Failed still stores. Failed has no row number.** Success sets `updated_since_last_sync: false` and `last_synced_at`. Failure sets `updated_since_last_sync: true` and `last_error`, and omits `row_number`. Already-recommended remember merges failed entries onto `sheet_sync[]`. Do not drop a failed result so “Mongo only keeps successes.” Do not copy the previous `row_number` onto a failed entry so “the hint stays warm” — later lookup must not trust a row we just failed to write.

5. **This file does not emit delete-markers.** `{ status: "deleted" }` is a facade / persistence union (`SheetSyncUpdateEntry`). This file’s return type is `SheetSyncEntry[]` — `pending` | `synced` | `failed`. Do not push `{ status: "deleted" }` so “one function owns write and take-off.” Later `deleteRowsFromTargets` stays on `deleteRows.ts`. The facade concatenates those stubs after this file returns.

6. **Remembered `row_number` is a hint, not identity.** This file passes `existingSync?.row_number` into later `upsertRow`. Later lookup still checks that the cell is this Mongo ID, then falls back to a full-tab scan. Do not verify the cell here so “the loop is honest.” Do not skip later `upsertRow` when the hint is missing so “we only refresh known rows.”

7. **Two write adapters, one owner cell.** Already-recommended `writeBatchedTargets` reads a tab once and batches. This file writes one document through later `upsertRow`. Knowledge already names both. Keep both **adapters**. Do not silently route `syncFormLeadToSheets` through `writeBatchedTargets` so “one writer owns every mode.” Do not call `writeBatchedTargets` from this file so “live reuses queued.”

8. **This file does not persist.** Already-recommended `syncAndStore` `save()`s. The queued drain `updateOne`s. This file only returns the bag. Do not `document.save()` here so “the writer owns the hint.” Do not import `mergeSheetSyncEntries` so “the loop can finish the document.”

9. **Logs are two layers on purpose.** This file: `sheets.sync.started` / `sheets.sync.target.ok` / `sheets.sync.target.failed` / `sheets.sync.finished`. Already-recommended persistence: `sheet_sync.document.ok` / `sheet_sync.document.partial_failure`. Already named on [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md). Do not drop the per-target logs so “remember already said it.” Do not drop the document logs in that other file so “the writer already said it.”

10. **One Sheets client for the whole list.** `getSheetsClient()` runs once before the loop. Do not construct a client per target so “each destination is isolated.” Leave later `getSheetsClient` on `auth.ts`.

11. **Ensure and upsert are unmetered here.** Already-recommended `QuotaLimiter` is a queued-drain **adapter**. Legacy live write does not reserve. Do not start reserving a write per destination so “every Google call is honest” without a live-path budget decision. Do not import `QuotaLimiter` so “live matches queued.”

12. **Caller order is the write order.** Already-recommended `getLeadTargets` pushes Master first, then maybe Source. The facade may append Master Bad Leads after that. Do not sort targets here so “Master always wins.” Do not write Source first so “we fail closed earlier.”

13. **Leave sibling modules alone.** Already-recommended `syncFormLeadToSheets` / `getLeadTargets` / `ensureTabsAndHeaders` stay where they are. Later `upsertRow` stays on `rowLookup.ts`. Later `deleteRowsFromTargets` stays on `deleteRows.ts`. Already-recommended `writeBatchedTargets` / `syncAndStore` stay where they are. This file orchestrates one-tab ensure → later upsert → remember synced or failed → next destination.

## Testing

The **interface** is the test surface: the one export (story name, old name as alias). One-tab ensure, continue-on-failure, remembered `row_number` pass-through, and the synced / failed shapes are part of that **interface**. Stub already-recommended `ensureTabsAndHeaders`, later `upsertRow`, and `getSheetsClient` in-process; do not boot Google Sheets.

There is no `syncRows.test.ts` today. That is not enough for a continue-on-failure write this load-bearing.

Add tests that name the operation:

**Attempt this named destination — one tab only**
- One target → `ensureTabsAndHeaders` is called with exactly `[{ tabName, headers }]` for that tab, never `target.ensureTabs`.
- Two targets → ensure is called twice, once per tab, still one-tab lists.
- Remembered `sheet_sync` matching `target.target` → later `upsertRow` receives that `row_number`.
- No matching `sheet_sync` → later `upsertRow` receives `undefined` for the hint.
- Already-projected cells and the document Mongo ID are passed through unchanged (this file does not call `formLeadToRow`).

**Remember whether this destination synced or failed**
- `upsertRow` returns `40` → one `synced` entry with `row_number: 40`, `updated_since_last_sync: false`, `last_synced_at` set.
- `upsertRow` returns `undefined` → still `synced`; `row_number` is omitted or `undefined` (do not invent `0`).
- `ensureTabsAndHeaders` throws → `failed` with `last_error`, no `row_number`, `updated_since_last_sync: true`; later `upsertRow` is **not** called for that target.
- `upsertRow` throws after ensure → `failed`; ensure already happened.
- Master throws, Source succeeds → two results, first `failed`, second `synced` (do not abort the list).
- Source throws, Master already succeeded → first `synced`, second `failed`.
- Empty `targets` → `[]`; no ensure, no upsert.

**Return every destination’s result**
- Return order matches caller order.
- No `{ status: "deleted" }` and no `{ status: "pending" }` from this file.
- This file does not call `document.save()` / `updateOne` / `mergeSheetSyncEntries`.

**Not this interface**
- Forms-or-Duplicates / Calls-or-Duplicate-Calls choice stays on [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md).
- Master-vs-source destination lists stay on [recommendations/google-sheets-targets.md](google-sheets-targets.md).
- Process-cache ensure / leftover header clear stay on [recommendations/google-sheets-tabs.md](google-sheets-tabs.md).
- Upsert-by-Mongo-ID / `USER_ENTERED` / `INSERT_ROWS` stay on later `rowLookup.ts`.
- `deleteDimension` and stale opposite Call tabs stay on later `deleteRows.ts` / the facade.
- Queued batch / quota defer stay on [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) and [recommendations/sheet-sync-quota-limiter.md](sheet-sync-quota-limiter.md).
- `document.save()` merge stays on [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md).
- Cell values stay on later `projections/*Row.ts`.

Do **not** add a test per helper (`attemptThisNamedDestination`, `rememberedRowNumberForThisTarget`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file chooses `Duplicates` from `duplicate=true` — it must not. Do not add a test that this file walks `ensureTabs` — it must not. Do not add a test that this file emits `{ status: "deleted" }` — it must not. Do not add a test that this file reserves quota — it must not. Do not add a test that queued mode calls this file — it must not.

## What I would not do

- A `GoogleSheetsSyncRowsService` class with `create` / `update` / `sync`.
- Thirty two-line functions that only wrap `upsertRow`.
- Moving this into a CRUD folder, or into `googleSheets.service.ts` / `rowLookup.ts` / `batchWriter.ts` / `sheetSyncPersistence.ts` “for cleanliness.”
- Breaking the one-tab-ensure **seam**, the continue-on-failure **seam**, or the return-the-bag-do-not-persist **seam**.
- Treating `syncFormLeadToSheets` / `ensureTabsAndHeaders` / `upsertRow` / `deleteRowsFromTargets` / `writeBatchedTargets` / `syncAndStore` as this story.
- Inventing a quota-defer **seam** that has only one **adapter** here.
- Silently walking `target.ensureTabs`, or silently throwing on the first failed destination, or silently routing this file through `writeBatchedTargets`, or silently `document.save()`ing, or silently emitting `{ status: "deleted" }`.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `rowLookup.ts` in this same pass — unchecked `googleSheets` modules remain.
- Making the Form Lead 201 wait on `writeThisDocumentsRowOntoEachNamedDestinationOneTabAtATime`.
