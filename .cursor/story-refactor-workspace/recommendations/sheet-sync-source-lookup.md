# Find The Live Lead, Booking, Or Cancellation And Write Its Sheet Row Now — Booked Deals First, Then The Source Row, Then Cancelled Deals — Skip Unmatched Call Stubs — operational story

- Status: recommended
- Service: `sheetSync` (Wave A, in-progress)
- Pass: 5 of this service — `sheetSyncSourceLookup.ts`
- Remaining in this service: `drainer/runSheetSyncDrain.ts`, `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`
- Target: `src/services/sheetSync/sheetSyncSourceLookup.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (legacy `waitUntil` refresh; unmatched Call skip is also true on this path). Distinct from already-recommended mode-aware persist / finalize / unmigrated schedule: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md) (`runFullSheetSyncProcess` only **dispatches** here). Distinct from already-recommended outbox coalesce + tombstone: [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md). Distinct from already-recommended wake-up: [recommendations/sheet-sync-queue.md](sheet-sync-queue.md). Distinct from already-recommended remember-on-document: [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md) (`syncAndStore` is this file’s write **seam**). Distinct from later drain / plan / batch / quota: `drainer/` — queued `planSourceLead` / `planBookedLead` / `planBookingChain` / `planCancellationChain` **mirror** these owner rules and write through `batchWriter`, not this file. Distinct from Google Sheets tabs / projections / dual Source Company writes: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (this file picks which writer; the writer owns tabs). Distinct from named source-lead load: [recommendations/leads-source-lead-lookup.md](leads-source-lead-lookup.md) (`getLinkedLead` 404s a missing Lead; this file does not filter Duplicate / unmatched / booked). Distinct from leftover Cancellation delete inline refresh: [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). Distinct from leftover mirror `syncAfterClear` default: [recommendations/cancellations-cancellation-mirror.md](cancellations-cancellation-mirror.md), [recommendations/bookings-booking-mirror.md](bookings-booking-mirror.md). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). Distinct from Form Lead remember-then-dispatch (that file calls the coordinator **seam**; it does not call this file): [recommendations/form-lead.md](form-lead.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge `cancelled-lead.md` labels `syncCancellationChainById` as “drainer/legacy”; the drain never imports this file. Do not “fix” that in this rename.
- Callers: **four runtime import sites, plus the barrel. No folder test.** Coordinator `runFullSheetSyncProcess` — `source_lead` → `syncSourceLeadById`, `booked_lead` → `syncBookedLeadById`, `booking_chain` → `syncBookingChainById`, `cancellation_chain` → `syncCancellationChainById` (legacy `waitUntil` / tests / scripts). Leftover Cancellation delete (legacy branch + command `finalize` leftover): `cancellations/cancelledLead.service.ts` — `syncBookingAndSource` when the Booking still has a Lead pointer, else `syncSourceLeadById`. Leftover mirror take-off default: `cancellations/cancellationMirror.service.ts` and `bookings/bookingMirror.service.ts` call `syncSourceLead` only when `syncAfterClear` is left on — every current caller passes `false`. Barrel: `sheetSync/index.ts` re-exports all six names. `v1.service.ts` does **not** re-export this file. Not this **interface**: persist / finalize / unmigrated schedule, outbox remember / tombstone, queue wake-up, later drain `plan*` / `updateOne`, later `googleSheets/` writers, admin retry / health, cron / queue consumer. There is no `sheetSyncSourceLookup.test.ts`. Unmatched skip / missing Booking / missing Cancellation have planner tests, not this file.
- Seams callers need: by-id load vs already-hydrated document (mirrors already have the Lead); booked-row-only vs booking-then-source (leadless / referral vs attached); missing Booking / Cancellation is warn + return vs missing source Lead is `getLinkedLead` 404; `syncBookingAndSource` `orFail` (caller already found the Booking) vs chain entry warn + return; coordinator dispatch vs leftover delete inline; this legacy write vs later queued `plan*` (same owner rules, different **adapter**)
- Split later (only if the file outgrows one sitting): keep one file — this ~130-line module is one screenplay. If it later outgrows one sitting, split by story (`writeTheSourceLeadRowNow.ts`, `writeTheBookedDealsRowNow.ts`, `writeTheBookingChainNow.ts`, `writeTheCancellationChainNow.ts`), never `create.ts` / `update.ts` / `delete.ts` / `lookup.ts`, and never merge coordinator mode, outbox, queue, remember-on-document, drain `plan*`, or Google Sheets projections into this file

`syncSourceLeadById` / `syncBookingChainById` are executor mechanics. The owner question is: *The coordinator already decided we are on the old path — or a leftover Cancellation delete still refreshes inline. Find the live Lead, Booking, or Cancellation and write its sheet row now. Booked Deals first, then the source row so any mirrored booking fields stay aligned. A Cancellation Chain writes that booking chain first, then Cancelled Deals. An unmatched Call stub must not appear on the Calls tab until it has real call data. Do not write the outbox. Do not drain. Do not choose tabs yourself. The queued planner already mirrors these rules and writes in batches — do not silently switch this file to that path.*

Coordinator persist / finalize, outbox coalesce, queue wake-up, remember-on-document, drain, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “find the live document and write its sheet row now” story, not “a lookup CRUD service,” and not the writer / remember / drain:

1. **Write the source lead row now** — `syncSourceLead` / `syncSourceLeadById`. By id: load the named Form or Call through `getLinkedLead` (404 if missing — this file does not 404 a Duplicate, a booked Lead, or an unmatched stub). Already-hydrated: skip a Call Lead with `created_on_unmatched === true` (`sheet_sync.call_lead.created_on_unmatched.skipped`) and return. Otherwise populate `booked` + `customer`, then `syncAndStore` with `syncCallLeadToSheets` or `syncFormLeadToSheets`. This beat does not write Booked Deals. This beat does not write the outbox.

2. **Write the Booked Deals row now** — `syncBookedLeadById`. Load the Booking with `customer` and `agent_allocations.agent`. Missing → `sheet_sync.booking_missing` and return (do not invent a row). Then `syncAndStore` with `syncBookedLeadToSheets`. Leadless / referral and the Booking-chain fallback when there is no source pointer live here. This beat does not follow `lead_ref`.

3. **Write the Booking Chain now** — `syncBookingChainById` / `syncBookingAndSource`. Load the Booking (no populate). Missing → same warn + return. No `lead_ref` / `lead_model` → operation 2 only. Otherwise write Booked Deals first (`orFail` reload with populate), then operation 1 for the linked source. Order is load-bearing: the booked sheet refreshes first so the source row can mirror booking fields. This beat does not write Cancelled Deals.

4. **Write the Cancellation Chain now** — `syncCancellationChainById`. Load the Cancellation. Missing → `sheet_sync.cancellation_missing` and return. Then operation 3 for `booked_lead`, then `syncAndStore` on the already-loaded Cancellation with `syncCancelledLeadToSheets`. Order is load-bearing: booking chain first, Cancelled Deals second. This beat does not delete the Cancellation row.

There is no fifth mutate operation. Mode, wake-up, tab routing, quota, and outbox coalesce are other files. The queued planner’s `plan*` functions are a different **adapter** for the same owner rules, not this file.

## Organization

Keep one file as the screenplay for “find the live Lead, Booking, or Cancellation and write its sheet row now — Booked Deals first, then the source row, then Cancelled Deals — skip unmatched Call stubs.” Coordinator, outbox, queue, remember-on-document, drain, and Google Sheets writers already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncSourceLookupService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator. Do not invent a second writer **adapter** beside later `googleSheets/`. Do not invent a second remember **adapter** beside already-recommended `syncAndStore`. Do not invent a drain `plan*` **adapter** here.

Do not move this into `sheetSyncCoordinator.ts` so “refresh-now owns the load.” Do not move this into `googleSheets.service.ts` so “the writer owns the chain.” Do not move this into `jobPlanner.ts` so “one lookup owns every mode.” Do not split `create.ts` / `update.ts` / `delete.ts`. Do not silently empty-plan a missing source Lead so “we match missing Booking.” Do not silently write an unmatched Call stub so “the facade was invoked.”

**External interface** stays small (this is the test surface). Source, booked-only, booking-then-source, and cancellation-after-chain are one story’s live write, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `syncSourceLead` | `writeTheSourceLeadRowNow` | leftover mirrors already hold the hydrated Lead |
| `syncSourceLeadById` | `findTheSourceLeadAndWriteItsRowNow` | coordinator `source_lead` + leftover delete when only the pointer remains |
| `syncBookedLeadById` | `writeTheBookedDealsRowNow` | leadless / referral / chain fallback — no source row |
| `syncBookingAndSource` | `writeTheBookedRowThenTheSourceRow` | leftover Cancellation delete already loaded the Booking |
| `syncBookingChainById` | `writeTheBookingChainNow` | coordinator `booking_chain` — load, then booked-only or booked-then-source |
| `syncCancellationChainById` | `writeTheCancellationChainNow` | coordinator `cancellation_chain` — booking chain first, then Cancelled Deals |

Keep the old names as one-line aliases until the coordinator, leftover Cancellation delete, leftover mirrors, and the barrel migrate. Do not make callers learn `getLinkedLead` / `syncAndStore` / `syncFormLeadToSheets` as the domain language.

**Principle: old exports stay as aliases.** `syncSourceLeadById` / `syncBookingChainById` remain the imported names until `runFullSheetSyncProcess` and leftover delete point at the story names.

**No class for the workflow.** The type that *does* earn a name is the attached-Booking pointer the chain already requires before it follows the source:

```ts
type AttachedBookingPointer = {
  bookingId: mongoose.Types.ObjectId
  leadModel: LeadModelName
  leadId: string
}
```

That is the handoff from “this Booking names a Form or Call” to “write Booked Deals, then that source row.” Do **not** add `sheet_sync[]` so “lookup owns the hint,” do **not** add `published: true` so “lookup can prove the queue,” and do **not** add `tombstone` so “one function owns delete.” Delete sheets stay on leftover `delete*FromSheets` / queued tombstone, not this file.

`syncBookingAndSource` stays exported because leftover Cancellation delete is a real **adapter**, not a test leak. `syncSourceLead` stays exported because leftover mirror take-off is a real **adapter** (default on, callers pass `false`).

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sheetSyncSourceLookup.ts
// Find the live Lead, Booking, or Cancellation.
// Write its sheet row now.
// Booked Deals first, then the source row so mirrored booking fields stay aligned.
// A Cancellation Chain writes that booking chain first, then Cancelled Deals.
// Skip unmatched Call stubs — they must not appear on Calls until they have real call data.
// Do not write the outbox.
// Do not drain.
// Do not choose tabs yourself.
// The queued planner already mirrors these rules.
// Do not silently switch this file to that path.

// ── 1. Write the source lead row now ──────────────────────

export async function findTheSourceLeadAndWriteItsRowNow(leadModel, leadId)
  // getLinkedLead — 404 if missing
  // then writeTheSourceLeadRowNow

export async function writeTheSourceLeadRowNow(lead, leadModel)
  // skip unmatched Call stub
  // populate booked + customer
  // remember via syncAndStore + Form or Call writer

export const syncSourceLeadById = findTheSourceLeadAndWriteItsRowNow
export const syncSourceLead = writeTheSourceLeadRowNow

function skipTheUnmatchedCallStub(lead, leadModel)  // created_on_unmatched === true

// ── 2. Write the Booked Deals row now ─────────────────────

export async function writeTheBookedDealsRowNow(bookingId)
  // load with customer + agents
  // missing → warn + return
  // remember via syncAndStore + booked writer

export const syncBookedLeadById = writeTheBookedDealsRowNow

// ── 3. Write the Booking Chain now ────────────────────────

export async function writeTheBookingChainNow(bookingId)
  // load Booking (no populate)
  // missing → warn + return
  // no source pointer → writeTheBookedDealsRowNow
  // else writeTheBookedRowThenTheSourceRow

export async function writeTheBookedRowThenTheSourceRow(bookingId, leadModel, leadId)
  // orFail reload with populate
  // Booked Deals first
  // then writeTheSourceLeadRowNow

export const syncBookingChainById = writeTheBookingChainNow
export const syncBookingAndSource = writeTheBookedRowThenTheSourceRow

// ── 4. Write the Cancellation Chain now ───────────────────

export async function writeTheCancellationChainNow(cancellationId)
  // load Cancellation
  // missing → warn + return
  // writeTheBookingChainNow first
  // then remember via syncAndStore + cancelled writer

export const syncCancellationChainById = writeTheCancellationChainNow
```

Read the Booking Chain out loud: *The coordinator already decided we are on the old path. This file finds the Booking. If it is gone, we say so and stop — we do not invent a Booked Deals row. If it has no source Lead, we write Booked Deals only. If it names a Form or Call, we write Booked Deals first, then that source row, so the mirrored booking fields stay aligned. An unmatched Call stub is skipped. A successful API response already happened — this is the background refresh.*

Read the Cancellation Chain out loud: *Same old path. Find the Cancellation. If it is gone, stop. Write the booking chain first, then Cancelled Deals on the document we already loaded. Leftover Cancellation delete does not use this chain — it already wiped Cancelled Deals, then asks for booked-then-source or source-only so the surviving rows catch up.*

Read the queued contrast out loud: *Queued mode never calls this file. The drain reloads Mongo, plans the same chain order, writes in batches, and `updateOne`s `sheet_sync[]`. Missing Booking / Cancellation there is an empty plan marked `synced`. Unmatched Call skip is the same owner rule with a drain log name. That is a later pass.*

That is the operation. `syncSourceLeadById` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file is legacy-plus-leftover on purpose.** Coordinator `refreshTheSheetsNow` is the scheduled path. Leftover Cancellation delete and leftover mirror take-off call it inline. Queued create / update / delete never import this file. Do not call this from the drain. Do not add `getSheetSyncMode()` here so “queued can reuse the load.”

2. **Two write **adapters**, one owner chain.** This file loads one document and `syncAndStore`s through the googleSheets facade. The later planner loads the same documents, builds a write list, and the drain batches them. Knowledge already says tab routing must stay aligned. Keep both **adapters**. Do not silently route `runFullSheetSyncProcess` through `planJobWrites` so “one lookup owns every mode.”

3. **Unmatched Call skip is this file’s job, not the writer’s.** `google-sheets.md` says `created_on_unmatched` is skipped **before** the facade; `syncCallLeadToSheets` will write a Calls row if invoked directly. Planner has the same skip with `sheet_sync.drain.call_lead.created_on_unmatched.skipped`. Keep both log names. Do not delete the skip so “the writer can decide,” and do not teach `getLinkedLead` to 404 unmatched stubs so “lookup always means sheetable.”

4. **Missing Booking / Cancellation is warn + return. Missing source Lead is 404.** `getLinkedLead` throws `NotFoundError`. A vanished Booking or Cancellation logs and returns so the background refresh does not invent a row. A vanished source Lead fails the refresh (legacy `waitUntil` / leftover delete). Planner missing Booking / Cancellation is an empty plan marked `synced`; a missing source Lead still throws from `getLinkedLead`. Do not empty-return a missing Lead so “every miss is quiet.” Do not throw on a missing Booking so “every miss is loud.”

5. **`syncBookingAndSource` uses `orFail`. Chain entry does not.** Leftover delete already found the Booking. Coordinator chain entry must tolerate a race after commit. Do not switch the leftover path to warn + return so “one helper owns both,” and do not switch chain entry to `orFail` so “a missing Booking fails the `waitUntil`.”

6. **Booking Chain loads twice.** `writeTheBookingChainNow` loads without populate, then `writeTheBookedDealsRowNow` or `writeTheBookedRowThenTheSourceRow` loads again with populate. Planner loads once. Name that. Do not merge the loads in this rename so “we match queued,” and do not drop populate so “one query is enough” — Booked Deals needs customer + agents.

7. **Cancellation Chain writes the originally loaded document.** After the booking chain, this file does not reload the Cancellation. Planner does the same. Do not reload so “we pick up a concurrent patch,” and do not populate customer here so “the cancelled writer matches booked” — `syncCancelledLeadToSheets` already snapshots from the Cancellation.

8. **Order is load-bearing.** Booked Deals before source. Booking chain before Cancelled Deals. Knowledge names both. Leftover Cancellation delete already wiped Cancelled Deals **before** it asks for booked-then-source. Do not write source first so “the Lead is the System of Record.” Do not write Cancelled Deals first so “the job resource is cancellation.” Do not silently reorder Form Lead sheets-before-CRM (that labeled ADR order lives on the Form Lead recommendation, not here).

9. **Leadless / referral is booked-only.** No `lead_ref` / `lead_model` → operation 2. Referral create schedules `booked_lead`, not `booking_chain`. Do not follow a missing pointer into `getLinkedLead` so “every Booking has a source.”

10. **Log message shapes are load-bearing.** `sheet_sync.booking_missing`, `sheet_sync.cancellation_missing`, `sheet_sync.call_lead.created_on_unmatched.skipped`. Drain copies add `.drain.`. Rename functions; keep the strings until log searches are migrated on purpose.

11. **`getLinkedLead` does not filter eligibility.** Duplicate Leads, booked Leads, cancelled Leads, and unmatched stubs all load. The unmatched skip is the next beat. Do not 404 a Duplicate from this write so “sheets never show Duplicates” — the Form writer routes that tab.

12. **Leftover `syncAfterClear` default still calls this file.** Knowledge Role says cancellation-mirror does not Sheet Sync directly. Every current caller passes `false`. Do not delete `syncSourceLead` from the default so the Role line “wins,” and do not flip the default in this rename.

13. **Knowledge says “drainer/legacy” for `syncCancellationChainById`.** The drain never imports this file. `finalizeSheetSync` reaches here only in legacy through `runFullSheetSyncProcess`. Do not add a drain import so the sentence “becomes true.”

14. **Leave sibling modules alone.** `getLinkedLead` stays in `sourceLeadLookup`. `syncAndStore` stays in already-recommended persistence. `syncFormLeadToSheets` / `syncCallLeadToSheets` / `syncBookedLeadToSheets` / `syncCancelledLeadToSheets` stay in later `googleSheets/`. `planSourceLead` / `planBookingChain` stay in later `jobPlanner.ts`. `runFullSheetSyncProcess` stays on the coordinator. This file orchestrates load → skip-or-populate → remember.

15. **Do not treat tombstone as this story.** Delete services snapshot `sheet_sync[]` and write an outbox tombstone **before** the hard Mongo delete, or leftover `delete*FromSheets` inline. This file writes live upserts on documents that still exist. A queued tombstone has no surviving document for this load.

## Testing

The **interface** is the test surface: `writeTheSourceLeadRowNow` / `findTheSourceLeadAndWriteItsRowNow`, `writeTheBookedDealsRowNow`, `writeTheBookingChainNow` / `writeTheBookedRowThenTheSourceRow`, `writeTheCancellationChainNow` (today `syncSourceLead`, `syncSourceLeadById`, `syncBookedLeadById`, `syncBookingChainById`, `syncBookingAndSource`, `syncCancellationChainById`). The document that was loaded, the writer that was injected, the skip, and the chain order are part of that **interface**.

There is no `sheetSyncSourceLookup.test.ts`. Planner tests lock unmatched skip and missing Booking / Cancellation on the queued **adapter**. Coordinator / outbox tests never stub this file. That is not enough for a live write this small and this load-bearing. Add tests that name the operation. Stub `syncAndStore` and the googleSheets writers; do not boot Google Sheets.

**Write the source lead row now**
- Form Lead by id → `getLinkedLead` + Form writer + `syncAndStore`; Booked writer is not called.
- Call Lead by id, not unmatched → Call writer after `booked` + `customer` populate.
- Call Lead `created_on_unmatched === true` → no writer, `sheet_sync.call_lead.created_on_unmatched.skipped`, return.
- Missing source Lead → `NotFoundError` (do not warn + return).
- Already-hydrated leftover mirror path (`syncSourceLead`) does not call `getLinkedLead` again.

**Write the Booked Deals row now**
- Booking exists → booked writer + populate customer / agents; source writer is not called.
- Booking missing → `sheet_sync.booking_missing`, no writer.

**Write the Booking Chain now**
- Attached Booking → booked writer **then** source writer (order asserted).
- No `lead_ref` / `lead_model` → booked writer only (leadless / referral).
- Booking missing at chain entry → warn + return; `orFail` is not used.
- Leftover `syncBookingAndSource` on a vanished Booking → `orFail` throws (do not quiet it).

**Write the Cancellation Chain now**
- Cancellation exists → booking chain first, then cancelled writer on the originally loaded document.
- Cancellation missing → `sheet_sync.cancellation_missing`, no booking-chain call.
- Booking chain is asked with `cancellation.booked_lead`, not the cancellation id.

**Not this interface**
- Persist / finalize / unmigrated schedule stay on [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md).
- Remember-or-fold / tombstone stay on [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md).
- Wake-up stays on [recommendations/sheet-sync-queue.md](sheet-sync-queue.md).
- Merge / save / delete-marker stay on [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md).
- Tab routing / Bad Leads / Call duplicate-flip stay on later `googleSheets/` and [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md).
- Drain `plan*` / empty-plan `synced` stay on later `drainer/jobPlanner.ts`.
- `getLinkedLead` stays helper **depth**; prove the 404 through this **interface**, not a second helper-unit file.

Do **not** add a test per helper (`skipTheUnmatchedCallStub`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that queued mode calls this file — it must not. Do not add a test that this file writes `sheet_sync_jobs` — it must not. Do not add a test that this file talks to Google Sheets without going through the injected writer — it must not. Do not add a test that `syncCallLeadToSheets` is skipped inside the writer — the skip is here.

`syncBookingAndSource` and `syncSourceLead` stay exported because leftover delete / leftover mirror are real **adapters**, not a test leak.

## What I would not do

- A `SheetSyncSourceLookupService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `findById` / `syncAndStore`.
- Moving this into a CRUD folder, or into `sheetSyncCoordinator.ts` / `googleSheets.service.ts` / `jobPlanner.ts` “for cleanliness.”
- Breaking the booked-then-source / booking-chain-then-cancelled **seam**. Order is the owner story.
- Treating later `persistSheetSyncIntent` / `publishSheetSyncWakeup` / `runSheetSyncDrain` / `planJobWrites` / `syncAndStore` as this story.
- Inventing a drain `plan*` **seam** that has only one **adapter** here.
- Silently routing this file through `planJobWrites`, or silently writing an unmatched Call stub, or silently 404ing a missing Booking.
- Writing a whole-folder recommendation for `sheetSync`.
- Jumping to `googleSheets` while this checklist has unchecked modules.
- Reordering Form Lead sheets-before-CRM (that labeled ADR order lives on the Form Lead recommendation, not here).
