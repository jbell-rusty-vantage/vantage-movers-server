# Turn This Form Lead Into The Twenty-Two Reporting Cells The Owner Already Reads On Forms, Duplicates, And Bad Leads — Same Cells For Live Write And Queued Plan — Never Invent City, Move Size, CPL, Or A Live Agent Join — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, in-progress)
- Pass: 8 of this service — `projections/formLeadRow.ts`
- Remaining in this service: `projections/callLeadRow.ts`, `projections/bookedLeadRow.ts`, `projections/cancelledLeadRow.ts` (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/projections/formLeadRow.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (projections: do not inline live cell values elsewhere; empty state → `FORM_LEAD_UNKNOWN_STATE`; `ref_no` or `"not provided"`; source label `crm_source_label_snapshot` → `source_granularity_label_snapshot` → `getFormLeadSourceCompanyLabel`; `formatFormLeadBadLeadReason`; `Sales Rep` = `receiver_agent_name_snapshot`; **no CPL column**; `Move Size`, `Lead ID`, and `Source Company Site` were removed). Distinct from already-recommended choose-tabs-then-write-or-take-off: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (that facade **asks** this file after it chose Forms or Duplicates; it does not build cells). Distinct from already-recommended queued plan: [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md) (same cells, different **adapter**; planner asks this file after it chose the same tabs and after it populated `booked` + `customer`). Distinct from already-recommended destination naming: [recommendations/google-sheets-targets.md](google-sheets-targets.md) (that file names Master / Source and attaches `FORM_SHEET_HEADERS`; this file fills those headers). Distinct from already-recommended live write loop: [recommendations/google-sheets-sync-rows.md](google-sheets-sync-rows.md) (that file **hands** already-projected cells). Distinct from already-recommended find-then-write: [recommendations/google-sheets-row-lookup.md](google-sheets-row-lookup.md) (writes the cells this file already built). Distinct from already-recommended live take-off: [recommendations/google-sheets-delete-rows.md](google-sheets-delete-rows.md) (never asks this file). Distinct from already-recommended wait-then-retry: [recommendations/google-sheets-retry.md](google-sheets-retry.md) (this file never talks to Google). Distinct from skipped `projections/cells.ts` (booked / quoted / cancelled / threshold / timestamp / number fold this file already asks — do not pull that file in). Distinct from later `callLeadToRow` / `bookedLeadToRow` / `cancelledLeadToRow` (same folder, different document). Distinct from already-recommended Source Assignment: [recommendations/leads-source-company.md](leads-source-company.md) (that file **stamps** the three snapshots at ingest; this file **reads** two of them and never asks the Registry). Distinct from leftover Form ingest: [recommendations/form-lead.md](form-lead.md) (that file remembers Sheet Sync; it does not project cells). Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names the removed columns and that Sales Rep is never a live Agent join; do not “fix” those in this rename.
- Callers: **two runtime import sites, one shared test file. One export.** Already-recommended facade: `googleSheets.service.ts` — `syncFormLeadToSheets` asks this file **once**, then hands the same array to already-recommended `syncRowToTargets` for Forms or Duplicates **and** Master Bad Leads when `bad_lead` is set. Already-recommended planner: `sheetSync/drainer/jobPlanner.ts` — Form `planSourceLead` asks this file **once** (`lead as unknown as FormLeadSheetSource`) after `populate({ path: "booked", populate: { path: "customer" } })`, then hands the same array to Forms or Duplicates writes **and** the Bad Leads write when `bad_lead` is set. Leftover `deleteFormLeadFromSheets` / already-recommended `deleteRowsFromTargets` / already-recommended `writeBatchedTargets` / leftover `v1.service.ts` / leftover root barrel do **not** import this file. Tests: `projections/projections.test.ts` — header-order 22-cell lock (whitespace delivery state → `not_found`; trimmed email / ref / Sales Rep; `bad_phone_email_name` → `Bad Phone-Email-Name`; missing crm snapshot → `Main Site Forms`); missing `ref_no` → `"not provided"` plus empty email / empty Bad Lead / empty Sales Rep / both states `not_found`; GetMovers slug → `GetMovers Forms` (shared with later Call); booking-deleted flags blank. Sibling `config/domain.test.ts` locks `FORM_SHEET_HEADERS` length contract (has `Booked Date`, no `Duplicate`) — not this file. Not this **interface**: already-recommended Forms-or-Duplicates choice, already-recommended Master-vs-source destinations, already-recommended continue-on-failure write, already-recommended hint-then-scan, already-recommended `deleteDimension`, already-recommended queued high-to-low batch, already-recommended wait-then-retry, later Call / Booking / Cancellation cells, skipped cell format itself, leftover Source Assignment.
- Seams callers need: the same 22 cells for live write and queued plan vs later Call / Booking / Cancellation shapes; header order vs a named object; crm snapshot then granularity snapshot then static Forms label vs a live Registry join; persisted Sales Rep snapshot vs a live Agent join; blank booking mirrors after the Booking is gone vs leftover `booked` as a string id
- Split later (only if the file outgrows one sitting): this ~50-line file is one sitting if you read it as turn this Form Lead into the twenty-two reporting cells the owner already reads, same cells for live write and queued plan, never invent city / move size / CPL / a live Agent join. If it later splits: `nameTheSourceCompanyTheOwnerAlreadyReads.ts` / `mirrorBookingFlagsFromTheDocumentAsItSitsNow.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `project.ts` as a CRUD dump, and never merge already-recommended `syncFormLeadToSheets`, already-recommended `planJobWrites`, later `callLeadToRow`, skipped `cells.ts`, or leftover `getFormLeadSourceCompanyLabel` into this file

`formLeadToRow` is executor mechanics. The owner question is: *Mongo already has the live Form Lead. The facade or the planner already chose Forms or Duplicates, and maybe Master Bad Leads. Turn that document into the twenty-two cells the owner already reads on those tabs — Timestamp, name, zips, states, local, move date, contact, quoted, cubic feet, booking mirrors, Mongo ID, Tracking Reference, Source Company, Bad Lead reason, Sales Rep. Prefer the CRM label we stamped at ingest; if that is empty, the Source Granularity owner label; if that is empty, the static Forms label for this Source Company (Best Relocation still splits Locals vs Forms from Move Type). An empty or whitespace state is `not_found`. A missing Tracking Reference is `not provided`. After the Booking is gone, Booked / OVER 2000 / OVER 4000 / Booked Date / Cancelled go blank. Sales Rep is the persisted receiver-agent name, even when `receiver_agent` is set. Do not write city, move size, Lead ID, Source Company Site, or CPL. Do not ask the Registry. Do not talk to Google. Do not choose the tab. Sheets are reporting. They are never the record. Live write and queued plan must read the same cells — do not silently grow a second Form row builder.*

Already-recommended facade tab choice, already-recommended destination naming, already-recommended live write / take-off, already-recommended queued plan / batch, already-recommended wait-then-retry, later Call / Booking / Cancellation projections, skipped cell format, and leftover Source Assignment already live in other **modules**. Do not pull those in.

## What this file actually does

Four beats of one “turn this Form Lead into the twenty-two reporting cells the owner already reads on Forms, Duplicates, and Bad Leads — same cells for live write and queued plan — never invent city, move size, CPL, or a live Agent join” story, not “a projection CRUD helper,” and not the facade’s Forms-or-Duplicates choice:

1. **Lay out the Form reporting cells in today’s header order** — `formLeadToRow(lead)`. Return `string[]` of length 22 in `FORM_SHEET_HEADERS` order: Timestamp (`formatTimestamp` — UTC month/day/year plus zero-padded clock), Name, Pickup Zip, Destination Zip, Pickup State, Delivery State, Local (`localCell` — only `"local"` stays local; anything else is `long_distance`), Move Date (`formatDateOnly` — Florida calendar date from skipped `cells.ts`), Phone Number, Email (`trim` or `""`), Quoted (`quotedCell(Boolean(quoted))`), Cubic Feet (`formatNumber` — `0` is `"0"`; null / undefined / NaN is `""`), Booked / OVER 2000 / OVER 4000 / Booked Date / Cancelled (beat 4), Mongo ID (`_id.toString()`), Ref No (beat 3), Source Company (beat 2), Bad Lead (beat 2), Sales Rep (beat 3). The same array is what already-recommended facade and already-recommended planner hand to every Form destination, including Master Bad Leads. This beat does not choose Forms vs Duplicates. This beat does not talk to Google. This beat does not persist.

2. **Name the Source Company and spell the Bad Lead reason the owner already reads** — Source Company cell: `crm_source_label_snapshot?.trim()` **or** `source_granularity_label_snapshot?.trim()` **or** leftover `getFormLeadSourceCompanyLabel(source_company, local as LocalType)`. Empty string after trim falls through (`||`). `source_company_label_snapshot` is on `FormLeadSheetSource` and is **not** in this cascade. Static fallback: `tbm_leads` → `TBM Forms`, `get_movers_leads` → `GetMovers Forms`, `not_provided` → `Main Site Forms`, `best_relocation_leads` + `local` → `Best Relocation Locals`, else `Best Relocation Forms`. Bad Lead cell: leftover `formatFormLeadBadLeadReason(bad_lead)` — `bad_phone_email_name` → `Bad Phone-Email-Name`, missing / null → `""`. This beat does not decide whether to write Master Bad Leads. This beat does not ask the Registry.

3. **Fill the blanks the owner already expects** — `formLeadStateCell`: trimmed state or `FORM_LEAD_UNKNOWN_STATE` (`"not_found"`). Whitespace-only is empty. Ref No: trimmed `ref_no` or `"not provided"` (`||`, so `""` is missing). Email: trimmed or `""` (`??`, so `""` stays empty after trim). Sales Rep: `receiver_agent_name_snapshot?.trim() ?? ""`. Missing snapshot stays blank even when a caller could imagine `receiver_agent`. This beat does not geocode. This beat does not live-join Agent.

4. **Mirror booking flags from the document as it sits now** — `bookedCell(Boolean(booked))`, `overThresholdCell(Boolean(over_2000), ">2k")`, `overThresholdCell(Boolean(over_4000), ">4k")`, `bookedDateCell(booked)`, `cancelledCell(Boolean(cancelled))`. After booking deletion (`booked` / `cancelled` undefined, both over-flags false) every one of those five cells is `""`. `bookedDateCell` writes the Florida calendar `book_date` only when `booked` is a populated object; a leftover string id is `""` for the date even when `Boolean(booked)` still prints `booked`. This beat does not follow `lead_ref`. This beat does not write Booked Deals.

There is no fifth mutate operation. Tab **choice**, destination lists, header heal, upsert-by-Mongo-ID, `deleteDimension`, queued batch, wait-then-retry, Call / Booking / Cancellation cells, and Source Assignment already live in other files. There is no second export.

## Organization

Keep one file as the screenplay for “turn this Form Lead into the twenty-two reporting cells the owner already reads on Forms, Duplicates, and Bad Leads — same cells for live write and queued plan — never invent city, move size, CPL, or a live Agent join.” Already-recommended `syncFormLeadToSheets` / `planJobWrites` / `getLeadTargets` / `syncRowToTargets`, later `callLeadToRow`, skipped `cells.ts`, leftover `getFormLeadSourceCompanyLabel` / `formatFormLeadBadLeadReason`, and leftover Source Assignment already live in deeper **modules**. Do not pull those in. Do not invent a `FormLeadRowService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and already-recommended `syncAndStore`. Do not invent a second Form-row **adapter** beside this export. Do not invent a tab-choice **seam** that has only one **adapter** here.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `project.ts`. Those are HTTP verbs, not the owner story. Do not move this into `googleSheets.service.ts` so “the facade already projects.” Do not move this into `jobPlanner.ts` so “the plan already projects.” Do not move this into `cells.ts` so “format already owns the row.” Do not move this into `leadSourceCompany.ts` so “assignment already stamped the label.” Do not silently write city / move size / `lid` / CPL / `source_company_site` so “the sheet is complete.” Do not silently live-join Agent so “Sales Rep is never blank.”

**External interface** stays small (this is the test surface). Header-order cells, snapshot cascade, expected blanks, and booking mirrors are one story’s Form reporting row, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `formLeadToRow` | `turnThisFormLeadIntoTheReportingCellsTheOwnerAlreadyReads` | already-recommended live facade + already-recommended queued planner share the same cells |

Keep the old name as a one-line alias until the already-recommended facade and already-recommended planner migrate. Do not make callers learn `FORM_SHEET_HEADERS` / `crm_source_label_snapshot` / `FORM_LEAD_UNKNOWN_STATE` as the domain language.

**Principle: old exports stay as aliases.** `formLeadToRow` remains the imported name until `syncFormLeadToSheets` and `planSourceLead` point at the story name.

**No class for the workflow.** The type that *does* earn a name is the twenty-two cells both writers already hand to Google:

```ts
type FormLeadReportingCells = string[] // length 22, FORM_SHEET_HEADERS order
```

That is the handoff from “Mongo already has this Form Lead” to “write these cells onto whatever tab the caller already chose.” Do **not** add `duplicate` so “this file can choose Forms or Duplicates,” do **not** add `spreadsheetId` so “this file can write,” and do **not** add `cpl` so “the sheet can price the lead.”

There is no second public export. Do not add `formLeadStateCell` as a public **seam** so “tests can skip the row.” Do not add `nameTheSourceCompanyTheOwnerAlreadyReads` as a public **seam** so “Call can reuse Form.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// formLeadRow.ts
// Mongo already has the live Form Lead.
// The facade or the planner already chose Forms or Duplicates,
// and maybe Master Bad Leads.
// Turn that document into the twenty-two cells
// the owner already reads on those tabs.
// Prefer the CRM label we stamped at ingest.
// If that is empty, the Source Granularity owner label.
// If that is empty, the static Forms label for this Source Company.
// An empty or whitespace state is not_found.
// A missing Tracking Reference is "not provided".
// After the Booking is gone, the booking mirrors go blank.
// Sales Rep is the persisted receiver-agent name.
// Do not write city, move size, Lead ID, Source Company Site, or CPL.
// Do not ask the Registry.
// Do not talk to Google.
// Do not choose the tab.
// Sheets are reporting. They are never the record.
// Live write and queued plan must read the same cells.
// Do not silently grow a second Form row builder.

// ── 1. Lay out the Form reporting cells in today's header order ─

export function turnThisFormLeadIntoTheReportingCellsTheOwnerAlreadyReads(
  lead: FormLeadSheetSource,
): FormLeadReportingCells
export const formLeadToRow =
  turnThisFormLeadIntoTheReportingCellsTheOwnerAlreadyReads

// ── 2. Name the Source Company and spell the Bad Lead reason ─

function nameTheSourceCompanyTheOwnerAlreadyReads(lead)
  // crm_source_label_snapshot.trim()
  // else source_granularity_label_snapshot.trim()
  // else leftover getFormLeadSourceCompanyLabel(source_company, local)
  // source_company_label_snapshot is not in this cascade

function spellTheBadLeadReasonTheOwnerAlreadyReads(reason)
  // leftover formatFormLeadBadLeadReason
  // missing → ""

// ── 3. Fill the blanks the owner already expects ───────────

function fillMissingPickupOrDeliveryState(value)
  // trim or FORM_LEAD_UNKNOWN_STATE ("not_found")

function trackingReferenceOrNotProvided(refNo)
  // trim || "not provided"

function persistedSalesRepName(snapshot)
  // trim ?? ""
  // never live-join Agent

// ── 4. Mirror booking flags from the document as it sits now

function bookingMirrorsFromTheDocumentAsItSitsNow(lead)
  // booked / >2k / >4k / booked date / cancelled
  // leftover string booked id → "booked" + blank date
  // after booking deletion every cell is ""
```

Read the ordinary Forms path out loud: *The facade already chose Forms. We stamp Timestamp in UTC, Jane’s name and zips, NY and `not_found` for the whitespace delivery state, local, the Florida move date, the trimmed email, `quoted`, 750 cubic feet, blank booking mirrors except `>2k`, this Mongo ID, `ref-abc`, `Main Site Forms` because no snapshot was stamped, `Bad Phone-Email-Name`, and `Nick Smith`. We return 22 strings. We do not write New York or Beverly Hills. We do not write move size. We do not write CPL. The facade hands the same array to Master Forms. If this were a Bad Lead, it would hand the same array to Master Bad Leads too.*

Read the snapshot-wins path out loud: *Ingest already stamped `crm_source_label_snapshot` as the Granot label. We write that cell even when `source_company` is still `get_movers_leads` and the static function would have said `GetMovers Forms`. We do not ask the Registry. We do not use `source_company_label_snapshot`.*

Read the GetMovers fallback path out loud: *No CRM snapshot. No granularity snapshot. `source_company` is `get_movers_leads`. We write `GetMovers Forms`. The planner uses the same cell on the queued write.*

Read the booking-deleted path out loud: *The Booking is gone. `booked` and `cancelled` are undefined. Both over-flags are false. Booked, OVER 2000, OVER 4000, Booked Date, and Cancelled are blank. We still write the Form row. We do not take Booked Deals off — that is another story.*

Read the missing-identity path out loud: *`ref_no` was never set. Email is missing. Both states are empty. Sales Rep snapshot is missing. We write `not provided`, empty email, `not_found` / `not_found`, empty Bad Lead, empty Sales Rep. We still write the Mongo ID. That is how later find trusts the row.*

That is the operation. `formLeadToRow` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`formLeadToRow` is executor mechanics.** The owner story is “turn this Form Lead into the twenty-two reporting cells the owner already reads, same cells for live write and queued plan.” Keep the old name as an alias. Do not grow a `FormLeadRowService` with `create` / `update` / `delete`.

2. **Two writers, one row.** Already-recommended `syncFormLeadToSheets` and already-recommended `planJobWrites` both ask this file. Knowledge: do not inline live cell values elsewhere. Keep one **adapter**. Do not silently build a second Form array inside the planner so “queued can diverge.” Do not silently build cells inside the facade so “live can add city.”

3. **The cascade skips `source_company_label_snapshot`.** The type has three snapshots. This file reads crm, then granularity, then the static function. The operations-registry owner-UI spec already names crm as the Source Company column and granularity `owner_label` as the fallback — it does **not** name `source_company_label_snapshot` in this cell. Do not start reading the third snapshot so “every snapshot is honest” without an owner decision — old rows may still carry a company-level spelling that must not override the Granot label. Do not ask leftover Source Assignment here so “the sheet stays current” — ingest already stamped; this file reports.

4. **`not_provided` still prints `Main Site Forms`.** Leftover `getFormLeadSourceCompanyLabel` and the folder test lock that. Do not write `not_provided` into the cell so “the slug is honest.” Do not write `Main Site Inbounds` so “one label owns every channel.”

5. **Best Relocation still splits Locals vs Forms from `lead.local`.** The static function is the only Move Type branch in this file. `localCell` already mapped the Local column. Do not reuse the Local column text as the Source Company cell so “one local owns every label.” Do not drop the `as LocalType` cast by reading a different field.

6. **Whitespace state is `not_found`, not blank.** Same token as `FormLead` schema default. The header-order test locks `"  "` → `not_found`. Do not write `""` so “empty means unknown” — later filters already treat `not_found` as the missing-state value. Do not geocode here so “the sheet can heal.”

7. **Cities, move size, Lead ID, Source Company Site, and CPL stay off the row.** Knowledge names the removals. `pickup_city` / `delivery_city` / `move_size` / `lid` / `cpl` / `source_company_site` / `first_name` / `last_name` remain on `FormLeadSheetSource`. The header-order test already forbids cities in the array. `FORM_SHEET_HEADERS` has no `Duplicate` and no CPL. Do not append those fields so “the projection is complete.” Do not write `duplicate` as `TRUE`/`FALSE` so “Duplicates is visible on Forms.”

8. **Sales Rep is the persisted snapshot.** Knowledge: do not live-join Agent at sync time. Empty snapshot stays blank even when `receiver_agent` is set. Do not import leftover `receiverAgentCrmUsername` so “the sheet shows who owns it.” Do not fall back to `booked.agent_allocations[0]` so “a booked Form can show the closer.”

9. **A leftover string `booked` id can print `booked` with a blank Booked Date.** `Boolean("hex")` is true; skipped `bookedDateCell` refuses a string. Already-recommended facade and already-recommended planner populate `booked` + `customer` before they ask this file. Do not treat a string id as populated so “Booked Date can invent a day.” Do not clear the Booked label when the id is a string so “the pair always matches” without a test that an unpopulated live call still reports booked. Do not populate inside this file so “the projection is self-healing.”

10. **Bad Lead reason is a label, not a tab choice.** `formatFormLeadBadLeadReason` lives in leftover `sheets.ts`. This file does not call `getDeleteTargets` and does not append Master Bad Leads. Do not return `{ row, alsoWriteBadLeads }` so “the projector can route.” Do not write the raw slug `bad_phone_email_name` so “the sheet matches Mongo.”

11. **`localCell` is all-or-nothing.** Skipped helper: only `"local"` stays local; `null` / `undefined` / anything else is `long_distance`. Form `local` is a required string on the type. Do not switch this file to skipped `optionalLocalCell` so “we match Booked Deals” — a blank Local on Forms is a different owner read.

12. **Cubic feet `0` is `"0"`, not blank.** Skipped `formatNumber` stringifies `0`. Do not elide zero so “empty means unknown cubic feet” without an owner decision that a quoted-zero Form should look unquoted.

13. **Timestamp is UTC clock components. Move date is Florida calendar date.** Skipped `formatTimestamp` uses `getUTC*`. Skipped `formatDateOnly` uses `formatFloridaCalendarDateIso`. The folder test names the timestamp `5/27/2026 09:04:05` for a `T09:04:05.000Z` instant. Do not switch Timestamp to Eastern so “the owner’s clock matches move date” without a paired header/test change. Leave both helpers on skipped `cells.ts`.

14. **This file does not talk to Google and does not persist.** Already-recommended write / take-off / retry wrap Google. Already-recommended `syncAndStore` / drain `updateOne` remember. Do not call `withSheetsRetry` here so “the projector can heal a header.” Do not `document.save()` here so “the row owns the hint.”

15. **Leave sibling modules alone.** Already-recommended `syncFormLeadToSheets` / `planJobWrites` / `getLeadTargets` / `syncRowToTargets` stay where they are. Later `callLeadToRow` / `bookedLeadToRow` / `cancelledLeadToRow` stay on their files. Skipped `cells.ts` / leftover `getFormLeadSourceCompanyLabel` / leftover `formatFormLeadBadLeadReason` stay where they are. Leftover Source Assignment stays on `leadSourceCompany.ts`. This file orchestrates header-order cells → snapshot cascade → expected blanks → booking mirrors.

## Testing

The **interface** is the test surface: the one export (story name, old name as alias). Header order, snapshot cascade, expected blanks, booking mirrors, and the forbidden columns are part of that **interface**. Do not boot Google Sheets. Do not boot Mongo. Pass a `FormLeadSheetSource`.

`projections/projections.test.ts` already names most of the operation (22 cells, cities forbidden, whitespace state, trimmed email / ref / Sales Rep, Bad Lead label, GetMovers fallback, missing `ref_no`, booking-deleted blanks). Keep those. Add the cascade and the forbidden columns the current file does not lock:

**Lay out the Form reporting cells in today’s header order**
- Length is `FORM_SHEET_HEADERS.length` (22) and index `i` is the cell for `FORM_SHEET_HEADERS[i]`.
- `pickup_city` / `delivery_city` / `move_size` / `lid` / `cpl` / `source_company_site` / `first_name` / `last_name` / `duplicate` never appear as cells.

**Name the Source Company and spell the Bad Lead reason**
- Non-empty `crm_source_label_snapshot` wins over a different `source_granularity_label_snapshot` and over `get_movers_leads` → `GetMovers Forms`.
- Empty / whitespace crm snapshot falls through to trimmed granularity snapshot.
- Empty both snapshots + `get_movers_leads` → `GetMovers Forms` (already locked).
- Empty both snapshots + `not_provided` → `Main Site Forms` (already locked).
- Empty both snapshots + `best_relocation_leads` + `local` → `Best Relocation Locals`.
- `source_company_label_snapshot` alone does **not** win (do not treat that field as the cascade).
- `bad_lead: "disconnected_number"` → `D/C number`; missing → `""`.

**Fill the blanks the owner already expects**
- Whitespace pickup state → `not_found` (delivery already locked).
- `ref_no: ""` → `"not provided"` (same as missing).
- Missing Sales Rep snapshot → `""` even when the fixture could have imagined a receiver-agent id.

**Mirror booking flags from the document as it sits now**
- Booking-deleted blanks stay locked.
- `booked` as a populated object → `booked` plus Florida `book_date`.
- `booked` as a string id → `booked` plus blank Booked Date (current pair). Do not “fix” that pair in this rename.

**Not this interface**
- Forms-or-Duplicates / always-clear Bad Leads stay on [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md).
- Queued Bad Leads only-when-remembered stays on [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md).
- Master-vs-source destination lists stay on [recommendations/google-sheets-targets.md](google-sheets-targets.md).
- Continue-on-failure write / upsert / `deleteDimension` / wait-then-retry stay on the already-recommended write / find / take-off / retry files.
- Cell format helpers stay on skipped `projections/cells.ts` (existing tests in this file may keep covering them; do not move those assertions onto this export).
- Call / Booking / Cancellation cells stay on later `*Row.ts`.
- Snapshot **stamping** stays on [recommendations/leads-source-company.md](leads-source-company.md).

Do **not** add a test per helper (`nameTheSourceCompanyTheOwnerAlreadyReads`, `fillMissingPickupOrDeliveryState`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file chooses `Duplicates` from `duplicate=true` — it must not. Do not add a test that this file calls `getLeadTargets` / `syncRowToTargets` / `withSheetsRetry` — it must not. Do not add a test that this file live-joins Agent — it must not. Do not add a test that this file writes CPL or city — it must not. Do not add a test that queued mode builds a different Form array — it must not. Do not add a test that this file asks the Registry — it must not.

## What I would not do

- A `FormLeadRowService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `formatTimestamp`.
- Moving this into a CRUD folder, or into `googleSheets.service.ts` / `jobPlanner.ts` / `cells.ts` / `leadSourceCompany.ts` “for cleanliness.”
- Breaking the same-cells-for-live-and-queued **seam**, the crm-then-granularity-then-static **seam**, or the Sales-Rep-is-the-persisted-snapshot **seam**.
- Treating `syncFormLeadToSheets` / `planJobWrites` / `getFormLeadSourceCompanyLabel` / `callLeadToRow` as this story.
- Inventing a tab-choice **seam** that has only one **adapter** here, or a Registry-join **seam** that has only one **adapter** here.
- Silently writing city / move size / `lid` / CPL / `source_company_site`, or silently reading `source_company_label_snapshot` so “every snapshot is honest,” or silently live-joining Agent, or silently building a second Form array in the planner.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `projections/callLeadRow.ts` in this same pass — unchecked `googleSheets` modules remain.
- Making the Form Lead 201 wait on `turnThisFormLeadIntoTheReportingCellsTheOwnerAlreadyReads`.
