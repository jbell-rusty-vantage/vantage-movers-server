# Reload Current Mongo (Or The Tombstone) And Plan The Sheet Writes For This Claimed Job — Unmatched Call Stub Is An Empty Plan, Vanished Booking Is An Empty Plan, Vanished Source Lead Still Throws — operational story

- Status: recommended
- Service: `sheetSync` (Wave A, in-progress)
- Pass: 7 of this service — `drainer/jobPlanner.ts`
- Remaining in this service: `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`
- Target: `src/services/sheetSync/drainer/jobPlanner.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (queued plan step; empty plan → drain marks `synced`; unmatched Call skip; queued Bad Leads delete only when `sheet_sync[]` already has that target; Call duplicate flip deletes the stale tab even when hints are empty). Distinct from already-recommended mode-aware persist / finalize / unmigrated schedule: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md). Distinct from already-recommended outbox coalesce + tombstone: [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md). Distinct from already-recommended wake-up: [recommendations/sheet-sync-queue.md](sheet-sync-queue.md). Distinct from already-recommended legacy `document.save()` remember: [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md). Distinct from already-recommended live lookup-then-write: [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md) (legacy `waitUntil`; same owner rules, different **adapter**; queued never imports it). Distinct from already-recommended take-the-seat / claim / finalize: [recommendations/sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (this file is the plan **adapter**; the drain asks it and treats `[]` or every-doc-empty-writes as `synced`). Distinct from later batch / tab / quota: `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`. Distinct from Google Sheets tabs / projections / dual Source Company writes: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (this file **mirrors** tab routing and builds `PlannedWrite`s; it does not call the facade). Distinct from named source-lead load: [recommendations/leads-source-lead-lookup.md](leads-source-lead-lookup.md) (`getLinkedLead` 404s a missing Lead; this file does not filter Duplicate / unmatched / booked). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names queued-vs-legacy Bad Leads delete and Call stale-tab delete; do not “fix” those in this rename.
- Callers: **one runtime import site, plus the drainer barrel, plus two tests.** Drain: `drainer/runSheetSyncDrain.ts` asks `planJobWrites` per representative; `docs.length === 0` **or** every `writes.length === 0` → empty job marked `synced`; a throw burns an attempt. Barrel: `sheetSync/drainer/index.ts` re-exports `planJobWrites` / `PlannedDoc`. Service barrel `sheetSync/index.ts` does **not** re-export this file. Coordinator, outbox, queue, persistence, and source lookup do **not** import it. Tests: `drainer/jobPlanner.test.ts` locks tombstone deletes / unknown headers / `target_hints` / empty-tombstone `{ writes: [] }` / Form Bad Leads dual-write / cleared-`bad_lead` delete-only-when-remembered / Call stale Calls delete without `sheet_sync[]`. Replica: `granotLifecycle/referralBooking.replica.test.ts` asks this file on a `booked_lead` referral job and asserts only `master_booked`. There is no unmatched-skip test and no missing-Booking / missing-Cancellation test on this file — the previous drain pass said those tests exist; disk says they do not.
- Seams callers need: empty plan (`[]` or every-doc-empty-writes) vs planned writes; surviving `doc` (drain `updateOne`s `sheet_sync[]`) vs tombstone without `doc`; `target_hints` empty means every tab, non-empty means retry those tabs only; missing Booking / Cancellation is quiet empty vs missing source Lead is `getLinkedLead` 404; Booked Deals first, then the source row, then Cancelled Deals
- Split later (only if the file outgrows one sitting): this ~370-line file is one sitting if you read it as reload → choose tabs from current flags → return the write list. If it later splits: `planTheSourceLeadWrites.ts` / `planTheBookingChainWrites.ts` / `planTheCancellationChainWrites.ts` / `planTheTombstoneDeletes.ts` — never `plan.ts` / `upsert.ts` / `delete.ts` / `create.ts` / `update.ts`, and never merge drain claim, legacy lookup-then-write, later `writeBatchedTargets`, or Google Sheets projections into this file

`planJobWrites` is executor mechanics. The owner question is: *The drain already claimed this job. Reload Mongo — or the tombstone snapshot if the document is already gone. Decide which tabs this Lead, Booking, or Cancellation belongs on right now. An unmatched Call stub must not appear on Calls. A vanished Booking or Cancellation is an empty plan, and the drain will mark the job synced. A vanished source Lead still throws. A Form that is a Bad Lead also goes on Master Bad Leads; when that flag is cleared we only delete that row if we already remember it. A Call that flipped duplicate upserts the current tab and deletes the stale one even when we have no remembered row. A Booking Chain writes Booked Deals first, then the source row. A Cancellation Chain writes that booking chain first, then Cancelled Deals. A delete uses only the tombstone's previous targets. This file does not write Google. This file does not claim. This file does not mark the job.*

Coordinator persist / finalize, outbox coalesce, queue wake-up, legacy lookup-then-write, drain seat / claim / finalize, later batch / tab / quota, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a planner CRUD service,” and not the drain / the batch writer / the live lookup:

1. **Plan the sheet writes for this claimed job** — `planJobWrites(job)`. Switch on `job.resource`. `source_lead`: load the named Form or Call through `getLinkedLead` (404 if missing). Skip a Call Lead with `created_on_unmatched === true` (`sheet_sync.drain.call_lead.created_on_unmatched.skipped`) and return `[]`. Otherwise populate `booked` + `customer`. Form: current Forms or Duplicates tab via `getLeadTargets` (Master always; Source Company only when `WRITE_SOURCE_LEAD_SHEETS=true`), plus Master Bad Leads upsert when `bad_lead` is set, or a Bad Leads **delete** only when that flag is cleared **and** `sheet_sync[]` already has `master_bad_leads`. Call: current Calls or Duplicate Calls upsert, then **always** plan a delete on the stale opposite tab (even when `sheet_sync[]` is empty — the later batch writer looks up by Mongo id). `booked_lead`: load the Booking with customer + agents; missing → `sheet_sync.drain.booking_missing` and `[]`; else Booked Deals only (leadless / referral). `booking_chain`: same Booking load; missing → same empty; else Booked Deals first, then the source-lead plan when `lead_ref` + `lead_model` exist. `cancellation_chain`: load the Cancellation; missing → `sheet_sync.drain.cancellation_missing` and `[]`; else the booking-chain plan first, then Cancelled Deals on the Cancellation we already loaded. A vanished Booking on a Cancellation Chain does **not** empty the whole plan — Cancelled Deals still go out. Tombstone (`delete_source_lead` / `delete_booked_lead` / `delete_cancelled_lead`): no live document; walk `previous_targets`, drop unknown headers and targets outside `target_hints`, return `{ docKey, writes }` with **no** `doc`. Missing tombstone → `[]`. Empty `previous_targets` → `[{ writes: [] }]`. This function does not talk to Google. This function does not claim a job. This function does not mark synced / retrying / failed.

There is no second mutate operation. Mode, wake-up, claim, batch, quota, and outbox coalesce are other files. Legacy `syncSourceLead` / `syncBookingChainById` are a different **adapter** for the same owner rules, not this file.

## Organization

Keep one file as the screenplay for “reload current Mongo (or the tombstone) and plan the sheet writes for this claimed job — unmatched Call stub is an empty plan, vanished Booking is an empty plan, vanished source Lead still throws.” Drain seat / claim / finalize, legacy lookup-then-write, later batch writer, later tab map, later quota limiter, coordinator, outbox, queue, and Google Sheets writers already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncJobPlannerService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator. Do not invent a second live-write **adapter** beside already-recommended source lookup. Do not invent a second remember **adapter** beside already-recommended `syncAndStore` / the drain’s `updateOne`.

Do not split this into `upsert.ts` / `delete.ts` / `plan.ts`. Those are beats of one plan. Do not move this into `sheetSyncSourceLookup.ts` so “one lookup owns every mode.” Do not move this into `runSheetSyncDrain.ts` so “the drain already plans.” Do not silently call `syncSourceLeadById` so “queued reuses legacy.” Do not silently add a Forms / Duplicates stale-delete so “Form matches Call.”

**External interface** stays small (this is the test surface). Source, booked-only, booking-then-source, cancellation-after-chain, and tombstone are one story’s plan, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `planJobWrites` | `planTheSheetWritesForThisClaimedJob` | drain asks once per representative |
| `PlannedDoc` | `PlannedSheetDocument` | surviving `doc` vs tombstone without one |

Keep the old name as a one-line alias until the drain, the drainer barrel, and the referral replica test migrate. Do not make callers learn `getLeadTargets` / `getLinkedLead` / `formLeadToRow` as the domain language.

**Principle: old exports stay as aliases.** `planJobWrites` remains the imported name until `runSheetSyncDrain` points at the story name.

`PlannedWrite` stays in already-skipped `drainer/types.ts`. Do not grow this **interface** with a write-row type the batch writer already owns.

**No class for the workflow.** The type that *does* earn a name is the planned document the drain will write, then maybe remember:

```ts
type PlannedSheetDocument = {
  docKey: string
  doc?: SheetSyncDocument
  writes: PlannedWrite[]
}
```

That is the handoff from “we reloaded Mongo (or the tombstone)” to “batch the writes, then `updateOne` `sheet_sync[]` only when `doc` survived.” Do **not** add `status: "synced"` so “the planner can finish the job,” do **not** add `published: true` so “the plan can prove the queue,” and do **not** add `official_booking_details` so “a booked job can confirm.”

`target_hints` stay on the job because they are a real retry **adapter**, not a second persistence. Empty hints mean every tab. Non-empty means only those tabs.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// drainer/jobPlanner.ts
// The drain already claimed this job.
// Reload Mongo — or the tombstone if the document is already gone.
// Decide which tabs this Lead, Booking, or Cancellation belongs on right now.
// An unmatched Call stub must not appear on Calls.
// A vanished Booking or Cancellation is an empty plan.
// A vanished source Lead still throws.
// A Form that is a Bad Lead also goes on Master Bad Leads.
// When that flag is cleared we only delete that row if we already remember it.
// A Call that flipped duplicate upserts the current tab and deletes the stale one
// even when we have no remembered row.
// Booked Deals first, then the source row, then Cancelled Deals.
// A delete uses only the tombstone's previous targets.
// This file does not write Google.
// This file does not claim.
// This file does not mark the job.
// Legacy lookup-then-write already mirrors these rules.
// Do not silently switch this file to that path.

// ── 1. Plan the sheet writes for this claimed job ─────────

export async function planTheSheetWritesForThisClaimedJob(job)
export const planJobWrites = planTheSheetWritesForThisClaimedJob

async function planTheSourceLeadWrites(job, leadModel, leadId)
  // getLinkedLead — 404 if missing
  // skip unmatched Call stub → []
  // populate booked + customer
  // Form: current tab + maybe Bad Leads upsert / remembered Bad Leads delete
  // Call: current tab + always delete the stale opposite

async function planTheBookedDealsWrites(job, bookingId)
  // load with customer + agents
  // missing → warn + []

async function planTheBookingChainWrites(job, bookingId)
  // Booked Deals first
  // then planTheSourceLeadWrites when lead_ref + lead_model exist

async function planTheCancellationChainWrites(job, cancellationId)
  // missing Cancellation → warn + []
  // booking chain first (vanished Booking does not empty this plan)
  // then Cancelled Deals on the Cancellation we already loaded

function planTheTombstoneDeletes(job)
  // no surviving doc
  // previous_targets minus unknown headers and targets outside target_hints

function skipTheUnmatchedCallStub(lead, leadModel)
function onlyTheTabsThisRetryStillNeeds(job, targets)
function theCurrentFormOrDuplicatesTab(duplicate)
function theCurrentCallsOrDuplicateCallsTab(duplicate)
function rememberABadLeadsDeleteOnlyWhenWeAlreadyWroteThatRow(doc)
```

Read the source-lead path out loud: *The drain already claimed this job. We load the Form or Call. If it is an unmatched Call stub, we return nothing — Calls must not invent a row. If it is a Form and a Bad Lead, we plan Forms (or Duplicates) and Master Bad Leads. If that Bad Lead flag was cleared, we delete Master Bad Leads only when we already remember that row. If it is a Call that flipped duplicate, we upsert Duplicate Calls and delete Calls even when we have no remembered row number. We do not talk to Google. The drain will batch whatever we returned.*

Read the Booking Chain out loud: *Same claimed job. We load the Booking once, with customer and agents. If it is gone, we say so and return nothing — the drain will mark the job synced. If it has no source Lead, we plan Booked Deals only. If it names a Form or Call, we plan Booked Deals first, then that source row, so the mirrored booking fields stay aligned. A vanished source Lead still throws, and the whole chain plan fails. Referral create never reaches this beat — it scheduled `booked_lead`.*

Read the Cancellation Chain out loud: *Find the Cancellation. If it is gone, stop. Write the booking chain first, then Cancelled Deals on the document we already loaded. If the Booking vanished, Booked Deals and the source row stay empty, but Cancelled Deals still go out. That is not the same as a vanished Cancellation.*

Read the tombstone path out loud: *The document is already gone. We do not look it up. We walk the snapshot the outbox saved before the hard delete. Unknown tabs and tabs outside this retry’s hints are dropped. There is no `doc` for the drain to `updateOne`. A missing snapshot is an empty plan. An empty snapshot is one planned document with no writes — the drain treats that as synced too.*

That is the operation. `planJobWrites` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two write **adapters**, one owner chain.** Legacy `syncSourceLead` / `syncBookingChainById` load one document and `syncAndStore` through the googleSheets facade. This file loads the same documents, builds a write list, and the drain batches them. Knowledge already says tab routing must stay aligned. Keep both **adapters**. Do not silently route `runFullSheetSyncProcess` through `planJobWrites` so “one lookup owns every mode,” and do not call `syncSourceLeadById` from this file so “queued reuses legacy.”

2. **Empty plan is two shapes.** Unmatched Call, missing Booking, missing Cancellation, missing tombstone → `[]`. Tombstone with no `previous_targets` → `[{ writes: [] }]`. The drain treats **both** as empty and marks the job `synced`. Do not collapse those shapes in this rename so “one empty is enough,” and do not fail a `{ writes: [] }` tombstone so “an empty snapshot looks loud.”

3. **Missing Booking / Cancellation is quiet empty. Missing source Lead is 404.** `getLinkedLead` throws `NotFoundError`. A vanished Booking or Cancellation logs `sheet_sync.drain.booking_missing` / `sheet_sync.drain.cancellation_missing` and returns `[]` so the drain marks `synced`. A vanished source Lead fails the representative (drain burns an attempt). Do not empty-return a missing Lead so “every miss is quiet.” Do not throw on a missing Booking so “every miss is loud.”

4. **A vanished Booking on a Cancellation Chain does not empty the whole plan.** `planTheBookingChainWrites` returns `[]`, then Cancelled Deals still go out. Knowledge’s “missing booking → empty plan” is true for `booked_lead` / `booking_chain`, not for this leftover Cancelled Deals row. Do not drop Cancelled Deals so “the sentence becomes true,” and do not invent Booked Deals so “the chain is complete.”

5. **Queued Bad Leads delete only when remembered. Legacy always deletes.** Knowledge names both. `!bad_lead && knownRowFor(master_bad_leads)` → delete. Legacy `syncFormLeadToSheets` always calls `deleteRowsFromTargets` on Master Bad Leads when `bad_lead` is falsy. Keep both **adapters**. Do not always-delete so “we match legacy,” and do not teach legacy to require a remembered row so “we match queued.”

6. **Call stale opposite is always planned. Form does not delete stale Forms / Duplicates.** Call: upsert current tab, delete `callLeadTargetBase(!duplicate)` even when `sheet_sync[]` is empty. Form: current Forms or Duplicates only — a duplicate flip can leave the old tab. Knowledge does not ask Form to match Call. Do not add a Forms / Duplicates stale-delete in this rename so “every lead flips the same way.”

7. **`target_hints` empty means every tab.** Non-empty is the drain’s retry of failed / deferred targets only. Tombstone, Form, Call, booked, and cancelled all filter through the same helper. Do not treat empty hints as “no writes” so “a first drain does nothing.”

8. **Source Company Sheets stay behind `WRITE_SOURCE_LEAD_SHEETS`.** `getLeadTargets` always plans Master first and appends the source container only when that flag is the literal `"true"`. Default is master-only. Do not drop the source-target plumbing so “the flag is unused,” and do not write source sheets when the flag is off so “dual write is simpler.”

9. **Booked / Cancelled `ensureTabs` is `[]` here. The facade uses `getMasterBookedTabs()`.** Planner `bookedTarget` / `cancelledTarget` do not ask the later batch writer to provision sibling tabs. Name that. Do not fill `ensureTabs` in this rename so “we match the facade,” and do not empty the facade so “we match queued.”

10. **Booking Chain loads once. Legacy loads twice.** This file populates customer + agents on the first `findById`. Legacy chain entry loads without populate, then loads again. Do not add a second load so “we match legacy,” and do not drop populate so “one query is enough” — Booked Deals needs customer + agents.

11. **`planTheBookedDealsWrites` is copied into the chain.** `planBookedLead` and the first beat of `planBookingChain` repeat the same load + `bookedLeadToRow` + `master_booked`. Name the shared beat. Do not extract a third file in this rename.

12. **A vanished source Lead on a Booking Chain fails Booked Deals too.** The booked plan is built in memory, then `planTheSourceLeadWrites` throws, and `planJobWrites` never returns those booked writes. The drain marks the whole job failed / retrying. Do not swallow the 404 so “Booked Deals can still go out” in this rename.

13. **Log message shapes are load-bearing.** `sheet_sync.drain.call_lead.created_on_unmatched.skipped`, `sheet_sync.drain.booking_missing`, `sheet_sync.drain.cancellation_missing`, `sheet_sync.drain.tombstone_missing`. Legacy copies drop `.drain.`. Rename functions; keep the strings until log searches are migrated on purpose.

14. **Side-effect `Agent` / `Customer` imports are load-bearing.** The first test asserts `mongoose.models.Customer` and `mongoose.models.Agent` so `booking_chain` populate can resolve. Do not delete those imports so “the planner file is lean.”

15. **`Bad Calls` is never a write target.** `SHEET_TAB_NAMES.badCalls` exists and source tab sets may include it. No plan path targets it. Do not start writing Bad Calls so “the tab name is honest.”

16. **Leave sibling modules alone.** `getLinkedLead` stays in `sourceLeadLookup`. `getLeadTargets` / `formLeadToRow` / `callLeadToRow` / `bookedLeadToRow` / `cancelledLeadToRow` stay in later `googleSheets/`. `writeBatchedTargets` stays in later `batchWriter.ts`. `runSheetSyncDrain` stays on the already-recommended drain. `syncSourceLeadById` stays on already-recommended source lookup. `syncAndStore` stays on already-recommended persistence. This file orchestrates reload → choose tabs → return the write list.

## Testing

The **interface** is the test surface: `planTheSheetWritesForThisClaimedJob` (today `planJobWrites`). `{ docKey, doc?, writes }` is part of that **interface**. Stub `getLinkedLead` / `findById`; do not boot Google Sheets.

`jobPlanner.test.ts` already locks tombstone deletes, unknown-header drop, `target_hints`, empty-tombstone `{ writes: [] }`, Form Bad Leads dual-write, cleared-`bad_lead` delete-only-when-remembered, Call stale Calls delete without `sheet_sync[]`, and the Agent / Customer model register. That is the right **interface**. It is not enough. The previous drain pass said this file locks unmatched skip and missing Booking; those tests are not on disk. Add them. Keep the existing ones.

**Plan the sheet writes for this claimed job**
- Form Lead, not bad → `master_forms` upsert; `master_bad_leads` is absent.
- Form Lead `bad_lead` set → `master_forms` **and** `master_bad_leads` upsert (already locked).
- Form Lead `bad_lead` cleared and `sheet_sync[]` has `master_bad_leads` → that target is `delete` (already locked).
- Form Lead `bad_lead` cleared and `sheet_sync[]` has no Bad Leads row → no Bad Leads write.
- Form Lead duplicate flip → current Duplicates upsert; **no** Forms stale-delete (do not add one).
- Call Lead not unmatched → current Calls or Duplicate Calls upsert **plus** stale opposite delete even when `sheet_sync[]` is empty (already locked).
- Call Lead `created_on_unmatched === true` → `[]`, `sheet_sync.drain.call_lead.created_on_unmatched.skipped`, no Calls write.
- Missing source Lead → `NotFoundError` (do not return `[]`).
- `booked_lead` with a live Booking → only `master_booked` (referral replica already asserts this).
- `booked_lead` / `booking_chain` with a missing Booking → `[]`, `sheet_sync.drain.booking_missing`.
- `booking_chain` with `lead_ref` + `lead_model` → Booked Deals **then** source writes (order asserted).
- `booking_chain` with no source pointer → Booked Deals only.
- `booking_chain` with a vanished source Lead → throw; booked writes are not returned.
- `cancellation_chain` with a live Cancellation → booking-chain writes first, then `master_cancelled` on the originally loaded document.
- `cancellation_chain` with a missing Cancellation → `[]`, `sheet_sync.drain.cancellation_missing`.
- `cancellation_chain` with a vanished Booking → no Booked Deals / source writes; Cancelled Deals still planned.
- Tombstone `previous_targets` → deletes, no `doc` (already locked).
- Unknown header / `target_hints` filter (already locked).
- Missing tombstone → `[]`.
- Empty `previous_targets` → `[{ writes: [] }]` (already locked).
- `target_hints: []` or omitted → every current tab is planned.

**Not this interface**
- Persist / finalize / unmigrated schedule stay on [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md).
- Remember-or-fold / tombstone enqueue stay on [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md).
- Wake-up stays on [recommendations/sheet-sync-queue.md](sheet-sync-queue.md).
- Legacy `save()` remember stays on [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md).
- Live lookup-then-write stays on [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md).
- Take-the-seat / claim / empty-plan→`synced` / quota defer stay on [recommendations/sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md).
- Batch / append / delete-high-to-low / read-quota defer stay on later `drainer/batchWriter.ts` (`drainer.test.ts` already covers them).
- Tab-map Mongo-id lookup of a stale row stays on later `drainer/tabRowMap.ts`.
- Projection cell values stay on later `googleSheets/projections`.
- `getLinkedLead` stays helper **depth**; prove the 404 through this **interface**, not a second helper-unit file.

Do **not** add a test per helper (`theCurrentCallsOrDuplicateCallsTab`, `onlyTheTabsThisRetryStillNeeds`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file talks to Google Sheets — it must not. Do not add a test that this file marks a job `synced` — it must not. Do not add a test that queued mode calls `syncSourceLeadById` — it must not. Do not add a test that Form duplicate flip deletes Forms — it must not. Do not add a test that a vanished source Lead returns `[]` — it must not.

`PlannedDoc.doc` stays optional because tombstone is a real **adapter**, not a test leak.

## What I would not do

- A `SheetSyncJobPlannerService` class with `plan` / `upsert` / `delete`.
- Thirty two-line functions that only wrap `getLeadTargets`.
- Moving this into a CRUD folder, or into `sheetSyncSourceLookup.ts` / `runSheetSyncDrain.ts` / `googleSheets.service.ts` “for cleanliness.”
- Breaking the booked-then-source / booking-chain-then-cancelled **seam**. Order is the owner story.
- Treating `persistSheetSyncIntent` / `publishSheetSyncWakeup` / `syncAndStore` / `syncSourceLeadById` / `runSheetSyncDrain` / `writeBatchedTargets` as this story.
- Inventing a live-write **seam** that has only one **adapter** here.
- Silently routing this file through `syncSourceLeadById`, or silently writing an unmatched Call stub, or silently 404ing a missing Booking, or silently adding a Forms stale-delete.
- Writing a whole-folder recommendation for `sheetSync`.
- Jumping to `googleSheets` while this checklist has unchecked modules.
- Marking the job `synced` from this file, or making the Form Lead 201 wait on a plan.
