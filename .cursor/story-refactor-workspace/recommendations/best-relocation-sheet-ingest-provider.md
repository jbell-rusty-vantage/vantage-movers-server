# Recognize The Six Best Relocation Tabs, Atomically Repair Empty Call And Refund Identities Under The Fence, Then Prove LID Still Has Formulas — Never Window, Never Plan, Never Write From HTTP Inspect — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 6 of this service — `provider.ts`
- Remaining in this service: `identity.ts`, `sourceChangePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/provider.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Role: inspect Best Relocation sheets, then plan. HTTP: `POST .../inspect` is read-only; `repair_identity=true` is Owner-gated and still **409** — repair runs only inside a fenced bootstrap/apply. Skip/fail: copied / malformed managed identities **block** inspect/repair; preview never writes identity cells. Health: `schema_or_formula_drift` always alerts. Primary-code list names `canonicalLeadAdoption.ts` / `sheets.ts` / `dryRunReports.ts`, not this file — do not add a second Ingestion Service so “the provider owns the happy path.” Distinct from already-recommended six-tab read / window / CLI counts: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md) (that file windows at read and counts five tabs for the CLI; this file **asks** `readTab` + `resolveWorkbookIds` + the two clients a third time, never windows, and **does** read `LID_BestRelo`). Distinct from already-recommended parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md) (this file does not parse). Distinct from already-recommended HTTP screenplay / remap: [`best-relocation-sheet-ingest-plan.md`](best-relocation-sheet-ingest-plan.md), [`best-relocation-sheet-ingest-application-plan.md`](best-relocation-sheet-ingest-application-plan.md). Distinct from already-recommended worker inspect stamp: [`ingestion-worker.md`](ingestion-worker.md) (`adapter.inspect` **asks** this file; `connectionHealthFromInspection` groups `schema:` / `formula:` / `identity:`). Distinct from already-recommended health letters: [`ingestion-health.md`](ingestion-health.md). Distinct from later identity mint: `identity.ts` (this file **asks** `MANAGED_ID_HEADER` / `isValidManagedIngestionId` / `newManagedIngestionId`; it does not mint `stableSourceRowId`). Distinct from later receipt skip / Mongo adopt / HTTP apply. CLI `main` **asks** `inspectBestRelocationWorkbookCounts`, not this file. Folder `HANDOFF.md` is not knowledge — do not copy it (it does not list this file). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: Wave B `src/routes/ingestion.routes.ts` `POST .../inspect` **asks** `inspectBestRelocationSources({ repairIdentity: false })` after **409** on `repair_identity=true`. `adapter.ts` `inspect` **asks** this file after a write-lease `assertHeld` when `repair_identity` is true. `worker.ts` sets `repair_identity` for `bootstrap` / `schedule` / `retry` only (preview / manual never repair), stamps `ExternalDataConnection` health, then `schema_or_formula_drift` + `failRun` `STRUCTURAL_INSPECTION_FAILED` when `healthy` is false. `ingestion/ingestion.test.ts` **asks** `inspectOrRepairManagedIdentity` for preview-never-writes, leased empty-cell write + read-back, copied IDs block, malformed IDs block, concurrent fill stays, atomic `^$` replace; source-read proves this file builds the writable client **before** the readonly client. Folder `bestRelocationSheetIngest.test.ts` does **not** import this file. Barrel `index.ts` `export *`. Unused import: `managedId`.
- Seams callers need: HTTP inspect / this-file (`repairIdentity` always false); adapter inspect / this-file (repair only after the write lease); this-file / workbook reader (`readTab` + clients, never `readBestRelocationWorkbooks` / never CLI counts); this-file / identity (`vantage:` mint only — no `stableSourceRowId`); this-file / LID formula re-read (`FORMULA`, not `FORMATTED_VALUE`). There is no window **seam**. There is no plan **seam**. There is no Domain Command **seam**.
- Split later (only if the file outgrows one sitting): this ~358-line file is one sitting if you read it as recognize the six tabs, atomically repair empty Call and Refund identities under the fence, then prove LID still has formulas. Do **not** split into `schema.ts` / `identityRepair.ts` / `formula.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull `sheets.ts`, `identity.ts`, `adapter.ts`, or `ingestion/worker.ts` here. If it later splits: `recognizeTheSixBestRelocationTabs.ts` / `atomicallyRepairEmptyCallAndRefundIdentities.ts` / `proveLidStillHasFormulas.ts` only as later story files, never CRUD.

`inspectBestRelocationSources` / `inspectOrRepairManagedIdentity` / `REQUIRED_HEADERS` are executor mechanics. The owner question is: *Open the two official Best Relocation books. Check that Forms, Local Forms, Calls, Booked Deals, Refunds, and LID_BestRelo still have the headers we need, and that LID still has the amount buckets. On Calls and Refunds only, look at vantage_ingestion_id. If this is a fenced bootstrap, schedule, or retry, write a new vantage UUID into empty cells only — never overwrite a cell that already has a value, never accept a copy, never fall back to row number. Then re-read LID as formulas and refuse the inspect if people filled that tab by hand. Mask the two spreadsheet IDs. HTTP inspect never writes. This file does not window. This file does not parse. This file does not plan.*

Window / parse / pair / HTTP screenplay / remap / identity mint / receipt skip / Mongo adopt / HTTP apply already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “recognize the six tabs, atomically repair empty Call and Refund identities under the fence, then prove LID still has formulas” story, not “a provider CRUD helper,” and not the six-tab windowed read / CLI five-tab counts.

1. **Recognize the six-tab schema, including LID amount buckets** — `inspectBestRelocationSources` **asks** `resolveWorkbookIds`, then `Promise.all` of six `readTab`s: Forms / Local Forms / Calls from the leads book; Booked Deals / Refunds / LID_BestRelo from the booked book. Never Local Calls. `REQUIRED_HEADERS` is the owner list (`Time Stamp` + name/zips/move/phone on both Form tabs; `PHONE NUMBER` + Date + Time on Calls; Timestamp / Agent / Book Date / Job / customer / binder / deposit / Merchant / Lead Source on Booked Deals; Refund Request Date / Status / Timestamp / Job / Lead Source on Refunds; `BestRelo Booked Forms` on LID). `hasHeader` folds trim / lower / non-alnum → space. Missing headers are `schema:${tab}` **blocking**. LID row 2 must still name `<1K`, `>2K`, `>4K` (`schema:LID_BestRelo:buckets`). This function does not window. This function does not parse.

2. **Inspect or atomically repair managed identities on Calls and Refunds only** — after schema, only those two tabs **ask** `inspectOrRepairManagedIdentity`. Forms / Local Forms / Booked Deals never get a `vantage_ingestion_id` write. Header find is `/^vantage[ _]ingestion[ _]id$/i`, not `identity.ts` `MANAGED_ID_ALIASES`. Missing header + repair: append `MANAGED_ID_HEADER` after `max(headers.length, row lengths)` so an unlabeled trailing LID column is not claimed. Missing header + no repair: **blocking**. Walk populated rows (blank rows skip). Empty cell → collect for repair, or **blocking** `rows requiring managed identity repair` when `repair` is false. Malformed (`!isValidManagedIngestionId`) → **blocking** immediately (`malformed_count: 1`). Case-insensitive duplicate → **blocking** `duplicate_count`. Repair: mint `newManagedIngestionId()`, `batchGet` FORMATTED_VALUE, keep only cells that are still empty; a concurrent valid unique id is adopted; a concurrent malformed or duplicate is **blocking** `changed during managed identity repair`. Writes use `findReplace` `^$` on that one cell (`includeFormulas: true`). Read-back must show `occurrencesChanged === 1` and the minted id, or a concurrent valid unique id with `changed === 0`. Anything else **throws** (`refusing an unconditional fallback write`). Missing `tabId` **throws**. Preview / HTTP inspect never pass `repair=true`.

3. **Prove LID_BestRelo still has formulas** — `inspectLidFormulaHealth` re-reads `tab.rangeRead` with `FORMULA`. Header row is skipped. Populated rows with no cell starting `=` are **blocking** `formula:LID_BestRelo`. An empty tab is healthy. This is matching-evidence health, not an action. `LID_BestRelo` never becomes a plan row here.

4. **Return the masked two-book inspection** — `healthy` is true iff no check is `blocking`. `sources` are leads + booked titles plus `maskSpreadsheetId`. `checked_at` is now. Worker maps `schema:` / `formula:` / `identity:` onto connection health; any blocking check fails the run before plan. Writable client is built only when `repairIdentity` is true; otherwise readonly.

Shared beats, not owner operations: `hasHeader` / `normalizeHeader`, `escapeTab`, a second `columnLetter` (sheets.ts already has one; this copy has no `Math.max(1, value)` floor), unused `managedId` import.

## Organization

Keep one file as the screenplay for “recognize the six Best Relocation tabs, atomically repair empty Call and Refund identities under the fence, then prove LID still has formulas — never window, never plan, never write from HTTP inspect.” Windowed read, CLI counts, parse, pair, plan, remap, identity mint, receipt skip, Mongo adopt, and apply already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationProviderService` class. Do not invent a begin / complete **seam** here — inspect is not a Domain Command. Do not invent a second window **adapter** beside `sheets.ts`. Do not invent a second identity **adapter** beside `identity.ts`. Do not invent a second inspect **adapter** beside CLI `inspectBestRelocationWorkbookCounts`.

**External interface** stays small (this is the test surface). Faces Wave B inspect / `adapter.ts` / `ingestion.test.ts` already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `inspectBestRelocationSources` | `inspectTheTwoBestRelocationWorkbooksAndRepairEmptyCallAndRefundIdentities` | Wave B HTTP inspect (always `repairIdentity: false`); `adapter.inspect` (fenced repair) |
| `inspectOrRepairManagedIdentity` | `inspectOrAtomicallyRepairManagedIdentitiesOnThisTab` | `ingestion.test.ts` identity cases; parent **asks** Calls + Refunds only |

Keep the old names as one-line aliases until the route, adapter, barrel, and `ingestion.test.ts` migrate. Do not export `inspectLidFormulaHealth` / `REQUIRED_HEADERS` / `hasHeader` / `columnLetter`. Do not make callers learn `InTransaction` or CRUD verbs.

**No class for the workflow.** The one type that earns a name is the masked inspection worker stamps onto the connection:

```ts
type BestRelocationWorkbookInspection = {
  healthy: boolean
  checked_at: string
  sources: Array<{ role: "leads" | "booked"; title: string; masked_id: string }>
  checks: Array<{ key: string; status: "healthy" | "warning" | "blocking"; summary: string }>
}
```

That is today’s `IngestionInspection` from `ingestion/types.ts`. Do not move the type here so “the provider owns inspect.” Do not put `source_read_through` on the return so “this file can window.” Do not put parsed rows on the return so “inspect can plan.”

`TabReadResult` / `SheetsClient` stay on sibling `sheets.ts`. `MANAGED_ID_HEADER` stays on sibling `identity.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// provider.ts
// Open the two official Best Relocation books.
// Check the six tabs still have the headers we need.
// On Calls and Refunds, look at vantage_ingestion_id.
// If this is a fenced bootstrap, schedule, or retry,
// write a new vantage UUID into empty cells only.
// Re-read LID as formulas and refuse a handmade tab.
// Mask the two spreadsheet IDs.
// HTTP inspect never writes.
// This file does not window. This file does not parse.
// This file does not plan.

// ── 1. Recognize the six-tab schema ───────────────────────

export async function inspectTheTwoBestRelocationWorkbooksAndRepairEmptyCallAndRefundIdentities(input)
function readTheSixTabsAndNeverLocalCalls(client, ids)
function refuseATabMissingARequiredHeader(tab)          // including LID title row
function refuseLidMissingAmountBuckets(lid)             // <1K / >2K / >4K on row 2

// ── 2. Inspect or atomically repair Call and Refund ids ───

export async function inspectOrAtomicallyRepairManagedIdentitiesOnThisTab(client, tab, repair)
function findTheManagedIdentityColumnOrAppendItUnderTheFence(tab, repair)
function refuseMalformedOrCopiedIdentities(tab, column)
function rereadEmptyCellsBeforeWriting()
function writeOnlyStillEmptyCellsWithFindReplaceEmpty(repairs)
function refuseAnUnconditionalFallbackWrite()

// ── 3. Prove LID still has formulas ───────────────────────

function proveLidStillHasFormulas(client, lid)          // FORMULA render

// ── 4. Return the masked inspection ───────────────────────

function maskTheTwoWorkbookIds(ids, titles)
function healthyOnlyWhenNothingIsBlocking(checks)
```

Read the primary path out loud: *Open the two official books. Check Forms, Local Forms, Calls, Booked Deals, Refunds, and LID_BestRelo still have the headers we need, and that LID still names the amount buckets. On Calls and Refunds only, look at vantage_ingestion_id. If this is a fenced bootstrap, schedule, or retry, write a new vantage UUID into empty cells only — never overwrite, never accept a copy, never fall back to row number. Re-read LID as formulas and refuse the inspect if people filled that tab by hand. Mask the two spreadsheet IDs. HTTP inspect never writes. Do not window. Do not parse. Do not plan.*

That is the operation. `inspectBestRelocationSources` is not.

## Precise logic I would tighten while renaming

1. **Three inspects.** This file is structural health + fenced identity repair. `sheets.inspectBestRelocationWorkbookCounts` is CLI five-tab counts (no LID, missing timestamps counted). `sheets.readBestRelocationWorkbooks` is the windowed six-tab read. Worker inspect **asks** this file, not CLI counts. Do not start the worker on inspect counts so “one inspect owns health.”

2. **`source_read_through` is unused here.** `IngestionInspectInput` carries it. `adapter.inspect` receives it. This file never takes cutoff or read-through. Inspect sees every populated row. Do not start windowing inspect so “one window owns cutoff.”

3. **HTTP inspect cannot repair.** Wave B **409**s `repair_identity=true` before this file runs, then passes `repairIdentity: false`. Do not start honoring HTTP repair so “Owner asked.” Knowledge: repair runs only inside a fenced bootstrap/apply.

4. **Preview / manual never write identity cells.** Worker sets `repair_identity` for `bootstrap` / `schedule` / `retry` only. Adapter still requires the write lease. This file does not **ask** the lease — the adapter does. Do not move the lease assert into this file so “the provider owns the fence.”

5. **Calls and Refunds only.** Forms use `lead_id` / `ref_no`. Booked Deals use Job. Do not start minting `vantage:` on Forms or Booked Deals so “every tab has a managed id.”

6. **Two header recognizers.** This file’s column find is `/^vantage[ _]ingestion[ _]id$/i`. `identity.ts` `managedId` walks exact `MANAGED_ID_ALIASES`. Unused `managedId` import. Do not start **asking** `managedId` here so “one header owns identity.” Do not silently unify the regex and the aliases.

7. **Two `columnLetter` copies.** `sheets.ts` floors with `Math.max(1, value)`. This file does not. Do not silently import the sheets helper so “one letter owns the range.”

8. **Malformed stops at the first bad cell.** `malformed_count` is always `1`. Duplicates collect `duplicate_count`. Do not start walking the rest of the tab after a malformed id so “one pass owns every smell.”

9. **Throws vs blocking checks.** Lost `tabId` and a failed atomic write **throw**. Schema / identity / formula smells **return** `blocking`. Worker treats a throw as structural failure and a `healthy: false` as `STRUCTURAL_INSPECTION_FAILED` / `schema_or_formula_drift`. Do not convert the throw into a check so “one status owns refuse.”

10. **LID is matching evidence.** This file reads it for title / buckets / formulas. Application plan never puts it on `authoritativeObservations`. Do not start emitting a LID action from inspect.

11. **Leave sibling modules alone.** `sheets.ts` read / counts / window, `identity.ts` stable ids, `adapter.ts` lease fence, `worker.ts` health stamp, `ingestion/health.ts` letters are already the right **depth**.

12. **Do not silently fix `HANDOFF.md`.** It still omits this file and describes HTTP `apply.ts` as the live path. Name the drift. Do not rewrite the handoff in this pass.

## Testing

The **interface** is the test surface: `inspectTheTwoBestRelocationWorkbooksAndRepairEmptyCallAndRefundIdentities` and `inspectOrAtomicallyRepairManagedIdentitiesOnThisTab`.

Today’s `ingestion.test.ts` already **asks** the child for preview-never-writes, leased empty-cell write + `vantage:` read-back, copied IDs block, malformed IDs block, concurrent fill stays (no write), and atomic `^$` replace that treats `changed === 0` + a valid unique id as healthy (summary does not say `Repaired 1`). The same file’s source-read proves this file builds the writable client before the readonly client. Folder `bestRelocationSheetIngest.test.ts` does **not** **ask** this file. That is close, but it never names the six-tab parent.

Replace the child-only style with tests that name the operation:

**Recognize the six-tab schema**
- Missing `Phone` on Forms → `schema:Forms` blocking; `healthy` is false.
- LID missing `>4K` on row 2 → `schema:LID_BestRelo:buckets` blocking.
- Local Calls is never **asked**.
- `source_read_through` on the adapter input does not drop a pre-cutoff row from identity or schema checks.

**Inspect or atomically repair Call and Refund identities**
- Preview / HTTP (`repair=false`) + empty Call cell → blocking, zero writes.
- Fenced repair writes one `vantage:` UUID into an empty Call cell and verifies read-back.
- Copied id on two Call rows → blocking `duplicate`, even when `repair=true`.
- `copied-row-2` → blocking `malformed`.
- Concurrent fill of a valid unique id → healthy, zero writes.
- Failed `findReplace` that is not a concurrent valid unique id → **throws**, no unconditional write.
- Refunds get the same empty-cell repair. Forms / Booked Deals are not **asked**.

**Prove LID still has formulas**
- Populated LID row with no `=` → `formula:LID_BestRelo` blocking.
- Empty LID tab → healthy.

**Return the masked inspection**
- Both books appear as `leads` / `booked` with masked ids, never raw spreadsheet ids.
- `healthy` is false when any check is blocking.
- `repairIdentity: false` never constructs the writable client.

Do **not** add a helper-unit test that has to change when `normalizeHeader` or `columnLetter` is inlined. Do not add a test per required header string if the parent already proves one missing header blocks.

Caller to keep green: Wave B inspect still **409**s repair and still **asks** `repairIdentity: false`; `adapter.inspect` still **asks** the lease before this file; `worker.ts` still stamps `schema:` / `formula:` / `identity:` and still fails `STRUCTURAL_INSPECTION_FAILED`; `ingestion.test.ts` identity cases above; CLI still **asks** `inspectBestRelocationWorkbookCounts`, not this file.

## What I would not do

- A `BestRelocationProviderService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `hasHeader`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `identityRepair.ts` / `formula.ts` split “for cleanliness.”
- Breaking the HTTP 409. Preview / manual / HTTP inspect must not start writing identity cells.
- Treating `sheets.ts` windowed read, CLI counts, `identity.ts` stable ids, `applicationPlan.ts` remap, or `ingestion/worker.ts` health stamp as this story.
- Making `LID_BestRelo` an action, windowing inspect, or minting `vantage:` on Forms / Booked Deals.
- Silently “fixing” unused `managedId`, unused `source_read_through`, the two header recognizers, the two `columnLetter` copies, or `HANDOFF.md` omitting this file.
- Starting Owner approve, Mongo adopt, or `runSheetSyncDrain` from this file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout's `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
