# Collect The Requested Tables And Optionally Preview What Those Follow Up And Booked Jobs Rows Would Do — No Run Document — operational story

- Status: recommended
- Service: `granotHttpCollector` (Wave A, in-progress)
- Pass: 2 of this service — `automation.ts`
- Remaining in this service: `sourceCatalog.ts`, `formWorkflow.ts`, `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `runWorkflow.ts`
- Target: `src/services/granotHttpCollector/automation.ts`
- Knowledge: [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) — one line: `runGranotAutomation` is the standalone collect/preview helper (no run document); admin runs use `runWorkflow.ts`. Primary `applies_to` lists `index.ts`, `runWorkflow.ts`, `sourceCatalog.ts`, `formWorkflow.ts`, `lifecycleStatement.ts`, the admin/cron routers, and the queue consumer — **not this file**. Distinct from the session walk + row map: [recommendations/granot-http-collector-index.md](granot-http-collector-index.md). Distinct from admin create / plan / approve / worker: later `runWorkflow.ts`. Distinct from fail-closed source resolve: later `sourceCatalog.ts`. Distinct from Form planning: later `formWorkflow.ts`. Distinct from Form match: later `granotFormLeadMatcher.ts`. Distinct from plan seal: later `lifecycleStatement.ts`. Distinct from approved apply (receipt + `claimAndProcessOrPoll`): [`docs/knowledge/granot-lifecycle/automation-apply.md`](../../../docs/knowledge/granot-lifecycle/automation-apply.md) + [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from Call Lead Enrichment write: [recommendations/enrichment-call-lead-enrichment.md](enrichment-call-lead-enrichment.md). Distinct from Booked Call Lead Reconciliation write: [recommendations/reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md). Software map: `.cursor/rules/granot-http-automation.mdc`. Folder note: `src/services/granotHttpCollector/HANDOFF.md` calls this “legacy direct collect/call-preview orchestration retained for compatibility and focused collector tests.” This checkout’s `CONTEXT.md` does not define Granot HTTP collector / Call Lead Enrichment / Observation Receipt — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **zero runtime import sites today.** Knowledge still names this as the standalone helper. `scripts/granot-automation/run-local.ts` (`pnpm granot:collect`) does **not** import it — it calls `collectGranotReport` and **copies** the booked-jobs / follow-up / `rowsWithJobNo` summary this file already builds. Admin HTTP / worker / approve import `runWorkflow.ts`, not this file. `granotHttpCollector.test.ts` imports `index.ts` only. Not callers: `sourceCatalog.ts`, `formWorkflow.ts`, `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `granotLifecycle/automationApply.ts`, public Form/Call write, CSV sync, `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`.
- Seams callers need: collect-only (counts) vs also-preview (same collect, then existing preview functions); counts-only vs `includeRows` dump of mapped payloads + full preview cards; batches of 100 (public preview Zod max) vs admin planning’s one-row-plus-binding walk; no-run-document helper vs durable `GranotAutomationRun`; preview-only vs approved apply
- Split later (only if the file outgrows one sitting): keep one file — this ~133-line module is one screenplay for “collect the requested tables and optionally preview what those Follow Up and Booked Jobs rows would do, without a run document.” If it later splits: `collectTheRequestedTablesAndCountWhatCameBack.ts` / `previewTheMappedCallRowsInPublicSizedBatches.ts` — story files, never `collect.ts` / `preview.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge admin plan, approve, apply, Form match, or source-catalog resolve into this file

`runGranotAutomation` is executor mechanics. The owner question is: *Someone asked for a real calendar window and some Granot source labels, and they did not create an admin run. Collect the tables. Count booked jobs, follow-up estimates, and rows that have a job number. If they also asked to preview, turn those tables into the enrichment and booked-reconciliation rows the company already uses, walk them in batches of 100 through the existing preview functions, and count how many rows landed in each preview status. Hand back counts by default. Do not write a Lead. Do not capture a receipt. Do not persist a run.*

Session collect, row mapping, Form planning, source-catalog resolve, plan seal, durable admin runs, and approved apply already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “collect, then optionally preview the Call-shaped rows — no run document” story, not “a Granot automation CRUD service,” and not the admin run:

1. **Collect the requested tables and count what came back** — always. Call `collectTheRequestedGranotSourceTables` (today `collectGranotReport`) with the same window, labels, filters, and fetch **adapter**. Then fold each source into `{ sourceLabel, contentHash, bookedJobs, followUpEstimates, rowsWithJobNo }`. Keep the discovered labels and the labels Granot did not list. Default `mode` is `collect`. This function does not preview. This function does not write a run document.

2. **Optionally preview what those Follow Up and Booked Jobs rows would do** — only when `mode === "preview"`. Map the collected tables through `turnCollectedTablesIntoTheRowsWeAlreadyUse` (today `buildGranotOperationPayloads`). Walk Follow Up rows through `previewCallLeadEnrichment` and Booked Jobs rows through `previewBookedCallLeadReconciliation` in slices of 100 — the same max the public `/call-leads/enrichment/preview` and `/call-leads/booked-reconciliation/preview` Zod schemas already enforce. Count each preview `status`. Attach the mapped payloads and the full preview cards only when `includeRows` is on; otherwise the answer is counts. This function does not call `syncCallLeadEnrichment` or `syncBookedCallLeadReconciliation`. This function does not plan Form Leads. This function does not bind a target receiver. This function does not seal a plan.

There is no third mutate operation. `summarizeCollection` / `summarizeStatuses` / `runInBatches` are folds, not public stories. `mode: "collect"` still maps the tables in memory today, then throws the payloads away unless `includeRows` is on — that is a smell, not a third operation.

## Organization

Keep one file as the screenplay for “collect the requested tables and optionally preview what those Follow Up and Booked Jobs rows would do, without a run document.” Session walk, row map, Form planning, source-catalog resolve, plan seal, durable admin runs, and approved apply already live in deeper **modules**. Do not pull those in. Do not invent a `GranotAutomationService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — there is no Mongo write. Do not invent a notify **seam**. Do not invent a second HTTP **adapter** beside the collector’s `dependencies.fetch`.

Do not move this into `runWorkflow.ts` so “preview lives with the run.” Do not move this into `index.ts` so “collect and preview are one sitting.” Do not move this into `enrichment/` or `reconciliation/` so “the batch loop lives with the writes.” Do not split `collect.ts` / `preview.ts` / `create.ts`. Do not delete the file because it currently has zero importers — the knowledge line and the copied local-script summary are the compatibility **seam**.

**External interface** stays small (this is the test surface). Collect-and-count and optionally-preview are one story’s walk and handoff, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runGranotAutomation` | `collectTheRequestedTablesAndOptionallyPreviewTheCallRows` | documented standalone helper; future `pnpm granot:collect` / a local preview should call this instead of copying the summary |
| `GranotAutomationMode` | `CollectOnlyOrAlsoPreview` | `collect` (counts) vs `preview` (same collect + existing preview functions) |
| `GranotAutomationResult` | `WhatTheStandaloneCollectShowed` | mode + collection counts + optional payloads / preview cards / status counts |

Keep the old names as one-line aliases until a script or test points at the story names. Do not make callers learn `runInBatches` / `summarizeCollection` / `summarizeStatuses` as the domain language.

**Principle: old exports stay as aliases.** `runGranotAutomation` remains the imported name until a real caller exists and migrates.

**No class for the workflow.** The type that *does* earn a name is the counts we hand back without a run document:

```ts
type WhatTheStandaloneCollectShowed = {
  mode: "collect" | "preview"
  collection: {
    requestedDateWindow: { from: string; to: string }
    discoveredSourceLabels: string[]
    notObservedSourceLabels: string[]
    sources: Array<{
      sourceLabel: string
      contentHash: string
      bookedJobs: number
      followUpEstimates: number
      rowsWithJobNo: number
    }>
  }
  payloads?: { enrichmentRows: unknown[]; bookedReconciliationRows: unknown[] }
  operationSummary?: {
    enrichment: Record<string, number>
    bookedReconciliation: Record<string, number>
  }
  operations?: {
    enrichment: unknown[]
    bookedReconciliation: unknown[]
  }
}
```

That is the handoff from “we collected (and maybe previewed) without creating a run” to “an operator or a later script can read the counts.” Do **not** add a `run_id`, approval, or checksum so “it looks like the admin run,” and do **not** attach credentials, cookies, or raw HTML so “ops can replay the session.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// automation.ts
// Someone asked for a real calendar window and some Granot source labels.
// They did not create an admin run.
// Collect the tables. Count booked jobs, follow-up estimates,
// and rows that have a job number.
// If they also asked to preview, turn those tables into the
// enrichment and booked-reconciliation rows the company already uses,
// walk them in batches of 100 through the existing preview functions,
// and count how many rows landed in each preview status.
// Counts by default. Full rows only if they asked.
// This file does not write a Lead. This file does not capture a receipt.
// This file does not persist a run. This file does not plan Form Leads.

// ── 1. Collect the requested tables and count what came back ──

export async function collectTheRequestedTablesAndOptionallyPreviewTheCallRows(
  ask,
  howToTalk,
)

function countWhatEachCollectedSourceBroughtBack(tables)

// ── 2. Optionally preview what those Call-shaped rows would do ──

async function previewTheMappedCallRowsInPublicSizedBatches(payloads)
function walkThisPreviewInBatchesOfOneHundred(rows, previewFn)  // public Zod max 100
function countHowManyRowsLandedInEachPreviewStatus(cards)
```

Read the preview path out loud: *collect the requested tables. Count what each source brought back. If this is only a collect, stop there — unless someone asked for the mapped rows. If this is a preview, turn Follow Up into enrichment rows and Booked Jobs into booked-reconciliation rows, walk each list in batches of 100 through the preview the company already uses, count the statuses, and keep the full cards off the answer unless they asked for the dump. Do not write. Do not open a run.*

That is the operation. `runGranotAutomation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Zero runtime callers.** Knowledge and HANDOFF still treat this as the standalone helper. `pnpm granot:collect` copies `countWhatEachCollectedSourceBroughtBack` instead of calling this file. The collector tests never import it. Keep the export. Point the local script at this story later — do not silently delete the file “because nothing imports it.”

2. **`runGranotAutomation` lies.** It does not create a `GranotAutomationRun`, does not approve, does not apply, and does not touch Form planning. The name should say “collect, then optionally preview the Call-shaped rows, no run document.”

3. **`mode: "collect"` still maps the tables.** `buildGranotOperationPayloads` always runs, then the payloads are dropped unless `includeRows`. Collect-only should not map. Preview (or an explicit “include the mapped rows”) should.

4. **Batches of 100 are the public preview contract, not a magic number.** HTTP Zod is `.min(1).max(100)` on both preview bodies. The service functions themselves accept any length. Name the child `walkThisPreviewInBatchesOfOneHundred` so a later change to the public max is visible. Empty lists must not call preview with `{ rows: [] }` if a later Zod reuse would reject `min(1)` — today’s loop already skips empty.

5. **This preview is not the admin Call plan.** `planCallWorkflow` walks **one row at a time**, builds a target-receiver binding, marks `syncable`, and later seals schema v2. This file batches 100, has no binding, and has no plan. Do not “helpfully” add `target_binding` or `action_id` here.

6. **Preview always walks both Follow Up and Booked Jobs.** There is no `form_leads` / `call_leads` switch. Do not add Form planning so “automation means both workflows.”

7. **`includeRows` is a dump flag.** Default answer is counts (`collection` + `operationSummary`). Full mapped rows and full preview cards stay optional. Do not default them on so “the operator can debug.”

8. **Do not silently merge this into `runWorkflow.ts` or `index.ts`.** Knowledge already splits standalone helper vs admin run vs session walk. This pass does not reorder that.

9. **Leave sibling modules alone.** Session collect, row map, Form planning, source-catalog resolve, plan seal, approved apply, Call Enrichment write, and Booked reconciliation write are already the right **depth**. This file orchestrates collect → count → optional preview only.

## Testing

The **interface** is the test surface: `collectTheRequestedTablesAndOptionallyPreviewTheCallRows` (today `runGranotAutomation`).

Today **no test file imports this module.** `granotHttpCollector.test.ts` locks the session walk and the row map on `index.ts`. That is the collector **interface**, not this one. Add tests that name this operation. Inject `dependencies.fetch` (collector **adapter**) and stub the two preview functions — do not re-test HTML parse or Follow Up match here.

**Collect the requested tables and count what came back**
- A happy collect returns `mode: "collect"`, the requested window, discovered / not-observed labels, and per-source booked-jobs / follow-up / `rowsWithJobNo` counts (the same shape `pnpm granot:collect` prints today).
- Collect-only does **not** call `previewCallLeadEnrichment` or `previewBookedCallLeadReconciliation`.
- Collect-only does **not** attach `payloads` unless `includeRows` is on.
- Collect-only does **not** attach `operationSummary` or `operations`.
- A collector throw (`invalid_request` / `invalid_session` / `schema_drift`) is the same `GranotCollectorError` the session walk already throws — do not wrap it.
- Do not add a test that collect writes a run document, receipt, Lead, Booking, or Call refresh.

**Optionally preview what those Call-shaped rows would do**
- Preview mode calls Follow Up preview with the mapped enrichment rows and Booked Jobs preview with the mapped booked-reconciliation rows.
- More than 100 Follow Up rows becomes two preview calls (100 + remainder). Same for Booked Jobs. Empty Follow Up does not call enrichment preview.
- `operationSummary.enrichment` / `bookedReconciliation` count `status` values (already the fold).
- Without `includeRows`, `payloads` and `operations` stay off the result; with `includeRows`, both mapped rows and full preview cards are present.
- Preview still does **not** call `syncCallLeadEnrichment` or `syncBookedCallLeadReconciliation`.
- Do not add a test that this path writes a receipt, Lead, Booking, plan checksum, or `GranotAutomationRun`.

Do **not** add a test per helper (`countWhatEachCollectedSourceBroughtBack`, `walkThisPreviewInBatchesOfOneHundred`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test session login, HTML parse, `ref_no` omission, Form planning, source-catalog resolve, plan seal, approve, apply, Call Enrichment write, or Booked reconciliation write here.

## What I would not do

- A `GranotAutomationService` class with `collect` / `preview` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `collectGranotReport` or `Object.assign`.
- Moving this into a CRUD folder (`collect.ts` / `preview.ts` / `create.ts` / `update.ts`), or into `runWorkflow.ts` / `index.ts` / `enrichment/` / `reconciliation/` “for cleanliness.”
- Deleting the file because it currently has zero importers.
- Calling `syncCallLeadEnrichment`, `syncBookedCallLeadReconciliation`, `updateFormLead`, or `applyAutomationPlanAction` from this file.
- Persisting a `GranotAutomationRun`, checksum, or approval so “the helper matches the admin run.”
- Adding Form planning or a target-receiver binding so “preview means plan.”
- Defaulting `includeRows` on so “ops can see the dump.”
- Treating a failed collect as an empty preview so “the helper can finish.”
- Logging credentials, cookies, or mapped phone/email dumps.
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` do not define the collector.
- Writing a whole-folder recommendation for `granotHttpCollector`.
