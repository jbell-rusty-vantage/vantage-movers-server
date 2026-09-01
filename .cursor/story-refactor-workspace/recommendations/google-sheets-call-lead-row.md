# Turn This Call Lead Into The Fifteen Reporting Cells The Owner Already Reads On Calls And Duplicate Calls — Same Cells For Live Write And Queued Plan — Never Invent City, Name, Zip, CPL, Bad Calls, Or A Live Agent Join — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, in-progress)
- Pass: 9 of this service — `projections/callLeadRow.ts`
- Remaining in this service: `projections/bookedLeadRow.ts`, `projections/cancelledLeadRow.ts` (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/projections/callLeadRow.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (projections: do not inline live cell values elsewhere; inbound source label `crm_source_label_snapshot` → `source_granularity_label_snapshot` → `getCallLeadSourceCompanyLabel`; `FormFill`; `Sales Rep` = `receiver_agent_name_snapshot`; **no CPL column**; **`Bad Calls` has no write path**; `created_on_unmatched` skip lives **before** this file). Distinct from already-recommended Form cells: [recommendations/google-sheets-form-lead-row.md](google-sheets-form-lead-row.md) (twenty-two Forms / Duplicates / Bad Leads cells, Forms labels, `localCell`, `"not provided"` Tracking Reference — same folder, different document). Distinct from already-recommended choose-tabs-then-write-or-take-off: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (that facade **asks** this file after it chose Calls or Duplicate Calls; it does not build cells; it always takes the stale opposite tab off). Distinct from already-recommended queued plan: [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md) (same cells, different **adapter**; planner skips unmatched **then** asks this file after it populated `booked` + `customer`). Distinct from already-recommended destination naming: [recommendations/google-sheets-targets.md](google-sheets-targets.md) (that file names Master / Source and attaches `CALL_SHEET_HEADERS`; this file fills those headers). Distinct from already-recommended live write loop: [recommendations/google-sheets-sync-rows.md](google-sheets-sync-rows.md) (that file **hands** already-projected cells). Distinct from already-recommended find-then-write: [recommendations/google-sheets-row-lookup.md](google-sheets-row-lookup.md) (writes the cells this file already built). Distinct from already-recommended live take-off: [recommendations/google-sheets-delete-rows.md](google-sheets-delete-rows.md) (never asks this file). Distinct from already-recommended wait-then-retry: [recommendations/google-sheets-retry.md](google-sheets-retry.md) (this file never talks to Google). Distinct from skipped `projections/cells.ts` (booked / cancelled / threshold / timestamp / number / `optionalLocalCell` / `booleanCell` fold this file already asks — do not pull that file in). Distinct from later `bookedLeadToRow` / `cancelledLeadToRow` (same folder, different document). Distinct from already-recommended Source Assignment: [recommendations/leads-source-company.md](leads-source-company.md) (that file **stamps** the three snapshots at ingest; this file **reads** two of them and never asks the Registry). Distinct from leftover Call ingest: [recommendations/leads-call-lead.md](leads-call-lead.md) (that file remembers Sheet Sync; it does not project cells). Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names that Sales Rep is never a live Agent join, that `Bad Calls` is provisioned but never written, and that this facade will write an unmatched Call if invoked directly; do not “fix” those in this rename.
- Callers: **two runtime import sites, one shared test file. One export.** Already-recommended facade: `googleSheets.service.ts` — `syncCallLeadToSheets` asks this file **once**, then hands the same array to already-recommended `syncRowToTargets` for Calls or Duplicate Calls. Already-recommended planner: `sheetSync/drainer/jobPlanner.ts` — Call `planSourceLead` skips `created_on_unmatched`, then asks this file **once** (`lead as unknown as CallLeadSheetSource`) after `populate({ path: "booked", populate: { path: "customer" } })`, then hands the same array to Calls or Duplicate Calls writes **and** the stale-opposite take-off. Leftover `deleteCallLeadFromSheets` / already-recommended `deleteRowsFromTargets` / already-recommended `writeBatchedTargets` / leftover `v1.service.ts` / leftover root barrel do **not** import this file. Tests: `projections/projections.test.ts` — header-order 15-cell lock (cities forbidden; string `booked` id → `booked` + blank Booked Date; `tbm_leads` → `10best Inbounds`; `form_fill: true` → `TRUE`; trimmed Sales Rep); GetMovers slug → `GetMovers Inbounds` (shared with already-recommended Form); booking-deleted flags blank. Sibling `config/domain.test.ts` locks `CALL_SHEET_HEADERS` (has `Booked Date`, no Name / Email / zips / states, last header `Sales Rep`) plus `getCallLeadSourceCompanyLabel` Inbounds spellings — not this file. Not this **interface**: already-recommended Calls-or-Duplicate-Calls choice, already-recommended stale-opposite take-off, already-recommended Master-vs-source destinations, already-recommended continue-on-failure write, already-recommended hint-then-scan, already-recommended `deleteDimension`, already-recommended queued high-to-low batch, already-recommended wait-then-retry, already-recommended Form cells, later Booking / Cancellation cells, skipped cell format itself, leftover unmatched skip, leftover Source Assignment.
- Seams callers need: the same 15 cells for live write and queued plan vs already-recommended Form / later Booking / Cancellation shapes; header order vs a named object; crm snapshot then granularity snapshot then static Inbounds label vs a live Registry join; persisted Sales Rep snapshot vs a live Agent join; blank booking mirrors after the Booking is gone vs leftover `booked` as a string id; blank Local when Move Type was never set vs Form’s all-or-nothing `long_distance`
- Split later (only if the file outgrows one sitting): this ~35-line file is one sitting if you read it as turn this Call Lead into the fifteen reporting cells the owner already reads, same cells for live write and queued plan, never invent city / name / zip / CPL / Bad Calls / a live Agent join. If it later splits: `nameTheInboundSourceTheOwnerAlreadyReads.ts` / `mirrorBookingFlagsFromTheDocumentAsItSitsNow.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `project.ts` as a CRUD dump, and never merge already-recommended `syncCallLeadToSheets`, already-recommended `planJobWrites`, already-recommended `formLeadToRow`, skipped `cells.ts`, or leftover `getCallLeadSourceCompanyLabel` into this file

`callLeadToRow` is executor mechanics. The owner question is: *Mongo already has the live Call Lead. The facade or the planner already chose Calls or Duplicate Calls. Turn that document into the fifteen cells the owner already reads on those tabs — Timestamp, Job Number, phone, duration, booking mirrors, local, cubic feet, Mongo ID, Source Company, FormFill, Sales Rep. Prefer the CRM label we stamped at ingest; if that is empty, the Source Granularity owner label; if that is empty, the static Inbounds label for this Source Company (Best Relocation is always Inbounds — this file never splits Locals vs Forms from Move Type). A missing Job Number is blank, not `not provided`. A missing Local stays blank. Missing Form Fill prints `FALSE`. After the Booking is gone, Booked / Booked Date / OVER 2000 / OVER 4000 / Cancelled go blank. Sales Rep is the persisted receiver-agent name, even when `receiver_agent` is set. Do not write city, name, email, zip, state, or CPL. Do not write Bad Calls. Do not skip unmatched here. Do not ask the Registry. Do not talk to Google. Do not choose the tab. Sheets are reporting. They are never the record. Live write and queued plan must read the same cells — do not silently grow a second Call row builder.*

Already-recommended facade tab choice, already-recommended destination naming, already-recommended live write / take-off, already-recommended queued plan / batch, already-recommended wait-then-retry, already-recommended Form cells, later Booking / Cancellation projections, skipped cell format, leftover unmatched skip, and leftover Source Assignment already live in other **modules**. Do not pull those in.

## What this file actually does

Four beats of one “turn this Call Lead into the fifteen reporting cells the owner already reads on Calls and Duplicate Calls — same cells for live write and queued plan — never invent city, name, zip, CPL, Bad Calls, or a live Agent join” story, not “a projection CRUD helper,” and not the facade’s Calls-or-Duplicate-Calls choice:

1. **Lay out the Call reporting cells in today’s header order** — `callLeadToRow(lead)`. Return `string[]` of length 15 in `CALL_SHEET_HEADERS` order: Timestamp (`formatTimestamp` — UTC month/day/year plus zero-padded clock), Job No (`job_no ?? ""`), Phone Number (`phone_number ?? ""`), Duration (`formatNumber` — `0` is `"0"`; null / undefined / NaN is `""`), Booked / Booked Date / Over 2000 / Over 4000 / Cancelled (beat 4), Local (beat 3), Cubic Feet (`formatNumber`), Mongo ID (`_id.toString()`), Source Company (beat 2), FormFill (beat 3), Sales Rep (beat 3). The same array is what already-recommended facade and already-recommended planner hand to every Call destination. This beat does not choose Calls vs Duplicate Calls. This beat does not take the stale opposite tab off. This beat does not talk to Google. This beat does not persist.

2. **Name the Source Company the owner already reads as an inbound** — Source Company cell: `crm_source_label_snapshot?.trim()` **or** `source_granularity_label_snapshot?.trim()` **or** leftover `getCallLeadSourceCompanyLabel(source_company)`. Empty string after trim falls through (`||`). `source_company_label_snapshot` is on `CallLeadSheetSource` and is **not** in this cascade. Static fallback: `tbm_leads` → `10best Inbounds`, `tbm_prime_leads` → `TBM Prime Inbounds`, `top10_leads` → `Top10 Inbounds`, `best_relocation_leads` → `Best Relocation Inbounds`, `get_movers_leads` → `GetMovers Inbounds`, `main_site` → `Main Site Inbounds`, `paid_overflow` → `Paid Overflow`, `not_provided` → `Main Site Inbounds`, unknown slug → the slug itself. This beat does not take a `local` argument. This beat does not ask the Registry. This beat does not write `TBM Forms` / `GetMovers Forms`.

3. **Fill the blanks the owner already expects** — Job No and phone stay empty when missing (`?? ""`). Local: skipped `optionalLocalCell` — `null` / `undefined` / `""` is `""`; only `"local"` stays local; any other non-empty value is `long_distance`. FormFill: skipped `booleanCell(Boolean(form_fill))` — missing / null / false is `"FALSE"`; true is `"TRUE"`. Sales Rep: `receiver_agent_name_snapshot?.trim() ?? ""`. Missing snapshot stays blank even when a caller could imagine `receiver_agent`. This beat does not write `"not provided"` for a missing Job Number. This beat does not live-join Agent. This beat does not geocode.

4. **Mirror booking flags from the document as it sits now** — `bookedCell(Boolean(booked))`, `bookedDateCell(booked)`, `overThresholdCell(Boolean(over_2000), ">2k")`, `overThresholdCell(Boolean(over_4000), ">4k")`, `cancelledCell(Boolean(cancelled))`. After booking deletion (`booked` / `cancelled` undefined, both over-flags false) every one of those five cells is `""`. `bookedDateCell` writes the Florida calendar `book_date` only when `booked` is a populated object; a leftover string id is `""` for the date even when `Boolean(booked)` still prints `booked`. The header-order test already locks that pair (`booked: "some-id"` → `"booked"` + `""`). This beat does not follow `lead_ref`. This beat does not write Booked Deals.

There is no fifth mutate operation. Tab **choice**, stale-opposite take-off, destination lists, header heal, upsert-by-Mongo-ID, `deleteDimension`, queued batch, wait-then-retry, unmatched skip, Form / Booking / Cancellation cells, and Source Assignment already live in other files. There is no second export.

## Organization

Keep one file as the screenplay for “turn this Call Lead into the fifteen reporting cells the owner already reads on Calls and Duplicate Calls — same cells for live write and queued plan — never invent city, name, zip, CPL, Bad Calls, or a live Agent join.” Already-recommended `syncCallLeadToSheets` / `planJobWrites` / `getLeadTargets` / `syncRowToTargets`, already-recommended `formLeadToRow`, later `bookedLeadToRow`, skipped `cells.ts`, leftover `getCallLeadSourceCompanyLabel`, leftover unmatched skip, and leftover Source Assignment already live in deeper **modules**. Do not pull those in. Do not invent a `CallLeadRowService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and already-recommended `syncAndStore`. Do not invent a second Call-row **adapter** beside this export. Do not invent a tab-choice **seam** that has only one **adapter** here.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `project.ts`. Those are HTTP verbs, not the owner story. Do not move this into `googleSheets.service.ts` so “the facade already projects.” Do not move this into `jobPlanner.ts` so “the plan already projects.” Do not move this into `cells.ts` so “format already owns the row.” Do not move this into `formLeadRow.ts` so “one projector owns every lead.” Do not move this into `leadSourceCompany.ts` so “assignment already stamped the label.” Do not silently write city / name / email / zip / state / CPL so “the sheet is complete.” Do not silently live-join Agent so “Sales Rep is never blank.” Do not silently write `Bad Calls` so “the tab we provisioned gets a row.”

**External interface** stays small (this is the test surface). Header-order cells, inbound snapshot cascade, expected blanks, and booking mirrors are one story’s Call reporting row, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `callLeadToRow` | `turnThisCallLeadIntoTheReportingCellsTheOwnerAlreadyReads` | already-recommended live facade + already-recommended queued planner share the same cells |

Keep the old name as a one-line alias until the already-recommended facade and already-recommended planner migrate. Do not make callers learn `CALL_SHEET_HEADERS` / `crm_source_label_snapshot` / `optionalLocalCell` as the domain language.

**Principle: old exports stay as aliases.** `callLeadToRow` remains the imported name until `syncCallLeadToSheets` and Call `planSourceLead` point at the story name.

**No class for the workflow.** The type that *does* earn a name is the fifteen cells both writers already hand to Google:

```ts
type CallLeadReportingCells = string[] // length 15, CALL_SHEET_HEADERS order
```

That is the handoff from “Mongo already has this Call Lead” to “write these cells onto whatever tab the caller already chose.” Do **not** add `duplicate` so “this file can choose Calls or Duplicate Calls,” do **not** add `created_on_unmatched` so “this file can skip,” do **not** add `spreadsheetId` so “this file can write,” and do **not** add `cpl` so “the sheet can price the lead.”

There is no second public export. Do not add `nameTheInboundSourceTheOwnerAlreadyReads` as a public **seam** so “Form can reuse Call.” Do not add `optionalLocalCell` as a public **seam** so “tests can skip the row.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// callLeadRow.ts
// Mongo already has the live Call Lead.
// The facade or the planner already chose Calls or Duplicate Calls.
// Turn that document into the fifteen cells
// the owner already reads on those tabs.
// Prefer the CRM label we stamped at ingest.
// If that is empty, the Source Granularity owner label.
// If that is empty, the static Inbounds label for this Source Company.
// A missing Job Number is blank, not "not provided".
// A missing Local stays blank.
// Missing Form Fill prints FALSE.
// After the Booking is gone, the booking mirrors go blank.
// Sales Rep is the persisted receiver-agent name.
// Do not write city, name, email, zip, state, or CPL.
// Do not write Bad Calls.
// Do not skip unmatched here.
// Do not ask the Registry.
// Do not talk to Google.
// Do not choose the tab.
// Sheets are reporting. They are never the record.
// Live write and queued plan must read the same cells.
// Do not silently grow a second Call row builder.

// ── 1. Lay out the Call reporting cells in today's header order ─

export function turnThisCallLeadIntoTheReportingCellsTheOwnerAlreadyReads(
  lead: CallLeadSheetSource,
): CallLeadReportingCells
export const callLeadToRow =
  turnThisCallLeadIntoTheReportingCellsTheOwnerAlreadyReads

// ── 2. Name the Source Company the owner already reads as an inbound

function nameTheInboundSourceTheOwnerAlreadyReads(lead)
  // crm_source_label_snapshot.trim()
  // else source_granularity_label_snapshot.trim()
  // else leftover getCallLeadSourceCompanyLabel(source_company)
  // source_company_label_snapshot is not in this cascade
  // no local / Move Type argument
  // tbm_leads → "10best Inbounds"
  // not_provided → "Main Site Inbounds"
  // best_relocation_leads → "Best Relocation Inbounds"

// ── 3. Fill the blanks the owner already expects ───────────

function jobNumberOrBlank(jobNo)
  // ?? ""  — never "not provided"

function phoneOrBlank(phone)
  // ?? ""

function localWhenTheOwnerAlreadySetIt(local)
  // skipped optionalLocalCell
  // missing → ""
  // "local" → "local"
  // anything else non-empty → "long_distance"

function formFillTrueOrFalse(formFill)
  // skipped booleanCell(Boolean(formFill))
  // missing → "FALSE"

function persistedSalesRepName(snapshot)
  // trim ?? ""
  // never live-join Agent

// ── 4. Mirror booking flags from the document as it sits now

function bookingMirrorsFromTheDocumentAsItSitsNow(lead)
  // booked / booked date / >2k / >4k / cancelled
  // leftover string booked id → "booked" + blank date
  // after booking deletion every cell is ""
```

Read the ordinary Calls path out loud: *The facade already chose Calls. We stamp Timestamp in UTC, `J-100`, the phone, 120 seconds, `booked` with a blank Booked Date because the id was never populated, blank OVER 2000, `>4k`, blank Cancelled, `long_distance`, 1200 cubic feet, this Mongo ID, `10best Inbounds` because no snapshot was stamped, `TRUE` for Form Fill, and `Nick Smith`. We return 15 strings. We do not write New York or Beverly Hills. We do not write the name. We do not write CPL. The facade hands the same array to Master Calls. If this were a Duplicate Lead, it would hand the same array to Duplicate Calls instead.*

Read the snapshot-wins path out loud: *Ingest already stamped `crm_source_label_snapshot` as the Granot inbound label. We write that cell even when `source_company` is still `get_movers_leads` and the static function would have said `GetMovers Inbounds`. We do not ask the Registry. We do not use `source_company_label_snapshot`. We do not write `GetMovers Forms`.*

Read the GetMovers fallback path out loud: *No CRM snapshot. No granularity snapshot. `source_company` is `get_movers_leads`. We write `GetMovers Inbounds`. The planner uses the same cell on the queued write.*

Read the booking-deleted path out loud: *The Booking is gone. `booked` and `cancelled` are undefined. Both over-flags are false. Booked, Booked Date, OVER 2000, OVER 4000, and Cancelled are blank. We still write the Call row. We do not take Booked Deals off — that is another story.*

Read the missing-identity path out loud: *`job_no` was never set. Phone is missing. Duration is missing. Local was never set. Form Fill was never set. Sales Rep snapshot is missing. We write blank Job Number, blank phone, blank duration, blank Local, `FALSE`, empty Sales Rep. We still write the Mongo ID. That is how later find trusts the row. We do not write `not provided`.*

That is the operation. `callLeadToRow` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`callLeadToRow` is executor mechanics.** The owner story is “turn this Call Lead into the fifteen reporting cells the owner already reads, same cells for live write and queued plan.” Keep the old name as an alias. Do not grow a `CallLeadRowService` with `create` / `update` / `delete`.

2. **Two writers, one row.** Already-recommended `syncCallLeadToSheets` and already-recommended `planJobWrites` both ask this file. Knowledge: do not inline live cell values elsewhere. Keep one **adapter**. Do not silently build a second Call array inside the planner so “queued can diverge.” Do not silently build cells inside the facade so “live can add city.”

3. **The cascade skips `source_company_label_snapshot`.** The type has three snapshots. This file reads crm, then granularity, then the static Inbounds function. The operations-registry owner-UI spec already names crm as the Source Company column and granularity `owner_label` as the fallback — it does **not** name `source_company_label_snapshot` in this cell. Do not start reading the third snapshot so “every snapshot is honest” without an owner decision — old rows may still carry a company-level spelling that must not override the Granot label. Do not ask leftover Source Assignment here so “the sheet stays current” — ingest already stamped; this file reports.

4. **Inbounds labels, not Forms labels.** Leftover `getCallLeadSourceCompanyLabel` and the folder test lock `tbm_leads` → `10best Inbounds` and `get_movers_leads` → `GetMovers Inbounds`. Already-recommended Form writes `TBM Forms` / `GetMovers Forms` from a different function. Do not call leftover `getFormLeadSourceCompanyLabel` so “one label owns every channel.” Do not write `TBM Inbounds` so “the slug looks tidy” — the owner already reads `10best Inbounds`. Do not write `not_provided` into the cell so “the slug is honest.”

5. **Best Relocation never splits Locals vs Forms here.** The static Call function takes no Move Type. `best_relocation_leads` is always `Best Relocation Inbounds`. Already-recommended Form is the file that splits Locals vs Forms from `lead.local`. Do not pass `lead.local` into this fallback so “Call matches Form.” Do not reuse the Local column text as the Source Company cell so “one local owns every label.”

6. **Missing Job Number is blank, not `not provided`.** Already-recommended Form writes `"not provided"` for a missing Tracking Reference. Call `job_no` is optional beside phone. The type allows both missing. Do not copy the Form blank so “every identity cell has a token.” Do not invent a Job Number from `phone_number` so “the sheet always has a job.”

7. **`optionalLocalCell` is blank-when-missing.** Skipped helper: empty / null / undefined → `""`; only `"local"` stays local; anything else non-empty is `long_distance`. Already-recommended Form uses `localCell`, which treats missing as `long_distance`. Do not switch this file to `localCell` so “we match Forms” — a blank Local on Calls is the owner read when RingCentral never set Move Type. Do not write `not_found` so “we match Form states.”

8. **Missing Form Fill prints `FALSE`, not blank.** `Boolean(undefined)` is false. The header-order test locks `true` → `TRUE`. Domain headers lock `FormFill` as the column. Do not write `""` so “empty means unknown Form Fill” without an owner decision that an unenriched Call should look unlike `FALSE`. Do not write `form_fill` / `yes` so “the sheet matches Mongo.”

9. **Cities, name, email, zip, state, and CPL stay off the row.** `CALL_SHEET_HEADERS` already omits Name / Email / Pickup Zip / Delivery Zip / Pickup State / Delivery State. Those fields remain on `CallLeadSheetSource` (`name`, `first_name`, `last_name`, `email`, `pickup_city`, `delivery_city`, `pickup_zip`, `delivery_zip`, `pickup_state`, `delivery_state`, `duplicate`). The header-order test already forbids cities in the array. Do not append those fields so “the projection is complete.” Do not write `duplicate` as `TRUE`/`FALSE` so “Duplicate Calls is visible on Calls.”

10. **Sales Rep is the persisted snapshot.** Knowledge: do not live-join Agent at sync time. Empty snapshot stays blank even when `receiver_agent` is set. Do not import leftover `receiverAgentCrmUsername` so “the sheet shows who owns it.” Do not fall back to `booked.agent_allocations[0]` so “a booked Call can show the closer.”

11. **A leftover string `booked` id can print `booked` with a blank Booked Date.** `Boolean("hex")` is true; skipped `bookedDateCell` refuses a string. The header-order test already locks `booked: "some-id"` → `"booked"` + `""`. Already-recommended facade and already-recommended planner populate `booked` + `customer` before they ask this file. Do not treat a string id as populated so “Booked Date can invent a day.” Do not clear the Booked label when the id is a string so “the pair always matches” without a test that an unpopulated live call still reports booked. Do not populate inside this file so “the projection is self-healing.”

12. **This file does not choose Calls vs Duplicate Calls and does not take the stale opposite off.** Already-recommended facade / planner own `callLeadTargetBase(duplicate)` and the always-delete-opposite. Do not return `{ row, alsoWriteDuplicateCalls }` so “the projector can route.” Do not read `duplicate` so “the row can show the tab.”

13. **This file does not skip `created_on_unmatched`.** Knowledge: skip lives **before** this module (`syncSourceLead` / `planSourceLead`). Invoked directly, already-recommended `syncCallLeadToSheets` will write a Calls row. Do not add an unmatched guard here so “the projector is safe to invoke” — that silently hides a caller that should have skipped. Do not write `Unmatched` into Source Company so “the sheet explains the skip.”

14. **`Bad Calls` stays unwritten.** Knowledge: the tab exists in `SHEET_TAB_NAMES` and source tab sets when `hasBadTabs` is true. **No sync write path targets it.** This file has no Bad Lead reason column. Do not append a Bad Call cell so “we match Forms.” Do not return `{ row, alsoWriteBadCalls }` so “the projector can route.”

15. **Header text `Over 2000` / `Over 4000` still prints `>2k` / `>4k`.** Same skipped helper as already-recommended Form. Do not write `TRUE` / `Over 2000` so “the cell matches the header” without a paired header/test change.

16. **Duration `0` is `"0"`, not blank.** Skipped `formatNumber` stringifies `0`. Do not elide zero so “empty means unknown duration” without an owner decision that a zero-second Call should look untimed.

17. **Timestamp is UTC clock components.** Skipped `formatTimestamp` uses `getUTC*`. The header-order test names `5/27/2026 09:04:05` for a `T09:04:05.000Z` instant. Do not switch Timestamp to Eastern so “the owner’s clock matches Booked Date” without a paired header/test change. Leave the helper on skipped `cells.ts`.

18. **This file does not talk to Google and does not persist.** Already-recommended write / take-off / retry wrap Google. Already-recommended `syncAndStore` / drain `updateOne` remember. Do not call `withSheetsRetry` here so “the projector can heal a header.” Do not `document.save()` here so “the row owns the hint.”

19. **Leave sibling modules alone.** Already-recommended `syncCallLeadToSheets` / `planJobWrites` / `getLeadTargets` / `syncRowToTargets` / `formLeadToRow` stay where they are. Later `bookedLeadToRow` / `cancelledLeadToRow` stay on their files. Skipped `cells.ts` / leftover `getCallLeadSourceCompanyLabel` stay where they are. Leftover unmatched skip stays on lookup / planner. Leftover Source Assignment stays on `leadSourceCompany.ts`. This file orchestrates header-order cells → inbound snapshot cascade → expected blanks → booking mirrors.

## Testing

The **interface** is the test surface: the one export (story name, old name as alias). Header order, inbound snapshot cascade, expected blanks, booking mirrors, and the forbidden columns are part of that **interface**. Do not boot Google Sheets. Do not boot Mongo. Pass a `CallLeadSheetSource`.

`projections/projections.test.ts` already names most of the operation (15 cells, cities forbidden, string booked id, `10best Inbounds`, FormFill `TRUE`, trimmed Sales Rep, GetMovers fallback, booking-deleted blanks). Keep those. Add the cascade and the blanks the current file does not lock:

**Lay out the Call reporting cells in today’s header order**
- Length is `CALL_SHEET_HEADERS.length` (15) and index `i` is the cell for `CALL_SHEET_HEADERS[i]`.
- `name` / `first_name` / `last_name` / `email` / `pickup_city` / `delivery_city` / `pickup_zip` / `delivery_zip` / `pickup_state` / `delivery_state` / `duplicate` / `cpl` never appear as cells.

**Name the Source Company the owner already reads as an inbound**
- Non-empty `crm_source_label_snapshot` wins over a different `source_granularity_label_snapshot` and over `get_movers_leads` → `GetMovers Inbounds`.
- Empty / whitespace crm snapshot falls through to trimmed granularity snapshot.
- Empty both snapshots + `get_movers_leads` → `GetMovers Inbounds` (already locked).
- Empty both snapshots + `tbm_leads` → `10best Inbounds` (already locked).
- Empty both snapshots + `not_provided` → `Main Site Inbounds`.
- Empty both snapshots + `best_relocation_leads` + `local: "local"` → `Best Relocation Inbounds` (do not treat Local as a Forms/Locals split).
- `source_company_label_snapshot` alone does **not** win (do not treat that field as the cascade).

**Fill the blanks the owner already expects**
- Missing / `""` `job_no` → `""` (never `"not provided"`).
- Missing `phone_number` → `""`.
- Missing `duration` → `""`; `duration: 0` → `"0"`.
- Missing Local → `""`; `"local"` → `"local"`.
- Missing `form_fill` → `"FALSE"`.
- Missing Sales Rep snapshot → `""` even when the fixture could have imagined a receiver-agent id.

**Mirror booking flags from the document as it sits now**
- Booking-deleted blanks stay locked.
- `booked` as a populated object → `booked` plus Florida `book_date`.
- `booked` as a string id → `booked` plus blank Booked Date (already locked). Do not “fix” that pair in this rename.

**Not this interface**
- Calls-or-Duplicate-Calls / always-delete-opposite stay on [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md).
- Queued unmatched skip stays on [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md) / [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md).
- Master-vs-source destination lists stay on [recommendations/google-sheets-targets.md](google-sheets-targets.md).
- Continue-on-failure write / upsert / `deleteDimension` / wait-then-retry stay on the already-recommended write / find / take-off / retry files.
- Cell format helpers stay on skipped `projections/cells.ts` (existing tests in this file may keep covering them; do not move those assertions onto this export).
- Form cells stay on [recommendations/google-sheets-form-lead-row.md](google-sheets-form-lead-row.md).
- Booking / Cancellation cells stay on later `*Row.ts`.
- Snapshot **stamping** stays on [recommendations/leads-source-company.md](leads-source-company.md).

Do **not** add a test per helper (`nameTheInboundSourceTheOwnerAlreadyReads`, `jobNumberOrBlank`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file chooses `Duplicate Calls` from `duplicate=true` — it must not. Do not add a test that this file skips `created_on_unmatched` — it must not. Do not add a test that this file calls `getLeadTargets` / `syncRowToTargets` / `withSheetsRetry` — it must not. Do not add a test that this file live-joins Agent — it must not. Do not add a test that this file writes CPL, city, name, or `Bad Calls` — it must not. Do not add a test that queued mode builds a different Call array — it must not. Do not add a test that this file asks the Registry — it must not. Do not add a test that this file writes `GetMovers Forms` — it must not.

## What I would not do

- A `CallLeadRowService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `formatTimestamp`.
- Moving this into a CRUD folder, or into `googleSheets.service.ts` / `jobPlanner.ts` / `cells.ts` / `formLeadRow.ts` / `leadSourceCompany.ts` “for cleanliness.”
- Breaking the same-cells-for-live-and-queued **seam**, the crm-then-granularity-then-static-Inbounds **seam**, the blank-Local-when-missing **seam**, or the Sales-Rep-is-the-persisted-snapshot **seam**.
- Treating `syncCallLeadToSheets` / `planJobWrites` / `getCallLeadSourceCompanyLabel` / `formLeadToRow` as this story.
- Inventing a tab-choice **seam** that has only one **adapter** here, or a Registry-join **seam** that has only one **adapter** here, or an unmatched-skip **seam** that has only one **adapter** here.
- Silently writing city / name / email / zip / state / CPL / `Bad Calls`, or silently reading `source_company_label_snapshot` so “every snapshot is honest,” or silently live-joining Agent, or silently building a second Call array in the planner, or silently calling the Form label function so “one label owns every channel,” or silently writing `"not provided"` for a missing Job Number.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `projections/bookedLeadRow.ts` in this same pass — unchecked `googleSheets` modules remain.
- Making the Call Lead 201 wait on `turnThisCallLeadIntoTheReportingCellsTheOwnerAlreadyReads`.
