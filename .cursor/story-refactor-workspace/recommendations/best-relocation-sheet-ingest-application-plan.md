# Remap The HTTP Screenplay Onto Checksum-Bound Actions, Open Unmatched-Refund And Leadless Reconciliation Conflicts, Then Lock The Plan — Never Apply, Never Adopt Mongo, Never Skip Receipts — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 5 of this service — `applicationPlan.ts`
- Remaining in this service: `provider.ts`, `identity.ts`, `sourceChangePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/applicationPlan.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Happy-path step 3: `LID_BestRelo` is matching evidence only — never an action. This file never puts `LID_BestRelo` on `authoritativeObservations`. Skip/fail: unmatched Booking → leadless Booking **plus** one reconciliation conflict (this file writes both); unmatched / below-threshold refund → blocking `unmatched_refund`, never invent a Cancellation (this file opens that conflict after `plan.ts` already refused the Cancellation). Owner approve binds `plan_checksum`; this file computes one, `adapter.plan` **drops** it, `worker.ts` recomputes after bootstrap / receipt skip / Mongo adopt / missing-source. Primary-code list names `canonicalLeadAdoption.ts` / `sheets.ts` / `dryRunReports.ts`, not this file — do not add a second Ingestion Service so “the application plan owns the happy path.” Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md) (that file windows Forms / Local Forms / Calls / Booked Deals / Refunds at read; this file **asks** `isWithinIngestionWindow` **again** on Refunds only). Distinct from already-recommended parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md) (this file does not parse). Distinct from already-recommended match: [`best-relocation-sheet-ingest-matching.md`](best-relocation-sheet-ingest-matching.md) (this file **asks** `matchRefundsToBookings` + `selectBestRelocationRefundObservations` a second time for unmatched-refund conflicts; lead pairing only through `buildIngestPlan`). Distinct from already-recommended HTTP screenplay: [`best-relocation-sheet-ingest-plan.md`](best-relocation-sheet-ingest-plan.md) (that file writes HTTP `mutations` and warnings; this file remaps those mutations, opens conflicts, and **asks** `computeChecksum`). Distinct from already-recommended canonical walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md) (walks `BestRelocationApplicationPlan` under `assertHeld`; never **asks** `buildBestRelocationApplicationPlan`). Distinct from later inspect: `provider.ts`. Distinct from later identity: `identity.ts` (this file **asks** `assertUniqueSourceIdentities` / `stableSourceRowId` / `sourceOwnedContentHash`; it does not mint `vantage:` ids). Distinct from later receipt skip: `sourceChangePolicy.ts` / `worker.ts` `withEvidence` (runtime `adapter.plan` never **asks** `unchangedEvidence`). Distinct from later Mongo adopt: `canonicalLeadAdoption.ts` / `bootstrap.ts` (this file’s type lists `adopt_existing` / `update_source_owned_lead` / `bootstrap_reconciliation`; this file never emits them). Distinct from later HTTP apply: `apply.ts` `applyIngestPlan` (CLI live apply is retired). Distinct from already-recommended Booking from source / leadless: [`bookings-booked-lead-from-source.md`](bookings-booked-lead-from-source.md), [`bookings-leadless-booking.md`](bookings-leadless-booking.md) — `canonicalCommandPayload` writes Domain Command bodies; it does not **ask** those commands. Folder `HANDOFF.md` is not knowledge — do not copy it (it still describes HTTP `apply.ts` as the live path and `0.5`). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: `adapter.ts` `plan` **asks** `buildBestRelocationApplicationPlan` and **returns** `.plan` only (the checksum is dropped). `worker.ts` **asks** `adapter.plan`, then remaps `unchanged` from `evidenceKeysForConnection`, **asks** `planBootstrapAdoption` or `applySourceChangePolicy` + `applyCanonicalAdoptionPolicy`, appends missing-source actions, **then** `computeChecksum`. CLI `main` **asks** `buildBestRelocationApplicationPlan` after `readBestRelocationWorkbooks`; throws `--apply` / `--limit-bookings` / a threshold that is not `AUTO_LINK_THRESHOLD`. `ingestion/ingestion.test.ts` **asks** this file for checksum drift, leadless + `ambiguous_lead_match`, `LID_BestRelo` never an action, unmatched / review-only refund blocking `unmatched_refund` (`job_no_unique` `0.85`), later corroborated Refund still cancels, invalid Call `schema_drift`, Refund window half-open bounds, Form `lid_exact` attach + Cancellation `job_no_customer`, `unchangedEvidence` replan. Folder `bestRelocationSheetIngest.test.ts` does **not** import this file. `sourceChangePolicy.ts` / `bootstrap.ts` / `canonicalLeadAdoption.ts` / `dryRunReports.ts` / `ingestion/applyPlan.ts` / `ingestion/repository.ts` **ask** the types / `MATCH_CALIBRATION_VERSION`, not `buildBestRelocationApplicationPlan`. Barrel `index.ts` `export *`. Wave B `src/routes/ingestion.routes.ts` does not import this file.
- Seams callers need: this-file / HTTP screenplay (`buildIngestPlan({ threshold: AUTO_LINK_THRESHOLD })`); this-file / unmatched-refund + leadless reconciliation conflicts (`plan.ts` only warns); this-file / identity (unique source ids + content hash); this-file / Refund re-window (`sheets.ts` already windowed at read); this-file checksum / worker checksum (approve binds the later one); this-file `unchangedEvidence` / worker post-plan `unchanged` remap (runtime adapter never **asks** the Set). There is no Domain Command **seam**. There is no apply **seam**. There is no Mongo-adopt **seam**. There is no receipt-skip **seam**.
- Split later (only if the file outgrows one sitting): this ~607-line file is one sitting if you read it as remap the HTTP screenplay onto checksum-bound actions, open unmatched-refund and leadless reconciliation conflicts, then lock the plan. Do **not** split into `invalid.ts` / `remap.ts` / `conflict.ts` / `checksum.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull `plan.ts`, `matching.ts`, `identity.ts`, `canonicalLeadAdoption.ts`, `sourceChangePolicy.ts`, `apply.ts`, or `ingestion/applyPlan.ts` here. If it later splits: `refuseInvalidRowsAndPoisonAJobWhenAnyBookedDealRowIsInvalid.ts` / `remapEachHttpMutationOntoAChecksumBoundAction.ts` / `openUnmatchedRefundAndLeadlessReconciliationConflicts.ts` only as later story files, never CRUD.

`buildBestRelocationApplicationPlan` / `mapMutation` / `AUTO_LINK_THRESHOLD` are executor mechanics. The owner question is: *Match already paired sheet rows and plan already wrote the HTTP play after the 0.9 cut. Drop Refunds that arrived outside the window. Refuse a Form without a name or phone, a Call without a phone, a Booking missing Job / customer / agent / merchant / money, a Refund missing Job / status / amount. If one Booked Deal row in a Job is invalid, the whole Job is invalid. Ask plan at 0.9. Remap each HTTP mutation onto a checksum-bound action: Form and Call stay creates; a Booking from source becomes a Domain Command body with even-split agent allocations; leadless stays leadless. Then open a blocking unmatched-refund for every Best Relocation Refund plan did not cancel. Open a warning ambiguous-lead-match for every leadless Booking. Stamp the plan, checksum it, and drop the warning that HTTP apply still asks Sheet Sync. This file does not apply. This file does not adopt a Mongo Lead. This file does not skip receipts. This file does not invent LID_BestRelo as an action.*

Window / parse / pair / HTTP screenplay / identity mint / receipt skip / Mongo adopt / HTTP apply / canonical walk already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “remap the HTTP screenplay onto checksum-bound actions, open unmatched-refund and leadless reconciliation conflicts, then lock the plan” story, not “an application-plan CRUD helper,” and not window-at-read / pair / HTTP `mutations` / apply.

1. **Drop Refunds that arrived outside the window, refuse invalid rows, and poison a Job when any Booked Deal row is invalid** — `buildBestRelocationApplicationPlan` first filters `data.refunds` through `isWithinIngestionWindow` (a missing `timestamp` **passes** the window and later fails `invalidReason`). `authoritativeObservations` is Forms + Local Forms + Calls + `is_best_relocation_source` Booked Deals + `selectBestRelocationRefundObservations`. `LID_BestRelo` is absent. `assertUniqueSourceIdentities` **asks** `identity.ts` (two Booked Deals on the same Job are allowed). `invalidReason`: Form **asks** `normalizeZip` / `normalizeMoveSize` **first** so `buildIngestPlan` does not throw (`missing_or_invalid_timestamp` / `missing_name` / `missing_phone` / `invalid_move_fields`); Call **asks** timestamp + phone; Booked Deal **asks** timestamp + `book_date` + Job + customer + agent + merchant + binder + deposit; Refund **asks** timestamp + `refund_request_date` + Job + status + one amount. One invalid Booked Deal **asks** `booking_group_contains_invalid_row` on every row with that `stableSourceRowId` (`booking:${job}`). Invalid rows become `record_conflict` `schema_drift` warning actions after the remap.

2. **Ask the HTTP screenplay at 0.9, then remap each mutation onto a checksum-bound action** — `buildIngestPlan(validData, { threshold: AUTO_LINK_THRESHOLD, baseUrl: the pinned host constant from plan.ts })`. `mapMutation` **asks** `stableSourceRowId` / `sourceOwnedContentHash` (`sourceOwnedValuesForMutation` drops `booked_lead` / `form_lead_id` / `ingestion_source` / `notes`). `action_key` is `${mutation.action}:${datasetKey}:${sourceId}`. `$ref:` `depends_on` idempotency keys remap onto `action_key`s. `create_booked_from_source` **asks** `canonicalCommandPayload`: even-split binders across `agent` + `split_agent`, last agent gets the remainder; `lead_ref` from `form_lead_id`; `source` from `source_company` (the sheet Lead Source, not `SOURCE_COMPANY`); `job_no ?? call_job_no`. Cancellation stamps `notes` `Imported from Best Relocation Refunds (${sourceId}).`. Optional `unchangedEvidence` **asks** `${datasetKey}:${sourceId}:${contentHash}` and flips `command` / `classification` to `unchanged`. Runtime `adapter.plan` never passes that Set — `worker.ts` remaps `unchanged` after this file returns. This function does not apply. This function does not adopt Mongo.

3. **Open a blocking unmatched-refund conflict for every Best Relocation Refund the HTTP screenplay did not cancel** — **asks** `matchRefundsToBookings` + `selectBestRelocationRefundObservations` a second time on `validData`. Keep a Refund when no `create_cancelled_lead` mutation already cites that sheet row. `conflictAction` writes `record_conflict` / `unmatched_refund` / `blocking`. If match still has a pairing (review-only `job_no_unique` `0.85`), stamp `matching.method` / `score` / `calibration_version` / two provenance keys. A Refund dropped by the re-window never reaches this walk. This function does not invent a Cancellation.

4. **Open a warning leadless reconciliation conflict for every leadless Booking** — after remap, every `classification === "leadless_booking"` gets a sibling `record_conflict` / `ambiguous_lead_match` / `warning` whose `action_key` is `${leadless}:reconciliation` and `depends_on` is the leadless action. `leadlessMatchingEvidence` copies `unmatched_booking_jobs` method / score onto the leadless action (Job fold is uppercase alphanumerics, not `parsing.normalizeJobNo`). Knowledge skip/fail: unmatched Booking → leadless **plus** one reconciliation conflict. This file writes both. `plan.ts` only wrote the leadless mutation and a warning.

5. **Order Form / Call, then Booking, then conflict, then Cancellation; drop the retired HTTP-apply warning; checksum the locked play** — `orderActions` ranks `create_form_lead` / `create_call_lead` = 1, `create_booked_from_source` / `create_leadless_booking` = 2, `record_conflict` = 3, `create_cancelled_lead` = 4, everything else (`unchanged`) = 0. `countClassifications` is the counter bag. Warnings keep `legacy.warnings` minus the line that HTTP apply still **asks** Sheet Sync. `computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 2, payload: plan })`. `adapter.plan` returns `.plan` only. `worker.ts` recomputes after later remaps. Approve binds that later checksum.

Shared beats, not owner operations: `datasetKeyFor` (Forms / Local Forms / Calls / Booked Deals / Refunds), `provenanceKey` (`workbook_id:tab:sheet_row`), `provenanceRows`, `compact` (drops `undefined` only — unlike `plan.ts`, empty string stays), `BEST_RELOCATION_ADAPTER_KEY` (`best_relocation`), `BEST_RELOCATION_SCHEMA_VERSION` (`2`), `MATCH_CALIBRATION_VERSION` (`best-relocation-conservative-v2`), `AUTO_LINK_THRESHOLD` (`0.9`), unused `SOURCE_COMPANY` import.

## Organization

Keep one file as the screenplay for “remap the HTTP screenplay onto checksum-bound actions, open unmatched-refund and leadless reconciliation conflicts, then lock the plan — never apply, never adopt Mongo, never skip receipts.” Window-at-read, parse, pair, HTTP screenplay, identity mint, receipt skip, Mongo adopt, HTTP apply, and canonical walk already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationApplicationPlanService` class. Do not invent a begin / complete **seam** here — this locked play is not a Domain Command. Do not invent a second checksum **adapter** beside `durableWork.computeChecksum`. Do not invent a second 0.9 **adapter** beside `DEFAULT_MATCH_THRESHOLD` / `AUTO_LINK_THRESHOLD` (name the pair; do not silently unify). Do not invent a second identity **adapter** beside `identity.ts`. Do not invent a receipt-skip **adapter** here — `worker.ts` / `sourceChangePolicy.ts` already own that.

**External interface** stays small (this is the test surface). Faces `adapter.ts` / CLI / `ingestion.test.ts` already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildBestRelocationApplicationPlan` | `remapTheHttpScreenplayOntoChecksumBoundActionsAndOpenTheConflicts` | `adapter.plan`, CLI `main`, `ingestion.test.ts` |
| `AUTO_LINK_THRESHOLD` | keep | CLI throws if `BR_MATCH_CONFIDENCE_THRESHOLD` is not this `0.9`; this file **asks** `buildIngestPlan({ threshold })` |
| `MATCH_CALIBRATION_VERSION` | keep | `canonicalLeadAdoption.ts` stamps the same calibration string |
| `BEST_RELOCATION_ADAPTER_KEY` | keep | `adapter.ts` `key`; repository connection |
| `BEST_RELOCATION_SCHEMA_VERSION` | keep | `adapter.ts` `schemaVersion`; checksum `schema_version` |
| `BestRelocationApplicationPlan` | `LockedBestRelocationApplicationPlan` | worker / apply / bootstrap / source-change / adopt / dry-run reports |
| `BestRelocationPlanAction` | `ChecksumBoundBestRelocationAction` | later siblings rewrite `command` to `adopt_existing` / `unchanged` / `update_source_owned_lead` |

Keep the old names as one-line aliases until `adapter.ts`, CLI, `ingestion.test.ts`, and the barrel migrate. Do not export `mapMutation` / `canonicalCommandPayload` / `invalidReason` / `orderActions` / `authoritativeObservations`. Do not make callers learn `InTransaction` or CRUD verbs.

**No class for the workflow.** The one type that earns a name is the locked play `worker.ts` later checksums after sibling remaps:

```ts
type LockedBestRelocationApplicationPlan = {
  adapter_key: "best_relocation"
  schema_version: 2
  calibration_version: "best-relocation-conservative-v2"
  actions: ChecksumBoundBestRelocationAction[]
  counters: Record<string, number>
  warnings: string[]
}
```

That is the handoff from “HTTP mutations plus conflicts” to “worker may skip receipts, adopt Mongo, then checksum for Owner approve.” Do not put `plan_checksum` on that object so “this file owns approve.” Do not put `adopted_entity_refs` so “this file can adopt.” Do not put `bootstrap_reconciliation` as a required field so “this file owns bootstrap” — the type already lists it optional; `bootstrap.ts` fills it.

`AuthoritativeObservation` stays on sibling `identity.ts`. `PlannedMutation` / `ParsedWorkbookData` stay on sibling `types.ts`. Do not move those cards here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// applicationPlan.ts
// Plan already wrote the HTTP play after the 0.9 cut.
// Drop Refunds that arrived outside the window.
// Refuse invalid rows. Poison a Job if any Booked Deal row is invalid.
// Ask the HTTP screenplay at 0.9.
// Remap each mutation onto a checksum-bound action.
// Open a blocking unmatched-refund for every Refund the play did not cancel.
// Open a warning leadless reconciliation conflict for every leadless Booking.
// Order Form / Call, Booking, conflict, Cancellation.
// Checksum the locked play.
// This file does not apply. This file does not adopt Mongo.
// This file does not skip receipts.

// ── 1. Refuse invalid rows and poison a Job ───────────────

export function remapTheHttpScreenplayOntoChecksumBoundActionsAndOpenTheConflicts(input)
function dropRefundsThatArrivedOutsideTheWindow(refunds, cutoff, readThrough)
function keepAuthoritativeObservations(data)            // no LID_BestRelo
function refuseADuplicateSourceIdentity(observations)   // identity.ts; two-agent Job ok
function refuseAnInvalidFormCallBookingOrRefund(row)    // ZIP / move size first
function poisonEveryBookedDealRowOnThatJob(invalidJobs)

// ── 2. Remap each HTTP mutation onto a checksum-bound action

function askTheHttpScreenplayAtTheUnattendedCut(validData)  // AUTO_LINK_THRESHOLD
function remapOneHttpMutationOntoAChecksumBoundAction(mutation, observations)
function evenSplitBindersAcrossTheTwoAgents(body)       // last agent gets remainder
function remapIdempotencyDependsOnOntoActionKeys(actions)
function markUnchangedOnlyWhenTheCallerHandedEvidence(action, evidence?)

// ── 3. Open unmatched-refund conflicts ────────────────────

function openABlockingUnmatchedRefundForEveryRefundThePlayDidNotCancel(validData, mutations)
function stampReviewOnlyRefundEvidenceOnTheConflict(match)  // 0.85 must not cancel

// ── 4. Open leadless reconciliation conflicts ─────────────

function openAWarningLeadlessReconciliationConflictForEveryLeadlessBooking(actions)
function copyTheBestRemainingLeadScoreOntoTheLeadlessAction(action, unmatchedJobs)

// ── 5. Lock the play ──────────────────────────────────────

function orderFormCallThenBookingThenConflictThenCancellation(actions)
function dropTheRetiredHttpApplySheetSyncWarning(warnings)
function checksumTheLockedPlay(plan)                    // worker recomputes later
```

Read the primary path out loud: *Drop Refunds outside the window. Refuse invalid Forms, Calls, Bookings, and Refunds. If one Booked Deal row in a Job is garbage, the whole Job is invalid. Ask the HTTP screenplay at 0.9. Remap each mutation onto a checksum-bound action — even-split binders on a two-agent Booking from source. Open a blocking unmatched-refund for every Best Relocation Refund the play did not cancel, including review-only 0.85. Open a warning ambiguous-lead-match beside every leadless Booking. Order Form and Call, then Booking, then conflict, then Cancellation. Drop the retired HTTP-apply warning. Checksum the locked play. Do not apply. Do not adopt a Mongo Lead. Do not skip receipts.*

That is the operation. `buildBestRelocationApplicationPlan` is not.

## Precise logic I would tighten while renaming

1. **This file’s checksum is not the approve checksum.** `adapter.plan` returns `.plan` only. `worker.ts` remaps `unchanged`, bootstrap / receipt skip / Mongo adopt / missing-source, **then** `computeChecksum`. Do not start returning the checksum from `adapter.plan` so “one checksum owns approve.” Name the two checksums.

2. **`unchangedEvidence` is unused at runtime.** Only `ingestion.test.ts` “identical evidence is classified unchanged across replans” passes the Set. `worker.ts` remaps `unchanged` after this file returns. Do not start passing the Set from `adapter.plan` in this rename so “one unchanged owns skip.”

3. **Two 0.9 constants.** `plan.DEFAULT_MATCH_THRESHOLD` and `AUTO_LINK_THRESHOLD` are both `0.9`. This file **asks** `buildIngestPlan({ threshold: AUTO_LINK_THRESHOLD })`. CLI throws if `BR_MATCH_CONFIDENCE_THRESHOLD` is not `AUTO_LINK_THRESHOLD`. `HANDOFF.md` still says `0.5`. Do not silently unify the two constants. Do not start filtering `matches` on `matching.ts`.

4. **`SOURCE_COMPANY` import is unused.** This file remaps `httpIngestPlan.mutations`. Do not start reading `SOURCE_COMPANY` here so “one company key.” `canonicalCommandPayload` maps from-source `source_company` (sheet Lead Source) onto `source`.

5. **Refunds are windowed twice.** `sheets.ts` already windows at read. This file windows Refunds again (`!timestamp` passes, then `invalidReason` fails). Ingestion test “refund application window uses Timestamp with exact half-open boundaries” **asks** this second window. Do not delete it in this rename so “one window owns cutoff.”

6. **`orderActions` puts conflicts before Cancellations.** HTTP `plan.ts` writes Form → Call → Booking → Cancellation. This file ranks `record_conflict` = 3 and `create_cancelled_lead` = 4. `unchanged` sorts first (rank 0). Do not restore HTTP order so “one screenplay owns sequence.”

7. **Leadless Job fold is not `normalizeJobNo`.** `leadlessMatchingEvidence` uppercases and strips non-alphanumerics. `plan.ts` collapse **asks** `parsing.normalizeJobNo`. Do not silently switch this fold.

8. **`compact` here keeps empty strings.** `plan.ts` `compact` drops `undefined` and `""`. This file drops `undefined` only. Do not unify so “one compact owns blanks.”

9. **Type lists commands this file never emits.** `update_source_owned_lead` / `adopt_existing` / `unchanged` (except via the unused Set) / `bootstrap_reconciliation` belong to later siblings. Do not start adopting Mongo here so “the type already said adopt.”

10. **Leave sibling modules alone.** `plan.ts` HTTP screenplay, `matching.ts` pair-then-threshold, `identity.ts` stable ids, `sheets.ts` window-at-read, `sourceChangePolicy.ts` receipt skip, `canonicalLeadAdoption.ts` Mongo adopt, `ingestion/applyPlan.ts` walk are already the right **depth**.

11. **Do not silently fix `HANDOFF.md`.** It still describes HTTP `apply.ts` as the live path. Knowledge and CLI say approve through `/api/v1/admin/ingestion`. Name the drift. Do not rewrite the handoff in this pass.

## Testing

The **interface** is the test surface: `remapTheHttpScreenplayOntoChecksumBoundActionsAndOpenTheConflicts`.

Today’s `ingestion.test.ts` already **asks** this file for checksum drift (`sourceReadThrough` +1s), unmatched Booking → leadless + one `ambiguous_lead_match`, `LID_BestRelo` never an action, unmatched Refund blocking `unmatched_refund` with no Cancellation, review-only `job_no_unique` `0.85` still blocking, later `job_no_agent` still cancels, invalid Call `schema_drift` with leadless still planned, Refund window half-open bounds, Form `lid_exact` attach + Cancellation `job_no_customer`, and `unchangedEvidence` replan. Folder `bestRelocationSheetIngest.test.ts` **asks** `buildIngestPlan`, not this file. That is close, but it does not name the remap.

Replace the fixture-as-plan style with tests that name the operation:

**Refuse invalid rows and poison a Job**
- Form missing phone → `schema_drift` / `invalid`; that Form is absent from `create_form_lead`.
- Bad ZIP / move size → `invalid_move_fields` **before** `buildIngestPlan` would throw.
- One of two Booked Deal rows on the same Job is missing merchant → both rows `booking_group_contains_invalid_row`; no Booking mutation for that Job.
- Refund with no timestamp is windowed in, then `missing_required_refund_value`.

**Remap the HTTP screenplay**
- Form `lid_exact` → `create_form_lead` then `create_booked_from_source`; `depends_on` is the Form `action_key`, not the HTTP idempotency key.
- Two-agent Booking even-splits binders; last agent gets the remainder. Deposit is the HTTP body’s deposit (collapse already took `max`).
- From-source `source` is the sheet Lead Source, not `SOURCE_COMPANY`.
- Call from-source payload uses `job_no ?? call_job_no`.
- Cancellation notes cite the Refund `stableSourceRowId`.
- `LID_BestRelo` is absent from every `dataset_key` / `stable_source_row_id`.

**Open the conflicts**
- Unmatched Booking → one `create_leadless_booking` **plus** one `ambiguous_lead_match` warning whose `depends_on` is the leadless `action_key`.
- Unmatched / `job_no_unique` `0.85` Refund → `unmatched_refund` blocking, no `create_cancelled_lead`.
- Later corroborated Refund on the same Job still cancels; the review-only Refund stays a conflict.
- A Refund outside `[cutoff, sourceReadThrough)` is absent from both Cancellation and `unmatched_refund`.

**Lock the play**
- Action order is Form / Call, Booking, conflict, Cancellation (`unchanged` first when the test Set is passed).
- The retired HTTP-apply Sheet Sync warning is absent.
- `checksum` is 64 hex. A later `sourceReadThrough` changes it.
- Runtime callers still work when `unchangedEvidence` is omitted.

Do **not** add a helper-unit test that has to change when `compact` or `datasetKeyFor` is inlined. Do not add a test per `invalidReason` string if the parent already proves the skip.

Caller to keep green: `adapter.plan` still returns `.plan` only; `worker.ts` still remaps `unchanged` and recomputes checksum; CLI still **asks** `buildBestRelocationApplicationPlan` and still throws `--apply`; `ingestion.test.ts` cases above.

## What I would not do

- A `BestRelocationApplicationPlanService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `compact`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or an `invalid.ts` / `remap.ts` / `conflict.ts` / `checksum.ts` split “for cleanliness.”
- Breaking pair-then-threshold. `matching.ts` must not start filtering `matches`. `plan.ts` owns 0.9; this file **asks** that cut.
- Treating `plan.ts` as this story. HTTP mutations and warnings live there.
- Treating `ingestion/applyPlan.ts` walk, `apply.ts` HTTP apply, `canonicalLeadAdoption.ts` Mongo adopt, or `sourceChangePolicy.ts` receipt skip as this story.
- Making `LID_BestRelo` an action, inventing a Cancellation for review-only `0.85`, or deleting the leadless reconciliation conflict.
- Silently “fixing” `HANDOFF.md` `0.5` / HTTP live apply, unused `SOURCE_COMPANY`, unused runtime `unchangedEvidence`, the dropped checksum, or the two 0.9 constants.
- Starting Owner approve or `runSheetSyncDrain` from this file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout's `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
