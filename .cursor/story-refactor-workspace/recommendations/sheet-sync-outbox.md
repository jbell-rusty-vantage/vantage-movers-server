# Write The Durable Sheet-Sync Job In The Same Mongo Write, Fold Later Writes Onto One Pending Row, Then On Delete Cancel The Matching Upsert And Due-Now Tombstone — operational story

- Status: recommended
- Service: `sheetSync` (Wave A, in-progress)
- Pass: 2 of this service — `sheetSyncOutbox.service.ts`
- Remaining in this service: `sheetSyncQueue.service.ts`, `sheetSyncPersistence.ts`, `sheetSyncSourceLookup.ts`, `drainer/runSheetSyncDrain.ts`, `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`
- Target: `src/services/sheetSync/sheetSyncOutbox.service.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (outbox coalesce + tombstone; Mongo is System of Record; sheets update after the API response). Distinct from already-recommended mode-aware persist / finalize / unmigrated schedule: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md). Distinct from later wake-up publish gate: `sheetSyncQueue.service.ts`. Distinct from later `sheet_sync[]` merge-and-save: `sheetSyncPersistence.ts`. Distinct from later lookup-then-write: `sheetSyncSourceLookup.ts`. Distinct from later drain / plan / batch / quota: `drainer/`. Distinct from coalescing-key / priority / debounce config: `src/config/domain/sheetSync.ts` (`buildCoalescingKey`, `supersededUpsertCoalescingKey`, `priorityForJob`, `getSheetSyncDrainGuardrails`). Distinct from Google Sheets tabs / projections / dual Source Company writes: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). Distinct from Form Lead remember-then-dispatch (that file snapshots + tombstones through this **seam**; it does not own coalesce): [recommendations/form-lead.md](form-lead.md). Distinct from Lead Messaging persist + send-or-wake: [recommendations/lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md). Distinct from admin retry (sets `pending` / `due_at=now` on the job row and starts drain; does **not** call this file). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already flags Granot / RingCentral `enqueueSheetSyncJob` (mode-blind) as a labeled gap; do not “fix” that in this rename. Knowledge already names the booked-lead tombstone that does **not** cancel `booking_chain:{id}`; do not “fix” that in this rename.
- Callers: **coordinator persist + unmigrated schedule, four delete services, two surviving-row refresh sites, three labeled-gap writers, the barrel, and this file’s test.** Persist: `sheetSyncCoordinator.ts` `persistSheetSyncIntent` (queued only, caller session, `createdBy: "api"`). Unmigrated: same file’s `enqueueAndPublish` (queued `schedule*`, **no** session). Deletes (tombstone **before** hard Mongo delete): `leads/formLead.service.ts`, `leads/callLead.service.ts` (Call Lead wraps snapshot with fallback tabs), `bookings/bookedLead.service.ts` (booking tombstone + optional cascaded cancellation tombstone), `cancellations/cancelledLead.service.ts`. Surviving-row upserts on delete: booked-lead delete enqueues `source_lead` after clearing booking columns; cancelled-lead delete enqueues `booking_chain` or `source_lead` so the surviving rows no longer look cancelled. Labeled gap (do not silently reroute): `granotLifecycle/createLeadFromGranot.ts`, `synchronizeLeadFromGranot.ts`, and `ringcentral/callLeadConvergence.service.ts` call `enqueueSheetSyncJob` then `finalizeSheetSync`. Barrel: `sheetSync/index.ts`. Test: `sheetSyncOutbox.service.test.ts` (upsert key + session; tombstone supersede + due-now; persist mode gate is the coordinator’s, parked here). Config tests lock key / supersede / priority shapes in `src/config/domain/sheetSync.test.ts` — those are not this **interface**. Not this **interface**: later queue publish, later drain / plan / batch, later `sheet_sync[]` persist, later source lookup, admin retry / health, cron / queue consumer, `googleSheets/` writes.
- Seams callers need: upsert remember vs delete tombstone; caller session (atomic with the domain write) vs no session (unmigrated `waitUntil`); coalesce only `pending` / `retrying` vs never `processing`; snapshot-then-tombstone **before** hard Mongo delete vs legacy inline `delete*FromSheets`; booked-lead tombstone cancels `booked_lead:{id}` only, never `booking_chain:{id}`; this file is mode-blind (persist owns the queued gate; Granot / RingCentral skip persist on purpose)
- Split later (only if the file outgrows one sitting): `rememberOrFoldTheDurableUpsert.ts` / `snapshotTheKnownSheetRows.ts` / `rememberTheDeleteTombstoneAndCancelTheMatchingUpsert.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `enqueue.ts`, and never merge coordinator mode, queue publish, source lookup, drain, or Google Sheets projections into this file

`enqueueSheetSyncJob` / `enqueueSheetSyncTombstone` are executor mechanics. The owner question is: *The Lead (or Booking, or Cancellation) is already being saved. Write the durable sheet-sync job in the same Mongo write so we cannot forget. If the same entity is written again before the drain, fold that work onto one pending row — pull the due time earlier, keep the higher priority, never fold onto a job that is already being drained. If we are deleting, snapshot the known sheet rows first, cancel any pending upsert that would put the row back, and write a delete that is due now. Never talk to Google Sheets here. Never wake the drain here. A booked-lead delete does not cancel a live Booking Chain job.*

Coordinator mode, queue publish, source lookup, drain, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “write the durable sheet-sync job in the same Mongo write” story, not “an outbox CRUD service,” and not the coordinator / drain / Google write:

1. **Remember (or fold) a durable upsert** — `enqueueSheetSyncJob`. Translate the in-memory `FullSheetSyncJob` (the shape domain services already build) into `{ resource, entityModel, entityId }`. Build the coalescing key. Upsert onto `{ coalescing_key, status ∈ pending|retrying }`: `$min due_at` (debounce default 3s, or the unused `dueAt` override), `$max priority`, `$set target_hints: []`, `$setOnInsert` `pending` / `attempts: 0` / `created_by`. Designed to ride the caller’s Mongo session so the domain document and the outbox job commit together. This beat does not publish. This beat does not write a sheet row. This beat does not read `SHEET_SYNC_MODE`.

2. **Snapshot the known sheet rows** — `buildTombstonePreviousTargets`. Copy `sheet_sync[]` entries that already have a spreadsheet and a tab into `previous_targets`. Drop empties. Keep `row_number` as a hint — the later drainer re-validates against the live tab, so a stale number is safe. This beat does not write Mongo. Call Lead delete wraps this with fallback tabs (`buildCallLeadDeletePreviousTargets`); that wrapper stays in the Call Lead **module**.

3. **Remember a durable delete tombstone and cancel the matching upsert** — `enqueueSheetSyncTombstone`. Cancel pending / retrying rows on the **matching** upsert key (`superseded_by_delete_tombstone`). Then upsert the delete job with `due_at = now` (no debounce — a stale upsert must not put the row back). Deletes are time-critical. Tombstone **before** the hard Mongo delete. A `delete_booked_lead` cancels `booked_lead:{id}` only. It does **not** cancel `booking_chain:{id}`. This beat does not publish. This beat does not delete a sheet row.

There is no fourth mutate operation. Mode, wake-up, tab routing, quota, and `sheet_sync[]` save are other files.

## Organization

Keep one file as the screenplay for “write the durable sheet-sync job in the same Mongo write, fold later writes onto one pending row, then on delete cancel the matching upsert and due-now tombstone.” Coordinator persist / finalize, queue publish, lookup, persist-on-document, and drain already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncOutboxService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator. Do not invent a second coalescing-key **adapter** beside config `buildCoalescingKey`. Do not invent a drain **adapter** here.

Do not move enqueue into `formLead.service.ts` so “ingestion owns the outbox.” Do not move tombstone into the coordinator so “one file owns every sheet-sync write.” Do not add a `SHEET_SYNC_MODE` gate here so “Granot cannot write in legacy.” Do not split `create.ts` / `update.ts` / `delete.ts`. Do not silently publish from enqueue. Do not silently write Google Sheets from tombstone.

**External interface** stays small (this is the test surface). Remember-or-fold, snapshot, and tombstone-and-cancel are one story’s durable write, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `enqueueSheetSyncJob` | `rememberOrFoldTheDurableUpsert` | persist, unmigrated schedule, Granot / RingCentral labeled gap, surviving-row refresh on delete |
| `buildTombstonePreviousTargets` | `snapshotTheKnownSheetRows` | delete services snapshot before the write; Call Lead wraps this |
| `enqueueSheetSyncTombstone` | `rememberTheDeleteTombstoneAndCancelTheMatchingUpsert` | Form / Call / Booked / Cancelled delete, before hard Mongo delete |

Keep the option / input types (`EnqueueSheetSyncJobOptions`, `EnqueueSheetSyncTombstoneOptions`, `SheetSyncTombstoneInput`) as the bags those **seams** already pass. Do not rename them into a workflow class.

Keep the old names as one-line aliases until the coordinator, the four delete services, Granot / RingCentral, and the barrel migrate. Do not make callers learn `coalescing_key` / `COALESCE_STATUSES` / `findOneAndUpdate` as the domain language.

**Principle: old exports stay as aliases.** `enqueueSheetSyncJob` and `enqueueSheetSyncTombstone` remain the imported names until persist, deletes, and the labeled-gap writers point at the story names.

**No class for the workflow.** The type that *does* earn a name is the durable identity `describeJob` already builds:

```ts
type DurableSheetSyncIdentity = {
  resource: SheetSyncResource
  entityModel: SheetSyncEntityModel
  entityId: string
}
```

That is the handoff from “the in-memory `FullSheetSyncJob` the write already built” to “one coalescing key the drain can fold.” Do **not** add `status: "processing"` so “we can fold onto an in-flight drain,” do **not** add `booking_chain` onto a booked-lead tombstone so “one delete cancels every job for that Booking,” and do **not** add `published: true` so “the outbox can prove the queue.”

`dueAt` stays an option on remember-or-fold. Comment says cron / admin re-enqueue. No runtime caller passes it — admin retry mutates the job row directly. Do not start wiring retry through this option so “the comment becomes true.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sheetSyncOutbox.service.ts
// The Lead (or Booking, or Cancellation) is already being saved.
// Write the durable sheet-sync job in the same Mongo write.
// If the same entity is written again before the drain, fold onto one pending row.
// Never fold onto a job that is already being drained.
// If we are deleting, snapshot the known sheet rows first,
// cancel any pending upsert that would put the row back,
// and write a delete that is due now.
// Never talk to Google Sheets here.
// Never wake the drain here.

// ── 1. Remember (or fold) a durable upsert ────────────────

export async function rememberOrFoldTheDurableUpsert(job, options)
  // describe the in-memory job as a durable identity
  // upsert onto pending|retrying for that coalescing key
  // $min due_at (debounce, or unused dueAt override)
  // $max priority
  // $set target_hints: []
  // ride options.session when the caller has one

export const enqueueSheetSyncJob = rememberOrFoldTheDurableUpsert

function nameTheDurableIdentity(job)  // today's describeJob
async function upsertTheActiveJob(identity, operation, options)

// ── 2. Snapshot the known sheet rows ──────────────────────

export function snapshotTheKnownSheetRows(sheetSync)
  // keep spreadsheet + tab; row_number is a hint
  // drop empties

export const buildTombstonePreviousTargets = snapshotTheKnownSheetRows

// ── 3. Remember a durable delete and cancel the matching upsert

export async function rememberTheDeleteTombstoneAndCancelTheMatchingUpsert(args, options)
  // cancel pending|retrying on the matching upsert key only
  // booked-lead → booked_lead:{id}, never booking_chain:{id}
  // upsert the delete with due_at = now
  // ride options.session

export const enqueueSheetSyncTombstone = rememberTheDeleteTombstoneAndCancelTheMatchingUpsert

async function cancelTheMatchingPendingUpsert(tombstoneResource, entity)
```

Read the queued public write out loud: *The coordinator already decided we are in queued mode. Remember the upsert on the caller’s session. Fold onto a pending or retrying row if one exists. Pull due earlier. Keep the higher priority. After commit, a different file wakes the drain.*

Read the delete path out loud: *Snapshot the known sheet rows. Remember the tombstone on the same session, cancel the matching pending upsert, and make the delete due now. Then hard-delete the Mongo document. After commit, a different file wakes the drain. A booked-lead delete does not cancel a live Booking Chain job.*

Read the labeled-gap path out loud: *Granot create / sync and RingCentral convergence call remember-or-fold directly, with a session, and skip the coordinator’s queued gate. Knowledge already names that. This file stays mode-blind.*

That is the operation. `enqueueSheetSyncJob` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file is mode-blind on purpose.** Persist owns the queued gate. Unmigrated `schedule*` also only reaches here in queued mode. Granot / RingCentral skip persist and call remember-or-fold anyway. Knowledge already labels that gap. Rename so the bypass is visible. Do not add `getSheetSyncMode()` here. Do not silently route those three callers through persist.

2. **Two upsert writers, one function.** Persist threads the caller session. Unmigrated `enqueueAndPublish` calls the same export with no session after the domain write. Knowledge already names that the unmigrated fallback. Keep both **adapters**. Do not silently make schedule call persist. Do not silently refuse a missing session.

3. **Never fold onto `processing`.** A write during drain creates a fresh `pending` job so the drainer reloads latest Mongo (at most one extra idempotent sync). Folding onto an in-flight job risks `synced` while losing the newer write. The comment already says this. The test does not prove the filter excludes `processing`. Prove it at this **interface**. Do not add `processing` to `COALESCE_STATUSES`.

4. **Booked-lead tombstone does not cancel Booking Chain.** `supersededUpsertCoalescingKey("delete_booked_lead")` returns `booked_lead:{id}` only. Knowledge names this. Config tests lock the key. The outbox test only proves `delete_source_lead` cancels `source_lead:CallLead:…`. Prove the booked-lead miss at this **interface**. Do not cancel `booking_chain:{id}` so “one delete owns the Booking.”

5. **`$set target_hints: []` on every upsert coalesce.** A later drain that wrote hints onto a retrying row loses them when a new write folds in. That is the current contract (hints are rebuilt from the live document). Name it. Do not preserve old hints so “retry keeps its tab list.”

6. **Tombstone duplicates the upsert `findOneAndUpdate`.** Same `$max` / `$min` / `$setOnInsert` shape, different `due_at` and a `tombstone` field. Extract only if the shared beat hides a real decision. Do not invent `upsertAnyJob(kind)` so “one helper owns upsert and delete.”

7. **`dueAt` has no runtime caller.** The option comment says cron / admin re-enqueue. Admin retry sets `pending` / `due_at=now` / `attempts=0` on the job row and starts `runSheetSyncDrain("admin")`. Cron drains due Mongo. Do not wire retry through `dueAt` so “the comment becomes true.”

8. **Call Lead snapshot is richer than this helper.** `buildCallLeadDeletePreviousTargets` adds fallback Calls / Duplicate Calls tabs when `sheet_sync[]` is empty. Keep that in the Call Lead **module**. Do not pull fallbacks here so “one snapshot owns every delete.”

9. **Log message shapes are load-bearing.** `sheet_sync.outbox.enqueued`, `sheet_sync.outbox.upsert_superseded_by_delete`, `sheet_sync.outbox.tombstone_enqueued`. Rename functions; keep the strings until log searches are migrated on purpose.

10. **Persist’s mode gate lives in this test file.** `persistSheetSyncIntent only writes the outbox in queued mode` is the coordinator’s **interface**, parked here because there is no coordinator test. Keep the assertion or move it with a one-line pointer. Do not treat it as proof that this file checks mode — it does not.

11. **Leave sibling modules alone.** `persistSheetSyncIntent`, `publishSheetSyncWakeup`, `buildCoalescingKey` / `supersededUpsertCoalescingKey` / `priorityForJob`, and `runSheetSyncDrain` are already the right **depth**. This file writes `sheet_sync_jobs`. Config owns the key spellings.

## Testing

The **interface** is the test surface: `rememberOrFoldTheDurableUpsert`, `snapshotTheKnownSheetRows`, `rememberTheDeleteTombstoneAndCancelTheMatchingUpsert`.

Today’s `sheetSyncOutbox.service.test.ts` stubs `findOneAndUpdate` / `updateMany` and proves: upsert key + `pending|retrying` filter + create priority 60; session threaded on a `booking_chain` write; tombstone cancels the matching source-lead upsert then writes a due-now delete with `target_hints`. The persist mode gate is the coordinator’s. Config tests lock key spellings and the booked-lead supersede miss — those are not this **interface**.

Add tests that name the operation. Inject the `SheetSyncJob` **adapter**; do not boot Google Sheets.

**Remember (or fold) a durable upsert**
- `source_lead` / `booked_lead` / `booking_chain` / `cancellation_chain` each write the matching coalescing key (`source_lead` includes `entityModel`; booking / cancellation keys do not).
- Filter is `status ∈ pending|retrying` only — never `processing`, `synced`, `failed`, `cancelled`.
- Caller session is threaded; missing session is allowed (unmigrated schedule).
- `$min due_at` is now + debounce (default 3s) unless `dueAt` is passed.
- `$max priority` keeps the higher value (create 60 beats update 50; delete 100 beats those).
- `$set target_hints: []` on every coalesce.
- `$setOnInsert` `status: "pending"`, `attempts: 0`, `created_by` from options (default `"api"`).

**Snapshot the known sheet rows**
- Keeps entries with spreadsheet + tab; drops empties.
- Preserves `row_number` as a hint; omits it when missing.
- `undefined` / empty `sheet_sync[]` → `[]`.

**Remember a durable delete and cancel the matching upsert**
- `delete_source_lead` cancels `source_lead:{entityModel}:{entityId}` (already here — keep it).
- `delete_booked_lead` cancels `booked_lead:{id}` and does **not** cancel `booking_chain:{id}`.
- `delete_cancelled_lead` cancels `cancellation_chain:{id}`.
- Tombstone `due_at` is now (no debounce).
- Caller session is threaded on both `updateMany` and the upsert.
- `last_error` on the cancelled upsert stays `superseded_by_delete_tombstone`.

Do **not** add a test per helper (`nameTheDurableIdentity`, `upsertTheActiveJob`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`buildTombstonePreviousTargets` stays exported because the four delete services snapshot before they open the write. That is a real **adapter**, not a test leak.

## What I would not do

- A `SheetSyncOutboxService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the tombstone-before-hard-delete **seam**. The snapshot and the outbox row must commit with the delete, not after the document is gone.
- Treating later `persistSheetSyncIntent` / `publishSheetSyncWakeup` / `runSheetSyncDrain` / `syncSourceLead` as this story.
- Inventing a mode **seam** that has only one **adapter** here.
- Silently “fixing” the labeled Granot / RingCentral enqueue-direct gap, or silently cancelling `booking_chain` from a booked-lead tombstone, or silently coalescing onto `processing`.
- Writing a whole-folder recommendation for `sheetSync`.
- Jumping to `googleSheets` while this checklist has unchecked modules.
- Reordering Form Lead sheets-before-CRM (that labeled ADR order lives on the Form Lead recommendation, not here).
