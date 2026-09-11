# Append The Owner's Tariff Adjustment Rows Onto Master After Resolving Each Granot Carrier Code To Legal Name And DOT, Stamp Florida Timestamp, Ensure The Live Headers Including The Trailing Space On Rule, Then Values.Append Insert Rows — Never Upsert, Never Write Customer Or Job, Never Use Sheet Sync — operational story

- Status: recommended
- Service: `tariff` (Wave A, in-progress)
- Pass: 1 of this service — `append.ts`
- Remaining in this service: `resolveCarrier.ts`
- Target: `src/services/tariff/append.ts`
- Knowledge: [`docs/knowledge/services/tariff.md`](../../../docs/knowledge/services/tariff.md) (append-only [Tariff Adjustment](../../../../CONTEXT.md) rows to `TARIFF_SHEET_ID` / `Master`; Carrier is the resolved [Moving Carrier](../../../../CONTEXT.md) legal name and DOT for the [Granot Carrier Code](../../../../CONTEXT.md); **not Sheet Sync**; does not write customer name, phone, email, job number, or ref; `POST /api/v1/tariff-adjustments` accepts Owner or Customer Service Bearer, leftover Employee still allowed on this route, Sales is 403; response `data` is `{ appended, tab_name, updated_range, rows }` and never includes the spreadsheet id). Distinct from leftover carrier-cell resolve: sibling `resolveCarrier.ts` (`resolveTariffCarrierCell` / `formatTariffCarrierCell` / `lookupMovingCarrierByGranotCode` — this file **asks** `resolveTariffCarrierCell` unless the caller injects `resolveCarrier`; next pass). Distinct from already-recommended Moving Carrier catalog: [moving-carriers-moving-carrier.md](moving-carriers-moving-carrier.md) (desk list / record / correct / CSV — **does not import** this file; this file does **not** create a carrier). Distinct from already-recommended seed plan: [moving-carriers-granot-carrier-code-seed.md](moving-carriers-granot-carrier-code-seed.md) (`planGranotCarrierCodeSeed` — **does not import** this file). Distinct from already-recommended Sheet Sync coordinator / outbox / drain: [sheet-sync-coordinator.md](sheet-sync-coordinator.md), [sheet-sync-outbox.md](sheet-sync-outbox.md), [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (lead / booking / cancellation write-behind — this file never enqueues a job and never stores a Mongo id). Distinct from already-recommended Reporting Sheets write: [google-sheets-google-sheets.md](google-sheets-google-sheets.md) (Forms / Calls / Booked Deals / Cancelled Deals — **does not import** this file). Distinct from already-recommended tab ensure: [google-sheets-tabs.md](google-sheets-tabs.md) (`ensureTabsAndHeaders` + `columnLetter` — this file **asks** both). Distinct from already-recommended retry: [google-sheets-retry.md](google-sheets-retry.md) (`withSheetsRetry("values.append.tariffRows")`). Distinct from leftover Timestamp paint: `googleSheets/projections/cells.ts` (`formatTimestamp` — UTC getters on the Florida-shifted Date). Distinct from leftover operational-workbook denylist: [operational-workbooks-registry.md](operational-workbooks-registry.md) (this file does **not** ask the denylist; `TARIFF_SHEET_ID` is a separate owner spreadsheet). Distinct from leftover Domain Command persist / finalize: already-recommended [domain-commands-existing-writes.md](domain-commands-existing-writes.md) (this file has no begin / complete **seam**). Distinct from Wave B pair contract: `src/validation/v1/tariffAdjustments.validation.ts` (`createTariffAdjustmentsSchema` — exactly two rows, one `Linehaul` and one `Additional Services`, shared date / zones / carrier, forbidden customer / job / spreadsheet keys). Distinct from Wave B HTTP: `src/routes/tariff-adjustments.routes.ts` (connects Mongo so sibling lookup can run; hides `spreadsheetId`; stamps omitted `effective_date`). Distinct from Wave B name book: `src/config/domain/tariff.ts` (`TARIFF_SHEET_ID` / `Master` / live headers including `"Rule "`). Distinct from Wave B Bearer gate: `src/middleware/requireApiSecret.ts` (`TARIFF_ADJUSTMENT_BEARER_ROUTE` — Owner / Customer Service / leftover Employee; Sales 403). Proof runner: `scripts/prove-tariff-append.ts` (`pnpm prove:tariff-append`) **asks** this file and reads the last two rows back. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Tariff Adjustment](../../../../CONTEXT.md), [Tariff Adjustment Submit](../../../../CONTEXT.md), [Moving Carrier](../../../../CONTEXT.md), [Granot Carrier Code](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites `docs/tariff-adjustment/tariff-adjustment-specification.md`; that folder is absent in this checkout — do not invent it. Do not add a Tariff Service file in this rename.
- Callers: **two runtime import sites plus the barrel and the folder test.** Wave B `tariff-adjustments.routes.ts` **asks** `appendTariffAdjustmentRows` (injectable as `deps.appendRows`). Operator `scripts/prove-tariff-append.ts` **asks** the same name with a live `sheets` + `spreadsheetId`. Barrel `tariff/index.ts` re-exports `appendTariffAdjustmentRows`, `toTariffSheetRow`, `TARIFF_SERVICES`, and the three types. Tests on this **interface**: `tariff.service.test.ts` (project Timestamp through Carrier; append both service rows with injected resolved Carrier and never upsert; refuse empty). Wave B `tariff-adjustments.routes.test.ts` **asks** the injected route dep, not this **interface**. Wave B `tariffAdjustments.validation.test.ts` **asks** Zod, not this file. Sibling `resolveCarrier.ts` is **asked** by this file; the folder test **asks** `resolveTariffCarrierCell` separately. `v1.service.ts` does **not** re-export this file. Already-recommended `movingCarrier.service.ts` does **not** import this file. Already-recommended Sheet Sync does **not** import this file. Not this **interface**: `resolveTariffCarrierCell`, `listMovingCarriers`, `syncFormLeadToSheets`, leftover `planJobWrites`, leftover `createOperationalWorkbookRegistry`.
- Seams callers need: public append (route / proof) vs injected `sheets` / `spreadsheetId` / `tabName` / `now` / `resolveCarrier` (tests and the proof bind Google; HTTP binds nothing and lets the default sibling resolver run); HTTP pair (exactly two shared-field service rows on Zod) vs this file’s any-non-empty list; proof / return bag includes `spreadsheetId` vs HTTP `data` that must omit it; sibling carrier-cell resolve vs this file’s unique-code map; Florida Timestamp stamp vs caller-supplied `effectiveDate`; this live `values.append` vs already-recommended Sheet Sync outbox. There is no begin / complete Domain Command **seam**. There is no Mongo write **seam**. There is no upsert-by-zone **seam**. There is no Owner-actor **seam** (Bearer lives on the route). There is no denylist **seam**.
- Split later (only if the file outgrows one sitting): this ~116-line file is one sitting if you read it as refuse an empty list — resolve each Granot Carrier Code once — paint Timestamp through Carrier — ensure Master and the live headers — `values.append` insert rows. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `append.ts` as a CRUD dump. Sibling resolve stays the next pass. Wave B Zod pair stays Wave B.

`appendTariffAdjustmentRows` / `toTariffSheetRow` are executor mechanics. The owner question is: *The Granot Forms View parsed tariff rows. Append them onto the owner's Tariff spreadsheet `Master` tab. Resolve each Granot Carrier Code to the Moving Carrier legal name and DOT before the cell is written. Stamp Florida Timestamp now. Make sure `Master` exists and its header row still matches the live book, including the trailing space on `Rule `. Then `values.append` with `INSERT_ROWS`. Never upsert a prior lane. Never write customer, phone, email, job number, or ref. This is not Sheet Sync. Mongo is not the record for these rows. The HTTP pair — one Linehaul and one Additional Services, shared date, zones, and carrier — lives on Zod, not here. This file accepts any non-empty list. The proof may see the spreadsheet id. The HTTP response must not.*

Who paints `"{name} {dot_number}"` already lives in sibling `resolveCarrier.ts`. Who lists / records Moving Carriers already lives in already-recommended `movingCarrier.service.ts`. Who ensures a reporting tab already lives in already-recommended `tabs.ts`. Who drains Sheet Sync already lives in already-recommended `runSheetSyncDrain.ts`. Who refuses a reserved workbook as a reporting destination already lives in already-recommended `operationalWorkbooks/registry.ts`. Do not pull those in.

## What this file actually does

One “append the owner's tariff adjustment rows onto Master” story in one sitting, not “a tariff CRUD service,” and not Resolve This Carrier Cell / Drain Sheet Sync / Write Forms:

1. **Append the owner's tariff adjustment rows onto Master after resolving each Granot Carrier Code** — `appendTariffAdjustmentRows(rows, options?)`. Empty `rows` throws `"Tariff adjustment write requires at least one row"` before Google or lookup. Spreadsheet id is `options.spreadsheetId ?? getTariffSheetId()` (`TARIFF_SHEET_ID`). Tab is `options.tabName ?? "Master"`. Sheets client is `options.sheets ?? getSheetsClient()`. Timestamp is `formatTimestamp(toFloridaTimestamp(options.now ?? new Date()))` — Eastern wall clock stored so UTC getters paint Florida. Carrier resolver is `options.resolveCarrier ?? resolveTariffCarrierCell`. Unique codes in row order are resolved once, then each row is painted with the resolved cell (`carrierCells[index] ?? row.carrier` only when the map missed). Then already-recommended `ensureTabsAndHeaders` with Wave B `TARIFF_SHEET_HEADERS` (live `"Rule "` trailing space). Then `withSheetsRetry("values.append.tariffRows")` → `spreadsheets.values.append` on `A:` through the last header column, `USER_ENTERED`, `INSERT_ROWS`. Return `{ spreadsheetId, tabName, appended: values.length, updatedRange, rows: values }`. This beat does **not** upsert by pickup / delivery / service. This beat does **not** enforce two rows or one of each service. This beat does **not** refuse customer or job keys — Zod already did. This beat does **not** connect Mongo — the route connects so sibling lookup can run. This beat does **not** hide `spreadsheetId` — the route must.

There is no second update or delete operation. `toTariffSheetRow` / `resolveCarrierCells` / `TARIFF_SERVICES` are beats inside story 1. `toTariffSheetRow` is exported today because the folder test treats the eight-column paint as the **interface** — that is a leak, not a second owner story. `TARIFF_SERVICES` is a leftover type copy of Wave B `TARIFF_ADJUSTMENT_SERVICES`; this file never validates it at runtime.

## Organization

Keep one file. This is the screenplay for “refuse empty — resolve each Granot Carrier Code once — paint Timestamp through Carrier — ensure Master and the live headers — `values.append` insert rows.” Sibling carrier-cell resolve already lives in `resolveCarrier.ts` (next pass). Tab ensure already lives in already-recommended `tabs.ts`. Retry already lives in already-recommended `retry.ts`. Florida stamp already lives in leftover `toFloridaTimestamp` + leftover `formatTimestamp`. Wave B pair + forbidden keys already live in `tariffAdjustments.validation.ts`. Wave B Bearer already lives on `requireApiSecret`. Do not pull those in. Do not invent a `TariffService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a Sheet Sync **adapter** so “tariff can drain.” Do not invent a Mongo **adapter** so “append can persist a Tariff Adjustment.” Do not invent an upsert **adapter** so “the same lane overwrites.” Do not invent a CRUD folder so “append / project / resolve each get a file.”

Do not move `resolveTariffCarrierCell` into this file so “one service owns tariff” — that is the next pass’s module. Do not move the Zod pair into this file so “the service matches HTTP.” Do not teach already-recommended `syncFormLeadToSheets` a Tariff tab so “one writer owns every sheet.” Do not teach already-recommended `assertWorkbookNotDenylisted` to reserve `TARIFF_SHEET_ID` in this rename. Do not split `create.ts` / `update.ts` / `delete.ts` / `append.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `appendTariffAdjustmentRows` | `appendTheOwnersTariffAdjustmentRowsOntoMaster` | Wave B route and the proof **ask** it; tests inject sheets / now / resolveCarrier |
| `toTariffSheetRow` | leftover eight-column paint leak | folder test only — unexport after the test names the append |
| `TARIFF_SERVICES` | leftover service-enum copy | barrel only — Wave B Zod already owns `Linehaul` / `Additional Services` |
| `TariffAdjustmentRow` | `TariffAdjustmentToAppend` | camelCase handoff from the route’s snake_case parse |
| `AppendTariffAdjustmentRowsResult` | `TariffAdjustmentAppendReceipt` | proof needs `spreadsheetId`; HTTP must strip it |

Keep the old names as one-line aliases until Wave B `tariff-adjustments.routes.ts`, `tariff/index.ts`, `scripts/prove-tariff-append.ts`, and `tariff.service.test.ts` migrate. Do not make callers learn `resolveCarrierCells` / `USER_ENTERED` / `INSERT_ROWS` as the domain language. Do **not** keep `toTariffSheetRow` as a public **seam** after the test moves onto append. Do **not** put these names onto leftover `v1.service.ts` so “every public write lives on the barrel.” Do **not** add `spreadsheet_id` onto the HTTP `data` so “the desk can open the sheet.” Do **not** rename persisted header `"Rule "` — the trailing space is the live Master book.

**No workflow class.** The one type that *does* earn a name is the append receipt the proof already reads back:

```ts
type TariffAdjustmentAppendReceipt = {
  spreadsheetId: string
  tabName: string
  appended: number
  updatedRange?: string
  rows: string[][]
}
```

That is the handoff from “Master accepted the insert” to “the proof can read the last rows, and HTTP can return counts without the id.” Do **not** add a Mongo `ClientSession` onto `appendTheOwnersTariffAdjustmentRowsOntoMaster` so “tariff is a Domain Command.” Do **not** add `customer` / `job_no` onto `TariffAdjustmentToAppend` so “the desk can find the job later.”

Leave `resolveTariffCarrierCell` on sibling `resolveCarrier.ts`. Leave the HTTP pair on Wave B Zod. Leave Bearer on Wave B middleware. Leave `TARIFF_SHEET_HEADERS` on Wave B `config/domain/tariff.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// append.ts
// The Granot Forms View parsed tariff rows.
// Append them onto the owner's Tariff spreadsheet Master tab.

export const TARIFF_SERVICES = ["Linehaul", "Additional Services"] as const // leftover copy

export type TariffAdjustmentToAppend = {
  effectiveDate: string
  pickupZone: string
  deliveryZone: string
  service: "Linehaul" | "Additional Services"
  rule: string
  newRule: string
  carrier: string // Granot Carrier Code until resolve paints the cell
}

export type TariffAdjustmentAppendReceipt = {
  spreadsheetId: string
  tabName: string
  appended: number
  updatedRange?: string
  rows: string[][]
}

// ── 1. Append the owner's tariff adjustment rows onto Master ─────────

export async function appendTheOwnersTariffAdjustmentRowsOntoMaster(
  rows: TariffAdjustmentToAppend[],
  options: {
    sheets?: sheets_v4.Sheets
    spreadsheetId?: string
    tabName?: string
    now?: Date
    resolveCarrier?: (granotCarrierCode: string) => Promise<string>
  } = {},
): Promise<TariffAdjustmentAppendReceipt> {
  refuseAnEmptyTariffAppend(rows)

  const spreadsheetId = options.spreadsheetId ?? getTariffSheetId()
  const tabName = options.tabName ?? TARIFF_SHEET_TAB_NAME
  const sheets = options.sheets ?? getSheetsClient()
  const timestamp = paintFloridaTimestamp(options.now ?? new Date())
  const resolveCarrier = options.resolveCarrier ?? resolveTariffCarrierCell

  const carrierCells = await resolveEachGranotCarrierCodeOnce(
    rows.map((row) => row.carrier),
    resolveCarrier,
  )
  const values = rows.map((row, index) =>
    paintTimestampThroughCarrier(
      { ...row, carrier: carrierCells[index] ?? row.carrier },
      timestamp,
    ),
  )

  await ensureTabsAndHeaders(sheets, spreadsheetId, [
    { tabName, headers: TARIFF_SHEET_HEADERS },
  ])

  const response = await withSheetsRetry("values.append.tariffRows", () =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tabName)}!A:${columnLetter(TARIFF_SHEET_HEADERS.length)}`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    }),
  )

  return {
    spreadsheetId,
    tabName,
    appended: values.length,
    updatedRange: response.data.updates?.updatedRange ?? undefined,
    rows: values,
  }
}

function refuseAnEmptyTariffAppend(rows)
function paintFloridaTimestamp(now) // toFloridaTimestamp then formatTimestamp
async function resolveEachGranotCarrierCodeOnce(codes, resolveCarrier)
function paintTimestampThroughCarrier(row, timestamp) // leftover toTariffSheetRow

export const appendTariffAdjustmentRows = appendTheOwnersTariffAdjustmentRowsOntoMaster
export const toTariffSheetRow = paintTimestampThroughCarrier
```

Read the append path out loud: *Refuse an empty list. Take the owner's Tariff spreadsheet and the Master tab. Stamp Florida Timestamp now. Resolve each Granot Carrier Code once to legal name and DOT. Paint Timestamp, Effective Date, Pickup Zone, Delivery Zone, Service, Rule, New Rule, Carrier. Ensure Master exists and the live headers still match, including the trailing space on Rule. Then values.append insert rows. Hand back the receipt. The proof may read the spreadsheet id. HTTP must not.*

That is the operation. `appendTariffAdjustmentRows` is not a create. `toTariffSheetRow` is not a second product.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The HTTP pair is not this file.** Zod requires length 2, one `Linehaul` and one `Additional Services`, and identical `effective_date` / `pickup_zone` / `delivery_zone` / `carrier`. This file only refuses empty. Do not silently pull the pair in so “the service matches the route.” The proof and a future batch can append more than two. Leave the pair on Wave B.

2. **`toTariffSheetRow` lies about the live Carrier cell.** The folder test paints `"C2C"` into the last column. The live append never writes the raw Granot Carrier Code when resolve succeeds. After rename, the test must **ask** the append with an injected resolver and assert the receipt’s Carrier cells — not a leftover helper that still accepts an unresolved code.

3. **`TARIFF_SERVICES` is a leftover copy.** Wave B already owns `TARIFF_ADJUSTMENT_SERVICES`. This file does not validate `row.service` at runtime. Do not silently drop the export in the same pass as a caller migration — unexport after the barrel stops re-exporting it. Do not make this file `z.enum` the service so “one module owns the pair.”

4. **`carrierCells[index] ?? row.carrier` hides a missed resolve.** A successful resolver returns a string. The fallback writes the raw code when the unique map missed — which today’s loop should not do. Do not silently throw on a miss so “we never write a code.” Lock the current fallback, or prove the map is total, in a later pass.

5. **Florida Timestamp is two leftovers composed.** `toFloridaTimestamp` stores Eastern wall clock on a Date; `formatTimestamp` then uses UTC getters. The folder test locks `2026-09-01T16:00:00.000Z` → `"9/1/2026 12:00:00"` (EDT). Do not silently switch to `America/New_York` formatters so “the name matches the zone.” Do not stamp `effectiveDate` here — omitted date is the route’s `formatTariffEffectiveDate`.

6. **`ensureTabsAndHeaders` will rewrite `"Rule "`.** The trailing space is the live Master header. Wave B config already matches it so the ensure does not “fix” the Owner’s book. Tariff headers are not `FORM_SHEET_HEADERS`, so leftover-width clear is a no-op. The process cache skips a second ensure in the same runtime. Do not silently trim `"Rule "` so “headers look clean.” Do not silently drop the ensure so “Master already exists.”

7. **`INSERT_ROWS` + `USER_ENTERED` is the write.** There is no lookup by zone, service, or carrier. Do not silently switch to `update` / upsert-by-Mongo-id so “we match Sheet Sync.” Do not switch to `RAW` so “formulas stop interpreting.”

8. **`spreadsheetId` on the receipt is load-bearing for the proof and forbidden on HTTP.** The route test locks that `must-not-leak` never appears in JSON. Do not silently omit `spreadsheetId` from the return so “HTTP is safer” — the proof and the inject **seam** need it. Do not silently add it to `data`.

9. **Route `connectMongo` is not this file’s write.** Sibling lookup reads `moving_carriers`. This file talks to Google. Do not silently `connectMongo` inside append so “the service can resolve without the route.” Leave connect on the route until the next pass says otherwise.

10. **Leave sibling modules alone.** `resolveTariffCarrierCell`, `ensureTabsAndHeaders`, `withSheetsRetry`, `formatTimestamp`, `toFloridaTimestamp`, `getTariffSheetId` are already the right **depth**. This file orchestrates them.

## Testing

The **interface** is the test surface: `appendTheOwnersTariffAdjustmentRowsOntoMaster`.

Today’s `tariff.service.test.ts` already names three beats. Keep them, and make the leftover paint test ask the append:

**Append onto Master**
- An empty list is refused before Google or resolve.
- Two rows (Linehaul + Additional Services) append once with `INSERT_ROWS`; Carrier cells are the injected resolved name + DOT, not `C2C`.
- Unique Granot Carrier Codes resolve once; a repeated code does not call the resolver twice.
- Florida Timestamp is stamped from `options.now` (EDT example already locked).
- `ensureTabsAndHeaders` is asked with `TARIFF_SHEET_HEADERS` including `"Rule "`.
- The receipt includes `spreadsheetId` / `tabName` / `appended` / `updatedRange` / painted `rows`.
- Omitted `spreadsheetId` / `tabName` use `getTariffSheetId()` and `Master` — only if the test can inject those without reading a real env secret. Prefer passing both, as today’s test already does.

**Not this file**
- HTTP pair, forbidden customer / job keys, omitted `effective_date`, Bearer Owner / Customer Service / leftover Employee / secret, Sales 403, and hidden `spreadsheetId` stay on Wave B route + Zod tests.
- Unknown Granot Carrier Code → 400 stays on sibling `resolveTariffCarrierCell` (next pass). Today’s folder test already **asks** that sibling directly; do not move it here so “append owns 400.”

Do **not** add a test per helper (`refuseAnEmptyTariffAppend`, `resolveEachGranotCarrierCodeOnce`, `paintTimestampThroughCarrier`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`toTariffSheetRow` stays exported only until the folder test migrates onto the append receipt.

## What I would not do

- A `TariffService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `values.append`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `sheetSync/tariff/` folder “for cleanliness.”
- Breaking the live-append **seam**: do not enqueue Sheet Sync, do not persist Mongo, do not upsert by lane.
- Treating already-recommended `syncFormLeadToSheets`, leftover `planJobWrites`, or sibling `resolveTariffCarrierCell` as this story.
- Inventing a denylist **seam** that has only one **adapter** so “Tariff can refuse Master Leads.”
- Silently “fixing” the `"Rule "` trailing space, the HTTP pair, the raw-code fallback, or Florida UTC getters while recommending a rename.
- Jumping to Wave B or unlisted `dailyOperations` while `resolveCarrier.ts` is unchecked.
- Writing a whole-folder recommendation for `tariff`.
