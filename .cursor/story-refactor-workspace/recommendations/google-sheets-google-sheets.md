# Choose The Tabs This Live Document Belongs On Right Now, Then Write Or Take Off The Row — Forms Or Duplicates, Calls Or Duplicate Calls, Booked Deals, Cancelled Deals — Mongo Is The Record, Sheets Are Reporting — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, in-progress)
- Pass: 1 of this service — `googleSheets.service.ts`
- Remaining in this service: `targets.ts`, `tabs.ts`, `syncRows.ts`, `rowLookup.ts`, `deleteRows.ts`, `retry.ts`, `projections/formLeadRow.ts`, `projections/callLeadRow.ts`, `projections/bookedLeadRow.ts`, `projections/cancelledLeadRow.ts` (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/googleSheets.service.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (tab routing, master-first, optional Source Company, legacy Bad Leads always-clear vs queued only-when-remembered, Call stale-tab delete on sync, `created_on_unmatched` skip lives **before** this file). Distinct from already-recommended mode-aware persist / finalize / unmigrated schedule: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md). Distinct from already-recommended outbox coalesce + tombstone: [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md). Distinct from already-recommended wake-up: [recommendations/sheet-sync-queue.md](sheet-sync-queue.md). Distinct from already-recommended remember-on-document: [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md) (`syncAndStore` is the legacy write **seam** that calls this file). Distinct from already-recommended live lookup-then-write: [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md) (this file is the writer that lookup picks; lookup owns unmatched skip and chain order). Distinct from already-recommended queued plan: [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md) (**mirrors** these tab rules and does **not** import this file; queued Bad Leads delete only when `sheet_sync[]` already has `master_bad_leads`). Distinct from already-recommended batch write / tab map / quota: [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md), [recommendations/sheet-sync-tab-row-map.md](sheet-sync-tab-row-map.md), [recommendations/sheet-sync-quota-limiter.md](sheet-sync-quota-limiter.md). Distinct from leftover Form / Call / Booking / Cancellation delete (legacy branch only — queued tombstones): [recommendations/form-lead.md](form-lead.md), [recommendations/leads-call-lead.md](leads-call-lead.md), [recommendations/bookings-booked-lead.md](bookings-booked-lead.md), [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). Distinct from later `targets.ts` (Master always, Source Company only when `WRITE_SOURCE_LEAD_SHEETS=true`), later `syncRows.ts` / `rowLookup.ts` / `deleteRows.ts` / `tabs.ts` / `retry.ts`, later projections. Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root`). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names the legacy-vs-queued Bad Leads delete gap and that this facade will write an unmatched Call if invoked directly; do not “fix” those in this rename.
- Callers: **five runtime import sites, plus the leftover root barrel. No file test.** Legacy write: `sheetSync/sheetSyncSourceLookup.ts` calls `syncFormLeadToSheets` / `syncCallLeadToSheets` / `syncBookedLeadToSheets` / `syncCancelledLeadToSheets` through `syncAndStore` (unmatched Call skip happens in lookup, not here). Leftover legacy delete: `leads/formLead.service.ts` → `deleteFormLeadFromSheets`; `leads/callLead.service.ts` → `deleteCallLeadFromSheets`; `bookings/bookedLead.service.ts` → `deleteBookedLeadFromSheets` and, on cascade, `deleteCancelledLeadFromSheets`; `cancellations/cancelledLead.service.ts` → `deleteCancelledLeadFromSheets`. Those deletes run only when `SHEET_SYNC_MODE` is not `queued` — queued enqueues a tombstone and never calls this file. Barrel: `src/services/googleSheets.service.ts` re-exports all nine names. `v1.service.ts` does **not** re-export this file. Not this **interface**: coordinator persist / finalize, outbox tombstone, queue wake-up, already-recommended `planJobWrites` (copies `callLeadTargetBase` / Form tab / Bad Leads locally), later `getLeadTargets` / `syncRowToTargets` / `deleteRowsFromTargets` / `*ToRow`, admin / cron / drain. There is no `googleSheets.service.test.ts`. Sibling `targets.test.ts` / `tabs.test.ts` / `projections/projections.test.ts` are later modules. `ensureAllConfiguredSheetTabs` has **no** `src/` or `scripts/` caller on this disk — knowledge still names startup/scripts.
- Seams callers need: write the current tabs vs take the row off (legacy live write vs leftover delete); Form primary tab vs also-write Bad Leads vs always-clear Bad Leads; Call current tab vs always-delete the stale opposite; Booking / Cancellation Master Booked only (no source booked sheet); this live facade vs already-recommended queued `planJobWrites` (same owner tab rules, different **adapter**); provision-every-container vs later per-row ensure of the one tab being written
- Split later (only if the file outgrows one sitting): this ~260-line file is one sitting if you read it as choose tabs from current flags → project the row → write or take it off. If it later splits: `writeTheFormLeadOntoItsReportingTabs.ts` / `writeTheCallLeadOntoItsReportingTabs.ts` / `writeTheBookingOntoBookedDeals.ts` / `writeTheCancellationOntoCancelledDeals.ts` / `takeTheDocumentOffItsReportingTabs.ts` / `provisionEveryConfiguredReportingSheet.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `sync.ts`, and never merge already-recommended lookup / planner / batch writer, later `targets.ts`, or later projections into this file

`syncFormLeadToSheets` / `deleteCallLeadFromSheets` are executor mechanics. The owner question is: *Mongo already has the live Form Lead, Call Lead, Booking, or Cancellation. Choose the Reporting Sheets tabs that document belongs on right now. A Form that is a Duplicate Lead goes on Duplicates, not Forms. A Form that is a Bad Lead also goes on Master Bad Leads; when that flag is cleared this path always takes the Bad Leads row off, even if we never wrote one. A Call that is a Duplicate Lead goes on Duplicate Calls, and we always take it off the stale opposite tab. A Booking is Booked Deals only. A Cancellation is Cancelled Deals only. Then write the row, or take it off. Sheets are reporting. They are never the record for lead state, CPL, or CRM. The queued planner already mirrors these tab rules and writes in batches — do not silently switch this file to that path, and do not silently teach the planner to call this facade.*

Coordinator persist / finalize, outbox tombstone, queue wake-up, already-recommended lookup / planner / batch writer, later target lists, later upsert / delete cells, and later projections already live in other **modules**. Do not pull those in.

## What this file actually does

Nine beats of one “choose the tabs this live document belongs on right now, then write or take off the row” story, not “a Sheets CRUD service,” and not the planner / the batch writer / the cell projection:

1. **Write the Form Lead onto its current tabs** — `syncFormLeadToSheets`. Duplicate → Duplicates (`master_duplicates` / `source_duplicates`); else Forms. Project with later `formLeadToRow`. Write those targets through later `syncRowToTargets` (Master always; Source Company only when later `getLeadTargets` sees `WRITE_SOURCE_LEAD_SHEETS=true`). If `bad_lead` is set, also write Master Bad Leads. If `bad_lead` is cleared, **always** call later `deleteRowsFromTargets` on Master Bad Leads — even when `sheet_sync[]` never had that target. Return per-target `SheetSyncUpdateEntry[]` (writes plus `{ target, status: "deleted" }` for a cleared Bad Leads row). This beat does not skip a Duplicate Lead. This beat does not write Booked Deals.

2. **Write the Call Lead onto its current tabs** — `syncCallLeadToSheets`. `callLeadTargetBase(duplicate)` → Calls or Duplicate Calls (same `CALL_SHEET_HEADERS`). Write the current tabs. Then **always** delete the stale opposite tabs (`callLeadTargetBase(!duplicate)`), even when `sheet_sync[]` is empty — later delete looks up by Mongo ID. Return writes plus deleted-target entries. This beat does **not** skip `created_on_unmatched` — already-recommended lookup / planner do that **before** calling a writer. Invoked directly, this function will write a Calls row. This beat does not write `Bad Calls` (that tab is provisioned on some Source Company sheets; no write path targets it).

3. **Write the Booking onto Booked Deals** — `syncBookedLeadToSheets`. One target: Master Booked / `Booked Deals`. No Source Company booked sheet. Project with later `bookedLeadToRow`. Return `SheetSyncEntry[]`. This beat does not follow `lead_ref` — already-recommended lookup / planner own Booking Chain order.

4. **Write the Cancellation onto Cancelled Deals** — `syncCancelledLeadToSheets`. One target: Master Booked / `Cancelled Deals`. Same container as Booked Deals, different tab. This beat does not write the Booking Chain first — callers do.

5. **Take the Form Lead off its current tabs** — `deleteFormLeadFromSheets`. Same Forms-or-Duplicates choice as operation 1. Delete those targets **and** list `master_bad_leads` in the synced-target list so later `getDeleteTargets` can also clear a remembered Bad Leads row. Void. Queued leftover delete never reaches here.

6. **Take the Call Lead off its current tabs** — `deleteCallLeadFromSheets`. Current duplicate-aware primary only. Does **not** also delete the stale opposite — that happens on **write** (operation 2). Void.

7. **Take the Booking off Booked Deals** — `deleteBookedLeadFromSheets`. Master Booked only. Void.

8. **Take the Cancellation off Cancelled Deals** — `deleteCancelledLeadFromSheets`. Master Booked / `Cancelled Deals` only. Void. Leftover Booking cascade may call this before taking the Booking off.

9. **Provision every configured Reporting Sheet** — `ensureAllConfiguredSheetTabs`. Later `ensureTabsAndHeaders` on Master Leads, Master Booked, and every Source Company container that has a `leadSheetEnvVar` **and** a resolved spreadsheet id. Skips missing env. Knowledge says startup/scripts. This disk has no `src/` or `scripts/` caller. This beat does not write a document row.

There is no tenth mutate operation. Mode, wake-up, claim, plan, batch, quota, and cell values are other files. Already-recommended `planJobWrites` is a different **adapter** for the same owner tab rules, not this file.

## Organization

Keep one file as the screenplay for “choose the tabs this live document belongs on right now, then write or take off the row — Forms or Duplicates, Calls or Duplicate Calls, Booked Deals, Cancelled Deals — Mongo is the record, sheets are reporting.” Already-recommended lookup / planner / batch writer, later `getLeadTargets` / `syncRowToTargets` / `deleteRowsFromTargets` / `*ToRow`, coordinator, outbox, and queue already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleSheetsService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator. Do not invent a second plan **adapter** beside already-recommended `planJobWrites`. Do not invent a second cell-projection **adapter** beside later `*ToRow`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `sync.ts`. Those are HTTP verbs, not the owner story. Do not move this into `jobPlanner.ts` so “one file owns every mode.” Do not move this into `sheetSyncSourceLookup.ts` so “lookup already writes.” Do not silently call `planJobWrites` from here so “queued reuses the facade.” Do not silently skip `created_on_unmatched` here so “the facade is safe to invoke.” Do not silently change Form Bad Leads delete to only-when-remembered so “we match queued.”

**External interface** stays small (this is the test surface). Form / Call / Booking / Cancellation write-or-remove plus bootstrap provision are one story’s live projection, not nine CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `syncFormLeadToSheets` | `writeTheFormLeadOntoItsReportingTabs` | legacy `syncAndStore` after lookup |
| `syncCallLeadToSheets` | `writeTheCallLeadOntoItsReportingTabs` | same; unmatched skip is the caller |
| `syncBookedLeadToSheets` | `writeTheBookingOntoBookedDeals` | Booked Deals only — no source booked sheet |
| `syncCancelledLeadToSheets` | `writeTheCancellationOntoCancelledDeals` | Cancelled Deals only — chain order is the caller |
| `deleteFormLeadFromSheets` | `takeTheFormLeadOffItsReportingTabs` | leftover legacy Form delete |
| `deleteCallLeadFromSheets` | `takeTheCallLeadOffItsCurrentTabs` | leftover legacy Call delete — current tab only |
| `deleteBookedLeadFromSheets` | `takeTheBookingOffBookedDeals` | leftover legacy Booking delete |
| `deleteCancelledLeadFromSheets` | `takeTheCancellationOffCancelledDeals` | leftover Cancellation delete + Booking cascade |
| `ensureAllConfiguredSheetTabs` | `provisionEveryConfiguredReportingSheet` | bootstrap / scripts — not every row sync |

Keep the old names as one-line aliases until already-recommended source lookup, leftover domain deletes, and the leftover root barrel migrate. Do not make callers learn `getLeadTargets` / `formLeadToRow` / `syncRowToTargets` as the domain language.

**Principle: old exports stay as aliases.** `syncFormLeadToSheets` / `deleteCallLeadFromSheets` remain the imported names until `syncAndStore` and leftover delete point at the story names.

**No class for the workflow.** The type that *does* earn a name is the tab choice current flags already require before we write:

```ts
type ReportingTabChoice = {
  masterTarget: string
  sourceTarget: string
  tabName: string
}
```

That is the handoff from “this Form is a Duplicate Lead” or “this Call is a Duplicate Lead” to “write these Master (and maybe Source Company) tabs.” Do **not** add `sheet_sync[]` so “the facade owns the hint,” do **not** add `created_on_unmatched` so “the facade can skip,” and do **not** add `official_booking_details` so “a booked write can confirm.”

`callLeadTargetBase` stays in this file because leftover write **and** leftover Call delete both need the same current-tab choice. Do not export it so “the planner can import the helper” — already-recommended `jobPlanner.ts` already has its own copy. Align by story, not by a shared private function, unless a later pass extracts a named tab-choice **module**. That extraction is not this pass.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// googleSheets.service.ts
// Mongo already has the live Form Lead, Call Lead, Booking, or Cancellation.
// Choose the Reporting Sheets tabs that document belongs on right now.
// A Duplicate Form goes on Duplicates, not Forms.
// A Bad Lead also goes on Master Bad Leads.
// When that flag is cleared this path always takes the Bad Leads row off.
// A Duplicate Call goes on Duplicate Calls, and we take it off the stale opposite.
// A Booking is Booked Deals only.
// A Cancellation is Cancelled Deals only.
// Then write the row, or take it off.
// Sheets are reporting. They are never the record.
// The queued planner already mirrors these tab rules.
// Do not silently switch this file to that path.
// Do not skip unmatched Call stubs here — the caller already did, or did not.

// ── 1. Write the Form Lead onto its current tabs ──────────

export async function writeTheFormLeadOntoItsReportingTabs(lead)
export const syncFormLeadToSheets = writeTheFormLeadOntoItsReportingTabs

function theCurrentFormOrDuplicatesTab(duplicate)
function alsoWriteMasterBadLeadsWhenTheFlagIsSet(lead, targets)
async function alwaysTakeTheBadLeadsRowOffWhenTheFlagIsCleared(lead)
  // legacy: always delete, even when sheet_sync[] never had master_bad_leads
  // queued planner: only when remembered — do not silently match that here

// ── 2. Write the Call Lead onto its current tabs ──────────

export async function writeTheCallLeadOntoItsReportingTabs(lead)
export const syncCallLeadToSheets = writeTheCallLeadOntoItsReportingTabs

function theCurrentCallsOrDuplicateCallsTab(duplicate)  // today's callLeadTargetBase
async function alwaysTakeTheCallOffTheStaleOppositeTab(lead, staleChoice)

// ── 3. Write the Booking onto Booked Deals ────────────────

export async function writeTheBookingOntoBookedDeals(booking)
export const syncBookedLeadToSheets = writeTheBookingOntoBookedDeals

// ── 4. Write the Cancellation onto Cancelled Deals ────────

export async function writeTheCancellationOntoCancelledDeals(cancellation)
export const syncCancelledLeadToSheets = writeTheCancellationOntoCancelledDeals

// ── 5–8. Take the document off its reporting tabs ─────────

export async function takeTheFormLeadOffItsReportingTabs(lead)
export const deleteFormLeadFromSheets = takeTheFormLeadOffItsReportingTabs

export async function takeTheCallLeadOffItsCurrentTabs(lead)
export const deleteCallLeadFromSheets = takeTheCallLeadOffItsCurrentTabs
  // current tab only — stale opposite is a write beat

export async function takeTheBookingOffBookedDeals(booking)
export const deleteBookedLeadFromSheets = takeTheBookingOffBookedDeals

export async function takeTheCancellationOffCancelledDeals(cancellation)
export const deleteCancelledLeadFromSheets = takeTheCancellationOffCancelledDeals

// ── 9. Provision every configured Reporting Sheet ─────────

export async function provisionEveryConfiguredReportingSheet()
export const ensureAllConfiguredSheetTabs = provisionEveryConfiguredReportingSheet
  // Master Leads, Master Booked, every source container with an env id
  // not every row sync — later syncRows ensures only the tab being written
```

Read the Form write path out loud: *The Form Lead is already saved. If it is a Duplicate Lead we write Duplicates, not Forms. If it is also a Bad Lead we write Master Bad Leads too. If that Bad Lead flag was cleared we take the Bad Leads row off even when we never remember writing one. Master always. Source Company only when the later target helper says the flag is on. We hand later upsert the projected row. We do not ask the queued planner. We do not skip this lead because it is a Duplicate.*

Read the Call write path out loud: *If this Call is a Duplicate Lead we write Duplicate Calls. Then we take the row off Calls. If it flipped the other way, we write Calls and take it off Duplicate Calls. We do that even when `sheet_sync[]` is empty — later delete finds the row by Mongo ID. We do not skip an unmatched stub here. If lookup forgot to skip, we will write a Calls row.*

Read the two-adapters beat out loud: *Queued `planJobWrites` already chooses the same tabs and writes in batches. It does not call this file. Legacy lookup calls this file and waits on the request. Both **adapters** stay. We do not teach this file to return `PlannedWrite[]` so “one planner owns every mode,” and we do not teach the planner to call `syncFormLeadToSheets` so “one facade owns every mode.”*

That is the operation. `syncFormLeadToSheets` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`sync*` / `delete*` are executor mechanics.** The owner story is “choose the tabs this live document belongs on right now, then write or take off the row.” Keep the old names as aliases. Do not grow a `GoogleSheetsService` with `create` / `update` / `delete`.

2. **Form Bad Leads clear is always-delete here, only-when-remembered on the planner.** Knowledge already names this gap. `syncFormLeadToSheets` always calls `deleteRowsFromTargets` on Master Bad Leads when `bad_lead` is cleared. Already-recommended `planSourceLead` deletes that tab only when `sheet_sync[]` already has `master_bad_leads`. Do not silently change this file to only-when-remembered so “we match queued.” Do not silently change the planner to always-delete so “we match legacy.” Rename the beat `alwaysTakeTheBadLeadsRowOffWhenTheFlagIsCleared` so the gap stays visible.

3. **Call stale-tab delete lives on write, not on remove.** Operation 2 always deletes the opposite tab. Operation 6 deletes only the current tab. A leftover Call delete of a lead that just flipped `duplicate` can leave the stale tab until the next write. Do not add a stale-tab delete to `deleteCallLeadFromSheets` in this rename so “delete matches sync.” Do not drop the write-time stale delete so “delete owns cleanup.”

4. **`created_on_unmatched` is not this file’s skip.** Already-recommended lookup / planner return before they call a writer. This facade will write a Calls row if invoked. Do not add `if (lead.created_on_unmatched) return []` here so “the facade is safe.” The type does not even carry that field. Leave the skip on the callers.

5. **`callLeadTargetBase` is copied on the planner.** Same Duplicate → Duplicate Calls table, two functions. Do not extract a shared helper in this pass so “one function owns tabs” and then import it from `jobPlanner.ts` — that would pull a sibling **module** into this sitting. A later tab-choice **module** can own both copies. This file keeps the Call choice next to the Call write.

6. **Form does not delete the stale Forms / Duplicates opposite.** A Form that flips `duplicate` writes the new tab and leaves the old row. Call flips clean up. Do not add a Form stale-tab delete in this rename so “Form matches Call.” Knowledge does not ask for that.

7. **`Bad Calls` is provisioned and never written.** `SHEET_TAB_NAMES.badCalls` is on some Source Company tab sets. No sync or delete in this file targets it. Do not start writing Call Bad Leads here so “we honor the tab.” Do not delete the tab name from later `getSourceLeadTabs` in this pass.

8. **Master always; Source Company only when the later flag is on.** This file calls later `getLeadTargets`. It does not read `WRITE_SOURCE_LEAD_SHEETS` itself. Booking / Cancellation never go through that helper — they hard-code Master Booked. Do not start dual-writing Booked Deals to a source container so “bookings match leads.” Do not inline `shouldWriteSourceLeadSheets` here so “the facade owns the flag.”

9. **Per-target failure is captured; other targets still attempt.** Later `syncRowToTargets` owns that. This file concatenates write results with deleted-target stubs. Do not abort the Form write because Bad Leads delete threw so “one transaction.” Deletes in operations 5–8 are void and do not return per-target failures.

10. **`ensureAllConfiguredSheetTabs` has no caller on this disk.** Knowledge still says startup/scripts. Later `syncRows.ts` comments that full sibling-tab provisioning used to blow write quota, so per-row ensure is the one tab being written. Do not start calling this from `syncFormLeadToSheets` so “every sync heals every tab.” Do not delete the export in this rename so “dead code” — a script may still import the leftover barrel.

11. **This file does not skip a Duplicate Lead, a booked Lead, or a cancelled Lead.** Those flags choose tabs or cell values (later projections). They do not refuse the write. Do not 404 a Duplicate Form here so “we match enrichment lookup.”

12. **Return types disagree on purpose.** Form / Call write return `SheetSyncUpdateEntry[]` (includes `{ target, status: "deleted" }`). Booking / Cancellation write return `SheetSyncEntry[]` from later `syncRowToTargets` only. Deletes are `void`. Do not force one return type in this rename so “the facade is consistent” — leftover `syncAndStore` already knows the write shape.

13. **Leave sibling modules alone.** Later `getLeadTargets` / `getMasterBookedTabs` stay on `targets.ts`. Later `syncRowToTargets` stays on `syncRows.ts`. Later `deleteRowsFromTargets` stays on `deleteRows.ts`. Later `formLeadToRow` / `callLeadToRow` / `bookedLeadToRow` / `cancelledLeadToRow` stay on projections. Already-recommended `syncSourceLead` / `planJobWrites` / `writeBatchedTargets` stay where they are. This file orchestrates choose tabs → project → write or take off.

## Testing

The **interface** is the test surface: the nine exports (story names, old names as aliases). Tab choice + “did we ask later write / later delete” is part of that **interface**. Inject later `getLeadTargets` / `syncRowToTargets` / `deleteRowsFromTargets` / `*ToRow` fakes, or stub those **modules**; do not boot Google Sheets.

There is no `googleSheets.service.test.ts`. Sibling `targets.test.ts` locks Duplicate Calls / Bad Leads header routing — that is later `targets.ts`, not this file. Already-recommended `jobPlanner.test.ts` locks queued Bad Leads only-when-remembered and Call stale delete — that is the other **adapter**, not this one.

**Write the Form Lead onto its current tabs**
- Non-duplicate, not bad → Forms targets only; `formLeadToRow` once; no Bad Leads delete.
- Duplicate, not bad → Duplicates targets; not Forms.
- `bad_lead` set → primary targets **plus** Master Bad Leads in the write list.
- `bad_lead` cleared → primary write, then Bad Leads delete is called even when `sheet_sync[]` is empty (legacy always-clear; do not assert the queued only-when-remembered rule here).
- Returned entries include write results plus `{ target: "master_bad_leads", status: "deleted" }` when the delete list is non-empty.

**Write the Call Lead onto its current tabs**
- Non-duplicate → Calls write, then Duplicate Calls delete (stale opposite).
- Duplicate → Duplicate Calls write, then Calls delete.
- Stale delete is called even when `sheet_sync[]` is empty.
- A document with `created_on_unmatched: true` still writes if this function is invoked (skip is not this **interface**).
- No target named `Bad Calls`.

**Write Booking / Cancellation**
- Booking → exactly `master_booked` / Booked Deals; `bookedLeadToRow` once.
- Cancellation → exactly `master_cancelled` / Cancelled Deals.
- Neither calls `getLeadTargets` (no source booked sheet).

**Take the document off**
- Form delete uses the current Forms-or-Duplicates choice and lists `master_bad_leads` in synced targets.
- Call delete uses the current Calls-or-Duplicate-Calls choice only — does not pass the stale opposite.
- Booking / Cancellation delete pass the single Master Booked target.
- All four are void.

**Provision**
- Calls later `ensureTabsAndHeaders` for Master Leads, Master Booked, and each Source Company with both a `leadSheetEnvVar` and a resolved id.
- Skips a source with no env id.
- Does not call `syncRowToTargets`.

**Not this interface**
- Persist / finalize / unmigrated schedule stay on [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md).
- Remember-or-fold / tombstone enqueue stay on [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md).
- Wake-up stays on [recommendations/sheet-sync-queue.md](sheet-sync-queue.md).
- Legacy `save()` remember stays on [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md).
- Unmatched skip / Booking Chain order stay on [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md).
- Queued tab plan / only-when-remembered Bad Leads stay on [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md).
- Batch update / append / quota defer stay on already-recommended drain writer files.
- Master-vs-source flag and header maps stay on later `targets.ts`.
- Single-tab ensure / header rewrite stay on later `tabs.ts`.
- Upsert-by-Mongo-ID stay on later `syncRows.ts` / `rowLookup.ts`.
- `deleteDimension` stay on later `deleteRows.ts`.
- Cell values stay on later `projections/*Row.ts`.

Do **not** add a test per helper (`theCurrentFormOrDuplicatesTab`, `alwaysTakeTheBadLeadsRowOffWhenTheFlagIsCleared`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file skips `created_on_unmatched` — it must not. Do not add a test that cleared Bad Leads delete is skipped when `sheet_sync[]` is empty — that is the queued **adapter**. Do not add a test that this file marks a job `synced` — it must not.

Later `getLeadTargets` / `syncRowToTargets` stay imported because they are real **adapters**, not a test leak.

## What I would not do

- A `GoogleSheetsService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `getLeadTargets` + `syncRowToTargets`.
- Moving this into a CRUD folder, or into `jobPlanner.ts` / `sheetSyncSourceLookup.ts` / `targets.ts` “for cleanliness.”
- Breaking the write-then-clear-Bad-Leads **seam**, or the Call write-then-delete-stale-opposite **seam**.
- Treating `persistSheetSyncIntent` / `syncSourceLead` / `planJobWrites` / `writeBatchedTargets` / `formLeadToRow` as this story.
- Inventing a plan **seam** that has only one **adapter** here.
- Silently teaching this file to skip unmatched Call stubs, or silently teaching Form Bad Leads clear to only-when-remembered, or silently teaching Call delete to also wipe the stale opposite, or silently teaching Booking to dual-write a source sheet.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `googleAuth` in this same pass — unchecked `googleSheets` modules remain.
- Making the Form Lead 201 wait on `provisionEveryConfiguredReportingSheet`.
