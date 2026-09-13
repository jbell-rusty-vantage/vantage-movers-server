# Remember One Append-Only Owner Booking Work Case On `granot_booking_reconciliation_cases`, Allow Only Open Refresh Through Guarded `$push` And Resolve Through Open Plus `case_revision`, And Declare The Six Named Indexes With Partial Unique Open `{ normalized_job_no, action_kind }` Plus Unique Sequence — Never Open Or Refresh Here, Never Confirm Update Referral Or No-Action Here, Never Mint An Official Booking, Never Merge This Into The Record Link Or The Release Case — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 25 of this service — `GranotBookingReconciliationCase.ts`
- Remaining in this service: `GranotReleaseReconciliationCase.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotBookingReconciliationCase.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) (persist evidence-backed Owner work for actual Booked **or** Release; a case is **not** a Booking; automatic open/refresh is `maybeReconcileBooking`; later evidence on a resolved row starts the next sequence; Booking Priority Pairing is an audit snapshot, not a trigger; Referral create has no Source Scope or Lead suggestion — **this file never opens**, never confirms). Compatibility rule: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) (`granot_booking_reconciliation_cases`; append-only Owner work for Priority `5` / Booked evidence, including `create_referral_booking` without Source Scope; unique open `{normalized_job_no, action_kind}` partial on `state:"open"` plus `{normalized_job_no, action_kind, sequence_number}`; it is not a Booking). Related processor: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) (live Booking evidence may enter only the separately gated case module after activation — **this file never plans**). Related already-recommended persist / Confirm / Owner commands / Referral: [granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md) / [granot-lifecycle-booking-confirmation.md](granot-lifecycle-booking-confirmation.md) / [granot-lifecycle-booking-owner-commands.md](granot-lifecycle-booking-owner-commands.md) / [granot-lifecycle-referral-booking.md](granot-lifecycle-referral-booking.md) (`insertCase` / `refreshCase` / `updateOne` resolve — **this file never elects those**). Related already-recommended Record Link: [models-granot-record-link.md](models-granot-record-link.md) (collection `granot_record_links`; unique partial `{ provider, normalized_job_no }` where `state:"active"`; mongoose refresh allowlist; `booking_ref` command-owned — **do not copy that unique or that allowlist onto this case**). Related already-recommended Decision: [models-synchronization-decision.md](models-synchronization-decision.md) (write-once entire document including mongoose delete refuse — **do not copy those delete hooks onto this case**). Related leftover next Release case: leftover next `GranotReleaseReconciliationCase.ts` (`action_kind: "release"`; processor no longer opens it; new Release evidence lands here — **this file is the Booking intake case**, not the historical Release row). Related leftover later employee case: leftover later `BookingLeadReconciliationCase.ts` (employee pending Leadless — **do not merge**). Related channel catalog: leftover later `granotLifecycleSchemas.ts` (`GRANOT_BOOKING_RECONCILIATION_MODES` / `GRANOT_BOOKING_RECONCILIATION_OUTCOMES` / `GRANOT_RECONCILIATION_CASE_STATES` / `GRANOT_RECONCILIATION_EVIDENCE_ACTIONS` — **do not merge that catalog into this file**). Distinct from leftover Job Timeline hop: already-recommended [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (`db.collection("granot_booking_reconciliation_cases")` by prefix-equivalent Job — **this file never hops**). Leftover overview / leftover Registry / leftover historical-consolidation **do not** ask this collection as a catalog row. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Granot Booking Reconciliation Case](../../../../CONTEXT.md); this checkout does **not** define it — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model vs named-index catalog vs mongoose open-guard hooks vs persist `$push` vs Owner resolve `updateOne` vs raw-collection hop.** Already-recommended `bookingReconciliation.ts` **asks** `getGranotBookingReconciliationCaseModel()` `findOne({ normalized_job_no, action_kind: "booked", state: "open" })` then `create([row], { session })` or `findOneAndUpdate` with `$push` evidence, `$inc evidence_revision` (and `case_revision` only when suggestion/current-work changed), filter `{ state: "open", "evidence.observation_id": { $ne } }` — exact Observation replay returns the open row unchanged. Already-recommended `bookingConfirmation.ts` / `bookingOwnerCommands.ts` / `referralBooking.ts` **ask** the getter `findById` then mongoose `updateOne({ _id, state: "open", case_revision })` to resolve. Already-recommended `projections.ts` / `creatingObservation.ts` / `liveReceipts.ts` / `receiptSearch.ts` **ask** the getter `find` / `findById` / aggregate open-by-mode. `scripts/migrations/granot-lifecycle-indexes.ts` **asks** `GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES` + `GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION`. Already-recommended `jobNumberTimeline/mongo-evidence-loader.ts` hops `db.collection("granot_booking_reconciliation_cases")` by prefix-equivalent Job — **it does not import this file**. `GranotBookingReconciliationCase.test.ts` **asks** the six named indexes / defaults (`action_kind: "booked"`, `state: "open"`, revisions `1`) / resolved immutable validate / evidence-ID rewrite refuse. Replica fixtures use `.collection.insertOne` / mongoose `deleteMany` (hooks do not run on `.collection.*`; mongoose `deleteMany` is **not** hooked). Not this **interface**: `maybeReconcileBooking` itself, `confirmGranotBooking` itself, `createReferralBooking` itself, `resolveGranotBookingCaseNoAction` itself, `selectBookingIntakeLatestAction` itself, `createJobNumberTimelineModule({ loader }).read` itself.
- Seams callers need: default `GranotBookingReconciliationCase` (first-registered connection — getter same-db return) vs `getGranotBookingReconciliationCaseModel()` (selected `getMongoDatabaseName()`); mongoose `create` / `findOneAndUpdate` / `updateOne` (hooks run — open-state guard, no `$set evidence`) vs `.collection.insertOne` / `.collection.deleteMany` (hooks **do not** run — replica fixtures); unique partial `{ normalized_job_no, action_kind }` where `state:"open"` vs unique `{ normalized_job_no, action_kind, sequence_number }` vs already-recommended Record Link unique partial `{ provider, normalized_job_no }` where `state:"active"`; `$push` append vs `$set evidence` / `$pull` / `$pop` refuse; Owner resolve CAS `{ state: "open", case_revision }` vs persist filter `{ state: "open", "evidence.observation_id": { $ne } }`; `timestamps: true` vs Record Link / Decision `timestamps: false`; `autoIndex: false`; `action_kind` always `"booked"` vs leftover next Release case `"release"`; Referral may omit `source_scope` and `suggested_lead`; `GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION` `"granot_booking_reconciliation_cases"` vs Job Timeline hardcoded same string. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no authorization **seam**. There is no official Booking **seam**. There is no Record Link **seam**.
- Split later (only if the file outgrows one sitting): this ~360-line file is one sitting if you read it as remember one append-only Owner Booking work case on `granot_booking_reconciliation_cases`, allow only open refresh through guarded `$push` and resolve through open plus `case_revision`, and declare the six named indexes with partial unique open `{ normalized_job_no, action_kind }` plus unique sequence — never open or refresh here, never confirm / update / referral / no-action here, never mint an official Booking, never merge this into the Record Link or the Release case. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `open.ts` / `resolve.ts` / `confirm.ts`. Open / refresh stay already-recommended `bookingReconciliation.ts`. Confirm / update / no-action / Confirm Granot Cancellation stay already-recommended `bookingConfirmation.ts` / `bookingOwnerCommands.ts`. Referral stays already-recommended `referralBooking.ts`. Channel catalog stays leftover later `granotLifecycleSchemas.ts`. Next Release case stays leftover `GranotReleaseReconciliationCase.ts`. Job Timeline hop stays leftover `mongo-evidence-loader.ts`.

`GranotBookingReconciliationCase` is a Mongoose model name. The owner question is: *Granot just showed an actual Booked or Release on this Job — or the Owner is about to confirm a Booking, write a Referral, update the official row, confirm the Cancellation, or mark No Action. Hold one append-only Owner Booking work case on `granot_booking_reconciliation_cases`. Partial unique `{ normalized_job_no, action_kind }` while `state:"open"` so a second open insert 11000s and persist retries onto the live row. Sequence unique so a resolved case keeps its number and later evidence opens the next sequence. After insert mongoose may append evidence on an open row or resolve it; a resolved row cannot reopen, and existing evidence IDs cannot be rewritten. This is not a Booking. If this process selected a different Mongo database, hand back that database’s case model. Do not open here. Do not confirm here. Do not mint an official Booking. Do not merge this into the Record Link or the leftover Release case.*

Who opens / refreshes already lives in `bookingReconciliation.ts`. Who confirms / updates / marks No Action / confirms Cancellation already lives in `bookingConfirmation.ts` / `bookingOwnerCommands.ts`. Who writes a Referral already lives in `referralBooking.ts`. Who holds the mode / outcome / evidence-action catalog already lives in leftover later `granotLifecycleSchemas.ts`. Who holds leftover next historical Release work already lives in leftover next `GranotReleaseReconciliationCase.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember one append-only Owner Booking work case, allow only open refresh through guarded `$push` and resolve through open plus `case_revision`, and declare the six named indexes with partial unique open `{ normalized_job_no, action_kind }` plus unique sequence” story, not “a booking-case model CRUD dump,” and not Open The Case / Confirm The Booking / Create The Referral themselves:

1. **Hold one append-only Owner Booking work case** — collection `granot_booking_reconciliation_cases` (`GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION`), `timestamps: true`, `strict: true`, `autoIndex: false`. **No** `optimisticConcurrency`. **No** `sheet_sync[]`. **No** `source_company`. **No** `processing`. **No** official Booking fields (Book Date, Binder, Deposit, Merchant, agents). Declares required `normalized_job_no` / `job_no_snapshot` (trim), required `action_kind` enum `["booked"]` default `"booked"` (Release evidence still lands here; the leftover Release case is a different collection), required `sequence_number` integer `min: 1`, required `mode` enum `GRANOT_BOOKING_RECONCILIATION_MODES` (`create_missing_booking` | `review_existing_booking` | `create_referral_booking`), required `state` enum `open` | `resolved` default `"open"`, required `case_revision` / `evidence_revision` integer `min: 1` default `1`, optional `source_scope` (crm source + company + granularity — Referral may omit it), optional `record_link_id` / `deterministic_booking_id`, required `evidence[]` of `{ observation_id, decision_id, captured_at, action }` where `action` enum `priority_5` | `booked` | `release` (new persist never elects `priority_5`; historical rows still have it), required `observed_context` (bounded display — contact / move / estimate / Priority / username; never official input), optional `suggested_lead` (Form or Call + `high` | `medium` + match method; Referral / ambiguous omit it), optional `resolution` (`outcome` enum `GRANOT_BOOKING_RECONCILIATION_OUTCOMES`, `command_execution_id`, `actor`, optional no-action reason, `resolved_at`, optional `entity_ref`), required `opened_at` / `last_evidence_at`, optional `resolved_at`, optional `priority_pairing` (Booked-only audit snapshot; Release persist omits it and does not wipe an existing one). Nested refs set `{ _id: false }`. `resolution.entity_ref.id` is a **string**. `suggested_lead.lead_ref.id` is an **ObjectId**. This beat does **not** choose create-missing versus review versus Referral. This beat does **not** mint a `BookedLead`. This beat does **not** hide a resolved row from Job Timeline.

2. **Allow only open refresh and resolve; refuse rewrite, replace, and reopen** — `post("init")` remembers `persisted_state` and the stored evidence Observation ids. `pre("validate")` on a loaded document: if not new and remembered state is `resolved`, throw “A resolved case is immutable”; if any remembered evidence id is missing from the current array, throw “Existing case evidence IDs are immutable” (append is allowed). Query hooks on `updateOne` / `findOneAndUpdate` / `replaceOne`: replacement (no `$` operators) throws “cannot be replaced directly”; `filter.state` must be `"open"` or throw “updates must guard on open state”; `$set.state === "open"` throws “cannot return to open”; `$set evidence` / `$pull` / `$pop` throw “evidence IDs are immutable.” `$push` is **not** forbidden — persist refresh uses it. There is **no** exported allowlist assert. There is **no** `deleteOne` / `deleteMany` / `updateMany` hook. `.collection.insertOne` / `.collection.deleteMany` **bypass** these hooks. This beat does **not** throw `CASE_REVISION_CONFLICT`. This beat does **not** allocate `sequence_number`.

3. **Bind the selected Mongo database and declare the six named indexes** — default export `GranotBookingReconciliationCase` is `mongoose.models[...] ?? mongoose.model(...)`. `getGranotBookingReconciliationCaseModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb` + register. `GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES` is six named keys: unique partial `{ normalized_job_no: 1, action_kind: 1 }` where `state: "open"` (`granot_booking_case_open_job_kind_unique`); unique `{ normalized_job_no: 1, action_kind: 1, sequence_number: 1 }`; non-unique `{ state, last_evidence_at: -1 }`; `{ deterministic_booking_id, state }`; `{ "suggested_lead.lead_ref.model", "suggested_lead.lead_ref.id", state }`; `{ "evidence.observation_id": 1 }`. Knowledge still says “three additional read indexes” and omits the evidence-Observation key — **do not drop that fourth browse index from this rename so “the catalog matches the Service sentence.”** The schema loops that catalog onto `Schema.index`. `autoIndex` is **`false`**. The migration **asks** the catalog (non-unique first, then unique). Job Timeline hops the collection by string `"granot_booking_reconciliation_cases"` — **not** this constant. This beat does **not** `syncIndexes`. This beat does **not** delete the default export so “everyone must call the getter.”

There is no open-or-refresh operation. `maybeReconcileBooking` / `reconcileBookingCaseAfterDiscrepancy` elect that. There is no confirm / update / Referral / No Action / Confirm Granot Cancellation operation. Those Owner commands elect that. There is no official Booking write. `BookedLead` persist lives on those command files.

## Organization

Keep one file. This is the screenplay for “remember one append-only Owner Booking work case on `granot_booking_reconciliation_cases`, allow only open refresh through guarded `$push` and resolve through open plus `case_revision`, and declare the six named indexes with partial unique open `{ normalized_job_no, action_kind }` plus unique sequence — never open or refresh here, never confirm / update / referral / no-action here, never mint an official Booking, never merge this into the Record Link or the Release case.” Persist / Confirm / Owner commands / Referral / Owner reads / index apply already live in deeper **modules**. The mode / outcome / evidence-action catalog already lives in leftover later `granotLifecycleSchemas.ts`. Already-recommended Record Link and Decision already live in sibling **modules**. Leftover next Release case already lives in a sibling **module**. Do not pull those in. Do not invent a `GranotBookingReconciliationCaseService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a unique `{ normalized_job_no: 1 }` without the open partial so “one Job forever.” Do not invent a write-once-entire-document **adapter** from this rename so “case matches Decision.” Do not invent a leftover `processing.*` **adapter** so “case matches envelope drain.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `open.ts` / `resolve.ts` / `confirm.ts` each get a file.

Do not move `maybeReconcileBooking` / `confirmGranotBooking` / `createReferralBooking` into this file so “the row owns intake and confirm.” Do not merge this file into already-recommended `GranotRecordLink.ts` so “one schema owns the current Job link and the Owner work.” Do not merge this file into leftover next `GranotReleaseReconciliationCase.ts` so “one schema owns Booking and Release work.” Do not merge this file into leftover later `BookingLeadReconciliationCase.ts` so “employee pending Leadless is this case.” Do not merge `GRANOT_BOOKING_RECONCILIATION_MODES` into this file so “the case owns the vocabulary catalog.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotBookingReconciliationCase` | `ownerBookingWorkCaseOnTheDefaultConnection` | getter same-db return still imports the default model |
| `getGranotBookingReconciliationCaseModel` | `ownerBookingWorkCaseOnTheSelectedMongoDatabase` | persist / Confirm / Owner commands / Owner reads must follow `getMongoDatabaseName()` |
| `GranotBookingReconciliationCaseDocument` | `OwnerBookingWorkCaseRow` | stored open or resolved Booking intake case |
| `GranotBookingCaseState` | `OwnerBookingWorkCaseState` | `open` \| `resolved` — later evidence after resolve is a new sequence, not reopen |
| `GranotBookingCaseEvidence` | `ImmutableCaseEvidenceTuple` | Observation + Decision + capture time + action; IDs cannot be rewritten |
| `GranotBookingCaseEvidenceAction` | `StoredBookingIntakeAction` | `priority_5` \| `booked` \| `release` — new persist elects only Booked or Release |
| `GranotBookingCaseNoActionReasonCode` | `NoActionReasonOnTheCase` | metadata only; No Action creates no official fact |
| `GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION` | `ownerBookingWorkCaseCollectionName` | migration opens `granot_booking_reconciliation_cases` without registering the model |
| `GRANOT_BOOKING_RECONCILIATION_CASE_MODEL_NAME` | `ownerBookingWorkCaseModelName` | getter / default export share `"GranotBookingReconciliationCase"` |
| `GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES` | `namedOwnerBookingWorkCaseIndexes` | `pnpm migration:granot-lifecycle:indexes` applies the six named keys |

Keep the old names as one-line aliases until persist / migration / getter same-db return migrate. Do not make callers learn `useDb` / `$locals.persisted_evidence_ids` as the domain language. Do **not** delete the default `GranotBookingReconciliationCase` export so “everyone must call the getter.” Do **not** delete the getter so “case matches Testimonial.” Do **not** re-export `maybeReconcileBooking` / `confirmGranotBooking` from this file so “the row owns intake and confirm.” Do **not** export a Record-Link-style allowlist Set so “callers learn `$push`.” Do **not** add `deleteOne` refuse from this rename so “case matches Decision.”

**No class for the workflow.** The one type that *does* earn a name is the pending open-case identity contract:

```ts
type OwnerBookingWorkCaseIdentity = {
  collection: "granot_booking_reconciliation_cases"
  official_booking: false
  action_kind: "booked"
  open_job: {
    unique: true
    normalized_job_no_plus_action_kind: true
    partial_state_open: true
  }
  sequence: { unique: true; next_after_resolve: true }
  refresh: {
    push_evidence: true
    set_evidence_forbidden: true
    filter_state_open: true
    resolved_immutable: true
  }
  referral: { source_scope_optional: true; suggested_lead_optional: true }
}
```

That is the handoff from “this process remembered Owner work for the Job” to “a second open `{ normalized_job_no, action_kind }` 11000s, mongoose cannot `$set` the evidence array or reopen a resolved row, persist `$push`es a new Observation, and Owner resolve wins only when `state` is still `open` at the expected `case_revision`.” Do **not** add `{ normalized_job_no: { unique: true, ignore_state: true } }` so “one Job forever.” Do **not** add `{ processing: granotReceiptProcessingSchema }` so “case matches envelope drain.” Do **not** flip write-once-entire-document from this rename so “case matches Decision.” Do **not** unset `autoIndex` from this rename so “boot matches statement.”

Leave `bookingReconciliation.ts` on that file. Leave `bookingConfirmation.ts` / `bookingOwnerCommands.ts` / `referralBooking.ts` on those files. Leave already-recommended `GranotRecordLink.ts` on that file. Leave leftover later `granotLifecycleSchemas.ts` on that file. Leave leftover next `GranotReleaseReconciliationCase.ts` on that file. Leave leftover later `BookingLeadReconciliationCase.ts` on that file. Leave index apply on the migration script.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotBookingReconciliationCase.ts
// Granot just showed an actual Booked or Release on this Job —
// or the Owner is about to confirm a Booking, write a Referral,
// update the official row, confirm the Cancellation, or mark No Action.
// Hold one append-only Owner Booking work case on
// granot_booking_reconciliation_cases.
// Partial unique { normalized_job_no, action_kind } while state:"open"
// so a second open insert 11000s and persist retries onto the live row.
// Sequence unique so a resolved case keeps its number
// and later evidence opens the next sequence.
// After insert mongoose may append evidence on an open row or resolve it.
// A resolved row cannot reopen.
// Existing evidence IDs cannot be rewritten.
// This is not a Booking.
// If this process selected a different Mongo database,
// hand back that database’s case model.
// Do not open here.
// Do not confirm here.
// Do not mint an official Booking.

import {
  GRANOT_BOOKING_RECONCILIATION_MODES,
  GRANOT_BOOKING_RECONCILIATION_OUTCOMES,
  GRANOT_RECONCILIATION_CASE_STATES,
  GRANOT_RECONCILIATION_EVIDENCE_ACTIONS,
} from "./granotLifecycleSchemas"

// ── 1. Hold one append-only Owner Booking work case ───────

export const GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION =
  "granot_booking_reconciliation_cases"
export const GRANOT_BOOKING_RECONCILIATION_CASE_MODEL_NAME =
  "GranotBookingReconciliationCase"

export type GranotBookingReconciliationCaseDocument = {
  normalized_job_no
  job_no_snapshot
  action_kind                 // always "booked" — Release evidence still lands here
  sequence_number             // unique with job + kind; next after resolve
  mode                        // create_missing | review_existing | create_referral
  state                       // open | resolved
  case_revision               // Owner draft key; evidence append does not bump it
  evidence_revision           // bumps only when a new Observation is pushed
  source_scope?               // Referral may omit
  record_link_id?
  deterministic_booking_id?
  evidence                    // { observation_id, decision_id, captured_at, action }
  observed_context            // display only — never official Booking input
  suggested_lead?             // Referral / ambiguous omit
  resolution?
  opened_at
  last_evidence_at
  priority_pairing?           // Booked-only audit snapshot
}

function rememberTheOwnerBookingWorkCaseShape()
function keepReferralFreeOfSourceScopeAndSuggestion()

// ── 2. Allow only open refresh and resolve ────────────────

function rememberImmutableStateAndEvidenceIdsOnInit()
function refuseResolvedMutationAndEvidenceIdRewriteOnValidate()
function refuseUnguardedReplaceRewriteOrReopenOnQuery()
  // filter.state must be "open"
  // $set evidence / $pull / $pop throw
  // $push is how persist appends
  // no deleteOne / deleteMany hook
// .collection.* bypasses these hooks — replica fixtures use that.
// Do not "fix" that from this rename.

// ── 3. Bind the selected Mongo database and declare the six named indexes

export const GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES = [
  { name: "granot_booking_case_open_job_kind_unique",
    key: { normalized_job_no: 1, action_kind: 1 }, unique: true,
    partialFilterExpression: { state: "open" } },
  { name: "granot_booking_case_job_kind_sequence_unique",
    key: { normalized_job_no: 1, action_kind: 1, sequence_number: 1 }, unique: true },
  { name: "granot_booking_case_state_last_evidence",
    key: { state: 1, last_evidence_at: -1 } },
  { name: "granot_booking_case_booking_state",
    key: { deterministic_booking_id: 1, state: 1 } },
  { name: "granot_booking_case_suggested_lead_state",
    key: { "suggested_lead.lead_ref.model": 1, "suggested_lead.lead_ref.id": 1, state: 1 } },
  { name: "granot_booking_case_evidence_observation_id",
    key: { "evidence.observation_id": 1 } },
]

export const GranotBookingReconciliationCase = /* default connection */
export function getGranotBookingReconciliationCaseModel()
  // same model when connection.name === getMongoDatabaseName()
  // otherwise useDb + register
```

Read the primary path out loud: *This Job now has Owner Booking work — or the Owner is about to confirm, refer, update, cancel, or mark No Action. Hold that append-only case on `granot_booking_reconciliation_cases`. Partial unique on normalized Job plus `action_kind` while open so a second open insert 11000s and persist retries onto the live row. Sequence unique so a resolved case keeps its number and later evidence opens the next sequence. After insert mongoose may `$push` a new Observation on an open row or resolve it at the expected `case_revision`. A resolved row cannot reopen. Existing evidence IDs cannot be rewritten. This is not a Booking. If this process selected another Mongo database, hand back that database’s case model. Do not open here. Do not confirm here. Do not mint an official Booking.*

That is the operation. `GranotBookingReconciliationCase.create` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This is Owner work. It is not open, confirm, or an official Booking.** Already-recommended `bookingReconciliation.ts` owns find-open / allocate-sequence / insert / `$push` refresh. `bookingConfirmation.ts` / `bookingOwnerCommands.ts` / `referralBooking.ts` own resolve. `BookedLead` persist lives on those command files. Do not move those in so “the row owns intake and confirm.”

2. **Knowledge says three additional read indexes. Disk has four.** The catalog includes `{ "evidence.observation_id": 1 }` (`granot_booking_case_evidence_observation_id`). The Service sentence lists only state/evidence-time, Booking/state, and suggested Lead/state. The model test (`[AC-20]`) asserts all six named keys. Do not drop the evidence-Observation index from this rename so “the catalog matches the Service sentence.” Do not rewrite the Service from this models pass.

3. **There is no delete hook.** Decision and the activation clock refuse mongoose `deleteOne`. Replica Booking-case fixtures call mongoose `deleteMany` and `.collection.insertOne`. Do not add delete refuse from this rename so “case matches Decision.” Do not treat replica `deleteMany` as a product path.

4. **`resolution.entity_ref.id` is a string. `suggested_lead.lead_ref.id` is an ObjectId.** Owner resolve stamps `String(booking_id)`. Do not flip `entity_ref.id` to ObjectId from this rename so “refs match.” Do not flip the suggestion id to string so “the suggestion matches resolution.”

5. **Unique is exact `{ normalized_job_no, action_kind }` while open. Job Timeline hops prefix-equivalent Jobs.** `equivalentNormalizedJobFilter` would treat `P5562366` / `5562366` as one Job on the timeline. This unique would allow both to be open at once. Persist `findOpenCase` uses the exact string. Do not widen the unique onto digit-core from this rename so “the index matches Job Timeline.” Do not drop the prefix filter on the hop so “lookup matches the unique.” Leave both.

6. **`action_kind` is always `"booked"` even when latest evidence is `release`.** New Release evidence lands on this case. The leftover Release case is a different collection with `action_kind: "release"`. Do not add `"release"` onto this enum from this rename so “Release evidence owns a Release case.” Do not merge leftover next `GranotReleaseReconciliationCase.ts` into this file so “one schema owns both desks.”

7. **Query hooks miss `updateMany` and every delete.** Persist and Owner resolve use `findOneAndUpdate` / `updateOne` with `state: "open"`. Do not add `updateMany` refuse from this rename so “every mongoose write is hooked” without a caller that needs it.

8. **Leave sibling modules alone.** `maybeReconcileBooking`, `confirmGranotBooking`, `createReferralBooking`, `selectBookingIntakeLatestAction`, `GRANOT_BOOKING_RECONCILIATION_MODES` are already the right **depth**. This file holds the row.

## Testing

The **interface** is the test surface: `GranotBookingReconciliationCase` / `getGranotBookingReconciliationCaseModel` / `GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES` / `GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION`.

Today’s `GranotBookingReconciliationCase.test.ts` already names part of the operation:

**Hold the Owner Booking work case**
- Named collection is `granot_booking_reconciliation_cases`; model name is `GranotBookingReconciliationCase`.
- Six named indexes match the catalog; unique open is partial `{ normalized_job_no, action_kind }` where `state: "open"`; sequence unique is `{ normalized_job_no, action_kind, sequence_number }`.
- Defaults: `action_kind: "booked"`, `state: "open"`, `case_revision: 1`, `evidence_revision: 1`.
- Evidence tuple is exactly `observation_id` / `decision_id` / `captured_at` / `action`.
- Invented `mode` refuses validate.

**Allow only open refresh and resolve**
- Remembered `resolved` refuses validate (“resolved case is immutable”).
- Rewriting a remembered evidence Observation id refuses validate.

Add on the same **interface** (do not invent helper-unit tests):

- mongoose `findOneAndUpdate` / `updateOne` without `filter.state === "open"` throws “must guard on open state.”
- `$set { evidence: [...] }` / `$pull` / `$pop` throw; `$push` of a new Observation id does not.
- `$set { state: "open" }` throws “cannot return to open.”
- Replacement (no `$` operators) throws “cannot be replaced directly.”
- Getter returns the same model name on the selected database.

Do **not** add a test per helper (`rememberTheOwnerBookingWorkCaseShape`, `keepReferralFreeOfSourceScopeAndSuggestion`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** move `bookingReconciliation.replica.test.ts` / Confirm / Referral replica proofs into this file so “the row owns open and confirm.” `CASE_REVISION_CONFLICT` / `already_satisfied` / official `BookedLead` persist stay on those command **interfaces**.

Do **not** add a Job Timeline prefix-equivalence test here. `equivalentNormalizedJobFilter` lives on `bookingIdentity.ts` and does not import this file.

## What I would not do

- A `GranotBookingReconciliationCaseService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `open.ts` / `resolve.ts` / `confirm.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit **seam**. Persist already writes the case and the causal Decision in one transaction; Owner commands already resolve inside the command transaction — do not move those writes into this file so “the row owns intake and confirm.”
- Treating `maybeReconcileBooking` / `confirmGranotBooking` / `createReferralBooking` / `resolveGranotBookingCaseNoAction` as this story.
- Inventing a leftover `processing.*` **seam** that has only one **adapter**.
- Silently "fixing" the Service’s “three additional indexes” sentence / missing delete hooks / string-vs-ObjectId entity refs / prefix-equivalent unique while recommending a rename.
- Jumping to `validation/` while `models` has unchecked modules.
- Writing a whole-folder recommendation for `models`.
- Merging this file into already-recommended `GranotRecordLink.ts` so “one schema owns the current Job link and the Owner work.”
- Merging this file into leftover next `GranotReleaseReconciliationCase.ts` so “one schema owns Booking and Release work.”
- Merging this file into leftover later `BookingLeadReconciliationCase.ts` so “employee pending Leadless is this case.”
- Merging `GRANOT_BOOKING_RECONCILIATION_MODES` into this file so “the case owns the vocabulary catalog.”
- Unique-indexing Job Number without the `state:"open"` partial so “resolved history cannot share a Job.”
- Unique-indexing `evidence.observation_id` so “one Observation may never appear on two sequences.”
- Adding `"release"` onto `action_kind` so “Release evidence owns a Release case.”
- Treating leftover next `GranotReleaseReconciliationCase.ts` as this story.
- Reopening Wave A to enumerate `connectBookingToLead.ts` from this models pass.
