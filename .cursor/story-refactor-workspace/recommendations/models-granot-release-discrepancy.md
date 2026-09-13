# Remember One Open Release Identity-Conflict Desk On `granot_release_discrepancies` For This Job Plus Reason Fingerprint, Bind The Selected Mongo Database, And Declare The Two Named Indexes With Partial Unique Open `{ normalized_job_no, discrepancy_kind, reason_fingerprint }` — Never Open Or Refresh Here, Never Re-Evaluate Correct-Record-Link Or No-Action Here, Never Mint An Official Cancellation, Never Treat Live Missing-Booking Release As This Desk, Never Merge This Into The Booking Discrepancy Or The Shared Factory — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 28 of this service — `GranotReleaseDiscrepancy.ts`
- Remaining in this service: `granotLifecycleSchemas.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotReleaseDiscrepancy.ts`
- Knowledge: There is **no** standalone Service file in `docs/knowledge/granot-lifecycle/` for this row. Owner durable-work / four Release reasons / no-flag rule: [`docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md`](../../../docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md) (`GranotReleaseDiscrepancy`: `release_without_vantage_booking` / `release_record_link_conflict` / `release_job_number_conflict` / `release_source_scope_conflict`; one partial unique open-fingerprint plus a state/newest-evidence queue; evidence append-only; resolving preserves the row — **this file never fingerprints**, never opens). Related processor: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) (`persistProcessorDiscrepancy` → `createGranotDiscrepancies`; identity conflict on actual Release returns `booking_discrepancy_required` with a `release_*` reason and the processor maps `reason_code.startsWith("release_")` onto this collection; officially cancelled Booking + Release is `already_current` / `booking_already_cancelled` — Decision only, **no** discrepancy; missing Booking + Release is booking intake, **not** `release_without_vantage_booking` — **this file never plans**). Related Booking intake: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) (identity/Job/source conflict on actual Release → typed `release_record_link_conflict` / `release_job_number_conflict` / `release_source_scope_conflict`, no Booking case; missing Booking + Release → booking intake evidence — **do not copy Booking-case open onto this collection**). Related historical Release case: [`docs/knowledge/granot-lifecycle/release-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/release-reconciliation.md) (processor no longer opens Release cases; conflict classifications for identity still persist here through leftover `discrepancies.ts`; migrate-into-booking-intake leaves open `release_without_vantage_booking` historical — **do not merge identity conflict into that leftover case**). Related already-recommended persist / Owner review: [granot-lifecycle-discrepancies.md](granot-lifecycle-discrepancies.md) / [granot-lifecycle-discrepancy-owner-commands.md](granot-lifecycle-discrepancy-owner-commands.md) (`createDiscrepancyFingerprint` / `findOpen` / `insert` / `$push` refresh / `updateOne` resolve; Correct Record Link refuses `release_without_vantage_booking`; leftover Re-evaluate still asks `reconcileReleaseCaseAfterDiscrepancy` when `kind === "release"` — **this file never elects those**). Related already-recommended Booking desk: [models-granot-booking-discrepancy.md](models-granot-booking-discrepancy.md) (collection `granot_booking_discrepancies`; five `booked_*` reasons — **do not copy that tuple onto this desk**). Related already-recommended historical Release case model: [models-granot-release-reconciliation-case.md](models-granot-release-reconciliation-case.md) (collection `granot_release_reconciliation_cases`; `action_kind: "release"` — **do not merge**). Related already-recommended Booking case: [models-granot-booking-reconciliation-case.md](models-granot-booking-reconciliation-case.md) (unique open `{ normalized_job_no, action_kind }` plus sequence — **do not copy that unique onto this desk**). Related leftover later shared factory: leftover later `granotDiscrepancyModel.ts` (`createGranotDiscrepancyModel` owns fields, timestamps, `autoIndex: false`, and the mongoose open-guard hooks — **do not pull that factory into this file**). Related leftover next channel catalog: leftover next `granotLifecycleSchemas.ts` (`ENTITY_REF_MODELS` lists `GranotReleaseDiscrepancy`; evidence-action enum is shared — **do not merge that catalog here**). Compatibility rule: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) names the Booking case and does **not** name this collection — do not add a Core Collections paragraph from this rename. Distinct from leftover Job Timeline hop: already-recommended [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (`db.collection("granot_release_discrepancies")` by prefix-equivalent Job — **this file never hops**). Related already-recommended metrics / health: [granot-lifecycle-metrics.md](granot-lifecycle-metrics.md) / [`docs/knowledge/granot-lifecycle/observability.md`](../../../docs/knowledge/granot-lifecycle/observability.md) (`open_discrepancies` keys are `kind|reason_code`; this file exports the Release reason tuple — **this file never gauges**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Granot Release Discrepancy](../../../../CONTEXT.md); this checkout does **not** define it — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model vs named-index catalog vs four Release reasons vs leftover persist vs Owner resolve vs queue/health vs raw-collection hop.** Already-recommended leftover `discrepancies.ts` **asks** `getGranotReleaseDiscrepancyModel()` when `kind === "release"` for `findOpen` / `create` / `findOneAndUpdate` `$push` on `{ state: "open", "evidence.observation_id": { $ne } }`. Already-recommended leftover `discrepancyOwnerCommands.ts` **asks** the getter `findById` then mongoose `updateOne({ _id, state: "open", revision })` to resolve `re_evaluated` / `record_link_corrected` / `no_action`; leftover Re-evaluate still calls `reconcileReleaseCaseAfterDiscrepancy` when `kind === "release"`. Already-recommended leftover `discrepancyProjections.ts` **asks** the getter `find` / `findById` for Owner queue and detail (masked contact; Correct Record Link capability refuses `release_without_vantage_booking`). Already-recommended `projections.ts` **asks** the getter `find({ normalized_job_no })` on the forensic Job hop and aggregates open rows by `reason_code` for health. Already-recommended leftover `metrics.ts` **asks** `RELEASE_DISCREPANCY_REASON_CODES` as the Release half of `open_discrepancies` labels. `scripts/migrations/granot-lifecycle-indexes.ts` **asks** `GRANOT_RELEASE_DISCREPANCY_INDEXES` + `GRANOT_RELEASE_DISCREPANCY_COLLECTION`. `scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.ts` **asks** the getter to leave open `release_without_vantage_booking` historical. Already-recommended `jobNumberTimeline/mongo-evidence-loader.ts` hops `db.collection("granot_release_discrepancies")` by prefix-equivalent Job — **it does not import this file**. `GranotReleaseDiscrepancy.test.ts` **asks** the four Release reasons / two named indexes / collection name / Booking-reason refuse on validate. Replica fixtures create both catalogs’ indexes; unique-open 11000 proof is Booking-only. Replica cleanup uses `.collection.deleteMany` (hooks do not run on `.collection.*`). Not this **interface**: `createGranotDiscrepancies` itself, `createDiscrepancyFingerprint` itself, `reEvaluateGranotDiscrepancy` itself, `correctGranotRecordLink` itself, `resolveGranotDiscrepancyNoAction` itself, `createGranotDiscrepancyModel` itself, `createJobNumberTimelineModule({ loader }).read` itself.
- Seams callers need: default `GranotReleaseDiscrepancy` (first-registered connection — getter same-db return) vs `getGranotReleaseDiscrepancyModel()` (selected `getMongoDatabaseName()`); this Release collection vs already-recommended Booking collection as two **adapters** of one leftover persist rule; unique partial `{ normalized_job_no, discrepancy_kind, reason_fingerprint }` where `state:"open"` vs already-recommended Booking-case unique partial `{ normalized_job_no, action_kind }` where `state:"open"` vs already-recommended Record Link unique partial `{ provider, normalized_job_no }` where `state:"active"`; leftover persist filter `{ state: "open", reason_fingerprint, "evidence.observation_id": { $ne } }` vs Owner resolve CAS `{ state: "open", revision }`; mongoose writes (leftover later factory hooks run) vs `.collection.insertOne` / `.collection.deleteMany` (hooks **do not** run); `timestamps: true` / `autoIndex: false` come from leftover later `createGranotDiscrepancyModel`, not from a second options block here; `GRANOT_RELEASE_DISCREPANCY_COLLECTION` `"granot_release_discrepancies"` vs Job Timeline hardcoded same string; `RELEASE_DISCREPANCY_REASON_CODES` (four `release_*` only) vs leftover `types.ts` `GranotDiscrepancyReasonCode` (five Booking plus four Release); live missing-Booking Release → Booking intake vs leftover historical `release_without_vantage_booking` rows that still live here. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no authorization **seam**. There is no official Cancellation **seam**. There is no fingerprint **seam** on this file.
- Split later (only if the file outgrows one sitting): this ~61-line file is one sitting if you read it as remember one open Release identity-conflict desk on `granot_release_discrepancies` for this Job plus reason fingerprint, bind the selected Mongo database, and declare the two named indexes with partial unique open `{ normalized_job_no, discrepancy_kind, reason_fingerprint }` — never open or refresh here, never re-evaluate / correct-record-link / no-action here, never mint an official Cancellation, never treat live missing-Booking Release as this desk, never merge this into the Booking discrepancy or the shared factory. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `reasons.ts` / `open.ts` / `resolve.ts`. Leftover persist stays already-recommended `discrepancies.ts`. Leftover Owner review stays already-recommended `discrepancyOwnerCommands.ts`. Leftover later factory stays `granotDiscrepancyModel.ts`. Already-recommended Booking desk stays `GranotBookingDiscrepancy.ts`. Leftover next catalog stays `granotLifecycleSchemas.ts`. Job Timeline hop stays leftover `mongo-evidence-loader.ts`.

`GranotReleaseDiscrepancy` is a Mongoose model name. The owner question is: *Granot just showed Release evidence that does not match Vantage about this Job — no Vantage Booking on a leftover historical row, the Record Link, the Job Number, or the Source Scope. That is not a Booking case, not the leftover Release case, and not a Cancellation. Hold that fight on `granot_release_discrepancies`. Only these four Release reasons. Partial unique `{ normalized_job_no, discrepancy_kind, reason_fingerprint }` while `state:"open"` so a second open insert for the same mismatch 11000s and leftover persist retries onto the live row. A resolved row keeps its fingerprint; later leftover persist for the same mismatch opens a new row. Live missing-Booking Release is booking intake, not this desk. Officially cancelled Booking plus Release is already current, not this desk. If this process selected a different Mongo database, hand back that database’s desk. Do not open here. Do not decide the fight here. Do not mint an official Cancellation. Do not merge Booking fights into this collection.*

Who leftover-opens / leftover-refreshes already lives in `discrepancies.ts`. Who leftover-re-evaluates / corrects the Record Link / marks No Action already lives in `discrepancyOwnerCommands.ts`. Who holds the shared schema and mongoose guards already lives in leftover later `granotDiscrepancyModel.ts`. Who holds already-recommended Booking fights already lives in `GranotBookingDiscrepancy.ts`. Do not pull those in.

## What this file actually does

Two operations of one “remember one open Release identity-conflict desk, bind the selected Mongo database, and declare the two named indexes with partial unique open `{ normalized_job_no, discrepancy_kind, reason_fingerprint }`” story, not “a discrepancy model CRUD dump,” and not Open The Fight / Re-Evaluate / Correct Record Link themselves:

1. **Hold the Release identity-conflict desk** — collection `granot_release_discrepancies` (`GRANOT_RELEASE_DISCREPANCY_COLLECTION`), model name `"GranotReleaseDiscrepancy"`, `kind: "release"` handed to leftover later `createGranotDiscrepancyModel`. Declares `RELEASE_DISCREPANCY_REASON_CODES`: `release_without_vantage_booking` / `release_record_link_conflict` / `release_job_number_conflict` / `release_source_scope_conflict`. A Booking reason (`booked_after_official_cancellation` and the other `booked_*` codes) refuses validate on this model. There is **no** `release_booking_lead_conflict`. There is **no** `release_after_official_cancellation`. Document / evidence types are aliases of leftover later `GranotDiscrepancyDocument` / `GranotDiscrepancyEvidence` — this file does **not** re-declare fields. There is **no** `sequence_number`. There is **no** `action_kind`. There is **no** persisted `mode`. There is **no** `sheet_sync[]`. There is **no** `processing`. This beat does **not** hash the fingerprint (leftover persist SHA-256s versioned canonical JSON and stores 64 lowercase hex here). This beat does **not** choose re-evaluate versus Correct Record Link versus No Action. This beat does **not** mint a `CancelledLead`. This beat does **not** hide a resolved row from Job Timeline. This beat does **not** open a Booking case when Booking is missing.

2. **Bind the selected Mongo database and declare the two named indexes** — default export `GranotReleaseDiscrepancy` is leftover later `created.model` (first-registered connection). `getGranotReleaseDiscrepancyModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb` + register the leftover later schema. `GRANOT_RELEASE_DISCREPANCY_INDEXES` is two named keys: unique partial `{ normalized_job_no: 1, discrepancy_kind: 1, reason_fingerprint: 1 }` where `state: "open"` (`granot_release_discrepancy_open_fingerprint_unique`); non-unique `{ state: 1, last_evidence_at: -1 }` (`granot_release_discrepancy_state_last_evidence`). There is **no** sequence unique. There is **no** `{ "evidence.observation_id": 1 }`. There is **no** `{ deterministic_booking_id, state }`. Leftover later factory loops this catalog onto `Schema.index` and sets `autoIndex: false`. The migration **asks** the catalog (non-unique first, then unique). Job Timeline hops the collection by string `"granot_release_discrepancies"` — **not** this constant. This beat does **not** `syncIndexes`. This beat does **not** delete the default export so “everyone must call the getter.”

There is no open-or-refresh operation. Leftover `createGranotDiscrepancies` elects that. There is no re-evaluate / Correct Record Link / No Action operation. Those leftover Owner commands elect that. There is no official Cancellation write. `CancelledLead` persist lives on Cancellation commands. Mongoose open-guard / evidence-ID / resolved-immutable hooks live on leftover later `createGranotDiscrepancyModel` — **this file never declares them**.

## Organization

Keep one file. This is the screenplay for “remember one open Release identity-conflict desk on `granot_release_discrepancies` for this Job plus reason fingerprint, bind the selected Mongo database, and declare the two named indexes — never open or refresh here, never re-evaluate / correct-record-link / no-action here, never mint an official Cancellation, never treat live missing-Booking Release as this desk, never merge this into the Booking discrepancy or the shared factory.” Leftover persist / leftover Owner commands / Owner queue / index apply already live in deeper **modules**. The shared schema and mongoose guards already live in leftover later `granotDiscrepancyModel.ts`. Already-recommended Booking desk already lives in `GranotBookingDiscrepancy.ts`. Do not pull those in. Do not invent a `GranotReleaseDiscrepancyService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a unique `{ normalized_job_no: 1 }` without the open-fingerprint partial so “one Job forever.” Do not invent a write-once-entire-document **adapter** from this rename so “desk matches Decision.” Do not invent a leftover `processing.*` **adapter** so “desk matches envelope drain.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `reasons.ts` / `open.ts` / `resolve.ts` each get a file.

Do not move `createGranotDiscrepancies` / `reEvaluateGranotDiscrepancy` / `correctGranotRecordLink` into this file so “the row owns leftover persist and review.” Do not merge this file into leftover later `granotDiscrepancyModel.ts` so “the factory owns the Release reasons.” Do not merge this file into already-recommended `GranotBookingDiscrepancy.ts` so “one schema owns Booking and Release fights.” Do not merge this file into already-recommended `GranotReleaseReconciliationCase.ts` so “identity conflict is the leftover Release case.” Do not merge this file into already-recommended `GranotBookingReconciliationCase.ts` so “identity conflict is booking intake.” Do not merge this file into leftover later `BookingLeadReconciliationCase.ts` so “employee pending Leadless is this desk.” Do not merge `createDiscrepancyFingerprint` into this file so “the desk owns the hash.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotReleaseDiscrepancy` | `releaseIdentityConflictDeskOnTheDefaultConnection` | getter same-db return still imports the default model |
| `getGranotReleaseDiscrepancyModel` | `releaseIdentityConflictDeskOnTheSelectedMongoDatabase` | leftover persist / leftover Owner commands / Owner queue / health must follow `getMongoDatabaseName()` |
| `RELEASE_DISCREPANCY_REASON_CODES` | `theFourReleaseIdentityConflictReasons` | leftover metrics labels and this model’s `reason_code` enum share one tuple |
| `GranotReleaseDiscrepancyReasonCode` | `OneReleaseIdentityConflictReason` | one of the four `release_*` codes |
| `GranotReleaseDiscrepancyDocument` | `ReleaseIdentityConflictDeskRow` | alias of leftover later shared document — open or resolved Release fight |
| `GranotReleaseDiscrepancyEvidence` | `ImmutableDiscrepancyEvidenceTuple` | alias of leftover later shared evidence — Observation + Decision + capture time + action |
| `GRANOT_RELEASE_DISCREPANCY_COLLECTION` | `releaseIdentityConflictDeskCollectionName` | migration opens `granot_release_discrepancies` without registering the model |
| `GRANOT_RELEASE_DISCREPANCY_MODEL_NAME` | `releaseIdentityConflictDeskModelName` | getter / default export share `"GranotReleaseDiscrepancy"` |
| `GRANOT_RELEASE_DISCREPANCY_INDEXES` | `namedReleaseIdentityConflictDeskIndexes` | `pnpm migration:granot-lifecycle:indexes` applies the two named keys |

Keep the old names as one-line aliases until leftover persist / leftover metrics / migration / getter same-db return migrate. Do not make callers learn `useDb` / `createGranotDiscrepancyModel` as the domain language. Do **not** delete the default `GranotReleaseDiscrepancy` export so “everyone must call the getter.” Do **not** delete the getter so “desk matches Testimonial.” Do **not** re-export `createGranotDiscrepancies` / `reEvaluateGranotDiscrepancy` from this file so “the row owns leftover persist and review.” Do **not** export a Record-Link-style allowlist Set so “callers learn `$push`.” Do **not** add `deleteOne` refuse from this rename so “desk matches Decision.”

**No class for the workflow.** The one type that *does* earn a name is the pending open-desk identity contract:

```ts
type ReleaseIdentityConflictDeskIdentity = {
  collection: "granot_release_discrepancies"
  official_cancellation: false
  booking_intake: false
  leftover_release_case: false
  discrepancy_kind: "release"
  reasons: [
    "release_without_vantage_booking",
    "release_record_link_conflict",
    "release_job_number_conflict",
    "release_source_scope_conflict",
  ]
  live_missing_booking_release: "booking_intake_not_this_desk"
  officially_cancelled_plus_release: "already_current_not_this_desk"
  open_fingerprint: {
    unique: true
    normalized_job_no_plus_kind_plus_reason_fingerprint: true
    partial_state_open: true
  }
  sequence: false
  named_indexes: 2
}
```

That is the handoff from “this process remembered a Release identity fight for the Job” to “a second open `{ normalized_job_no, discrepancy_kind, reason_fingerprint }` 11000s, leftover persist `$push`es a new Observation onto the live row, and leftover Owner resolve wins only when `state` is still `open` at the expected `revision`.” Do **not** add `{ normalized_job_no: { unique: true, ignore_fingerprint: true } }` so “one fight per Job forever.” Do **not** add `{ processing: granotReceiptProcessingSchema }` so “desk matches envelope drain.” Do **not** add `{ mode: "release" }` so “desk matches the leftover Release case.” Do **not** flip write-once-entire-document from this rename so “desk matches Decision.” Do **not** unset `autoIndex` from this rename so “boot matches statement” — leftover later factory owns that option.

Leave `discrepancies.ts` on that file. Leave `discrepancyOwnerCommands.ts` on that file. Leave leftover later `granotDiscrepancyModel.ts` on that file. Leave already-recommended `GranotBookingDiscrepancy.ts` on that file. Leave already-recommended `GranotReleaseReconciliationCase.ts` on that file. Leave leftover next `granotLifecycleSchemas.ts` on that file. Leave index apply on the migration script. Leave the Job Timeline hop on that loader.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotReleaseDiscrepancy.ts
// Granot just showed Release evidence that does not match Vantage
// about this Job — a leftover historical missing Booking,
// the Record Link, the Job Number, or the Source Scope.
// Hold that fight on granot_release_discrepancies.
// Only these four Release reasons.
// Partial unique { normalized_job_no, discrepancy_kind, reason_fingerprint }
// while state:"open" so a second open insert for the same mismatch 11000s
// and leftover persist retries onto the live row.
// A resolved row keeps its fingerprint;
// later leftover persist for the same mismatch opens a new row.
// Live missing-Booking Release is booking intake, not this desk.
// Officially cancelled Booking plus Release is already current, not this desk.
// This is not a Booking case, not the leftover Release case,
// and not a Cancellation.
// If this process selected a different Mongo database,
// hand back that database’s desk.
// Do not open here.
// Do not decide the fight here.
// Do not mint an official Cancellation.

import { createGranotDiscrepancyModel } from "./granotDiscrepancyModel"

// ── 1. Hold the Release identity-conflict desk ────────────

export const GRANOT_RELEASE_DISCREPANCY_COLLECTION =
  "granot_release_discrepancies"
export const GRANOT_RELEASE_DISCREPANCY_MODEL_NAME =
  "GranotReleaseDiscrepancy"

export const RELEASE_DISCREPANCY_REASON_CODES = [
  "release_without_vantage_booking",
  "release_record_link_conflict",
  "release_job_number_conflict",
  "release_source_scope_conflict",
] as const

function rememberTheReleaseIdentityConflictDeskShape()
function refuseBookingReasonsOnThisDesk()
  // leftover later factory enums reason_code to this tuple
  // already-recommended Booking desk owns booked_*
function refuseToTreatLiveMissingBookingReleaseAsThisDesk()
  // processor + booking intake open create_missing_booking
  // leftover historical release_without_vantage_booking rows stay here

// ── 2. Bind the selected Mongo database and declare the two named indexes

export const GRANOT_RELEASE_DISCREPANCY_INDEXES = [
  { name: "granot_release_discrepancy_open_fingerprint_unique",
    key: { normalized_job_no: 1, discrepancy_kind: 1, reason_fingerprint: 1 },
    unique: true, partialFilterExpression: { state: "open" } },
  { name: "granot_release_discrepancy_state_last_evidence",
    key: { state: 1, last_evidence_at: -1 } },
]

export const GranotReleaseDiscrepancy = /* default connection */
export function getGranotReleaseDiscrepancyModel()
  // same model when connection.name === getMongoDatabaseName()
  // otherwise useDb + register leftover later schema
```

Read the primary path out loud: *Granot just showed Release evidence that does not match Vantage about this Job. Hold that fight on `granot_release_discrepancies`. Only the four Release reasons. Partial unique on normalized Job plus kind plus reason fingerprint while open so a second open insert for the same mismatch 11000s and leftover persist retries onto the live row. A resolved row keeps its fingerprint; later leftover persist for the same mismatch opens a new row. Live missing-Booking Release is booking intake, not this desk. Officially cancelled Booking plus Release is already current, not this desk. If this process selected another Mongo database, hand back that database’s desk. Do not open here. Do not decide the fight here. Do not mint an official Cancellation. Do not merge Booking fights into this collection.*

That is the operation. `GranotReleaseDiscrepancy.create` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This is the Release fight desk. It is not open, review, or an official Cancellation.** Already-recommended leftover `discrepancies.ts` owns fingerprint / find-open / insert / `$push` refresh and the causal Decision. Already-recommended leftover `discrepancyOwnerCommands.ts` owns resolve and Record Link supersession. `CancelledLead` persist lives on Cancellation command files. Do not move those in so “the row owns leftover persist and review.” Do not delete leftover persist from this rename so “the owner spec sentence wins.”

2. **Two named indexes. Booking case has six. Leftover Release case has five. Booking desk has the same two-index shape.** Unique is the open fingerprint, not `{ normalized_job_no, action_kind }`. There is no sequence unique — leftover persist after resolve inserts a new row for the same fingerprint. Do not add a sequence unique from this rename so “desk matches the leftover Release case.” Do not add `{ "evidence.observation_id": 1 }` so “desk matches Booking case.” Do not unique Job Number without the fingerprint so “one fight per Job forever.”

3. **The four Release reasons live here. `types.ts` also lists them plus the five Booking reasons.** Leftover metrics concatenates this tuple after `BOOKING_DISCREPANCY_REASON_CODES`. Leftover persist types `reason_code` from `types.ts`. There is no `release_booking_lead_conflict` even though Booking has `booked_booking_lead_conflict`. There is no `release_after_official_cancellation`. Do not add those two from this rename so “Release matches Booking.” Do not merge `GranotDiscrepancyReasonCode` into this file so “one catalog owns both desks.” Do not drop `RELEASE_DISCREPANCY_REASON_CODES` so “types already has the union.” Leave both until a later catalog pass.

4. **Live missing-Booking Release is booking intake. `release_without_vantage_booking` is leftover historical.** Processor + booking intake open `create_missing_booking` when Release arrives with no Booking and no identity conflict. Owner spec still lists the four-reason tuple including `release_without_vantage_booking`. Migrate-into-booking-intake leaves those open rows historical (`discrepancy.action: "leave_historical"`). Correct Record Link and Owner detail refuse that reason. Do not delete the reason from this tuple so “new traffic never opens it.” Do not route live missing-Booking Release onto this desk from this rename so “the spec tuple wins.”

5. **Officially cancelled Booking plus Release is already current. Officially cancelled plus Booked is the Booking desk.** Processor writes Decision only (`booking_already_cancelled`) — no case, no this desk. Do not add `release_after_official_cancellation` from this rename so “Release matches Booking.” Do not persist a Release fight from cancelled-plus-Release so “every cancelled Job has a desk.”

6. **Processor maps this collection by `reason_code.startsWith("release_")`, not by a Release classifier.** Booking intake returns `booking_discrepancy_required` with a `release_*` reason; `persistProcessorDiscrepancy` then sets `discrepancy_kind: "release"`. Leftover persist picks this getter when `kind === "release"`. Do not accept `booked_*` reasons here from this rename so “one desk owns both fights.” Do not merge this file into already-recommended `GranotBookingDiscrepancy.ts` so “one schema owns Booking and Release fights.”

7. **Fingerprint is computed on leftover persist, stored here as 64 hex.** Leftover later factory `match: /^[a-f0-9]{64}$/` and `lowercase: true`. Contact, Observation, Decision, timestamps, and display never enter the hash. Do not move `createDiscrepancyFingerprint` here so “the desk owns the identity.” Do not unique `reason_code` without the fingerprint so “same reason plus different Lead is one row.”

8. **Unique is exact `{ normalized_job_no, discrepancy_kind, reason_fingerprint }` while open. Job Timeline hops prefix-equivalent Jobs.** `equivalentNormalizedJobFilter` would treat `P5562366` / `5562366` as one Job on the timeline. This unique would allow both to be open at once when fingerprints differ or match independently. Leftover persist `findOpen` uses the exact stored Job string plus fingerprint. Do not widen the unique onto digit-core from this rename so “the index matches Job Timeline.” Do not drop the prefix filter on the hop so “lookup matches the unique.” Leave both.

9. **There is no delete hook on this file, and leftover later factory also has none.** Decision and the activation clock refuse mongoose `deleteOne`. Replica discrepancy fixtures call `.collection.insertOne` / `.collection.deleteMany`. Replica unique-open proof is Booking-only even though it creates this catalog’s indexes. Do not add delete refuse from this rename so “desk matches Decision.” Do not treat replica `deleteMany` as a product path. Do not move the Booking-only 11000 proof onto this file so “the Release desk owns leftover persist.”

10. **Mongoose open-guard hooks are leftover later factory work.** `post("init")` / resolved-immutable validate / query refuse of replace / unguarded update / `$set evidence` / `$set reason_code` / `$set reason_fingerprint` / `$set discrepancy_kind` / `$pull` / `$pop` / `$unset` live on `createGranotDiscrepancyModel`. This file’s unit test does **not** exercise those hooks — it only refuses a Booking reason on validate and names the four reasons / two index names / collection. It does **not** deep-equal the index catalog or assert `autoIndex: false` (the Booking twin does). Do not copy those hooks into this file from this rename so “the Release desk owns mutation.” Do not rewrite leftover later `granotDiscrepancyModel.ts` from this pass. Add the missing catalog / `autoIndex` assertions on this **interface** later.

11. **Leftover Owner Re-evaluate still asks `reconcileReleaseCaseAfterDiscrepancy` when `kind === "release"`.** Live processor no longer opens Release cases. New Release evidence lands on the Booking case. Do not move that leftover reconcile into this file so “the desk owns case open.” Do not delete leftover Release-case reconcile from this rename so “processor retired it.” Leave that on leftover `discrepancyOwnerCommands.ts`.

12. **`schema-and-crud-inputs.mdc` names the Booking case and omits this collection.** Do not add a Core Collections paragraph from this rename so “every Granot row is listed.” Do not invent a `CONTEXT.md` term. Knowledge still says there is no standalone discrepancy Service — do not invent `docs/knowledge/granot-lifecycle/discrepancies.md` in this pass.

13. **Leave sibling modules alone.** `createGranotDiscrepancies`, `createDiscrepancyFingerprint`, `reEvaluateGranotDiscrepancy`, `createGranotDiscrepancyModel` are already the right **depth**. This file holds the Release desk.

## Testing

The **interface** is the test surface: `GranotReleaseDiscrepancy` / `getGranotReleaseDiscrepancyModel` / `RELEASE_DISCREPANCY_REASON_CODES` / `GRANOT_RELEASE_DISCREPANCY_INDEXES` / `GRANOT_RELEASE_DISCREPANCY_COLLECTION`.

Today’s `GranotReleaseDiscrepancy.test.ts` already names part of the operation:

**Hold the Release identity-conflict desk**
- Four Release reasons match the owner spec tuple, in that order.
- A Booking reason (`booked_after_official_cancellation`) refuses validate (`/reason_code/`).
- `release_without_vantage_booking` validates with one evidence tuple.

**Bind the selected Mongo database and declare the two named indexes**
- Two named indexes; first name is `granot_release_discrepancy_open_fingerprint_unique`.
- Named collection is `granot_release_discrepancies`.

Add on the same **interface** (do not invent helper-unit tests):

- Index catalog deep-equals the two named keys (unique open is partial `{ normalized_job_no, discrepancy_kind, reason_fingerprint }` where `state: "open"`).
- `autoIndex` is `false` (Booking twin already asserts this).
- Model name is `GranotReleaseDiscrepancy`.
- Getter returns the same model name on the selected database.

Do **not** add a test per helper (`rememberTheReleaseIdentityConflictDeskShape`, `refuseBookingReasonsOnThisDesk`, `refuseToTreatLiveMissingBookingReleaseAsThisDesk`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** move leftover later factory hook proofs (`resolved immutable`, `$set evidence`, `$set reason_fingerprint`) onto this file so “the Release desk owns mutation.” Those stay on leftover later `granotDiscrepancyModel.ts`.

Do **not** move `discrepancies.replica.test.ts` / leftover Owner review proofs into this file so “the row owns leftover persist and review.” Unique-open-fingerprint 11000 / `CASE_REVISION_CONFLICT` / Correct Record Link stay on those command **interfaces**.

Do **not** add a Job Timeline prefix-equivalence test here. `equivalentNormalizedJobFilter` lives on `bookingIdentity.ts` and does not import this file.

Do **not** add a fingerprint-hash test here. `createDiscrepancyFingerprint` lives on leftover `discrepancies.ts`.

Do **not** add a live missing-Booking Release → booking-intake test here. That classifier lives on leftover `bookingReconciliation.ts` / `processor.ts`.

## What I would not do

- A `GranotReleaseDiscrepancyService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `reasons.ts` / `open.ts` / `resolve.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit **seam**. Leftover persist already writes the discrepancy and the causal Decision in one transaction; leftover Owner commands already resolve inside the command transaction — do not move those writes into this file so “the row owns leftover persist and review.”
- Treating `createGranotDiscrepancies` / `createDiscrepancyFingerprint` / `reEvaluateGranotDiscrepancy` / `correctGranotRecordLink` / `resolveGranotDiscrepancyNoAction` / `createGranotDiscrepancyModel` as this story.
- Inventing a leftover `processing.*` **seam** that has only one **adapter**.
- Silently "fixing" the missing Core Collections paragraph / missing delete hooks / dual reason catalogs / prefix-equivalent unique / live `release_without_vantage_booking` retirement while recommending a rename.
- Jumping to `validation/` while `models` has unchecked modules.
- Writing a whole-folder recommendation for `models`.
- Merging this file into leftover later `granotDiscrepancyModel.ts` so “the factory owns the Release reasons.”
- Merging this file into already-recommended `GranotBookingDiscrepancy.ts` so “one schema owns Booking and Release fights.”
- Merging this file into already-recommended `GranotReleaseReconciliationCase.ts` so “identity conflict is the leftover Release case.”
- Merging this file into already-recommended `GranotBookingReconciliationCase.ts` so “identity conflict is booking intake.”
- Merging this file into already-recommended `GranotRecordLink.ts` so “one schema owns the current Job link and the fight.”
- Merging this file into leftover later `BookingLeadReconciliationCase.ts` so “employee pending Leadless is this desk.”
- Unique-indexing Job Number without the open-fingerprint partial so “resolved history cannot share a Job.”
- Adding a sequence unique so “desk matches the leftover Release case.”
- Adding `{ "evidence.observation_id": 1 }` so “desk matches Booking case.”
- Accepting `booked_*` reasons here so “one desk owns both fights.”
- Adding `release_booking_lead_conflict` or `release_after_official_cancellation` so “Release matches Booking.”
- Routing live missing-Booking Release onto this desk so “the spec tuple wins.”
- Moving `createDiscrepancyFingerprint` here so “the desk owns the hash.”
- Treating leftover next `granotLifecycleSchemas.ts` as this story.
- Reopening Wave A to enumerate `connectBookingToLead.ts` from this models pass.
