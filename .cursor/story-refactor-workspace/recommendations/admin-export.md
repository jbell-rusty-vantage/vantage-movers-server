# Download The Admin Dashboard Desk As A Spreadsheet — operational story

- Status: recommended
- Service: `admin` (Wave A, in-progress)
- Pass: 2 of this service — `adminExport.service.ts`
- Remaining in this service: `adminSearch.service.ts`, `adminFacets.service.ts`, `filterCatalog.ts`, `agentBrowseMetrics.service.ts`, `adminSheetSync.service.ts`
- Target: `src/services/admin/adminExport.service.ts`
- Knowledge: [`docs/knowledge/services/admin-search.md`](../../../docs/knowledge/services/admin-search.md) (Related table: this file is “CSV export.” That Service’s primary code is typeahead `adminSearch.service.ts`. Already-recommended [`admin-browse.md`](admin-browse.md) already named this file as the flatten sitting: the desk walks rows; this file chooses columns). Distinct from Analytics / Agent-sales / Observability CSVs: Wave B `GET /api/v1/admin/exports/analytics/:report.csv`, `GET /api/v1/admin/exports/reports/agent-sales.csv`, `GET /api/v1/admin/exports/observability/{events,incidents,reports/:id}.csv` — those do **not** import this file. Distinct from already-recommended Sheet Sync / Google Sheets row projections: a download here is a one-shot spreadsheet of the desk, not a Master-tab write. Distinct from leftover `src/utils/csv.ts` (`toCsv` / quote / CRLF). This checkout’s `CONTEXT.md` does not define Admin Dashboard / Duplicate Lead / Form Lead — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an export Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleAdminExport` — `GET /api/v1/admin/exports/{form-leads|call-leads|booked-leads|cancelled-leads|customers|agents}.csv`; same `adminBrowseQuerySchema` as the desk; `Content-Type: text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="{filename}"`). Barrel: `admin/index.ts`. This file **asks** already-recommended `exportAdminResourceRows` (do not import `browseAdminResource`). Tests: `admin.service.test.ts` (`admin CSV export uses browse rows and escapes CSV body` — Form filename, header start, quoted name). Sibling `csv helper emits text/csv-compatible header and rows` tests leftover `toCsv` directly, not this **interface**. Analytics / reporting / observability export handlers do **not** import this file.
- Seams callers need: download-the-desk-as-a-spreadsheet (`exportAdminResourceCsv`: filename + csv body). There is no walk **seam** (the desk sibling already walks). There is no typeahead **seam**. There is no write **seam**. There is no begin / complete **seam**.
- Split later (only if the file outgrows one sitting): this ~140-line file is one sitting if you read it as download the Admin Dashboard desk as a spreadsheet — same filters, chosen columns, flatten nested booked / cancelled / agents / customer so Excel can open them. Do **not** split Form vs Call vs Booking into `exportFormLeads.ts` so “each resource owns a spreadsheet.” Do **not** copy the five-thousand-row walk into this file so “export owns export.” If it later splits: `downloadTheAdminDashboardDeskAsASpreadsheet.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `export.ts`

`exportAdminResourceCsv` is executor mechanics. The owner question is: *I already filtered the Admin Dashboard desk. Give me a spreadsheet of those same rows. Same hide-duplicates. Same five-thousand-row walk. Put only the columns we chose for this resource. Flatten booked and cancelled to an id, Booking agents to semicolon-joined snapshot names, and customer name from the three homes a Booking or Cancellation already has. Name the file after the resource and which database I asked for. This is not jumping by name across every resource. This is not painting the filter chips. This is not an Analytics report. This is not Sheet Sync.*

Already-recommended desk walk, leftover `toCsv`, Wave A siblings `adminScope` / `adminSearch` / `adminFacets` / `filterCatalog` / `agentBrowseMetrics`, later Analytics / reporting / observability CSVs, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

One operation of one “download the Admin Dashboard desk as a spreadsheet” story, not “an admin CRUD export service,” and not the desk walk:

1. **Download the Admin Dashboard desk as a spreadsheet** — `exportAdminResourceCsv`. Wave B attachment. **Ask** already-recommended `collectTheAdminDashboardRowsForDownload` (`exportAdminResourceRows`) with the same browse query (filters, `database_scope`, Duplicate Lead hide already decided next door). Pick `CSV_COLUMNS[resource]`. Map each row through `flattenExportRow`. Hand the flattened rows and the column list to leftover `toCsv`. Return `{ filename: \`${resource}-${query.database_scope}.csv\`, csv }`. This file never pages Mongo, never populates refs, never hides Duplicate Leads itself, and never writes a sheet.

There is no second owner operation. `flattenExportRow` / `idValue` / `stringValue` / `objectValue` are beats of the download, not extra stories. Do not export `CSV_COLUMNS` as a public **seam**.

## Organization

Keep one file. This is the screenplay for “download the Admin Dashboard desk as a spreadsheet.” The five-thousand-row walk, scope pick, filter chips, typeahead, Agent metric aggregate, Analytics reports, and leftover CSV escaping already live in deeper **modules**. Do not pull those in. Do not invent an `AdminExportService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a walk **adapter** beside already-recommended `exportAdminResourceRows`.

Do not split this by resource. Form columns and Booking `agent_names` are beats of one spreadsheet. Do not move the walk here so the two files “feel like one export.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `exportAdminResourceCsv` | `downloadTheAdminDashboardDeskAsASpreadsheet` | Wave B attachment; filename + csv body |

Keep the old name as a one-line alias until Wave B `v1.routes.ts`, `admin/index.ts`, and `admin.service.test.ts` migrate. Do not make callers learn `CSV_COLUMNS` / `flattenExportRow` / `toCsv` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the attachment Wave B already sends:

```ts
type AdminDashboardSpreadsheet = {
  filename: string // `{resource}-{database_scope}.csv`
  csv: string      // leftover toCsv: header + CRLF rows, only the chosen columns
}
```

That is the handoff from “the desk walked the rows” to “the browser downloads a file.” Combined stays one file; each row already carries `database_scope`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// adminExport.service.ts
// The owner already filtered the Admin Dashboard desk.
// Give them a spreadsheet of those same rows.
// Same hide-duplicates. Same five-thousand-row walk.
// Only the columns we chose for this resource.
// Booked and cancelled become an id.
// Booking agents become semicolon-joined snapshot names.
// Customer name comes from the three homes a Booking or Cancellation already has.
// This file does not page Mongo.
// This file does not typeahead.
// This file does not write Sheet Sync.
// This file does not build an Analytics report.

// ── 1. Download the Admin Dashboard desk as a spreadsheet ─

export async function downloadTheAdminDashboardDeskAsASpreadsheet(resource, query)

function chooseTheSpreadsheetColumnsForThisResource(resource)
function flattenADeskRowSoExcelCanOpenIt(row)
function flattenBookedOrCancelledToAnId(value)          // populated doc → _id; string stays; missing → ""
function joinBookingAgentSnapshotNames(allocations)     // agent_name_snapshot, "; "
function pickACustomerNameFromTheThreeHomes(row)        // customer_name → snapshot → populated full_name
function nameTheSpreadsheetFile(resource, databaseScope)
```

Read the download path out loud: *Ask the desk sibling for the walked rows. Choose the columns for this resource. Flatten booked and cancelled to an id, Booking agents to semicolon-joined snapshot names, and customer name from the three homes. Hand the rows to leftover toCsv. Name the file after the resource and which database was asked for. Combined is still one file.*

That is the operation. `exportAdminResourceCsv` is not a different story. Spreading `...row` is not proof every desk field will appear — leftover `toCsv` only emits the chosen columns.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The spreadsheet is thinner than the desk.** Form / Call columns omit `duplicate`, `sms_message_sent`, `lid`, and Form `job_no`. Agent columns omit sibling `booking_count` / binder / deposit / cancellation metrics. Customer columns omit desk `$group` totals. Do not silently add those so “export matches the table,” and do not drop `database_scope` so “one database does not need the column.”

2. **Booked / cancelled flatten to an id string, not a badge and not a boolean.** Populated doc → `_id`. Bare string stays. Missing → `""`. Typeahead uses booked / unbooked badges. The desk filter is presence. Do not write `true` / `false` so “boolean means boolean,” and do not write `booked` / `unbooked` so “export matches search badges.”

3. **`agent_names` is Booking allocation snapshots joined with `"; "`.** Only `agent_name_snapshot`. The Agent resource spreadsheet uses `name`, not `agent_names`. Do not flatten Agent rows through `agent_allocations`, and do not join live `agent` populate names so “the snapshot can go stale.”

4. **Customer name has three homes, in order.** `customer_name` → `customer_name_snapshot` → populated `customer.full_name`. Do not pull email / phone into that cell, and do not skip the snapshot so “the live Customer always wins.”

5. **Combined is one file.** Filename is `{resource}-{database_scope}.csv` (`form-leads-combined.csv`). Rows keep their own `database_scope`. Do not emit two attachments so “combined means two downloads,” and do not drop the column because the filename already says combined.

6. **This file does not walk pages.** The 5_000-row / 250-per-page walk stays in already-recommended `exportAdminResourceRows`. Combined download already walks both concrete desks (not the in-memory first-page merge). Do not copy that loop here so “export owns export,” and do not point this file at `browseAdminResource` so “the spreadsheet matches the combined table.”

7. **Leftover `toCsv` owns quote / CRLF / Date-to-ISO.** Extra fields on the flattened object are ignored unless they are in `CSV_COLUMNS`. Do not move `toCsv` into this file, and do not start emitting every desk field because they already sit on the spread row.

8. **Analytics, Agent-sales, and Observability CSVs are not this story.** Those Wave B routes live in later Wave A services. Do not point `GET /api/v1/admin/exports/analytics/:report.csv` at this file, and do not teach this file a report name so “every admin CSV is one function.”

9. **Sheet Sync / Google Sheets projections are not this story.** A download does not enqueue a tab write. Do not call `schedule*SheetSync` from here, and do not reuse Form / Booking row mappers as `CSV_COLUMNS`.

10. **Leave sibling modules alone.** The walk stays in `adminBrowse.service.ts`. Scope pick stays in `adminScope.service.ts`. Typeahead stays in `adminSearch.service.ts`. Filter chips stay in `adminFacets` / `filterCatalog`. Agent `$unwind` stays in `agentBrowseMetrics.service.ts`. Escape stays in leftover `utils/csv.ts`. This file orchestrates ask-for-rows → choose-columns → flatten → name-the-file.

11. **A Duplicate Lead filter does not add a `duplicate` column.** When the owner asks `duplicate: true`, the walked rows are duplicates and the spreadsheet still has no `duplicate` header. Do not add that column so “the filter is visible,” and do not drop the desk hide so “export shows every lead.”

12. **Form CSV has `ref_no` and no `job_no`; Call / Booking / Cancellation have `job_no`.** Additive Form Job Number is not in `CSV_COLUMNS`. Do not add Form `job_no` “for symmetry” in this rename.

## Testing

The **interface** is the test surface: `downloadTheAdminDashboardDeskAsASpreadsheet`. The `{ filename, csv }` bag and the chosen headers are part of that **interface**.

Today’s `admin.service.test.ts` only locks Form filename, header start (`_id,database_scope,timestamp`), and quoted-name escape. Fill the gaps the story names make obvious:

**Download the Admin Dashboard desk as a spreadsheet**
- Form / Call / Booking / Cancellation / Customer / Agent each emit their own header list (prove today’s omissions: no Form `job_no` / `duplicate` / `sms_message_sent`; no Agent `booking_count`).
- Filename is `{resource}-{database_scope}.csv`. Combined is still one filename, one body.
- Booked / cancelled populated docs flatten to `_id`; missing is empty (not `false`).
- Booking `agent_names` joins `agent_name_snapshot` with `"; "`.
- Customer name prefers `customer_name`, then snapshot, then populated `full_name`.
- This function **asks** `exportAdminResourceRows` (same browse query). Combined must not go through the in-memory first-page merge.
- Quote / comma / newline still escape (leftover `toCsv`). Dates become ISO.

Do **not** add a test per helper (`flattenBookedOrCancelledToAnId`, `joinBookingAgentSnapshotNames`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test the 5_000-row walk, Duplicate Lead hide, combined first-page desk merge, facet cache, Agent `$unwind` deposit-once math, typeahead groups, or Analytics / observability CSV here. The walk proof stays on already-recommended `collectTheAdminDashboardRowsForDownload`.

## What I would not do

- An `AdminExportService` class with `export` / `list` / `get`.
- Thirty two-line functions that only wrap `toCsv`.
- Moving this into a CRUD folder, or into `analytics/` / `reporting/` / `googleSheets/` “because those also emit CSV.”
- Copying the five-thousand-row walk into this file so “export owns export.”
- Pointing this file at `browseAdminResource` so the combined spreadsheet matches the combined table.
- Adding desk extras (`sms_message_sent`, Agent metrics, `duplicate`) so “export matches the table,” or adding Form `job_no` “for symmetry.”
- Writing booked / cancelled as `true` / `false` or as search badges.
- Emitting two combined attachments, or pointing Analytics / Agent-sales / Observability CSV routes at this file.
- Enqueueing Sheet Sync or reusing Google Sheets row mappers as columns.
- Writing a whole-folder recommendation for `admin`.
