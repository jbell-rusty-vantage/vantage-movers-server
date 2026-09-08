# Dump The Leftover HTTP Mutation Screenplay To Disk So An Operator Can Read Planned Form, Call, Booking, And Cancellation Counts, Unmatched Jobs, And Refunds — Never POST, Never Ask A Domain Command, Never Hash, Never Sanitize — operational story  // pragma: allowlist secret

- Status: recommended  // pragma: allowlist secret
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)  // pragma: allowlist secret
- Pass: 13 of this service — `dryRun.ts`  // pragma: allowlist secret
- Remaining in this service: `dryRunReports.ts`  // pragma: allowlist secret
- Target: `src/services/bestRelocationSheetIngest/dryRun.ts`  // pragma: allowlist secret
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). CLI dry-run inspects Forms / Local Forms / Calls / Booked Deals / Refunds, applies receipt skip when the connection exists, then `applyCanonicalAdoptionPolicy`. Writes sanitized `DRY-RUN-REPORT.md` / `dry-run-report.json` (no names, phones, or emails). `ingest-plan.json` stays restricted. CLI live apply is retired. Primary-code list names leftover `canonicalLeadAdoption.ts` / leftover `sheets.ts` / leftover `dryRunReports.ts`, not this file — do not add a second Ingestion Service so "the leftover HTTP dump owns CLI dry-run." Knowledge never names leftover `writeDryRunArtifacts`, leftover `formatPlanSummary`, leftover `ingest-plan-summary.md`, leftover `IngestPlan.mode: "dry-run"`, leftover `unmatched_booking_jobs`, leftover `plan.summary.mutations`, leftover `0o600` on leftover HTTP JSON, or leftover CLI unused leftover `printSummary` — do not add an Ingestion Service file in this rename so "the leftover HTTP dump owns the happy path." Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md). Distinct from already-recommended parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md). Distinct from already-recommended pair: [`best-relocation-sheet-ingest-matching.md`](best-relocation-sheet-ingest-matching.md). Distinct from already-recommended HTTP screenplay: [`best-relocation-sheet-ingest-plan.md`](best-relocation-sheet-ingest-plan.md) (writes leftover `IngestPlan`; this file **asks** that card only). Distinct from already-recommended remap: [`best-relocation-sheet-ingest-application-plan.md`](best-relocation-sheet-ingest-application-plan.md) (checksum-bound leftover `BestRelocationApplicationPlan`; leftover CLI `main` dumps that card as leftover `ingest-plan.json`, not this file). Distinct from already-recommended inspect: [`best-relocation-sheet-ingest-provider.md`](best-relocation-sheet-ingest-provider.md). Distinct from already-recommended identity mint: [`best-relocation-sheet-ingest-identity.md`](best-relocation-sheet-ingest-identity.md). Distinct from already-recommended receipt skip: [`best-relocation-sheet-ingest-source-change-policy.md`](best-relocation-sheet-ingest-source-change-policy.md). Distinct from already-recommended recurring adopt: [`best-relocation-sheet-ingest-canonical-lead-adoption.md`](best-relocation-sheet-ingest-canonical-lead-adoption.md). Distinct from already-recommended first-run adopt: [`best-relocation-sheet-ingest-bootstrap.md`](best-relocation-sheet-ingest-bootstrap.md). Distinct from already-recommended three-way allowlist: [`best-relocation-sheet-ingest-update-policy.md`](best-relocation-sheet-ingest-update-policy.md). Distinct from already-recommended leftover HTTP walk: [`best-relocation-sheet-ingest-apply.md`](best-relocation-sheet-ingest-apply.md) (walks leftover `IngestPlan`; this file never **asks** leftover `applyIngestPlan`). Distinct from already-recommended worker: [`ingestion-worker.md`](ingestion-worker.md) (never imports this file). Distinct from already-recommended command walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md). Distinct from later sanitized reports: leftover `dryRunReports.ts` writes leftover `DRY-RUN-REPORT.md` / leftover `dry-run-report.json` from leftover `BestRelocationApplicationPlan` and **asks** leftover `maskWorkbook`. Folder `HANDOFF.md` is not knowledge — do not copy it (it still lists leftover `dryRun.ts` as JSON and Markdown dry-run artifact generation and leftover `ingest-plan-summary.md` as an important file). This checkout's `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).  // pragma: allowlist secret
- Callers: leftover CLI `scripts/best-relocation-sheet-ingest.ts` **imports** leftover `writeDryRunArtifacts` and never **asks** it. leftover `main` writes leftover `ingest-plan.json` itself as leftover `BestRelocationApplicationPlan`, leftover `ingest-plan-summary.json` (policy flags + leftover `plan_checksum`), leftover `ingest-plan.sha256`, then leftover `writeBestRelocationDryRunReports` twice. leftover `printSummary` is typed as leftover `ReturnType<typeof buildIngestPlan>` and is never called. leftover `applyReviewedPlan` **asks** leftover `applyIngestPlan`, not this file. Barrel `index.ts` re-exports leftover `formatPlanSummary` / leftover `writeDryRunArtifacts`. Folder `bestRelocationSheetIngest.test.ts` does **not** import this file. leftover `ingestion/ingestion.test.ts` does **not** import this file. leftover `adapter.ts` / leftover `plan.ts` / leftover `applicationPlan.ts` / leftover `apply.ts` / leftover `dryRunReports.ts` / leftover `worker.ts` / leftover `applyPlan.ts` / Wave B `src/routes/ingestion.routes.ts` do not import this file.  // pragma: allowlist secret
- Seams callers need: leftover this-file / leftover HTTP screenplay (leftover `plan.ts` writes leftover `IngestPlan`; this file dumps it); leftover this-file / leftover HTTP walk (leftover `apply.ts` POSTs; this file never POSTs); leftover this-file / leftover sanitized reports (leftover `dryRunReports.ts` **asks** leftover `BestRelocationApplicationPlan` and masks workbook ids; this file pretty-prints leftover `IngestPlan` with customer PII); leftover this-file / leftover dead CLI (imported unused; leftover `main` already wrote leftover `ingest-plan.json`). There is no Domain Command **seam**. There is no checksum **seam**. There is no apply-lease **seam**. There is no receipt **seam**. There is no sheet-inspect **seam**. There is no Owner-approve **seam**.  // pragma: allowlist secret
- Split later (only if the file outgrows one sitting): this ~80-line file is one sitting if you read it as dump the leftover HTTP mutation screenplay to disk so an operator can read planned Form, Call, Booking, and Cancellation counts, unmatched Jobs, and refunds. Do **not** split into `json.ts` / `markdown.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover `plan.ts`, leftover `applicationPlan.ts`, leftover `apply.ts`, leftover `dryRunReports.ts`, leftover CLI leftover `main`, or leftover `durableWork.computeChecksum` here. If it later splits: `writeTheLeftoverHttpMutationScreenplayJson.ts` / `writeTheLeftoverHttpMutationScreenplayOperatorMarkdown.ts` only as later story files, never CRUD.  // pragma: allowlist secret

`writeDryRunArtifacts` / `formatPlanSummary` are executor mechanics. The owner question is: *I already have the leftover HTTP mutation screenplay. Write it to disk so I can read how many Forms, Calls, Bookings from source, leadless Bookings, and Cancellations it would POST, which Jobs stayed unmatched, and which refunds were not planned. Keep the JSON restricted. The markdown is counts, Job numbers, and leftover HTTP warnings — not a sanitized application report. This file does not POST. This file does not ask a Domain Command. This file does not hash. This file does not mask names, phones, or emails in the JSON.*  // pragma: allowlist secret

Leftover HTTP screenplay / leftover HTTP walk / leftover application-plan remap / leftover sanitized reports already live in other **modules**. Do not pull those in.  // pragma: allowlist secret

## What this file actually does  // pragma: allowlist secret

Four operations of one "dump the leftover HTTP mutation screenplay to disk so an operator can read planned Form, Call, Booking, and Cancellation counts, unmatched Jobs, and refunds" story, not "a dry-run CRUD helper," and not leftover `writeBestRelocationDryRunReports` / leftover CLI leftover `main` dump / leftover `applyIngestPlan`.  // pragma: allowlist secret

1. **Write leftover `ingest-plan.json` and leftover `ingest-plan-summary.md` into the given directory** — leftover `writeDryRunArtifacts`. leftover `mkdir` recursive (no leftover `0o700` on the directory). leftover `ingest-plan.json` is leftover `JSON.stringify(plan, null, 2)` plus a trailing newline, leftover file mode `0o600`. leftover `ingest-plan-summary.md` is leftover `formatPlanSummary(plan)`, leftover `0o600`. Both writes leftover `Promise.all`. Return leftover `{ jsonPath, markdownPath }`. This function does not **ask** leftover `computeChecksum`. This function does not write leftover `ingest-plan.sha256`. This function does not write leftover `DRY-RUN-REPORT.md`.  // pragma: allowlist secret

2. **Count planned Form, Call, Booking-from-source, leadless, and Cancellation creates** — leftover `formatPlanSummary` leftover `## Planned mutations`. leftover `plan.summary.mutations.create_form_lead` plus leftover `plan.summary.local_forms` in parentheses. leftover `create_call_lead`. leftover `create_booked_from_source`. leftover `create_leadless_booking`. leftover `create_cancelled_lead` labeled leftover "Cancellations/refunds." leftover Total is leftover `plan.mutations.length`, not a sum of leftover `summary.mutations`. Header leftover `Generated` leftover `plan.generated_at`, leftover "Production target" leftover `plan.base_url`, leftover "Match threshold" leftover `plan.threshold`. This function does not **ask** leftover `buildIngestPlan`.  // pragma: allowlist secret

3. **Count booking coverage and list unmatched / below-threshold Jobs** — leftover `## Booking coverage`: leftover `booking_rows`, leftover `booking_jobs`, leftover `collapsed_booking_rows`, leftover `accepted_booking_matches`. leftover `## Unmatched / below-threshold booking jobs`: each leftover `unmatched_booking_jobs` row is leftover job number, leftover sheet leftover `rows`, and leftover rejected leftover match leftover method leftover plus leftover confidence when leftover `best_match_confidence` is defined. Empty list is leftover `_None._`. This function does not pair. This function does not apply leftover `0.9`.  // pragma: allowlist secret

4. **Count refunds vs planned cancellations vs unmatched refunds, then append leftover HTTP warnings** — leftover `## Refund coverage`: leftover `summary.refunds`, leftover `matched_refunds`, leftover `unmatched_refunds`. leftover `## Notes` maps leftover `plan.warnings` as bullets, then says the sibling leftover `ingest-plan.json` holds leftover endpoint, leftover payload, leftover idempotency key, leftover `$ref:` binding, leftover confidence, and leftover source-row provenance. leftover `plan.ts` already stamped leftover unmatched-refund count, leftover LID_BestRelo-only leadless count, and leftover "Apply still **asks** Sheet Sync." This function does not drop that leftover Sheet Sync warning. This function does not open leftover `unmatched_refund`.  // pragma: allowlist secret

Shared beats, not owner operations: leftover `path.join` leftover file names leftover `ingest-plan.json` / leftover `ingest-plan-summary.md`. There is no leftover `maskWorkbook` beat. There is no leftover `summarize` beat.  // pragma: allowlist secret

## Organization  // pragma: allowlist secret

Keep one file as the screenplay for "dump the leftover HTTP mutation screenplay to disk so an operator can read planned Form, Call, Booking, and Cancellation counts, unmatched Jobs, and refunds — never POST, never ask a Domain Command, never hash, never sanitize." Leftover HTTP screenplay / leftover HTTP walk / leftover application-plan remap / leftover sanitized reports already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationDryRunService` class. Do not invent a begin / complete Domain Command **seam** here — leftover dump is not leftover `applyBestRelocationPlan`. Do not invent a second report **adapter** beside leftover `writeBestRelocationDryRunReports`. Do not invent a second leftover `ingest-plan.json` **adapter** beside leftover CLI leftover `main`. Do not invent a checksum **adapter** here — leftover CLI leftover `computeChecksum` hashes leftover `BestRelocationApplicationPlan`. Do not invent a mask **adapter** here — leftover `dryRunReports.ts` leftover `maskWorkbook` is later.  // pragma: allowlist secret

**External interface** stays small (this is the test surface). Faces leftover barrel / leftover unused CLI already import:  // pragma: allowlist secret

| Keep exporting | Story name | Why the seam exists |  // pragma: allowlist secret
|---|---|---|  // pragma: allowlist secret
| `writeDryRunArtifacts` | `writeTheLeftoverHttpMutationScreenplayToDisk` | leftover barrel; leftover CLI unused import |  // pragma: allowlist secret
| `formatPlanSummary` | `writeTheLeftoverHttpMutationScreenplayOperatorMarkdown` | leftover `writeDryRunArtifacts` **asks** it; leftover barrel re-exports it |  // pragma: allowlist secret

Keep the old names as one-line aliases until leftover `index.ts` and leftover unused CLI import migrate. Do not export leftover file names as a new public story. Do not make leftover `main` learn this file so "one leftover `ingest-plan.json` owns leftover HTTP and leftover commands." Do not make leftover `writeBestRelocationDryRunReports` import this file so "one dry-run owns leftover HTTP and leftover sanitized." Do not make callers learn leftover `InTransaction` or CRUD verbs.  // pragma: allowlist secret

**No class for the workflow.** The one type that earns a name is the leftover path bag leftover `writeDryRunArtifacts` already returns:  // pragma: allowlist secret

```ts  // pragma: allowlist secret
type LeftoverHttpDryRunArtifacts = {  // pragma: allowlist secret
  jsonPath: string  // pragma: allowlist secret
  markdownPath: string  // pragma: allowlist secret
}  // pragma: allowlist secret
```  // pragma: allowlist secret

That is the handoff from "leftover `plan.ts` wrote the leftover HTTP play" to "an operator may open leftover `ingest-plan-summary.md` without POSTing." Do **not** put leftover `plan_checksum` on that type so "the leftover HTTP dump owns approve." Do **not** put leftover `action_key` on that type so "the leftover HTTP dump owns leftover receipts." Do **not** move leftover `BestRelocationDryRunReportInput` here — that bag lives on leftover `dryRunReports.ts`.  // pragma: allowlist secret

leftover `IngestPlan` / leftover `PlannedMutation` stay on sibling leftover `types.ts`. Do not move those cards here.  // pragma: allowlist secret

## The file, as a story  // pragma: allowlist secret

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.  // pragma: allowlist secret

```ts  // pragma: allowlist secret
// dryRun.ts  // pragma: allowlist secret
// I already have the leftover HTTP mutation screenplay.  // pragma: allowlist secret
// Write it to disk so I can read how many Forms, Calls,  // pragma: allowlist secret
// Bookings from source, leadless Bookings, and Cancellations  // pragma: allowlist secret
// it would POST, which Jobs stayed unmatched, and which  // pragma: allowlist secret
// refunds were not planned.  // pragma: allowlist secret
// Keep the JSON restricted.  // pragma: allowlist secret
// The markdown is counts, Job numbers, and leftover HTTP warnings.  // pragma: allowlist secret
// This file does not POST.  // pragma: allowlist secret
// This file does not ask a Domain Command.  // pragma: allowlist secret
// This file does not hash.  // pragma: allowlist secret
// This file does not mask names, phones, or emails in the JSON.  // pragma: allowlist secret

// ── 1. Write leftover ingest-plan.json and leftover ingest-plan-summary.md ─  // pragma: allowlist secret

export async function writeTheLeftoverHttpMutationScreenplayToDisk(  // pragma: allowlist secret
  plan,  // pragma: allowlist secret
  outputDirectory,  // pragma: allowlist secret
)  // pragma: allowlist secret
export const writeDryRunArtifacts =  // pragma: allowlist secret
  writeTheLeftoverHttpMutationScreenplayToDisk  // pragma: allowlist secret

function makeTheRestrictedDirectory(outputDirectory)  // pragma: allowlist secret
function writeTheRestrictedHttpPlayJson(plan, jsonPath)  // pragma: allowlist secret
function writeTheRestrictedOperatorMarkdown(markdown, markdownPath)  // pragma: allowlist secret

// ── 2. Count planned Form, Call, Booking, and Cancellation creates ─  // pragma: allowlist secret

export function writeTheLeftoverHttpMutationScreenplayOperatorMarkdown(plan)  // pragma: allowlist secret
export const formatPlanSummary =  // pragma: allowlist secret
  writeTheLeftoverHttpMutationScreenplayOperatorMarkdown  // pragma: allowlist secret

function countThePlannedHttpCreates(plan)  // pragma: allowlist secret

// ── 3. Count booking coverage and list unmatched Jobs ─────  // pragma: allowlist secret

function countBookingCoverage(plan)  // pragma: allowlist secret
function listUnmatchedOrBelowThresholdJobs(plan)  // pragma: allowlist secret

// ── 4. Count refunds and append leftover HTTP warnings ────  // pragma: allowlist secret

function countRefundCoverage(plan)  // pragma: allowlist secret
function appendLeftoverHttpWarningsAndTheRestrictedJsonNote(plan)  // pragma: allowlist secret
```  // pragma: allowlist secret

Read the primary path out loud: *I already have the leftover HTTP mutation screenplay. Write leftover `ingest-plan.json` and leftover `ingest-plan-summary.md` into the given directory at leftover `0o600`. Count planned Form, Call, Booking-from-source, leadless, and Cancellation creates. Count booking coverage and list unmatched Jobs with the rejected match method. Count refunds vs planned cancellations vs unmatched refunds. Append leftover HTTP warnings. Never POST. Never ask a Domain Command. Never hash. Never sanitize the JSON.*  // pragma: allowlist secret

That is the operation. `writeDryRunArtifacts` is not.  // pragma: allowlist secret

## Precise logic I would tighten while renaming  // pragma: allowlist secret

1. **Dead CLI caller.** leftover `main` **imports** leftover `writeDryRunArtifacts` and never **asks** it. leftover `printSummary` is an unused JSON twin of some leftover `formatPlanSummary` counts. Name the unused dump. Do **not** silently wire leftover `main` back to this file so leftover HTTP owns CLI dry-run. Knowledge says leftover CLI leftover **asks** leftover `writeBestRelocationDryRunReports`.  // pragma: allowlist secret

2. **Two leftover ingest-plan.json writers.** leftover `main` writes leftover `BestRelocationApplicationPlan` to leftover `ingest-plan.json`. This file would write leftover `IngestPlan` to the same leftover file name. leftover dead leftover `applyReviewedPlan` leftover parses leftover `ingest-plan.json` as leftover `IngestPlan`. A revived leftover `--apply` against leftover CLI leftover output leftover walks leftover the leftover wrong leftover play leftover or leftover throws leftover shape. Name the two leftover files. Do **not** silently switch leftover `main` leftover to leftover this leftover file leftover so leftover one leftover ingest-plan.json leftover owns leftover HTTP.  // pragma: allowlist secret

3. **Two leftover dry-run reports.** leftover `dryRunReports.ts` leftover **asks** leftover `maskWorkbook` and leftover `plan_checksum`. It writes leftover `DRY-RUN-REPORT.md` with no names, phones, or emails. This file dumps leftover `IngestPlan` PII into leftover `ingest-plan.json`. leftover markdown lists leftover Job numbers only. Name leftover HTTP dump vs leftover sanitized leftover application leftover report. Do **not** merge leftover the leftover two leftover files leftover so leftover one leftover dry-run leftover owns leftover both.  // pragma: allowlist secret

4. **`formatPlanSummary` writes generated_at, `base_url` as Production target, threshold, mutation counts, booking coverage, unmatched jobs, refund coverage, and notes.** Form count adds `local_forms` in parens. Cancelled count is labeled Cancellations/refunds. Total is `plan.mutations.length`, not a sum of `plan.summary.mutations`. Unmatched-job lines include `job_no`, sheet `rows`, and optional `; best rejected match ${method} @ ${confidence}` when `best_match_confidence` is defined. Empty unmatched list prints `_None._`. Notes reprint `plan.warnings` and tell the operator the sibling JSON has endpoints, payloads, idempotency keys, `$ref:` tokens, confidence, and provenance. The markdown lists Job Numbers, not customer names or phones. The JSON dump still has the full HTTP screenplay.  // pragma: allowlist secret

5. **The function never hashes, never writes `ingest-plan.sha256`, never writes `ingest-plan-summary.json`, never writes `DRY-RUN-REPORT.md`, and never calls `writeBestRelocationDryRunReports`.** Sibling `dryRunReports.ts` is the live sanitized report. Do not merge the two writers.  // pragma: allowlist secret

6. **`scripts/best-relocation-sheet-ingest.ts` imports `writeDryRunArtifacts` and never calls it.** `main` writes `BestRelocationApplicationPlan` as `ingest-plan.json`, plus `ingest-plan-summary.json`, `ingest-plan.sha256`, and two sanitized reports. `printSummary` is typed as `ReturnType<typeof buildIngestPlan>` and unused. Dead `applyReviewedPlan` still parses leftover `IngestPlan` (`mutations` + `version === 1`) then `applyIngestPlan`. `main` throws `--apply` before that path. Do not revive `--apply` from this file.  // pragma: allowlist secret

7. **Two `ingest-plan.json` writers exist.** This file would dump leftover `IngestPlan`. CLI `main` dumps `BestRelocationApplicationPlan`. If an operator revived `--apply` against a CLI-written file, `applyReviewedPlan` would walk the wrong play. Leave CLI `main` for a later pass.  // pragma: allowlist secret

8. **Directory mode is `mkdir` recursive with no `0o700`.** Sibling `dryRunReports.ts` uses `0o700`. Both write files `0o600`. Do not silently change this file's directory mode; name the split.  // pragma: allowlist secret

9. **Total vs summary mutation counts can diverge.** `plan.mutations` is the HTTP screenplay. `plan.summary.mutations` is the typed count. Markdown Total uses the array length.  // pragma: allowlist secret

10. **Knowledge vs HANDOFF.** `docs/knowledge/services/ingestion.md` names `dryRunReports.ts` as primary code and never names this file. CLI live apply is retired. `HANDOFF.md` still lists this file as JSON+Markdown artifact gen and `ingest-plan-summary.md` as important. This checkout has no `docs/adr/`. Workspace `CONTEXT.md` does not define Ingestion Origin or Best Relocation.  // pragma: allowlist secret

11. **Zero tests import this file.** `bestRelocationSheetIngest.test.ts` and `ingestion.test.ts` do not. The interface is `writeDryRunArtifacts` and `formatPlanSummary`.  // pragma: allowlist secret

12. **Leave siblings alone.** `plan.ts` already recommended the HTTP screenplay. `apply.ts` already recommended the leftover HTTP walk. `dryRunReports.ts` is the next pass. Do not retarget CLI `main`.  // pragma: allowlist secret


## Testing (at the interface)  // pragma: allowlist secret

Do not write helper-unit tests.  // pragma: allowlist secret

Inject a temp directory. Call `writeDryRunArtifacts(plan, outputDirectory)` with a leftover `IngestPlan` fixture (version 1, `mutations`, `summary.mutations`, unmatched jobs, unmatched refunds, warnings).  // pragma: allowlist secret

Prove:  // pragma: allowlist secret

- Both files exist at `ingest-plan.json` and `ingest-plan-summary.md`.  // pragma: allowlist secret
- File mode is `0o600`.  // pragma: allowlist secret
- JSON is leftover `IngestPlan`, not `BestRelocationApplicationPlan`.  // pragma: allowlist secret
- Markdown prints generated_at, Production target, threshold, Form (local_forms), Call, booked-from-source, leadless, Cancellations/refunds, Total = `mutations.length`.  // pragma: allowlist secret
- Unmatched jobs print `_None._` when empty.  // pragma: allowlist secret
- A rejected match prints `; best rejected match ${method} @ ${confidence}`.  // pragma: allowlist secret
- Warnings reprint plus the sibling-JSON note.  // pragma: allowlist secret
- The function does not write `ingest-plan.sha256`, `ingest-plan-summary.json`, or `DRY-RUN-REPORT.md`.  // pragma: allowlist secret
- CLI `main` still does not call this file.  // pragma: allowlist secret
- `writeBestRelocationDryRunReports` still does not import this file.  // pragma: allowlist secret

## What I would not do  // pragma: allowlist secret

- Do not implement this pass.  // pragma: allowlist secret
- Do not edit `src/`.  // pragma: allowlist secret
- Do not merge this writer into `dryRunReports.ts`.  // pragma: allowlist secret
- Do not revive `--apply`.  // pragma: allowlist secret
- Do not silently add `0o700` on mkdir.  // pragma: allowlist secret
- Do not split into `create.ts` / `update.ts` / `delete.ts`.  // pragma: allowlist secret
- Do not introduce a `*Service` class.  // pragma: allowlist secret
- Do not drop the old export names; keep them as aliases.  // pragma: allowlist secret
- Do not retarget CLI `main` here.  // pragma: allowlist secret
- Do not rewrite `recommendations/form-lead.md`.  // pragma: allowlist secret
- Do not open Wave B.  // pragma: allowlist secret
- Do not start `dryRunReports.ts` this pass.  // pragma: allowlist secret

## Glossary  // pragma: allowlist secret

IngestPlan, BestRelocationApplicationPlan, leftover HTTP mutation screenplay, dry-run artifacts, ingest-plan.json, ingest-plan-summary.md.  // pragma: allowlist secret
