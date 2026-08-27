# Log Into Granot, Collect The Requested Source Tables, And Turn Them Into The Rows The Company Already Uses For Follow Up And Booked Jobs — operational story

- Status: recommended
- Service: `granotHttpCollector` (Wave A, in-progress)
- Pass: 1 of this service — `index.ts`
- Remaining in this service: `automation.ts`, `sourceCatalog.ts`, `formWorkflow.ts`, `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `runWorkflow.ts`
- Target: `src/services/granotHttpCollector/index.ts`
- Knowledge: [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) — HTTP session collector happy path, date-window refuse, session retry, schema/size/provider codes, Follow Up → enrichment rows and Booked Jobs → booked-reconciliation rows. Primary code also lists `runWorkflow.ts`, `sourceCatalog.ts`, `formWorkflow.ts`, `lifecycleStatement.ts`, the admin/cron routers, and the queue consumer. This file is only login → report → parse → map. Distinct from standalone collect/preview: later `automation.ts`. Distinct from admin run / worker / approve: later `runWorkflow.ts`. Distinct from Form planning: later `formWorkflow.ts`. Distinct from Form match: later `granotFormLeadMatcher.ts`. Distinct from fail-closed source resolve: later `sourceCatalog.ts`. Distinct from plan seal: later `lifecycleStatement.ts`. Distinct from approved apply (receipt + `claimAndProcessOrPoll`): [`docs/knowledge/granot-lifecycle/automation-apply.md`](../../../docs/knowledge/granot-lifecycle/automation-apply.md) + [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from Call Lead Enrichment write: [recommendations/enrichment-call-lead-enrichment.md](enrichment-call-lead-enrichment.md). Distinct from Booked Call Lead Reconciliation write: [recommendations/reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md). Software map: `.cursor/rules/granot-http-automation.mdc`. This checkout’s `CONTEXT.md` does not define Granot HTTP collector / Call Lead Enrichment / Observation Receipt as glossary entries — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **four runtime import sites + the test file.** Planning: `runWorkflow.ts` calls `collectGranotReport` then `buildGranotOperationPayloads` (admin runs; apply is a later sibling). Standalone helper: `automation.ts` `runGranotAutomation` does the same pair (preview calls sibling enrichment/recon; this file never does). Operator script: `scripts/granot-automation/run-local.ts` (`pnpm granot:collect`) calls `collectGranotReport` only and prints counts / discovered labels. HTTP 502 map: `routes/granot-automation.routes.ts` imports `GranotCollectorError` only. Tests: `granotHttpCollector.test.ts` (parse both sections, nested tables, hash ignores session tokens, map to existing Call payloads, never copy `ref_no`, full report flow + absent sources, retry on Close Window, impossible dates never fetch). Type-only readers: `formWorkflow.ts` and `lifecycleStatement.ts` import `GranotReportRow` / `GranotSourceCollection`. Not callers: `sourceCatalog.ts`, `granotFormLeadMatcher.ts`, `granotLifecycle/automationApply.ts`, public Form/Call write, CSV sync, `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`.
- Seams callers need: refuse-the-window vs talk-to-Granot; collect (session) vs parse (one HTML page); collect vs map-to-existing-row-shapes (siblings call both); `dependencies.fetch` + cookie/redirect/size **adapter** vs the walk; `beforeSource` checkpoint vs each source page; `GranotCollectorError.code` vs admin 502; `invalid_session` (retry the whole walk once) vs `schema_drift` / `provider_error` / `response_too_large` (do not retry)
- Split later (only if the file outgrows one sitting): keep one file — this ~693-line module is one screenplay for “log into Granot, collect the requested source tables, and turn them into the rows the company already uses for Follow Up and Booked Jobs.” If it later splits: `collectTheRequestedGranotSourceTables.ts` / `readOneGranotSourcePage.ts` / `turnCollectedTablesIntoTheRowsWeAlreadyUse.ts` — story files, never `login.ts` / `parse.ts` / `map.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge preview, plan, approve, apply, or source-catalog resolve into this file

`collectGranotReport` / `collectGranotReportOnce` / `parseGranotSourceReport` / `buildGranotOperationPayloads` / `getGranotDateWindowProblem` are executor mechanics. The owner question is: *Someone asked for a real calendar window and some Granot source labels. Log into the report, walk the Leads & Advertising menu, read Booked Jobs and Follow Up Estimates for each label Granot actually listed, and hand the tables back. Then, if a sibling asks, turn Follow Up into the enrichment rows and Booked Jobs into the booked-reconciliation rows the company already posts. A dead session may start over once. A missing page or a table that lost `job_no` + `customer` stops the walk. A label Granot did not list is recorded as not observed — it is not a throw. This file does not plan. This file does not approve. This file does not capture a receipt. This file does not write a Lead, Booking, or Call refresh.*

Planning, preview, source-catalog resolve, Form match, plan seal, and approved apply already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “collect the tables, then turn them into the rows we already use” story, not “a Granot HTTP CRUD service,” and not the admin run / preview / apply:

1. **Log into Granot and collect the requested source tables** — refuse a window that is not two real `MM/DD/YYYY` calendar days with `to >= from` before anyone talks to Granot (`invalid_request`). Walk network login → user login (session token) → report menu → DATE1/DATE2 filter (default `OPEN` / `ALL` / status `10`) → source selector (`adverlistwc` links; drop `USERLIST`). For each requested label Granot listed: fire `beforeSource`, GET the source page, read Booked Jobs + Follow Up Estimates. A page with no recognized table is `invalid_session` (login/security/close-window text) or `schema_drift` (wrong page / missing `job_no`+`customer` headers). An `invalid` header on either section fails closed even if the other section is a table. Labels Granot did not list become `notObservedSourceLabels`. A recognized table needs headers `job_no` and `customer`; a data row also needs a numeric `no` plus `job_no` or `customer` (totals drop). Hash is SHA-256 of `{ sourceLabel, sections }` — unused session-token links do not change it. If the walk throws `invalid_session`, start the whole session over once; a second miss is still `invalid_session`. Cross-origin redirect / HTTP failure / timeout → `provider_error`. Body over 10 MB → `response_too_large`. Default host `https://eagle.hellomoving.com`; 20s per request. This function does not preview. This function does not write a Lead.

2. **Turn collected tables into the rows the company already uses** — Follow Up Estimates → `CallLeadEnrichmentRowInput` (`row_id` is `sourceLabel:row.id`). Booked Jobs → `BookedCallLeadReconciliationRowInput` with `section: "bookedJobs"`. Blank cells stay off the payload. `user` or `rep` becomes `granot_crm_username`. `source` falls back to the collected label. **Never copy `ref_no` onto these Call-shaped rows** — the parse may still see the column on the HTML table; the map must not. This function does not call preview. This function does not sync. This function does not interpret Tracking Reference.

There is no third mutate operation. `getGranotDateWindowProblem` / `parseGranotSourceReport` stay exported because tests (and the collect walk) lock “impossible dates never fetch” and “one HTML page becomes two sections + a stable hash.” `GranotHttpClient` is the fetch / cookie / redirect / size **adapter**, not a public story. `classifyExpectedPageError` / `parseSection` / `parseSourceSelector` / `mapEnrichmentRow` / `mapBookedRow` are folds, not public stories.

## Organization

Keep one file as the screenplay for “log into Granot, collect the requested source tables, and turn them into the rows the company already uses for Follow Up and Booked Jobs.” Preview, Form planning, source-catalog resolve, plan seal, and approved apply already live in deeper **modules**. Do not pull those in. Do not invent a `GranotCollectorService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — there is no Mongo write. Do not invent a notify **seam**. Do not invent a second HTTP **adapter** beside `dependencies.fetch` / `GranotHttpClient`.

Do not move this into `runWorkflow.ts` so “planning owns HTTP.” Do not move this into `automation.ts` so “collect and preview are one sitting.” Do not move this into `enrichment/` or `reconciliation/` so “row shapes live with the writes.” Do not split `login.ts` / `parse.ts` / `map.ts` / `create.ts`. Do not turn `index.ts` into an empty barrel that re-exports a new file without a story — today’s `index.ts` **is** the collector.

**External interface** stays small (this is the test surface). Collect and map are one story’s walk and handoff, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `collectGranotReport` | `collectTheRequestedGranotSourceTables` | admin planning, standalone helper, `pnpm granot:collect` |
| `parseGranotSourceReport` | `readOneGranotSourcePage` | collect uses it; tests lock sections + hash |
| `buildGranotOperationPayloads` | `turnCollectedTablesIntoTheRowsWeAlreadyUse` | planning + standalone preview call this after collect |
| `getGranotDateWindowProblem` | `whyThisDateWindowMustNotTalkToGranot` | collect refuses first; unused outside today |
| `GranotCollectorError` | `GranotWouldNotGiveUsTheReport` | admin maps `code` to HTTP 502 |
| `GranotCollectionRequest` | `WhichSourcesAndWindowToCollect` | credentials + labels + optional filters |
| `GranotCollectionResult` | `TheTablesWeBroughtBack` | discovered / not-observed / hashed sources |
| `GranotSourceCollection` | `OneSourcePageWeCouldRead` | the handoff from parse to map / plan |
| `GranotCollectorDependencies` | `HowToTalkToGranotThisTime` | `fetch` **adapter**, host, timeout, size, `beforeSource` |

Keep the old names as one-line aliases until `runWorkflow.ts`, `automation.ts`, `run-local.ts`, and the admin 502 map migrate. Do not make callers learn `collectGranotReportOnce` / `parseSection` / `classifyExpectedPageError` / `GranotHttpClient` as the domain language.

**Principle: old exports stay as aliases.** `collectGranotReport` and `buildGranotOperationPayloads` remain the imported names until planning and the local script point at the story names.

**No class for the workflow.** `GranotHttpClient` stays the fetch **adapter** (cookies, same-origin redirects, 10 MB cap). The type that *does* earn a name is the tables we brought back:

```ts
type TheTablesWeBroughtBack = {
  requestedDateWindow: { from: string; to: string }
  discoveredSourceLabels: string[]
  notObservedSourceLabels: string[]
  sources: Array<{
    sourceLabel: string
    contentHash: string
    sectionSchemas: Record<"bookedJobs" | "followUpEstimates", "table" | "empty" | "missing" | "invalid">
    sections: Record<"bookedJobs" | "followUpEstimates", Array<{ id: string; rowIndex: number; values: Record<string, string> }>>
  }>
}
```

That is the handoff from “we logged in and read the pages” to “a sibling may plan, preview, or map to the rows we already use.” Do **not** add credentials, cookies, or raw HTML so “ops can replay the session,” and do **not** add `ref_no` onto the Call-shaped map so “Tracking Reference is right there.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// index.ts
// Someone asked for a real calendar window and some Granot source labels.
// Log into the report. Walk Leads & Advertising.
// Read Booked Jobs and Follow Up Estimates for each label Granot listed.
// A dead session may start over once.
// A missing page or a table that lost job_no + customer stops the walk.
// A label Granot did not list is not observed — not a throw.
// Then, if a sibling asks, turn Follow Up into enrichment rows
// and Booked Jobs into booked-reconciliation rows.
// Never copy ref_no onto those Call-shaped rows.
// This file does not plan. This file does not approve.
// This file does not capture a receipt. This file does not write a Lead.

// ── 1. Log into Granot and collect the requested source tables ──

export async function collectTheRequestedGranotSourceTables(ask, howToTalk)
export function whyThisDateWindowMustNotTalkToGranot(window)
export function readOneGranotSourcePage(html, sourceLabel)

async function walkTheGranotReportSessionOnce(ask, howToTalk)
async function openTheNetworkLogin(client)
async function openTheUserLogin(client, credentials)
async function openTheLeadsAndAdvertisingFilter(client, sessionToken)
async function listTheSourcesGranotIsShowing(client, sessionToken, window, filters)
function dropTheRepListLinks(links)                    // USERLIST is not a source
async function readEachRequestedSourceWeCanSee(client, selected, beforeSource)
function refuseWhenNeitherSectionIsARecognizedTable(parsed, sourceLabel)
function refuseWhenASectionHeaderDrifted(parsed, sourceLabel)
function rememberWhichRequestedLabelsGranotDidNotShow(asked, discovered)

function isThisARealCalendarDay(value)
function didTheSessionDieBeforeWeGotThePage(html, expected)  // login / security / close window
function theTableLostItsJobAndCustomerHeaders(html, expected)

class HowToTalkToGranotThisTime {                      // today's GranotHttpClient
  async request(path, init)                            // cookies, same-origin redirects, 10 MB
}

// ── 2. Turn collected tables into the rows we already use ──

export function turnCollectedTablesIntoTheRowsWeAlreadyUse(sources)

function turnThisFollowUpRowIntoAnEnrichmentRow(sourceLabel, row)
function turnThisBookedJobsRowIntoAReconciliationRow(sourceLabel, row)
function stampUserOrRepAsTheCrmUsername(row)
function leaveRefNoOffTheCallShapedRow(payload)
```

Read the collect path out loud: *refuse an impossible window. Open network login, then user login, then the report menu, then the date filter, then the source list. Drop the rep-list links. For each requested label Granot showed, read Booked Jobs and Follow Up Estimates. Hash the parsed tables, not the raw HTML. If Granot sent us back to login, start the whole walk over once. Hand back the tables we could read and the labels we could not see. If a sibling asks, turn Follow Up into enrichment rows and Booked Jobs into booked-reconciliation rows, and leave Tracking Reference off those Call-shaped rows.*

That is the operation. `collectGranotReportOnce` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`index.ts` is not a barrel.** Callers write `from "../services/granotHttpCollector"` as if this were a re-export folder. The file owns the session walk. Keep the path as the collector until a later story split; do not add an empty barrel that hides a `collect.ts`.

2. **`collectGranotReport` is the retry wrapper; `collectGranotReportOnce` is the walk.** The public name should say “collect the requested tables.” The child should say “walk the session once.” Callers must not import the once-function.

3. **`getGranotDateWindowProblem` is exported and unused outside.** Keep the refuse beat on the collect **interface**. Do not make planning re-validate the same calendar rule in a second copy.

4. **A source with no recognized table fails the whole collect.** Partial success is not a mode. `notObservedSourceLabels` is only “Granot did not list that label,” not “the page failed.” Do not silently change a failed page into not-observed.

5. **`buildGranotOperationPayloads` is a mapper, not a preview.** It does not call `previewCallLeadEnrichment` / `previewBookedCallLeadReconciliation`. Leave that in `automation.ts` / `runWorkflow.ts`. Do not “helpfully” add `ref_no` because the HTML column exists — tests lock the Call-shaped rows clean.

6. **`user` or `rep` → `granot_crm_username`.** Empty strings stay off the payload. Do not invent a third username column.

7. **Do not silently merge preview or apply into this file.** Knowledge already says `runGranotAutomation` lives in `automation.ts` and admin runs live in `runWorkflow.ts`. This pass does not reorder that.

8. **Leave sibling modules alone.** Form planning, source-catalog resolve, plan seal, approved apply, Call Enrichment write, and Booked reconciliation write are already the right **depth**. This file orchestrates HTML + fetch only.

## Testing

The **interface** is the test surface: `collectTheRequestedGranotSourceTables` (today `collectGranotReport`), `readOneGranotSourcePage`, `turnCollectedTablesIntoTheRowsWeAlreadyUse`, `whyThisDateWindowMustNotTalkToGranot`, and `GranotWouldNotGiveUsTheReport`.

Today’s `granotHttpCollector.test.ts` already names both sections + job numbers, nested tables after centered headings, hash ignores session tokens, map to existing Call payloads, never copy `ref_no`, the full report flow + absent sources + `beforeSource`, retry the whole walk on Close Window, and impossible dates never fetch. Keep those. Add the gaps:

**Log into Granot and collect the requested source tables**
- A `USERLIST` link is not a discovered source (add this; today’s happy-path HTML includes one and only asserts the kept label).
- A source page whose body looks like login / security / close window is `invalid_session` and, on the first miss, restarts at network login (already locked for Close Window; keep it).
- A second `invalid_session` is still `invalid_session` — no third walk (add this).
- `schema_drift` does **not** retry the session (add this).
- Missing `job_no`+`customer` headers on a headed table is `schema_drift` / `invalid` (add this).
- A totals row without a numeric `no` is dropped (add this if parse tests start depending on length only).
- Cross-origin redirect is `provider_error` (add this).
- A body over the configured byte cap is `response_too_large` (add this).
- Do not add a test that this path writes a receipt, Lead, Booking, or Call refresh.

**Turn collected tables into the rows we already use**
- Follow Up maps `rep` when `user` is absent (already locked via `rep` in the fixture; keep it).
- Booked Jobs maps `user` to `granot_crm_username` and sets `section: "bookedJobs"` (already locked; keep it).
- Blank cells are omitted (add this if a fixture starts sending empty `email`).
- `ref_no` stays off both Call-shaped arrays (already locked; keep it).
- Do not add a test that the mapper calls preview or sync.

Do **not** add a test per helper (`dropTheRepListLinks`, `didTheSessionDieBeforeWeGotThePage`, `stampUserOrRepAsTheCrmUsername`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Form planning, source-catalog resolve, plan seal, approve, apply, Call Enrichment write, or Booked reconciliation write here. Do not add a test that this file CRM-posts, `$set`s a Lead, or writes `BookedLead`.

## What I would not do

- A `GranotCollectorService` class with `collect` / `parse` / `map` / `create`.
- Thirty two-line functions that only wrap `cheerio.load` or `assignValue`.
- Moving this into a CRUD folder (`login.ts` / `parse.ts` / `map.ts` / `create.ts` / `update.ts`), or into `runWorkflow.ts` / `automation.ts` / `enrichment/` / `reconciliation/` “for cleanliness.”
- Turning today’s collector `index.ts` into an empty barrel so “the folder looks like the others.”
- Calling `previewCallLeadEnrichment`, `previewBookedCallLeadReconciliation`, `updateFormLead`, `syncCallLeadEnrichment`, or `syncBookedCallLeadReconciliation` from this file.
- Copying `ref_no` onto Call-shaped payloads so “Tracking Reference is not lost.”
- Treating a failed source page as `notObservedSourceLabels` so “the run can finish.”
- Retrying `schema_drift` / `provider_error` so “maybe the table comes back.”
- Logging credentials, cookies, or form bodies.
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` do not define the collector.
- Writing a whole-folder recommendation for `granotHttpCollector`.
