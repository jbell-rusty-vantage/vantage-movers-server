# Write The Sanitized Checksum-Bound Dry-Run Report So An Operator Can Read Command Counts, Adoption Methods, Booked-Deal And Refund Jobs, And Conflicts — Never POST, Never Ask A Domain Command, Never Hash, Never Dump Names Phones Emails Or Payloads — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, visited)
- Pass: 14 of this service — `dryRunReports.ts`
- Remaining in this service: none
- Target: `src/services/bestRelocationSheetIngest/dryRunReports.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). CLI dry-run inspects Forms / Local Forms / Calls / Booked Deals / Refunds, applies receipt skip when the connection exists, then `applyCanonicalAdoptionPolicy`. Writes sanitized `DRY-RUN-REPORT.md` / `dry-run-report.json` (no names, phones, or emails). `ingest-plan.json` stays restricted. CLI live apply is retired. Primary-code list names `canonicalLeadAdoption.ts` / `sheets.ts` / **this file**. Knowledge never names `writeBestRelocationDryRunReports`, `BestRelocationDryRunReportInput`, `summarize`, `maskWorkbook`, `jobNoFromAction`, `formatMarkdown`, `0o700` on the report directory, `generated_at`, `connection_id` on the report, `raw_planner_counters` vs `policy_counters`, `booking_and_refund_actions`, `scripts/output/best-relocation-ingest-dry-run`, or the hardcoded “Rows at or after 2026-04-30 Eastern” table sentence — do not add a second Ingestion Service so “the leftover HTTP dump owns CLI dry-run.” Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md) (this file **asks** `inspectBestRelocationWorkbookCounts` tab cards and workbook ids; it never reads a cell). Distinct from already-recommended parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md). Distinct from already-recommended pair: [`best-relocation-sheet-ingest-matching.md`](best-relocation-sheet-ingest-matching.md). Distinct from already-recommended HTTP screenplay: [`best-relocation-sheet-ingest-plan.md`](best-relocation-sheet-ingest-plan.md). Distinct from already-recommended remap: [`best-relocation-sheet-ingest-application-plan.md`](best-relocation-sheet-ingest-application-plan.md) (writes `BestRelocationApplicationPlan`; this file **asks** `actions` / `counters` / `warnings` only). Distinct from already-recommended inspect: [`best-relocation-sheet-ingest-provider.md`](best-relocation-sheet-ingest-provider.md). Distinct from already-recommended identity mint: [`best-relocation-sheet-ingest-identity.md`](best-relocation-sheet-ingest-identity.md) (this file **asks** `stable_source_row_id` `booking:` only when Job is missing). Distinct from already-recommended receipt skip: [`best-relocation-sheet-ingest-source-change-policy.md`](best-relocation-sheet-ingest-source-change-policy.md). Distinct from already-recommended recurring adopt: [`best-relocation-sheet-ingest-canonical-lead-adoption.md`](best-relocation-sheet-ingest-canonical-lead-adoption.md). Distinct from already-recommended first-run adopt: [`best-relocation-sheet-ingest-bootstrap.md`](best-relocation-sheet-ingest-bootstrap.md). Distinct from already-recommended three-way allowlist: [`best-relocation-sheet-ingest-update-policy.md`](best-relocation-sheet-ingest-update-policy.md). Distinct from already-recommended leftover HTTP walk: [`best-relocation-sheet-ingest-apply.md`](best-relocation-sheet-ingest-apply.md). Distinct from already-recommended leftover HTTP dump: [`best-relocation-sheet-ingest-dry-run.md`](best-relocation-sheet-ingest-dry-run.md) (writes `ingest-plan.json` / `ingest-plan-summary.md` from leftover `IngestPlan` with customer PII; leftover CLI **imports** `writeDryRunArtifacts` and never **asks** it; leftover CLI **asks** this file). Distinct from already-recommended worker: [`ingestion-worker.md`](ingestion-worker.md) (never imports this file). Distinct from already-recommended command walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md). Folder `HANDOFF.md` is not knowledge — do not copy it (it still lists leftover `dryRun.ts` as JSON and Markdown dry-run artifact generation and leftover `ingest-plan-summary.md` as an important file; it never names this file). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: leftover CLI `scripts/best-relocation-sheet-ingest.ts` `main` **asks** `writeBestRelocationDryRunReports` twice with the same `checksum` / `inspection` / `raw_counters` (`built.plan.counters` before skip / adopt) / `policy_plan` (after `applySourceChangePolicy` when a connection exists, then `applyCanonicalAdoptionPolicy`) / `policy`. First write is `options.outputDirectory` (the same `0o700` directory `main` already used for `ingest-plan.json`). Second write is `scripts/output/best-relocation-ingest-dry-run`. `main` itself writes `ingest-plan.json` as `BestRelocationApplicationPlan`, `ingest-plan-summary.json` (policy flags + `plan_checksum`), and `ingest-plan.sha256` — this file does not. `writeDryRunArtifacts` is imported and unused. Barrel `index.ts` re-exports `writeBestRelocationDryRunReports` only (not `BestRelocationDryRunReportInput`). Folder `bestRelocationSheetIngest.test.ts` does **not** import this file. `ingestion/ingestion.test.ts` does **not** import this file. `adapter.ts` / `plan.ts` / `applicationPlan.ts` / `apply.ts` / `dryRun.ts` / `worker.ts` / `applyPlan.ts` / Wave B `src/routes/ingestion.routes.ts` do not import this file.
- Seams callers need: this-file / checksum-bound play (`applicationPlan.ts` writes `BestRelocationApplicationPlan`; this file dumps a sanitized card); this-file / inspect (`sheets.ts` tab counts and workbook ids; this file never reads a cell); this-file / CLI `main` (`main` hashes and writes `ingest-plan.json`; this file never hashes); this-file / leftover HTTP dump (`dryRun.ts` pretty-prints leftover `IngestPlan` PII; this file never **asks** leftover `IngestPlan`). There is no Domain Command **seam**. There is no apply-lease **seam**. There is no receipt **seam**. There is no checksum **seam** on this file — `computeChecksum` stays on CLI `main`. There is no sheet-inspect **seam**. There is no Owner-approve **seam**.
- Split later (only if the file outgrows one sitting): this ~244-line file is one sitting if you read it as write the sanitized checksum-bound dry-run report so an operator can read command counts, adoption methods, Booked-Deal and Refund Jobs, and conflicts. Do **not** split into `json.ts` / `markdown.ts` / `mask.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover `dryRun.ts`, `applicationPlan.ts`, `sheets.ts`, leftover CLI `main`, or `durableWork.computeChecksum` here. If it later splits: `writeTheSanitizedChecksumBoundDryRunReportPair.ts` / `countCommandsAdoptionsJobsAndConflictsWithoutPayloads.ts` only as later story files, never CRUD.

`writeBestRelocationDryRunReports` is executor mechanics. The owner question is: *I already have the checksum-bound application plan after inspect, receipt skip, and adopt-before-create. Write a sanitized report so I can read which commands would run, how many rows each dataset classified, which adoption methods fired, which Booked Deal and Refund Jobs are on the play, and which conflicts are open. Mask the workbook ids. Keep names, phones, emails, and command payloads off the disk. This file does not POST. This file does not ask a Domain Command. This file does not hash. This file does not write ingest-plan.json.*

Leftover HTTP dump / leftover HTTP walk / application-plan remap / inspect already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “write the sanitized checksum-bound dry-run report so an operator can read command counts, adoption methods, Booked-Deal and Refund Jobs, and conflicts” story, not “a dry-run CRUD helper,” and not leftover `writeDryRunArtifacts` / leftover CLI `main` `ingest-plan.json` dump / leftover `applyIngestPlan` / `applyBestRelocationPlan`.

1. **Write `DRY-RUN-REPORT.md` and `dry-run-report.json` into a `0o700` directory** — `writeBestRelocationDryRunReports`. `mkdir` recursive `mode: 0o700`. Markdown `0o600`. JSON is `JSON.stringify(summary, null, 2)` plus a trailing newline, `0o600`. Writes are sequential (not `Promise.all`). Return `{ markdownPath, jsonPath }`. This function does not **ask** `computeChecksum`. This function does not write `ingest-plan.json`. This function does not write `ingest-plan.sha256`. This function does not write leftover `ingest-plan-summary.md`.

2. **Count checksum-bound actions after policy, without copying payloads** — `summarize` walks `policy_plan.actions`. `commands` counts `action.command`. `datasets` counts `classification` per `dataset_key`. `adoption_methods` counts `matching.method` only when `classification === "adoption"`. `generated_at` is `new Date().toISOString()` at write time. `cutoff` / `source_read_through` come from `inspection`, not `policy_plan`. `timezone` is the literal `"America/New_York"`. `plan_checksum` is `input.checksum`. `raw_planner_counters` is `input.raw_counters`. `policy_counters` is `policy_plan.counters`. `warnings` is `policy_plan.warnings`. This function does not copy `command_payload`. This function does not copy `source_owned_values`. This function does not copy `adopted_entity_refs`. This function does not copy `provenance`.

3. **List Booked Deal and Refund Jobs, and list conflicts, Job-only** — `booking_and_refund_actions` keeps `booked_deals` and `refunds` rows as `{ classification, command, job_no, method, score }`. `conflicts` keeps `classification === "conflict"` as `{ dataset_key, type, severity, method, job_no }`. `jobNoFromAction` **asks** `command_payload.job_no` else `call_job_no`, trim + uppercase; else `stable_source_row_id` `/^booking:(.+)$/i`. This fold is not `parsing.normalizeJobNo`. This function does not list Forms or Calls by name or phone.

4. **Mask workbook ids and write the operator markdown** — `maskWorkbook` keeps `title` and `id.length <= 8 ? id : first-4 + … + last-4`. `formatMarkdown` prints Generated / Cutoff / Source read-through / Plan checksum; Policy `receipts_applied` / `canonical_adoption_applied` / `connection_id` or “not found (receipt policy skipped)”; Workbooks titles plus masked ids; Tab inspection table Populated / Parsed / In window / Pre-cutoff / Missing timestamp / Missing identity / BR source / BR source in window, with `?? "—"` on the last two; Planner vs policy JSON dumps; Commands after policy; By dataset; Adoption methods `_None._` when empty; Booked Deals and Refunds `(job numbers only)` `_None._` when empty; Conflicts `_None._` when empty; Notes “no customer names, phones, or emails,” `adopt_existing` “writes a receipt only,” `create_cancelled_lead` “is a Cancellation from the Refunds tab,” “Below-threshold Booked Deal matches stay leadless plus a reconciliation conflict,” then `policy_plan.warnings`. Tab prose hardcodes “Rows at or after 2026-04-30 Eastern may enter the plan” even when `summary.cutoff` is a different instant. `conflicts[].method` is collected and not printed. `connection_id` is not masked.

Shared beats, not owner operations: `path.join` file names `DRY-RUN-REPORT.md` / `dry-run-report.json`. There is no leftover `formatPlanSummary` beat. There is no leftover `IngestPlan` beat.

## Organization

Keep one file as the screenplay for “write the sanitized checksum-bound dry-run report so an operator can read command counts, adoption methods, Booked-Deal and Refund Jobs, and conflicts — never POST, never ask a Domain Command, never hash, never dump names, phones, emails, or payloads.” Leftover HTTP dump / leftover HTTP walk / application-plan remap / inspect already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationDryRunReportsService` class. Do not invent a begin / complete Domain Command **seam** here — this dump is not `applyBestRelocationPlan`. Do not invent a second `ingest-plan.json` **adapter** beside leftover CLI `main`. Do not invent a second leftover HTTP dump **adapter** beside leftover `writeDryRunArtifacts`. Do not invent a checksum **adapter** here — leftover CLI `computeChecksum` hashes `BestRelocationApplicationPlan`. Do not invent a second mask **adapter** so leftover `dryRun.ts` “owns leftover sanitize.”

**External interface** stays small (this is the test surface). Faces leftover barrel / leftover CLI `main` already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `writeBestRelocationDryRunReports` | `writeTheSanitizedChecksumBoundDryRunReport` | leftover CLI `main` **asks** it twice; leftover barrel re-exports it |
| `BestRelocationDryRunReportInput` | `SanitizedChecksumBoundDryRunReportInput` | leftover CLI `main` builds the bag; leftover barrel does not re-export it today |

Keep the old names as one-line aliases until leftover `index.ts` and leftover CLI `main` migrate. Do not export `summarize` / `formatMarkdown` / `maskWorkbook` / `jobNoFromAction`. Do not make leftover `writeDryRunArtifacts` import this file so “one dry-run owns leftover HTTP and leftover sanitized.” Do not make leftover `main` drop `ingest-plan.json` so “the sanitized report owns the restricted play.” Do not make callers learn `InTransaction` or CRUD verbs.

**No class for the workflow.** The one type that earns a name is the input bag leftover CLI `main` already builds:

```ts
type SanitizedChecksumBoundDryRunReportInput = {
  outputDirectory: string
  checksum: string
  inspection: {
    cutoff: string
    source_read_through: string
    leads: { id: string; title: string }
    booked: { id: string; title: string }
    tabs: BestRelocationTabCount[]
  }
  raw_counters: Record<string, number>
  policy_plan: BestRelocationApplicationPlan
  policy: {
    receipts_applied: boolean
    canonical_adoption_applied: boolean
    connection_id?: string
  }
}
```

That is the handoff from “`applicationPlan.ts` wrote the checksum-bound play and leftover CLI `main` hashed it” to “an operator may open `DRY-RUN-REPORT.md` without seeing a name, phone, email, or `command_payload`.” Do **not** put leftover `mutations` on that type so “the sanitized report owns leftover HTTP.” Do **not** put `action_key` on that type so “the sanitized report owns leftover receipts.” Do **not** move leftover `IngestPlan` here — that card lives on leftover `types.ts` and leftover `dryRun.ts` **asks** it.

`BestRelocationApplicationPlan` / `BestRelocationPlanAction` stay on sibling `applicationPlan.ts`. `BestRelocationTabCount` stays on `sheets.ts`. Do not move those cards here.

The path bag `writeBestRelocationDryRunReports` already returns does not earn a second name:

```ts
type SanitizedChecksumBoundDryRunReportPaths = {
  markdownPath: string
  jsonPath: string
}
```

That is only `{ markdownPath, jsonPath }`. Do not put `plan_checksum` on it.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// dryRunReports.ts
// I already have the checksum-bound application plan after inspect,
// receipt skip, and adopt-before-create.
// Write a sanitized report so I can read which commands would run,
// how many rows each dataset classified, which adoption methods fired,
// which Booked Deal and Refund Jobs are on the play, and which
// conflicts are open.
// Mask the workbook ids.
// Keep names, phones, emails, and command payloads off the disk.
// This file does not POST.
// This file does not ask a Domain Command.
// This file does not hash.
// This file does not write ingest-plan.json.

// ── 1. Write DRY-RUN-REPORT.md and dry-run-report.json ─

export async function writeTheSanitizedChecksumBoundDryRunReport(input)
export const writeBestRelocationDryRunReports =
  writeTheSanitizedChecksumBoundDryRunReport

function makeTheRestrictedReportDirectory(outputDirectory)
function writeTheRestrictedSanitizedMarkdown(markdown, markdownPath)
function writeTheRestrictedSanitizedJson(summary, jsonPath)

// ── 2. Count checksum-bound actions after policy, without payloads ─

function countCommandsDatasetsAndAdoptionMethodsWithoutPayloads(input)

// ── 3. List Booked Deal and Refund Jobs, and list conflicts ─

function listBookedDealAndRefundJobsOnly(actions)
function listConflictsJobOnly(actions)
function readTheJobFromTheActionOrTheBookingIdentity(action)

// ── 4. Mask workbook ids and write the operator markdown ─

function maskTheWorkbookId(workbook)
function writeTheOperatorMarkdown(summary)
```

Read the primary path out loud: *I already have the checksum-bound application plan after inspect, receipt skip, and adopt-before-create. Make a `0o700` directory. Count commands, dataset classifications, and adoption methods without copying payloads. List Booked Deal and Refund Jobs and conflicts. Mask workbook ids. Write `DRY-RUN-REPORT.md` and `dry-run-report.json` at `0o600`. Never POST. Never ask a Domain Command. Never hash. Never dump names, phones, emails, or `command_payload`.*

That is the operation. `writeBestRelocationDryRunReports` is not.

## Precise logic I would tighten while renaming

1. **Two dry-run writers.** Leftover `dryRun.ts` **asks** leftover `IngestPlan` and dumps PII into leftover `ingest-plan.json`. This file **asks** `BestRelocationApplicationPlan` actions and writes `DRY-RUN-REPORT.md` with no names, phones, emails, or payloads. Knowledge names this file as primary CLI dry-run. `HANDOFF.md` still names leftover `dryRun.ts`. Name leftover HTTP dump vs sanitized application report. Do **not** merge the two files so one dry-run owns both.

2. **Two `ingest-plan.json` writers stay on leftover CLI `main` and leftover dead `writeDryRunArtifacts`.** `main` writes `BestRelocationApplicationPlan` to `ingest-plan.json` plus `ingest-plan-summary.json` plus `ingest-plan.sha256`. This file never writes those names. Do **not** silently move `ingest-plan.json` onto this file so “the sanitized report owns the restricted play.”

3. **Leftover CLI `main` **asks** this file twice.** First write is the restricted output directory next to `ingest-plan.json`. Second write is `scripts/output/best-relocation-ingest-dry-run`. `generated_at` is `new Date()` per call, so the two copies disagree on the clock. Name the two directories. Do **not** silently drop the visible copy or share one `generated_at`.

4. **`raw_planner_counters` vs `policy_counters`.** CLI `raw_counters` is `built.plan.counters` before `applySourceChangePolicy` / `applyCanonicalAdoptionPolicy`. `policy_counters` is `policy_plan.counters` after those remaps. Markdown `## Planner vs policy` `JSON.stringify`s both. Name “before skip / adopt” vs “after skip / adopt.” Do **not** silently sum `commands` so they must equal `policy_counters`.

5. **Tab prose hardcodes `2026-04-30` Eastern.** Header `Cutoff` **asks** `summary.cutoff`. The table sentence does not. If `BEST_RELOCATION_CUTOFF` moves, the table lies. Name the split. Do **not** silently interpolate `summary.cutoff` in this rename so “the report owns the window.”

6. **`connection_id` is not masked.** Workbook ids **ask** `maskWorkbook`. Policy `connection_id` prints in backticks. Name the split. Do **not** silently mask Mongo ids here.

7. **Conflict `method` is collected and not printed.** `summarize` keeps `action.matching?.method` on `conflicts`. `formatMarkdown` prints `dataset_key` / `type` / `severity` / Job. Booking rows do print `method` `@` `score`. Name the gap. Do **not** silently add `method` to conflict bullets.

8. **Job fold here is trim + uppercase, else `booking:` from `stable_source_row_id`.** `parsing.normalizeJobNo` is a sibling fold. `applicationPlan.ts` `leadlessMatchingEvidence` uses uppercase alphanumerics. Name the three folds. Do **not** silently unify them so “the report owns Job identity.”

9. **Directory `0o700` vs leftover `dryRun.ts` `mkdir` with no mode.** Both write files `0o600`. Name the split. Do **not** silently change leftover `dryRun.ts`.

10. **Barrel exports the function only.** `BestRelocationDryRunReportInput` is exported from this file and not from `index.ts`. CLI imports the function from the barrel. Name that. Do **not** add a barrel type export in this rename so “the barrel owns the card.”

11. **Zero tests import this file.** `bestRelocationSheetIngest.test.ts` and `ingestion.test.ts` do not. The interface is `writeBestRelocationDryRunReports`.

12. **Leave siblings alone.** Leftover `dryRun.ts` already recommended the leftover HTTP dump. `applicationPlan.ts` already recommended the checksum-bound play. `sheets.ts` already recommended inspect. Do not retarget leftover CLI `main` `ingest-plan.json`.

## Testing

The **interface** is the test surface: `writeTheSanitizedChecksumBoundDryRunReport` (today `writeBestRelocationDryRunReports`).

Inject a temp directory. Call `writeBestRelocationDryRunReports` with a `BestRelocationApplicationPlan` fixture (`create_form_lead`, `adopt_existing`, `create_leadless_booking`, `create_cancelled_lead`, `record_conflict`, a Booked Deal Job, an unmatched refund, and `warnings`). Pass `raw_counters` different from `policy_plan.counters`. Pass a long workbook id and a `connection_id`.

**Write the sanitized report pair**
- Both files exist at `DRY-RUN-REPORT.md` and `dry-run-report.json`.
- Directory mode is `0o700`. File mode is `0o600`.
- JSON is the summary card, not `BestRelocationApplicationPlan` and not leftover `IngestPlan`.
- The function does not write `ingest-plan.json`, `ingest-plan.sha256`, `ingest-plan-summary.json`, or leftover `ingest-plan-summary.md`.

**Count after policy, without payloads**
- `commands` counts each `action.command`.
- `datasets` counts classification per `dataset_key`.
- `adoption_methods` counts only `classification === "adoption"` with a `matching.method`.
- JSON has no `name`, `phone`, `email`, `command_payload`, `source_owned_values`, `adopted_entity_refs`, or `provenance`.
- `raw_planner_counters` stays the before-skip bag. `policy_counters` stays the after-skip bag.
- `plan_checksum` is the input checksum. The function does not **ask** `computeChecksum`.

**Jobs and conflicts**
- A Booked Deal / Refund row prints Job from `job_no` / `call_job_no`, uppercase.
- A Booking missing payload Job prints the `booking:` identity tail.
- Empty booking / conflict / adoption lists print `_None._`.
- A conflict prints dataset, type, severity, and Job. `method` stays off the markdown until a later pass decides.

**Mask and notes**
- A 12-character workbook id prints first-4 + … + last-4. Title stays.
- An 8-character workbook id prints whole.
- `connection_id` still prints unmasked.
- Notes include the no-PII line, `adopt_existing` receipt-only, Refunds as Cancellations, leadless-plus-reconciliation, and `policy_plan.warnings`.
- Tab prose still says `2026-04-30` Eastern even if `cutoff` is another instant.

**Callers still ask; this file still does not walk leftover HTTP**
- Leftover CLI `main` still **asks** this file twice and still writes `ingest-plan.json` itself.
- Leftover `writeDryRunArtifacts` still does not import this file.
- Leftover `applyIngestPlan` / `applyBestRelocationPlan` still do not import this file.

Do **not** add a helper-unit test that has to change when `maskWorkbook` or `jobNoFromAction` is inlined.

## What I would not do

- A `BestRelocationDryRunReportsService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `fs.writeFile`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `json.ts` / `markdown.ts` / `mask.ts` split “for cleanliness.”
- Breaking the before-commit / after-commit **seam** on leftover `applyBestRelocationPlan`, leftover pair-then-threshold, or leftover inspect 409.
- Treating leftover `dryRun.ts`, leftover `apply.ts`, `applicationPlan.ts`, `sheets.ts`, leftover CLI `main` `ingest-plan.json`, `applyPlan.ts`, or Owner approve as this story.
- Starting leftover Owner approve, leftover `runSheetSyncDrain`, leftover Domain Commands, leftover receipt writes, leftover lease `assertHeld`, leftover sheet inspect, or leftover `computeChecksum` from this file.
- Silently merging this writer into leftover `dryRun.ts`, silently moving `ingest-plan.json` here, silently interpolating `summary.cutoff` into the table prose, silently masking `connection_id`, silently unifying Job folds, or silently adding `0o700` onto leftover `dryRun.ts`.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.
- Opening Wave B. Opening `employeeBookings` this pass.
- Rewriting `recommendations/form-lead.md` or leftover `best-relocation-sheet-ingest-dry-run.md`.
