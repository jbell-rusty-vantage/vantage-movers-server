# Turn This Booking Into The Fifteen Reporting Cells The Owner Already Reads On Booked Deals — Same Cells For Live Write And Queued Plan — Never Invent CPL, A Source Company Booked Sheet, A Live Agent Join, Or A Form/Call Snapshot Cascade — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, in-progress)
- Pass: 10 of this service — `projections/bookedLeadRow.ts`
- Remaining in this service: `projections/cancelledLeadRow.ts` (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/projections/bookedLeadRow.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (projections: do not inline live cell values elsewhere; `bookedLeadToRow` = Agent / SplitAgent from `agent_allocations[0..1].agent_name_snapshot`, binder/deposit, book date, job, customer `full_name` else `customer_name`, merchant, **resolved source**, Mongo ID, lead Mongo ID, local, cancelled; Bookings → Master Booked / `Booked Deals` only — **no source booked sheet**; **no CPL column**; `Sales Rep` / live Agent join is a Form/Call invariant — this file’s closers are the same persisted-snapshot rule). Distinct from already-recommended Form cells: [recommendations/google-sheets-form-lead-row.md](google-sheets-form-lead-row.md) (twenty-two Forms / Duplicates / Bad Leads cells, **crm then granularity then static Forms**, `"not provided"` Tracking Reference — same folder, different document). Distinct from already-recommended Call cells: [recommendations/google-sheets-call-lead-row.md](google-sheets-call-lead-row.md) (fifteen Calls / Duplicate Calls cells, **crm then granularity then static Inbounds**, blank Job Number, `FormFill` — same folder, different document). Distinct from already-recommended choose-tabs-then-write-or-take-off: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (that facade **asks** this file after it already named Master Booked / `Booked Deals`; it does not build cells; it does **not** follow `lead_ref`). Distinct from already-recommended queued plan: [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md) (same cells, different **adapter**; `planBookedLead` and the first beat of `planBookingChain` both ask this file after `populate("customer")` + `populate("agent_allocations.agent")`; the chain then follows `lead_ref` — this file does not). Distinct from leftover live lookup: `sheetSync/sheetSyncSourceLookup.ts` (`syncBookedLeadById` / `syncBookingAndSource` populate the same paths, then ask already-recommended `syncBookedLeadToSheets` — they do **not** import this file). Distinct from already-recommended destination naming: [recommendations/google-sheets-targets.md](google-sheets-targets.md) (that file attaches `BOOKED_SHEET_HEADERS`; this file fills those headers). Distinct from already-recommended live write loop: [recommendations/google-sheets-sync-rows.md](google-sheets-sync-rows.md) (that file **hands** already-projected cells). Distinct from already-recommended find-then-write: [recommendations/google-sheets-row-lookup.md](google-sheets-row-lookup.md) (writes the cells this file already built). Distinct from already-recommended live take-off: [recommendations/google-sheets-delete-rows.md](google-sheets-delete-rows.md) (never asks this file). Distinct from already-recommended wait-then-retry: [recommendations/google-sheets-retry.md](google-sheets-retry.md) (this file never talks to Google). Distinct from skipped `projections/cells.ts` (timestamp / Florida date / number / `optionalLocalCell` / `cancelledCell` / `splitCell` fold this file already asks — do not pull that file in; unused `primaryBookingAgent` stays there). Distinct from later `cancelledLeadToRow` (same folder, Cancelled Deals, different document). Distinct from leftover Book this Lead: [recommendations/bookings-booked-lead.md](bookings-booked-lead.md) (that file remembers Sheet Sync and **stamps** `booking.source` via leftover `resolveBookedLeadSource`; this file **reads** the stored source). Distinct from leftover Referral / Leadless: [recommendations/bookings-referral-booking.md](bookings-referral-booking.md) / [recommendations/bookings-leadless-booking.md](bookings-leadless-booking.md) (those files write a Booking with no Lead; this file prints their stored source and a blank Mongo Lead ID). Distinct from leftover Source Assignment: [recommendations/leads-source-company.md](leads-source-company.md) (that file stamps Form/Call snapshots at ingest; this file never reads those snapshots). Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names resolved source, Agent / SplitAgent snapshots, `full_name` else `customer_name`, Master Booked only, and no CPL; do not “fix” those in this rename.
- Callers: **two runtime import sites, one shared test file. One export.** Already-recommended facade: `googleSheets.service.ts` — `syncBookedLeadToSheets` asks this file **once**, then hands the same array to already-recommended `syncRowToTargets` for Master Booked / `Booked Deals` only. Already-recommended planner: `sheetSync/drainer/jobPlanner.ts` — `planBookedLead` and the first beat of `planBookingChain` each ask this file **once** (`booking as unknown as BookedLeadSheetSource`) after `populate("customer")` + `populate("agent_allocations.agent")`, then hand the same array to `master_booked`. Leftover `deleteBookedLeadFromSheets` / leftover `syncBookedLeadById` / leftover `syncBookingAndSource` / already-recommended `deleteRowsFromTargets` / already-recommended `writeBatchedTargets` / leftover `v1.service.ts` / leftover root barrel do **not** import this file. Tests: `projections/projections.test.ts` — header-order 15-cell lock (two named closers + split `TRUE`; `full_name` customer; Form `main_site` → `Main Site Forms`; Mongo Lead ID; `local` + `cancelled`); Form `top10_leads` → `Top10 Forms`; Call `tbm_leads` → `10best Inbounds`; legacy `"TBM Forms"` + FormLead → `TBM Forms`; Referral `source: "referral"` + `customer_name` + blank lead ref + blank Local; Leadless `"Best Relocation Inbounds"` + blank lead ref. Sibling `config/domain.test.ts` locks leftover `getFormLeadSourceCompanyLabel` / `getCallLeadSourceCompanyLabel` / `resolveSourceCompany` spellings — not this file. It does **not** lock `BOOKED_SHEET_HEADERS`. Not this **interface**: already-recommended Booked-Deals-only destination, already-recommended Booking Chain `lead_ref` follow, already-recommended continue-on-failure write, already-recommended hint-then-scan, already-recommended `deleteDimension`, already-recommended queued high-to-low batch, already-recommended wait-then-retry, already-recommended Form / Call cells, later Cancellation cells, skipped cell format itself, leftover `resolveBookedLeadSource` stamping.
- Seams callers need: the same 15 cells for live write and queued plan vs already-recommended Form / Call / later Cancellation shapes; header order vs a named object; persisted `agent_name_snapshot` vs a live Agent join (planner already populated `agent_allocations.agent`); populated `customer.full_name` else `customer_name`; resolve-the-stored-source then Form-or-Call spelling vs the Form/Call crm-then-granularity snapshot cascade; unresolved or no-`lead_model` source prints the stored string as-is vs inventing Main Site; blank Mongo Lead ID on Referral / Leadless vs inventing a Lead
- Split later (only if the file outgrows one sitting): this ~40-line file is one sitting if you read it as turn this Booking into the fifteen reporting cells the owner already reads on Booked Deals, same cells for live write and queued plan, never invent CPL / a Source Company booked sheet / a live Agent join / a Form/Call snapshot cascade. If it later splits: `nameTheClosersTheOwnerAlreadyReads.ts` / `nameTheSourceTheOwnerAlreadyReads.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `project.ts` as a CRUD dump, and never merge already-recommended `syncBookedLeadToSheets`, already-recommended `planJobWrites`, already-recommended `formLeadToRow` / `callLeadToRow`, later `cancelledLeadToRow`, skipped `cells.ts`, leftover `resolveSourceCompany`, or leftover `resolveBookedLeadSource` into this file

`bookedLeadToRow` is executor mechanics. The owner question is: *Mongo already has the live Booking. The facade or the planner already chose Master Booked / Booked Deals. Turn that document into the fifteen cells the owner already reads on that tab — Timestamp, Agent, SplitAgent, Binder, Split, Book Date, Job Number, customer, deposit, merchant, Source, Mongo ID, Mongo Lead ID, local, cancelled. Agent and SplitAgent are the first two persisted allocation names, even though the planner already populated the live Agent. Split is TRUE only when two named allocations sit on the document and some binder is not zero. The customer is the populated Customer’s full name; if that is empty, the Booking’s own customer_name (Referral and Leadless usually only have that). Source is not the Form/Call snapshot cascade. Resolve the stored `booking.source` to a Source Company; if that fails, print the stored string (Referral prints `referral`). If it resolves and `lead_model` is FormLead, spell the Forms label (Best Relocation still splits Locals vs Forms from this Booking’s Move Type). If it resolves and `lead_model` is CallLead, spell the Inbounds label (Best Relocation is always Inbounds). If it resolves and there is no Form/Call model, print the stored string anyway (Leadless `Best Relocation Inbounds` stays that label). A missing Job Number is blank, not `not provided`. A missing Lead is a blank Mongo Lead ID. A missing Local stays blank. After cancel, Cancelled prints `cancelled`. Do not write CPL. Do not write city, phone, or email. Do not write OVER 2000 / OVER 4000 — those flags live on the Booking and on Form/Call rows, not on Booked Deals. Do not write a Source Company booked sheet. Do not follow `lead_ref`. Do not write Cancelled Deals. Do not live-join Agent. Do not read `employee_source_snapshot.crm_source_label_snapshot`. Do not ask the Registry. Do not talk to Google. Do not choose the tab. Sheets are reporting. They are never the record. Live write and queued plan must read the same cells — do not silently grow a second Booked Deals row builder.*

Already-recommended facade tab choice, already-recommended destination naming, already-recommended live write / take-off, already-recommended queued plan / batch, already-recommended wait-then-retry, already-recommended Form / Call cells, later Cancellation projections, skipped cell format, leftover source stamping, leftover Referral / Leadless, and leftover Source Assignment already live in other **modules**. Do not pull those in.

## What this file actually does

Four beats of one “turn this Booking into the fifteen reporting cells the owner already reads on Booked Deals — same cells for live write and queued plan — never invent CPL, a Source Company booked sheet, a live Agent join, or a Form/Call snapshot cascade” story, not “a projection CRUD helper,” and not the facade’s Booked-Deals destination:

1. **Lay out the Booked Deals reporting cells in today’s header order** — `bookedLeadToRow(booking)`. Return `string[]` of length 15 in `BOOKED_SHEET_HEADERS` order: Timestamp (`formatTimestamp` — UTC month/day/year plus zero-padded clock), Agent / SplitAgent / Split (beat 2), Binder Amount (`formatNumber(total_binder_amount)` — `0` is `"0"`; null / undefined / NaN is `""`), Book Date (`formatDateOnly(book_date)` — Florida calendar date from skipped `cells.ts`; the type requires a `Date`, so this is never `bookedDateCell`), Job No / Customer Name / Deposit / Merchant / Source / Mongo ID / Mongo Lead ID / Local / Cancelled (beats 3–4). The same array is what already-recommended facade and both already-recommended planner booked beats hand to Master Booked. This beat does not choose Booked Deals. This beat does not follow `lead_ref`. This beat does not talk to Google. This beat does not persist.

2. **Name the closers the owner already reads, and whether they split** — Agent = `agent_allocations[0]?.agent_name_snapshot ?? ""`. SplitAgent = `agent_allocations[1]?.agent_name_snapshot ?? ""`. Missing allocations or a missing slot stay blank. The cells do **not** trim — a whitespace snapshot would print as-is. Split = skipped `splitCell(allocations)`: filter names whose `trim()` is non-empty; TRUE only when those named allocations are `>= 2` **and** the raw array length is `>= 2` **and** some `binder_amount !== 0`. One closer → `FALSE`. Two closers with both binders `0` → `FALSE`. A second allocation whose name is whitespace counts toward array length but not toward named count → `FALSE`. This beat does not live-join `agent_allocations.agent` even when leftover lookup / already-recommended planner already populated it. This beat does not read leftover `primaryBookingAgent`.

3. **Name the customer and the Source the owner already reads** — Customer: `customer?.full_name ?? customer_name ?? ""`. A populated Customer wins. Referral / Leadless usually only have `customer_name`. Source: leftover `resolveSourceCompany(booking.source)`. Empty / whitespace source resolves to `not_provided` (that helper’s empty-string rule). If resolve returns nothing, print `booking.source` as-is (`referral` stays `referral`). If resolve returns a Source Company and `lead_model === "FormLead"`, leftover `getFormLeadSourceCompanyLabel(sourceCompany, booking.local as LocalType | undefined)` — `tbm_leads` → `TBM Forms`, `top10_leads` → `Top10 Forms`, `main_site` / `not_provided` → `Main Site Forms`, `best_relocation_leads` + `local` → `Best Relocation Locals`, else `Best Relocation Forms`. If resolve returns a Source Company and `lead_model === "CallLead"`, leftover `getCallLeadSourceCompanyLabel(sourceCompany)` — `tbm_leads` → `10best Inbounds`; Best Relocation is always `Best Relocation Inbounds`. If resolve returns a Source Company and there is no Form/Call model, print `booking.source` anyway (Leadless `"Best Relocation Inbounds"` stays that label even though resolve already mapped it to `best_relocation_leads`). This beat does **not** read `crm_source_label_snapshot` / `source_granularity_label_snapshot` / `source_company_label_snapshot` / `employee_source_snapshot.*`. This beat does not ask the Registry. This beat does not stamp a new source — leftover `resolveBookedLeadSource` already did that at book time.

4. **Fill the blanks the owner already expects** — Job No: `job_no ?? ""` (never `"not provided"`). Deposit: `formatNumber(deposit_amount)` (`0` is `"0"`). Merchant: `booking.merchant` as stored (required string; this file does not trim). Mongo ID: `_id.toString()`. Mongo Lead ID: `typeof lead_ref === "string" ? lead_ref : lead_ref?.toString() ?? ""` — missing Referral / Leadless stays `""`. Local: skipped `optionalLocalCell` — `null` / `undefined` / `""` is `""`; only `"local"` stays local; any other non-empty value is `long_distance`. Cancelled: skipped `cancelledCell(Boolean(cancelled))` — a leftover Cancellation ObjectId is truthy and prints `cancelled`; missing / null / false is `""`. This beat does not write OVER 2000 / OVER 4000. This beat does not write Cancelled Deals.

There is no fifth mutate operation. Tab **choice**, destination lists, header heal, upsert-by-Mongo-ID, `deleteDimension`, queued batch, wait-then-retry, Booking Chain `lead_ref` follow, Form / Call / Cancellation cells, and leftover source stamping already live in other files. There is no second export.

## Organization

Keep one file as the screenplay for “turn this Booking into the fifteen reporting cells the owner already reads on Booked Deals — same cells for live write and queued plan — never invent CPL, a Source Company booked sheet, a live Agent join, or a Form/Call snapshot cascade.” Already-recommended `syncBookedLeadToSheets` / `planJobWrites` / `getMasterBookedTabs` / `syncRowToTargets`, already-recommended `formLeadToRow` / `callLeadToRow`, later `cancelledLeadToRow`, skipped `cells.ts`, leftover `resolveSourceCompany` / `getFormLeadSourceCompanyLabel` / `getCallLeadSourceCompanyLabel`, leftover `resolveBookedLeadSource`, and leftover Referral / Leadless already live in deeper **modules**. Do not pull those in. Do not invent a `BookedLeadRowService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and already-recommended `syncAndStore`. Do not invent a second Booked-Deals-row **adapter** beside this export. Do not invent a tab-choice **seam** that has only one **adapter** here. Do not invent a snapshot-cascade **seam** that has only one **adapter** here.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `project.ts`. Those are HTTP verbs, not the owner story. Do not move this into `googleSheets.service.ts` so “the facade already projects.” Do not move this into `jobPlanner.ts` so “the plan already projects.” Do not move this into `cells.ts` so “format already owns the row.” Do not move this into `formLeadRow.ts` / `callLeadRow.ts` so “one projector owns every document.” Do not move this into `bookedLead.service.ts` so “booking already stamped the label.” Do not silently write CPL / city / phone / email / OVER 2000 so “the sheet is complete.” Do not silently live-join Agent so “Agent is never blank.” Do not silently read `employee_source_snapshot.crm_source_label_snapshot` so “we match Form/Call.”

**External interface** stays small (this is the test surface). Header-order cells, persisted closers, customer name, resolve-then-spell Source, and expected blanks are one story’s Booked Deals row, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `bookedLeadToRow` | `turnThisBookingIntoTheReportingCellsTheOwnerAlreadyReads` | already-recommended live facade + already-recommended queued planner share the same cells |

Keep the old name as a one-line alias until the already-recommended facade and already-recommended planner migrate. Do not make callers learn `BOOKED_SHEET_HEADERS` / `resolveSourceCompany` / `splitCell` as the domain language.

**Principle: old exports stay as aliases.** `bookedLeadToRow` remains the imported name until `syncBookedLeadToSheets`, `planBookedLead`, and `planBookingChain` point at the story name.

**No class for the workflow.** The type that *does* earn a name is the fifteen cells both writers already hand to Google:

```ts
type BookedLeadReportingCells = string[] // length 15, BOOKED_SHEET_HEADERS order
```

That is the handoff from “Mongo already has this Booking” to “write these cells onto Booked Deals.” Do **not** add `spreadsheetId` so “this file can write,” do **not** add `lead_ref` follow-through so “this file can run the Booking Chain,” do **not** add `cpl` so “the sheet can price the deal,” and do **not** add `crm_source_label_snapshot` so “Booking matches Form.”

There is no second public export. Do not add `nameTheSourceTheOwnerAlreadyReads` as a public **seam** so “Cancellation can reuse Booking.” Do not add `splitCell` as a public **seam** so “tests can skip the row.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookedLeadRow.ts
// Mongo already has the live Booking.
// The facade or the planner already chose Master Booked / Booked Deals.
// Turn that document into the fifteen cells
// the owner already reads on that tab.
// Agent and SplitAgent are the first two persisted allocation names.
// Split is TRUE only when two named closers sit on the document
// and some binder is not zero.
// The customer is the populated Customer's full name;
// if that is empty, the Booking's own customer_name.
// Source is not the Form/Call snapshot cascade.
// Resolve the stored booking.source.
// If that fails, print the stored string.
// If it resolves and lead_model is FormLead, spell the Forms label.
// If it resolves and lead_model is CallLead, spell the Inbounds label.
// If it resolves and there is no Form/Call model, print the stored string anyway.
// A missing Job Number is blank, not "not provided".
// A missing Lead is a blank Mongo Lead ID.
// A missing Local stays blank.
// After cancel, Cancelled prints cancelled.
// Do not write CPL, city, phone, email, or OVER 2000 / OVER 4000.
// Do not write a Source Company booked sheet.
// Do not follow lead_ref.
// Do not write Cancelled Deals.
// Do not live-join Agent.
// Do not read employee_source_snapshot.
// Do not ask the Registry.
// Do not talk to Google.
// Do not choose the tab.
// Sheets are reporting. They are never the record.
// Live write and queued plan must read the same cells.
// Do not silently grow a second Booked Deals row builder.

// ── 1. Lay out the Booked Deals cells in today's header order ─

export function turnThisBookingIntoTheReportingCellsTheOwnerAlreadyReads(
  booking: BookedLeadSheetSource,
): BookedLeadReportingCells
export const bookedLeadToRow =
  turnThisBookingIntoTheReportingCellsTheOwnerAlreadyReads

// ── 2. Name the closers and whether they split ─────────────

function nameTheClosersTheOwnerAlreadyReads(allocations)
  // [0] / [1] agent_name_snapshot ?? ""
  // do not trim the printed cell
  // never live-join Agent

function sayWhetherThoseClosersSplit(allocations)
  // skipped splitCell
  // two trimmed names + raw length >= 2 + some binder !== 0 → "TRUE"
  // else "FALSE"

// ── 3. Name the customer and the Source ───────────────────

function nameTheCustomerTheOwnerAlreadyReads(booking)
  // customer.full_name ?? customer_name ?? ""

function nameTheSourceTheOwnerAlreadyReads(booking)
  // leftover resolveSourceCompany(booking.source)
  // empty source → not_provided (that helper)
  // unresolved → booking.source as-is  ("referral")
  // FormLead → leftover getFormLeadSourceCompanyLabel(slug, local)
  // CallLead → leftover getCallLeadSourceCompanyLabel(slug)
  // no lead_model → booking.source as-is
  //   ("Best Relocation Inbounds" stays that label)
  // employee_source_snapshot / crm snapshots are not in this cascade

// ── 4. Fill the blanks the owner already expects ───────────

function jobNumberOrBlank(jobNo)
  // ?? ""  — never "not provided"

function mongoLeadIdOrBlank(leadRef)
  // string as-is; else toString(); missing → ""

function localWhenTheOwnerAlreadySetIt(local)
  // skipped optionalLocalCell
  // missing → ""
  // "local" → "local"
  // anything else non-empty → "long_distance"

function cancelledWhenTheBookingIsCancelled(cancelled)
  // skipped cancelledCell(Boolean(cancelled))
  // leftover Cancellation ObjectId → "cancelled"
```

Read the ordinary Form Booking path out loud: *The facade already chose Booked Deals. We stamp Timestamp in UTC, Agent A and Agent B, binder `1000`, Split `TRUE`, the Florida book date, `JOB-1`, John from the populated Customer, deposit `250`, `stripe`, `Main Site Forms` because stored source was `main_site` and `lead_model` is FormLead, this Booking Mongo ID, the Lead Mongo ID, `local`, and `cancelled`. We return 15 strings. We do not write CPL. We do not write OVER 2000. We do not write a Source Company booked sheet. The facade hands the same array to Master Booked. The planner’s booked-only beat and the planner’s Booking Chain first beat hand the same array.*

Read the Call source path out loud: *Stored source is `tbm_leads`. `lead_model` is CallLead. We write `10best Inbounds`. We do not write `TBM Forms`. We do not read a CRM snapshot. Local may be null — the Inbounds label does not care.*

Read the legacy-label path out loud: *Stored source is already `TBM Forms`. Resolve maps that label to `tbm_leads`. `lead_model` is FormLead. We write `TBM Forms` again. We do not leave the raw slug `tbm_leads` on an old row that already carried the owner label.*

Read the Referral path out loud: *There is no Lead. Source is `referral`. Resolve fails. We print `referral`. Customer is the Booking’s `customer_name`. Mongo Lead ID is blank. Local is blank. We still write the Booking Mongo ID. We do not invent Main Site Forms.*

Read the Leadless path out loud: *There is no Lead. Source is already `Best Relocation Inbounds`. Resolve maps that label to `best_relocation_leads`, but `lead_model` is missing, so we print the stored string anyway. We do not rewrite it to `Best Relocation Locals` just because `local` is `local`. Mongo Lead ID is blank.*

Read the one-closer path out loud: *Only Agent A sits on the document. SplitAgent is blank. Split is `FALSE`. We do not invent a second closer from a live Agent populate.*

That is the operation. `bookedLeadToRow` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`bookedLeadToRow` is executor mechanics.** The owner story is “turn this Booking into the fifteen reporting cells the owner already reads on Booked Deals, same cells for live write and queued plan.” Keep the old name as an alias. Do not grow a `BookedLeadRowService` with `create` / `update` / `delete`.

2. **Two writers, one row — and the planner asks twice.** Already-recommended `syncBookedLeadToSheets` plus already-recommended `planBookedLead` / `planBookingChain` all ask this file. Knowledge: do not inline live cell values elsewhere. Keep one **adapter**. Already-recommended planner already named the copied booked beat. Do not silently build a second Booked Deals array inside the planner so “queued can diverge.” Do not silently build cells inside the facade so “live can add CPL.” Do not extract a third projector file in this rename.

3. **This is not the Form/Call snapshot cascade.** Already-recommended Form / Call read `crm_source_label_snapshot` then `source_granularity_label_snapshot` then a static label. This file resolves `booking.source` (already stamped by leftover `resolveBookedLeadSource`) and re-spells it by `lead_model`. `BookedLead.employee_source_snapshot` carries crm / granularity / company snapshots. `BookedLeadSheetSource` does **not** expose them, and this file does not read them. Do not start reading `employee_source_snapshot.crm_source_label_snapshot` so “Booking matches Form” without an owner decision — leftover book-time already chose the stored `source` string. Do not ask leftover Source Assignment here so “the sheet stays current.”

4. **Unresolved source prints the stored string.** `referral` is not a Source Company slug. Resolve returns nothing. The folder test locks `"referral"`. Do not write `Main Site Forms` so “every Booking has a company.” Do not write `not_provided` so “the slug is honest.”

5. **Resolved-but-no-model still prints the stored string.** Leadless `"Best Relocation Inbounds"` resolves to `best_relocation_leads`, then falls through because `lead_model` is missing. The folder test locks the stored label. Do not rewrite it through leftover `getCallLeadSourceCompanyLabel` so “resolve should finish.” Do not rewrite it through leftover `getFormLeadSourceCompanyLabel(local)` so “Locals wins on a local Leadless.”

6. **Empty source becomes `not_provided` before the Form/Call branch.** Leftover `resolveSourceCompany("")` returns `not_provided` (truthy). A FormLead with empty source would print `Main Site Forms`. A CallLead would print `Main Site Inbounds`. A no-model Booking would print the empty stored string. Do not “fix” that empty-to-`not_provided` fall-through in this rename. Lock it if you touch the cell.

7. **Best Relocation Form still splits Locals vs Forms from `booking.local`.** Same leftover function as already-recommended Form. Call never splits. Do not pass `local` into the Call branch so “Booking matches Form.” Do not reuse the Local column text as the Source cell so “one local owns every label.”

8. **Closers are persisted snapshots. The live Agent populate is unused.** Leftover lookup and already-recommended planner both `.populate("agent_allocations.agent")`. This file never reads that path. Knowledge’s Form/Call Sales Rep rule is the same idea: do not live-join Agent at sync time. Do not fall back to `allocation.agent.name` so “Agent is never blank when populate ran.” Do not import leftover `primaryBookingAgent` so “cells already owns the first closer” — that helper reads a populated Booking, not this allocation array.

9. **Split needs two names and a non-zero binder.** Skipped `splitCell` filters trimmed names, then requires raw length `>= 2` and some `binder_amount !== 0`. Two named closers at `$0` / `$0` print `FALSE`. A whitespace second name prints in SplitAgent as-is and still yields `FALSE`. Do not treat any second slot as a split so “two columns means TRUE.” Do not require both binders non-zero so “split means they both earned.”

10. **Printed Agent / SplitAgent cells do not trim.** Form/Call Sales Rep trims. This file does not. Do not add trim so “we match Sales Rep” without a test that a whitespace snapshot stays visible or is blank on purpose.

11. **`customer.full_name` wins over `customer_name`.** The header-order test already uses a populated `full_name`. Referral locks `customer_name` when `customer` is missing. Do not prefer `customer_name` so “the Booking snapshot is honest” when a Customer was populated. Do not live-join a different Customer field (`name`) so “we match leftover `bookingEventContext`.” Do not populate inside this file so “the projection is self-healing.”

12. **Missing Job Number is blank, not `not provided`.** Already-recommended Form writes `"not provided"` for a missing Tracking Reference. Already-recommended Call leaves Job Number blank. This file matches Call. Do not copy the Form blank so “every identity cell has a token.” Do not invent a Job Number from Mongo ID so “the sheet always has a job.”

13. **Mongo Lead ID is the Lead’s id, or blank.** String `lead_ref` prints as-is. ObjectId uses `toString()`. Referral / Leadless missing `lead_ref` stay `""`. This file does not follow that id. Do not return `{ row, alsoWriteTheLead }` so “the projector can run the chain.” Do not write `lead_model` into the cell so “the sheet explains the blank.”

14. **`optionalLocalCell` is blank-when-missing.** Same skipped helper as already-recommended Call. Already-recommended Form uses `localCell`, which treats missing as `long_distance`. Do not switch this file to `localCell` so “we match Forms” — Referral already locks blank Local. Do not write `not_found` so “we match Form states.”

15. **`Boolean(cancelled)` treats a leftover Cancellation ObjectId as cancelled.** The model stores `cancelled` as a ref. The type is `unknown`. The header-order test passes `cancelled: true`. Do not require a populated Cancellation so “the date can print” — Booked Deals has no cancel-date column. Do not write Cancelled Deals from this file.

16. **OVER 2000 / OVER 4000 stay off Booked Deals.** `BookedLead` has `over_2000` / `over_4000`. `BOOKED_SHEET_HEADERS` does not. Already-recommended Form / Call print those flags on the Lead row. Do not append `>2k` / `>4k` so “the projection is complete.”

17. **CPL, city, phone, and email stay off the row.** Knowledge: no CPL column. `BOOKED_SHEET_HEADERS` already omits them. Do not append those fields so “the sheet can price or contact the customer.”

18. **Book Date is Florida calendar. Timestamp is UTC clock.** Skipped `formatDateOnly` / `formatTimestamp`. The header-order test names Timestamp `5/27/2026 09:04:05` and Book Date `2026-05-20`. The type requires `book_date: Date` — this is not skipped `bookedDateCell` (that helper refuses a string id on a Lead’s `booked` ref). Do not switch Timestamp to Eastern so “the owner’s clock matches Book Date” without a paired header/test change. Do not call `bookedDateCell(booking)` so “one helper owns every book date.”

19. **Binder / deposit `0` is `"0"`, not blank.** Skipped `formatNumber` stringifies `0`. Do not elide zero so “empty means unknown money” without an owner decision that a zero-deposit Booking should look unpriced.

20. **This file does not talk to Google and does not persist.** Already-recommended write / take-off / retry wrap Google. Already-recommended `syncAndStore` / drain `updateOne` remember. Do not call `withSheetsRetry` here so “the projector can heal a header.” Do not `document.save()` here so “the row owns the hint.”

21. **Leave sibling modules alone.** Already-recommended `syncBookedLeadToSheets` / `planJobWrites` / `getMasterBookedTabs` / `syncRowToTargets` / `formLeadToRow` / `callLeadToRow` stay where they are. Later `cancelledLeadToRow` stays on its file. Skipped `cells.ts` / leftover `resolveSourceCompany` / leftover `getFormLeadSourceCompanyLabel` / leftover `getCallLeadSourceCompanyLabel` stay where they are. Leftover `resolveBookedLeadSource` stays on `bookedLead.service.ts`. Leftover Referral / Leadless stay on their files. This file orchestrates header-order cells → persisted closers → customer + resolve-then-spell Source → expected blanks.

## Testing

The **interface** is the test surface: the one export (story name, old name as alias). Header order, persisted closers, customer name, resolve-then-spell Source, expected blanks, and the forbidden columns are part of that **interface**. Do not boot Google Sheets. Do not boot Mongo. Pass a `BookedLeadSheetSource`.

`projections/projections.test.ts` already names most of the operation (15 cells, two closers + split `TRUE`, `full_name`, Form `Main Site Forms` / `Top10 Forms`, Call `10best Inbounds`, legacy `TBM Forms`, Referral `referral` + blank lead ref, Leadless stored inbound label + blank lead ref). Keep those. Add the split, customer fallback, empty-source, and forbidden columns the current file does not lock:

**Lay out the Booked Deals reporting cells in today’s header order**
- Length is `BOOKED_SHEET_HEADERS.length` (15) and index `i` is the cell for `BOOKED_SHEET_HEADERS[i]`.
- `cpl` / `over_2000` / `over_4000` / `pickup_city` / `phone_number` / `email` / `is_referral_booking` / `is_leadless_booking` / `employee_source_snapshot` never appear as cells.

**Name the closers and whether they split**
- One allocation → Agent printed, SplitAgent `""`, Split `FALSE`.
- Two named allocations + a non-zero binder → Split `TRUE` (already locked).
- Two named allocations + both `binder_amount === 0` → Split `FALSE`.
- Second name whitespace-only → Split `FALSE`; SplitAgent still prints the whitespace (current pair). Do not “fix” trim in this rename.
- A fixture that could imagine `agent_allocations[0].agent.name` still prints `agent_name_snapshot` (do not treat populate as the cell).

**Name the customer and the Source**
- Populated `customer.full_name` wins over a different `customer_name` (header-order already uses `full_name`; lock the override).
- Missing both → `""`.
- Form `top10_leads` → `Top10 Forms` (already locked).
- Call `tbm_leads` → `10best Inbounds` (already locked).
- Form `best_relocation_leads` + `local: "local"` → `Best Relocation Locals`.
- Call `best_relocation_leads` + `local: "local"` → `Best Relocation Inbounds` (do not treat Local as a Forms/Locals split on Call).
- Unresolved `"referral"` → `"referral"` (already locked).
- Resolved Leadless `"Best Relocation Inbounds"` with no `lead_model` → stored string (already locked).
- Empty `source` + `lead_model: "FormLead"` → `Main Site Forms` (current `resolveSourceCompany` empty → `not_provided`). Do not “fix” that pair in this rename.
- A fixture that could imagine `employee_source_snapshot.crm_source_label_snapshot` still uses resolve-then-spell on `booking.source` (do not treat that snapshot as the cascade).

**Fill the blanks the owner already expects**
- Missing / `""` `job_no` → `""` (never `"not provided"`).
- Missing `lead_ref` → `""` (Referral / Leadless already locked).
- `lead_ref` as a string id → that string.
- Missing Local → `""`; `"local"` → `"local"`.
- `total_binder_amount: 0` / `deposit_amount: 0` → `"0"`.
- `cancelled: true` → `"cancelled"` (already locked).

**Not this interface**
- Booked-Deals-only destination / no source booked sheet stays on [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) / [recommendations/google-sheets-targets.md](google-sheets-targets.md).
- Booking Chain `lead_ref` follow / copied `planBookedLead` beat stays on [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md).
- Continue-on-failure write / upsert / `deleteDimension` / wait-then-retry stay on the already-recommended write / find / take-off / retry files.
- Cell format helpers stay on skipped `projections/cells.ts` (existing tests in this file may keep covering them; do not move those assertions onto this export).
- Form cells stay on [recommendations/google-sheets-form-lead-row.md](google-sheets-form-lead-row.md).
- Call cells stay on [recommendations/google-sheets-call-lead-row.md](google-sheets-call-lead-row.md).
- Cancellation cells stay on later `cancelledLeadRow.ts`.
- Source **stamping** stays on leftover `resolveBookedLeadSource` / [recommendations/bookings-booked-lead.md](bookings-booked-lead.md).

Do **not** add a test per helper (`nameTheClosersTheOwnerAlreadyReads`, `nameTheSourceTheOwnerAlreadyReads`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file writes a Source Company booked sheet — it must not. Do not add a test that this file follows `lead_ref` into `planSourceLead` — it must not. Do not add a test that this file calls `getLeadTargets` / `syncRowToTargets` / `withSheetsRetry` — it must not. Do not add a test that this file live-joins Agent — it must not. Do not add a test that this file writes CPL, city, OVER 2000, or Cancelled Deals — it must not. Do not add a test that queued mode builds a different Booked Deals array — it must not. Do not add a test that this file asks the Registry — it must not. Do not add a test that this file reads `employee_source_snapshot` — it must not. Do not add a test that this file writes `"not provided"` for a missing Job Number — it must not.

## What I would not do

- A `BookedLeadRowService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `formatTimestamp`.
- Moving this into a CRUD folder, or into `googleSheets.service.ts` / `jobPlanner.ts` / `cells.ts` / `formLeadRow.ts` / `callLeadRow.ts` / `bookedLead.service.ts` “for cleanliness.”
- Breaking the same-cells-for-live-and-queued **seam**, the persisted-allocation-snapshot **seam**, the `full_name`-else-`customer_name` **seam**, or the resolve-then-spell-by-`lead_model` **seam**.
- Treating `syncBookedLeadToSheets` / `planJobWrites` / `resolveBookedLeadSource` / `formLeadToRow` / `callLeadToRow` as this story.
- Inventing a tab-choice **seam** that has only one **adapter** here, or a Registry-join **seam** that has only one **adapter** here, or a snapshot-cascade **seam** that has only one **adapter** here.
- Silently writing CPL / city / phone / email / OVER 2000 / OVER 4000 / a Source Company booked sheet, or silently reading `employee_source_snapshot.crm_source_label_snapshot` so “Booking matches Form,” or silently live-joining Agent, or silently building a second Booked Deals array in the planner, or silently rewriting Leadless `"Best Relocation Inbounds"` through a Form/Call label function, or silently writing `"not provided"` for a missing Job Number, or silently writing `Main Site Forms` for `referral`.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `projections/cancelledLeadRow.ts` in this same pass — unchecked `googleSheets` modules remain.
- Making the Booking 201 wait on `turnThisBookingIntoTheReportingCellsTheOwnerAlreadyReads`.
