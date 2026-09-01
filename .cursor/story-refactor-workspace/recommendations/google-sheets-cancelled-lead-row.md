# Turn This Cancellation Into The Nine Reporting Cells The Owner Already Reads On Cancelled Deals — Same Cells For Live Write And Queued Plan — Print The Snapshots Cancel Already Stamped — Never Invent CPL, A Source Company Cancelled Sheet, A Live Agent Or Customer Join, Or A Booking-Source Resolve — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, visited after this pass)
- Pass: 11 of this service — `projections/cancelledLeadRow.ts`
- Remaining in this service: none — `googleSheets` is visited (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/projections/cancelledLeadRow.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (projections: do not inline live cell values elsewhere; `cancelledLeadToRow` = Agent, cancel date, job, `customer_name` snapshot, refund, source, Mongo ID, lead Mongo ID; Cancellations → Master Booked / `Cancelled Deals` only; **no CPL column**; a **Cancellation Chain** writes the booking chain first, then this row). Distinct from already-recommended Form cells: [recommendations/google-sheets-form-lead-row.md](google-sheets-form-lead-row.md) (twenty-two Forms / Duplicates / Bad Leads cells, **crm then granularity then static Forms**, `"not provided"` Tracking Reference — same folder, different document). Distinct from already-recommended Call cells: [recommendations/google-sheets-call-lead-row.md](google-sheets-call-lead-row.md) (fifteen Calls / Duplicate Calls cells, **crm then granularity then static Inbounds**, blank Job Number, `FormFill` — same folder, different document). Distinct from already-recommended Booked cells: [recommendations/google-sheets-booked-lead-row.md](google-sheets-booked-lead-row.md) (fifteen Booked Deals cells, **resolve-then-spell** `booking.source` by `lead_model`, `customer.full_name` else `customer_name`, persisted `agent_allocations[0..1]`, Split / Binder / Local / Cancelled — same folder, different document, different Source rule). Distinct from already-recommended choose-tabs-then-write-or-take-off: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (that facade **asks** this file after it already named Master Booked / `Cancelled Deals`; it does not build cells; it does **not** follow `booked_lead`). Distinct from already-recommended queued plan: [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md) (same cells, different **adapter**; `planCancellationChain` writes the booking chain first, then asks this file **once** (`cancellation as unknown as CancelledLeadSheetSource`) with **no** populate — Cancelled Deals still go out if the Booking vanished). Distinct from leftover live lookup: `sheetSync/sheetSyncSourceLookup.ts` (`syncCancellationChainById` runs the booking chain, then asks already-recommended `syncCancelledLeadToSheets` — it does **not** import this file). Distinct from already-recommended destination naming: [recommendations/google-sheets-targets.md](google-sheets-targets.md) (that file attaches `CANCELLED_SHEET_HEADERS`; this file fills those headers). Distinct from already-recommended live write loop: [recommendations/google-sheets-sync-rows.md](google-sheets-sync-rows.md) (that file **hands** already-projected cells). Distinct from already-recommended find-then-write: [recommendations/google-sheets-row-lookup.md](google-sheets-row-lookup.md) (writes the cells this file already built). Distinct from already-recommended live take-off: [recommendations/google-sheets-delete-rows.md](google-sheets-delete-rows.md) (never asks this file). Distinct from already-recommended wait-then-retry: [recommendations/google-sheets-retry.md](google-sheets-retry.md) (this file never talks to Google). Distinct from skipped `projections/cells.ts` (timestamp / Florida date / number fold this file already asks — do not pull that file in; unused `primaryBookingAgent` stays there). Distinct from leftover Cancel This Booking: [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md) (that file **stamps** Agent / `customer_name` / `source` / job / `book_date` / merchant off the Booking so reporting stays stable after the Booking is later mutated or deleted; this file **reads** three of those snapshots and never re-reads the Booking). Distinct from leftover Lead ↔ Cancellation agreement: [recommendations/cancellations-cancellation-mirror.md](cancellations-cancellation-mirror.md) (that file stamps `cancelled` on the Lead; this file does not write Booked Deals or the Lead row). Distinct from leftover `primaryAgentName`: [recommendations/agents-agent-allocation.md](agents-agent-allocation.md) (that helper stamps `CancelledLead.agent` at cancel time; this file prints the stored string). Distinct from leftover Booking-source stamp: [recommendations/bookings-booked-lead.md](bookings-booked-lead.md) / leftover `resolveBookedLeadSource` (those files write `booking.source`; cancel copies that string onto the Cancellation; this file prints it as-is). Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names the `customer_name` snapshot, Cancelled Deals only, and Cancellation Chain order; do not “fix” those in this rename.
- Callers: **two runtime import sites, one shared test file. One export.** Already-recommended facade: `googleSheets.service.ts` — `syncCancelledLeadToSheets` asks this file **once**, then hands the same array to already-recommended `syncRowToTargets` for Master Booked / `Cancelled Deals` only. Already-recommended planner: `sheetSync/drainer/jobPlanner.ts` — `planCancellationChain` asks this file **once** after `planBookingChain`, with **no** `populate`, then hands the same array to `master_cancelled`. Leftover `deleteCancelledLeadFromSheets` / leftover `syncCancellationChainById` / leftover `syncBookingAndSource` / already-recommended `deleteRowsFromTargets` / already-recommended `writeBatchedTargets` / leftover `v1.service.ts` / leftover root barrel do **not** import this file. Tests: `projections/projections.test.ts` — header-order 9-cell lock (UTC Timestamp, Agent string, Florida Cancel Date, job, `customer_name`, refund `99`, source `"mainsite"` as-is, Mongo ID, Lead Mongo ID from ObjectId); missing `cancel_date` → blank Cancel Date **and** blank Lead Mongo ID. Sibling `config/domain.test.ts` does **not** lock `CANCELLED_SHEET_HEADERS`. Not this **interface**: already-recommended Cancelled-Deals-only destination, already-recommended Cancellation Chain `booked_lead` follow, already-recommended continue-on-failure write, already-recommended hint-then-scan, already-recommended `deleteDimension`, already-recommended queued high-to-low batch, already-recommended wait-then-retry, already-recommended Form / Call / Booked cells, skipped cell format itself, leftover cancel-time snapshot **stamping**.
- Seams callers need: the same 9 cells for live write and queued plan vs already-recommended Form / Call / Booked shapes; header order vs a named object (`Lead Mongo ID` here, `Mongo Lead ID` on Booked Deals); print the stored Agent / `customer_name` / `source` snapshots vs booked’s resolve-then-spell and `full_name` join; blank Cancel Date / blank Lead Mongo ID vs inventing a Florida day or a Lead; no populate before this file vs booked’s `customer` + `agent_allocations.agent` populate
- Split later (only if the file outgrows one sitting): this ~18-line file is one sitting if you read it as turn this Cancellation into the nine reporting cells the owner already reads on Cancelled Deals, same cells for live write and queued plan, print the snapshots cancel already stamped, never invent CPL / a Source Company cancelled sheet / a live Agent or Customer join / a Booking-source resolve. If it later splits: `printTheSnapshotsCancelAlreadyStamped.ts` / `fillTheBlanksTheOwnerAlreadyExpects.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `project.ts` as a CRUD dump, and never merge already-recommended `syncCancelledLeadToSheets`, already-recommended `planJobWrites`, already-recommended `bookedLeadToRow` / `formLeadToRow` / `callLeadToRow`, skipped `cells.ts`, leftover `resolveSourceCompany`, leftover `primaryAgentName`, or leftover `createCancelledLead` into this file

`cancelledLeadToRow` is executor mechanics. The owner question is: *Mongo already has the live Cancellation. Cancel already snapshotted the closer, the customer name, the Job, and the stored Booking source so this row still works after the Booking is later mutated or deleted. The facade or the planner already chose Master Booked / Cancelled Deals. Turn that document into the nine cells the owner already reads on that tab — Timestamp, Agent, Cancel Date, Job Number, customer, refund, Source, Mongo ID, Lead Mongo ID. Agent is the stored string cancel stamped from the Booking’s first allocation name. The customer is the stored `customer_name` snapshot, not a live Customer join. Source is the stored string as-is — do not resolve it, do not spell Forms or Inbounds, do not read a CRM snapshot. A missing Cancel Date is blank, not invented. A missing Job Number is blank, not `not provided`. A missing Lead is a blank Lead Mongo ID. Refund `0` is `"0"`. Do not write CPL. Do not write `book_date`, merchant, reason, notes, or `cancelled_by` — those sit on the Cancellation and never become Cancelled Deals cells. Do not write Local, Split, Binder, Deposit, or a Cancelled flag. Do not write a Source Company cancelled sheet. Do not follow `booked_lead`. Do not write Booked Deals. Do not live-join Agent or Customer. Do not ask the Registry. Do not talk to Google. Do not choose the tab. Sheets are reporting. They are never the record. Live write and queued plan must read the same cells — do not silently grow a second Cancelled Deals row builder.*

Already-recommended facade tab choice, already-recommended destination naming, already-recommended live write / take-off, already-recommended queued plan / batch, already-recommended wait-then-retry, already-recommended Form / Call / Booked cells, skipped cell format, leftover cancel-time snapshot stamping, leftover Lead mirror, and leftover Booking-source stamp already live in other **modules**. Do not pull those in.

## What this file actually does

Three beats of one “turn this Cancellation into the nine reporting cells the owner already reads on Cancelled Deals — same cells for live write and queued plan — print the snapshots cancel already stamped — never invent CPL, a Source Company cancelled sheet, a live Agent or Customer join, or a Booking-source resolve” story, not “a projection CRUD helper,” and not the facade’s Cancelled-Deals destination:

1. **Lay out the Cancelled Deals reporting cells in today’s header order** — `cancelledLeadToRow(cancellation)`. Return `string[]` of length 9 in `CANCELLED_SHEET_HEADERS` order: Timestamp (`formatTimestamp` — UTC month/day/year plus zero-padded clock), Agent / Cancel Date / Job No / Customer Name / Refund Amount / Source / Mongo ID / Lead Mongo ID (beats 2–3). The same array is what already-recommended facade and already-recommended planner cancellation beat hand to Master Booked / `Cancelled Deals`. This beat does not choose Cancelled Deals. This beat does not follow `booked_lead`. This beat does not write Booked Deals. This beat does not talk to Google. This beat does not persist.

2. **Print the snapshots cancel already stamped** — Agent = `cancellation.agent ?? ""`. Missing agent stays blank. The cell does **not** trim — a whitespace snapshot would print as-is. This beat does not call leftover `primaryAgentName`. This beat does not read `agent_allocations`. This beat does not live-join Agent. Customer = `cancellation.customer_name ?? ""`. A leftover `customer` ObjectId on the Cancellation is not on `CancelledLeadSheetSource` and is not read. This beat does not populate Customer. This beat does not fall back to `booking.customer_name`. Source = `cancellation.source ?? ""`. Empty / missing is `""`. The folder test locks `"mainsite"` as-is — not `Main Site Forms`, not `main_site`. This beat does **not** call leftover `resolveSourceCompany` / `getFormLeadSourceCompanyLabel` / `getCallLeadSourceCompanyLabel`. This beat does not read `lead_model`. This beat does not read `crm_source_label_snapshot`. This beat does not ask the Registry. This beat does not re-stamp — leftover cancel already copied `booking.source`.

3. **Fill the blanks the owner already expects** — Cancel Date: `cancel_date` present → skipped `formatDateOnly` (Florida calendar); missing / null / undefined → `""`. The model requires `cancel_date`; the sheet type and the folder test still allow a blank. Job No: `job_no ?? ""` (never `"not provided"`). Refund: `formatNumber(refund_amount)` (`0` is `"0"`; null / undefined / NaN is `""`). Mongo ID: `_id.toString()`. Lead Mongo ID: `typeof lead_ref === "string" ? lead_ref : lead_ref?.toString() ?? ""` — missing Referral / Leadless stays `""`. This beat does not write `book_date`. This beat does not write merchant / reason / notes / `cancelled_by`. This beat does not write Local or a Cancelled flag.

There is no fourth mutate operation. Tab **choice**, destination lists, header heal, upsert-by-Mongo-ID, `deleteDimension`, queued batch, wait-then-retry, Cancellation Chain `booked_lead` follow, Form / Call / Booked cells, and leftover cancel-time snapshot stamping already live in other files. There is no second export.

## Organization

Keep one file as the screenplay for “turn this Cancellation into the nine reporting cells the owner already reads on Cancelled Deals — same cells for live write and queued plan — print the snapshots cancel already stamped — never invent CPL, a Source Company cancelled sheet, a live Agent or Customer join, or a Booking-source resolve.” Already-recommended `syncCancelledLeadToSheets` / `planJobWrites` / `getMasterBookedTabs` / `syncRowToTargets`, already-recommended `formLeadToRow` / `callLeadToRow` / `bookedLeadToRow`, skipped `cells.ts`, leftover `resolveSourceCompany` / `getFormLeadSourceCompanyLabel` / `getCallLeadSourceCompanyLabel`, leftover `primaryAgentName`, leftover `createCancelledLead` / `cancelAVerifiedBooking`, and leftover Lead mirror already live in deeper **modules**. Do not pull those in. Do not invent a `CancelledLeadRowService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and already-recommended `syncAndStore`. Do not invent a second Cancelled-Deals-row **adapter** beside this export. Do not invent a tab-choice **seam** that has only one **adapter** here. Do not invent a resolve-then-spell **seam** that has only one **adapter** here.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `project.ts`. Those are HTTP verbs, not the owner story. Do not move this into `googleSheets.service.ts` so “the facade already projects.” Do not move this into `jobPlanner.ts` so “the plan already projects.” Do not move this into `cells.ts` so “format already owns the row.” Do not move this into `bookedLeadRow.ts` so “one projector owns every deal.” Do not move this into `cancelledLead.service.ts` so “cancel already stamped the label.” Do not silently write CPL / merchant / `book_date` / reason so “the sheet is complete.” Do not silently live-join Agent or Customer so “Agent is never blank.” Do not silently resolve `source` so “we match Booked Deals.”

**External interface** stays small (this is the test surface). Header-order cells, printed snapshots, and expected blanks are one story’s Cancelled Deals row, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `cancelledLeadToRow` | `turnThisCancellationIntoTheReportingCellsTheOwnerAlreadyReads` | already-recommended live facade + already-recommended queued planner share the same cells |

Keep the old name as a one-line alias until the already-recommended facade and already-recommended planner migrate. Do not make callers learn `CANCELLED_SHEET_HEADERS` / `formatDateOnly` / `formatNumber` as the domain language.

**Principle: old exports stay as aliases.** `cancelledLeadToRow` remains the imported name until `syncCancelledLeadToSheets` and `planCancellationChain` point at the story name.

**No class for the workflow.** The type that *does* earn a name is the nine cells both writers already hand to Google:

```ts
type CancelledLeadReportingCells = string[] // length 9, CANCELLED_SHEET_HEADERS order
```

That is the handoff from “Mongo already has this Cancellation” to “write these cells onto Cancelled Deals.” Do **not** add `spreadsheetId` so “this file can write,” do **not** add `booked_lead` follow-through so “this file can run the Cancellation Chain,” do **not** add `cpl` so “the sheet can price the refund,” and do **not** add `resolveSourceCompany` so “Cancellation matches Booking.”

There is no second public export. Do not add `printTheSnapshotsCancelAlreadyStamped` as a public **seam** so “Booked can reuse Cancellation.” Do not add `formatDateOnly` as a public **seam** so “tests can skip the row.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cancelledLeadRow.ts
// Mongo already has the live Cancellation.
// Cancel already snapshotted the closer, the customer name,
// the Job, and the stored Booking source
// so this row still works after the Booking is later
// mutated or deleted.
// The facade or the planner already chose
// Master Booked / Cancelled Deals.
// Turn that document into the nine cells
// the owner already reads on that tab.
// Agent is the stored string cancel stamped
// from the Booking's first allocation name.
// The customer is the stored customer_name snapshot,
// not a live Customer join.
// Source is the stored string as-is.
// Do not resolve it.
// Do not spell Forms or Inbounds.
// Do not read a CRM snapshot.
// A missing Cancel Date is blank, not invented.
// A missing Job Number is blank, not "not provided".
// A missing Lead is a blank Lead Mongo ID.
// Refund 0 is "0".
// Do not write CPL, book_date, merchant, reason,
// notes, cancelled_by, Local, Split, Binder,
// Deposit, or a Cancelled flag.
// Do not write a Source Company cancelled sheet.
// Do not follow booked_lead.
// Do not write Booked Deals.
// Do not live-join Agent or Customer.
// Do not ask the Registry.
// Do not talk to Google.
// Do not choose the tab.
// Sheets are reporting. They are never the record.
// Live write and queued plan must read the same cells.
// Do not silently grow a second Cancelled Deals row builder.

// ── 1. Lay out the Cancelled Deals cells in today's header order

export function turnThisCancellationIntoTheReportingCellsTheOwnerAlreadyReads(
  cancellation: CancelledLeadSheetSource,
): CancelledLeadReportingCells
export const cancelledLeadToRow =
  turnThisCancellationIntoTheReportingCellsTheOwnerAlreadyReads

// ── 2. Print the snapshots cancel already stamped ─────────

function printTheSnapshottedCloser(agent)
  // agent ?? ""
  // do not trim the printed cell
  // never live-join Agent
  // never call leftover primaryAgentName
  // never read agent_allocations

function printTheSnapshottedCustomer(customerName)
  // customer_name ?? ""
  // never populate Customer
  // never read customer.full_name

function printTheSnapshottedSource(source)
  // source ?? ""
  // as-is  ("mainsite" stays "mainsite")
  // do not leftover resolveSourceCompany
  // do not leftover getFormLeadSourceCompanyLabel
  // do not leftover getCallLeadSourceCompanyLabel
  // lead_model / crm snapshots are not in this file

// ── 3. Fill the blanks the owner already expects ───────────

function cancelDateOrBlank(cancelDate)
  // present → skipped formatDateOnly (Florida)
  // missing → ""

function jobNumberOrBlank(jobNo)
  // ?? ""  — never "not provided"

function refundOrBlank(refund)
  // skipped formatNumber
  // 0 → "0"
  // null / undefined / NaN → ""

function mongoLeadIdOrBlank(leadRef)
  // string as-is; else toString(); missing → ""
```

Read the ordinary cancel path out loud: *The facade already chose Cancelled Deals. We stamp Timestamp in UTC, Agent A, the Florida cancel date, `JOB-2`, Jane from the stored `customer_name`, refund `99`, `mainsite` as it sits on the Cancellation, this Cancellation Mongo ID, and the Lead Mongo ID. We return 9 strings. We do not write `Main Site Forms`. We do not write CPL. We do not write merchant. We do not write Booked Deals. The facade hands the same array to Master Booked. The planner’s Cancellation Chain asks this file after it already planned the booking chain, and hands the same array.*

Read the missing-date path out loud: *`cancel_date` is missing. Cancel Date is blank. Lead Mongo ID is blank. We still write the Cancellation Mongo ID. We do not invent a Florida day. We do not invent a Lead.*

Read the Referral / Leadless path out loud: *There is no Lead. `lead_ref` is missing. Lead Mongo ID is blank. Source is whatever cancel copied from `booking.source` (`referral`, or `Best Relocation Inbounds`). We print that string as-is. We do not invent Main Site Forms. We do not follow `booked_lead`.*

Read the correction path out loud: *The owner patched refund and cancel date. Those two cells change. Reason, notes, and who cancelled never appear on Cancelled Deals. Agent, customer, and source stay the snapshots cancel stamped — public correction cannot send those fields.*

That is the operation. `cancelledLeadToRow` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`cancelledLeadToRow` is executor mechanics.** The owner story is “turn this Cancellation into the nine reporting cells the owner already reads on Cancelled Deals, same cells for live write and queued plan, print the snapshots cancel already stamped.” Keep the old name as an alias. Do not grow a `CancelledLeadRowService` with `create` / `update` / `delete`.

2. **Two writers, one row.** Already-recommended `syncCancelledLeadToSheets` and already-recommended `planCancellationChain` both ask this file. Knowledge: do not inline live cell values elsewhere. Keep one **adapter**. Do not silently build a second Cancelled Deals array inside the planner so “queued can diverge.” Do not silently build cells inside the facade so “live can add merchant.” Do not extract a third projector file in this rename.

3. **This is not the Booked resolve-then-spell.** Already-recommended Booked resolves `booking.source` and re-spells it by `lead_model`. This file prints `cancellation.source` as-is. The folder test locks `"mainsite"` — not `Main Site Forms`, not `main_site`. Knowledge’s cancel write already copied `booking.source` at cancel time so reporting stays stable after the Booking is later mutated. Do not call leftover `resolveSourceCompany` so “Cancellation matches Booked Deals.” Do not call leftover `getFormLeadSourceCompanyLabel` / `getCallLeadSourceCompanyLabel` so “we match Form/Call.” Do not read `lead_model` so “the sheet can finish the label.”

4. **This is not the Form/Call snapshot cascade.** Form / Call read `crm_source_label_snapshot` then `source_granularity_label_snapshot` then a static label. `CancelledLeadSheetSource` has none of those fields. Do not start reading them off a populated Booking so “Cancellation matches Form.” Do not ask leftover Source Assignment here so “the sheet stays current.”

5. **Agent is a stored string, not allocations.** Leftover cancel stamps `CancelledLead.agent` with leftover `primaryAgentName` (first `agent_name_snapshot`). This file prints that string. Already-recommended Booked reads `agent_allocations[0..1]` and skipped `splitCell`. This file has one Agent column and no Split. Do not import leftover `primaryAgentName` so “the projector can restamp.” Do not import leftover `primaryBookingAgent` so “cells already owns the closer.” Do not invent SplitAgent so “we match Booked Deals.”

6. **Customer is the stored `customer_name` snapshot.** Already-recommended Booked prefers populated `customer.full_name`. This file never sees `customer`. Public cancel stamps populated `customer.full_name`; the verified write may fall back to `booking.customer_name`. Knowledge already records that pair. This file reprints whatever cancel stored. Do not populate Customer so “the projection is self-healing.” Do not prefer a live `full_name` so “we match Booked Deals” — cancel’s point is that the snapshot survives after the Booking is mutated or deleted.

7. **The planner does not populate this document.** Already-recommended Booked plan populates `customer` + `agent_allocations.agent` before it asks that file. `planCancellationChain` only `CancelledLead.findById`. Leftover `syncCancellationChainById` is the same find. Do not add populate here so “we can join Customer.” Do not add populate on the planner in this rename so “Cancellation matches Booking.”

8. **`book_date` and merchant sit on the Cancellation and stay off the row.** Leftover cancel stamps both. `CancelledLeadSheetSource` omits them. `CANCELLED_SHEET_HEADERS` omits them. Do not append Book Date / Merchant so “the projection is complete.” Do not reuse already-recommended Booked’s Book Date column so “one date owns every deal tab.”

9. **Reason, notes, and `cancelled_by` are correctable and still stay off the row.** Public `updateCancelledLeadSchema` allows `timestamp`, `cancel_date`, `refund_amount`, `reason`, `notes`, `cancelled_by`. This file reprints cancel date and refund. The other three never become cells. Leftover `CANCELLED_LEAD_CHANGE_PATHS` also names `agent` / `job_no` / `customer_name` / `merchant` / `booked_lead` — public correction cannot send those. Do not append reason so “the owner can see why.” Do not start reading `cancelled_by` so “the sheet shows who cancelled.”

10. **Missing Job Number is blank, not `not provided`.** Already-recommended Form writes `"not provided"` for a missing Tracking Reference. Already-recommended Call / Booked leave Job Number blank. This file matches Call / Booked. Do not copy the Form blank so “every identity cell has a token.” Do not invent a Job Number from Mongo ID so “the sheet always has a job.”

11. **Lead Mongo ID is the Lead’s id, or blank.** String `lead_ref` prints as-is. ObjectId uses `toString()`. Missing Referral / Leadless stay `""`. Header text is `Lead Mongo ID` — already-recommended Booked uses `Mongo Lead ID`. Do not rename the header so “the two deal tabs agree” without a paired header/test change. Do not follow `lead_ref`. Do not follow `booked_lead`. Do not return `{ row, alsoWriteTheBooking }` so “the projector can run the chain.”

12. **Missing Cancel Date is blank.** Skipped `formatDateOnly` only runs when `cancel_date` is truthy. The model requires the date. The type and the folder test allow a blank. Do not invent `timestamp` as the cancel day so “the sheet always has a date.” Do not switch Cancel Date to UTC clock so “it matches Timestamp” without a paired header/test change.

13. **Refund `0` is `"0"`, not blank.** Skipped `formatNumber` stringifies `0`. A zero-refund cancel is a real owner number. Do not elide zero so “empty means unknown money” without an owner decision that a zero-refund Cancellation should look unpriced.

14. **Printed Agent / customer / source cells do not trim.** The model trims on save. This file does not trim again. Already-recommended Form / Call Sales Rep trims. Do not add trim so “we match Sales Rep” without a test that a whitespace snapshot stays visible or is blank on purpose.

15. **Empty source is blank, not `not_provided`, not Main Site.** Already-recommended Booked’s leftover `resolveSourceCompany("")` returns `not_provided`, and a FormLead would print `Main Site Forms`. This file’s `?? ""` leaves empty source empty. Do not “fix” that to match Booked. Lock it if you touch the cell.

16. **CPL, Local, Split, Binder, Deposit, OVER 2000, and a Cancelled flag stay off the row.** `CANCELLED_SHEET_HEADERS` already omits them. The Cancellation sitting on Booked Deals is already-recommended Booked’s last cell. This file does not write that tab. Do not append `cancelled` so “the projection is complete.” Do not write Booked Deals from this file.

17. **Cancelled Deals is Master Booked only.** Knowledge: no source cancelled sheet. Already-recommended facade / planner already named `master_cancelled`. Do not return `{ row, alsoWriteSourceCancelled }` so “the projector can route.”

18. **This file does not run the Cancellation Chain.** Already-recommended planner writes the booking chain first, then this row. Leftover lookup does the same via `syncCancellationChainById`. A vanished Booking empties the booked/source plan; Cancelled Deals still go out. Do not follow `booked_lead` here so “the projector can keep the chain together.” Do not drop this row when `booked_lead` is missing so “the sentence becomes true.”

19. **Timestamp is UTC clock. Cancel Date is Florida calendar.** Skipped `formatTimestamp` / `formatDateOnly`. The header-order test names Timestamp `5/27/2026 09:04:05` and Cancel Date `2026-05-25`. Do not switch Timestamp to Eastern so “the owner’s clock matches Cancel Date” without a paired header/test change.

20. **This file does not talk to Google and does not persist.** Already-recommended write / take-off / retry wrap Google. Already-recommended `syncAndStore` / drain `updateOne` remember. Do not call `withSheetsRetry` here so “the projector can heal a header.” Do not `document.save()` here so “the row owns the hint.”

21. **Leave sibling modules alone.** Already-recommended `syncCancelledLeadToSheets` / `planJobWrites` / `getMasterBookedTabs` / `syncRowToTargets` / `formLeadToRow` / `callLeadToRow` / `bookedLeadToRow` stay where they are. Skipped `cells.ts` / leftover `resolveSourceCompany` / leftover `primaryAgentName` stay where they are. Leftover cancel-time snapshot stamping stays on `cancelledLead.service.ts`. Leftover Lead mirror stays on `cancellationMirror.service.ts`. This file orchestrates header-order cells → printed snapshots → expected blanks.

## Testing

The **interface** is the test surface: the one export (story name, old name as alias). Header order, printed snapshots, expected blanks, and the forbidden columns are part of that **interface**. Do not boot Google Sheets. Do not boot Mongo. Pass a `CancelledLeadSheetSource`.

`projections/projections.test.ts` already names most of the operation (9 cells, UTC Timestamp, Agent string, Florida Cancel Date, job, `customer_name`, refund, source `"mainsite"` as-is, Mongo ID, Lead Mongo ID; missing cancel date + missing lead). Keep those. Add the snapshot-as-is, blank, and forbidden columns the current file does not lock:

**Lay out the Cancelled Deals reporting cells in today’s header order**
- Length is `CANCELLED_SHEET_HEADERS.length` (9) and index `i` is the cell for `CANCELLED_SHEET_HEADERS[i]`.
- Header 8 is `Lead Mongo ID` (not Booked Deals’ `Mongo Lead ID`).
- `cpl` / `book_date` / `merchant` / `reason` / `notes` / `cancelled_by` / `local` / `over_2000` / `over_4000` / `agent_allocations` / `customer` / `booked_lead` / `lead_model` never appear as cells.

**Print the snapshots cancel already stamped**
- Agent string prints as stored; missing → `""`.
- A fixture that could imagine `agent_allocations[0].agent_name_snapshot` or leftover `primaryAgentName` still prints `cancellation.agent` (do not treat a live Booking as the cell).
- `customer_name` prints as stored; missing → `""`.
- A fixture that could imagine populated `customer.full_name` still prints `customer_name` (do not treat populate as the cell).
- Source `"mainsite"` stays `"mainsite"` (already locked). Do not “fix” that to `Main Site Forms` in this rename.
- Source `"referral"` stays `"referral"`.
- Source `"Best Relocation Inbounds"` stays that string even when a leftover resolve would map it to `best_relocation_leads`.
- Empty / missing source → `""` (not `not_provided`, not `Main Site Forms`).
- A fixture that could imagine `crm_source_label_snapshot` / `lead_model` still prints `cancellation.source` (do not treat those as the cascade).

**Fill the blanks the owner already expects**
- Missing `cancel_date` → `""` (already locked).
- Missing / `""` `job_no` → `""` (never `"not provided"`).
- Missing `lead_ref` → `""` (already locked).
- `lead_ref` as a string id → that string.
- `refund_amount: 0` → `"0"`; missing refund → `""`.
- Present `cancel_date` → Florida calendar (already locked).

**Not this interface**
- Cancelled-Deals-only destination / no source cancelled sheet stays on [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) / [recommendations/google-sheets-targets.md](google-sheets-targets.md).
- Cancellation Chain `booked_lead` follow / vanished-Booking-still-writes-Cancelled-Deals stays on [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md).
- Continue-on-failure write / upsert / `deleteDimension` / wait-then-retry stay on the already-recommended write / find / take-off / retry files.
- Cell format helpers stay on skipped `projections/cells.ts` (existing tests in this file may keep covering them; do not move those assertions onto this export).
- Form cells stay on [recommendations/google-sheets-form-lead-row.md](google-sheets-form-lead-row.md).
- Call cells stay on [recommendations/google-sheets-call-lead-row.md](google-sheets-call-lead-row.md).
- Booked cells stay on [recommendations/google-sheets-booked-lead-row.md](google-sheets-booked-lead-row.md).
- Snapshot **stamping** stays on leftover `createCancelledLead` / [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md).
- Lead ↔ Cancellation agreement stays on [recommendations/cancellations-cancellation-mirror.md](cancellations-cancellation-mirror.md).

Do **not** add a test per helper (`printTheSnapshottedCloser`, `printTheSnapshottedSource`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file writes a Source Company cancelled sheet — it must not. Do not add a test that this file follows `booked_lead` into `planBookingChain` — it must not. Do not add a test that this file calls `getLeadTargets` / `syncRowToTargets` / `withSheetsRetry` — it must not. Do not add a test that this file live-joins Agent or Customer — it must not. Do not add a test that this file writes CPL, merchant, `book_date`, reason, Local, or Booked Deals — it must not. Do not add a test that queued mode builds a different Cancelled Deals array — it must not. Do not add a test that this file asks the Registry — it must not. Do not add a test that this file resolves `"mainsite"` to `Main Site Forms` — it must not. Do not add a test that this file writes `"not provided"` for a missing Job Number — it must not.

## What I would not do

- A `CancelledLeadRowService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `formatTimestamp`.
- Moving this into a CRUD folder, or into `googleSheets.service.ts` / `jobPlanner.ts` / `cells.ts` / `bookedLeadRow.ts` / `cancelledLead.service.ts` “for cleanliness.”
- Breaking the same-cells-for-live-and-queued **seam**, the print-the-stored-snapshots **seam**, the `customer_name`-not-`full_name` **seam**, or the source-as-is **seam**.
- Treating `syncCancelledLeadToSheets` / `planJobWrites` / `createCancelledLead` / `bookedLeadToRow` as this story.
- Inventing a tab-choice **seam** that has only one **adapter** here, or a Registry-join **seam** that has only one **adapter** here, or a resolve-then-spell **seam** that has only one **adapter** here.
- Silently writing CPL / merchant / `book_date` / reason / notes / Local / Split / Binder / Deposit / OVER 2000 / a Source Company cancelled sheet, or silently resolving `"mainsite"` to `Main Site Forms` so “Cancellation matches Booking,” or silently live-joining Agent or Customer, or silently building a second Cancelled Deals array in the planner, or silently writing `"not provided"` for a missing Job Number, or silently writing `Main Site Forms` for `referral`.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `googleAuth` in this same pass — this file is the last unchecked `googleSheets` module; the next run enumerates `googleAuth`.
- Making the Cancellation 201 wait on `turnThisCancellationIntoTheReportingCellsTheOwnerAlreadyReads`.
