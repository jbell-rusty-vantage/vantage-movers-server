# Apply The 0.9 Unattended Cut, Collapse Two-Agent Booked Deals Onto One Job, Then Write The HTTP Mutation Screenplay — Form, Call, Booking From Source Or Leadless, Cancellation Only After The Booking — Never Apply, Never Adopt Mongo, Never Invent A Checksum — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 4 of this service — `plan.ts`
- Remaining in this service: `applicationPlan.ts`, `provider.ts`, `identity.ts`, `sourceChangePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/plan.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Happy-path step 3: leftover `LID_BestRelo` is matching evidence only — never an action. Skip/fail: unmatched Booking → leadless Booking **plus** one reconciliation conflict; unmatched / below-threshold refund → blocking conflict, never invent a Cancellation. This file writes the leadless Booking and the warning. It does **not** open those conflicts — leftover `applicationPlan.ts` does. Primary-code list names leftover `canonicalLeadAdoption.ts` / leftover `sheets.ts` / leftover `dryRunReports.ts`, not this file — do not add a second Ingestion Service so “the HTTP plan owns the happy path.” Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md) (that file windows; this file never windows). Distinct from already-recommended leftover parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md) (this file **asks** leftover `normalizeJobNo` / leftover `toDateKeyFromRaw`; it does not parse). Distinct from already-recommended leftover match: [`best-relocation-sheet-ingest-matching.md`](best-relocation-sheet-ingest-matching.md) (this file **asks** all three leftover pair exports, then applies leftover `0.9` and drops leftover `lid_best_relo`). Distinct from later leftover application plan: leftover `applicationPlan.ts` (`AUTO_LINK_THRESHOLD = 0.9`, leftover `MATCH_CALIBRATION_VERSION = "best-relocation-conservative-v2"`; **asks** leftover `buildIngestPlan` as leftover `httpIngestPlan`, then remaps HTTP mutations onto checksum-bound leftover actions and **adds** leftover `unmatched_refund` + leftover leadless leftover `ambiguous_lead_match` conflicts). Distinct from later leftover HTTP apply: leftover `apply.ts` leftover `applyIngestPlan` (CLI live apply is retired; knowledge: approve through leftover `/api/v1/admin/ingestion`). Distinct from already-recommended leftover canonical walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md) (walks leftover `BestRelocationApplicationPlan` under leftover `assertHeld`; never leftover **asks** leftover `IngestPlan`). Distinct from later leftover Mongo adopt: leftover `canonicalLeadAdoption.ts`. Distinct from already-recommended Booking from source / leftover leadless: [`bookings-booked-lead-from-source.md`](bookings-booked-lead-from-source.md), [`bookings-leadless-booking.md`](bookings-leadless-booking.md) — this file writes leftover HTTP bodies; it does not leftover **ask** those leftover commands. Distinct from already-recommended Booking Identity Job fold: [`bookings-booking-identity.md`](bookings-booking-identity.md) — leftover `collapseBookingsByJob` leftover **asks** leftover `parsing.normalizeJobNo` (`P-123` → `P123`), not leftover `bookingIdentity`. Do **not** unify. Folder `HANDOFF.md` is not knowledge — do not copy it (it still describes leftover HTTP leftover `apply.ts` as the live path and leftover `0.5`). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: `applicationPlan.ts` `buildBestRelocationApplicationPlan` asks `buildIngestPlan(validData, { threshold: AUTO_LINK_THRESHOLD })` then `mapMutation` / `canonicalCommandPayload`; Form `invalidReason` asks `normalizeZip` / `normalizeMoveSize` first; `SOURCE_COMPANY` is imported and unused. `apply.ts` asks only the pinned host constant. Barrel `index.ts` re-exports `buildIngestPlan` / `collapseBookingsByJob` / `DEFAULT_MATCH_THRESHOLD` / the pinned host constant / the three folds / `SOURCE_COMPANY`. Folder test asks collapse (two agents, binders 700, deposit 500) and `buildIngestPlan` Form `lid_exact` plus `$ref` bindings; contradictory-LID `summary.unmatched_refunds === 1` after 0.9. CLI imports `buildIngestPlan` / `DEFAULT_MATCH_THRESHOLD` for unused `printSummary` and `BR_MATCH_CONFIDENCE_THRESHOLD`; `main` asks `buildBestRelocationApplicationPlan` and throws `--limit-bookings` / `--apply` / a threshold that is not `AUTO_LINK_THRESHOLD`. `dryRun.ts` asks `IngestPlan` types only. `adapter.ts` and `ingestion/ingestion.test.ts` ask `buildBestRelocationApplicationPlan`. Wave B `src/routes/ingestion.routes.ts` does not import this file.
- Seams callers need: pair-then-threshold (leftover match never applies leftover `0.9`; this file does); leftover `lid_best_relo` is evidence, not a Lead (this file plans that Job leadless and warns); leftover collapse (one leftover Job, one or two leftover agents, leftover binders sum, leftover deposit is leftover `max`); leftover HTTP screenplay order Form → Call → Booking → Cancellation; leftover `$ref:` leftover bindings leftover `apply.ts` later leftover resolves; leftover this-file / leftover application-plan (leftover remap + leftover conflicts live there); leftover this-file / leftover HTTP leftover apply (retired CLI live path). There is no Domain Command seam. There is no window seam. There is no checksum seam. There is no Mongo-adopt seam.
- Split later (only if the file outgrows one sitting): this ~437-line file is one sitting if you read it as apply the 0.9 unattended cut, collapse two-agent Booked Deals onto one Job, then write the HTTP mutation screenplay. Do **not** split into `threshold.ts` / `collapse.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover `matching.ts`, leftover `applicationPlan.ts`, leftover `apply.ts`, leftover `identity.ts`, leftover `canonicalLeadAdoption.ts`, or leftover `sheets.ts` here. If it later splits: `collapseTwoAgentBestRelocationBookedDealsOntoOneJob.ts` / `keepOnlyPairingsThatClearTheUnattendedCut.ts` / `writeTheOrderedHttpMutationScreenplay.ts` only as later story files, never CRUD.

`buildIngestPlan` / `collapseBookingsByJob` / `DEFAULT_MATCH_THRESHOLD` are executor mechanics. The owner question is: *Leftover match already paired sheet rows. Keep only pairings that clear 0.9. LID_BestRelo is not a Lead — book that Job leadless and say so. Collapse two-agent Best Relocation Booked Deals onto one Job: add the binders, do not add the deposit twice, refuse zero or three agents. Then write the HTTP play in order: every Form and Local Form, every Call, each collapsed Job as a Booking from source or leadless, then a Cancellation only when the Refund cleared 0.9 and that Booking is already in the play. Fold merchant, move size, and ZIP for those bodies. This file does not window. This file does not apply. This file does not adopt a Mongo Lead. This file does not invent a checksum. This file does not open leftover unmatched-refund or leftover leadless reconciliation conflicts — leftover application plan does.*

Leftover window / leftover parse / leftover pair / leftover application-plan remap / leftover HTTP apply / leftover Mongo adopt already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “apply the 0.9 unattended cut, collapse two-agent Booked Deals onto one Job, then write the HTTP mutation screenplay” story, not “a plan CRUD helper,” and not leftover window / leftover pair / leftover application-plan conflicts / leftover apply.

1. **Collapse two-agent Best Relocation Booked Deals onto one Job** — leftover `collapseBookingsByJob(rows)`. Keep only leftover `is_best_relocation_source`. Group by leftover `normalized_job_no`, else leftover `parsing.normalizeJobNo` (a missing leftover Job throws `Booked Deals row N has no job number`). Leftover `primary` is the **first** row in appearance order. Agents are unique trimmed leftover `agent` cells. Zero or more than two agents throws “current booking endpoint supports one or two.” Leftover `total_binder_amount` sums leftover `binder_amount` through leftover `roundMoney`. Leftover `deposit_amount` is `Math.max(...deposits, 0)` — split-agent rows **repeat** the deposit; they are not two deposits. Folder test Jacob + Patrick on leftover `P123`: binders `350+350=700`, deposit `500` not `1000`. This function does not pair. This function does not apply leftover `0.9`.

2. **Keep only pairings that clear the 0.9 unattended cut — LID_BestRelo is never a Lead** — leftover `buildIngestPlan` leftover **asks** leftover `matchLeadsToBookings` / leftover `matchRefundsToBookings` / leftover `selectBestRelocationRefundObservations`. Leftover `threshold` defaults to leftover `DEFAULT_MATCH_THRESHOLD` `0.9` (must be finite and between `0` and `1`, or throw). Accepted Refund pairings: leftover `confidence >= threshold`. Accepted Lead pairings: leftover `confidence >= threshold` **and** leftover `lead.kind !== "lid_best_relo"` **and** the Job is in the collapsed set (optional leftover `limitBookings` slices first). Leftover `bestLeadMatchByJob` keeps the highest accepted score per Job. Leftover `leadMatchResult.unmatchedBookings` is **unused**. Leadless Jobs are collapsed Jobs missing from leftover `matchByJob` — including leftover `lid_best_relo_only` Bookings leftover match already marked paired. Leftover `lidOnly` at or above the cut becomes a warning (“planned as leadless bookings”), not a Form or Call. Unmatched / review-only Refund count becomes a warning (“could not be linked and were not planned”), not an leftover `unmatched_refund` conflict.

3. **Write every Form and Call as an HTTP create** — leftover `mapFormMutation` for every Forms and Local Forms row. Local stamps leftover `local: "local"` + leftover `crm_company_label: "Best Relocation Locals"`; long-distance stamps leftover `local: "long_distance"` + leftover `"Best Relocation Forms"`. ZIP / move size leftover **ask** leftover `normalizeZip` / leftover `normalizeMoveSize` (throw on garbage). Leftover `post_to_granot: false`. Leftover `ingestion_source: "best_relocation_sheet"`. Leftover `source_company: SOURCE_COMPANY` (`best_relocation_leads`). Leftover `ref_no` falls back to leftover `lead_id`. Idempotency leftover `form:${SOURCE_COMPANY}:${(lead_id ?? ref_no ?? source_row_key).toLowerCase()}`. Leftover `mapCallMutation` for every Call. An accepted Call pairing enriches leftover `job_no` + leftover `name` from the Booking and stamps leftover `confidence` / leftover `match_method`. Call idempotency leftover `call:${SOURCE_COMPANY}:${phone}:${day}:${time || sheet_row}` leftover **asks** leftover `toDateKeyFromRaw`.

4. **Write each collapsed Job as a Booking from source, or leadless** — leftover `mapBookingMutation`. Idempotency leftover `booking:${SOURCE_COMPANY}:${normalized_job_no}`. Common body folds leftover `normalizeMerchantName` (`Elavon` / leftover `Elavon CC` → leftover `Elavon`; leftover `Paper Check` / leftover `Paper Check WF` → leftover `Paper Check`; else throw). Leftover `agent` / leftover `split_agent` from the collapsed agent list. No accepted Lead, or leftover `lid_best_relo`, → leftover `create_leadless_booking` leftover `POST /api/v1/leadless-bookings` with leftover `source_company: SOURCE_COMPANY` and leftover `total_binder_amount`. Form pairing → leftover `create_booked_from_source` leftover `POST /api/v1/booked-leads/from-source` with leftover `form_lead_id: $ref:${leadKey}`, leftover `bindings.form_lead_id`, leftover `depends_on: [leadKey]`, leftover `source_company` **from the sheet Lead Source** (not leftover `SOURCE_COMPANY`), leftover `binder_amount` = summed binders. Call pairing deletes leftover `job_no` and uses leftover `call_phone_number` + leftover `call_job_no`. Sheet provenance is leftover `{ rows }` of every collapsed row.

5. **Write a Cancellation only when the Refund cleared 0.9 and the Booking is already planned** — leftover `mapCancellationMutation`. Walk leftover `acceptedRefundMatches`. Skip if leftover Job is missing or not in leftover `includedJobs`. Skip if leftover `bookingMutationByJob` has no leftover `create_booked_from_source` / leftover `create_leadless_booking` for that Job (leftover `idempotency_key` last segment). Then leftover `create_cancelled_lead` leftover `POST /api/v1/cancelled-leads` with leftover `booked_lead: $ref:${bookingKey}`, leftover `bindings.booked_lead`, leftover `depends_on: [bookingKey]`. Refund amount is leftover `deposit_amount` else leftover `binder_amount` else `0`. Idempotency leftover `cancellation:${SOURCE_COMPANY}:${job}:${refund.sheet_row}`. This function does not invent a Cancellation for leftover review-only leftover `0.85`. It does not open leftover `unmatched_refund`.

Shared beats, not owner operations: leftover `normalizeMerchantName` / leftover `normalizeMoveSize` / leftover `normalizeZip` (leftover application-plan leftover Form leftover `invalidReason` leftover **asks** leftover ZIP / leftover move size first so leftover `buildIngestPlan` does not throw), leftover `sourceLeadKey`, leftover `bestLeadMatchByJob`, leftover `mutationCounts`, leftover `flag` (`booked|yes|true|>2k|>4k`), leftover `compact` (drops leftover `undefined` and leftover `""`), leftover `roundMoney`, leftover `the pinned host constant` (leftover `apply.ts` leftover pin), leftover `SOURCE_COMPANY`, leftover `mode: "dry-run"` always, leftover warning that leftover HTTP leftover apply still leftover **asks** leftover Sheet Sync.

Today's `unmatched_booking_jobs` lists each leadless Job with the best remaining match confidence / method from `leadMatchResult.matches` (scores below 0.9 and `lid_best_relo_only` included). `applicationPlan.ts` asks that list for leadless matching evidence.

## Organization

Keep one file as the screenplay for "apply the 0.9 unattended cut, collapse two-agent Booked Deals onto one Job, then write the HTTP mutation screenplay — never apply, never adopt Mongo, never invent a checksum." Window, parse, pair, application-plan remap, HTTP apply, and Mongo adopt already live in deeper modules. Do not pull those in. Do not invent a `BestRelocationPlanService` class. Do not invent a begin / complete seam here — this HTTP play is not a Domain Command. Do not invent a checksum adapter here — `applicationPlan.ts` asks `computeChecksum`. Do not invent a conflict adapter here — `applicationPlan.ts` opens `unmatched_refund` and leadless `ambiguous_lead_match`. Do not invent a second 0.9 adapter beside `DEFAULT_MATCH_THRESHOLD` / `AUTO_LINK_THRESHOLD` (name the pair; do not silently unify). Do not invent a second Job adapter beside `parsing.normalizeJobNo`.

**External interface** stays small (this is the test surface). Faces `applicationPlan.ts` / the folder test / the barrel already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildIngestPlan` | `writeTheBestRelocationHttpMutationScreenplayAfterTheUnattendedCut` | `applicationPlan.ts` asks it as `httpIngestPlan`; folder test Form `lid_exact` + refund 0.9 |
| `collapseBookingsByJob` | `collapseTwoAgentBestRelocationBookedDealsOntoOneJob` | `buildIngestPlan` asks it; folder test binders / deposit |
| `DEFAULT_MATCH_THRESHOLD` | keep | CLI parse; `buildIngestPlan` default 0.9 |
| `AUTO_LINK_THRESHOLD` lives on `applicationPlan.ts` | keep there | application plan asks `buildIngestPlan({ threshold: AUTO_LINK_THRESHOLD })` |
| `the pinned host constant` | keep | `apply.ts` pin |
| `SOURCE_COMPANY` | keep | Form / Call / leadless `source_company`; idempotency prefix |
| `normalizeMerchantName` | `foldTheBestRelocationMerchant` | Booking body; Elavon / Paper Check |
| `normalizeMoveSize` | `foldTheBestRelocationMoveSize` | Form body + application-plan `invalidReason` |
| `normalizeZip` | `foldTheBestRelocationZip` | Form body + application-plan `invalidReason` |

Keep the old names as one-line aliases until `applicationPlan.ts`, `apply.ts`, the barrel, CLI unused `printSummary`, and the folder test migrate. Do not make callers learn `InTransaction` or CRUD verbs. Do not export `mapFormMutation` / `mapCallMutation` / `mapBookingMutation` / `mapCancellationMutation` / `bestLeadMatchByJob` / `sourceLeadKey`.

**No class for the workflow.** The one type that earns a name is the HTTP play `applicationPlan.ts` already remaps:

```ts
type BestRelocationHttpMutationScreenplay = {
  threshold: number
  mutations: PlannedMutation[]  // Form, Call, Booking, Cancellation in that order
  unmatched_booking_jobs: IngestPlan["unmatched_booking_jobs"]
  warnings: string[]
}
```

That is the handoff from "match paired sheet rows" to "`applicationPlan.ts` may remap each mutation onto a checksum-bound action." Do not put `plan_checksum` on that object so "this file owns approve." Do not put `conflict` on that object so "this file owns unmatched-refund." Do not put `lead_ref` Mongo ids so "this file can apply."

`IngestPlan` / `PlannedMutation` / `CollapsedBooking` / `MutationAction` stay on sibling `types.ts`. Do not move those cards here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// plan.ts
// Match already paired sheet rows.
// Keep only pairings that clear 0.9.
// LID_BestRelo is not a Lead — book that Job leadless and say so.
// Collapse two-agent Best Relocation Booked Deals onto one Job.
// Add the binders. Do not add the deposit twice.
// Refuse zero or three agents.
// Then write the HTTP play in order:
// every Form and Local Form, every Call,
// each collapsed Job as a Booking from source or leadless,
// then a Cancellation only when the Refund cleared 0.9
// and that Booking is already in the play.
// This file does not window. This file does not apply.
// This file does not adopt. This file does not invent a checksum.

// -- 1. Collapse two-agent Booked Deals onto one Job -------

export function collapseTwoAgentBestRelocationBookedDealsOntoOneJob(rows)
function keepOnlyBestRelocationBookedDeals(rows)
function groupByTheBestRelocationJobFold(row)          // parsing.normalizeJobNo
function refuseAJobWithZeroOrMoreThanTwoAgents(job, agents)
function addTheBindersAndKeepOneDeposit(rows)           // max deposit, not sum

// -- 2. Keep only pairings that clear 0.9 ------------------

export function writeTheBestRelocationHttpMutationScreenplayAfterTheUnattendedCut(data, options)
function refuseAThresholdOutsideZeroToOne(threshold)
function askMatchForEveryPairing(data)                  // does not apply 0.9
function keepLeadPairingsAtOrAboveTheCut(matches, threshold, includedJobs)
function dropLidBestReloEvenWhenTheScoreClears(match)   // not a Lead
function keepRefundPairingsAtOrAboveTheCut(matches, threshold)
function pickTheHighestAcceptedLeadPerJob(accepted)
function warnAboutLidBestReloBookedLeadless(lidOnly)
function warnAboutRefundsThatDidNotClearTheCut(unmatchedCount)

// -- 3. Write every Form and Call as an HTTP create --------

function writeAFormLeadHttpCreate(row)                  // Local vs long-distance label
function writeACallLeadHttpCreate(row, acceptedPairing?) // enrich name/job when paired
function foldTheBestRelocationZip(value)
function foldTheBestRelocationMoveSize(value)
function giveTheFormAnIdempotencyKey(row)
function giveTheCallAnIdempotencyKey(row)               // phone + day + time

// -- 4. Write each Job as from-source, or leadless ---------

function writeABookingFromSourceOrLeadless(collapsed, acceptedLead?)
function foldTheBestRelocationMerchant(value)
function writeLeadlessWhenNoAcceptedLead(collapsed)     // includes lid_best_relo
function bindTheFormLeadWithARefMarker(leadKey)         // $ref + bindings
function writeACallBookingWithoutJobNoOnTheBody(collapsed, call)

// -- 5. Write a Cancellation only after the Booking --------

function writeACancellationOnlyWhenTheRefundClearedAndTheBookingIsPlanned(
  acceptedRefund,
  bookingMutation,
)
function skipARefundWhoseJobIsNotInThisPlay(job, includedJobs)
```

Read the primary path out loud: *Ask match for every pairing. Keep only scores at or above 0.9. Drop LID_BestRelo — that Job is still leadless. Collapse Best Relocation Booked Deals onto one Job: first row is primary, one or two agents, binders add, deposit does not. Write every Form and Local Form as a Form Lead create with Granot posting off. Write every Call as a Call Lead create, and if match already attached that Call to a Booking, copy the name and Job onto the Call. For each collapsed Job, write a Booking from source when a Form or Call cleared the cut; otherwise write leadless. Then write a Cancellation only when the Refund also cleared 0.9 and that Booking is already in the play. Warn about LID-only Jobs and review-only Refunds. Do not apply. Do not open application-plan conflicts.*

That is the operation. `buildIngestPlan` is not.

## Precise logic I would tighten while renaming

1. **Two 0.9 constants.** `DEFAULT_MATCH_THRESHOLD` here and `AUTO_LINK_THRESHOLD` on `applicationPlan.ts` are both 0.9. Application plan asks `buildIngestPlan({ threshold: AUTO_LINK_THRESHOLD })`. CLI throws if `BR_MATCH_CONFIDENCE_THRESHOLD` is not `AUTO_LINK_THRESHOLD`. `HANDOFF.md` still says 0.5. Do not silently unify the two constants in this rename. Do not start filtering `matches` on `matching.ts` so "the matcher owns unattended."

2. **`unmatchedBookings` is unused.** Match marks `lid_best_relo_only` as paired. This file rebuilds leadless from collapsed Jobs missing an accepted Lead. Switching `mapBookingMutation` onto `unmatchedBookings` would miss LID-only Jobs. Name the two "unmatched" meanings. Do not switch in this rename.

3. **This file warns; application plan conflicts.** Unmatched / review-only Refund count is a warning here. `applicationPlan.ts` asks match again and opens `unmatched_refund` blocking conflicts. Leadless here is only a mutation; application plan adds `ambiguous_lead_match` warning conflicts. Do not start opening those conflicts here so "one planner owns skip/fail."

4. **`source_company` lies on from-source.** Form / Call / leadless stamp `SOURCE_COMPANY` (`best_relocation_leads`). `create_booked_from_source` stamps `source_company: booking.primary.lead_source` (the sheet Lead Source label). Application-plan `canonicalCommandPayload` then maps that field onto `source`. Do not silently write `SOURCE_COMPANY` onto from-source so "one company key."

5. **Deposit is `max`, not a sum.** Folder test locks 500. Binders sum through `roundMoney`. `primary` is first appearance, not newest timestamp. Do not switch primary to newest so "collapse owns recency."

6. **`limitBookings` is a dead CLI option.** `buildIngestPlan` still slices. CLI `main` throws `--limit-bookings is not supported by the application-owned planner.` Do not delete the option in this rename so "dead code cleanup."

7. **CLI no longer asks this file.** `main` asks `buildBestRelocationApplicationPlan`. `printSummary` is typed as `ReturnType<typeof buildIngestPlan>` and is never called. `writeDryRunArtifacts` is imported and unused. Do not revive HTTP `applyIngestPlan` from this rename so "the screenplay owns live apply." Knowledge: CLI live apply is retired.

8. **`SOURCE_COMPANY` import on `applicationPlan.ts` is unused.** Application plan remaps `httpIngestPlan.mutations`. Do not start reading `SOURCE_COMPANY` there in this rename.

9. **Call from-source deletes `job_no`.** Body uses `call_phone_number` + `call_job_no`. Application-plan `canonicalCommandPayload` maps `job_no ?? call_job_no`. Do not put `job_no` back on the Call booking body so "one job field."

10. **Leave sibling modules alone.** `matching.ts` pair-then-threshold, `applicationPlan.ts` remap + conflicts + checksum, `apply.ts` HTTP pin, `canonicalLeadAdoption.ts` Mongo adopt, `parsing.ts` Job / date-key folds, `sheets.ts` window are already the right depth.

11. **Do not silently fix `HANDOFF.md`.** It still describes HTTP `apply.ts` as the live path. Knowledge and CLI say approve through `/api/v1/admin/ingestion`. Name the drift. Do not rewrite the handoff in this pass.

## Testing

The **interface** is the test surface: `writeTheBestRelocationHttpMutationScreenplayAfterTheUnattendedCut`, `collapseTwoAgentBestRelocationBookedDealsOntoOneJob`.

Today's `bestRelocationSheetIngest.test.ts` proves collapse (two agents, binders 700, deposit 500), Form `lid_exact` attach through `buildIngestPlan` (`create_form_lead` then `create_booked_from_source` then `create_cancelled_lead`, `$ref` bindings, merchant `Elavon`), and contradictory-LID `summary.unmatched_refunds === 1` after the 0.9 cut. `ingestion.test.ts` asks `buildBestRelocationApplicationPlan`, not this file. That is not enough for a story this long.

Replace the stub-as-plan-fixture style with tests that name the operation:

**Collapse two-agent Booked Deals onto one Job**
- Two Best Relocation rows, same Job, two agents → one collapsed Job, binders sum, deposit is max.
- A third distinct agent throws.
- A row that is not `is_best_relocation_source` is absent from collapse.
- Missing Job number throws `Booked Deals row N has no job number`.

**Keep only pairings that clear 0.9**
- Form `lid_exact` / 1 attaches; mutation order is Form, Booking from source, Cancellation.
- `lid_best_relo_only` at any score is absent from accepted Lead matches and is planned leadless, with a warning.
- Refund `job_no_unique` / 0.85 is not planned as `create_cancelled_lead`. Folder-test contradictory LID: `summary.unmatched_refunds === 1`.
- Refund `job_no_customer` / 0.9 or `lid_exact` / 0.9 is planned `create_cancelled_lead` with `depends_on` the booking key.
- `unmatchedBookings` from match is not the leadless list. A `lid_best_relo_only` Job is leadless here.

**Write the HTTP screenplay**
- Local Form stamps `local: "local"` and `crm_company_label: "Best Relocation Locals"`. Long-distance stamps `long_distance` / `Best Relocation Forms`. `post_to_granot` is false.
- From-source Form booking uses `form_lead_id: $ref:...` and `source_company` from the sheet Lead Source, not `SOURCE_COMPANY`.
- From-source Call booking deletes `job_no` and sets `call_phone_number` + `call_job_no`.
- Leadless booking uses `SOURCE_COMPANY` and `total_binder_amount`.
- Cancellation is skipped when the Job is not in `includedJobs` or has no booking mutation.
- Bad ZIP / move size / merchant throws from the folds. Application-plan `invalidReason` asks ZIP / move size first so `buildIngestPlan` does not throw on those Forms.

Do not add a helper-unit test that has to change when `roundMoney` or `compact` is inlined. Do not add a test per `flag` regex.

Caller to keep green: `applicationPlan.ts` still remaps `httpIngestPlan.mutations` and still filters the HTTP-endpoints warning; folder collapse + `lid_exact` + contradictory-LID tests; `apply.ts` still pins `the pinned host constant`.

## What I would not do

- A `BestRelocationPlanService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `compact`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `threshold.ts` / `collapse.ts` split "for cleanliness."
- Breaking pair-then-threshold. `matching.ts` must not start filtering `matches`. This file owns 0.9.
- Treating `applicationPlan.ts` as this story. Remap, checksum, `unmatched_refund`, and leadless reconciliation conflicts live there.
- Treating `apply.ts` HTTP apply, `ingestion/applyPlan.ts` canonical walk, or `canonicalLeadAdoption.ts` Mongo adopt as this story.
- Making `LID_BestRelo` a Lead, windowing it, or inventing a Cancellation for review-only 0.85.
- Silently "fixing" `HANDOFF.md` 0.5 / HTTP live apply, unused `unmatchedBookings`, unused CLI `printSummary`, or the two 0.9 constants.
- Starting Owner approve or `runSheetSyncDrain` from this file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout's `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
