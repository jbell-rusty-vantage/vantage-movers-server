# Remember One Append-Only Historical Owner Release Work Case On `granot_release_reconciliation_cases`, Allow Only Open Refresh Through Guarded `$push` And Resolve Through Open Plus `case_revision`, And Declare The Five Named Indexes With Partial Unique Open `{ normalized_job_no, action_kind }` Plus Unique Sequence — Never Open Or Refresh Here, Never Confirm-Cancellation Update Or No-Action Here, Never Mint An Official Cancellation, Never Merge This Into The Booking Case — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 26 of this service — `GranotReleaseReconciliationCase.ts`
- Remaining in this service: `GranotBookingDiscrepancy.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotReleaseReconciliationCase.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/release-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/release-reconciliation.md) (historical only; a [Granot Release Reconciliation Case](../../../../CONTEXT.md) is retired Owner work; the processor no longer opens or refreshes these rows; new Release Observations land on the [Granot Booking Reconciliation Case](../../../../CONTEXT.md); existing rows stay readable; they are not a Cancellation and never auto-cancelled — **this file never opens**, never confirms). Related processor: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) (`maybeReconcileRelease` is removed, not shimmed; `createGranotReleaseReconciliation` is not invoked from the processor — **this file never plans**). Related booking intake: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) (new Release evidence does not open or refresh a Release case — **do not copy that intake onto this collection**). Compatibility rule: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) names the Booking case and does **not** name this collection — do not add a Core Collections paragraph from this rename. Related already-recommended leftover persist / leftover Owner commands: [granot-lifecycle-release-reconciliation.md](granot-lifecycle-release-reconciliation.md) / [granot-lifecycle-release-owner-commands.md](granot-lifecycle-release-owner-commands.md) (`insertCase` / `refreshCase` / `updateOne` resolve — **this file never elects those**; the Wave A persist rec still describes processor invoke — **do not rewrite that file from this models pass**). Related already-recommended Booking case: [models-granot-booking-reconciliation-case.md](models-granot-booking-reconciliation-case.md) (collection `granot_booking_reconciliation_cases`; `action_kind: "booked"`; six named indexes including `{ "evidence.observation_id": 1 }`; optional `deterministic_booking_id`; persisted `mode` — **do not copy that catalog onto this row**). Related already-recommended Record Link: [models-granot-record-link.md](models-granot-record-link.md) (unique partial `{ provider, normalized_job_no }` where `state:"active"` — **do not copy that unique onto this case**). Related already-recommended Decision: [models-synchronization-decision.md](models-synchronization-decision.md) (write-once entire document including mongoose delete refuse — **do not copy those delete hooks onto this case**). Related leftover later discrepancy: leftover later `GranotReleaseDiscrepancy.ts` (identity conflict — **do not merge**). Related leftover later employee case: leftover later `BookingLeadReconciliationCase.ts` (employee pending Leadless — **do not merge**). Related channel catalog: leftover later `granotLifecycleSchemas.ts` (`GRANOT_RELEASE_RECONCILIATION_OUTCOMES` / `GRANOT_RECONCILIATION_CASE_STATES` / `GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES` — **do not merge that catalog into this file**). Distinct from leftover Job Timeline hop: already-recommended [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (`db.collection("granot_release_reconciliation_cases")` by prefix-equivalent Job as `cancellation_intake` — **this file never hops**). Leftover overview / leftover Registry / leftover historical-consolidation **do not** ask this collection as a catalog row. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Granot Release Reconciliation Case](../../../../CONTEXT.md); this checkout does **not** define it — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model vs named-index catalog vs mongoose open-guard hooks vs leftover persist `$push` vs Owner resolve `updateOne` vs migrate resolve vs raw-collection hop.** Already-recommended leftover `releaseReconciliation.ts` **asks** `getGranotReleaseReconciliationCaseModel()` `findOne({ normalized_job_no, action_kind: "release", state: "open" })` then `create([row], { session })` or `findOneAndUpdate` with `$push` evidence, `$inc evidence_revision` (and `case_revision` only when `booking_revision_at_open` or `record_link_id` changed), filter `{ state: "open", "evidence.observation_id": { $ne } }` — exact Observation replay returns the open row unchanged. The live processor **does not** call that persist (`reconcileRelease` stays an unused dep; processor tests throw if it is invoked). Already-recommended leftover `discrepancyOwnerCommands.ts` **asks** `reconcileReleaseCaseAfterDiscrepancy`, which still insert/refresh on this collection after a Release discrepancy correction. Already-recommended leftover `releaseOwnerCommands.ts` **asks** the getter `findById` then mongoose `updateOne({ _id, state: "open", case_revision })` to resolve `cancellation_created` / `booking_updated` / `no_action` / `already_satisfied`. Already-recommended `projections.ts` **asks** the getter `find` when `kind=release` and `findById` after a Booking-case miss; default Owner Intakes is booking-only. Already-recommended `creatingObservation.ts` **asks** `findById` for a historical Release case (route default may still fall through here). `scripts/migrations/granot-lifecycle-indexes.ts` **asks** `GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES` + `GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION`. Leftover migrate helper `scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.ts` **asks** the getter to copy missing Release evidence onto the Booking case, then `updateOne` resolve `no_action` / `already_handled_elsewhere` / `migrated_to_booking_intake`. Already-recommended `jobNumberTimeline/mongo-evidence-loader.ts` hops `db.collection("granot_release_reconciliation_cases")` by prefix-equivalent Job — **it does not import this file**. `GranotReleaseReconciliationCase.test.ts` **asks** the five named indexes / required `deterministic_booking_id` / defaults (`action_kind: "release"`, `state: "open"`, revisions `1`) / no persisted `mode` / evidence action `"release"` only / resolved immutable validate / evidence-ID rewrite refuse / unguarded `updateOne` / `replaceOne`. Replica fixtures use `.collection.insertOne` / mongoose `deleteMany` (hooks do not run on `.collection.*`; mongoose `deleteMany` is **not** hooked). Not this **interface**: `createGranotReleaseReconciliation` itself, `confirmCancellation` itself, `updateExistingBooking` itself, `noAction` itself, `reconcileReleaseCaseAfterDiscrepancy` itself, `createJobNumberTimelineModule({ loader }).read` itself.
- Seams callers need: default `GranotReleaseReconciliationCase` (first-registered connection — getter same-db return) vs `getGranotReleaseReconciliationCaseModel()` (selected `getMongoDatabaseName()`); mongoose `create` / `findOneAndUpdate` / `updateOne` (hooks run — open-state guard, no `$set evidence`) vs `.collection.insertOne` / `.collection.deleteMany` (hooks **do not** run — replica fixtures); unique partial `{ normalized_job_no, action_kind }` where `state:"open"` vs unique `{ normalized_job_no, action_kind, sequence_number }` vs already-recommended Booking-case unique of the same shape on a **different** collection vs already-recommended Record Link unique partial `{ provider, normalized_job_no }` where `state:"active"`; `$push` append vs `$set evidence` / `$pull` / `$pop` refuse; Owner / migrate resolve CAS `{ state: "open", case_revision }` vs leftover persist filter `{ state: "open", "evidence.observation_id": { $ne } }`; `timestamps: true` vs Record Link / Decision `timestamps: false`; `autoIndex: false`; `action_kind` always `"release"` vs already-recommended Booking case `"booked"`; required `deterministic_booking_id` + `booking_revision_at_open` vs Booking-case optional Booking id; no persisted `mode` vs Booking-case `create_missing_booking` / `review_existing_booking` / `create_referral_booking`; five named indexes vs Booking-case six (this catalog has **no** `{ "evidence.observation_id": 1 }`); `GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION` `"granot_release_reconciliation_cases"` vs Job Timeline hardcoded same string. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no authorization **seam**. There is no official Cancellation **seam**. There is no Booking-case **seam**.
- Split later (only if the file outgrows one sitting): this ~337-line file is one sitting if you read it as remember one append-only historical Owner Release work case on `granot_release_reconciliation_cases`, allow only open refresh through guarded `$push` and resolve through open plus `case_revision`, and declare the five named indexes with partial unique open `{ normalized_job_no, action_kind }` plus unique sequence — never open or refresh here, never confirm-cancellation / update / no-action here, never mint an official Cancellation, never merge this into the Booking case. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `open.ts` / `resolve.ts` / `confirm.ts`. Leftover persist stays already-recommended `releaseReconciliation.ts`. Leftover Confirm Granot Cancellation / update / no-action stay already-recommended `releaseOwnerCommands.ts`. Channel catalog stays leftover later `granotLifecycleSchemas.ts`. Already-recommended Booking case stays `GranotBookingReconciliationCase.ts`. Job Timeline hop stays leftover `mongo-evidence-loader.ts`.

`GranotReleaseReconciliationCase` is a Mongoose model name. The owner question is: *Granot once showed a Release on a Job that already had a Booking — or the Owner is about to confirm that Cancellation, replace official Booking fields, or mark No Action on a leftover open row. Hold one append-only historical Owner Release work case on `granot_release_reconciliation_cases`. Partial unique `{ normalized_job_no, action_kind }` while `state:"open"` so a second open insert 11000s and leftover persist retries onto the live row. Sequence unique so a resolved case keeps its number and later leftover persist opens the next sequence. The row must name the deterministic Booking and the Booking revision at open. There is no mode. Evidence action is only `release`. After insert mongoose may append evidence on an open row or resolve it; a resolved row cannot reopen, and existing evidence IDs cannot be rewritten. The live processor no longer opens this collection. New Release evidence lands on the Booking case. This is not a Cancellation. If this process selected a different Mongo database, hand back that database’s case model. Do not open here. Do not confirm-cancellation here. Do not mint an official Cancellation. Do not merge this into the Booking case.*

Who leftover-opens / leftover-refreshes already lives in `releaseReconciliation.ts` (processor no longer calls it; discrepancy correction still can). Who leftover-confirms Cancellation / updates / marks No Action already lives in `releaseOwnerCommands.ts`. Who holds the outcome / state catalog already lives in leftover later `granotLifecycleSchemas.ts`. Who holds live Release intake already lives in already-recommended `GranotBookingReconciliationCase.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember one append-only historical Owner Release work case, allow only open refresh through guarded `$push` and resolve through open plus `case_revision`, and declare the five named indexes with partial unique open `{ normalized_job_no, action_kind }` plus unique sequence” story, not “a release-case model CRUD dump,” and not Open The Case / Confirm Granot Cancellation / Update The Booking themselves:

1. **Hold one append-only historical Owner Release work case** — collection `granot_release_reconciliation_cases` (`GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION`), `timestamps: true`, `strict: true`, `autoIndex: false`. **No** `optimisticConcurrency`. **No** `sheet_sync[]`. **No** `source_company`. **No** `processing`. **No** persisted `mode`. **No** `priority_pairing`. **No** official Cancellation fields (Cancel Date, refund, reason). Declares required `normalized_job_no` / `job_no_snapshot` (trim), required `action_kind` enum `["release"]` default `"release"`, required `sequence_number` integer `min: 1`, required `state` enum `open` | `resolved` default `"open"`, required `case_revision` / `evidence_revision` integer `min: 1` default `1`, optional `source_scope` (crm source + company + granularity — leftover persist may omit it), optional `record_link_id`, **required** `deterministic_booking_id`, **required** `booking_revision_at_open` integer `min: 0`, required `evidence[]` of `{ observation_id, decision_id, captured_at, action }` where `action` enum `["release"]` only (Booking-case evidence still allows historical `priority_5` plus Booked or Release — **do not copy that enum here**), required `observed_context` (bounded display — contact / move / estimate / payment / balance / Priority / username; never official input), optional `suggested_lead` (Form or Call + `high` | `medium` + match method), optional `resolution` (`outcome` enum `GRANOT_RELEASE_RECONCILIATION_OUTCOMES` = `cancellation_created` | `booking_updated` | `no_action` | `already_satisfied` | `superseded_by_current_state`, `command_execution_id`, `actor`, optional no-action reason, `resolved_at`, optional `entity_ref`), required `opened_at` / `last_evidence_at`, optional `resolved_at`. Nested refs set `{ _id: false }`. `resolution.entity_ref.id` is a **string**. `suggested_lead.lead_ref.id` is an **ObjectId**. This beat does **not** choose confirm-cancellation versus update versus No Action. This beat does **not** mint a `CancelledLead`. This beat does **not** hide a resolved row from Job Timeline.

2. **Allow only open refresh and resolve; refuse rewrite, replace, and reopen** — `post("init")` remembers `persisted_state` and the stored evidence Observation ids. `pre("validate")` on a loaded document: if not new and remembered state is `resolved`, throw “A resolved Release case is immutable”; if any remembered evidence id is missing from the current array, throw “Existing Release case evidence IDs are immutable” (append is allowed). Query hooks on `updateOne` / `findOneAndUpdate` / `replaceOne`: replacement (no `$` operators) throws “cannot be replaced directly”; `filter.state` must be `"open"` or throw “updates must guard on open state”; `$set.state === "open"` throws “cannot return to open”; `$set evidence` / `$pull` / `$pop` throw “evidence IDs are immutable.” `$push` is **not** forbidden — leftover persist refresh uses it. There is **no** exported allowlist assert. There is **no** `deleteOne` / `deleteMany` / `updateMany` hook. `.collection.insertOne` / `.collection.deleteMany` **bypass** these hooks. This beat does **not** throw `CASE_REVISION_CONFLICT`. This beat does **not** allocate `sequence_number`. This beat does **not** refuse a silent Booking retarget — leftover persist throws “cannot silently retarget to a different Booking” before it writes.

3. **Bind the selected Mongo database and declare the five named indexes** — default export `GranotReleaseReconciliationCase` is `mongoose.models[...] ?? mongoose.model(...)`. `getGranotReleaseReconciliationCaseModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb` + register. `GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES` is five named keys: unique partial `{ normalized_job_no: 1, action_kind: 1 }` where `state: "open"` (`granot_release_case_open_job_kind_unique`); unique `{ normalized_job_no: 1, action_kind: 1, sequence_number: 1 }`; non-unique `{ state, last_evidence_at: -1 }`; `{ deterministic_booking_id, state }`; `{ "suggested_lead.lead_ref.model", "suggested_lead.lead_ref.id", state }`. There is **no** `{ "evidence.observation_id": 1 }`. The Booking-case catalog has that sixth browse key — **do not add it here from this rename so “Release matches Booking.”** The schema loops that catalog onto `Schema.index`. `autoIndex` is **`false`**. The migration **asks** the catalog (non-unique first, then unique). Job Timeline hops the collection by string `"granot_release_reconciliation_cases"` — **not** this constant. This beat does **not** `syncIndexes`. This beat does **not** delete the default export so “everyone must call the getter.”

There is no open-or-refresh operation. Leftover `createGranotReleaseReconciliation` / `reconcileReleaseCaseAfterDiscrepancy` elect that, and the live processor does not. There is no confirm-cancellation / update / No Action operation. Those leftover Owner commands elect that. There is no official Cancellation write. `CancelledLead` persist lives on those command files.

## Organization

Keep one file. This is the screenplay for “remember one append-only historical Owner Release work case on `granot_release_reconciliation_cases`, allow only open refresh through guarded `$push` and resolve through open plus `case_revision`, and declare the five named indexes with partial unique open `{ normalized_job_no, action_kind }` plus unique sequence — never open or refresh here, never confirm-cancellation / update / no-action here, never mint an official Cancellation, never merge this into the Booking case.” Leftover persist / leftover Owner commands / Owner reads / index apply / migrate already live in deeper **modules**. The outcome / state catalog already lives in leftover later `granotLifecycleSchemas.ts`. Already-recommended Booking case, Record Link, and Decision already live in sibling **modules**. Do not pull those in. Do not invent a `GranotReleaseReconciliationCaseService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a unique `{ normalized_job_no: 1 }` without the open partial so “one Job forever.” Do not invent a write-once-entire-document **adapter** from this rename so “case matches Decision.” Do not invent a leftover `processing.*` **adapter** so “case matches envelope drain.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `open.ts` / `resolve.ts` / `confirm.ts` each get a file.

Do not move `createGranotReleaseReconciliation` / `confirmCancellation` / `updateExistingBooking` into this file so “the row owns leftover persist and confirm.” Do not merge this file into already-recommended `GranotBookingReconciliationCase.ts` so “one schema owns Booking and Release work.” Do not merge this file into already-recommended `GranotRecordLink.ts` so “one schema owns the current Job link and the historical Owner work.” Do not merge this file into leftover later `GranotReleaseDiscrepancy.ts` so “identity conflict is this case.” Do not merge this file into leftover later `BookingLeadReconciliationCase.ts` so “employee pending Leadless is this case.” Do not merge `GRANOT_RELEASE_RECONCILIATION_OUTCOMES` into this file so “the case owns the vocabulary catalog.” Do not add a persisted `mode` so “Release matches Booking.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotReleaseReconciliationCase` | `historicalOwnerReleaseWorkCaseOnTheDefaultConnection` | getter same-db return still imports the default model |
| `getGranotReleaseReconciliationCaseModel` | `historicalOwnerReleaseWorkCaseOnTheSelectedMongoDatabase` | leftover persist / leftover Owner commands / Owner reads / migrate must follow `getMongoDatabaseName()` |
| `GranotReleaseReconciliationCaseDocument` | `HistoricalOwnerReleaseWorkCaseRow` | stored open or resolved historical Release work |
| `GranotReleaseCaseState` | `HistoricalOwnerReleaseWorkCaseState` | `open` \| `resolved` — later leftover persist after resolve is a new sequence, not reopen |
| `GranotReleaseCaseEvidence` | `ImmutableReleaseEvidenceTuple` | Observation + Decision + capture time + `action: "release"`; IDs cannot be rewritten |
| `GranotReleaseCaseNoActionReasonCode` | `NoActionReasonOnTheReleaseCase` | metadata only; No Action creates no official fact |
| `GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION` | `historicalOwnerReleaseWorkCaseCollectionName` | migration opens `granot_release_reconciliation_cases` without registering the model |
| `GRANOT_RELEASE_RECONCILIATION_CASE_MODEL_NAME` | `historicalOwnerReleaseWorkCaseModelName` | getter / default export share `"GranotReleaseReconciliationCase"` |
| `GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES` | `namedHistoricalOwnerReleaseWorkCaseIndexes` | `pnpm migration:granot-lifecycle:indexes` applies the five named keys |

Keep the old names as one-line aliases until leftover persist / migration / getter same-db return migrate. Do not make callers learn `useDb` / `$locals.persisted_evidence_ids` as the domain language. Do **not** delete the default `GranotReleaseReconciliationCase` export so “everyone must call the getter.” Do **not** delete the getter so “case matches Testimonial.” Do **not** re-export `createGranotReleaseReconciliation` / `confirmCancellation` from this file so “the row owns leftover persist and confirm.” Do **not** export a Record-Link-style allowlist Set so “callers learn `$push`.” Do **not** add `deleteOne` refuse from this rename so “case matches Decision.”

**No class for the workflow.** The one type that *does* earn a name is the pending open-case identity contract:

```ts
type HistoricalOwnerReleaseWorkCaseIdentity = {
  collection: "granot_release_reconciliation_cases"
  official_cancellation: false
  action_kind: "release"
  mode: false
  live_processor_opens: false
  new_release_evidence_lands_on: "granot_booking_reconciliation_cases"
  open_job: {
    unique: true
    normalized_job_no_plus_action_kind: true
    partial_state_open: true
  }
  sequence: { unique: true; next_after_resolve: true }
  named_booking: {
    deterministic_booking_id: "required"
    booking_revision_at_open: "required"
  }
  refresh: {
    push_evidence: true
    set_evidence_forbidden: true
    filter_state_open: true
    resolved_immutable: true
  }
}
```

That is the handoff from “this process remembered historical Owner Release work for the Job” to “a second open `{ normalized_job_no, action_kind }` 11000s, mongoose cannot `$set` the evidence array or reopen a resolved row, leftover persist `$push`es a new Observation, and leftover Owner / migrate resolve wins only when `state` is still `open` at the expected `case_revision`.” Do **not** add `{ normalized_job_no: { unique: true, ignore_state: true } }` so “one Job forever.” Do **not** add `{ processing: granotReceiptProcessingSchema }` so “case matches envelope drain.” Do **not** add `{ mode: GRANOT_BOOKING_RECONCILIATION_MODES }` so “Release matches Booking.” Do **not** flip write-once-entire-document from this rename so “case matches Decision.” Do **not** unset `autoIndex` from this rename so “boot matches statement.”

Leave `releaseReconciliation.ts` on that file. Leave `releaseOwnerCommands.ts` on that file. Leave already-recommended `GranotBookingReconciliationCase.ts` on that file. Leave leftover later `granotLifecycleSchemas.ts` on that file. Leave leftover later `GranotReleaseDiscrepancy.ts` on that file. Leave leftover later `BookingLeadReconciliationCase.ts` on that file. Leave index apply on the migration script. Leave the migrate helper on that script.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotReleaseReconciliationCase.ts
// Granot once showed a Release on a Job that already had a Booking —
// or the Owner is about to confirm that Cancellation, replace official
// Booking fields, or mark No Action on a leftover open row.
// Hold one append-only historical Owner Release work case on
// granot_release_reconciliation_cases.
// Partial unique { normalized_job_no, action_kind } while state:"open"
// so a second open insert 11000s and leftover persist retries onto the live row.
// Sequence unique so a resolved case keeps its number
// and later leftover persist opens the next sequence.
// The row must name the deterministic Booking and the Booking revision at open.
// There is no mode. Evidence action is only release.
// After insert mongoose may append evidence on an open row or resolve it.
// A resolved row cannot reopen.
// Existing evidence IDs cannot be rewritten.
// The live processor no longer opens this collection.
// New Release evidence lands on the Booking case.
// This is not a Cancellation.
// If this process selected a different Mongo database,
// hand back that database’s case model.
// Do not open here.
// Do not confirm-cancellation here.
// Do not mint an official Cancellation.

import {
  GRANOT_RECONCILIATION_CASE_STATES,
  GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES,
  GRANOT_RELEASE_RECONCILIATION_OUTCOMES,
} from "./granotLifecycleSchemas"

// ── 1. Hold one append-only historical Owner Release work case ─

export const GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION =
  "granot_release_reconciliation_cases"
export const GRANOT_RELEASE_RECONCILIATION_CASE_MODEL_NAME =
  "GranotReleaseReconciliationCase"

export type GranotReleaseReconciliationCaseDocument = {
  normalized_job_no
  job_no_snapshot
  action_kind                 // always "release"
  sequence_number             // unique with job + kind; next after resolve
  state                       // open | resolved
  case_revision               // Owner draft key; evidence append does not bump it
  evidence_revision           // bumps only when a new Observation is pushed
  source_scope?               // leftover persist may omit
  record_link_id?
  deterministic_booking_id    // required — missing Booking never opens this row
  booking_revision_at_open    // required snapshot; leftover persist does not rewrite it
  evidence                    // { observation_id, decision_id, captured_at, action: "release" }
  observed_context            // display only — never official Cancellation input
  suggested_lead?
  resolution?
  opened_at
  last_evidence_at
}

function rememberTheHistoricalOwnerReleaseWorkCaseShape()
function requireTheNamedBookingAndRevisionAtOpen()
function keepModeOffThisRow()

// ── 2. Allow only open refresh and resolve ────────────────

function rememberImmutableStateAndEvidenceIdsOnInit()
function refuseResolvedMutationAndEvidenceIdRewriteOnValidate()
function refuseUnguardedReplaceRewriteOrReopenOnQuery()
  // filter.state must be "open"
  // $set evidence / $pull / $pop throw
  // $push is how leftover persist appends
  // no deleteOne / deleteMany hook
// .collection.* bypasses these hooks — replica fixtures use that.
// Do not "fix" that from this rename.

// ── 3. Bind the selected Mongo database and declare the five named indexes

export const GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES = [
  { name: "granot_release_case_open_job_kind_unique",
    key: { normalized_job_no: 1, action_kind: 1 }, unique: true,
    partialFilterExpression: { state: "open" } },
  { name: "granot_release_case_job_kind_sequence_unique",
    key: { normalized_job_no: 1, action_kind: 1, sequence_number: 1 }, unique: true },
  { name: "granot_release_case_state_last_evidence",
    key: { state: 1, last_evidence_at: -1 } },
  { name: "granot_release_case_booking_state",
    key: { deterministic_booking_id: 1, state: 1 } },
  { name: "granot_release_case_suggested_lead_state",
    key: { "suggested_lead.lead_ref.model": 1, "suggested_lead.lead_ref.id": 1, state: 1 } },
]

export const GranotReleaseReconciliationCase = /* default connection */
export function getGranotReleaseReconciliationCaseModel()
  // same model when connection.name === getMongoDatabaseName()
  // otherwise useDb + register
```

Read the primary path out loud: *This Job once had Owner Release work — or the Owner is about to confirm-cancellation, update, or mark No Action on a leftover open row. Hold that append-only historical case on `granot_release_reconciliation_cases`. Partial unique on normalized Job plus `action_kind` while open so a second open insert 11000s and leftover persist retries onto the live row. Sequence unique so a resolved case keeps its number and later leftover persist opens the next sequence. The row must name the deterministic Booking and the Booking revision at open. There is no mode. After insert mongoose may `$push` a new Observation on an open row or resolve it at the expected `case_revision`. A resolved row cannot reopen. Existing evidence IDs cannot be rewritten. The live processor no longer opens this collection. New Release evidence lands on the Booking case. This is not a Cancellation. If this process selected another Mongo database, hand back that database’s case model. Do not open here. Do not confirm-cancellation here. Do not mint an official Cancellation.*

That is the operation. `GranotReleaseReconciliationCase.create` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This is historical Owner work. It is not open, confirm-cancellation, or an official Cancellation.** Already-recommended leftover `releaseReconciliation.ts` owns find-open / allocate-sequence / insert / `$push` refresh. The live processor does **not** call it (`maybeReconcileRelease` is removed; unused `reconcileRelease` dep stays on `processor.ts`). Leftover `discrepancyOwnerCommands.ts` still calls `reconcileReleaseCaseAfterDiscrepancy`, which can still insert or `$push`. Leftover `releaseOwnerCommands.ts` owns resolve. `CancelledLead` persist lives on those command files. Do not move those in so “the row owns leftover persist and confirm.” Do not delete leftover persist from this rename so “the Service sentence wins.”

2. **Five named indexes. Booking case has six.** This catalog has no `{ "evidence.observation_id": 1 }`. The Booking-case Service still says “three additional read indexes” while disk has four browse keys. Do not add the evidence-Observation index here from this rename so “Release matches Booking.” Do not drop a Booking-case index from that already-recommended file. Do not rewrite either Service from this models pass.

3. **There is no delete hook.** Decision and the activation clock refuse mongoose `deleteOne`. Replica Release-case fixtures call mongoose `deleteMany` and `.collection.insertOne`. Do not add delete refuse from this rename so “case matches Decision.” Do not treat replica `deleteMany` as a product path.

4. **`resolution.entity_ref.id` is a string. `suggested_lead.lead_ref.id` is an ObjectId.** Leftover Owner resolve stamps `String(entityId)` (Booking id, or Cancellation id when confirming). Do not flip `entity_ref.id` to ObjectId from this rename so “refs match.” Do not flip the suggestion id to string so “the suggestion matches resolution.”

5. **Unique is exact `{ normalized_job_no, action_kind }` while open. Job Timeline hops prefix-equivalent Jobs.** `equivalentNormalizedJobFilter` would treat `P5562366` / `5562366` as one Job on the timeline and emit `cancellation_intake`. This unique would allow both to be open at once. Leftover persist `findOpenCase` uses the exact string. Do not widen the unique onto digit-core from this rename so “the index matches Job Timeline.” Do not drop the prefix filter on the hop so “lookup matches the unique.” Leave both.

6. **`action_kind` is always `"release"`. New Release evidence lands on the Booking case.** Already-recommended Booking case keeps `action_kind: "booked"` even when latest evidence is `release`. Do not add `"booked"` onto this enum from this rename so “one case owns both desks.” Do not merge this file into already-recommended `GranotBookingReconciliationCase.ts` so “one schema owns Booking and Release work.” Do not drop this collection from this rename so “the migrate helper already copied everyone.”

7. **`deterministic_booking_id` and `booking_revision_at_open` are required.** A missing Booking never validates. Leftover classifier sends `release_without_vantage_booking` to leftover later `GranotReleaseDiscrepancy.ts`, not here. Leftover persist refuses a silent retarget when the open row’s Booking id no longer matches. This file does **not** rewrite `booking_revision_at_open` on refresh — leftover persist only bumps `case_revision` when that snapshot or the Record Link changed. Do not make the Booking id optional from this rename so “Release matches Booking.” Do not `$set booking_revision_at_open` from this rename so “the snapshot tracks the live Booking.”

8. **No persisted `mode`.** Projections invent `mode: "release"` at read time. The model test asserts `"mode" in plain === false`. Do not add `GRANOT_BOOKING_RECONCILIATION_MODES` here from this rename so “list filters match Booking.”

9. **Query hooks miss `updateMany` and every delete.** Leftover persist and leftover Owner / migrate resolve use `findOneAndUpdate` / `updateOne` with `state: "open"`. Do not add `updateMany` refuse from this rename so “every mongoose write is hooked” without a caller that needs it.

10. **Wave A persist rec is stale about processor invoke.** [granot-lifecycle-release-reconciliation.md](granot-lifecycle-release-reconciliation.md) still says `processor.ts` (`maybeReconcileRelease` → `createGranotReleaseReconciliation`). Live knowledge and `processor.test.ts` say the opposite. Do not rewrite that Wave A file from this models pass. Do not re-wire processor invoke from this rename so “the old rec wins.”

11. **Leave sibling modules alone.** `createGranotReleaseReconciliation`, `confirmCancellation`, `updateExistingBooking`, `GRANOT_RELEASE_RECONCILIATION_OUTCOMES` are already the right **depth**. This file holds the row.

## Testing

The **interface** is the test surface: `GranotReleaseReconciliationCase` / `getGranotReleaseReconciliationCaseModel` / `GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES` / `GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION`.

Today’s `GranotReleaseReconciliationCase.test.ts` already names part of the operation:

**Hold the historical Owner Release work case**
- Named collection is `granot_release_reconciliation_cases`; model name is `GranotReleaseReconciliationCase`.
- Five named indexes match the catalog; unique open is partial `{ normalized_job_no, action_kind }` where `state: "open"`; sequence unique is `{ normalized_job_no, action_kind, sequence_number }`.
- Defaults: `action_kind: "release"`, `state: "open"`, `case_revision: 1`, `evidence_revision: 1`.
- `deterministic_booking_id` is required; missing Booking refuses validate.
- Evidence tuple is exactly `observation_id` / `decision_id` / `captured_at` / `action`.
- Evidence `action: "booked"` refuses validate.
- Invented `mode` is absent after validate.

**Allow only open refresh and resolve**
- Remembered `resolved` refuses validate (“resolved Release case is immutable”).
- Rewriting a remembered evidence Observation id refuses validate.
- mongoose `updateOne` without `filter.state === "open"` throws “must guard on open state.”
- Replacement (no `$` operators) throws “cannot be replaced directly.”

Add on the same **interface** (do not invent helper-unit tests):

- `$set { evidence: [...] }` / `$pull` / `$pop` throw; `$push` of a new Observation id does not.
- `$set { state: "open" }` throws “cannot return to open.”
- Getter returns the same model name on the selected database.

Do **not** add a test per helper (`rememberTheHistoricalOwnerReleaseWorkCaseShape`, `requireTheNamedBookingAndRevisionAtOpen`, `keepModeOffThisRow`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** move `releaseReconciliation.replica.test.ts` / leftover Confirm / leftover migrate proofs into this file so “the row owns leftover persist and confirm.” `CASE_REVISION_CONFLICT` / `already_satisfied` / official `CancelledLead` persist stay on those command **interfaces**.

Do **not** add a Job Timeline prefix-equivalence test here. `equivalentNormalizedJobFilter` lives on `bookingIdentity.ts` and does not import this file.

## What I would not do

- A `GranotReleaseReconciliationCaseService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `open.ts` / `resolve.ts` / `confirm.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit **seam**. Leftover persist already writes the case and the causal Decision in one transaction; leftover Owner commands already resolve inside the command transaction — do not move those writes into this file so “the row owns leftover persist and confirm.”
- Treating `createGranotReleaseReconciliation` / `confirmCancellation` / `updateExistingBooking` / `noAction` / `reconcileReleaseCaseAfterDiscrepancy` as this story.
- Inventing a leftover `processing.*` **seam** that has only one **adapter**.
- Silently "fixing" the missing Core Collections paragraph / missing delete hooks / string-vs-ObjectId entity refs / prefix-equivalent unique / stale Wave A processor-invoke sentence while recommending a rename.
- Jumping to `validation/` while `models` has unchecked modules.
- Writing a whole-folder recommendation for `models`.
- Merging this file into already-recommended `GranotBookingReconciliationCase.ts` so “one schema owns Booking and Release work.”
- Merging this file into already-recommended `GranotRecordLink.ts` so “one schema owns the current Job link and the historical Owner work.”
- Merging this file into leftover later `GranotReleaseDiscrepancy.ts` so “identity conflict is this case.”
- Merging this file into leftover later `BookingLeadReconciliationCase.ts` so “employee pending Leadless is this case.”
- Merging `GRANOT_RELEASE_RECONCILIATION_OUTCOMES` into this file so “the case owns the vocabulary catalog.”
- Unique-indexing Job Number without the `state:"open"` partial so “resolved history cannot share a Job.”
- Adding `{ "evidence.observation_id": 1 }` so “Release matches Booking.”
- Adding a persisted `mode` so “list filters match Booking.”
- Making `deterministic_booking_id` optional so “Release matches Booking.”
- Dropping this collection so “the migrate helper already copied everyone.”
- Re-wiring processor `reconcileRelease` from this rename so “the stale Wave A rec wins.”
- Treating already-recommended `GranotBookingReconciliationCase.ts` as this story.
- Reopening Wave A to enumerate `connectBookingToLead.ts` from this models pass.
