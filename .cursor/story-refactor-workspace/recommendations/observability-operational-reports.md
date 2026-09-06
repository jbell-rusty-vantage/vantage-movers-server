# Count This Window The Same Way Every Time And Keep The Citeable Run — operational story

- Status: recommended
- Service: `observability` (Wave A, in-progress)
- Pass: 6 of this service — `operationalReports.service.ts`
- Remaining in this service: `notificationDigest.service.ts`
- Target: `src/services/observability/operationalReports.service.ts`
- Knowledge: none (`docs/knowledge/services/` has no Observability Service). Software map: [`.cursor/rules/observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) (best-effort; never break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron; public import is the folder barrel; models via getters; env policy in `src/config/domain/observability.ts`; rollups are deferred — reports aggregate live happenings / Incidents / Delivery rows / Sheet Sync health; grouped aggregations **must** `$sort` before `$limit`, then `sortRows` as a final guard). Distinct from already-recommended write-this-happening-down: [`observability-record-operational-event.md`](observability-record-operational-event.md) (this file **reads** `reportable: true` happenings; it never writes an Operational Event). Distinct from already-recommended leftover SendGrid row: [`observability-email-notification.md`](observability-email-notification.md) (`notification-delivery-summary` **counts** Delivery rows; leftover purpose `weekly_report` is config only — this file never emails). Distinct from already-recommended leftover immediate policy: [`observability-notification-policy.md`](observability-notification-policy.md). Distinct from already-recommended leftover open-or-grow: [`observability-operational-incident.md`](observability-operational-incident.md) (daily-owner **counts** Incidents; it never upserts). Distinct from already-recommended leftover Observational desk: [`observability-admin-observability.md`](observability-admin-observability.md) (leftover facets **copy** `OPERATIONAL_REPORT_KEYS` and leftover `REPORT_RUN_STATUSES`; leftover overview is the live morning card; leftover digest **asks** leftover overview with `{}` — **not** this file). Distinct from later leftover digest: `notificationDigest.service.ts` (subject is leftover `overall_status`; it does **not** run `daily-owner-operational-summary`). Distinct from already-recommended leftover Sheet Sync health: [`admin-sheet-sync.md`](admin-sheet-sync.md) (`sheet-sync-health-summary` **asks** `getSheetSyncHealth`, `.catch(() => null)`). Distinct from already-recommended leftover Analytics named reports / leftover Agent Sales: [`analytics-analytics.md`](analytics-analytics.md) / [`analytics-agent-sales-report.md`](analytics-agent-sales-report.md). Distinct from later unvisited Google Reporting: `src/services/reporting/` + [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated definitions, revisions, destinations — a different product). Distinct from leftover Wave B `src/routes/v1.routes.ts` Observational report handlers (thin parse → this file). Distinct from leftover `OperationalReportRun` schema and leftover `REPORT_RUN_STATUSES`. Distinct from leftover `observability-review-report.md` finding 10 (stale: `include_resolved` **is** applied on daily-owner Incident counts). This checkout’s `CONTEXT.md` names “Workflow Observational” in the intro and does not define Observational report / Report Run — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an Observability Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`GET .../observability/reports`; `POST .../observability/reports/run` → 201; `GET .../observability/reports/:id`; `GET .../exports/observability/reports/:id.csv`). Folder barrel `observability/index.ts` re-exports the four run-desk names plus `OPERATIONAL_REPORT_KEYS` / `isOperationalReportKey` / `computeResultHash` / `canonicalize` / `OperationalReportKey`. Already-recommended leftover desk **asks** `OPERATIONAL_REPORT_KEYS` only (facets). Later leftover digest does **not** import this file. Tests: `operationalReports.test.ts` only proves `canonicalize` / `computeResultHash` / `isOperationalReportKey`. No run test. No list test. No detail test. No CSV test. No named-report aggregation test.
- Seams callers need: run-this-named-window (`runOperationalReport`: refuse unknown key / backwards window / >90 days; write `running`; count; hash; watermark; `completed` or `failed` then rethrow) vs show-the-run-desk (`listOperationalReportRuns`: strip `result`) vs open-one-run (`getOperationalReportRunDetail`) vs download-this-run (`exportReportRunCsv`: `result.rows` or the whole result as one CSV row). `OPERATIONAL_REPORT_KEYS` / `isOperationalReportKey` are the catalog **seam** leftover facets already copy. `computeResultHash` is the cite **seam**. There is no begin / complete **seam**. There is no Domain Command **seam**. There is no leftover digest **seam**. There is no leftover Google Reporting **seam**. There is no leftover email **seam**.
- Split later (only if the file outgrows one sitting): this ~550-line file is one sitting if you read it as count this window the same way every time and keep the citeable run. Do **not** split the seven `report_key`s into `daily.ts` / `workflow.ts` / `http.ts`. Do **not** split run / list / detail / export into `create.ts` / `list.ts` / `get.ts` / `export.ts`. Do **not** pull leftover overview / leftover digest / leftover Google Reporting here so “reports own the company.” If it later splits: `runTheNamedObservationalReportForThisWindow.ts` / `showTheReportRunDesk.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `get.ts`

`runOperationalReport` / `listOperationalReportRuns` / `getOperationalReportRunDetail` / `exportReportRunCsv` are executor mechanics. The owner question is: *I want last week’s workflow failures, counted the same way every time I ask. Pick the named report and the window. Keep the run. Hash the inputs and the result so I can cite it. Let me open that run later or download the rows. Do not invent a Mongo pipeline for me. Do not email this. Do not confuse it with the morning card, the leftover digest, or Google Reporting. A second click still writes a new run even when the hash matches.*

Already-recommended leftover write-this-happening-down, leftover upsert, leftover policy, leftover SendGrid row, leftover Observational desk, leftover Sheet Sync health, leftover Analytics named reports, later leftover digest, later leftover Google Reporting, leftover env flags already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “count this window the same way every time and keep the citeable run” story, not “a report CRUD service,” and not leftover overview or leftover Google Reporting:

1. **Run the named Observational report for this window** — `runOperationalReport`. Seven `report_key`s (`OPERATIONAL_REPORT_KEYS`): `daily-owner-operational-summary`, `workflow-failure-summary`, `source-company-issue-summary`, `sheet-sync-health-summary`, `ringcentral-health-summary`, `notification-delivery-summary`, `http-error-summary`. Unknown key / `to <= from` / range over 90 days → 400. Write `OperationalReportRun` `running` first (`requested_by` default `"admin"`; `database_scope` hardcoded to the live Admin browse scope; `granularity` hardcoded `"day"`). Then `definition.run`. Event reports use `baseEventMatch`: `[from, to)` on `occurred_at`, `reportable: true`, optional category / workflow / source / level. Grouped aggregations `$sort` then `$limit` 5_000, then `sortRows` (primary metric desc, label asc). Hash `{ report_key, report_version, period, filters, result }` through `canonicalize` (sorted keys, Dates as ISO) → SHA-256 `result_hash`. Watermark happenings-max / happenings-count / Incident-count in the same `[from, to)` — watermark does **not** require `reportable`. Stamp `completed`. On throw: `failed` + `error_message`, save, then rethrow. Same inputs over the same data → same hash. A second run still `create`s a new row.

2. **Show the report-run desk** — `listOperationalReportRuns`. Optional `report_key` / `status`. Newest `started_at` first. Projection `{ result: 0 }`. Standard `{ items, page, limit, total, has_next_page }`.

3. **Open one report run** — `getOperationalReportRunDetail`. Missing id → 404. Returns the lean document, result included.

4. **Download this report run as CSV** — `exportReportRunCsv`. Same 404. If `result.rows` is an array, those rows. Else daily-owner’s object becomes **one** CSV row. `toCsv`. Filename `{report_key}-{id}.csv`. `csv_export_path` is never written.

The seven definitions are beats of operation 1, not seven owner operations:

- `workflow-failure-summary` / `source-company-issue-summary` / `http-error-summary` — warn/error/critical happenings (HTTP also forces `category: "http"` and error/critical).
- `ringcentral-health-summary` / `sheet-sync-health-summary` — category happenings; Sheet Sync also asks `getSheetSyncHealth` and swallows `null`.
- `notification-delivery-summary` — Delivery `createdAt` `[from, to)` by status × purpose. Event filters are ignored.
- `daily-owner-operational-summary` — happenings by level / category; `new_incidents` / `resolved_incidents` gated by `include_resolved`; `executive_status` `critical` / `degraded` / `healthy` from **current** open/acknowledged Incidents (not period-scoped); Delivery sent / failed counts.

Do not export `baseEventMatch` / `sortRows` / `extractRows` / `computeWatermark` / `REPORTS` as a public **seam**. `canonicalize` is a hash beat, not a desk operation.

## Organization

Keep one file. This is the screenplay for “count this window the same way every time and keep the citeable run.” Leftover write-this-happening-down, leftover upsert, leftover desk, leftover digest, leftover Sheet Sync health, leftover Analytics named reports, leftover Google Reporting already live in deeper **modules**. Do not pull those in. Do not invent an `OperationalReportsService` class. Do not invent a begin / complete **seam** — run is after-the-fact Mongo, not a Domain Command. Do not invent a second hash **adapter** beside `computeResultHash`. Do not invent a second catalog **adapter** beside `OPERATIONAL_REPORT_KEYS`.

Do not split keys into CRUD files. List / open / download are three **adapters** of “keep the run.” Hash helpers stay next to run because cite is why persist exists.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runOperationalReport` | `runTheNamedObservationalReportForThisWindow` | Wave B POST run; 201 document |
| `listOperationalReportRuns` | `showTheReportRunDesk` | Wave B GET list; result stripped |
| `getOperationalReportRunDetail` | `openOneReportRun` | Wave B GET `:id` |
| `exportReportRunCsv` | `downloadThisReportRun` | Wave B CSV export |
| `OPERATIONAL_REPORT_KEYS` | leftover catalog | leftover facets copy these keys |
| `isOperationalReportKey` | leftover catalog guard | run 400 unknown key |
| `computeResultHash` | `hashThisReportSoTheOwnerCanCiteIt` | cite contract tests already prove |
| `canonicalize` | leftover hash beat | keep as alias until tests migrate |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, the folder barrel, leftover facets, and `operationalReports.test.ts` migrate. Do not make callers learn `$sort` / `MAX_ROWS` / `REPORTS` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the citeable run Wave B already returns:

```ts
type CiteableObservationalReportRun = {
  report_key: OperationalReportKey
  report_version: number
  status: "running" | "completed" | "failed"
  period: { from: Date; to: Date; timezone: string; granularity: "day" }
  filters: Record<string, unknown>
  result: Record<string, unknown>
  result_hash: string
  input_watermark: {
    events_max_occurred_at: Date | null
    events_count: number
    incidents_count: number
  }
}
```

That is the handoff from “we counted this window” to “the owner cites the hash or downloads the rows.” Do **not** add `persist: boolean` so “every caller looks like a command,” and do **not** collapse leftover morning card into this type so “overview is a report.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// operationalReports.service.ts
// The owner picks a named Observational report and a window.
// Count that window the same way every time.
// Keep the run. Hash the inputs and the result so they can cite it.
// Let them open that run later or download the rows.
// Do not invent a pipeline. Do not email. Do not confuse this
// with the morning card, the leftover digest, or Google Reporting.

export const THE_NAMED_OBSERVATIONAL_REPORTS = [
  "daily-owner-operational-summary",
  "workflow-failure-summary",
  "source-company-issue-summary",
  "sheet-sync-health-summary",
  "ringcentral-health-summary",
  "notification-delivery-summary",
  "http-error-summary",
] as const
export const OPERATIONAL_REPORT_KEYS = THE_NAMED_OBSERVATIONAL_REPORTS

// ── 1. Run the named Observational report for this window ─

export async function runTheNamedObservationalReportForThisWindow(input)
export const runOperationalReport = runTheNamedObservationalReportForThisWindow

function refuseAnUnknownKeyOrABadWindow(input)
async function writeTheRunningRowFirst(input, version, filters)
async function countThisWindowTheNamedWay(key, ctx)
function matchReportableHappeningsInThisWindow(ctx)
function sortGroupedRowsTheSameWayEveryTime(rows, metric, label)
async function stampTheWatermarkForThisWindow(ctx)
function hashThisReportSoTheOwnerCanCiteIt(input)
async function finishTheRunCompleted(run, result, hash, watermark)
async function finishTheRunFailedAndRethrow(run, error)

async function countWorkflowFailures(ctx)
async function countSourceCompanyIssues(ctx)
async function countHttpErrors(ctx)
async function countRingCentralHappenings(ctx)
async function countSheetSyncHappeningsAndAskHealth(ctx)
async function countLeftoverEmailsByStatusAndPurpose(ctx)
async function countTheDailyOwnerCardForThisWindow(ctx)

// ── 2. Show the report-run desk ──────────────────────────

export async function showTheReportRunDesk(query)
export const listOperationalReportRuns = showTheReportRunDesk

// ── 3. Open one report run ───────────────────────────────

export async function openOneReportRun(id)
export const getOperationalReportRunDetail = openOneReportRun

// ── 4. Download this report run as CSV ───────────────────

export async function downloadThisReportRun(id)
export const exportReportRunCsv = downloadThisReportRun

function rowsTheOwnerCanDownload(result)
```

Read the primary path out loud: *The owner picks `workflow-failure-summary` and last week. Refuse an unknown key, a backwards window, or more than ninety days. Write `running` first. Count reportable warn / error / critical happenings in `[from, to)`. `$sort` then `$limit` 5_000 then sort by count then `event_key`. Hash key + version + period + filters + result. Stamp how many happenings and Incidents sat in that window. Mark `completed`. The owner lists runs without the result blob. They open one run or download the rows. A second click writes a new row even when the hash matches. Leftover digest does not run this. Leftover morning card is leftover overview.*

That is the operation. `runOperationalReport` is the named count, not leftover Google Reporting and not leftover `getObservabilityOverview`.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **A second run always `create`s.** `result_hash` is indexed and never reused as idempotency. Cite is “these two hashes match,” not “return the old row.” Do not silently return an existing completed run so “rerun is cheap” on this pass.

2. **`failed` is saved then rethrown.** Wave B sees the original error after a `failed` row already exists. Do not return the `failed` document so “HTTP is 201 with status failed” unless a later pass proves the desk should show it that way. Do not delete the `running` row on throw so “failed runs disappear.”

3. **`running` can orphan.** Process death after `create` leaves `running` with no `finished_at`. Do not add a sweeper in this rename.

4. **`timezone` is stored and hashed and never used to bucket.** Aggregations use Date instants only. `granularity` is hardcoded `"day"`. Do not silently group by Eastern day so “timezone means something” on this pass.

5. **`database_scope` is hardcoded to the live Admin browse scope.** The owner cannot ask historical here. Do not thread Admin `database_scope` through this file so “reports match browse.”

6. **`include_resolved` only changes daily-owner Incident counts.** The other six keys ignore it even though `normalizeFilters` stores it on `filters` (so the hash changes when the flag flips with no count change on those keys). When the flag is false, both `new_incidents` and `resolved_incidents` also require `status` in `open` / `acknowledged`. A resolved Incident almost never satisfies that, so `resolved_incidents` is almost always 0 unless the owner passed `include_resolved: true`. Do not silently drop the open/acknowledged gate from `resolved_incidents` so “resolved means resolved” unless a later pass proves the card. Do not apply the flag to event reports so “one filter fits every key.”

7. **`executive_status` is live, not period-scoped.** Daily-owner uses **current** open/acknowledged critical / error Incidents — the same decision leftover overview uses for `overall_status`. Happenings in the window can be quiet while the card still says `critical`. Do not period-scope that status so “the report matches the window” on this pass. Do not call leftover `getObservabilityOverview` so “one health function.”

8. **Daily-owner is not leftover digest.** Leftover digest **asks** leftover overview with `{}`. This key re-counts happenings / Incidents / Delivery and never emails. Do not send leftover `weekly_report` from here so “the named summary is the digest.”

9. **`notification-delivery-summary` ignores event filters.** Category / workflow / source / level sit on `filters` and enter the hash, but the Delivery match is date-only. Do not silently apply those filters to Delivery so “filters always filter.” Do not drop them from the hash so “unused keys do not change cite.”

10. **HTTP error plus a non-http `category` filter is empty.** `baseEventMatch` can set `category` and the HTTP definition also forces `category: "http"`. Do not drop the caller filter so “HTTP report always returns HTTP.” Document the intersection.

11. **Watermark counts every happening in the window.** Event reports require `reportable: true`. Watermark does not. A window of `reportable: false` leftover `admin.incident.status_changed` rows still raises `events_count`. Do not silently filter watermark to `reportable` so “watermark matches the report” on this pass.

12. **Sheet Sync health swallows.** `.catch(() => null)` hides a dead leftover Sheet Sync desk behind a completed `sheet-sync-health-summary`. Do not fail the run when leftover health throws. Do not record `admin.report.sheet_sync_failed` from here so “the swallow is visible” on this pass.

13. **Daily-owner CSV is one row.** `extractRows` treats a result without `rows` as a single object. The owner downloads `executive_status`, counts, and notification totals as one wide line. Do not invent a `rows` wrapper so “every report looks tabular” in this rename.

14. **`csv_export_path` is never written.** Export is on-the-fly. Do not persist a file path so “the schema field is used.”

15. **`$sort` then `$limit` then `sortRows`.** The rule requires Mongo sort-before-limit. Application `sortRows` is the final guard and can reorder within the already-capped 5_000. Do not drop the Mongo sort so “one sort lives in JS.” Do not raise the cap in this rename.

16. **Today’s tests stop at the hash helpers.** They never prove run / list / detail / download / any named count. That is not enough for a citeable run. See Testing.

17. **`canonicalize` is a test leak if exported as a public seam.** Only the test file and `computeResultHash` need it. Keep the export as an alias until the test moves onto `hashThisReportSoTheOwnerCanCiteIt`. Do not teach routes `canonicalize`.

18. **Leave sibling modules alone.** Leftover `writeThisHappeningDown`, leftover `tellTheOwnerWhetherTheCompanyIsHealthyThisMorning`, leftover `getSheetSyncHealth`, later leftover digest, later leftover Google Reporting are already the right **depth**. This file orchestrates the named count.

19. **Do not silently add rollups.** The rule says rollups are deferred. Reports count live. Do not write a metrics row from this file so “rerun is cheap.”

20. **Do not import leftover Google Reporting.** `src/services/reporting/` is Owner-gated definitions and Google destinations. This file is the Observational named-count desk.

## Testing

The **interface** is the test surface: `runTheNamedObservationalReportForThisWindow`, `showTheReportRunDesk`, `openOneReportRun`, `downloadThisReportRun`, `hashThisReportSoTheOwnerCanCiteIt`, leftover catalog guard.

Today’s `operationalReports.test.ts` only proves `canonicalize` key order, stable hash, hash change on result change, and `isOperationalReportKey`. Keep the hash cases (they are load-bearing cite). Add tests that name the operations. They will need a replica / injected models — do not hit leftover live SendGrid or leftover live Sheet Sync from `pnpm test`:

**Run the named Observational report for this window**
- Unknown `report_key` → 400. `to <= from` → 400. Range over 90 days → 400.
- Writes `running` first, then `completed` with `result_hash` and watermark.
- Same inputs over the same data → same hash. A second run still inserts a new row.
- Event reports match `reportable: true` and `[from, to)` (half-open).
- Grouped reports `$sort` before `$limit` 5_000, then `sortRows` metric desc / label asc.
- Failed count saves `failed` + `error_message` and rethrows. The `running` row is not deleted.
- `database_scope` is the live Admin browse scope. `granularity` is `"day"`.
- This file does **not** persist a rollup. This file does **not** email.

**Named counts**
- `workflow-failure-summary` groups warn/error/critical reportable happenings by category / workflow / event_key / level.
- `http-error-summary` plus `category: "crm"` returns no rows (intersection).
- `notification-delivery-summary` ignores category / workflow / source / level; hash still changes when those filters are present.
- `sheet-sync-health-summary` leftover health throw becomes `health: null` and the run still completes.
- `daily-owner-operational-summary` `executive_status` follows **current** open/acknowledged Incidents, not the window.
- `include_resolved: false` makes `resolved_incidents` almost always 0 (open/acknowledged gate). `include_resolved: true` counts by `resolved_at` in the window.

**Show / open / download**
- List strips `result`. Page shape is the standard browse bag.
- Missing id → 404 on open and on download.
- Download of a `rows` result uses those columns. Download of daily-owner is one CSV row.

**Cite**
- Hash is stable across object key order. Hash changes when result data changes. Hash includes timezone even though aggregations do not bucket by it.

Do **not** add a test per helper (`matchReportableHappeningsInThisWindow`, `sortGroupedRowsTheSameWayEveryTime`, `rowsTheOwnerCanDownload`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** keep exporting `canonicalize` “so the test can assert leftover JSON” as a public **seam**. Move that assertion onto leftover `hashThisReportSoTheOwnerCanCiteIt` once the run test exists.

## What I would not do

- An `OperationalReportsService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Event.aggregate` / `ReportRun.create`.
- Moving this into a CRUD folder (`create.ts` / `list.ts` / `get.ts` / `export.ts`) for cleanliness.
- Splitting the seven `report_key`s into seven files so “each report is a module.”
- Breaking the write-running-first **seam**. The owner needs a row even when the count throws.
- Treating leftover `getObservabilityOverview` as this story. The morning card is leftover desk. Leftover digest **asks** that card.
- Treating leftover Google Reporting as this story. Definitions / revisions / destinations are a different product.
- Treating leftover `weekly_report` email as this story. This file never sends.
- Inventing a begin / complete **seam** that has only one **adapter**.
- Inventing a second hash **adapter** beside `computeResultHash`.
- Silently reusing a prior run by hash so “rerun is cheap.”
- Silently period-scoping `executive_status` so “the report matches the window.”
- Silently adding leftover rollups so “morning is cheap.”
- Jumping to `reporting` while this service has unchecked modules.
- Writing a whole-folder recommendation for `observability`.
