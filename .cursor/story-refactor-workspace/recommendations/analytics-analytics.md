# Run This Admin Dashboard Analytics Report Against Live, Historical, Or Both Databases — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 1 of this service — `analytics.service.ts`
- Remaining in this service: `overview.service.ts`, `summary.service.ts`, `revenueTrend.service.ts`, `sourcePerformance.service.ts`, `agentPerformance.service.ts`, `cancellationAnalytics.service.ts`, `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/analytics.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (this file is the dispatcher: `report` + `query` → concrete models → optional combined merge. Role line: “Dispatch `report` + `query` to a concrete report, resolve `database_scope` to model sets, merge when `combined`.” Read-only Mongo. Does not query Reporting Sheets. No writes, no Sheet Sync). Distinct from leftover home Overview: sibling `overview.service.ts` (`GET /api/v1/admin/analytics/overview`, `overviewQuerySchema`: scope only — **does not** import this file). Distinct from leftover Agent Sales: sibling `agentSalesReport.service.ts` (`GET /api/v1/admin/reports/agent-sales` — hard-coded live models). Distinct from leftover CSV flatten: sibling `analyticsExport.service.ts` **asks** this then flattens (`GET /api/v1/admin/exports/analytics/:report.csv`). Distinct from leftover Filter Catalog match / booked prefix: `analyticsFilters.ts`. Distinct from leftover combined add: `analyticsMerge.ts` (this file **asks** it; it does **not** join by business id). Distinct from leftover catalog nest / zero seed: `sourceHierarchy.ts`. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md) (`ringcentral/analytics-reconcile.service.ts` — must not create Call Leads; this file never imports it). Distinct from already-recommended Admin Dashboard desk / typeahead / chips. This checkout’s `CONTEXT.md` does not define Analytics / Source Company / CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an analytics Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleAnalyticsReport` — one `GET /api/v1/admin/analytics/${report}` per name in `analyticsReports`; `analyticsQuerySchema`). Barrel: `analytics/index.ts`. CSV sibling `analyticsExport.service.ts` **asks** `getAnalyticsReport` then flatten (Wave B `GET /api/v1/admin/exports/analytics/:report.csv` does **not** import this file). Tests: `analytics.service.test.ts` (query schema, booked prefix + employee snapshot, combined merges, receiver-agent and SMS-conversion warnings, CSV flatten) — **does not call `getAnalyticsReport`**. Overview / Agent Sales / leftover filters / leftover hierarchy do **not** import this file.
- Seams callers need: run-this-report (`getAnalyticsReport`: live / historical / combined envelope) vs flatten-to-spreadsheet (CSV sibling **asks** this) vs paint-the-home-overview (sibling, separate route) vs print-agent-sales (sibling, separate route). There is no write **seam**. There is no begin / complete **seam**. There is no CSV-column **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~97-line file is one sitting if you read it as run this Admin Dashboard analytics report against live, historical, or both databases. Do **not** split the switch into `getSummary.ts` / `getRevenueTrend.ts` so “each report owns a route.” Do **not** pull leftover Overview / Agent Sales here so “one file owns every chart.” Do **not** pull leftover merge / filters / hierarchy here so “the dispatcher owns the math.” If it later splits: `runThisAdminDashboardAnalyticsReport.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getAnalyticsReport` / `getConcreteAnalyticsReport` are executor mechanics. The owner question is: *I asked for one Analytics report. Run it against the live database, the historical database, or both. Combined adds the two collections — it does not join the same Job Number. Receiver-agent and SMS-conversion reports do not exist historically; combined still shows the live rows plus a warning. This is not the home overview. This is not flattening a spreadsheet. This is not reconciling RingCentral call counts.*

Leftover Overview / Agent Sales / CSV flatten / filters / merge / hierarchy, leftover scope pick, already-recommended Admin Dashboard desk, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “run this Admin Dashboard analytics report against live, historical, or both databases” story, not “an analytics CRUD report service,” and not the home overview:

1. **Run this Admin Dashboard analytics report** — `getAnalyticsReport`. Wave B named report. Expand `concreteScopes(query.database_scope)` (live, historical, or both). Per scope, in parallel: pick `getAdminModels(scope)`, overwrite `database_scope` on the query so a leftover report never sees `combined`, then switch on `report`. Sixteen named reports **ask** leftover siblings (`getSummary`, `getRevenueTrend`, source / agent / cancellation / geographic / receiver-agent / SMS). Receiver-agent (`performance` / `trend` / `source-breakdown`) and `sms-successfully-sent-then-booked` on **historical** return the sibling unsupported card (`items: []` + warning metadata) instead of aggregating. Stamp `{ report, database_scope, generated_at, data }`. This file never mutates Mongo, never enqueues Sheet Sync, and never reads Reporting Sheets.

2. **When both databases, add the two collections** — still `getAnalyticsReport`. Combined: `mergeAnalyticsPayload(report, payloads)`. Sibling merge sums numeric fields and re-derives rates by stable text keys. **Does not** join by Job Number, Lead id, or any other business id. Receiver-agent and SMS combined keep the live rows and the historical-unsupported warning. One concrete scope: `data` is that payload as-is (no merge).

There is no third owner operation. `getConcreteAnalyticsReport` is the per-database beat, not a public **seam**. Do not export the switch. Do not export leftover `getSummary` from this file as if this story owned the totals card.

## Organization

Keep one file. This is the screenplay for “run this Admin Dashboard analytics report against live, historical, or both databases.” Totals math, booked-prefix filters, combined add, catalog nest, CSV columns, home Overview, and Agent Sales already live in deeper **modules**. Do not pull those in. Do not invent an `AnalyticsService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a CSV **adapter** beside leftover `exportAnalyticsReportCsv`.

Do not split this by report name. Summary totals and SMS-conversion historical skip are beats of one dispatcher. Do not move this into `admin/` so “the Admin Dashboard folder owns every chart.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getAnalyticsReport` | `runThisAdminDashboardAnalyticsReport` | Wave B named report; CSV sibling **asks** the same envelope |
| `AnalyticsResponse` | `AdminDashboardAnalyticsReport` | `report` + `database_scope` + `generated_at` + `data` |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, `analytics/index.ts`, `analyticsExport.service.ts`, and `analytics.service.test.ts` migrate. Do not make callers learn `getConcreteAnalyticsReport` / `Promise.all` / `getAdminModels` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the envelope the Admin Dashboard already paints:

```ts
type AdminDashboardAnalyticsReport = {
  report: AnalyticsReport
  database_scope: "live" | "historical" | "combined"
  generated_at: string // wall clock after both scopes finish
  data: AnalyticsPayload // one concrete payload, or the sibling merge
}
```

That is the handoff from “we ran the named report against each database” to “paint the chart.” Combined `data` is summed collections, not a third database.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// analytics.service.ts
// The owner asked for one Analytics report.
// Run it against the live database, the historical database, or both.
// Combined adds the two collections. It does not join the same Job Number.
// Receiver-agent and SMS-conversion reports do not exist historically.
// This file does not paint the home overview.
// This file does not flatten a spreadsheet.
// This file does not reconcile RingCentral call counts.

// ── 1. Run this Admin Dashboard analytics report ──────────

export async function runThisAdminDashboardAnalyticsReport(report, query)

async function runTheReportAgainstOneDatabase(report, query, scope)
function pickTheLiveOrHistoricalModels(scope)           // asks leftover adminScope
function thisReportDoesNotExistHistorically(report, scope) // receiver-agent + SMS only

// ── 2. When both databases, add the two collections ───────

function addTheTwoCollectionsTogether(report, payloads) // asks leftover merge
```

Read the report path out loud: *The owner named a report and a database scope. Expand live, historical, or both. For each database, pick that model set, hide `combined` from the leftover report, and run the switch. Receiver-agent and SMS-conversion on historical return the empty unsupported card. If the owner asked for both databases, add the two collections by stable text keys — do not join the same Job Number. Stamp which report, which scope, and when we finished. Hand the envelope to the chart. A spreadsheet download asks this same envelope and flattens next door.*

That is the operation. `getAnalyticsReport` is not a different story. Combined is not a third System of Record.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`getAnalyticsReport` / `getConcreteAnalyticsReport` are executor names.** The owner named a report. The names should say run it, then (when both) add the two collections. Do not teach Wave B `getConcrete`.

2. **Historical skip lives here; the empty card lives next door.** This file decides `scope === "historical"` for three receiver-agent reports and SMS-conversion, then **asks** `unsupportedReceiverAgentReport` / `unsupportedSmsConversionReport`. Leftover merge restamps the warning on combined. Do not move the skip into every leftover report so “each chart knows history,” and do not drop the skip here so those leftovers start aggregating historical `receiver_agent` / Lead Messages.

3. **Combined adds collections; it does not join by business id.** Knowledge: “`combined` sums collections; it does not join by business id.” Leftover merge keys `source_company` via `normalizeSourceDimension`, other dimensions lowercased. Do not silently `$unionWith` on `normalized_job_no` so “combined means one company,” and do not teach merge to dedupe Lead ids.

4. **Overview and Agent Sales bypass this dispatcher.** Home Overview **asks** leftover `getSummary` / `getLeadCost` / top agents itself. Agent Sales hard-codes live models. Do not route those HTTP paths through `runThisAdminDashboardAnalyticsReport` so “every chart goes through the switch,” and do not add `overview` / `agent-sales` cases to this switch so “one report enum owns the dashboard.”

5. **CSV sibling asks this, then flattens.** `exportAnalyticsReportCsv` calls `getAnalyticsReport` then `rowsForCsv`. Combined funnel CSV does not also emit the parent total. Do not flatten columns here so “the dispatcher owns download,” and do not point Wave B `GET .../analytics/:report` at leftover `exportAnalyticsReportCsv`.

6. **`generated_at` is wall clock after both scopes finish.** One ISO string on the envelope, not per-scope. Do not stamp each leftover payload, and do not reuse the query `to` date as `generated_at`.

7. **The per-scope query overwrites `database_scope`.** Combined callers still send leftover reports a concrete scope so Filter Catalog / Lead Message reads do not see `combined`. Do not pass the original `combined` query into `getSummary` so “the leftover file can merge,” and do not make leftover reports call `concreteScopes` themselves.

8. **Tests never call this export.** `analytics.service.test.ts` names schema, booked prefix, merge, and CSV flatten. The dispatcher envelope is unproven at the **interface**. Do not treat leftover merge tests as proof this file asked merge.

9. **Leave sibling modules alone.** `concreteScopes` / `getAdminModels` stay in leftover `adminScope.service.ts`. Booked prefix / `leadMatchForQuery` stay in leftover `analyticsFilters.ts`. Combined add stays in leftover `analyticsMerge.ts`. Catalog nest / zero seed stay in leftover `sourceHierarchy.ts`. Totals, trends, source, agent, cancellation, geographic, receiver-agent, SMS, Overview, Agent Sales, Lead Cost, and CSV flatten stay in their files. This file orchestrates scope → switch → optional add.

10. **Do not treat RingCentral analytics reconcile as this story.** Already-recommended `reconcileRingCentralAnalytics` is count-only Call Log math. Do not import it here so “analytics means analytics,” and do not teach that file `database_scope`.

## Testing

The **interface** is the test surface: `runThisAdminDashboardAnalyticsReport` (`getAnalyticsReport`). The envelope (`report` + `database_scope` + `generated_at` + `data`) is part of that **interface**.

Today’s `analytics.service.test.ts` never calls `getAnalyticsReport`. Fill the gap the story names make obvious:

**Run this Admin Dashboard analytics report**
- Live `summary` returns `{ report: "summary", database_scope: live, generated_at, data }` and **asks** leftover `getSummary` with a live model set.
- Historical `summary` **asks** leftover `getSummary` with historical models (does not touch the live collection).
- Historical `receiver-agent-performance` / `receiver-agent-trend` / `receiver-agent-source-breakdown` return the unsupported card (`items: []`, `historical_receiver_agent_supported: false`) and do **not** aggregate.
- Historical `sms-successfully-sent-then-booked` returns the unsupported card and does **not** read `lead_messages`.
- Live SMS-conversion **asks** leftover `getSmsSuccessfullySentThenBooked` (does not return the unsupported card).
- `generated_at` is an ISO string from after the scope work, not the query `to`.

**When both databases, add the two collections**
- Combined **asks** leftover `mergeAnalyticsPayload` with two concrete payloads (live first, then historical).
- Combined receiver-agent / SMS keep live rows plus the historical-unsupported warning.
- Combined does **not** join by Job Number / Lead id. Prove today’s sum-by-text-key. Do not “fix” it into a business-id join.
- One-scope (live or historical) does **not** call merge.

**Not this file**
- Do **not** assert CSV headers here — that is a later sitting (`analyticsExport.service.ts`).
- Do **not** assert Overview `last_7_days: null` on historical — that is a later sitting (`overview.service.ts`).
- Do **not** assert Agent Sales live-only models — that is a later sitting (`agentSalesReport.service.ts`).

Do **not** add a test per helper (`runTheReportAgainstOneDatabase`, `thisReportDoesNotExistHistorically`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test booked-prefix employee-snapshot order, leftover merge parent/leaf math, CSV “leaves or a childless company,” or RingCentral reconcile here.

## What I would not do

- An `AnalyticsService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap the switch.
- Moving this into a CRUD folder, or into `admin/` “because the Admin Dashboard paints the chart.”
- Pulling leftover Overview / Agent Sales into this switch so “one file owns every chart.”
- Pulling leftover merge / filters / hierarchy / CSV flatten into this file.
- Breaking the combined add-by-text-key by “fixing” it to a Job Number join in this rename.
- Teaching leftover reports to see `database_scope: "combined"` so they can merge themselves.
- Pointing Wave B `GET /api/v1/admin/analytics/overview` at this file, or pointing `GET /api/v1/admin/analytics/summary` at leftover `getOverviewReport`.
- Treating already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
