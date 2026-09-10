# Plan This Historical Merge — Flatten The Frozen Sheets, Extend The Catalog Inactive In The Plan, Parse Form And Call Candidates, Ask The Sibling Classifier, Then Plan Lead Writes, Bookings, And Cancellations — Never Write Mongo, Never Enable Sheet Sync Or CRM, Never Recalculate After Apply — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 2 of this service — `planner.ts`
- Remaining in this service: `manifest.ts`, `apply.ts`, `verify.ts`, `rollback.ts`, `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`
- Target: `src/services/historicalConsolidation/planner.ts`
- Knowledge: none for this folder. The staged-merge spec is [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Decisions 4–11 and Stages B–F: parse, collapse identity, compare the live `vantagemovers` snapshot, derive Duplicate Lead / Form Fill / relationships / CPL, then seal). Already-recommended sibling: [historical-consolidation-classification.md](historical-consolidation-classification.md) (`classification.ts` — in-memory batch judge; this file **asks** it after identity is collapsed, then zeros CPL and plans insert or fill). Distinct from leftover `manifest.ts` (hashes, operation ids, decision replay that may only quarantine or preserve a live scalar — **asks** leftover `schemaValidation.ts`). Distinct from leftover `apply.ts` / `verify.ts` / `rollback.ts` (mutate / prove / undo under leftover `targetGuard.ts` + leftover `operationalLock.ts` + leftover `migrationContext.ts`). Distinct from leftover `normalization.ts` / `dateParsing.ts` / `stableJson.ts` (parsers and hashes this file **asks**). Distinct from already-recommended live [form-lead.md](form-lead.md) / [leads-call-lead.md](leads-call-lead.md) / [leads-duplicate-lead.md](leads-duplicate-lead.md) / [bookings-booked-lead.md](bookings-booked-lead.md) / [cancellations-cancelled-lead.md](cancellations-cancelled-lead.md) / [customers-customer.md](customers-customer.md) / [agents-agent-allocation.md](agents-agent-allocation.md) — those write Mongo and tell sheets. Distinct from leftover `ingest-historical-sheets.ts` (the write-capable row-by-row upsert the spec forbids becoming the planner). Distinct from leftover `cancellationCorrelationSnapshotsFromBooking` (this file **asks** it, then plants `$oid` / `$date`). `package.json` still names `pnpm historical:plan`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Manifest” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **the barrel, plus one folder fixture.** Barrel `historicalConsolidation/index.ts` re-exports `planHistoricalConsolidation` and the two input/result types. Folder test `planner.test.ts` **asks** the export twice on one frozen Form + Booked Deals + Refunds fixture (empty historical and live collections) and locks: identical `manifest_hash`, zero conflicts, one Form Lead op, one Booking op, one Cancellation op, four Operations Registry Change ops, and no planned `sheet_sync` other than `[]`. Already-recommended `classification.ts` is **asked by this file**, not a caller. Leftover `buildHistoricalManifest` is **asked by this file**. Scripts in this checkout do **not** import this file. Not this **interface**: leftover `classifyHistoricalLeads`, leftover `buildHistoricalManifest`, leftover `applyHistoricalManifest`, leftover `createFormLead` / `createBookedLead` / `createCancelledLead`, leftover `findDuplicateFormLeadMatch`, leftover `ingest-historical-sheets.ts`.
- Seams callers need: frozen snapshot vs live Mongo write; **ask** the sibling classifier vs stamp / zero CPL / insert-or-fill; **ask** leftover parsers vs this orchestration; **ask** leftover manifest sealer vs this operation list; create-inactive-catalog-in-the-plan vs live Registry write; authoritative fill vs preserve-live-scalar conflict; Job-Number-scoped Customer vs live name-only upsert; Owner seat (clock + git + actor) vs apply authorization. There is no begin / complete Domain Command **seam**. There is no Sheet Sync **adapter**. There is no CRM **adapter**. There is no Mongo write **adapter**.
- Split later (only if the file outgrows one sitting): this ~720-line file is already long. Keep it as one screenplay until a later sitting splits by **story**: `extendThisHistoricalCatalogInactiveInThePlan.ts`, `parseTheseHistoricalFormLeadCandidates.ts`, `parseTheseHistoricalCallLeadCandidates.ts`, `stampThisHistoricalClassificationOntoThePlan.ts`, `planTheseHistoricalLeadWrites.ts`, `planTheseHistoricalBookings.ts`, `planTheseHistoricalCancellations.ts` — never `create.ts` / `update.ts` / `delete.ts`. Leftover classifier, leftover sealer, leftover apply / verify / rollback, leftover parsers, and live Form / Call / Booking / Cancellation writes stay siblings / other services.

`planHistoricalConsolidation` is executor mechanics. The owner question is: *The sheets and both Mongo copies are already frozen. Walk every row. Grow the catalog only as inactive planned inserts. Turn each Form and Call row into one lead. Ask the sibling classifier who is a Duplicate Lead and which Call already filled the form. Zero CPL on a Duplicate Lead. Plan an insert when the live copy has no match, or fill only empty live fields when it does. Group Booked Deals by Job Number, split the binder, attach or invent a Job-scoped Customer, and say referral or leadless. Attach each Refund to that Booking. Every sheet row must land as a planned write or a conflict. Then seal. This file does not write Mongo. This file does not turn on Sheet Sync or CRM Posting. This file does not run again after apply.*

Who judges Duplicate Lead, who hashes the manifest, who applies, and who parses Agent / money / Eastern dates already live in leftover **modules**. Do not pull those in.

## What this file actually does

Eight “plan this historical merge” stories in one sitting, not “a CRUD planner,” and not Classify This Historical Lead Batch / Seal This Historical Manifest / Apply This Approved Manifest:

1. **Refuse a broken planning seat, then flatten the frozen sheets** — `planHistoricalConsolidation` open. Finite `planning_timestamp`. Non-blank `git_sha`. Actor role must be `owner`. Both snapshot databases must exist (`vantagemovers` and `vantagemovershistorical`). `flattenRows` turns workbook / tab / physical row / checksum into one `Row` each. This beat does **not** read Google Sheets. This beat does **not** open Mongo.

2. **Extend the catalog inactive in the plan** — `buildCatalog` / `addCatalogOperation`. Exact normalized Source Company slug, granularity key, Agent name (plus aliases), Merchant name (plus aliases) resolve to the live snapshot. A miss plans an **inactive** insert (order 10) and an Operations Registry Change `create` audit (order 11). A granularity that does not belong to its company **throws**. Spec Decision 9: similarity is never an automatic merge. Spec Agent rule: a missing exact Agent is created inactive **in the manifest**, never written during this function. This beat does **not** activate a live catalog row. This beat does **not** call leftover Operations Registry commands.

3. **Parse historical Form Lead candidates, including Bad Leads** — `matchBadRows` then `parseFormCandidate`. Bad-tab rows attach by unique Lead ID, else unique phone; ambiguous match is blocking; unmatched Bad Leads become orphan Form candidates. Strict Form parse: accepted Eastern timestamp and move date, display name, normalized phone, both zips — else non-blocking `invalid_form_lead` quarantine. Identity hash is company + Lead ID + phone + timestamp + provenance. Live Form overlap is company-scoped Lead ID, then Tracking Reference, then phone + exact timestamp; more than one live hit is blocking `ambiguous_live_form_identity`. `preserve_duplicate` is true only when a live Form exists **and** the timestamp is on or after leftover `FORM_DUPLICATE_CUTOFF`. Planned `normalized_email` is always `null`. Planned `post_to_granot` is `false`. Planned `sheet_sync` is `[]`. CPL copies the historical document or `0`, status `not_applicable`, until operation 5 overwrites a Duplicate Lead.

4. **Parse historical Call Lead candidates** — `parseCallCandidate`. Accepted Eastern `Date` + `Time` and a phone — else blocking `invalid_call_lead_identity`. Live Call overlap is company + phone + exact timestamp, else the same pair inside sixty seconds. No `preserve_duplicate`. Planned email is again `null`. This beat does **not** classify. This beat does **not** mark Form Fill.

5. **Ask the sibling classifier, then stamp the plan** — `classifyHistoricalLeads` after `toClassifierLead` (live id present → seed `duplicate` from the planned document; `preserve_duplicate` only from Form parse). Write `document.duplicate`. A Duplicate Lead gets `cpl = 0` and `cpl_resolution_status = "duplicate_zero"`. A Call Lead gets `form_fill`. A Bad-tab Form that is not a Duplicate Lead and not already booked or cancelled gets `bad_lead = "legacy_bad_tab"`. Push `canonical_entities`. Then `planLeadOperation`: no live id → insert (order 30) with a deterministic ObjectId; live id → fill only authoritative fields (`timestamp`; Form `duplicate` only when `preserve_duplicate` is false; Call `duplicate` and `form_fill`) or empty live scalars, else non-blocking `non_empty_live_field_conflict` (CPL disagreement is ignored). Skip `createdAt` / `updatedAt` / `sheet_sync` / `post_to_granot` on fill. This beat does **not** **ask** leftover `findDuplicateFormLeadMatch`. This beat does **not** **ask** leftover `leadCplResolution`.

6. **Plan historical Bookings** — `planBookings`. Group by leftover `normalizeJobNo`. Missing Job Number is blocking. Parse each Booked Deals row through leftover `parseEasternDate` / `parseCustomerName` / `parseAgentNames` / `parseMoneyToCents` / `allocateCents`. Incompatible book-date / customer / merchant / source / deposit facts across the group are blocking. Distinct sales union Agents and sum binders; remainder cents follow leftover allocation. Live Booking overlap is the normalized Job Number (more than one is blocking). Lead attach: staged Form by Lead ID, else staged Call by Job Number, else the same lookup on the live snapshot; more than one is blocking; zero means leadless unless the source mapping says referral. Source label must exist in `mappings`. Customer: keep the live Booking’s customer, else the unique live contact match, else insert a **Job-Number-scoped** Customer (order 20) — never leftover name-only Customer upsert. Insert (order 40) or `planSafeUpdate` with authoritative `timestamp` / `book_date`. First sales Agent may become receiver on the Lead. A booked Bad-tab Lead drops `bad_lead` from the earlier lead operation. Book Date text containing `0205` without leftover `corrected_7_20_0205_to_2025_07_20` is blocking `missing_known_0205_correction`.

7. **Plan historical Cancellations** — `planCancellations`. Refund row needs a planned or live Booking, accepted cancel date, timestamp, and refund money — else blocking `unlinked_or_invalid_cancellation`. Identity is Booking id + cancel date + Agent. **Ask** leftover `cancellationCorrelationSnapshotsFromBooking`, then plant `$oid` / `$date`. Insert (order 50) or safe-fill with authoritative `timestamp` / `cancel_date`. Then stamp `cancelled` on the Booking and on the attached Lead (order 60), or conflict if that pointer already names someone else.

8. **Refuse an unclassified row, then seal** — every sheet provenance must appear on a lead, a canonical entity, a conflict, or a Bad Leads row; leftovers become blocking `unclassified_source_row`. Expected counts are live `before` + planned inserts. Policy hashes include leftover `FORM_DUPLICATE_CUTOFF` ISO. Then **ask** leftover `buildHistoricalManifest`. This beat does **not** apply a decision that would change the plan. This beat does **not** write the file to disk.

There is no ninth mutate operation. `snapshotDb` / `documents` / `objectId` / `provenanceKey` / `compareLead` / `equalValue` / `buildExpectedCounts` are folds. Re-export through the barrel is convenience for a missing `pnpm historical:plan` script.

## Organization

Keep one file until a later sitting splits by **story**. This is the screenplay for “plan this historical merge.” Duplicate Lead judgment already lives on already-recommended `classification.ts`. Manifest hashing already lives on leftover `manifest.ts`. Apply / verify / rollback already live on leftover later modules. Agent / money / Eastern date parse already live on leftover `normalization.ts` / `dateParsing.ts`. Job Number fold already lives on already-recommended `bookingIdentity.ts`. Cancellation snapshots already live on leftover `cancellationCorrelationSnapshots.ts`. Live Form / Call / Booking / Cancellation writes already live on already-recommended services. Do not pull those in. Do not invent a `HistoricalPlannerService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a Mongo **adapter** that has only this in-memory walk. Do not invent a Sheet Sync **adapter** so “historical rows can project.” Do not invent a CRUD folder so “insert and update each get a file.”

Do not merge this into already-recommended `classification.ts` so “one function owns judge and plan.” Do not route planned inserts through leftover `createFormLead` / `createBookedLead` so “the application-owned write is imported.” Do not move leftover `buildHistoricalManifest` here so “planning owns the hash.” Do not split `create.ts` / `update.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `planHistoricalConsolidation` | `planThisHistoricalMerge` | leftover barrel and the folder fixture must build the whole plan |
| `HistoricalPlanningInput` | `TheFrozenSnapshotAndTheOwnerSeat` | caller plants snapshot, mappings, decisions, clock, git, Owner |
| `HistoricalPlanningResult` | `ThePlannedMerge` | manifest plus parsed-candidate audit, canonical entities, and conflicts |

Keep the old names as one-line aliases until the barrel, the folder test, and a restored `pnpm historical:plan` script migrate. Do not make callers learn `planLeadOperation` / `planSafeUpdate` as the domain language. Do **not** rename persisted planned field names (`duplicate`, `form_fill`, `cpl_resolution_status`, `bad_lead`, `sheet_sync`, `post_to_granot`, `is_referral_booking`, `is_leadless_booking`) — leftover apply writes those onto live documents. Do **not** rename conflict `kind` strings — leftover decisions key off them. Do **not** rename operation `order` bands (10 catalog, 11 audit, 20 Customer, 30/31 Lead, 40 Booking, 50 Cancellation, 60 relationship) — leftover apply walks that list. Do **not** rename `target_database: "vantagemovers"`.

**No workflow class.** The two types that *do* earn a name are the planted seat and the planned merge:

```ts
type TheFrozenSnapshotAndTheOwnerSeat = {
  snapshot: HistoricalSnapshot
  decisions: DecisionBundle
  mappings: {
    source_mappings: { mappings: Record<string, { source_company?: string; source_granularity_key?: string; referral?: boolean }> }
    aliases: { merchant_aliases: Record<string, string>; agent_aliases: Record<string, string> }
    field_matrix_hash: string
  }
  planning_timestamp: string
  git_sha: string
  actor: { actor_id: string; actor_label: string; actor_role: "owner" }
}

type ThePlannedMerge = {
  manifest: HistoricalManifest
  parsed_candidates: Array<Record<string, unknown>>
  canonical_entities: Array<Record<string, unknown>>
  conflicts: ConflictCase[]
}
```

That is the handoff from “the sheets and both Mongo copies are frozen” to “the owner can review conflicts and leftover apply can write.” `LeadCandidate` / `Row` / `BookingPlan` / `MappingBundle` stay internal. Do **not** export them so “the script can parse one tab.” Do **not** add a live Mongo repository so “the spec’s injected classifier becomes true” in this rename.

Leave classification on already-recommended `classification.ts`. Leave sealing on leftover `manifest.ts`. Leave apply on leftover `apply.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// planner.ts
// The sheets and both Mongo copies are already frozen.
// Walk every row. Grow the catalog only as inactive planned inserts.
// Turn each Form and Call into one lead. Ask the sibling classifier.
// Zero CPL on a Duplicate Lead. Plan insert or fill.
// Group Booked Deals by Job Number. Attach each Refund.
// Every sheet row must land. Then seal.
// Do not write Mongo. Do not turn on Sheet Sync or CRM Posting.

// ── 1. Refuse a broken seat, flatten the sheets ───────────

export function planThisHistoricalMerge(input)
function refuseABrokenPlanningSeat(input) // clock, git, Owner
function requireBothFrozenDatabases(snapshot)
function flattenTheFrozenSheetRows(snapshot)

// ── 2. Extend the catalog inactive in the plan ────────────

function extendTheCatalogInactiveInThePlan(live, input, operations)
function resolveOrPlanThisSourceCompanyAndGranularity(slug, key)
function resolveOrPlanThisInactiveAgent(rawName)
function resolveOrPlanThisInactiveMerchant(rawName)
function planTheInactiveCatalogInsertAndAudit(model, id, document)

// ── 3. Parse historical Form Lead candidates ──────────────

function attachBadLeadRowsByLidThenPhone(forms, badRows, conflicts)
function parseThisHistoricalFormLeadCandidate(row, badProvenance, …)
function refuseABrokenHistoricalFormRow(row) // quarantine, not throw
function findTheLiveFormOverlap(live, companyId, lid, refNo, phone, timestamp)
function keepTheMatchedModernLiveDuplicateFlag(liveDoc, timestamp)

// ── 4. Parse historical Call Lead candidates ──────────────

function parseThisHistoricalCallLeadCandidate(row, …)
function findTheLiveCallOverlap(live, companyId, phone, timestamp) // exact, else ±60s

// ── 5. Ask the sibling classifier, stamp the plan ─────────

function plantTheRowTheClassifierJudges(lead) // toClassifierLead
// ask classifyThisHistoricalLeadBatch
function stampDuplicateFormFillAndZeroCpl(lead, classification)
function planThisHistoricalLeadWrite(lead, classification, live) // insert or fill

// ── 6. Plan historical Bookings ───────────────────────────

function planTheseHistoricalBookings(rows, leads, …)
function groupBookedDealsByNormalizedJobNumber(rows)
function parseThisBookedDealsRow(row, catalog, input, conflicts)
function refuseIncompatibleFactsForTheSameJob(parsedRows)
function attachTheLeadByLidOrJobNumber(lid, job, leads, live)
function resolveOrPlanTheJobScopedCustomer(job, lead, live)
function planThisHistoricalBookingWrite(job, document, existing)
function stampTheLeadBookedAndMaybeTheReceiver(lead, booking)
function dropLegacyBadTabOnceTheLeadIsBooked(lead)
function refuseAnUncorrected0205BookDate(group)

// ── 7. Plan historical Cancellations ──────────────────────

function planTheseHistoricalCancellations(rows, bookings, …)
function findTheBookingThisRefundBelongsTo(job, bookings, live)
// ask cancellationCorrelationSnapshotsFromBooking
function planThisHistoricalCancellationWrite(identity, document, existing)
function stampCancelledOnTheBookingAndTheLead(booking, cancellationId)

// ── 8. Refuse an unclassified row, then seal ──────────────

function refuseAnUnclassifiedHistoricalRow(rows, terminals, conflicts)
function countWhatTheLiveCopyWillHoldAfterInserts(live, operations)
// ask buildHistoricalManifest
```

Read the primary path out loud: *Refuse a broken clock, a blank git sha, a non-Owner actor, or a snapshot missing either database. Flatten every sheet row. For each Source Company, granularity, Agent, and Merchant the rows need, reuse the live catalog or plan an inactive insert plus an audit. Parse Forms (and attached Bad Leads) strictly; parse Calls strictly. Ask the sibling classifier who is a Duplicate Lead and which Call already filled the form. Zero CPL on a Duplicate Lead. Plan a new live id when there is no match; otherwise fill only empty live fields and the classification columns the owner already said we may overwrite. Group Booked Deals by Job Number, split the binder, attach one Lead or say referral or leadless, and invent a Job-scoped Customer only when the live copy has none. Attach each Refund to that Booking. If a sheet row still has no home, that is a blocking conflict. Seal.*

That is the operation. `planLeadOperation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Stages B–F live in one function.** The spec names parse, identity, live overlap, classification, and seal as stages. This file runs them in that order inside `planHistoricalConsolidation`. Keep the order. Do not extract a `runStageD` helper so “the spec headings become functions,” and do not reorder Bookings ahead of classification so “relationships can skip a Duplicate Lead.”

2. **The classifier is in-memory, not injected.** The July spec said planning should import application-owned rule functions with an injected repository. This file **asks** already-recommended `classifyHistoricalLeads` instead of leftover `findDuplicateFormLeadMatch`. That is a known spec gap (already parked on the classification pass). Do not silently route this batch through `FormLead.find` so “the sentence becomes true.” Planning must stay write-free.

3. **Email is planted `null`.** `toClassifierLead` always sends `normalized_email: null`. Already-recommended classification still matches email. Do not drop the email beat from the classifier, and do not start parsing Form email here so “the planner finally sends it” without an **interface** proof.

4. **Form quarantine vs Call block.** A broken Form row is non-blocking `invalid_form_lead`. A broken Call row is blocking `invalid_call_lead_identity`. The names hide the severity split. Do not “fix” Form up to blocking so “both kinds fail closed,” and do not loosen Call to quarantine so “the fixture stays green.”

5. **Live Call overlap is a sixty-second window.** Classification’s Call Duplicate Lead window is ninety days, earlier-only, exact granularity. Live identity here is Source Company + phone + exact timestamp, else ±60s. Do not reuse `CALL_DUPLICATE_WINDOW_MS` for this lookup so “one window owns both stories.”

6. **Decisions do not change this plan.** `input.decisions` is passed through and hashed by leftover `manifest.ts`. That sealer only accepts `quarantine` and preserve-live-scalar; any resolution that would pick a candidate or change a field must be supplied through mappings and a **replan**. This file never reads `decisions.decisions`. Do not start applying `select_candidate` here so “the bundle becomes true.”

7. **Catalog create is planned, not written.** Spec language says a missing Agent is created inactive in the manifest, never during planning. `addCatalogOperation` emits the insert + audit into `operations` during this function. That is the manifest, not a Mongo write. Do not move those ops into leftover `apply.ts` so “planning stays pure,” and do not call leftover Registry `create` so “the application-owned catalog owns it.”

8. **Job-scoped Customer vs live upsert.** Spec Decision on Customer cardinality forbids leftover name-only `normalized_name` reuse. This file already uses `deterministicObjectId("historical-job-customer", job)` after a unique live contact match. Do not **ask** leftover `upsertCustomerFromLead` so “one Customer helper owns both stories.”

9. **`sheet_sync: []` and `post_to_granot: false` are the outbound fence.** The fixture locks that no planned document has a non-empty `sheet_sync`. Leftover apply also counts leftover side-effect collections. Do not enqueue Sheet Sync or CRM Posting so “historical rows look like a live ingest.”

10. **CPL zeroing is this file, not the classifier.** Already-recommended classification never touches CPL. This file stamps `duplicate_zero` after the judge returns. Do not move that into `classification.ts` so “judgment owns price,” and do not **ask** leftover `leadCplResolution` so “the live snapshot is reused.”

11. **Relationship planning mutates earlier operations.** `planBookingRelationship` may delete `bad_lead` from an earlier lead insert/update, or splice the update out when only `updatedAt` remains. That is a load-bearing before-seal **seam**. Do not “clean” it into a second pass so “operations are immutable before bookings,” without proving leftover apply still sees one lead write.

12. **Expected index name may drift.** The plan expects `booked_leads.normalized_job_no_1`. Live schema docs also mention `booked_lead_normalized_job_no_unique`. Do not silently rename the planned index so “it matches the model.” Leftover apply / verify lock the planned name.

13. **The staged-merge CLI is missing here.** `package.json` still names `pnpm historical:plan`; the staged-merge script folder it points at is not in this checkout. Do not invent the script in this rename, and do not treat leftover `ingest-historical-sheets.ts` as the caller.

14. **Leave sibling modules and live writes alone.** Leftover `buildHistoricalManifest` (operation ids, decision replay, schema validate), leftover `applyHistoricalManifest`, leftover `parseAgentNames` / `allocateCents` / `parseEasternDate`, leftover `normalizeJobNo`, and leftover `cancellationCorrelationSnapshotsFromBooking` are not this file. Do not inline them so “the planner is one sitting.”

15. **July spec § Authority is stale on live match scope.** It still says live `duplicateLead.service.ts` and the RingCentral guard allow company matching. Current leftover `findDuplicateFormLeadMatch` already requires exact granularity. Do not loosen this file’s planted `source_granularity_id` so “we match the old sentence.”

## Testing

The **interface** is the test surface: `planThisHistoricalMerge` (today `planHistoricalConsolidation`).

Today’s `planner.test.ts` is one happy-path fixture: new Source Company + Form + Booking + Refund, empty live collections, deterministic hash, four catalog audits, empty `sheet_sync`. That is not enough for a story this long.

Keep the hash lock. Add only what the **interface** still hides:

**Refuse a broken seat**
- Non-finite `planning_timestamp` → throw.
- Blank `git_sha` → throw.
- Actor role other than `owner` → throw.
- Snapshot missing `vantagemovers` or `vantagemovershistorical` → throw.

**Extend the catalog inactive in the plan**
- Unknown Source Company + granularity → one inactive company insert, one inactive granularity insert, two Registry audits; both `active: false`.
- Same inputs twice → identical catalog `target_id`s and `manifest_hash`.
- Granularity whose live `source_company` is a different company → throw.

**Parse Form and Call candidates**
- Form missing a zip → `invalid_form_lead`, non-blocking, no Form Lead operation.
- Call missing a phone → blocking `invalid_call_lead_identity`.
- Two live Forms share the same company + Lead ID → blocking `ambiguous_live_form_identity`.
- Live Call matches phone + timestamp within 60 seconds, not exact → one live id, fill not insert.
- Bad Leads row with a unique Lead ID attaches provenance to the Form; `bad_lead` stamps only when the judge says not a Duplicate Lead and the Lead is not booked.

**Ask the classifier, then stamp**
- Two same-granularity pre-cutoff Forms with the same phone → later is a Duplicate Lead, `cpl = 0`, `duplicate_zero`, still inserted.
- Live modern Form with `duplicate: true` and timestamp on or after the cutoff → planned `duplicate` stays true even with no earlier anchor (`preserve_duplicate`).
- Call with a non-duplicate Form at the same Source Company + phone across the cutoff → planned `form_fill: true`.

**Plan Bookings and Cancellations**
- Two Booked Deals rows, same Job Number, different deposit → blocking `conflicting_duplicate_booking_facts`.
- Missing source mapping → blocking `unresolved_booking_source_mapping`.
- No staged or live Lead and mapping `referral: true` → planned `is_referral_booking: true`, no `lead_ref`.
- No staged or live Lead and mapping `referral` absent → planned `is_leadless_booking: true`.
- No live Customer and no unique contact match → one Customer insert whose id is the Job-scoped deterministic id.
- Book Date text contains `0205` and leftover date parse did not correct it → blocking `missing_known_0205_correction`.
- Refund Job Number missing from planned and live Bookings → blocking `unlinked_or_invalid_cancellation`.
- Booked Bad-tab Form → planned lead document has no `bad_lead`.

**Refuse an unclassified row, then seal**
- A tab `kind` this file does not walk → blocking `unclassified_source_row`.
- Same frozen input twice → identical `manifest_hash` (already locked).
- No planned document has `sheet_sync` other than `[]` (already locked).
- No planned Form has `post_to_granot: true`.

Do **not** add a test per helper (`flattenTheFrozenSheetRows`, `plantTheRowTheClassifierJudges`, `dropLegacyBadTabOnceTheLeadIsBooked`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`HistoricalPlanningInput` / `HistoricalPlanningResult` may stay exported as aliases. They are not a second test surface.

## What I would not do

- A `HistoricalPlannerService` class with `plan` / `create` / `update`.
- Thirty two-line functions that only wrap leftover `sha256` or `documents()`.
- Moving this into a CRUD folder, or a `plan/` folder that also swallows leftover `manifest.ts` and leftover `apply.ts`.
- Treating leftover `classifyHistoricalLeads`, leftover `buildHistoricalManifest`, leftover `applyHistoricalManifest`, leftover `createFormLead`, or leftover `ingest-historical-sheets.ts` as this story.
- Inventing a Mongo **seam** that has only this in-memory walk as an **adapter**.
- Inventing a Sheet Sync **seam** so “historical rows can project.”
- Silently routing this batch through `FormLead.find` / leftover `createBookedLead` so “planning imports the application-owned write.”
- Applying `select_candidate` decisions inside this file so “the bundle changes the plan.”
- Moving CPL zeroing, `bad_lead`, or insert-or-fill into already-recommended `classification.ts`.
- Turning on `post_to_granot` or a non-empty `sheet_sync` so “the planned document looks like a live ingest.”
- Calling leftover name-only Customer upsert so “one Customer helper owns historical and live.”
- Reordering classification after Bookings, or catalog inserts after lead writes.
- Opening `manifest.ts` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
