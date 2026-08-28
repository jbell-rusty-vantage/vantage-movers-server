# After The Live Sheet Write, Remember The Row Hints On The Document — Drop Deleted Tabs, Keep Untouched Tabs, Save, And Say If Any Tab Failed — operational story

- Status: recommended
- Service: `sheetSync` (Wave A, in-progress)
- Pass: 4 of this service — `sheetSyncPersistence.ts`
- Remaining in this service: `sheetSyncSourceLookup.ts`, `drainer/runSheetSyncDrain.ts`, `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`
- Target: `src/services/sheetSync/sheetSyncPersistence.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (domain documents store `sheet_sync[]`; row_number is a hint; Lead ID is identity). Distinct from already-recommended mode-aware persist / finalize / unmigrated schedule: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md). Distinct from already-recommended outbox coalesce + tombstone: [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md). Distinct from already-recommended wake-up: [recommendations/sheet-sync-queue.md](sheet-sync-queue.md). Distinct from later lookup-then-write (this file’s only runtime caller): `sheetSyncSourceLookup.ts`. Distinct from later drain persist (`updateOne` of `sheet_sync[]`, must not abort the run; persist failure flips those outcomes to `failed`): `drainer/runSheetSyncDrain.ts` `persistDocSheetSync` / `persistSheetSyncMetadata`. Distinct from Google Sheets tabs / projections / dual Source Company writes: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (writers return updated entries stored here in **legacy**, or by the drain’s `updateOne` in **queued**). Distinct from merge / remove helpers themselves: `src/models/schemaHelpers.ts` (`mergeSheetSyncEntries`, `removeSheetSyncEntries`, `SheetSyncEntry`). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). Distinct from Form Lead remember-then-dispatch (that file snapshots + tombstones through the outbox **seam**; it does not call this file): [recommendations/form-lead.md](form-lead.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names the two remember paths (legacy `syncAndStore` vs queued drain `updateOne`); do not “fix” that in this rename.
- Callers: **one runtime import site, four call sites, plus a type import and the barrel. No folder test.** Runtime: later `sheetSyncSourceLookup.ts` — `syncBookedLeadById` / `syncBookingAndSource` (`syncBookedLeadToSheets`), `syncCancellationChainById` (`syncCancelledLeadToSheets`), `syncSourceLead` (`syncCallLeadToSheets` / `syncFormLeadToSheets`). Coordinator `runFullSheetSyncProcess` reaches here only through that later lookup sibling (legacy `waitUntil` / tests / scripts). Type-only: `googleSheets/googleSheets.service.ts` imports `SheetSyncUpdateEntry` so Form / Call writers can return `{ target, status: "deleted" }` after `deleteRowsFromTargets`. Barrel: `sheetSync/index.ts` re-exports `syncAndStore` / `SheetSyncDocument` / `SheetSyncFn` — no domain service imports those symbols from the barrel today. `v1.service.ts` does **not** re-export this file. Not this **interface**: coordinator persist / finalize, outbox remember / tombstone, queue wake-up, later drain `updateOne`, later source lookup itself, later `googleSheets/` writers, admin retry / health, cron / queue consumer. There is no `sheetSyncPersistence.test.ts`. Merge / remove helpers have no dedicated test either.
- Seams callers need: injected live writer vs remember-on-document; delete-marker (never stored) vs stored `SheetSyncEntry`; keep untouched targets; `document.save()` (legacy, can throw) vs later drain `updateOne` (queued, must not abort the run); Form / Call / Booked / Cancelled all fit the loose document shape; googleSheets writers depend on the delete-marker union
- Split later (only if the file outgrows one sitting): keep one file — this ~80-line module is one screenplay. Never `save.ts` / `merge.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge coordinator mode, outbox, queue, source lookup, drain `updateOne`, or Google Sheets projections into this file

`syncAndStore` is executor mechanics. The owner question is: *We just wrote (or tried to write) Google Sheets for this Lead, Booking, or Cancellation. Merge the new row hints onto `sheet_sync[]`, drop the tabs we just deleted, keep every tab this write did not touch, save the document, and say whether every tab succeeded. Do not decide which tabs to write. Do not talk to Google Sheets yourself. Do not write the outbox. The queued drain remembers the same hints a different way — a direct `updateOne` that must not stop the run. Do not silently switch this file to that path.*

Coordinator persist / finalize, outbox coalesce, queue wake-up, source lookup, drain, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

One operation of one “after the live sheet write, remember the row hints on the document” story, not “a persistence CRUD service,” and not the writer / lookup / drain:

1. **After the live sheet write, remember the row hints on the document** — `syncAndStore`. Accept a hydrated Form / Call / Booked / Cancelled document and an injected writer (`SheetSyncFn`). Await the writer. Split the returned bag into delete-markers (`status === "deleted"`) and stored entries (everything else). Drop those deleted targets from the live `sheet_sync[]`. Merge the remaining entries onto what is left — a later write refreshes a target, a failed write still stores `failed` / `last_error`, an untouched target stays as-is. `set` the merged array and `save()` the document. If any stored entry is `failed`, log `sheet_sync.document.partial_failure` with those targets and the summary, then return. Otherwise log `sheet_sync.document.ok`. This beat does not choose tabs. This beat does not talk to Google Sheets. This beat does not write `sheet_sync_jobs`. This beat does not publish.

There is no second mutate operation. Mode, wake-up, tab routing, quota, and outbox coalesce are other files. The queued drain’s `persistSheetSyncMetadata` is a different **adapter** for the same owner hint, not this file.

## Organization

Keep one file as the screenplay for “after the live sheet write, remember the row hints on the document — drop deleted tabs, keep untouched tabs, save, and say if any tab failed.” Coordinator, outbox, queue, lookup, drain, and Google Sheets writers already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncPersistenceService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator. Do not invent a second merge **adapter** beside `schemaHelpers` `mergeSheetSyncEntries` / `removeSheetSyncEntries`. Do not invent a drain `updateOne` **adapter** here.

Do not move this into `sheetSyncSourceLookup.ts` so “lookup owns the save.” Do not move this into `googleSheets.service.ts` so “the writer owns the hint.” Do not move this into the drain so “one persist owns every mode.” Do not split `create.ts` / `update.ts` / `delete.ts`. Do not silently `updateOne` so “we match queued.” Do not silently swallow a `save()` throw so “legacy never aborts.”

**External interface** stays small (this is the test surface). Ask-the-writer, drop-deleted, merge, save, and say-if-failed are one story’s remember, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `syncAndStore` | `rememberTheSheetRowsOnTheDocumentAfterTheLiveWrite` | later source lookup after each live Form / Call / Booked / Cancelled write |
| `SheetSyncDocument` | `SheetSyncDocument` | loose hydrated shape Form / Call / Booked / Cancelled all fit |
| `SheetSyncFn` | `LiveSheetWriter` | injected googleSheets writer; this file does not own tabs |
| `SheetSyncUpdateEntry` | `SheetWriteResult` | union writers return — stored entry **or** delete-marker |
| `SheetSyncDeleteEntry` | `DeletedSheetTarget` | `{ target, status: "deleted" }`; never stored on the document |

Keep the old name as a one-line alias until the later lookup sibling and the barrel migrate. Do not make callers learn `mergeSheetSyncEntries` / `removeSheetSyncEntries` / `document.save` as the domain language.

**Principle: old exports stay as aliases.** `syncAndStore` remains the imported name until `syncSourceLead` / `syncBookedLeadById` / `syncCancellationChainById` point at the story name.

**No class for the workflow.** The type that *does* earn a name is the delete-marker the writers already emit and this file must never store:

```ts
type DeletedSheetTarget = { target: string; status: "deleted" }
```

That is the handoff from “the live write removed this tab” to “drop it from `sheet_sync[]`, do not keep a `deleted` row.” Do **not** add `status: "deleted"` onto `SheetSyncEntry` so “one type owns every result,” do **not** add `job_id` so “the document can prove the outbox,” and do **not** add `published: true` so “remember can prove the queue.”

`SheetSyncFn` stays `(doc: any) => Promise<SheetWriteResult[]>`. The comment already says why: Form / Call / Booked / Cancelled hydrated documents flow without per-model casts at most call sites. Booked / Cancelled lookup still casts `as unknown as SheetSyncDocument`. Do not tighten this to `FormLead` so “the type is honest” and break Booking / Cancellation. Do not invent `RememberTheSheetRowsDeps` unless a later test **adapter** needs to inject `save`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sheetSyncPersistence.ts
// We just wrote (or tried to write) Google Sheets for this document.
// Remember the new row hints on the Mongo document.
// Drop the tabs we just deleted.
// Keep every tab this write did not touch.
// Save.
// Say whether every tab succeeded.
// Do not decide which tabs to write.
// Do not talk to Google Sheets yourself.
// Do not write the outbox.
// The queued drain remembers the same hints with a direct updateOne.
// Do not silently switch this file to that path.

// ── 1. After the live sheet write, remember the row hints ─

export async function rememberTheSheetRowsOnTheDocumentAfterTheLiveWrite(document, writeTheSheets)
  // await the injected writer
  // drop deleted targets from sheet_sync[]
  // merge remaining entries (failed still stores)
  // save the document
  // log partial_failure or ok

export const syncAndStore = rememberTheSheetRowsOnTheDocumentAfterTheLiveWrite

function dropTheTabsWeJustDeleted(sheetSync, deletedTargets)   // schemaHelpers.removeSheetSyncEntries
function mergeTheNewHintsOntoWhatRemains(sheetSync, entries)   // schemaHelpers.mergeSheetSyncEntries
function sayWhetherEveryTabSucceeded(documentId, entries)

export type SheetSyncDocument = mongoose.Document & {
  _id: mongoose.Types.ObjectId
  sheet_sync?: unknown[]
  save(): Promise<unknown>
}

export type DeletedSheetTarget = { target: string; status: "deleted" }
export type SheetWriteResult = SheetSyncEntry | DeletedSheetTarget
export type LiveSheetWriter = (doc: any) => Promise<SheetWriteResult[]>
```

Read the legacy refresh out loud: *The coordinator already decided we are on the old path. Lookup found the Lead (or Booking, or Cancellation) and asked the googleSheets writer to write. This file merges the new row hints onto `sheet_sync[]`, drops the tabs that writer just deleted, keeps every tab this write did not touch, saves the document, and says whether every tab succeeded. A failed tab still stores `failed`. A successful API response already happened — this is the background refresh.*

Read the queued contrast out loud: *Queued mode never calls this file. The drain writes the sheets in batches, then `updateOne`s `sheet_sync[]` on the surviving document. A persist miss there flips those outcomes to `failed` and does not abort the run. Tombstones have no surviving document. That is a later pass.*

That is the operation. `syncAndStore` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file is legacy-only on purpose.** Knowledge says writers return entries stored here in legacy, or by the drain’s `updateOne` in queued. Coordinator `refreshTheSheetsNow` is the only runtime path that reaches later lookup, which is the only runtime path that reaches here. Do not call this from the drain. Do not add `getSheetSyncMode()` here so “queued can reuse the save.”

2. **Two remember **adapters**, one owner hint.** This file `set`s `sheet_sync` and `save()`s the hydrated document. The drain `updateOne`s `{ $set: { sheet_sync } }` and, on miss, throws “document no longer exists,” catches that, logs `sheet_sync.drain.metadata_persist_failed`, and flips those write outcomes to `failed` so the job retries. A `save()` throw here aborts the legacy refresh after Google already wrote. Keep both **adapters**. Do not silently switch this file to `updateOne`. Do not silently swallow a `save()` throw so “legacy matches drain.”

3. **Delete-markers are never stored.** `{ target, status: "deleted" }` is not a `SheetSyncEntry` (`pending` / `synced` / `failed`). The writers emit it after `deleteRowsFromTargets` returns the targets it actually removed (missing tab / missing row is a no-op and is **not** returned). This file strips those markers and `remove`s those targets. Do not persist `status: "deleted"` so “the document remembers the delete.” Do not treat a failed live delete as a marker — the writer never emits one; a delete that threw never reaches this list.

4. **Drain only drops synced deletes.** `persistDocSheetSync` removes targets whose planned delete `status === "synced"`. This file removes every callback marker. That is the same owner rule today because the legacy writer only emits a marker after a successful delete. Do not start emitting `deleted` on a failed delete so “the types match,” and do not pull the drain’s `synced`-only filter here so “one helper owns both.”

5. **Failed writes still save.** A `failed` entry is merged, saved, then logged as `sheet_sync.document.partial_failure`. The document keeps `last_error` and `updated_since_last_sync: true`. That is the current contract (the next legacy refresh can retry the tab). Do not skip `save()` on partial failure so “we only store success.” Do not throw so “partial failure fails the `waitUntil`.”

6. **Untouched targets stay.** `mergeSheetSyncEntries` is last-write-wins by `target`. A Form write that does not mention `master_bad_leads` keeps the old Bad Leads hint until a later delete-marker drops it. Knowledge already names the Bad Leads / Call duplicate-flip rules on the **writer**, not here. Do not drop targets the writer omitted so “one sync owns the whole array.”

7. **`document.save()` is a full-document save.** Concurrent patches to other fields can race. The drain’s `updateOne` only sets `sheet_sync`. Name that. Do not add a version guard here so “legacy becomes CAS” in this rename.

8. **The writer already logged per-target ok / fail.** `syncRowToTargets` logs `sheets.sync.target.ok` / `sheets.sync.target.failed` / `sheets.sync.finished`. This file logs the document-level summary. Keep both. Do not drop `sheet_sync.document.*` so “the writer already said it.”

9. **Log message shapes are load-bearing.** `sheet_sync.document.partial_failure`, `sheet_sync.document.ok`. Rename functions; keep the strings until log searches are migrated on purpose.

10. **`SheetSyncFn` uses `any` on purpose.** The comment names the old `v1.service` `AnyDoc` shape. Booked / Cancelled lookup still casts. Do not replace `any` with `SheetSyncDocument` and then add four overloads so “the writer is typed here.” Writer typing belongs in later `googleSheets/`.

11. **googleSheets imports the delete-marker union from this file.** That is a real type **seam**, not a leak. Do not move `SheetSyncUpdateEntry` into `schemaHelpers` so “models own every sheet type,” and do not duplicate the union in `googleSheets/types.ts` in this pass.

12. **The barrel re-exports this file. No domain service imports it.** Later lookup imports the path. Do not remove the barrel export so “we hide a dead symbol,” and do not teach Form Lead to call `rememberTheSheetRowsOnTheDocumentAfterTheLiveWrite` so “ingestion owns the hint.”

13. **Leave sibling modules alone.** `mergeSheetSyncEntries` / `removeSheetSyncEntries` stay in `schemaHelpers`. `syncFormLeadToSheets` / `syncCallLeadToSheets` / `syncBookedLeadToSheets` / `syncCancelledLeadToSheets` stay in later `googleSheets/`. `syncSourceLead` / `syncBookedLeadById` stay in later lookup. `persistSheetSyncMetadata` stays in later drain. This file orchestrates writer → drop → merge → save → say.

14. **Do not treat tombstone as this story.** Delete services snapshot `sheet_sync[]` and write an outbox tombstone **before** the hard Mongo delete. This file runs after a live upsert / tab-flip write on a document that still exists. A queued tombstone has no surviving document for the drain to `updateOne`.

## Testing

The **interface** is the test surface: `rememberTheSheetRowsOnTheDocumentAfterTheLiveWrite` (today `syncAndStore`). The merged `sheet_sync[]`, the `save()`, and the ok / partial-failure log are part of that **interface**.

There is no `sheetSyncPersistence.test.ts`. Merge / remove helpers have no dedicated test. Outbox / coordinator / drain tests never stub this file. That is not enough for a remember this small and this load-bearing. Add tests that name the operation. Inject the live writer; do not boot Google Sheets.

**After the live sheet write, remember the row hints on the document**
- Writer returns one `synced` entry → document `sheet_sync[]` contains that target with `row_number`, `save()` is called once, `sheet_sync.document.ok` is logged.
- Writer returns a `failed` entry → that target is stored with `last_error`, `save()` still runs, `sheet_sync.document.partial_failure` names that target, this file does not throw.
- Writer returns `{ target: "master_bad_leads", status: "deleted" }` and the document already had that target → it is gone after save; the marker is not stored.
- Writer returns a new target and the document already had a different target → both remain (untouched kept).
- Writer returns an update for an existing target → last write wins; old `row_number` is replaced.
- Empty writer result on a document with existing entries → existing entries stay; `save()` still runs; ok is logged.
- `save()` throw propagates; this file does not catch it (legacy abort after Google already wrote).
- Booked / Cancelled / Form / Call documents all accept the loose `SheetSyncDocument` shape (one fixture each is enough).

**Not this interface**
- Persist / finalize / unmigrated schedule stay on [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md).
- Remember-or-fold / tombstone stay on [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md).
- Wake-up stays on [recommendations/sheet-sync-queue.md](sheet-sync-queue.md).
- Which document to load and which writer to inject stay on later `sheetSyncSourceLookup.ts`.
- Tab routing / Bad Leads / Call duplicate-flip stay on later `googleSheets/` and [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md).
- Drain `updateOne` / persist-failure flip stay on later `drainer/runSheetSyncDrain.ts`.
- `mergeSheetSyncEntries` / `removeSheetSyncEntries` stay helper **depth**; prove them through this **interface**, not a second helper-unit file.

Do **not** add a test per helper (`dropTheTabsWeJustDeleted`, `sayWhetherEveryTabSucceeded`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that queued mode calls this file — it must not. Do not add a test that this file talks to Google Sheets — it must not. Do not add a test that this file writes `sheet_sync_jobs` — it must not.

`SheetSyncUpdateEntry` stays exported because the googleSheets writers are a real **adapter**, not a test leak.

## What I would not do

- A `SheetSyncPersistenceService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `merge` / `save`.
- Moving this into a CRUD folder, or into `sheetSyncSourceLookup.ts` / `googleSheets.service.ts` / the drain “for cleanliness.”
- Breaking the injected-writer **seam**. This file does not choose tabs and does not talk to Google Sheets.
- Treating later `persistSheetSyncIntent` / `publishSheetSyncWakeup` / `runSheetSyncDrain` / `syncSourceLead` as this story.
- Inventing a drain `updateOne` **seam** that has only one **adapter** here.
- Silently switching this file to `updateOne`, or silently swallowing a `save()` throw, or silently storing `status: "deleted"`.
- Writing a whole-folder recommendation for `sheetSync`.
- Jumping to `googleSheets` while this checklist has unchecked modules.
- Reordering Form Lead sheets-before-CRM (that labeled ADR order lives on the Form Lead recommendation, not here).
