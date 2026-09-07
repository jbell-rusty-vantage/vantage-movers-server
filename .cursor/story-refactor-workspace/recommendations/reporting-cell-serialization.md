# Paint This Report As Literal Cells — Never A Formula, Never JSON — Then Name The Exact Quoted-Tab A1 Rectangle Those Cells Occupy — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 26 of this service — `google/cellSerialization.ts`
- Remaining in this service: `google/runMarker.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/google/cellSerialization.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Execution package mandates literal `RAW` spreadsheet writes, literal headers/cells, `formulasAllowed: false`. Knowledge never names this file, `serializeReportingRowCells`, `serializeReportingHeaderCells`, `serializeLiteralCell`, `a1Range`, `quoteSheetTitle`, `columnLetters`, or `LiteralCell` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover pack / write / verify: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (`buildReportingWriteBatches` **asks** `serializeReportingHeaderCells` / `serializeReportingRowCells`; `verifyStagingContents` **asks** header labels; `writeBoundedReportingBatch` **asks** `writeValuesRaw` and never this serialize). Distinct from already-recommended leftover claim / complete: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (**asks** `serializeReportingHeaderCells` as `expected.header_labels` and `actual.header_labels` on promote / snapshot complete — worker never **asks** row paint or `a1Range`). Distinct from already-recommended leftover gather / paint objects: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (count / load return objects; this file paints those objects into cells). Distinct from already-recommended leftover destination stamp: [`reporting-ownership-marker.md`](reporting-ownership-marker.md) (`ZZ1` JSON nest `vantage_reporting_ownership`; the Sheets adapter **asks** `quoteSheetTitle` + `ZZ1`, not `a1Range`). Distinct from leftover unvisited run stamp: `google/runMarker.ts` (`ZY1` `vantage_reporting_run`; adapter **asks** `quoteSheetTitle` the same way). Distinct from leftover unvisited Sheets write: `google/reportingSheetsAdapter.ts` (`writeValuesRaw` / `readValues` **ask** `a1Range`; `assertBoundedWrite` refuses `=`-prefixed strings this file does not; `normalizeCell` on read stringifies unknowns this file throws). Distinct from leftover test fake: `google/fakeReportingGoogle.ts` (**asks** `LiteralCell` type only). Distinct from already-recommended leftover Sheet Sync row paint: [`google-sheets-form-lead-row.md`](google-sheets-form-lead-row.md) / `googleSheets/projections/cells.ts` (Master Sheet `TRUE`/`FALSE` strings, Florida calendar dates — not ISO scalars and not this RAW contract). Distinct from leftover `google/index.ts` (barrel re-exports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `deliveryEngine.ts` (**asks** `serializeReportingHeaderCells` / `serializeReportingRowCells` on pack batches; `verifyStagingContents` **asks** header labels). Leftover `reportingWorker.ts` (**asks** `serializeReportingHeaderCells` on `ensureReportingDelivery` expected labels and promote / snapshot `actual.header_labels` — never row paint or `a1Range`). Leftover `google/reportingSheetsAdapter.ts` (**asks** `a1Range` on `writeValuesRaw` / `readValues`; `quoteSheetTitle` on `ZZ1` / `ZY1` marker ranges). Leftover `google/fakeReportingGoogle.ts` (**asks** `LiteralCell` type only). Leftover `google/index.ts` re-exports everything. Tests: leftover `reportingDelivery.test.ts` **asks** serialize header / row as write fixtures; “RAW semantics reject formula-shaped cells and require literal serialization” **asks** `serializeLiteralCell(null)` → `null`, `12` → `12`, `{ nested: true }` throws `/literal/`, `assertBoundedWrite([["=SUM(A1:A2)"]])` throws `/formula/` (adapter, not this file), `a1Range("Tab Name", 1, 1, 2, 2)` → `"'Tab Name'!A1:B2"`. Leftover `reportingDelivery.regressions.test.ts` **asks** serialize header / row as fixtures; `void serializeReportingHeaderCells` once. Leftover `reporting.test.ts` does not import this file. **No runtime caller** of `columnLetters` except `a1Range`.
- Seams callers need: paint-this-report-as-literal-cells (`serializeReportingRowCells` / `serializeReportingHeaderCells`) vs paint-one-value-or-refuse (`serializeLiteralCell`) vs name-the-exact-quoted-tab-A1-rectangle (`a1Range`) vs quote-this-tab-title-for-a-named-cell (`quoteSheetTitle`). The paint / write **seam** exists because pack **asks** serialize; `writeValuesRaw` **asks** `a1Range` and `RAW` — Google write stays in the adapter. The paint / later-formula-fence **seam** exists because `serializeLiteralCell` allows `"=SUM(A1:A2)"`; `assertBoundedWrite` refuses it at write time. The rectangle / named-marker-cell **seam** exists because data blocks **ask** `a1Range`; `ZZ1` / `ZY1` **ask** `quoteSheetTitle` plus a constant cell name. The write-blank / read-blank **seam** exists because a missing field paints `null`; adapter `normalizeCell` also treats `""` as `null` on read. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**. There is no `ZZ1` stamp **seam**.
- Split later (only if the file outgrows one sitting): this ~80-line file is one sitting if you read it as paint this report as literal cells — never a formula, never JSON — then name the exact quoted-tab A1 rectangle those cells occupy. Do **not** split into `serialize.ts` / `range.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull pack batches, `writeValuesRaw`, `assertBoundedWrite`, ownership stamp, run stamp, Sheet Sync `cells.ts`, or gather objects here so “one cell file owns the company.” If it later splits: `paintThisReportAsLiteralCells.ts` / `nameTheExactQuotedTabA1Rectangle.ts` only as later story files, never CRUD.

`serializeReportingRowCells` / `serializeReportingHeaderCells` / `serializeLiteralCell` / `a1Range` are executor mechanics. The owner question is: *When we write a report onto Google, every header and every field becomes a string, a number, a boolean, or a blank. A date becomes ISO text. A missing field becomes blank. Infinity, objects, and arrays are refused — they could look like a formula. Then, when we write or read that block, name the exact quoted-tab A1 rectangle. A single marker cell is a quoted title plus ZZ1 or ZY1, not this rectangle. Do not write Google from this file. Do not stamp ZZ1 from this file. Do not sync the Master Sheet. Do not run Analytics.*

Already-recommended leftover pack / write / verify, leftover worker complete, leftover gather objects, leftover ownership stamp already live in other **modules**. Leftover Sheets write / leftover run stamp / leftover Drive stay leftover. Do not pull those in.

## What this file actually does

Two operations of one “paint this report as literal cells — never a formula, never JSON — then name the exact quoted-tab A1 rectangle those cells occupy” story, not “a cell helper,” and not leftover Sheets write or leftover Sheet Sync row paint:

1. **Paint this report as literal cells — never a formula, never JSON** — `serializeReportingRowCells` / `serializeReportingHeaderCells` / `serializeLiteralCell`. Walk `SelectedColumn[]` in order. Header cells are `column.label` strings as given. Row cells **ask** `serializeLiteralCell(row[column.id])`. `undefined` / `null` → `null` (blank under `RAW`). String / boolean stay themselves — including a string that starts with `=`. Finite number stays a number; `NaN` / `Infinity` throw `TypeError` “Reporting cell numbers must be finite.” Valid `Date` → `toISOString()`; invalid `Date` throws “Reporting cell dates must be valid.” `bigint` → `toString()`. Object / array throw “Reporting cell values must be literal scalars.” Pack **asks** header then each row. Verify **asks** header labels only. Worker **asks** header labels on expected / actual — never row paint.

2. **Name the exact quoted-tab A1 rectangle those cells occupy** — `a1Range` / `quoteSheetTitle` / `columnLetters`. Refuse unless start / end row and column are safe integers `>= 1` and end `>=` start. Return `'Quoted Title'!A1:B2`. `quoteSheetTitle` wraps the title in single quotes and doubles an apostrophe inside the title. `columnLetters` is 1-based (`1` → `A`, `27` → `AA`, `702` → `ZZ`). `writeValuesRaw` / `readValues` **ask** `a1Range`. Marker reads **ask** `quoteSheetTitle` plus `ZZ1` / `ZY1` — they do not **ask** `a1Range`. This file does not call Google.

`LiteralCell` is the type paint already returns (`string | number | boolean | null`). It is not a third owner operation.

## Organization

Keep one file. This is the screenplay for “paint this report as literal cells — never a formula, never JSON — then name the exact quoted-tab A1 rectangle those cells occupy.” Pack batches, `writeValuesRaw`, `assertBoundedWrite`, ownership stamp, run stamp, Sheet Sync `cells.ts`, and gather objects already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingCellSerializationService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second paint **adapter** beside `serializeReportingRowCells`. Do not invent a second rectangle **adapter** beside `a1Range`. Do not invent a second Google-write **adapter** beside `writeValuesRaw`.

Do not split paint / name into CRUD files. Paint stays with name because pack **asks** serialize and write **asks** `a1Range` on the same cells. Do not start `writeValuesRaw` from this file so “one cell file owns Google.” Do not move `assertBoundedWrite` here so “formula refuse lives with paint.” Do not move `ZZ1` / `ZY1` here so “every A1 name lives together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `serializeReportingRowCells` | `paintThisRowAsLiteralCells` | leftover pack batches + leftover delivery fixtures |
| `serializeReportingHeaderCells` | `paintTheseColumnLabelsAsHeaderCells` | leftover pack + leftover verify labels + leftover worker expected / actual |
| `serializeLiteralCell` | `paintThisValueAsALiteralCellOrRefuse` | leftover RAW test; beat of leftover row paint |
| `a1Range` | `nameTheExactQuotedTabA1Rectangle` | leftover `writeValuesRaw` + leftover `readValues` |
| `quoteSheetTitle` | `quoteThisTabTitleForA1` | leftover `ZZ1` / leftover `ZY1` named cells |
| `columnLetters` | `lettersForThisColumnIndex` | beat of leftover `a1Range`; keep until leftover rectangle is the only name |
| `LiteralCell` | `ALiteralReportingCell` | leftover write bag / leftover fake cell map |

Keep the old names as one-line aliases until leftover `deliveryEngine.ts`, leftover `reportingWorker.ts`, leftover `google/reportingSheetsAdapter.ts`, leftover `reportingDelivery.test.ts`, and leftover `reportingDelivery.regressions.test.ts` migrate. Do not make leftover worker learn `paintThisRowAsLiteralCells`. Do not make leftover cleanup **ask** leftover `a1Range`. Do not persist a new leftover cell-type string in this rename.

**No class for the workflow.** The type that *does* earn a name is the scalar leftover paint already returns:

```ts
type ALiteralReportingCell = string | number | boolean | null
```

That is the handoff from “canonical gather painted objects” to “Sheets may write RAW.” Do **not** put leftover `ZZ1` JSON on this type. Do **not** put leftover A1 range on this type. Do **not** put leftover Sheet Sync `TRUE` / `FALSE` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cellSerialization.ts
// We are about to write a report onto Google.
// Every header and every field becomes a string,
// a number, a boolean, or a blank.
// A date becomes ISO text. A missing field becomes blank.
// Infinity, objects, and arrays are refused —
// they could look like a formula.
// Then name the exact quoted-tab A1 rectangle.
// A single marker cell is a quoted title plus ZZ1 or ZY1,
// not this rectangle.
// Do not write Google. Do not stamp ZZ1.
// Do not sync the Master Sheet.

// -- 1. Paint this report as literal cells ----------------

export function paintThisRowAsLiteralCells(row, columns)
  // walk columns in order
  // ask paintThisValueAsALiteralCellOrRefuse(row[column.id])

export const serializeReportingRowCells = paintThisRowAsLiteralCells

export function paintTheseColumnLabelsAsHeaderCells(columns)
  // column.label as given — no formula check

export const serializeReportingHeaderCells = paintTheseColumnLabelsAsHeaderCells

export function paintThisValueAsALiteralCellOrRefuse(value)
  // undefined / null → null
  // string / boolean stay themselves (including "=")
  // finite number stays a number; NaN / Infinity throw
  // valid Date → toISOString(); invalid Date throws
  // bigint → toString()
  // object / array throw “literal scalars”

export const serializeLiteralCell = paintThisValueAsALiteralCellOrRefuse

// -- 2. Name the exact A1 rectangle -----------------------

export function nameTheExactQuotedTabA1Rectangle(sheetTitle, startRow, startCol, endRow, endCol)
  // refuse unless 1-based safe integers and end >= start
  // return 'Quoted Title'!A1:B2

export const a1Range = nameTheExactQuotedTabA1Rectangle

export function quoteThisTabTitleForA1(title)
  // wrap in single quotes; double an apostrophe inside

export const quoteSheetTitle = quoteThisTabTitleForA1

export function lettersForThisColumnIndex(index)
  // 1 → A, 27 → AA, 702 → ZZ

export const columnLetters = lettersForThisColumnIndex
```

Read the paint path out loud: *The worker already gathered objects. Pack asks `paintTheseColumnLabelsAsHeaderCells`, then `paintThisRowAsLiteralCells` for each row. A missing field is blank. A date is ISO text. An object throws. This file never called Google. Later, `assertBoundedWrite` may still refuse a string that starts with `=`.*

Read the name path out loud: *`writeValuesRaw` already has the painted cells. It asks `nameTheExactQuotedTabA1Rectangle` for the block. Marker reads ask `quoteThisTabTitleForA1` plus ZZ1 or ZY1. This file never saw a run id.*

That is the operation. `serializeReportingRowCells` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **Formula-shaped strings pass paint and fail write.** `serializeLiteralCell("=SUM(A1:A2)")` returns the string. `assertBoundedWrite` throws `/formula/`. The RAW test locks both. Do not silently refuse `=` here so “paint owns the fence.”

2. **Empty string is not blank on write.** Paint keeps `""`. Adapter `normalizeCell` treats `""` as `null` on read. Do not silently paint `""` as `null` so “write and read agree.”

3. **Missing column is blank, not refuse.** `row[column.id]` undefined → `null`. Do not silently throw so “every selected column must be present.”

4. **Date is ISO, not Eastern calendar.** Sheet Sync `cells.ts` uses Florida calendar / `TRUE`/`FALSE` strings. Do not silently switch to those formats so “one cell helper owns the company.”

5. **Boolean stays boolean.** Sheet Sync writes `"TRUE"` / `"FALSE"`. Do not silently stringify booleans.

6. **Header labels have no formula check.** `column.label` starting with `=` would pass paint and fail `assertBoundedWrite`. Do not silently strip or refuse labels here.

7. **`columnLetters(702)` is untested.** Ownership uses `ZZ1`. Tests only lock `A1:B2`. Do not silently change 1-based math.

8. **`a1Range` refuses zero and inverted bounds.** `end < start` throws. There is no single-cell helper. Marker cells stay `quoteSheetTitle` + constant. Do not silently teach `a1Range` to name `ZZ1`.

9. **Read coerce vs write refuse.** Adapter `normalizeCell` stringifies unknown read values. This file throws on write objects. Do not silently merge those rules.

10. **Leave sibling modules alone.** Pack / write / verify stay in leftover `deliveryEngine.ts`. Sheets write stays in leftover `google/reportingSheetsAdapter.ts`. Ownership stamp stays leftover. Run stamp stays leftover unvisited. Sheet Sync `cells.ts` stays Sheet Sync. Do not open unvisited `google/runMarker.ts` this pass.

## Testing

The **interface** is the test surface. Existing asserts: `serializeLiteralCell(null)` is `null`; `12` is `12`; object throws `/literal/`; `assertBoundedWrite([["=SUM(A1:A2)"]])` throws `/formula/` on the adapter; `a1Range("Tab Name", 1, 1, 2, 2)` is `"'Tab Name'!A1:B2"`. Header / row serialize are fixtures for leftover write / leftover verify. No Date / Infinity / bigint / apostrophe-title / `ZZ` proof is locked. No “this file never writes Google” proof is locked.

Add proofs at the new names (later implementer; not this Cloud pass):

- paint row: columns stay in order; missing field → `null`
- paint header: labels stay in order as given
- paint one: `null` / `undefined` → `null`; finite number; boolean; valid Date → ISO; invalid Date throws; `Infinity` throws; bigint → string; object / array throw
- formula seam: `"=SUM(A1:A2)"` still paints; `assertBoundedWrite` still refuses — do not merge
- name rectangle: quoted title; doubled apostrophe (`O'Brien` → `'O''Brien'`); `A1:B2`; refuse zero / inverted bounds
- letters: `1` → `A`; `27` → `AA`; `702` → `ZZ`
- never write Google: `values.update` / `batchUpdate` are not called from this file
- never Sheet Sync format: no `"TRUE"` / Florida calendar from this file
- never leftover run: `vantage_reporting_run` is not on this paint

Do not add helper-unit tests for `lettersForThisColumnIndex` beyond the rectangle proofs. Do not boot leftover live Google, leftover destination desk, leftover promote, or leftover janitor. Do not replace leftover `assertBoundedWrite` tests with this file so “one test owns both stories.” Do not assert leftover Sheets `writeValuesRaw` categories as if they were leftover `paintThisRowAsLiteralCells`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, leftover `src/models/ReportingDestination.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingCellSerializationService` class or a `create.ts` / `update.ts` / `delete.ts` / `serialize.ts` / `range.ts` split.
- I would not invent a second leftover Google-write **adapter** beside leftover `writeValuesRaw`.
- I would not pull leftover pack batches, leftover `assertBoundedWrite`, leftover ownership stamp, leftover run stamp, leftover Sheet Sync `cells.ts`, or leftover gather objects into this file.
- I would not silently merge leftover `=` refuse into leftover paint.
- I would not silently paint leftover `""` as leftover `null`.
- I would not silently teach leftover `a1Range` to name leftover `ZZ1`.
- I would not open unvisited leftover `google/runMarker.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
