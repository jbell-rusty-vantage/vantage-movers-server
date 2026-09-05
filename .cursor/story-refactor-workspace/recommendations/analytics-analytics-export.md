# Flatten This Named Analytics Report To A Spreadsheet — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 13 of this service — `analyticsExport.service.ts`
- Remaining in this service: `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/analyticsExport.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (CSV export: leftover dispatcher then flatten. Source-company, lead-source, and booking-cancellation-ratio emit **leaves (including zeros) or a childless company, never both**. Leaf labels use catalog `owner_label`. Combined funnel CSV does **not** also emit the parent total. Filename: `analytics-{report}-{database_scope}.csv`. HTTP: `GET /api/v1/admin/exports/analytics/:report.csv`. Role line on that Service is the leftover dispatcher, not this file — this file **asks** leftover `getAnalyticsReport`, then leftover `toCsv`). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — this file **asks** it; Wave B JSON `GET /api/v1/admin/analytics/:report` does **not** import this file). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (all-time + live last week — **does not** import this file; there is no Overview spreadsheet). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (`{ totals }` — leftover columns drop `active_bookings`; this file does **not** recount). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (`{ items }` by period — leftover columns omit `granularity`). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (nests catalog children on `items` — this file **asks** leftover flatten of those children). Distinct from already-recommended Agent ranking: [`analytics-agent-performance.md`](analytics-agent-performance.md) (`{ items }` fallthrough). Distinct from already-recommended Cancellation rating: [`analytics-cancellation-analytics.md`](analytics-cancellation-analytics.md) (ratio prepends leftover `source_company: "overall"` then leftover flatten of `by_source_company`; reasons keep leftover `{ items }`; leftover columns omit `booked_to_cancelled_ratio`). Distinct from already-recommended place ranking: [`analytics-geographic-analytics.md`](analytics-geographic-analytics.md) (local / states leftover `{ items }`; lanes prepend leftover `lead_type: "form"` / `"call"`). Distinct from already-recommended Receiver-Agent ranking: [`analytics-receiver-agent-performance.md`](analytics-receiver-agent-performance.md) (`{ items }` fallthrough; historical empty card becomes a header-only spreadsheet). Distinct from already-recommended texted-Lead booking rate: [`analytics-sms-conversion.md`](analytics-sms-conversion.md) (six leftover columns on leftover `{ items }`; historical empty card is header-only). Distinct from already-recommended Agent Sales: [`analytics-agent-sales-report.md`](analytics-agent-sales-report.md) (dedicated `exportAgentSalesReportCsv` + TOTAL row — **does not** import this file; Wave B `GET /api/v1/admin/exports/reports/agent-sales.csv`). Distinct from already-recommended Lead Cost: [`analytics-lead-cost.md`](analytics-lead-cost.md) (Overview card only — **is not** on leftover `analyticsReportSchema`; there is no Lead Cost spreadsheet). Distinct from leftover booked-prefix / lead match: later `analyticsFilters.ts` (this file never **asks** it — leftover dispatcher already did). Distinct from leftover combined add: later `analyticsMerge.ts` (leftover dispatcher **asks** it before this file sees `data`). Distinct from leftover catalog nest / zero seed: later `sourceHierarchy.ts` (named reports nest first; this file only flattens). Distinct from already-recommended Admin Dashboard desk spreadsheet: [`admin-export.md`](admin-export.md) (`exportAdminResourceCsv` — Wave B `GET /api/v1/admin/exports/{resource}.csv` — **does not** import this file). Distinct from leftover `src/utils/csv.ts` (`toCsv` / quote / CRLF). Distinct from leftover Observability / Reporting destination CSVs. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Source Company / CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an analytics-export Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleAnalyticsExport` — `GET /api/v1/admin/exports/analytics/:report.csv`; leftover `analyticsReportSchema` on `req.params.report`; leftover `analyticsQuerySchema` on query; `Content-Type: text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="{filename}"`). Barrel: `analytics/index.ts` (`exportAnalyticsReportCsv` only — **does not** export `rowsForCsv`). Already-recommended dispatcher / Overview / Agent Sales / leftover named reports / leftover filters / leftover merge / leftover nest do **not** import this file. Tests: `analytics.service.test.ts` (**asks** `exportAnalyticsReportCsv("source-company-performance")` for filename + leftover columns + two catalog leaves; **asks** `rowsForCsv("source-company-performance")` for leftover leaves-or-childless; **asks** `rowsForCsv("source-company-funnel")` so combined children do not also emit the parent total). No `analyticsExport.service.test.ts`.
- Seams callers need: flatten-this-named-report (`exportAnalyticsReportCsv`: leftover dispatcher, then leftover `toCsv`, filename + csv body) vs choose-the-rows-Excel-can-open (`rowsForCsv`: the same flatten without re-running Mongo — existing tests **ask** this). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — leftover dispatcher already picked live / historical / combined. There is no combined-add **seam**. There is no nest **seam**. There is no booked-prefix **seam**. There is no desk **seam**. There is no Agent-Sales **seam**. There is no Overview **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~216-line file is one sitting if you read it as flatten this named Analytics report to a spreadsheet — re-run the leftover dispatcher, pick the leftover columns, emit leaves or a childless company, never the parent plus the children. Do **not** split `exportAnalyticsReportCsv` and `rowsForCsv` into `export.ts` / `rows.ts` on this pass — they are one download, not a CRUD folder. Do **not** split one file per leftover report name so “each chart owns a spreadsheet.” Do **not** pull leftover dispatcher / nest / merge here so “export owns the math.” If it later splits: `flattenThisNamedAnalyticsReportToASpreadsheet.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts` / `export.ts`

`exportAnalyticsReportCsv` / `rowsForCsv` / `flattenSourceHierarchyRows` are executor mechanics. The owner question is: *I already ran a named Analytics report. Give me a spreadsheet of those same numbers. Re-run the leftover dispatcher with the same chips. Pick only the columns we chose for this report name. Summary is one totals row. Source Company scorecards and the funnel emit catalog leaves — including quiet zeros — or a childless company, never the parent plus the children. Booking-cancellation-ratio starts with an overall row, then the same leaf rule. Geographic lanes are form rows, then call rows. Everything else is the leftover items list. Combined already added the two databases — do not also emit the parent total. Name the file after the report and which database I asked for. This is not the Admin Dashboard desk. This is not Agent Sales. This is not the home Overview. This is not Lead Cost. This is not Sheet Sync.*

Already-recommended dispatcher / Overview / Summary / Revenue Trend / Source Company scorecards / Agent ranking / Cancellation rating / place ranking / Receiver-Agent ranking / texted-Lead booking rate / Agent Sales / Lead Cost, leftover filters / merge / nest, leftover `toCsv`, already-recommended Admin Dashboard desk spreadsheet, leftover Observability / Reporting CSVs, leftover scope pick, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Two exports of one “flatten this named Analytics report to a spreadsheet” story, not “an analytics CRUD export service,” and not the leftover dispatcher:

1. **Flatten this named Analytics report to a spreadsheet** — `exportAnalyticsReportCsv`. Wave B attachment. **Ask** leftover `getAnalyticsReport(report, query)` (live / historical / combined envelope already stamped). Hand leftover `payload.data` to `rowsForCsv`. Hand those rows and leftover `CSV_COLUMNS[report]` to leftover `toCsv`. Filename is `analytics-${report}-${query.database_scope}.csv`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never **asks** leftover `concreteScopes` / leftover `getAdminModels` / leftover `mergeAnalyticsPayload` / leftover `nestObservedSourceRows` / leftover `bookedLeadPrefix`, and never talks to leftover Agent Sales / leftover Overview / leftover Lead Cost.

2. **Choose the rows Excel can open for this report shape** — `rowsForCsv`. Existing tests **ask** this without Mongo. `summary` → one leftover `objectValue(data.totals)` row. `booking-cancellation-ratio` → `{ source_company: "overall", ...overall }` plus leftover flatten of `by_source_company`. `geographic-lanes` → leftover `form_lanes` tagged `lead_type: "form"`, then leftover `call_lanes` tagged `lead_type: "call"`. `source-company-performance` / `source-company-funnel` / `lead-source-performance` → leftover flatten of `items`. Everything else → leftover `arrayValue(data.items)` as-is (`revenue-trend`, leftover Agent ranking, leftover cancellation reasons, leftover local / states, leftover Receiver-Agent three, leftover texted-Lead booking rate). Missing / non-array `items` becomes `[]`. Missing / non-object `totals` becomes `{}`.

There is no third owner operation. `flattenSourceHierarchyRows` is the leaf-or-childless beat, not a public **seam**. Do not export leftover `CSV_COLUMNS` as a public **seam**. Combined add of two JSON payloads does not exist here — leftover dispatcher already merged. Do not export leftover `getAnalyticsReport` from this file as if this story owned the switch. Do not export leftover `toCsv` from this file as if this story owned quoting.

## Organization

Keep one file. This is the screenplay for “flatten this named Analytics report to a spreadsheet.” Named-report dispatch, combined add, catalog nest, chip match, home Overview, Agent Sales, Lead Cost, Admin Dashboard desk columns, and leftover CSV escaping already live in deeper **modules**. Do not pull those in. Do not invent an `AnalyticsExportService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a dispatcher **adapter** beside leftover `getAnalyticsReport`. Do not invent a nest **adapter** beside leftover `nestObservedSourceRows`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a CSV **adapter** beside leftover `toCsv`.

Do not split this by leftover report name. Summary’s one totals row and Source Company leaves are beats of one download. Do not move this into `admin/` so “the desk folder owns every spreadsheet.” Do not add leftover Overview / leftover Agent Sales / leftover Lead Cost cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `exportAnalyticsReportCsv` | `flattenThisNamedAnalyticsReportToASpreadsheet` | Wave B attachment; leftover dispatcher then leftover `toCsv` |
| `rowsForCsv` | `chooseTheSpreadsheetRowsForThisNamedReport` | existing tests **ask** the flatten without re-running Mongo |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, `analytics/index.ts`, and `analytics.service.test.ts` migrate. Do not make callers learn `CSV_COLUMNS` / `flattenSourceHierarchyRows` / `toCsv` as the domain language. Do not export `rowsForCsv` from `analytics/index.ts` so Wave B can skip leftover `exportAnalyticsReportCsv`. Do not hide the download behind leftover `getAnalyticsReport` so “every chart returns CSV.”

**No class for the workflow.** The type that *does* earn a name is the attachment Wave B already sends:

```ts
type NamedAnalyticsSpreadsheet = {
  filename: string // `analytics-{report}-{database_scope}.csv`
  csv: string      // leftover toCsv: header + CRLF rows, only leftover CSV_COLUMNS[report]
}
```

That is the handoff from “the leftover dispatcher already ran the named report” to “the browser downloads a file.” Combined stays one file; leftover `query.database_scope` is already `combined`. A quiet catalog child is a leaf row, not omitted. A parent that still has children is not a row.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// analyticsExport.service.ts
// The owner already ran a named Analytics report.
// Give them a spreadsheet of those same numbers.
// Re-run the leftover dispatcher with the same chips.
// Pick only the columns we chose for this report name.
// Summary is one totals row.
// Source Company scorecards and the funnel emit catalog leaves —
// including quiet zeros — or a childless company,
// never the parent plus the children.
// Booking-cancellation-ratio starts with an overall row,
// then the same leaf rule.
// Geographic lanes are form rows, then call rows.
// Everything else is the leftover items list.
// Combined already added the two databases —
// do not also emit the parent total.
// Name the file after the report and which database was asked for.
// This file does not pick live versus historical.
// This file does not add the two collections.
// This file does not nest Source Companies.
// This file does not walk the Admin Dashboard desk.
// This file does not flatten Agent Sales or Lead Cost.
// This file does not write Sheet Sync.

// ── 1. Flatten this named Analytics report to a spreadsheet ─

export async function flattenThisNamedAnalyticsReportToASpreadsheet(report, query)

async function rerunTheNamedReport(report, query)     // leftover getAnalyticsReport
function nameTheSpreadsheetFile(report, databaseScope)
function chooseTheSpreadsheetColumnsForThisReport(report)

// ── 2. Choose the rows Excel can open for this report shape ─

export function chooseTheSpreadsheetRowsForThisNamedReport(report, data)

function takeTheSummaryTotalsAsOneRow(data)           // leftover objectValue(data.totals)
function prependAnOverallRowThenFlattenTheRatio(data) // overall + leftover by_source_company
function tagFormLanesThenCallLanes(data)              // leftover lead_type form, then call
function emitLeavesOrAChildlessCompanyNeverBoth(rows) // leftover flattenSourceHierarchyRows
function takeTheItemsListAsIs(data)                   // leftover arrayValue(data.items)
```

Read the download path out loud: *The owner asked for a spreadsheet of a named Analytics report. Ask the leftover dispatcher to run that report against live, historical, or both. Take the leftover data bag. If this is Summary, emit one totals row. If this is booking-cancellation-ratio, emit an overall row, then catalog leaves or a childless company. If this is geographic lanes, emit form lanes then call lanes. If this is a Source Company scorecard, the funnel, or lead-source performance, emit leaves or a childless company — never the parent plus the children. Otherwise emit the leftover items list. Hand those rows and the leftover column list to leftover toCsv. Name the file after the report and the leftover database scope. Combined, Agent Sales, the home Overview, Lead Cost, and the Admin Dashboard desk live next door.*

That is the operation. `exportAnalyticsReportCsv` is not a different story. `rowsForCsv` is not a second download. Combined parent-skip is not a leftover `database_scope` chip this file reads to refuse historical.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`exportAnalyticsReportCsv` is an executor name.** The owner asked to flatten this named Analytics report to a spreadsheet. The name should say that. Do not teach Wave B `exportAnalyticsReportCsv` as if this file owned leftover `getAnalyticsReport`.

2. **This file re-runs the leftover dispatcher.** It does not accept a cached JSON envelope. Wave B always **asks** this with leftover `report` + leftover chips. Do not add a `payload` argument so “the JSON route can skip Mongo,” and do not import leftover named-report siblings so “export can skip the switch.”

3. **Leaves or a childless company, never both.** Leftover `flattenSourceHierarchyRows` drops the parent when `granularities.length > 0` and copies leftover `source_company` / leftover `source_company_label` onto each leaf. A childless company (`granularities: []`) is the parent row with leftover `granularities` stripped. Knowledge already names this. Do not also emit the parent so “Excel can subtotal,” and do not drop childless companies so “only nested sources download.”

4. **Combined funnel must not double-count.** The tested combined bag has parent `total_leads` 15 and children 4 + 6. Leftover flatten sums to 10. Knowledge: combined funnel CSV does not also emit the parent total. Do not emit parent plus children on leftover `database_scope === "combined"` only so “live still shows the rollup,” and do not change leftover nest so “parents never carry a total.”

5. **Quiet catalog zeros stay as leaves.** Leftover nest already seeded them. This file does not re-seed. A zero leaf is a row. Do not drop `bookings === 0` so “the spreadsheet only shows spenders,” and do not re-**ask** leftover `nestObservedSourceRows` so “export owns the catalog.”

6. **Leaf labels are leftover nest’s `owner_label`.** This file copies leftover `source_company_label` onto the leaf and otherwise keeps the child’s leftover `source_granularity_label` / leftover `channel`. Do not reload leftover Filter Catalog here so “export can relabel,” and do not switch leftover columns to leftover `crm_label`.

7. **`booking-cancellation-ratio` prepends leftover `source_company: "overall"`.** Then the same leaf rule on leftover `by_source_company`. Leftover columns omit leftover `booked_to_cancelled_ratio` (already-recommended Cancellation rating named that). Do not flatten leftover `{ items }` so “every report is items,” and do not add leftover `booked_to_cancelled_ratio` in this rename.

8. **`geographic-lanes` is form then call, not one leftover `{ items }` list.** Leftover `lead_type` is a flatten tag (`"form"` / `"call"`), not the leftover query chip. Do not fold the two lists so “lanes look like pickup-state,” and do not **ask** leftover `leadMatchForQuery` here so “export can drop one collection.”

9. **`summary` is one leftover `totals` row.** Leftover `CSV_COLUMNS.summary` lists counts, money, and both rates — not leftover `active_bookings` (already-recommended Summary named that). Missing totals become `{}` (header + blank cells). Do not emit leftover `{ items }` so “summary matches every other report,” and do not “fix” leftover `active_bookings` onto the header in this rename.

10. **Fallthrough is leftover `data.items`.** Revenue Trend, leftover Agent ranking, leftover cancellation reasons, leftover local / states, leftover Receiver-Agent three, leftover texted-Lead booking rate. Historical Receiver-Agent / SMS leftover empty cards become a header-only spreadsheet — leftover warning metadata is not a column. Do not emit leftover `metadata` so “the CSV explains historical skip,” and do not refuse historical inside this file so “export owns the live fence.”

11. **Leftover `CSV_COLUMNS` is keyed by leftover `AnalyticsReport`.** Adding a leftover enum member without a column list is a type error. Do not add leftover `"lead-cost"` / leftover `"overview"` / leftover `"agent-sales"` here so “one flatten owns every card,” and do not delete a leftover report’s columns so “the JSON is enough.”

12. **Filename is leftover `analytics-{report}-{database_scope}.csv`.** Combined stays `combined`. Agent Sales names leftover `agent-sales-{from}_{to}.csv` next door. Do not slice leftover `from`/`to` onto this filename so “every download has dates,” and do not point leftover `GET /api/v1/admin/exports/reports/agent-sales.csv` at this file.

13. **Missing bags become empty rows, not thrown errors.** Leftover `arrayValue` / leftover `objectValue` swallow non-arrays / non-objects. Leftover `toCsv` still emits the header and a trailing CRLF. Do not throw so “a bad payload 500s the download,” and do not skip leftover `toCsv` when `rows.length === 0` so “empty reports have no header.”

14. **This file never asks leftover `bookedLeadPrefix` / leftover `leadMatchForQuery` / leftover `nestObservedSourceRows` / leftover `mergeAnalyticsPayload`.** Chips and combined add already happened next door. Do not import leftover filters here so “export can re-match,” and do not **ask** leftover merge here so “export can add the two collections again.”

15. **Already-recommended Agent Sales owns its spreadsheet.** Dedicated leftover `exportAgentSalesReportCsv` + TOTAL row. Do not route that path through leftover `exportAnalyticsReportCsv`, and do not add leftover Agent Sales columns to leftover `CSV_COLUMNS`.

16. **Already-recommended Admin Dashboard desk spreadsheet is not this story.** Leftover `exportAdminResourceCsv` walks leftover desk rows. Do not import it here so “one flatten owns every download,” and do not point leftover `GET /api/v1/admin/exports/{resource}.csv` at this file.

17. **There is no Overview spreadsheet and no Lead Cost spreadsheet.** Leftover `overviewQuerySchema` / leftover `getLeadCost` never enter leftover `analyticsReportSchema`. Do not add those strings here, and do not copy leftover Agent Sales’ dedicated export onto leftover Overview.

18. **`rowsForCsv` is already a public flatten seam.** Tests **ask** it without Mongo. Keep that. Do not hide it so “only the attachment is testable,” and do not export it from `analytics/index.ts` so Wave B can skip leftover `exportAnalyticsReportCsv`.

19. **Tests prove Source Company leaves and combined funnel parent-skip, not every leftover shape.** Leftover `exportAnalyticsReportCsv` is **asked** once (`source-company-performance`). Leftover `rowsForCsv` is **asked** for leftover performance leaves-or-childless and leftover funnel combined. Summary totals, leftover overall row, leftover form-then-call lanes, leftover items fallthrough, leftover empty historical cards, leftover `lead-source-performance`, and leftover blank totals are unproven at this **interface**.

20. **Leave sibling modules alone.** Leftover `toCsv` stays in leftover `utils/csv`. Leftover dispatcher stays in already-recommended `analytics.service.ts`. Leftover nest stays in later `sourceHierarchy.ts`. Leftover merge stays in later `analyticsMerge.ts`. Leftover filters stay in later `analyticsFilters.ts`. Named reports, leftover Overview, leftover Agent Sales, leftover Lead Cost, and already-recommended desk spreadsheet stay in their files. This file orchestrates leftover dispatcher → leftover shape pick → leftover leaf-or-childless → leftover `toCsv`.

21. **Do not treat leftover Observability / Reporting destination CSVs as this story.** Those write other spreadsheets. Do not import them here, and do not teach this file leftover event / run columns.

22. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file leftover `toCsv`.

## Testing

The **interface** is the test surface: `flattenThisNamedAnalyticsReportToASpreadsheet` (`exportAnalyticsReportCsv`) and `chooseTheSpreadsheetRowsForThisNamedReport` (`rowsForCsv`). The `{ filename, csv }` attachment is part of that **interface**.

Today `analytics.service.test.ts` leftover-asks `exportAnalyticsReportCsv` once and leftover-asks `rowsForCsv` twice. Keep those, and fill the gaps the story names make obvious:

**Flatten this named Analytics report to a spreadsheet**
- **Asks** leftover `getAnalyticsReport` with the same leftover `report` + leftover chips — does **not** import leftover named-report siblings, leftover `concreteScopes`, leftover `getAdminModels`, leftover `mergeAnalyticsPayload`, leftover `nestObservedSourceRows`, leftover `bookedLeadPrefix`, leftover `leadMatchForQuery`.
- Filename is `analytics-{report}-{database_scope}.csv` (leftover combined stays `combined`).
- Leftover `toCsv` emits leftover `CSV_COLUMNS[report]` as the header and CRLF rows.
- `source-company-performance` leftover live download emits two catalog leaves (form + call), leftover bookings sum 5, leftover header starts `source_company,source_company_label,source_granularity_key,source_granularity_label,channel`.
- Does **not** mutate Mongo or enqueue Sheet Sync.
- Does **not** call leftover `exportAgentSalesReportCsv` / leftover `getOverviewReport` / leftover `getLeadCost` / leftover `exportAdminResourceCsv`.

**Choose the rows Excel can open for this report shape**
- `source-company-performance` leftover flatten: company with leftover children → only leftover leaves; leftover childless company → one parent row; leftover `granularities` is never a leftover CSV field; leftover parent leftover `bookings` 5 equals leftover child leftover 2 + 3.
- `source-company-funnel` leftover combined bag: leftover parent leftover `total_leads` 15 + leftover children 4 + 6 → leftover two rows summing 10 (does **not** also emit 15).
- `lead-source-performance` uses the same leftover leaf-or-childless rule on leftover `items`.
- `booking-cancellation-ratio` prepends leftover `source_company: "overall"` from leftover `data.overall`, then leftover flatten of leftover `by_source_company`.
- `geographic-lanes` emits leftover `form_lanes` tagged leftover `lead_type: "form"`, then leftover `call_lanes` tagged leftover `lead_type: "call"`.
- `summary` emits one leftover `totals` row. Leftover header lists leftover counts / money / both rates and does **not** include leftover `active_bookings`.
- Fallthrough leftover reports emit leftover `data.items` as-is.
- Missing leftover `items` / leftover `form_lanes` / leftover `by_source_company` become leftover `[]`. Missing leftover `totals` / leftover `overall` become leftover `{}`.
- Historical leftover Receiver-Agent / leftover SMS empty leftover `{ items: [] }` is a header-only spreadsheet — leftover `metadata` is not a leftover column.

**Not this file**
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` envelope — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover nest seed / company-only internals beyond what leftover flatten returns — that is a later sitting (`sourceHierarchy.ts`).
- Do **not** assert leftover merge parent/leaf math — that is a later sitting (`analyticsMerge.ts`).
- Do **not** assert leftover booked-prefix employee-snapshot order — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert leftover Agent Sales TOTAL row — that is already-recommended `agentSalesReport.service.ts`.
- Do **not** assert leftover Overview live-only leftover `lead_cost` — that is already-recommended `overview.service.ts`.
- Do **not** assert leftover Admin Dashboard desk columns — that is already-recommended `adminExport.service.ts`.
- Do **not** assert leftover `toCsv` quote / CRLF internals beyond the leftover attachment string — that is leftover `utils/csv.ts`.
- Do **not** assert leftover Receiver-Agent / leftover SMS ranking math — those are already-recommended named reports.

Do **not** add a test per helper (`emitLeavesOrAChildlessCompanyNeverBoth`, `tagFormLanesThenCallLanes`, `takeTheSummaryTotalsAsOneRow`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover dispatcher scope pick, leftover nest seed math, leftover merge parent/leaf math, leftover Agent Sales TOTAL, leftover Overview combined `null`, leftover Lead Cost stored CPL, leftover Admin Dashboard desk flatten, or RingCentral reconcile here.

## What I would not do

- An `AnalyticsExportService` class with `export` / `flatten` / `toCsv`.
- Thirty two-line functions that only wrap leftover `arrayValue`.
- Moving this into a CRUD folder, or into `admin/` / `reporting/` “because those also download spreadsheets.”
- Splitting one file per leftover report name, or `export.ts` / `rows.ts`.
- Pulling leftover dispatcher / nest / merge / filters / Overview / Agent Sales / Lead Cost / desk spreadsheet into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Adding leftover `"lead-cost"` / leftover `"overview"` / leftover `"agent-sales"` to leftover `CSV_COLUMNS` or leftover `analyticsReportSchema`.
- Routing leftover `GET /api/v1/admin/exports/reports/agent-sales.csv` or leftover `GET /api/v1/admin/exports/{resource}.csv` through leftover `exportAnalyticsReportCsv`.
- Exporting `rowsForCsv` from `analytics/index.ts` so Wave B can skip leftover `exportAnalyticsReportCsv`.
- Emitting leftover parent plus leftover children so “Excel can subtotal.”
- Dropping leftover zero leaves so “the spreadsheet only shows spenders.”
- Emitting leftover `metadata` so “the CSV explains historical skip.”
- Adding leftover `active_bookings` or leftover `booked_to_cancelled_ratio` to leftover headers in this rename.
- Importing leftover `nestObservedSourceRows` so “export owns the catalog.”
- Importing leftover `toCsv` into this file as a re-implemented quoter.
- Treating leftover Agent Sales, leftover Overview, leftover Lead Cost, leftover Admin Dashboard desk, leftover Observability / Reporting CSVs, leftover nest, leftover merge, leftover filters, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
