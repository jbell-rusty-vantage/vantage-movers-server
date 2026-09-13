# Remember The Current Job-Level Granot Record Link On `granot_record_links`, Allow Only Refresh / Dispute / Supersede Through The Named Allowlist, And Declare The Three Named Indexes With Partial Unique `{ provider, normalized_job_no }` Where `state:"active"` — Never Establish Or Attach Here, Never Stamp `booking_ref` Through Mongoose, Never Correct A Disputed Link Here, Never Unique Job Number Without The Active Partial, Never Merge This Into The Decision Or The Clock — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 24 of this service — `GranotRecordLink.ts`
- Remaining in this service: `GranotBookingReconciliationCase.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotRecordLink.ts`
- Knowledge: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) (`granot_record_links`; current job-level link aggregate; unique partial `{ provider, normalized_job_no }` where `state:"active"`; historical shadow may create a lead-less job-level row; authorized create/sync/confirm may attach `lead_ref`, `source_scope`, and later `booking_ref`). Related processor: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) (historical shadow may establish or confirm a **job-level** link when Job/scope agree; it does not add `lead_ref`, `booking_ref`, source scope, or disputed state; live matched-Lead writes enter `synchronizeLeadFromGranot`; live create-if-missing enters `createLeadFromGranot`; a pre-existing lead-less active reservation becomes `conflict` / `record_link_conflict` — **this file never plans**, never persists a Decision). Related identity: [`docs/knowledge/granot-lifecycle/identity.md`](../../../docs/knowledge/granot-lifecycle/identity.md) (first ladder rung is the active Record Link; a job-only link is evidence and the ladder continues; a link with `lead_ref` is a target only when model, existence, restrictions, Job, and Source Scope agree; prefix-equivalent Jobs are the same Job on identity lookup — **this file never matches**). Related Booking / Referral / Connect: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) / [`docs/knowledge/services/bookings.md`](../../../docs/knowledge/services/bookings.md) (Confirm / Referral / Leadless persist a booking-only or attached link; Connect Booking to Lead updates an existing link and does not mint a new one — **this file never confirms a Booking**). Related Owner correction: [`docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md`](../../../docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md) (`correctGranotRecordLink` supersedes the old active disputed row and inserts a replacement — **this file never corrects**). Related health / Lead timeline: [`docs/knowledge/granot-lifecycle/projections.md`](../../../docs/knowledge/granot-lifecycle/projections.md) / [`docs/knowledge/granot-lifecycle/observability.md`](../../../docs/knowledge/granot-lifecycle/observability.md) (health counts `record_links: { active, disputed }`; Lead timeline follows persisted links — **this file never projects**). Related already-recommended Decision: [models-synchronization-decision.md](models-synchronization-decision.md) (collection `synchronization_decisions`; unique `{ observation_id, attempt }`; write-once entire document — **do not copy that unique or that write-once onto this row**; processor `persistDecisionAndLink` 11000 is this link unique, not the Decision unique). Related already-recommended clock: [models-granot-lifecycle-activation.md](models-granot-lifecycle-activation.md) (collection `granot_lifecycle_activations`; unique `{ key: 1 }`; write-once including delete — **do not copy that unique or those delete hooks onto this row**). Related already-recommended statement: [models-granot-observation.md](models-granot-observation.md) (collection `granot_observations`; unique `receipt_id` — **do not unique Job Number from this file**). Related sync / create / discrepancy: already-recommended [granot-lifecycle-synchronize-lead-from-granot.md](granot-lifecycle-synchronize-lead-from-granot.md) / [granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md) / [granot-lifecycle-discrepancy-owner-commands.md](granot-lifecycle-discrepancy-owner-commands.md) (`establish` / `attach` / `confirm` / `reserveRecordLink` / `correctGranotRecordLink` — **this file never elects those**). Related channel catalog: leftover later `granotLifecycleSchemas.ts` (`RECORD_LINK_STATES` / `GRANOT_LEAD_MODELS` — **do not merge that catalog into this file**). Related leftover next Booking case: leftover next `GranotBookingReconciliationCase.ts` (append-only Owner work — **this file is the current job link**, not the case). Distinct from leftover Job Timeline hop: already-recommended [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (`db.collection("granot_record_links")` by prefix-equivalent Job — **this file never hops**). Leftover overview / leftover Registry / leftover historical-consolidation **do not** ask this collection as a catalog row. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Granot Record Link](../../../../CONTEXT.md); this checkout does **not** define it — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model vs named-index catalog vs mongoose refresh-allowlist vs command-owned `.collection.updateOne` for `booking_ref` vs raw-collection hop.** Already-recommended `processor.ts` **asks** `getGranotRecordLinkModel()` `findOne({ provider, normalized_job_no, state: "active" })` then `create([link])` (historical job-level, no `lead_ref`) or `updateOne` refresh of `last_observation_*` plus `$inc domain_revision`. Already-recommended `synchronizeLeadFromGranot.ts` **asks** the getter `create` (establish with `lead_ref`) / mongoose `updateOne` (attach `lead_ref` / confirm `last_observation_*` / dispute). Already-recommended `createLeadFromGranot.ts` **asks** the getter `findOne` then `create` only — an existing active row is `link_duplicate`, never attach. `bookingConfirmation.ts` / `referralBooking.ts` / `connectBookingToLead.ts` **ask** mongoose `create` when minting, then **stamp `booking_ref` through `Link.collection.updateOne`** (hooks do not run; comment: ordinary model updates intentionally forbid `booking_ref`). Already-recommended `discrepancyOwnerCommands.ts` **asks** mongoose `updateOne` `{ state: "superseded", superseded_by }` then `create` the replacement (may copy `booking_ref` on insert). Already-recommended `identity.ts` **asks** the getter `findOne` with `equivalentNormalizedJobFilter` (prefix-equivalent Jobs). `projections.ts` **asks** the getter `find` / `findById` / `countDocuments({ state: "active" })` / `countDocuments({ state: "active", disputed: true })`. `bookingReconciliation.ts` / `bookingOwnerCommands.ts` **ask** the getter `findOne` / `findById`. `domainCommands/entityChange.ts` **asks** the getter then `.collection.updateOne` to stamp `last_change_id` / `last_changed_at` / `domain_revision` (hooks do not run). `scripts/migrations/granot-lifecycle-indexes.ts` **asks** `GRANOT_RECORD_LINK_INDEXES` + `GRANOT_RECORD_LINK_COLLECTION`. Already-recommended `jobNumberTimeline/mongo-evidence-loader.ts` hops `db.collection("granot_record_links")` by prefix-equivalent Job — **it does not import this file**. `GranotRecordLink.test.ts` **asks** named indexes / snapshot normalize / disputed stays `active` / allowlist refresh / atomic supersede / `booking_ref` refuse / `$setOnInsert` refuse / replace and delete refuse. Replica fixtures use `.collection.insertOne` / `.collection.deleteMany` (hooks do not run). Not this **interface**: `synchronizeLeadFromGranot` itself, `reserveRecordLink` itself, `correctGranotRecordLink` itself, `findActiveRecordLink` itself, `persistDecisionAndLink` itself, `createJobNumberTimelineModule({ loader }).read` itself.
- Seams callers need: default `GranotRecordLink` (first-registered connection — getter same-db return) vs `getGranotRecordLinkModel()` (selected `getMongoDatabaseName()`); mongoose `create` / `updateOne` (hooks run — refresh allowlist) vs `.collection.updateOne` / `.collection.insertOne` / `.collection.deleteMany` (hooks **do not** run — Booking/Referral/Connect `booking_ref`, EntityChange revision stamp, replica cleanup); unique partial `{ provider, normalized_job_no }` where `state:"active"` vs already-recommended Decision `{ observation_id, attempt }` vs already-recommended clock `{ key: 1 }` vs identity `equivalentNormalizedJobFilter` (prefix-equivalent Jobs are the same Job on lookup, not on this unique); refresh **allowlist** vs Decision/clock write-once entire document vs envelope `processing.*` allowlist; `booking_ref` forbidden on mongoose `$set` vs `booking_ref` allowed on insert and on command-owned `.collection.updateOne`; disputed stays `active` (unique still holds; identity still finds it); `timestamps: false` vs clock `createdAt` only vs statement `timestamps: true`; `autoIndex: false` vs statement unset; `GRANOT_RECORD_LINK_COLLECTION` `"granot_record_links"` vs Job Timeline hardcoded same string. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no authorization **seam**. There is no Decision **seam**. There is no clock **seam**.
- Split later (only if the file outgrows one sitting): this ~237-line file is one sitting if you read it as remember the current job-level Granot Record Link on `granot_record_links`, allow only refresh / dispute / supersede through the named allowlist, and declare the three named indexes with partial unique `{ provider, normalized_job_no }` where `state:"active"` — never establish or attach here, never stamp `booking_ref` through mongoose, never correct a disputed link here, never unique Job Number without the active partial, never merge this into the Decision or the clock. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `establish.ts` / `correct.ts` / `booking-ref.ts`. Establish / attach / confirm stay already-recommended `synchronizeLeadFromGranot.ts`. Historical job-level persist stays already-recommended `processor.ts`. Reserve stays already-recommended `createLeadFromGranot.ts`. Booking `booking_ref` stamp stays `bookingConfirmation.ts` / `referralBooking.ts` / `connectBookingToLead.ts`. Correction stays already-recommended `discrepancyOwnerCommands.ts`. Channel state catalog stays leftover later `granotLifecycleSchemas.ts`. Next Booking case stays leftover `GranotBookingReconciliationCase.ts`. Job Timeline hop stays leftover `mongo-evidence-loader.ts`.

`GranotRecordLink` is a Mongoose model name. The owner question is: *The processor just decided this Job belongs with a Lead — or historical shadow is reserving the Job — or the Owner is about to confirm a Booking / correct a disputed link / read the Lead timeline. Hold the current job-level Granot Record Link on `granot_record_links`. Partial unique `{ provider, normalized_job_no }` where `state:"active"` so a second active insert 11000s and the writer reports a link race instead of editing the unique. After insert mongoose may only refresh last-seen evidence, attach `lead_ref` / Source Scope, mark disputed, advance `domain_revision`, or atomically supersede. `booking_ref` is command-owned: mongoose `$set` refuses it; Confirm / Referral / Connect stamp it through `.collection.updateOne`. Disputed stays active and lookup-visible. If this process selected a different Mongo database, hand back that database’s link model. Do not establish here. Do not attach here. Do not stamp `booking_ref` through mongoose. Do not correct here. Do not unique Job Number without the active partial. Do not merge this into the Decision or the clock.*

Who establishes / attaches / confirms already lives in `synchronizeLeadFromGranot.ts`. Who reserves on create-if-missing already lives in `createLeadFromGranot.ts`. Who stamps `booking_ref` already lives in `bookingConfirmation.ts` / `referralBooking.ts` / `connectBookingToLead.ts`. Who corrects already lives in `discrepancyOwnerCommands.ts`. Who holds `RECORD_LINK_STATES` already lives in leftover later `granotLifecycleSchemas.ts`. Who holds leftover next Owner Booking work already lives in leftover next `GranotBookingReconciliationCase.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the current job-level Granot Record Link, allow only refresh / dispute / supersede through the named allowlist, and declare the three named indexes with partial unique `{ provider, normalized_job_no }` where `state:"active"`” story, not “a record-link model CRUD dump,” and not Establish The Link / Confirm The Booking / Correct The Disputed Link themselves:

1. **Hold the current job-level Granot Record Link** — collection `granot_record_links` (`GRANOT_RECORD_LINK_COLLECTION`), `timestamps: false`, `strict: true`, `autoIndex: false`. **No** `optimisticConcurrency`. **No** `sheet_sync[]`. **No** `source_company`. **No** `processing`. **No** Observation contact. **No** Decision `outcome`. Declares required `provider` enum `["granot"]`, required `normalized_job_no` (trim), required `job_no_snapshot` (trim, max 64 — `pre("validate")` demands `normalizeJobNo(job_no_snapshot) === normalized_job_no`), required `state` enum `RECORD_LINK_STATES` (`active` | `superseded`), optional nested `lead_ref` (`model` enum `GRANOT_LEAD_MODELS` + `id`; historical shadow may omit it), optional `booking_ref`, optional nested `source_scope` (company + granularity), required `disputed` default `false`, optional `dispute_reason`, required `established_by_decision_id` / `established_at` / `last_observation_id` / `last_observed_at`, required `domain_revision` min 0 default 0, optional `last_change_id` / `last_changed_at` / `superseded_by`. Nested refs set `{ _id: false }`. This beat does **not** choose establish versus attach. This beat does **not** stamp a Booking. This beat does **not** hide a disputed row from identity.

2. **Allow only refresh / dispute / supersede; refuse replace, delete, upsert, and `booking_ref` through mongoose** — exported `assertAllowlistedRecordLinkRefreshUpdate` is the refresh **interface**. `$set` paths must be in `ALLOWED_RECORD_LINK_SET_PATHS` (`last_observation_id`, `last_observed_at`, `lead_ref`, `source_scope`, `disputed`, `dispute_reason`, `last_change_id`, `last_changed_at`, `domain_revision`, `state`, `superseded_by`, `updatedAt`). `$inc` may only advance `domain_revision`. `$setOnInsert` throws “upsert-after-existence.” Replacement (no `$` operators) throws. If `$set` names `state` or `superseded_by`, both must land together: `state === "superseded"` and `superseded_by` an ObjectId. mongoose `updateOne` / `updateMany` / `findOneAndUpdate` run that assert and also throw on `upsert: true`. mongoose `replaceOne` / `findOneAndReplace` / `deleteOne` / `deleteMany` / `findOneAndDelete` throw “cannot be replaced or deleted.” There is **no** write-once-entire-document hook. `.collection.updateOne` / `.collection.insertOne` / `.collection.deleteMany` **bypass** these hooks — Confirm / Referral / Connect / EntityChange stamp use that on purpose. This beat does **not** throw `link_duplicate`. This beat does **not** persist an `EntityChange`.

3. **Bind the selected Mongo database and declare the three named indexes** — default export `GranotRecordLink` is `mongoose.models[...] ?? mongoose.model(...)`. `getGranotRecordLinkModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb` + register. `GRANOT_RECORD_LINK_INDEXES` is three named keys: unique partial `{ provider: 1, normalized_job_no: 1 }` where `state: "active"` (`granot_record_link_active_job_unique`); non-unique `{ "lead_ref.model": 1, "lead_ref.id": 1, state: 1 }`; non-unique `{ booking_ref: 1, state: 1 }`. The schema loops that catalog onto `Schema.index`. `autoIndex` is **`false`**. The migration **asks** the catalog (non-unique first, then unique). Job Timeline hops the collection by string `"granot_record_links"` — **not** this constant. This beat does **not** `syncIndexes`. This beat does **not** delete the default export so “everyone must call the getter.”

There is no establish-or-attach operation. `synchronizeLeadFromGranot` elects that. There is no reserve-on-create operation. `reserveRecordLink` elects that. There is no stamp-`booking_ref` operation. Confirm / Referral / Connect elect that through `.collection.updateOne`. There is no correct-the-disputed-link operation. `correctGranotRecordLink` elects that.

## Organization

Keep one file. This is the screenplay for “remember the current job-level Granot Record Link on `granot_record_links`, allow only refresh / dispute / supersede through the named allowlist, and declare the three named indexes with partial unique `{ provider, normalized_job_no }` where `state:"active"` — never establish or attach here, never stamp `booking_ref` through mongoose, never correct a disputed link here, never unique Job Number without the active partial, never merge this into the Decision or the clock.” Processor persist / sync / create / Booking confirm / identity / Owner correction / index apply already live in deeper **modules**. The state catalog already lives in leftover later `granotLifecycleSchemas.ts`. Already-recommended Decision and clock already live in sibling **modules**. Leftover next Booking case already lives in a sibling **module**. Do not pull those in. Do not invent a `GranotRecordLinkService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a unique `{ normalized_job_no: 1 }` without the active partial so “one Job forever.” Do not invent a write-once-entire-document **adapter** from this rename so “link matches Decision.” Do not invent a leftover `processing.*` **adapter** so “link matches envelope drain.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `establish.ts` / `correct.ts` / `booking-ref.ts` each get a file.

Do not move `synchronizeLeadFromGranot` / `reserveRecordLink` / `correctGranotRecordLink` into this file so “the row owns establish and correction.” Do not move Confirm / Referral / Connect `.collection.updateOne` into this file so “the row owns `booking_ref`.” Do not merge this file into already-recommended `SynchronizationDecision.ts` so “one schema owns the Decision and the link.” Do not merge this file into already-recommended `GranotLifecycleActivation.ts` so “one schema owns the clock and the job link.” Do not merge `RECORD_LINK_STATES` into this file so “the link owns the vocabulary catalog.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotRecordLink` | `currentJobLevelGranotRecordLinkOnTheDefaultConnection` | getter same-db return still imports the default model |
| `getGranotRecordLinkModel` | `currentJobLevelGranotRecordLinkOnTheSelectedMongoDatabase` | processor persist / sync / create / Booking / identity / health must follow `getMongoDatabaseName()` |
| `assertAllowlistedRecordLinkRefreshUpdate` | `refuseAForbiddenRecordLinkRefresh` | mongoose hooks and the model test share one refresh **interface** |
| `GranotRecordLinkDocument` | `CurrentJobLevelGranotRecordLinkRow` | stored current (or superseded) job link |
| `GranotRecordLinkState` | `RecordLinkLifecycleState` | `active` \| `superseded` — disputed is a flag, not a state |
| `GranotRecordLinkLeadRef` | `LinkedLeadOnTheJob` | Form or Call pointer; historical shadow may omit it |
| `GranotRecordLinkSourceScope` | `LeadSourceScopeOnTheLink` | company + granularity when the writer attached scope |
| `GRANOT_RECORD_LINK_COLLECTION` | `granotRecordLinkCollectionName` | migration opens `granot_record_links` without registering the model |
| `GRANOT_RECORD_LINK_MODEL_NAME` | `granotRecordLinkModelName` | getter / default export share `"GranotRecordLink"` |
| `GRANOT_RECORD_LINK_INDEXES` | `namedGranotRecordLinkIndexes` | `pnpm migration:granot-lifecycle:indexes` applies the three named keys |

Keep the old names as one-line aliases until processor persist / migration / getter same-db return migrate. Do not make callers learn `useDb` / `$setOnInsert` as the domain language. Do **not** delete the default `GranotRecordLink` export so “everyone must call the getter.” Do **not** delete the getter so “link matches Testimonial.” Do **not** re-export `synchronizeLeadFromGranot` / `correctGranotRecordLink` from this file so “the row owns establish and correction.” Do **not** export `ALLOWED_RECORD_LINK_SET_PATHS` so “callers learn the Set.” Do **not** add `booking_ref` to the mongoose allowlist so “Confirm can stop using `.collection.updateOne`.”

**No class for the workflow.** The one type that *does* earn a name is the pending current-link identity contract:

```ts
type CurrentJobLevelGranotRecordLinkIdentity = {
  collection: "granot_record_links"
  active_job: {
    unique: true
    provider_plus_normalized_job_no: true
    partial_state_active: true
  }
  refresh: {
    mongoose_allowlist: true
    booking_ref_forbidden: true
    replace_delete_upsert_forbidden: true
  }
  booking_ref: {
    mongoose_set: false
    command_owned_collection_update: true
  }
  disputed: { remains_active: true; unique_still_holds: true }
}
```

That is the handoff from “this process remembered which Lead or Booking currently owns the Job” to “a second active `{ provider, normalized_job_no }` 11000s, mongoose cannot `$set booking_ref` or replace the row, Confirm / Referral / Connect stamp `booking_ref` through `.collection.updateOne`, and a disputed row stays the unique active link until Owner correction supersedes it.” Do **not** add `{ normalized_job_no: { unique: true, ignore_state: true } }` so “one Job forever.” Do **not** add `{ processing: granotReceiptProcessingSchema }` so “link matches envelope drain.” Do **not** flip write-once-entire-document from this rename so “link matches Decision.” Do **not** unset `autoIndex` from this rename so “boot matches statement.”

Leave `synchronizeLeadFromGranot.ts` on that file. Leave `createLeadFromGranot.ts` on that file. Leave `processor.ts` `persistDecisionAndLink` on that file. Leave `bookingConfirmation.ts` / `referralBooking.ts` / `connectBookingToLead.ts` on those files. Leave already-recommended `SynchronizationDecision.ts` on that file. Leave leftover later `granotLifecycleSchemas.ts` on that file. Leave leftover next `GranotBookingReconciliationCase.ts` on that file. Leave index apply on the migration script.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotRecordLink.ts
// The processor just decided this Job belongs with a Lead —
// or historical shadow is reserving the Job —
// or the Owner is about to confirm a Booking /
// correct a disputed link / read the Lead timeline.
// Hold the current job-level Granot Record Link on granot_record_links.
// Partial unique { provider, normalized_job_no } where state:"active"
// so a second active insert 11000s
// and the writer reports a link race instead of editing the unique.
// After insert mongoose may only refresh last-seen evidence,
// attach lead_ref / Source Scope, mark disputed,
// advance domain_revision, or atomically supersede.
// booking_ref is command-owned: mongoose $set refuses it.
// Disputed stays active and lookup-visible.
// If this process selected a different Mongo database,
// hand back that database’s link model.
// Do not establish here.
// Do not stamp booking_ref through mongoose.
// Do not correct here.

import { normalizeJobNo } from "../services/bookings/bookingIdentity"
import { GRANOT_LEAD_MODELS, RECORD_LINK_STATES } from "./granotLifecycleSchemas"

// ── 1. Hold the current job-level Granot Record Link ──────

export const GRANOT_RECORD_LINK_COLLECTION = "granot_record_links"
export const GRANOT_RECORD_LINK_MODEL_NAME = "GranotRecordLink"

export type GranotRecordLinkDocument = {
  provider                 // "granot" only
  normalized_job_no        // unique with provider while active
  job_no_snapshot          // must normalize back to normalized_job_no
  state                    // active | superseded — disputed is a flag
  lead_ref?                // historical shadow may omit
  booking_ref?             // mongoose $set refuses; commands stamp via .collection
  source_scope?
  disputed                 // stays active; identity still finds it
  established_by_decision_id
  last_observation_id
  domain_revision
  superseded_by?
}

function rememberTheCurrentJobLinkShape()
function demandTheSnapshotNormalizesBackToTheJob()

// ── 2. Allow only refresh / dispute / supersede ───────────

export function assertAllowlistedRecordLinkRefreshUpdate(update)
  // $set allowlist only
  // $inc domain_revision only
  // state + superseded_by must land together as superseded
  // $set booking_ref throws
  // $setOnInsert / replacement throw

function rejectForbiddenLinkUpdateOnQuery()   // upsert also throws
function rejectLinkReplaceOrDelete()
// .collection.* bypasses these hooks — Confirm / Referral / Connect /
// EntityChange stamp use that on purpose. Do not "fix" that from this rename.

// ── 3. Bind the selected Mongo database and declare the three named indexes

export const GRANOT_RECORD_LINK_INDEXES = [
  { name: "granot_record_link_active_job_unique",
    key: { provider: 1, normalized_job_no: 1 }, unique: true,
    partialFilterExpression: { state: "active" } },
  { name: "granot_record_link_lead_state",
    key: { "lead_ref.model": 1, "lead_ref.id": 1, state: 1 } },
  { name: "granot_record_link_booking_state",
    key: { booking_ref: 1, state: 1 } },
]

export const GranotRecordLink = /* default connection */
export function getGranotRecordLinkModel()
  // same model when connection.name === getMongoDatabaseName()
  // otherwise useDb + register
```

Read the primary path out loud: *This Job now has a current Granot Record Link — or the Owner is about to attach a Booking or correct a disputed one. Hold that current row on `granot_record_links`. Partial unique on provider plus normalized Job while active so a second active insert 11000s and the writer reports a link race. After insert mongoose may only refresh last-seen evidence, attach a Lead, mark disputed, or atomically supersede. `booking_ref` is command-owned: mongoose `$set` refuses it. Disputed stays the unique active link until Owner correction supersedes it. If this process selected another Mongo database, hand back that database’s link model. Do not establish here. Do not stamp `booking_ref` through mongoose. Do not correct here.*

That is the operation. `GranotRecordLink.create` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This is the current aggregate. It is not establish, confirm, or correction.** Already-recommended `synchronizeLeadFromGranot.ts` owns establish / attach / confirm / dispute. `createLeadFromGranot.ts` owns reserve-or-`link_duplicate`. `correctGranotRecordLink` owns supersede-then-insert. Do not move those in so “the row owns the link story.”

2. **`booking_ref` is intentionally forbidden on mongoose `$set`.** Confirm / Referral / Connect stamp it through `Link.collection.updateOne` and say so in a comment. EntityChange revision stamp also uses `.collection.updateOne` even though `last_change_*` is on the allowlist. Do not add `booking_ref` to the allowlist from this rename so “Confirm can use mongoose.” Do not move those `.collection.updateOne` calls into this file so “the row owns the Booking pointer.”

3. **Unique is exact `{ provider, normalized_job_no }` while active. Identity lookup is prefix-equivalent.** `identity.ts` `findActiveRecordLink` spreads `equivalentNormalizedJobFilter` (`P5562366` / `5562366` are the same Job). Processor `defaultFindActiveLink` uses the exact string. This unique would allow both `P5562366` and `5562366` to be active at once. Do not widen the unique onto digit-core from this rename so “the index matches identity.” Do not drop the prefix filter on identity so “lookup matches the unique.” Leave both.

4. **`timestamps: false` but `updatedAt` is on the mongoose allowlist.** Nothing in this schema turns `updatedAt` on. Do not flip `timestamps: true` from this rename so “the allowlist is honest.” Do not drop `updatedAt` from the allowlist so “the Set matches `timestamps: false`” without reading every `.collection` stamp.

5. **Disputed stays `active`.** Unique still holds. Identity still returns the row. Health counts `active` and `active + disputed` separately. Do not add `state: "disputed"` from this rename so “dispute is a lifecycle state.” Do not hide disputed rows from `findActiveRecordLink` so “conflict is invisible.”

6. **Create-if-missing never attaches an existing lead-less row.** `reserveRecordLink` finds an active Job and throws `link_duplicate`. Historical shadow may have reserved that Job without `lead_ref`. Processor knowledge already names that as `conflict` / `record_link_conflict`. Do not rewrite reserve onto attach from this rename so “create can steal the historical reservation.”

7. **Sibling mongoose updates skip `$inc domain_revision`.** `persistConflict` and `confirmLinkEvidence` `$set` without `$inc`. Processor refresh `$inc`s. EntityChange later stamps revision through `.collection.updateOne`. Do not “fix” those writers from this rename so “every refresh increments.” Leave the increment on the writer.

8. **Leave sibling modules alone.** `synchronizeLeadFromGranot`, `reserveRecordLink`, `correctGranotRecordLink`, Confirm / Referral / Connect `.collection.updateOne`, `RECORD_LINK_STATES` are already the right **depth**. This file holds the current row.

## Testing

The **interface** is the test surface: `GranotRecordLink` / `getGranotRecordLinkModel` / `assertAllowlistedRecordLinkRefreshUpdate` / `GRANOT_RECORD_LINK_INDEXES` / `GRANOT_RECORD_LINK_COLLECTION`.

Today’s `GranotRecordLink.test.ts` already names the operation:

**Hold the current job-level link**
- Named collection is `granot_record_links`; model name is `GranotRecordLink`.
- Getter returns the same model name on the selected database.
- Three named indexes match the catalog; unique is partial `{ provider, normalized_job_no }` where `state: "active"`.
- `job_no_snapshot` that does not normalize back to `normalized_job_no` refuses validate.
- Establishment defaults: `provider: "granot"`, `state: "active"`, `disputed: false`, `domain_revision: 0`, no `lead_ref`, no `booking_ref`.

**Allow only refresh / dispute / supersede**
- Disputed stays `state: "active"`.
- Allowlisted `$set` of last-seen / `lead_ref` / dispute plus `$inc domain_revision` passes.
- Atomic `{ state: "superseded", superseded_by }` passes; `$set { state: "active" }` throws.
- `$set booking_ref` throws; `$setOnInsert` throws.
- mongoose `replaceOne` / `deleteOne` throw “replaced or deleted.”

Do **not** add a test per helper (`rememberTheCurrentJobLinkShape`, `demandTheSnapshotNormalizesBackToTheJob`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** move `synchronizeLead.replica.test.ts` / `discrepancies.replica.test.ts` / Confirm replica proofs into this file so “the row owns establish and correction.” `link_duplicate` / `DOMAIN_REVISION_CONFLICT` / `record_link_corrected` stay on those command **interfaces**.

Do **not** add an identity prefix-equivalence test here. `equivalentNormalizedJobFilter` lives on `bookingIdentity.ts` and does not import this file.

## What I would not do

- A `GranotRecordLinkService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `establish.ts` / `correct.ts` / `booking-ref.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit **seam**. Confirm / Referral / Connect already stamp `booking_ref` inside the command transaction through `.collection.updateOne` — do not move that stamp into this file so “the row owns the Booking pointer.”
- Treating `synchronizeLeadFromGranot` / `reserveRecordLink` / `correctGranotRecordLink` / `findActiveRecordLink` as this story.
- Inventing a leftover `processing.*` **seam** that has only one **adapter**.
- Silently "fixing" prefix-equivalent unique / `updatedAt` on the allowlist / sibling missing `$inc` / create-if-missing refuse-to-attach while recommending a rename.
- Jumping to `validation/` while `models` has unchecked modules.
- Writing a whole-folder recommendation for `models`.
- Merging this file into already-recommended `SynchronizationDecision.ts` so “one schema owns the Decision and the link.”
- Merging this file into already-recommended `GranotLifecycleActivation.ts` so “one schema owns the clock and the job link.”
- Merging `RECORD_LINK_STATES` into this file so “the link owns the vocabulary catalog.”
- Adding `booking_ref` to the mongoose allowlist so “Confirm can stop using `.collection.updateOne`.”
- Unique-indexing Job Number without the `state:"active"` partial so “superseded history cannot share a Job.”
- Treating leftover next `GranotBookingReconciliationCase.ts` as this story.
- Reopening Wave A to enumerate `connectBookingToLead.ts` from this models pass.
