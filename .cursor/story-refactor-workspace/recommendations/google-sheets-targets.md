# Always Name Master First, Then The Source Company Sheet Only When The Flag Is On — Source Sheets Are Formula Derivatives Until Dual Write Is Restored — When Taking A Row Off, Also Name Destinations We Used To Write — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, in-progress)
- Pass: 2 of this service — `targets.ts`
- Remaining in this service: `tabs.ts`, `syncRows.ts`, `rowLookup.ts`, `deleteRows.ts`, `retry.ts`, `projections/formLeadRow.ts`, `projections/callLeadRow.ts`, `projections/bookedLeadRow.ts`, `projections/cancelledLeadRow.ts` (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/targets.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (Master always first; Source Company Sheets only when `shouldWriteSourceLeadSheets()` is the literal `"true"`; source-target plumbing stays either way; `getSourceLeadTabs` starts from Master Leads tabs and, when `hasBadTabs`, also appends `Bad Leads` and `Bad Calls`; `not_provided` / `paid_overflow` have no source container; `main_site` has `hasBadTabs: false`; delete resolves fallback + historical `sheet_sync`). Distinct from already-recommended choose-tabs-then-write-or-take-off: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (that facade **asks** this file for lead destinations; it hard-codes Master Booked for Booking / Cancellation and builds Master Bad Leads itself). Distinct from already-recommended queued plan: [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md) (same `getLeadTargets` for Form / Call; tombstone uses `getHeadersForSyncTarget`; Booked / Cancelled `ensureTabs` stay `[]` there). Distinct from leftover Call tombstone both-tabs fallback: [recommendations/leads-call-lead.md](leads-call-lead.md) (`buildCallLeadDeletePreviousTargets` asks this file twice — current **and** opposite). Distinct from later single-tab ensure: later `tabs.ts`. Distinct from later upsert / later `deleteDimension`: later `syncRows.ts` / `deleteRows.ts`. Distinct from later cell values: later `projections/*Row.ts`. Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names the `hasBadTabs` double-append of `Bad Leads`; do not “fix” that in this rename.
- Callers: **four runtime import sites, plus the folder test.** Already-recommended facade: `googleSheets.service.ts` — `getLeadTargets` for Form / Call write and leftover Form / Call take-off; `getMasterLeadsTabs` on the local Master Bad Leads destination; `getMasterBookedTabs` on Booking / Cancellation write and take-off plus bootstrap; `getSourceLeadTabs` on bootstrap per Source Company slug. Later delete: `deleteRows.ts` — `getDeleteTargets` only. Already-recommended planner: `sheetSync/drainer/jobPlanner.ts` — `getLeadTargets` for current Form / Call tabs and Call stale opposite; `getMasterLeadsTabs` on its local Master Bad Leads destination; `getHeadersForSyncTarget` on tombstone `previous_targets` (skip when headers are unknown). Leftover Call tombstone: `leads/callLead.service.ts` — `getLeadTargets` for **both** `duplicate=false` and `duplicate=true` so the snapshot names Calls **and** Duplicate Calls. Tests: `targets.test.ts` locks Duplicate Calls / Bad Leads header routing and Master Leads sibling presence — not the Master-vs-source flag, not the delete overlay. `v1.service.ts` does **not** re-export this file. Not this **interface**: facade tab choice (`duplicate` → Forms or Duplicates), later upsert, later `deleteDimension`, already-recommended `planJobWrites` resource switch, leftover `delete*FromSheets`, `WRITE_SOURCE_LEAD_SHEETS` itself (`shouldWriteSourceLeadSheets` lives on `config/domain/runtime.ts`).
- Seams callers need: Master-always plus optional Source Company (flag + container id) vs Booking / Cancellation Master Booked (not this file); name destinations for a write vs name destinations for a take-off (fallback now + remembered then); header lookup for a named target vs sibling-tab set for a container; this destination list vs already-recommended facade / planner tab **choice** (those files pick Forms or Duplicates; this file only expands Master / Source)
- Split later (only if the file outgrows one sitting): this ~170-line file is one sitting if you read it as name Master first, maybe name the Source Company sheet, then when taking a row off also name destinations we used to write. If it later splits: `nameTheMasterAndMaybeSourceDestinations.ts` / `nameTheDestinationsWeMustTakeTheRowOff.ts` / `nameTheSiblingTabsThisContainerShouldAlreadyHave.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `targets.ts` as a CRUD dump, and never merge already-recommended facade tab choice, already-recommended `planJobWrites`, later `ensureTabsAndHeaders`, or later `*ToRow` into this file

`getLeadTargets` / `getDeleteTargets` are executor mechanics. The owner question is: *The facade or the planner already chose Forms or Duplicates, Calls or Duplicate Calls. Name the spreadsheets that row belongs on. Master Leads always. The Source Company sheet only when `WRITE_SOURCE_LEAD_SHEETS` is the literal `"true"` and that company has a container — those source sheets are formula derivatives of Master until dual write is restored. The source-target names stay in the call even when the flag is off, so we can turn dual write back on without a code change. When we take a row off, start from the destinations we intend now, then also name destinations we remember writing on `sheet_sync[]`. Booking and Cancellation are Master Booked only — this file names those sibling tabs, it does not assemble those destinations. Sheets are reporting. They are never the record.*

Already-recommended facade tab choice, already-recommended planner resource switch, later single-tab ensure, later upsert / delete cells, and later projections already live in other **modules**. Do not pull those in.

## What this file actually does

Four beats of one “always name Master first, then the Source Company sheet only when the flag is on — when taking a row off, also name destinations we used to write” story, not “a target CRUD helper,” and not the facade’s Forms-or-Duplicates choice:

1. **Name the Master (and maybe Source Company) destinations for this lead tab** — `getLeadTargets(masterTarget, sourceTarget, sourceCompany, tabName, headers)`. Always push Master Leads (`getMasterLeadsSheetContainerId()`, `ensureTabs: getMasterLeadsTabs()`). Then, only when `shouldWriteSourceLeadSheets()` is true **and** `getSourceLeadSheetContainerId(sourceCompany)` returns an id, push the Source Company destination (`ensureTabs: getSourceLeadTabs(sourceCompany)`). When the flag is off, the source-target argument is ignored and the list is one destination. `not_provided` / `paid_overflow` have no `leadSheetEnvVar`, so even with the flag on they stay Master-only. This beat does not choose Forms vs Duplicates. This beat does not name Master Bad Leads. This beat does not name Booked Deals or Cancelled Deals.

2. **Name the destinations we must take the row off** — `getDeleteTargets(document, fallbackTargets, syncedTargets)`. Seed a map from the fallback list (the destinations we intend now), attaching `knownRowNumber` from a matching `sheet_sync[].target`. Then, for each remembered `sheet_sync` entry whose `target` is in `syncedTargets` **and** whose name still has headers, overlay that spreadsheet:tab (same key wins — remembered entry replaces the fallback when the keys collide). Return the map values. Later `deleteRowsFromTargets` is the only runtime caller. Unknown target names are skipped (`getHeadersForSyncTarget` returns `undefined`). This beat does not call Google. This beat does not delete a row.

3. **Name the header row for a remembered target** — `getHeadersForSyncTarget(target)`. Forms / Duplicates / Bad Leads → `FORM_SHEET_HEADERS`. Calls / Duplicate Calls → `CALL_SHEET_HEADERS`. Booked Deals → `BOOKED_SHEET_HEADERS`. Cancelled Deals → `CANCELLED_SHEET_HEADERS`. Source names share the matching Master headers. Already-recommended tombstone plan uses this and skips when headers are missing. There is no `source_bad_leads` name. This beat does not return a spreadsheet id.

4. **Name the sibling tabs this container should already have** — `getMasterLeadsTabs` (Forms, Calls, Duplicates, Duplicate Calls, Bad Leads). `getMasterBookedTabs` (Booked Deals + Cancelled Deals; optional booked-header override, unused by current callers). `getSourceLeadTabs(sourceCompany)` copies the Master Leads set, then when that company’s `hasBadTabs` is true also appends `Bad Leads` again and `Bad Calls`. `getEnsureTabsForSyncTarget` maps a named target back onto one of those sets — Master lead names → Master Leads set; source lead names → a **hard-coded** Forms/Calls/Duplicates/Duplicate Calls/Bad Leads/Bad Calls list (always includes `Bad Calls`, no `hasBadTabs` check); Booked / Cancelled → Master Booked set; unknown → `[]`. Bootstrap on the already-recommended facade uses beats 4’s Master / Source helpers. Later per-row ensure uses only the one tab being written — that is later `tabs.ts`.

There is no fifth mutate operation. Tab **choice**, upsert, `deleteDimension`, quota, and cell values are other files. `deleteTargetKey` is the spreadsheet:tab dedupe string used inside operation 2; it is exported and unused outside this file.

## Organization

Keep one file as the screenplay for “always name Master first, then the Source Company sheet only when the flag is on — source sheets are formula derivatives until dual write is restored — when taking a row off, also name destinations we used to write.” Already-recommended facade tab choice, already-recommended `planJobWrites`, later `ensureTabsAndHeaders`, later `syncRowToTargets` / `deleteRowsFromTargets`, and later `*ToRow` already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleSheetsTargetsService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator. Do not invent a second tab-choice **adapter** beside already-recommended `callLeadTargetBase` / planner `formLeadTargetBase`. Do not invent a `getBookedTargets` that dual-writes Booked Deals to a source container.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `get.ts`. Those are HTTP verbs, not the owner story. Do not move this into `googleSheets.service.ts` so “the facade already chooses tabs.” Do not move this into `jobPlanner.ts` so “one planner owns destinations.” Do not silently write source sheets when the flag is off so “dual write is simpler.” Do not silently drop the unused `sourceTarget` argument so “the flag is unused.”

**External interface** stays small (this is the test surface). Master-first, optional Source Company, take-off overlay, and sibling-tab sets are one story’s destination naming, not eight CRUD getters:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getLeadTargets` | `nameTheMasterAndMaybeSourceDestinationsForThisLeadTab` | facade write / leftover take-off / planner Form-Call / leftover Call tombstone |
| `getDeleteTargets` | `nameTheDestinationsWeMustTakeTheRowOff` | later delete — fallback now + remembered then |
| `getHeadersForSyncTarget` | `nameTheHeaderRowForThisNamedTarget` | queued tombstone + delete reconstruction |
| `getEnsureTabsForSyncTarget` | `nameTheSiblingTabsThisRememberedTargetBelongsWith` | delete reconstruction only |
| `getMasterLeadsTabs` | `nameTheMasterLeadsSiblingTabs` | facade Bad Leads destination + bootstrap + planner Bad Leads |
| `getMasterBookedTabs` | `nameTheMasterBookedSiblingTabs` | facade Booking / Cancellation + bootstrap — planner does **not** import this |
| `getSourceLeadTabs` | `nameTheSourceCompanySiblingTabs` | facade bootstrap + source `ensureTabs` on operation 1 |
| `deleteTargetKey` | keep | internal spreadsheet:tab dedupe; do not grow a second public **seam** |

Keep the old names as one-line aliases until the already-recommended facade, already-recommended planner, later `deleteRows.ts`, leftover Call tombstone, and `targets.test.ts` migrate. Do not make callers learn `shouldWriteSourceLeadSheets` / `SOURCE_COMPANY_CONFIGS` / `sheet_sync[]` as the domain language.

**Principle: old exports stay as aliases.** `getLeadTargets` / `getDeleteTargets` remain the imported names until those four runtime sites point at the story names.

**No class for the workflow.** The type that *does* earn a name is the remembered destination later delete already needs before it looks up a row:

```ts
type RememberedReportingDestination = SyncTarget & {
  knownRowNumber?: number
}
```

That is the handoff from “we used to write this spreadsheet:tab” to “later delete can prefer the cached row, then fall back to Mongo ID.” Do **not** add `duplicate` so “this file can choose Forms or Duplicates,” do **not** add `created_on_unmatched` so “this file can skip,” and do **not** add `official_booking_details` so “a booked destination can confirm.”

`getMasterBookedTabs` stays exported because the already-recommended facade’s Booking / Cancellation destinations are a real **adapter**, not a test leak. This file names the sibling tabs; the facade assembles the `SyncTarget`. Do not add `nameTheMasterBookedDestination` in this pass so “bookings match leads.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// targets.ts
// The facade or the planner already chose Forms or Duplicates, Calls or Duplicate Calls.
// Name the spreadsheets that row belongs on.
// Master Leads always.
// The Source Company sheet only when WRITE_SOURCE_LEAD_SHEETS is the literal "true"
// and that company has a container.
// Those source sheets are formula derivatives of Master until dual write is restored.
// The source-target names stay in the call even when the flag is off.
// When we take a row off, start from the destinations we intend now,
// then also name destinations we remember writing.
// Booking and Cancellation are Master Booked only — this file names those sibling tabs.
// It does not assemble those destinations.
// Sheets are reporting. They are never the record.

// ── 1. Name the Master (and maybe Source Company) destinations ─

export function nameTheMasterAndMaybeSourceDestinationsForThisLeadTab(
  masterTarget,
  sourceTarget,
  sourceCompany,
  tabName,
  headers,
): SyncTarget[]
export const getLeadTargets = nameTheMasterAndMaybeSourceDestinationsForThisLeadTab

function alwaysNameMasterLeadsFirst(masterTarget, tabName, headers)
function nameTheSourceCompanySheetOnlyWhenDualWriteIsOn(
  sourceTarget,
  sourceCompany,
  tabName,
  headers,
)
  // flag off → undefined, plumbing retained
  // no leadSheetEnvVar → undefined even when the flag is on

// ── 2. Name the destinations we must take the row off ─────

export function nameTheDestinationsWeMustTakeTheRowOff(
  document,
  fallbackTargets,
  syncedTargets,
): RememberedReportingDestination[]
export const getDeleteTargets = nameTheDestinationsWeMustTakeTheRowOff

function seedFromTheDestinationsWeIntendNow(fallbackTargets, document)
function overlayDestinationsWeRememberWriting(document, syncedTargets)
function skipARememberedNameWithNoHeaders(target)

// ── 3. Name the header row for a remembered target ────────

export function nameTheHeaderRowForThisNamedTarget(target)
export const getHeadersForSyncTarget = nameTheHeaderRowForThisNamedTarget
  // Forms / Duplicates / Bad Leads → form headers
  // Calls / Duplicate Calls → call headers
  // Booked / Cancelled → their headers
  // no source_bad_leads name

// ── 4. Name the sibling tabs this container should already have

export function nameTheMasterLeadsSiblingTabs()
export const getMasterLeadsTabs = nameTheMasterLeadsSiblingTabs

export function nameTheMasterBookedSiblingTabs(bookedHeaders = BOOKED_SHEET_HEADERS)
export const getMasterBookedTabs = nameTheMasterBookedSiblingTabs

export function nameTheSourceCompanySiblingTabs(sourceCompany)
export const getSourceLeadTabs = nameTheSourceCompanySiblingTabs
  // copy Master Leads, then when hasBadTabs append Bad Leads again + Bad Calls
  // knowledge already names that double-append — do not silently drop it

export function nameTheSiblingTabsThisRememberedTargetBelongsWith(target)
export const getEnsureTabsForSyncTarget = nameTheSiblingTabsThisRememberedTargetBelongsWith
  // source_* is a hard-coded set that always includes Bad Calls
  // it does not call getSourceLeadTabs and does not read hasBadTabs

export const deleteTargetKey = (spreadsheetId, tabName) => `${spreadsheetId}:${tabName}`
```

Read the write-destination path out loud: *The facade already decided this Form is a Duplicate Lead. We name Master Duplicates on Master Leads. If the dual-write flag is the literal true and this Source Company has a container, we also name Source Duplicates on that company’s sheet. If the flag is off, we keep the source name in the call and return Master only. We do not name Master Bad Leads here — the facade adds that destination itself. We do not name Booked Deals here.*

Read the take-off path out loud: *Later delete hands us the destinations we intend now, plus the target names we are allowed to clear. We start from that fallback. Then we overlay every remembered `sheet_sync` row whose name is in that allowed list and still has headers. Same spreadsheet and tab is one destination. A remembered row number comes along so later delete can try the cache before Mongo ID. We do not call Google.*

Read the two-lists beat out loud: *Source sibling tabs have two lists. Bootstrap and a live source write use `getSourceLeadTabs`, which copies Master Leads and, when `hasBadTabs`, appends Bad Leads again and Bad Calls. Delete reconstruction of a `source_*` name uses a hard-coded set that always includes Bad Calls and does not read `hasBadTabs`. We do not silently make those lists one function.*

That is the operation. `getLeadTargets` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`getLeadTargets` / `getDeleteTargets` are executor mechanics.** The owner story is “always name Master first, then the Source Company sheet only when the flag is on — when taking a row off, also name destinations we used to write.” Keep the old names as aliases. Do not grow a `TargetsService` with `get` / `list` / `delete`.

2. **Master Bad Leads is not produced here.** Already-recommended facade and planner each build `masterBadLeadsTarget()` with `getMasterLeadsTabs()`. Operation 1 never returns `master_bad_leads`. Do not start appending Bad Leads inside `getLeadTargets` so “one function owns every Form tab.” Do not delete the local helpers on those callers in this pass.

3. **Booking / Cancellation destinations are not this file.** The facade hard-codes Master Booked and asks only `getMasterBookedTabs()` for sibling tabs. The planner’s `bookedTarget` / `cancelledTarget` use `ensureTabs: []` and do not import this helper. Do not add `getBookedTargets` in this rename so “bookings match leads,” and do not fill the planner’s `ensureTabs` so “we match the facade.”

4. **`getSourceLeadTabs` double-appends `Bad Leads` when `hasBadTabs`.** The Master Leads set already includes `Bad Leads`. Knowledge already names the extra append plus `Bad Calls`. Do not silently drop the second `Bad Leads` so “the list is unique.” Do not start writing `Bad Calls` rows so “we honor the tab.”

5. **Two Source Company sibling lists.** Operation 1 / bootstrap use `getSourceLeadTabs` (`hasBadTabs`-aware, double `Bad Leads`). Operation 2 reconstruction uses `getEnsureTabsForSyncTarget` for `source_*` — a hard-coded six-tab list that **always** includes `Bad Calls` and never reads `hasBadTabs`. `main_site` is `hasBadTabs: false`. Do not point the source `switch` at `getSourceLeadTabs` in this rename so “one list owns source tabs.” Do not teach `getSourceLeadTabs` to ignore `hasBadTabs` so “we match delete reconstruction.”

6. **The dual-write flag also skips the source env read.** Operation 1 calls `getSourceLeadSheetContainerId` only after the flag is on. That helper `getRequiredEnv`s a source container and **throws** when the env var is configured but empty. Knowledge says bootstrap “skips missing env”; bootstrap still calls the same helper and only continues when there is no `leadSheetEnvVar`. Do not wrap the source id in `try/catch` here so “we match the skip sentence.” Do not call the source id when the flag is off so “we fail closed earlier.” Leave `shouldWriteSourceLeadSheets` on `config/domain/runtime.ts`.

7. **Leftover Call tombstone asks this file twice.** `buildCallLeadDeletePreviousTargets` unions `getLeadTargets(..., false)` and `getLeadTargets(..., true)` so the snapshot names Calls **and** Duplicate Calls. Already-recommended leftover `deleteCallLeadFromSheets` deletes only the current tab. Do not change this file to return both Call tabs so “tombstone can call once.” That both-tabs rule lives on the Call leftover **module**.

8. **`deleteTargetKey` is exported and unused outside.** Dedup is spreadsheet:tab, not `target` name — a remembered `source_forms` on the same spreadsheet:tab as the fallback replaces it. Do not switch the key to `entry.target` so “names are unique.” Do not add a public `listDeleteKeys` **seam**.

9. **`getMasterBookedTabs(bookedHeaders?)` has no live override.** Every caller uses the default `BOOKED_SHEET_HEADERS`. Do not delete the argument in this rename so “dead code” — a later booked-header change may still pass through. Do not start passing Cancelled headers as booked headers so “one list owns both.”

10. **Unknown target names skip, they do not invent.** `getHeadersForSyncTarget` returns `undefined`; operation 2 `continue`s; the planner tombstone `continue`s. Do not default unknown names to form headers so “delete still tries.”

11. **This file does not choose Forms vs Duplicates.** Callers pass `masterTarget` / `sourceTarget` / `tabName`. Do not import `SHEET_TAB_NAMES.duplicates` here so “destination owns choice.” Already-recommended facade and planner already copy that table.

12. **Leave sibling modules alone.** `shouldWriteSourceLeadSheets` / `getMasterLeadsSheetContainerId` / `getSourceLeadSheetContainerId` / `SOURCE_COMPANY_CONFIGS` stay on `config/domain`. Already-recommended `syncFormLeadToSheets` / `planSourceLead` stay where they are. Later `deleteRowsFromTargets` stays on `deleteRows.ts`. Later `ensureTabsAndHeaders` stays on `tabs.ts`. This file orchestrates name Master → maybe name Source → overlay remembered take-off destinations.

## Testing

The **interface** is the test surface: the eight exports (story names, old names as aliases). Master-vs-source membership and take-off overlay are part of that **interface**. Stub `shouldWriteSourceLeadSheets` / container-id helpers, or set env in-process; do not boot Google Sheets.

Today’s `targets.test.ts` only locks Duplicate Calls / Bad Leads header routing and Master Leads sibling presence. That is not enough for a destination story this load-bearing.

Replace the “headers exist” style with tests that name the operation:

**Name the Master (and maybe Source Company) destinations**
- Flag off → exactly one destination, Master Leads, `ensureTabs` is the Master Leads sibling set; `sourceTarget` is ignored.
- Flag on + company with a container id → Master first, then Source Company; source `ensureTabs` come from `getSourceLeadTabs`.
- Flag on + `not_provided` / `paid_overflow` → Master only (no `leadSheetEnvVar`).
- Returned `target` names are the arguments the caller passed — this file does not rewrite `master_forms` into `master_duplicates`.

**Name the destinations we must take the row off**
- Fallback-only, empty `sheet_sync` → the fallback list, no `knownRowNumber`.
- Remembered entry in `syncedTargets` with headers → overlay that spreadsheet:tab and attach `row_number`.
- Remembered entry **not** in `syncedTargets` → ignored.
- Remembered entry with an unknown `target` name → ignored (no headers).
- Same spreadsheet:tab in fallback and remembered → one destination; remembered `knownRowNumber` wins.

**Name the header row / sibling tabs**
- Keep today’s Duplicate Calls → call headers and Master Leads set includes `Duplicate Calls`.
- Keep today’s Bad Leads → form headers and Master Leads set includes `Bad Leads`.
- `getSourceLeadTabs` for a `hasBadTabs: true` company includes `Bad Calls` and lists `Bad Leads` more than once (do not assert uniqueness).
- `getSourceLeadTabs` for `main_site` does **not** add `Bad Calls`.
- `getEnsureTabsForSyncTarget("source_forms")` includes `Bad Calls` even though that helper does not read `hasBadTabs` (the two source lists stay different).
- `getEnsureTabsForSyncTarget("master_booked")` is the Master Booked sibling set.
- Unknown name → `undefined` headers and `[]` sibling tabs.

**Not this interface**
- Forms-or-Duplicates / Calls-or-Duplicate-Calls choice stays on [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) and [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md).
- Legacy always-clear Bad Leads vs queued only-when-remembered stays on those two **adapters**.
- Unmatched Call skip stays on already-recommended lookup / planner.
- Single-tab ensure / header rewrite stay on later `tabs.ts`.
- Upsert-by-Mongo-ID stays on later `syncRows.ts` / `rowLookup.ts`.
- `deleteDimension` stays on later `deleteRows.ts`.
- Cell values stay on later `projections/*Row.ts`.
- `WRITE_SOURCE_LEAD_SHEETS` literal-`"true"` parsing stays on `runtime.test.ts`.

Do **not** add a test per helper (`alwaysNameMasterLeadsFirst`, `overlayDestinationsWeRememberWriting`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file skips `created_on_unmatched` — it must not. Do not add a test that this file names `master_bad_leads` from `getLeadTargets` — it must not. Do not add a test that this file assembles a Booked Deals `SyncTarget` — it must not.

`getMasterBookedTabs` / `getSourceLeadTabs` stay exported because bootstrap and the facade’s Booking destinations are real **adapters**, not a test leak.

## What I would not do

- A `GoogleSheetsTargetsService` class with `get` / `list` / `delete`.
- Thirty two-line functions that only wrap `getMasterLeadsSheetContainerId`.
- Moving this into a CRUD folder, or into `googleSheets.service.ts` / `jobPlanner.ts` / `deleteRows.ts` “for cleanliness.”
- Breaking the Master-first / flag-gated Source Company **seam**, or the fallback-then-remembered take-off **seam**.
- Treating `syncFormLeadToSheets` / `planJobWrites` / `deleteRowsFromTargets` / `formLeadToRow` as this story.
- Inventing a booked-destination **seam** that has only one **adapter** here.
- Silently writing source sheets when the flag is off, or silently dropping the unused `sourceTarget` argument, or silently uniquing `getSourceLeadTabs`, or silently pointing source `ensureTabs` at `getSourceLeadTabs`, or silently adding `getBookedTargets`.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `tabs.ts` in this same pass — unchecked `googleSheets` modules remain.
- Making the Form Lead 201 wait on `nameTheSourceCompanySiblingTabs`.
