# Walk The Latest Uploaded Granot CSVs, Dry-Run By Default, Then Apply Form Quoted/Cuft, Follow Up Enrichment, Or Booked Reconciliation Only When Asked — Never Create A Lead From Here — operational story

- Status: recommended
- Service: `granotCrmCsv` (Wave A, in-progress)
- Pass: 2 of this service — `sync.service.ts`
- Remaining in this service: `registry.ts`, `parser.ts`
- Target: `src/services/granotCrmCsv/sync.service.ts`
- Knowledge: none as a dedicated Service file. Software map: [`.cursor/rules/granot-crm-csv-s3-sync.mdc`](../../../.cursor/rules/granot-crm-csv-s3-sync.mdc) — apply selects the latest `status: "uploaded"` ingestion per `workspace_slug + csv_kind`, dry-runs unless `--apply`, and is **lower priority** than the extension’s DOM sync (the page shows Job Numbers the CSV often omits). That rule still names `scripts/granot_crm_csv/sync-from-s3.ts`; **that script is not on this checkout** and `package.json` has no `granot*csv*` command — the apply export is `runGranotCrmCsvSync`. Distinct from store-the-download (history / latest / meta / ingestion row, no Lead write): [recommendations/granot-crm-csv-upload.md](granot-crm-csv-upload.md). Distinct from leftover CSV source seed/list/ensure: later `registry.ts`. Distinct from Owner Registry Granot CRM Source write / lifecycle / outbound SMS: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) + admin `/api/v1/admin/granot-crm-sources*`. Distinct from HTTP session collect (live tables, Job Numbers on the page): [recommendations/granot-http-collector-index.md](granot-http-collector-index.md). Distinct from durable HTTP automation run / approved apply: [recommendations/granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md) + [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from HTTP Form identity (exact `FormLead.ref_no`, then Mongo `_id`): [recommendations/granot-http-collector-form-lead-matcher.md](granot-http-collector-form-lead-matcher.md). Distinct from Form Lead Correction write: [recommendations/form-lead.md](form-lead.md) (`updateFormLead` is the **adapter** this file already calls). Distinct from Follow Up refresh / Booked Call reconciliation write: [recommendations/enrichment-call-lead-enrichment.md](enrichment-call-lead-enrichment.md) / [recommendations/reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md) (this file hands one mapped row to preview or sync). Distinct from leftover CSV parse / row identity: later `parser.ts`. This checkout’s `CONTEXT.md` does not define Granot CRM CSV ingestion / S3 latest object / sync run — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **zero runtime import sites besides the barrel. No test file for this module. No HTTP route. No script on this checkout.** Barrel: `granotCrmCsv/index.ts` re-exports `runGranotCrmCsvSync`. Public v1 owns `GET /api/v1/granot-crm/csv/sources` (sibling seed/list) and `POST /api/v1/granot-crm/csv/uploads` (sibling store) only — there is no `/csv/sync`. Not callers: `upload.service.ts` (writes the ingestions this file later reads), `registry.ts` / `parser.ts` / `keys.ts` / `storage.ts` (this file imports parse + `getGranotCrmObjectText`), public Form/Call write, HTTP automation collect/apply, Owner Registry Granot CRM Source write. Knowledge that already names this file as a caller of siblings: [`docs/knowledge/services/form-lead-search.md`](../../../docs/knowledge/services/form-lead-search.md) (`resolveFormLead` ObjectId skip), [`docs/knowledge/services/enrichment.md`](../../../docs/knowledge/services/enrichment.md) (`syncCallLeadEnrichment` remains the CSV Follow Up write), [`docs/knowledge/services/booked-call-lead-reconciliation.md`](../../../docs/knowledge/services/booked-call-lead-reconciliation.md) (booked `csv_kind` → preview/sync). Folder tests lock parse and S3 key folds only (`parser.test.ts`, `keys.test.ts`) — they do not import this file.
- Seams callers need: dry-run (default) vs apply (the load-bearing write **seam**); latest `uploaded` ingestion per workspace + kind vs an arbitrary S3 key; Form quoted/cuft correction vs Follow Up Call refresh vs Booked Call reconciliation; store-the-file (sibling upload) vs walk-the-latest-file (this file); this S3 path vs extension DOM sync (Job Numbers on the page); ObjectId `ref_no` treated as Form `_id` (this file) vs exact `FormLead.ref_no` then Mongo `_id` (HTTP matcher); public `updateFormLead` after-commit sheets (this file already uses it) vs Domain Command `begin` / `complete` (not this folder)
- Split later (only if the file outgrows one sitting): keep one file — this ~400-line module is one screenplay for “walk the latest uploaded Granot CSVs, dry-run by default, then apply Form quoted/cuft, Follow Up enrichment, or Booked reconciliation only when asked.” If it later splits: `openTheLatestUploadedGranotCsvPass.ts` / `correctQuotedAndCubicFeetOnTheMatchedFormLead.ts` / `refreshTheFollowUpCallLeadFromTheCsvRow.ts` / `reconcileTheBookedCallLeadFromTheCsvRow.ts` — story files, never `create.ts` / `update.ts` / `sync.ts` / `delete.ts`, and never merge S3 store, leftover catalog ensure, CSV parse, or the enrichment / reconciliation **modules** into this file

`runGranotCrmCsvSync` is executor mechanics. The owner question is: *The latest Follow Up or Booked CSV is already stored. Open a pass. Read each latest file. For a row that looks like a Form Lead, match it and say whether quoted / cubic feet would change — write those two fields only when apply is on. For a Follow Up Call row, preview or sync enrichment. For a Booked Call row, preview or sync booked reconciliation. Close the pass with counts. This file does not store a download. This file does not create a Lead. This file does not equal the extension’s DOM sync.*

Store, leftover catalog, CSV parse / row identity, S3 get, Form Lead Correction, Follow Up refresh, and Booked reconciliation already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “walk the latest uploaded CSVs, dry-run unless asked to apply” story, not “a sync CRUD service,” and not the earlier store:

1. **Open a dry-run or apply pass over the latest uploaded Granot CSVs** — insert a `granot_crm_sync_runs` row as `running` (`dry_run` unless `apply: true`). Load every `status: "uploaded"` ingestion (optional workspace / kind filter), keep the newest per `workspace_slug + csv_kind`, read `s3_latest_key` as text (sibling), parse (sibling), optionally slice the first `limit` rows **per file**. Walk each row. When the walk finishes, stamp `completed`, counts, ingestion ids, and up to 25 failed messages. When the walk throws, stamp `failed` and **rethrow**. This function does not put an S3 object. This function does not invent an HTTP route.

2. **Correct a matched Form Lead’s quoted / cubic feet when the CSV disagrees** — a row is a Form row when `ref_no` is a Mongo ObjectId (`looksLikeFormLead`). Treat that string as `_id` and skip search. Otherwise search by phone + email + name, limit 10 (sibling). Ambiguous search is `conflict`. No hit is `no_match`. There is **no** exact `FormLead.ref_no` lookup here. Build a two-field patch from Granot `prior` (`0` → `quoted: false`; `1` or `5` → `quoted: true` plus `cubic_feet` from `est_cf` when it parses). Empty patch → `skipped`. Missing live lead → `no_match`. Duplicate Lead → `duplicate` (no write). Same values already stored → `unchanged`. Apply calls public `updateFormLead` (sibling Form Lead Correction: booking-chain refresh and Sheet Sync after the write). Dry-run does **not** call it. This function does not create a Form Lead. This function does not book from `prior: "5"`.

3. **Refresh a Follow Up Call Lead from the CSV row** — when the row is not a Form row and the file is not `booked`, map cells (`job_no`, source, customer, phone, email, zips, `est_cf`) and call `previewCallLeadEnrichment` or `syncCallLeadEnrichment` (sibling). Map the sibling’s row card onto this pass’s outcome. This function does not parse Follow Up eligibility. This function does not invent a phone-only Job Number.

4. **Reconcile a Booked Call Lead from the CSV row** — when the row is not a Form row and `csv_kind === "booked"`, spread the Follow Up cells plus `section: "bookedJobs"`, `prior`, and `book_date`, then call `previewBookedCallLeadReconciliation` or `syncBookedCallLeadReconciliation` (sibling). Booked rows without `job_no` stay `invalid` inside that sibling — this file must not guess from phone. This function does not create a Booking.

There is no fifth mutate operation. `countOutcomes` / `stringCell` / `parseNumber` are folds. Classification (`looksLikeFormLead` then booked vs follow-up) is a beat of the walk, not a public export.

## Organization

Keep one file as the screenplay for “walk the latest uploaded Granot CSVs, dry-run by default, then apply Form quoted/cuft, Follow Up enrichment, or Booked reconciliation only when asked.” Parse, S3 get, Form Lead Correction, Follow Up refresh, and Booked reconciliation already live in deeper **modules**. Do not pull those in. Do not invent a `GranotCrmCsvSyncService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — there is no Domain Command and no Mongo transaction across S3 get + sibling writes. Do not invent a second enrichment **adapter** beside `previewCallLeadEnrichment` / `syncCallLeadEnrichment`. Do not invent a second booked **adapter** beside the reconciliation preview/sync pair.

Do not move this into `upload.service.ts` so “store and apply are one sitting.” Do not move this into `registry.ts` so “the catalog owns the pass.” Do not move Form quoted/cuft into `formLead.service.ts` so “correction owns CSV.” Do not move the walk into enrichment or reconciliation so “CSV is just another batch caller.” Do not split `create.ts` / `update.ts` / `dryRun.ts` / `apply.ts`. Do not silently add the missing `sync-from-s3.ts` script so the software rule “wins.” Do not silently add `POST /api/v1/granot-crm/csv/sync` so “apply has a route.” Do not silently teach Form match to use exact `FormLead.ref_no` so “CSV and HTTP share one ladder.”

**External interface** stays small (this is the test surface). Open-the-pass, Form quoted/cuft, Follow Up refresh, and Booked reconciliation are one story’s walk, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runGranotCrmCsvSync` | `walkTheLatestUploadedGranotCsvsAndProposeOrApplyRowUpdates` | the only public export; dry-run vs apply is the write **seam**; no HTTP **adapter** on this checkout |

Keep the old name as a one-line alias until a later script or route points at the story name. Do not make callers learn `findLatestIngestions` / `processRow` / `mapCallStatus` as the domain language.

**Principle: old exports stay as aliases.** `runGranotCrmCsvSync` remains the imported name until the barrel migrates.

**No class for the workflow.** The type that *does* earn a name is the open pass we hand from insert to close:

```ts
type GranotCrmCsvPassInProgress = {
  run_id: string
  mode: "dry_run" | "apply"
  // today's running GranotCrmSyncRun document
}
```

That is the handoff from “we opened a card” to “we walked latest files and must complete or fail it.” Do **not** put parsed rows on that object so “ops can replay the body,” do **not** add a per-row HTTP preview so “CSV matches the extension POST,” and do **not** add a create-if-missing flag so “no_match can become a Lead.”

`GranotCrmCsvSyncOptions` / `GranotCrmCsvSyncResult` / `GranotCrmCsvRowOutcome` stay on this file until a later types pass. Do not move them onto sibling `types.ts` “so the folder owns the card.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sync.service.ts
// The latest Follow Up or Booked CSV is already stored.
// Open a pass. Read each latest file.
// Dry-run by default.
// A Form row may correct quoted / cubic feet.
// A Follow Up Call row may refresh the Call Lead.
// A Booked Call row may reconcile the Call Lead / Booking.
// Write only when apply is on.
// This file does not store a download.
// This file does not create a Lead.
// This file is not the extension's DOM sync.

// ── 1. Open a dry-run or apply pass over the latest uploaded CSVs ─

export async function walkTheLatestUploadedGranotCsvsAndProposeOrApplyRowUpdates(options)

async function openTheGranotCsvPass(options)                    // running card; dry_run unless apply
async function findTheLatestUploadedIngestionPerWorkspaceAndKind(options)
async function readAndParseTheLatestCsv(ingestion)              // sibling get + parse
function takeOnlyTheFirstLimitRows(rows, limit)                 // per file, not global
async function walkEachRow(ingestion, row, options)
async function completeThePass(pass, ingestions, outcomes)
async function failThePassAndRethrow(pass, error)

function thisRowLooksLikeAFormLead(row)                         // ObjectId ref_no; not exact FormLead.ref_no

// ── 2. Correct quoted / cubic feet on the matched Form Lead ──

async function correctQuotedAndCubicFeetOnTheMatchedFormLead(ingestionId, row, options)

async function matchTheFormLeadForThisCsvRow(row)               // ObjectId skip, else search limit 10
function buildTheQuotedAndCubicFeetPatch(row)                   // prior 0 / 1 / 5; est_cf
function refuseWhenTheFormLeadIsADuplicate(lead)
function nothingQuotedOrCubicFeetChanged(lead, patch)
async function applyTheFormCorrectionWhenAsked(leadId, patch)   // sibling updateFormLead
function rememberADryRunWouldCorrectQuotedOrCubicFeet(lead, changes)  // do not call this "unchanged"

// ── 3. Refresh a Follow Up Call Lead from the CSV row ───────

async function refreshTheFollowUpCallLeadFromTheCsvRow(ingestionId, row, options)
  // preview unless apply → sibling syncCallLeadEnrichment
function mapTheFollowUpCells(row)                               // omits from / to / granot_crm_username

// ── 4. Reconcile a Booked Call Lead from the CSV row ────────

async function reconcileTheBookedCallLeadFromTheCsvRow(ingestionId, row, options)
  // preview unless apply → sibling syncBookedCallLeadReconciliation
function mapTheBookedCells(row)                                 // Follow Up cells + bookedJobs + prior + book_date
function foldTheSiblingCallStatusOntoThisPass(status)           // updateable is not "already matches"
```

Read the primary path out loud: *Open a dry-run pass unless the owner asked to apply. Find the newest uploaded Follow Up and Booked files per workspace. Read latest.csv. Parse. For each row: if Granot `ref_no` looks like a Mongo id, treat it as a Form Lead and say whether quoted / cubic feet would change — write those two fields only on apply, through the ordinary Form correction path. Otherwise, if the file is Booked, preview or sync booked reconciliation. Otherwise preview or sync Follow Up enrichment. Close the pass with counts. Stop. Do not store a new download. Do not create a Lead. Do not guess a Job Number the CSV omitted.*

That is the operation. `runGranotCrmCsvSync` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Dry-run Form corrections lie as `unchanged`.** When `apply` is off and quoted / cubic feet would change, the card still sets `status: "unchanged"` and only the message says “Dry run would update.” Call rows map sibling `updateable` to `unchanged` the same way. The owner cannot count “would write” vs “already matches.” Name a dry-run beat (`rememberADryRunWouldCorrectQuotedOrCubicFeet`). Do not silently add an `updateable` status so “the enum matches enrichment” in this rename — that is a later, tested contract change.

2. **`resolveFormLead` reports `status: "no_match"` on a hit.** A valid ObjectId `ref_no` returns `leadId` plus `status: "no_match"` and message “Matched by Granot ref_no.” The Form walker only reads `leadId`. The status field is leftover. Do not start treating that status as a real miss.

3. **ObjectId `ref_no` skips exact Tracking Reference lookup.** HTTP Form identity tries exact `FormLead.ref_no` first, then Mongo `_id`. This file treats `mongoose.isValidObjectId(ref_no)` as `_id` and never looks up the `ref_no` field. CONTRADICTIONS already records that gap. Do not skip the exact field so “CSV and HTTP share one ObjectId path,” and do not add the HTTP ladder here so “one matcher wins.”

4. **A Booked or Follow Up row with an ObjectId `ref_no` never reaches Call apply.** `looksLikeFormLead` wins before `csv_kind === "booked"`. A Booked Jobs row that happens to carry a 24-hex `ref_no` is forced through quoted/cuft, not booked reconciliation. Do not flip that order so “kind always wins” in this rename — name the steal (`thisRowLooksLikeAFormLead`) so it stays visible.

5. **`findTheLatestUploadedIngestionPerWorkspaceAndKind` loads every uploaded row.** Sort by `uploaded_at` desc, then first-per-key in memory. Do not silently add a Mongo distinct / window so “it scales,” and do not start selecting arbitrary S3 keys so “ops can replay an old history object.”

6. **`limit` is per file, not per pass.** Two latest ingestions with `limit: 10` can walk twenty rows. Do not change that to a global cap so “the option sounds honest.”

7. **Public `updateFormLead` already runs the Form correction after-commit work.** Apply is not a raw `findById` + `save`. Do not switch to `updateFormLeadInTransaction` or a Domain Command so “CSV is canonical.” Do not inline quoted/cuft writes so “we skip Sheet Sync.”

8. **Mapped Call cells omit `from`, `to`, and `granot_crm_username`.** HTTP collect sends those three. This file does not. Do not copy the HTTP map so “CSV and collect match,” and do not drop `job_no` so “the CSV often lacks it anyway.” Booked rows without `job_no` must stay `invalid` inside the sibling.

9. **A thrown walk leaves the run `failed` only when `catch` runs.** A process crash leaves `running`. Do not invent a lease / recover so “stuck runs die,” and do not delete the `failed` + rethrow — callers that exist later need the throw.

10. **No test imports this file. No script imports this file. No route imports this file.** The software rule still names `scripts/granot_crm_csv/sync-from-s3.ts`. That path is not on this checkout. Do not invent the script so the rule “wins,” and do not call this walk from upload so “one HTTP hit stores and writes Leads.”

11. **Leave sibling modules alone.** `getGranotCrmObjectText`, `parseGranotCsv`, `searchFormLeads`, `updateFormLead`, `previewCallLeadEnrichment` / `syncCallLeadEnrichment`, `previewBookedCallLeadReconciliation` / `syncBookedCallLeadReconciliation` are already the right **depth**. This file orchestrates them. Owner Registry `createOrUpdateGranotCrmSource` is a different write.

## Testing

The **interface** is the test surface: `walkTheLatestUploadedGranotCsvsAndProposeOrApplyRowUpdates` (today `runGranotCrmCsvSync`).

There is no `sync.service.test.ts`. Replace “we tested the parser keys” with tests that name the operation:

**Open the pass**
- `apply` omitted or false → `mode: "dry_run"` and no sibling write export is called.
- `apply: true` → `mode: "apply"`.
- Two uploaded ingestions for the same workspace + kind → only the newest `s3_latest_key` is read.
- `workspace` / `csvKind` filter the ingestion query; an `uploaded` row of the other kind is not walked.
- `limit: 1` slices that file’s parsed rows only.
- A thrown S3 get stamps the run `failed` and rethrows.

**Form quoted / cubic feet**
- ObjectId `ref_no` does not call `searchFormLeads`.
- Non-ObjectId `ref_no` with an ambiguous search → `conflict`, no `updateFormLead`.
- `prior: "0"` would set `quoted: false`; `prior: "1"` / `"5"` would set `quoted: true` and `cubic_feet` when `est_cf` parses.
- Duplicate Lead → `duplicate`, no write.
- Same stored values → `unchanged`, no write.
- Dry-run with a real patch does **not** call `updateFormLead` (today’s card may still say `unchanged` — lock the current message; do not invent `updateable` in the test).
- Apply with a real patch calls `updateFormLead` once and returns `updated`.
- Does not create a Form Lead on `no_match`.

**Follow Up / Booked Call**
- Non-ObjectId Follow Up row calls `previewCallLeadEnrichment` when dry-run and `syncCallLeadEnrichment` when apply.
- Non-ObjectId Booked row calls booked preview/sync and sends `section: "bookedJobs"`.
- ObjectId `ref_no` on a Booked file does **not** call booked reconciliation (today’s steal).
- Booked sibling `invalid` (missing `job_no`) is counted as `invalid` / `no_match` per today’s `mapCallStatus` — do not guess a phone-only Job Number.

**What this file must not do**
- Does not call `uploadGranotCrmCsv` or `putGranotCrmObject`.
- Does not call `createFormLead` / `createCallLead` / booking create.
- Does not import HTTP collect / approved apply.

Do **not** add a test per helper (`stringCell`, `parseNumber`, `countOutcomes`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

There is no second public **adapter**. A later script or route is a new **adapter**; do not invent it in this pass.

## What I would not do

- A `GranotCrmCsvSyncService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `previewCallLeadEnrichment` or `updateFormLead`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `sync.ts` / `dryRun.ts` / `apply.ts`) for cleanliness.
- Breaking the dry-run / apply **seam**, or silently writing on dry-run so “the run is useful.”
- Treating `uploadGranotCrmCsv`, leftover catalog ensure, HTTP collect, Owner Registry Granot CRM Source write, Form Lead Ingestion, or Granot `createLeadFromGranot` as this story.
- Inventing a Domain Command `begin` / `complete` **seam** that has only one **adapter**.
- Inventing a second enrichment or booked **adapter** beside the sibling preview/sync pairs.
- Presenting this S3 apply as equivalent to the extension’s DOM sync while Follow Up / Booked CSVs can omit `job_no`.
- Inventing `scripts/granot_crm_csv/sync-from-s3.ts` or `POST /api/v1/granot-crm/csv/sync` so the software rule matches disk.
- Silently teaching Form match to use exact `FormLead.ref_no`, or flipping Form-vs-kind order, so CSV and HTTP “share one ladder.”
- Jumping to `crm` while `registry.ts` or `parser.ts` are unchecked.
- Writing a whole-folder recommendation for `granotCrmCsv`.
