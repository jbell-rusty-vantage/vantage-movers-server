# Turn Each Best Relocation Tab Into Typed Observations — Skip FORMULAS On Forms And Booked Deals, Remember The Sheet Row, Fold Phone The Lead Way And Job The Best Relocation Way — Never Window, Match, Or Apply — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 2 of this service — `parsing.ts`
- Remaining in this service: `matching.ts`, `plan.ts`, `applicationPlan.ts`, `provider.ts`, `identity.ts`, `sourceChangePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/parsing.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Happy-path step 3 names leftover `sheets.ts` as the reader; leftover `LID_BestRelo` is matching evidence only — never an action. Primary-code list names leftover `canonicalLeadAdoption.ts` / leftover `sheets.ts` / leftover `dryRunReports.ts`, not this file — do not add a second Ingestion Service so “the parser owns the happy path.” Distinct from already-recommended six-tab read / inspect counts / ID resolver / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md) (that file **asks** this file after `readTab`; it windows Forms / Local Forms / Calls / Booked Deals / Refunds; it does **not** window LID_BestRelo). Distinct from later leftover match: leftover `matching.ts` (this file stamps name tokens / date-key folds; match **asks** those and does not parse). Distinct from later leftover identity: leftover `identity.ts` (**asks** this file’s `normalizeJobNo` again for Booked Deals; Calls use leftover `vantage_ingestion_id`, not a parse-time id). Distinct from later leftover plan / collapse: leftover `plan.ts` (**asks** this file’s `normalizeJobNo` / `toDateKeyFromRaw`; it does not parse). Distinct from later leftover provider inspect: leftover `provider.ts` (required-header check; LID comment names this file’s grid; it does **not** import this file). Distinct from already-recommended leftover worker / apply / persist / health / poke: [`ingestion-worker.md`](ingestion-worker.md), [`ingestion-apply-plan.md`](ingestion-apply-plan.md), [`ingestion-repository.md`](ingestion-repository.md), [`ingestion-health.md`](ingestion-health.md), [`ingestion-queue.md`](ingestion-queue.md). Distinct from already-recommended Booking Job fold: [`bookings-booking-identity.md`](bookings-booking-identity.md) — leftover `bookingIdentity.normalizeJobNo` is NFKC + non-letter/digit runs become **one space** (`P-123` → `P 123`). This file’s `normalizeJobNo` strips every non-letter/digit (`P-123` → `P123`). Do **not** unify. Distinct from leftover Agent name fold: leftover `agents/agentName.ts` (same trim / collapse / lower; this file returns `undefined` on empty). Distinct from already-recommended Lead phone sieve: [`leads-lead-phone-matching.md`](leads-lead-phone-matching.md) + `src/utils/phone.ts` `normalizePhoneNumberForMatch` — this file **asks** that fold and does not invent a second phone sieve. Distinct from already-recommended leftover Granot CSV identity parse: [`granot-crm-csv-parser.md`](granot-crm-csv-parser.md). Distinct from already-recommended Form / Call / Booked / Cancelled sheet **write** cells: leftover `google-sheets-*-row.md` — this file reads Best Relocation evidence; it does not project Mongo onto Reporting Sheets. Folder `HANDOFF.md` is not knowledge — do not copy it. This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: leftover `sheets.ts` `readBestRelocationWorkbooks` + leftover `inspectBestRelocationWorkbookCounts` → `parseFormRows` (Forms and Local Forms), `parseCallRows`, `parseBookedDealRows`, `parseRefundRows`; leftover read also → `parseLidBestRelo` (inspect counts never ask LID). Leftover `sheets.ts` imports leftover `cell` and never calls it. Leftover `matching.ts` → `nameTokens` / `normalizePersonName` / `toDateKeyFromRaw`. Leftover `plan.ts` → `normalizeJobNo` / `toDateKeyFromRaw`. Leftover `identity.ts` → `normalizeJobNo` on Booked Deals. Barrel `index.ts` re-exports `BEST_RELOCATION_LEAD_SOURCES`, `makeTab`, `parseBookedDealRows`, `parseCallRows`, `parseDate`, `parseDateTime`, `parseFormRows`, `parseLidBestRelo`, `parseRefundRows` — not `cell` / `parseMoney` / `normalizeJobNo` / `normalizePersonName` / `normalizeAgentName` / `nameTokens` / `isBestRelocationSource` / `toDateKeyFromRaw`. Folder test `bestRelocationSheetIngest.test.ts` → serial dates, combined Call serial, FORMULAS skip + provenance, then leftover parse as plan/collapse fixtures. Leftover `ingestion/ingestion.test.ts` → leftover `makeTab` + leftover parsers as workbook fixtures (including a LID fixture that does **not** match this file’s grid). Leftover `adapter.ts` **asks** leftover `sheets.read`, not this file. Leftover CLI **asks** leftover inspect counts / leftover read, not this file. Wave B `src/routes/ingestion.routes.ts` does not import this file. Leftover `provider.ts` does not import this file.
- Seams callers need: parse-then-window vs parse-never-windows; Forms / Local Forms same parser with `source_tab` stamping `local`; Calls have no durable identity; FORMULAS skip on Forms and Booked Deals only; LID_BestRelo is a different grid and is matching evidence; this file’s Job fold vs leftover `bookingIdentity.normalizeJobNo`; phone fold is leftover `normalizePhoneNumberForMatch`; leftover `makeTab` is the test fixture. There is no Domain Command seam. There is no window seam. There is no apply seam.
- Split later (only if the file outgrows one sitting): this ~400-line file is one sitting if you read it as turn each Best Relocation tab into typed observations. Do **not** split into `parse.ts` / `normalize.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover `sheets.ts` window, leftover `matching.ts`, leftover `identity.ts`, or leftover `plan.ts` here. If it later splits: `turnEachBestRelocationFormOrLocalFormRowIntoAFormLeadObservation.ts` / `turnEachBestRelocationCallRowIntoACallLeadObservation.ts` / `turnEachBestRelocationBookedDealRowIntoABookingObservation.ts` / `turnEachBestRelocationRefundRowIntoACancellationObservation.ts` / `turnTheLidBestReloGridIntoMatchingEvidenceBuckets.ts` only as later story files, never CRUD.

`parseFormRows` / `parseCallRows` / `parseBookedDealRows` / `parseRefundRows` / `parseLidBestRelo` are executor mechanics. The owner question is: *The leftover reader already fetched the raw Best Relocation tabs. Turn every populated row into a typed observation. Skip the FORMULAS sentinel on Forms and Booked Deals. Remember which workbook, tab, and sheet row it came from. Fold the phone the same way Leads fold phones. Fold the Job Number the Best Relocation way — strip everything that is not a letter or digit — not the Booking Identity way. Local Forms is the same Form parser with `local` stamped true. Calls have no Lead ID and no Tracking Reference. LID_BestRelo is matching evidence in amount buckets, not an action, and it is a different grid: row 1 names the report, row 2 is the buckets, data starts on row 3. This file does not window. This file does not match. This file does not apply. This file never reads Local Calls.*

Leftover window / leftover match / leftover identity / leftover plan / leftover apply already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “turn each Best Relocation tab into typed observations” story, not “a parse CRUD helper,” and not leftover window / leftover match / leftover apply.

1. **Turn each Forms or Local Forms row into a Form Lead observation** — leftover `parseFormRows(tab, sourceTab)`. Walk leftover `rows` (header row is `matrix[0]`; skip a blank body row). Drop a row whose `Time Stamp` is `FORMULAS`. Read leftover `Time Stamp` / leftover `Move Date` through leftover `parseDate`. Stamp `source_tab`. Stamp `local: sourceTab === "Local Forms"`. Fold name (`normalizePersonName` + leftover `nameTokens`), phone (`normalizePhoneNumberForMatch`), optional leftover `Lead ID` / leftover `Ref No`. Keep booked / `>2K` / `>4K` / leftover `Bad Lead Checker` as raw cells. Attach leftover `provenance` (`workbook_id` / tab / `sheet_row` / `source_row_key` / raw header map). This function does not window. This function does not decide adopt vs create.

2. **Turn each Calls row into a Call Lead observation** — leftover `parseCallRows(tab)`. Same leftover `rows`. Phone is leftover `PHONE NUMBER` or leftover `Phone Number` or leftover `Phone`. Join leftover `Date` + leftover `Time` through leftover `parseDateTime` (a Google serial in Date with an empty Time is a combined timestamp — folder test). There is **no** FORMULAS skip. There is **no** Lead ID / Tracking Reference. Inspect counts later treat leftover `missing_durable_identity` as `0`. Attach leftover provenance. This function does not mint leftover `vantage_ingestion_id` (leftover `identity.ts` reads that raw cell later).

3. **Turn each Booked Deals row into a Booking observation** — leftover `parseBookedDealRows(tab)`. Drop `Timestamp === FORMULAS`. Read leftover `Timestamp` / leftover `Book Date`. Job is leftover `Job Number:` (colon in the header). Fold leftover `normalizeJobNo` from **this file**. Fold customer name + leftover `nameTokens`. Fold leftover `parseMoney` on Binder / Deposit. Stamp leftover `is_best_relocation_source` from leftover `isBestRelocationSource` (`best relocation forms` / `inbounds` / `locals`). LID is leftover `trailingLid`: leftover `LID` column, else the first leftover `__col_*` that looks like a UUID or `LID` + hex. Attach leftover provenance. This function does not collapse two agents on the same Job (leftover `plan.collapseBookingsByJob`).

4. **Turn each Refunds row into a Cancellation observation** — leftover `parseRefundRows(tab)`. Same Job / name / money / Lead Source / trailing LID as Booked Deals. Also leftover `Refund Request Date` / leftover `Status` / leftover `normalized_agent`. There is **no** FORMULAS skip. There is no leftover `nameTokens` on the customer. Attach leftover provenance. This function does not decide whether a refund may cancel (leftover match / leftover plan).

5. **Turn the LID_BestRelo grid into matching-evidence buckets** — leftover `parseLidBestRelo(tab)`. This is **not** leftover `rows`. Leftover `matrix[1]` is the bucket header row (`<1K` / `>2K` / `>4K`). Body starts at leftover `matrix[2]` (sheet row 3). Each non-empty cell that is not itself a bucket label becomes `{ lid, bucket, sheet_row }`. Unknown header → `bucket: "unknown"`. No provenance object. No window fields. Leftover inspect counts never ask this function. Leftover knowledge: never an action.

Shared beats, not owner operations: leftover `cell` (trim; leftover `sheets.ts` imports it and never calls it), leftover `parseDate` / leftover `parseNewYorkWallClock` / leftover Google serial (`20_000`–`100_000`, epoch `1899-12-30`), leftover `parseDateTime` (serial date + clock fraction or `HH:MM[:SS][AM|PM]`), leftover `parseMoney`, leftover `normalizePersonName` / leftover `normalizeAgentName` / leftover `nameTokens` (split on `/&,+|` or `and`), leftover `toDateKeyFromRaw` (ISO / US / leftover `parseDate` UTC day), leftover `headerMap` / leftover `provenance` / leftover `rows`, leftover `makeTab` (test fixture on the barrel).

## Organization

Keep one file as the screenplay for “turn each Best Relocation tab into typed observations — skip FORMULAS on Forms and Booked Deals, remember the sheet row, fold phone the Lead way and Job the Best Relocation way — never window, match, or apply.” Leftover window, leftover match, leftover identity, leftover plan, leftover apply already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationParseService` class. Do not invent a begin / complete **seam** here — parse is not a Domain Command. Do not invent a second phone **adapter** beside leftover `normalizePhoneNumberForMatch`. Do not invent a second Job **adapter** beside leftover `bookingIdentity.normalizeJobNo` (name the strip-vs-space mismatch; do not silently switch). Do not invent a window **adapter** here.

**External interface** stays small (this is the test surface). Five tab faces plus the folds leftover match / leftover plan / leftover identity / leftover tests already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `parseFormRows` | `turnEachBestRelocationFormOrLocalFormRowIntoAFormLeadObservation` | leftover read + leftover inspect counts; Local Forms stamps `local` |
| `parseCallRows` | `turnEachBestRelocationCallRowIntoACallLeadObservation` | leftover read + leftover inspect; no durable identity |
| `parseBookedDealRows` | `turnEachBestRelocationBookedDealRowIntoABookingObservation` | leftover read + leftover inspect; BR source + trailing LID |
| `parseRefundRows` | `turnEachBestRelocationRefundRowIntoACancellationObservation` | leftover read + leftover inspect; no FORMULAS skip |
| `parseLidBestRelo` | `turnTheLidBestReloGridIntoMatchingEvidenceBuckets` | leftover read only; matching evidence; different grid |
| `parseDate` | `readABestRelocationSheetDateAsNewYorkOrGoogleSerial` | folder test + leftover `toDateKeyFromRaw` |
| `parseDateTime` | `joinABestRelocationCallDateAndTime` | Calls; combined serial in Date |
| `toDateKeyFromRaw` | `giveTheBestRelocationRowACalendarDayKey` | leftover match + leftover plan |
| `normalizeJobNo` | `foldTheBestRelocationJobNumber` | leftover identity + leftover plan; **not** leftover `bookingIdentity` |
| `normalizePersonName` | `foldTheBestRelocationPersonName` | leftover match |
| `nameTokens` | `splitTheBestRelocationCustomerNameIntoTokens` | leftover match |
| `isBestRelocationSource` | `isThisLeadSourceABestRelocationSource` | Booked / Refund stamp; three labels |
| `BEST_RELOCATION_LEAD_SOURCES` | keep | barrel; no other runtime caller |
| `makeTab` | keep as test fixture | folder test + leftover `ingestion.test.ts` |
| `cell` | keep as helper | leftover `sheets.ts` unused import |
| `parseMoney` | keep as helper | Binder / Deposit |
| `normalizeAgentName` | keep as helper | Refunds only |

Keep the old names as one-line aliases until leftover `sheets.ts`, leftover `matching.ts`, leftover `plan.ts`, leftover `identity.ts`, the barrel, and the two test files migrate. Do not make callers learn `InTransaction` or CRUD verbs.

**No class for the workflow.** The one type that earns a name is the parsed observation plus leftover provenance leftover `sheets.ts` already windows:

```ts
type BestRelocationSheetObservation = {
  sheet_row: number
  provenance: SheetProvenance  // workbook + tab + source_row_key + raw
  // today's ParsedFormLead | ParsedCallLead | ParsedBookedDeal | ParsedRefund
}
```

That is the handoff from “this populated sheet row is typed” to “leftover `sheets.ts` may window it; leftover match may use the folds.” Do **not** put leftover `vantage_ingestion_id` on that object so “parse owns identity,” do **not** put leftover `in_window` so “parse owns the cutoff,” and do **not** put leftover `lead_ref` so “parse can apply.”

`ParsedFormLead` / `ParsedCallLead` / `ParsedBookedDeal` / `ParsedRefund` / `LidBestReloEntry` / `TabReadResult` stay on sibling `types.ts`. Do not move those cards here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// parsing.ts
// The leftover reader already fetched the raw Best Relocation tabs.
// Turn every populated row into a typed observation.
// Skip FORMULAS on Forms and Booked Deals.
// Remember the workbook, tab, and sheet row.
// Fold the phone the Lead way.
// Fold the Job Number the Best Relocation way (strip, do not space).
// Local Forms is the same Form parser with local stamped true.
// Calls have no Lead ID and no Tracking Reference.
// LID_BestRelo is matching evidence in amount buckets, not an action.
// This file does not window. This file does not match. This file does not apply.

// ── 1. Forms / Local Forms ────────────────────────────────

export function turnEachBestRelocationFormOrLocalFormRowIntoAFormLeadObservation(
  tab,
  sourceTab: "Forms" | "Local Forms",
)
function skipTheFormulasSentinel(raw)                 // Time Stamp === FORMULAS
function stampWhetherThisFormIsLocal(sourceTab)       // Local Forms → local: true
function foldTheCustomerNameAndPhone(name, phone)
function rememberTheSheetRow(tab, sheetRow, raw)

// ── 2. Calls ──────────────────────────────────────────────

export function turnEachBestRelocationCallRowIntoACallLeadObservation(tab)
function readTheCallPhoneFromAnyPhoneHeader(raw)
export function joinABestRelocationCallDateAndTime(date, time)
// no FORMULAS skip; no Lead ID / Ref No

// ── 3. Booked Deals ───────────────────────────────────────

export function turnEachBestRelocationBookedDealRowIntoABookingObservation(tab)
function skipTheFormulasSentinelOnBookedDeals(raw)    // Timestamp === FORMULAS
export function foldTheBestRelocationJobNumber(jobNo) // strip [^A-Z0-9], not bookingIdentity
function takeTheLidFromTheLidColumnOrATrailingUuid(raw)
export function isThisLeadSourceABestRelocationSource(leadSource)

// ── 4. Refunds ────────────────────────────────────────────

export function turnEachBestRelocationRefundRowIntoACancellationObservation(tab)
// same Job / LID / BR-source folds; no FORMULAS skip; no nameTokens

// ── 5. LID_BestRelo matching evidence ─────────────────────

export function turnTheLidBestReloGridIntoMatchingEvidenceBuckets(tab)
function readAmountBucketsFromRowTwo(matrix)          // not leftover rows()
function skipBucketLabelsAndBlankCells(value)

// ── Shared folds leftover match / plan / identity ask ─────

export function readABestRelocationSheetDateAsNewYorkOrGoogleSerial(value)
export function giveTheBestRelocationRowACalendarDayKey(value)
export function foldTheBestRelocationPersonName(value)
export function splitTheBestRelocationCustomerNameIntoTokens(value)
export function makeTab(tabName, headers, matrix, spreadsheetId)  // test fixture
```

Read the primary path out loud: *The leftover reader hands a raw tab. Walk every populated body row. Skip FORMULAS on Forms and Booked Deals. Fold the timestamp as a New York wall clock or a Google serial. Fold the phone the Lead way. Fold the Job Number by stripping everything that is not a letter or digit. Stamp Local Forms as local. Remember the workbook, tab, and sheet row. Booked Deals and Refunds remember whether the Lead Source is Best Relocation Forms, Inbounds, or Locals, and take a LID from the LID column or a trailing UUID. LID_BestRelo is a different grid: row 2 is the amount buckets, data starts on row 3, and it is matching evidence, not an action. Then leftover sheets windows the first five tabs. This file never windows. This file never matches. This file never applies.*

That is the operation. `parseFormRows` is not.

## Precise logic I would tighten while renaming

1. **Two Job Number folds.** This file: `trim` + uppercase + strip `[^A-Z0-9]` → `P-123` becomes `P123`. Leftover `bookingIdentity.normalizeJobNo`: NFKC + non-letter/digit runs become **one space** → `P-123` becomes `P 123`. Leftover `identity.ts` and leftover `plan.ts` **ask this file**. Do not silently switch Booked Deals / Refunds onto leftover `bookingIdentity` in this rename.

2. **FORMULAS skip is asymmetric.** Forms (`Time Stamp`) and Booked Deals (`Timestamp`) drop the sentinel row. Calls and Refunds do not. Leftover `parseDate("FORMULAS")` is already `undefined`. Leftover `sheets.ts` read then **throws** on an invalid timestamp; leftover inspect **counts** it. Do not add a Calls / Refunds FORMULAS skip in this rename. Do not move the throw into this file.

3. **LID_BestRelo is a different grid.** Leftover `provider.ts` says row 1 names the report and row 2 is the amount buckets. This file reads leftover `matrix[1]` as buckets and leftover `matrix[2]` as the first data row. Leftover `rows()` / leftover `tab.headers` are unused here. Leftover `ingestion.test.ts` `fixture(includeLidEvidence)` passes `[["LID", "Bucket"], [lid, ">2K"]]`, so leftover `matrix[1]` is the LID itself and the body loop is empty — leftover `parseLidBestRelo` returns `[]`. Name that fixture lie. Do not “fix” the fixture in this rename. Do not make LID_BestRelo an ingest action.

4. **Trailing LID.** Leftover `LID` column wins. Else the first leftover `__col_*` that looks like a UUID or `LID` + hex. Extra cells past the header become leftover `__col_N`. Do not start reading a named `Lead ID` column on Booked Deals.

5. **Local Forms is the same parser.** Leftover `local` is `sourceTab === "Local Forms"`, not a sheet column. Knowledge: trusted Best Relocation create may pass leftover `local` through. Do not derive Move Type from zips in this file.

6. **Calls have no durable identity.** Phone + leftover `Date`/`Time` only. Leftover inspect counts leftover `missing_durable_identity_rows: 0` with the comment “Best Relocation Calls do not have a durable source identity yet.” Leftover `identity.stableSourceRowId` later **asks** leftover `vantage_ingestion_id` from leftover `provenance.raw`. Do not mint that id here.

7. **Combined Google serial on Calls.** Leftover `parseDateTime("45922.8633333333", "")` uses leftover `parseDate` on the date cell. Folder test locks `2025-09-22T20:43:12.000Z`. Serial range is `20_000`–`100_000`. Epoch is leftover `Date.UTC(1899, 11, 30)`. Do not switch to leftover `BEST_RELOCATION_TIMEZONE` formatting here — leftover `sheets.ts` already owns that constant.

8. **Three Best Relocation Lead Source labels.** Leftover `best relocation forms` / leftover `best relocation inbounds` / leftover `best relocation locals` (trim + lower). Leftover `plan.collapseBookingsByJob` keeps only leftover `is_best_relocation_source`. Do not add leftover `best relocation calls` in this rename.

9. **Leftover `cell` is unused in leftover `sheets.ts`.** Leftover `populatedRowCount` re-trims with `String(value ?? "").trim()`. Do not silently share leftover `cell` into leftover `sheets.ts` in this rename.

10. **Leftover `normalizeAgentName` here vs leftover `agents/agentName.ts`.** Same trim / collapse / lower; this file returns `undefined` on empty. Refunds only. Do not route Refunds through leftover Agent catalog in this rename.

11. **Leave sibling modules alone.** Leftover `sheets.ts` window / leftover throw-vs-count, leftover `matching.ts`, leftover `identity.ts`, leftover `plan.collapseBookingsByJob`, leftover `provider.ts` header inspect, leftover `bookingIdentity.normalizeJobNo`, leftover `normalizePhoneNumberForMatch` are already the right **depth**.

12. **Never start parsing Local Calls.** Leftover `sheets.ts` never reads that tab. This file has no Local Calls parser. Do not add one.

## Testing

The **interface** is the test surface: the five tab parsers, leftover `parseDate` / leftover `parseDateTime`, leftover `foldTheBestRelocationJobNumber`, leftover `giveTheBestRelocationRowACalendarDayKey`.

Today’s leftover `bestRelocationSheetIngest.test.ts` proves Google serial UTC components, a combined Call serial, FORMULAS skip + `source_row_key` on Forms, then uses leftover parse as fixtures for leftover collapse / leftover plan. Leftover `ingestion.test.ts` proves leftover Call leftover `vantage_ingestion_id` survives reorder **after** leftover parse; its LID fixture does not exercise this file’s real grid. That is not enough for a story this long.

Replace the stub-as-fixture style with tests that name the operation:

**Forms / Local Forms**
- A `FORMULAS` Time Stamp row is dropped; the next populated row keeps leftover `sheet_row` and leftover `source_row_key`.
- Leftover `parseFormRows(tab, "Local Forms")` stamps `local: true` and `source_tab: "Local Forms"`. Forms stamps `local: false`.
- Phone is leftover `normalizePhoneNumberForMatch`. Name tokens split on `/&,+|` or `and`.
- Missing leftover `Lead ID` and leftover `Ref No` still parse (inspect later counts leftover `missing_durable_identity`).

**Calls**
- Leftover `PHONE NUMBER` / leftover `Phone Number` / leftover `Phone` all read.
- Combined Google serial in Date with empty Time → the folder-test ISO instant.
- A `FORMULAS` Date still produces a row (no skip). Timestamp may be missing; leftover `sheets.ts` read throws, leftover inspect counts.

**Booked Deals / Refunds**
- Leftover `Job Number:` `P-123` folds to `P123` through **this** leftover `normalizeJobNo`, not leftover `P 123`.
- Leftover `Best Relocation Forms` / Inbounds / Locals stamp leftover `is_best_relocation_source: true`. Another label is false.
- LID column wins; else a trailing leftover `__col_*` UUID is taken.
- Booked Deals drops `Timestamp === FORMULAS`. Refunds keep that row.

**LID_BestRelo**
- Row 1 title, row 2 `<1K` / `>2K` / `>4K`, row 3 a LID under `>2K` → `{ lid, bucket: ">2K", sheet_row: 3 }`.
- A cell that is itself `<1K` / `>2K` / `>4K` is skipped.
- The leftover `ingestion.test.ts` two-row fixture returns `[]` today — lock that or name it; do not silently grow data rows in this rename.

**Folds**
- Leftover `parseDate("FORMULAS")` is `undefined`.
- Leftover `toDateKeyFromRaw("1/2/2026")` is `2026-01-02`.
- Do **not** add a test per leftover `headerMap` / leftover `looksLikeLid` / leftover `parseClockFraction`.

Do **not** add a helper-unit test that has to change when leftover `skipTheFormulasSentinel` is inlined. Leftover `makeTab` stays exported because the two test files are a second real **adapter**, not a test leak.

Caller to keep green: leftover `sheets.ts` still windows after parse and still does not window LID; leftover `matching.ts` still **asks** leftover name / date-key folds; leftover `identity.ts` / leftover `plan.ts` still **ask** this leftover `normalizeJobNo`; leftover folder serial + FORMULAS tests; leftover `ingestion.test.ts` Call reorder + leftover fixture builders.

## What I would not do

- A `BestRelocationParseService` class with `parse` / `normalize` / `validate`.
- Thirty two-line functions that only wrap leftover `cell`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `parse.ts` / `normalize.ts` split “for cleanliness.”
- Breaking leftover parse-then-window. Leftover `sheets.ts` owns cutoff inclusive / read-through exclusive and leftover throw-vs-count. This file must not start windowing.
- Treating leftover `bookingIdentity.normalizeJobNo` as this story. The space-vs-strip mismatch stays visible.
- Making LID_BestRelo an ingest action, windowing it, or reading Local Calls.
- Minting leftover `vantage_ingestion_id` or leftover `lead_ref` on the parsed observation.
- Silently “fixing” leftover `ingestion.test.ts` LID fixture, leftover `sheets.ts` unused `cell` import, or leftover `applicationPlan.ts` keeping timestamp-less refunds.
- Writing leftover Reporting Sheets from this file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
