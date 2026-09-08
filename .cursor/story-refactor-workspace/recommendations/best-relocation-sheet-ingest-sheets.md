# Read The Two Best Relocation Workbooks After The Cutoff — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 1 of this service — `sheets.ts`
- Remaining in this service: `parsing.ts`, `matching.ts`, `plan.ts`, `applicationPlan.ts`, `provider.ts`, `identity.ts`, `sourceChangePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/sheets.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Distinct from already-recommended worker / apply / persist / health / poke: [`ingestion-worker.md`](ingestion-worker.md), [`ingestion-apply-plan.md`](ingestion-apply-plan.md), [`ingestion-repository.md`](ingestion-repository.md), [`ingestion-health.md`](ingestion-health.md), [`ingestion-queue.md`](ingestion-queue.md). Distinct from already-recommended Google identity: [`google-auth-service-account.md`](google-auth-service-account.md) (this file’s `serviceAccountAuthSource` is the third reader). Distinct from already-recommended workbook registry: [`operational-workbooks-registry.md`](operational-workbooks-registry.md) (the two BR keys are registered there; this file does not ask that registry). Distinct from already-recommended Reporting Sheets write: [`reporting-reporting-sheets-adapter.md`](reporting-reporting-sheets-adapter.md) — do not write Reporting destinations from this reader. This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: leftover `adapter.ts` `read` → `readBestRelocationWorkbooks`. Leftover `provider.ts` → `createSheetsClient` / `createWritableSheetsClient` / `readTab` / `resolveWorkbookIds`. Leftover `applicationPlan.ts` → `isWithinIngestionWindow` again on refunds. Leftover `canonicalLeadAdoption.ts` + its test → cutoff + timezone. Leftover `ingestion/worker.ts` → cutoff on adapter.read/plan. Leftover `ingestion/repository.ts` `createQueuedIngestionRun` → cutoff + timezone. Wave B `src/routes/ingestion.routes.ts` `configuredSourceSummary` → `resolveWorkbookIds` + `maskSpreadsheetId`. CLI `scripts/best-relocation-sheet-ingest.ts` → inspect counts then read. Barrel `index.ts` re-exports cutoff / timezone / inspect / window / read / resolve — not the two clients or `readTab`. Folder test does not ask `readBestRelocationWorkbooks`.
- Seams callers need: six-tab read that throws on invalid timestamp vs five-tab inspect that counts missing timestamps; official IDs first then deprecated `BACKFILL_*`; cutoff inclusive / read-through exclusive; LID_BestRelo is matching evidence and is not windowed; readonly client for read and inspect; writable client exists only for leftover `provider.ts` fenced identity repair. There is no Domain Command seam. There is no Reporting write seam. Worker inspect stays on leftover `provider.ts`, not this file’s inspect counts.
- Split later (only if the file outgrows one sitting): this ~460-line file is one sitting if you read it as read the two Best Relocation workbooks after the cutoff. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover `parsing.ts`, leftover `provider.ts`, leftover `applicationPlan.ts`, or leftover `adapter.ts` here. If it later splits: `readTheTwoBestRelocationWorkbooksAfterTheCutoff.ts` only as a later story file, never CRUD.

`readBestRelocationWorkbooks` / `inspectBestRelocationWorkbookCounts` / `resolveWorkbookIds` / `isWithinIngestionWindow` are executor mechanics. The owner question is: *Give me the official Best Relocation books after 30 April 2026. Forms, Local Forms, and Calls from the leads book. Booked Deals, Refunds, and LID_BestRelo from the booked book. Never Local Calls. Drop rows before the cutoff. Drop rows on or after the leftover worker’s `source_read_through`. A broken timestamp on a lead or booked row stops the read. LID_BestRelo is matching evidence, so it is not windowed. If I only want counts, count five tabs and do not throw on a missing timestamp. The leftover worker does not use that count path.*

Leftover parse / match / plan / apply / dry-run already live in other **modules**. Do not pull those in.

## What this file actually does

This file is the **Best Relocation workbook reader**. It is the only module that asks Google Sheets for the two official Best Relocation books, then splits the raw tabs into windowed lead rows, windowed booked rows, and LID_BestRelo matching evidence. The leftover adapter’s `read` step asks this file and nothing else. The leftover worker’s inspect step does **not** ask this file; it asks leftover `provider.ts`. The CLI inspect path **does** ask this file.

Four operations live here.

**`readBestRelocationWorkbooks`** is the real read. It resolves the two official spreadsheet IDs, builds a readonly Sheets client, then `Promise.all`s six leftover `readTab` calls: Forms, Local Forms, and Calls from the leads book; Booked Deals, Refunds, and LID_BestRelo from the booked book. It never reads Local Calls. Each populated row is parsed by leftover `parsing.ts` (`parseBestRelocationFormRow`, `parseBestRelocationCallRow`, `parseBestRelocationBookedDealRow`, `parseBestRelocationRefundRow`, `parseBestRelocationLidRow`). Forms, Local Forms, Calls, Booked Deals, and Refunds then pass leftover `inWindow`: keep the row when `timestamp >= BEST_RELOCATION_CUTOFF` and `timestamp < sourceReadThrough`. A missing or unparsable timestamp **throws** (`Authoritative source row has an invalid timestamp.`). LID_BestRelo is **not** windowed — it is matching evidence only. The return is `{ forms, localForms, calls, bookedDeals, refunds, lidRows }`.

**`inspectBestRelocationWorkbookCounts`** is the CLI inspect path. Same IDs, cutoff, read-through, and readonly client. It reads Forms, Local Forms, Calls, Booked Deals, and Refunds only — **not** LID_BestRelo. For each tab it counts populated / parsed / in-window / pre-cutoff / missing-timestamp. Missing timestamps are **counted**, not thrown. Forms also count missing durable identity (no `lead_id` and no `ref_no`). Calls count missing identity as `0` (`Best Relocation Calls do not have a durable source identity yet.`). Booked Deals and Refunds also count Best Relocation source rows. The leftover worker never asks this function.

**`resolveWorkbookIds`** is the ID resolver. Official env vars (`BEST_RELOCATION_SYNC_SHEET_ID`, `BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID`) win. Deprecated `BACKFILL_BEST_RELOCATION_SHEET_ID` / `BACKFILL_BOOKED_SHEET_ID` still resolve, and leftover `onDeprecationWarning` fires (default `console.warn`). Missing either ID throws. No hardcoded spreadsheet IDs. This file does **not** ask leftover `operationalWorkbooks` even though those two keys are already registered there as `ingestion_source`.

**`isWithinIngestionWindow`** is the shared window: cutoff inclusive, read-through exclusive. `BEST_RELOCATION_CUTOFF` is `2026-04-30T04:00:00.000Z` (America/New_York midnight on 2026-04-30). `BEST_RELOCATION_TIMEZONE` is `"America/New_York"`.

Beats, not owner operations: leftover `readTab` (one Sheets `values.get` plus header-to-row mapping), leftover `createSheetsClient` (readonly), leftover `createWritableSheetsClient` (write scope, used only by leftover `provider.ts` for the fenced managed-identity repair), leftover `serviceAccountAuthSource`, leftover `columnLetter`. The folder barrel exports cutoff, timezone, inspect counts, the window helper, the workbook read, and the ID resolver. It does **not** export the two clients or leftover `readTab`. Leftover `provider.ts` imports those from `./sheets` directly.

## Organization

Four named operations. Keep leftover `readTab` and the two clients as named helpers inside this file, or move the Google identity reader to leftover `googleAuth` in a later pass — do not hide the six-tab read behind a generic `sheets` object.

| Current export | Story name | Notes |
|---|---|---|
| `readBestRelocationWorkbooks` | `readTheTwoBestRelocationWorkbooksAfterTheCutoff` | Six tabs. Throws on invalid timestamp. Never reads Local Calls. LID_BestRelo is not windowed. |
| `inspectBestRelocationWorkbookCounts` | `countWhatEachBestRelocationTabWouldContribute` | Five tabs. Counts missing timestamps. CLI only. Worker inspect stays on leftover `provider.ts`. |
| `resolveWorkbookIds` | `resolveTheOfficialBestRelocationWorkbookIds` | Official env first, then deprecated `BACKFILL_*`. |
| `isWithinIngestionWindow` | `isThisRowInsideTheBestRelocationIngestionWindow` | Cutoff inclusive, read-through exclusive. |
| `BEST_RELOCATION_CUTOFF` | keep | `2026-04-30T04:00:00.000Z`. |
| `BEST_RELOCATION_TIMEZONE` | keep | `"America/New_York"`. |
| `createSheetsClient` | keep as helper | Readonly. Not on the barrel. |
| `createWritableSheetsClient` | keep as helper | Write scope. Provider-only. Not on the barrel. |
| `readTab` | keep as helper | Not on the barrel. |
| `serviceAccountAuthSource` | fold into leftover `googleAuth` later | Third Google-identity reader. See `google-auth-service-account.md`. |
| `columnLetter` | keep private | Copied again in leftover `provider.ts`. Leave provider alone this pass. |

Keep the current export names as aliases until Wave B (`src/routes/ingestion.routes.ts`) and leftover `scripts/best-relocation-sheet-ingest.ts` move.

Do not create `create.ts` / `update.ts` / `delete.ts`. Do not introduce a `*Service` class.

## The file, as a story

A reader who needs the official Best Relocation books after 30 April 2026 asks this file for the two spreadsheet IDs, then for the six tabs that still matter. Forms, Local Forms, and Calls come from the leads book. Booked Deals, Refunds, and LID_BestRelo come from the booked book. Local Calls stay unread. Rows before the cutoff stay out. Rows on or after the leftover worker’s `source_read_through` stay out. A lead or booked row with a broken timestamp stops the read. LID_BestRelo is matching evidence, not an action, so it is not windowed.

A CLI operator who only wants counts asks the inspect path. That path reads five tabs, never LID_BestRelo, and counts missing timestamps instead of throwing. The leftover worker does not use that path.

```ts
export async function readTheTwoBestRelocationWorkbooksAfterTheCutoff(input: {
  sourceReadThrough: Date;
}): Promise<BestRelocationWorkbookSnapshot>;

export async function countWhatEachBestRelocationTabWouldContribute(input: {
  sourceReadThrough: Date;
}): Promise<BestRelocationWorkbookInspection>;

export function resolveTheOfficialBestRelocationWorkbookIds(input?: {
  onDeprecationWarning?: (message: string) => void;
}): { leadsSheetId: string; bookedSheetId: string };

export function isThisRowInsideTheBestRelocationIngestionWindow(input: {
  timestamp: Date | null;
  sourceReadThrough: Date;
}): boolean;
```

## Precise logic I would tighten while renaming

1. **Two official books, six tabs, never Local Calls.** Leads book: Forms, Local Forms, Calls. Booked book: Booked Deals, Refunds, LID_BestRelo. `LOCAL_CALLS_TAB` is declared and never read. Do not start reading Local Calls in this rename.

2. **Cutoff inclusive, read-through exclusive.** `timestamp >= BEST_RELOCATION_CUTOFF && timestamp < sourceReadThrough`. Cutoff is `2026-04-30T04:00:00.000Z`. The leftover worker stamps `source_read_through` in leftover `repository.createQueuedIngestionRun` and hands the same instant to leftover `adapter.read`.

3. **Invalid timestamp throws on read, counts on inspect.** `readBestRelocationWorkbooks` → leftover `inWindow` throws `Authoritative source row has an invalid timestamp.` `inspectBestRelocationWorkbookCounts` → leftover `windowCounts` increments `missingTimestamp`. Do not silently unify those two.

4. **LID_BestRelo is matching evidence, not an action, and is not windowed.** The read returns every parsed LID row. Inspect counts never read that tab. Leftover `provider.inspectBestRelocationSources` *does* read LID_BestRelo (and still does not read Local Calls). Do not make LID_BestRelo an ingest action in this rename.

5. **Three independent tab readers.** This file’s read, this file’s inspect counts, and leftover `provider.inspectBestRelocationSources` each call leftover `readTab` themselves. The leftover worker’s inspect asks the provider, not this file’s inspect counts. Do not start the worker on inspect counts.

6. **Window asked twice on apply.** Leftover `applicationPlan.ts` asks leftover `isWithinIngestionWindow` again when grouping refunds, and **keeps refunds that have no timestamp**. The read already dropped those same refunds (or threw). Do not “fix” that keep-no-timestamp refund rule in this rename.

7. **Official IDs first, then deprecated `BACKFILL_*`.** `resolveWorkbookIds` warns through leftover `onDeprecationWarning` (default `console.warn`). Do not drop the aliases in this rename. Wave B `configuredSourceSummary` asks this resolver, then leftover `maskSpreadsheetId`.

8. **This file does not ask leftover `operationalWorkbooks`.** Those two keys are already registered there as `ingestion_source` (`operational-workbooks-registry.md`). Wiring the registry here is a later pass, not this rename.

9. **Third Google-identity reader.** Leftover `serviceAccountAuthSource` hardcodes the same live JSON filenames as leftover `googleAuth/serviceAccount.ts`, adds `SERVICE_ACCOUNT_LOCAL_FILE_JSON`, and has **no** `TEST_MODE` file fence (`google-auth-service-account.md`). Readonly client for read and inspect. Writable client exists only because leftover `provider.ts` still offers the fenced managed-identity repair. Do not start identity repair from the read path.

10. **Reporting Sheets are a different book.** Do not write leftover Reporting destinations from this reader (`google-sheets-reporting.md`).

11. **CLI live apply is retired.** Leftover `scripts/best-relocation-sheet-ingest.ts` may still ask inspect counts and read. Leftover `apply.ts` throws if the CLI tries a live apply. Durable apply stays on leftover `ingestion/worker.ts` → leftover `adapter.apply`.

## Testing

Existing coverage: leftover `src/services/ingestion.test.ts` proves the cutoff ISO string and the inclusive/exclusive window (`isWithinIngestionWindow(cutoff) === true`, one millisecond before is false, `sourceReadThrough` itself is false). The same file’s source-reads suite proves leftover `provider.ts` builds the writable client before the readonly client and never builds a writable client for ordinary reads. Leftover `canonicalLeadAdoption.test.ts` stamps cutoff plus timezone onto adopted leads. Leftover `bestRelocationSheetIngest.test.ts` covers parse / match / plan / update-policy / dry-run — it does **not** ask `readBestRelocationWorkbooks`.

Add tests at the four-operation interface. Do not start with a Google mock rewrite.

- **Read keeps a Forms row on the cutoff and drops the same row on `sourceReadThrough`.** Fixture: one parsed Forms row at `2026-04-30T04:00:00.000Z` is kept; the same row at the leftover worker’s `source_read_through` is dropped.

- **Read throws on an invalid timestamp; inspect counts it.** Same broken Forms timestamp: `readTheTwoBestRelocationWorkbooksAfterTheCutoff` throws `Authoritative source row has an invalid timestamp.`; `countWhatEachBestRelocationTabWouldContribute` returns `missingTimestamp >= 1` and does not throw.

- **Read never asks Local Calls.** A spy on leftover `readTab` sees `Forms`, `Local Forms`, `Calls`, `Booked Deals`, `Refunds`, `LID_BestRelo` — not `Local Calls`.

- **Read returns LID_BestRelo rows from before the cutoff; inspect does not read that tab.** A pre-cutoff LID row is present on the read snapshot. A spy on inspect counts never sees `LID_BestRelo`.

- **Official IDs win over deprecated `BACKFILL_*`.** When both official and backfill env vars are set, leftover `resolveTheOfficialBestRelocationWorkbookIds` returns the official pair and does not fire leftover `onDeprecationWarning`. When only backfill vars are set, it returns those IDs and warns.

- **Missing either ID throws.** Unset leads or booked ID → throw. Do not invent a hardcoded spreadsheet ID.

- **Inspect counts Forms missing identity and Calls missing identity as zero.** A Forms row with neither `lead_id` nor `ref_no` increments leftover `missingDurableIdentity`. Calls leftover `missingDurableIdentity` stays `0`.

Caller to keep green: leftover `src/services/ingestion.test.ts` window and cutoff assertions; leftover `canonicalLeadAdoption.test.ts` cutoff/timezone stamps; leftover `applicationPlan.ts` refund re-window (timestamp-less refunds still kept at plan time); Wave B `configuredSourceSummary` still resolves IDs then masks them; leftover CLI inspect still asks leftover `inspectBestRelocationWorkbookCounts`.

## What I would not do

- I would not rename this file’s exports and leave the six-tab read, the inspect-count path, the ID resolver, and the window helper unnamed. That is a CRUD dump.

- I would not merge leftover `readBestRelocationWorkbooks` and leftover `inspectBestRelocationWorkbookCounts` into one “fetch the workbook” function. Read throws; inspect counts. Worker inspect stays on leftover `provider.ts`.

- I would not start reading Local Calls, window LID_BestRelo, or make LID_BestRelo an ingest action.

- I would not drop deprecated `BACKFILL_*` aliases in this rename.

- I would not move identity repair onto the read path, or give this reader a writable Sheets client for ordinary reads.

- I would not write leftover Reporting Sheets from this file.

- I would not introduce a `BestRelocationSheetService` class or a `create.ts` / `update.ts` / `delete.ts` split.

- I would not silently “fix” leftover `applicationPlan.ts` keeping timestamp-less refunds, or start the leftover worker on this file’s inspect counts.

- I would not edit `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
