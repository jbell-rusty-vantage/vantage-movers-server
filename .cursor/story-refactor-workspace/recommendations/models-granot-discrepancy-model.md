# Remember The Shared Identity-Conflict Desk Shape, Stamp Caller-Supplied Named Indexes, Refuse Illegal Mutation Of An Open Or Resolved Fight, And Register Or Reuse The Mongoose Model By Name — Never Persist A Collection Here, Never Open Or Refresh Here, Never Fingerprint Here, Never Re-Evaluate Correct-Record-Link Or No-Action Here, Never Bind The Selected Database, Never Merge The Booking Or Release Desks, Never Merge The Shared Word Catalog — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 30 of this service — `granotDiscrepancyModel.ts`
- Remaining in this service: `GranotCrmSource.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/granotDiscrepancyModel.ts`
- Knowledge: There is **no** standalone Service file in `docs/knowledge/granot-lifecycle/` for this factory. Owner durable-work / append-only evidence / resolve-preserves-the-row: [`docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md`](../../../docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md) (Booking and Release use **separate** collections; evidence is append-only and deduplicated by Observation ID; resolving preserves the row permanently — **this file never fingerprints**, never opens, never resolves). Related processor persist: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) (`persistProcessorDiscrepancy` → leftover `createGranotDiscrepancies` — **this file never elects persist**). Related already-recommended persist / Owner review: [granot-lifecycle-discrepancies.md](granot-lifecycle-discrepancies.md) / [granot-lifecycle-discrepancy-owner-commands.md](granot-lifecycle-discrepancy-owner-commands.md) (`create()` insert / `findOneAndUpdate` `$push` on `{ state: "open" }` / Owner `updateOne({ _id, state: "open", revision })` — **those leftover-ask the desks, not this factory file**). Related already-recommended desks: [models-granot-booking-discrepancy.md](models-granot-booking-discrepancy.md) / [models-granot-release-discrepancy.md](models-granot-release-discrepancy.md) (**ask** `createGranotDiscrepancyModel` with kind / reasons / collection / indexes — **do not merge those desks here**). Related already-recommended catalog: [models-granot-lifecycle-schemas.md](models-granot-lifecycle-schemas.md) (`GRANOT_LEAD_MODELS` / `GRANOT_RECONCILIATION_EVIDENCE_ACTIONS` / `GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES` — **this file leftover-asks those tuples**, never owns them). Related leftover Decision write-once: already-recommended [models-synchronization-decision.md](models-synchronization-decision.md) (refuses `deleteOne` / `deleteMany` — **this factory has no delete refuse**). Related leftover later observability factory: leftover later `observabilityModelFactory.ts` (selected-database getter for events / incidents / reports — **do not merge**). Related leftover next CRM source desk: leftover next `GranotCrmSource.ts` (collection `granot_crm_sources`, unique label, lifecycle + outbound SMS — **do not copy these hooks onto it**). Compatibility rule: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) names the Booking case and does **not** name this factory or either discrepancy collection — do not add a Core Collections paragraph from this rename. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links discrepancy review; this checkout does **not** define Granot Booking Discrepancy / Granot Release Discrepancy — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **two desk adapters vs leftover type imports vs leftover persist that never imports the factory function.** Already-recommended `GranotBookingDiscrepancy.ts` **asks** `createGranotDiscrepancyModel({ model_name, collection, kind: "booking", reason_codes, indexes })` and re-exports `created.model` / `created.schema` through `getGranotBookingDiscrepancyModel()`. Already-recommended `GranotReleaseDiscrepancy.ts` **asks** the same factory with `kind: "release"`. Already-recommended leftover `discrepancies.ts` **imports the document type** and leftover-asks the desk getters for `create` / `findOne` / `findOneAndUpdate` `$push`. Already-recommended leftover `discrepancyOwnerCommands.ts` **imports the document type** and leftover-asks the desk getters for `findById` / `updateOne({ _id, state: "open", revision })`. `discrepancies.test.ts` leftover-types fixture rows. There is **no** `granotDiscrepancyModel.test.ts`. Hook-adjacent titles live on `GranotBookingDiscrepancy.test.ts` (the title leftover-says “unsafe resolved/evidence mutation”; the body leftover-only leftover-refuses a Release reason). Replica unique-open 11000 leftover-uses leftover mongoose `create` on the Booking desk; replica seeds leftover-use `.collection.insertOne` / leftover-cleanup leftover-uses `.collection.deleteMany` (hooks **do not** run). Not this **interface**: `createGranotDiscrepancies` itself, `createDiscrepancyFingerprint` itself, `reEvaluateGranotDiscrepancy` itself, `correctGranotRecordLink` itself, `resolveGranotDiscrepancyNoAction` itself, `getGranotBookingDiscrepancyModel` itself, `getGranotReleaseDiscrepancyModel` itself.
- Seams callers need: Booking desk vs Release desk as two **adapters** of one factory; mongoose document `pre("validate")` (resolved immutable + evidence IDs cannot disappear) vs query `pre(["updateOne", "findOneAndUpdate", "replaceOne"])` (must `$…`, must `filter.state === "open"`, cannot `$set` evidence / reason / fingerprint / kind, cannot `$pull` / `$pop` / `$unset`); leftover persist `$push` + `$set last_evidence_at` + `$inc evidence_revision` (allowed) vs leftover persist `$set evidence` (refused); Owner resolve `$set state: "resolved"` + `$inc revision` (allowed when filter is open) vs `$set state: "open"` (refused); mongoose writes (hooks run) vs `.collection.insertOne` / `.collection.deleteMany` (hooks **do not** run); `timestamps: true` / `autoIndex: false` / `strict: true` live here, not on the desks; `mongoose.models[model_name]` reuse vs desk `useDb` + leftover-register `created.schema`; no collection name / no selected-database getter / no named-index catalog on this file; leftover catalog tuples leftover-asked here vs leftover `types.ts` unions leftover-asked on persist. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no authorization **seam**. There is no fingerprint **seam**. There is no collection **seam**.
- Split later (only if the file outgrows one sitting): this ~244-line file is one sitting if you read it as remember the shared identity-conflict desk shape, stamp caller-supplied named indexes, refuse illegal mutation of an open or resolved fight, and register or reuse the mongoose model by name — never persist a collection here, never open or refresh here, never fingerprint here, never re-evaluate / correct-record-link / no-action here, never bind the selected database, never merge the Booking or Release desks, never merge the shared word catalog. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `hooks.ts` / `indexes.ts` / `booking.ts` / `release.ts`. Already-recommended desks stay `GranotBookingDiscrepancy.ts` / `GranotReleaseDiscrepancy.ts`. Leftover persist stays `discrepancies.ts`. Leftover Owner review stays `discrepancyOwnerCommands.ts`. Already-recommended catalog stays `granotLifecycleSchemas.ts`. Leftover later observability factory stays `observabilityModelFactory.ts`. Leftover next CRM source stays `GranotCrmSource.ts`.

`granotDiscrepancyModel` / `createGranotDiscrepancyModel` is a factory name. The owner question is: *Booking and Release both need the same fight-row shape — Job, kind, reason, 64-hex fingerprint, open or resolved, append-only evidence, two revision counters, optional link / Lead / Booking / Cancellation, optional Owner resolution. Hold that shape here. Stamp the indexes the desk handed you. A resolved fight cannot change. Existing evidence Observation IDs cannot disappear. Query updates must already be looking at an open row and may only `$push` new evidence or resolve. If mongoose already registered that model name, hand the first one back. This file is not a collection. Do not open the fight. Do not hash the fingerprint. Do not pick Booking versus Release reasons. Do not bind the selected Mongo database. Do not merge the two desks. Do not merge the word catalog.*

Who leftover-opens / leftover-refreshes already lives in `discrepancies.ts`. Who leftover-re-evaluates / corrects the Record Link / marks No Action already lives in `discrepancyOwnerCommands.ts`. Who leftover-holds Booking reasons and the Booking getter already lives in already-recommended `GranotBookingDiscrepancy.ts`. Who leftover-holds Release reasons and the Release getter already lives in already-recommended `GranotReleaseDiscrepancy.ts`. Who leftover-holds the legal words already lives in already-recommended `granotLifecycleSchemas.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the shared identity-conflict desk shape, stamp caller indexes, refuse illegal mutation, and register or reuse the mongoose model by name” story, not “a discrepancy model CRUD dump,” and not Open The Fight / Re-Evaluate / Correct Record Link themselves:

1. **Hold the shared identity-conflict desk shape and stamp caller-supplied named indexes** — `GranotDiscrepancyDocument`: required `normalized_job_no`, `discrepancy_kind` enum locked to `input.kind` (default that kind), `reason_code` enum locked to `input.reason_codes`, `reason_fingerprint` required lowercase `/^[a-f0-9]{64}$/`, `state` `open` | `resolved` default `open`, optional `record_link_id` / `lead_ref` (`GRANOT_LEAD_MODELS` + ObjectId) / `booking_id` / `cancellation_id`, required `evidence[]` of Observation + Decision + `captured_at` + `GRANOT_RECONCILIATION_EVIDENCE_ACTIONS` (`priority_5` | `booked` | `release`) with at least one causal row, integer `evidence_revision` / `revision` min 1 default 1, optional `resolution` (`re_evaluated` | `record_link_corrected` | `no_action` + command + copied DurableActor + optional leftover no-action reason / 1000-char text + `resolved_at`), required `opened_at` / `last_evidence_at`. Schema options: `collection: input.collection`, `timestamps: true`, `strict: true`, `autoIndex: false`. Then loop `input.indexes` onto `schema.index` (name, optional unique, optional `partialFilterExpression`). There is **no** collection constant here. There is **no** reason-code tuple here. There is **no** `GRANOT_*_INDEXES` catalog here. This beat does **not** hash the fingerprint. This beat does **not** choose Booking versus Release. This beat does **not** `syncIndexes`.

2. **Refuse illegal mutation of an open or resolved fight** — `post("init")` remembers `state` and the current evidence Observation ID strings on `$locals`. `pre("validate")` skips new docs; a remembered `resolved` row throws `A resolved discrepancy is immutable`; dropping any remembered evidence Observation ID throws `Existing discrepancy evidence IDs are immutable` (new IDs may appear). Query `pre(["updateOne", "findOneAndUpdate", "replaceOne"])`: no update is a no-op; a replacement without `$` throws `Discrepancies cannot be replaced directly`; `filter.state !== "open"` throws `Discrepancy updates must guard on open state`; `$set.state === "open"` throws `A resolved discrepancy cannot return to open`; `$set evidence` / `reason_code` / `reason_fingerprint` / `discrepancy_kind` or `$pull` / `$pop` / `$unset` throws `Discrepancy identity and evidence are immutable`. Leftover persist `$push` + `$set last_evidence_at` + `$inc evidence_revision` is allowed. Owner resolve `$set state: "resolved"` + `$inc revision` is allowed when the filter already says `open`. There is **no** `deleteOne` / `deleteMany` refuse. This beat does **not** fingerprint. This beat does **not** open. This beat does **not** elect No Action.

3. **Register or reuse the mongoose model by name** — `mongoose.models[input.model_name] ?? mongoose.model(name, schema)`. Return `{ schema, model }`. There is **no** `getMongoDatabaseName()`. There is **no** `useDb`. Desk getters leftover-bind the selected database and leftover-reuse `created.schema`. This beat does **not** delete the first-registered model so “everyone must call a factory getter.”

There is no open-or-refresh operation. Leftover `createGranotDiscrepancies` elects that. There is no re-evaluate / Correct Record Link / No Action operation. Those leftover Owner commands elect that. There is no selected-database getter. The two desks elect that.

## Organization

Keep one file. This is the screenplay for “remember the shared identity-conflict desk shape, stamp caller-supplied named indexes, refuse illegal mutation of an open or resolved fight, and register or reuse the mongoose model by name — never persist a collection here, never open or refresh here, never fingerprint here, never re-evaluate / correct-record-link / no-action here, never bind the selected database, never merge the Booking or Release desks, never merge the shared word catalog.” Leftover persist / leftover Owner commands / desk getters / word catalog already live in deeper **modules**. Do not pull those in. Do not invent a `GranotDiscrepancyModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a collection **adapter** so “the factory owns a desk.” Do not invent a selected-database getter **adapter** so “factory matches Receipt.” Do not invent a CRUD folder so `schema.ts` / `hooks.ts` / `indexes.ts` / `booking.ts` / `release.ts` each get a file.

Do not move `createGranotDiscrepancies` / `reEvaluateGranotDiscrepancy` / `correctGranotRecordLink` into this file so “the factory owns leftover persist and review.” Do not merge this file into already-recommended `GranotBookingDiscrepancy.ts` or `GranotReleaseDiscrepancy.ts` so “one file owns reasons and hooks.” Do not merge this file into already-recommended `granotLifecycleSchemas.ts` so “the catalog owns the factory.” Do not merge this file into leftover later `observabilityModelFactory.ts` so “one factory owns every selected-database desk.” Do not merge this file into leftover next `GranotCrmSource.ts` so “CRM source is a fight desk.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createGranotDiscrepancyModel` | `rememberTheSharedIdentityConflictDeskShape` | Booking and Release desks leftover-ask one constructor |
| `GranotDiscrepancyDocument` | `SharedIdentityConflictDeskRow` | leftover persist / leftover Owner review leftover-type the row without importing a desk |
| `GranotDiscrepancyEvidence` | `ImmutableDiscrepancyEvidenceTuple` | Observation + Decision + capture time + action |
| `GranotDiscrepancyKind` | `BookingOrReleaseFightKind` | leftover persist picks a desk from this word |
| `GranotDiscrepancyIndexContract` | `CallerNamedIndex` | desks hand unique-open fingerprint + state/newest-evidence |

Keep the old names as one-line aliases until the two desks and leftover type imports migrate. Do not make callers learn `mongoose.models` / `$locals` / `autoIndex` as the domain language. Do **not** export a selected-database getter so “factory matches Receipt.” Do **not** re-export `createGranotDiscrepancies` / `getGranotBookingDiscrepancyModel` from this file so “the factory owns leftover persist and the desk.” Do **not** export a Record-Link-style allowlist Set so “callers learn `$push`.” Do **not** add `deleteOne` refuse from this rename so “factory matches Decision.”

**No class for the workflow.** The one type that *does* earn a name is the pending factory identity contract:

```ts
type SharedIdentityConflictDeskFactoryIdentity = {
  collection: false
  selected_database_getter: false
  named_index_catalog: false
  reason_codes: "caller_supplied"
  kind: "caller_supplied_booking_or_release"
  timestamps: true
  autoIndex: false
  evidence: "append_only_min_one"
  fingerprint: "64_hex_stored_here_hashed_elsewhere"
  query_update: { must_filter_state_open: true; push_ok: true; set_evidence_forbidden: true }
  resolved: "immutable"
  delete_refuse: false
}
```

That is the handoff from “this process remembered the shared fight-row shape” to “the Booking desk leftover-asks it with five `booked_*` reasons, the Release desk leftover-asks it with four `release_*` reasons, leftover persist `$push`es onto an open row, and leftover Owner resolve wins only when `state` is still `open` at the expected `revision`.” Do **not** add `{ collection: "granot_discrepancies" }` so “one collection owns both fights.” Do **not** add `{ getGranotDiscrepancyModel }` so “factory matches Receipt.” Do **not** add `{ processing: granotReceiptProcessingSchema }` so “factory matches envelope drain.” Do **not** flip write-once-entire-document from this rename so “factory matches Decision.”

Leave already-recommended `GranotBookingDiscrepancy.ts` / `GranotReleaseDiscrepancy.ts` on those files. Leave leftover `discrepancies.ts` on that file. Leave leftover `discrepancyOwnerCommands.ts` on that file. Leave already-recommended `granotLifecycleSchemas.ts` on that file. Leave leftover later `observabilityModelFactory.ts` on that file. Leave leftover next `GranotCrmSource.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granotDiscrepancyModel.ts
// Booking and Release both need the same fight-row shape —
// Job, kind, reason, 64-hex fingerprint, open or resolved,
// append-only evidence, two revision counters,
// optional link / Lead / Booking / Cancellation,
// optional Owner resolution.
// Hold that shape here.
// Stamp the indexes the desk handed you.
// A resolved fight cannot change.
// Existing evidence Observation IDs cannot disappear.
// Query updates must already be looking at an open row
// and may only $push new evidence or resolve.
// If mongoose already registered that model name,
// hand the first one back.
// This file is not a collection.
// Do not open the fight.
// Do not hash the fingerprint.
// Do not pick Booking versus Release reasons.
// Do not bind the selected Mongo database.

import {
  GRANOT_LEAD_MODELS,
  GRANOT_RECONCILIATION_EVIDENCE_ACTIONS,
  GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES,
} from "./granotLifecycleSchemas"

// ── 1. Hold the shared identity-conflict desk shape and stamp caller indexes

export type GranotDiscrepancyKind = "booking" | "release"
export type GranotDiscrepancyEvidence = { /* Observation, Decision, time, action */ }
export type GranotDiscrepancyDocument = { /* open or resolved fight row */ }
export type GranotDiscrepancyIndexContract = { /* name, key, optional unique/partial */ }

export function rememberTheSharedIdentityConflictDeskShape(input: {
  model_name: string
  collection: string
  kind: GranotDiscrepancyKind
  reason_codes: readonly string[]
  indexes: readonly GranotDiscrepancyIndexContract[]
})
function lockKindAndReasonsToWhatTheDeskHandedYou()
function requireAtLeastOneCausalEvidenceRow()
function storeTheFingerprintAsSixtyFourHex()
function stampCallerNamedIndexesWithoutOwningTheCatalog()
  // autoIndex: false — migration leftover-asks the desks

// ── 2. Refuse illegal mutation of an open or resolved fight

function rememberOpenStateAndEvidenceIdsOnInit()
function refuseToMutateAResolvedFightOnValidate()
function refuseToDropExistingEvidenceIdsOnValidate()
function refuseReplacementAndUnguardedQueryUpdates()
  // filter.state must be the string "open"
  // $push evidence is allowed; $set evidence is not
  // $set state "resolved" is allowed; $set state "open" is not
function leaveDeleteUnhooked()
  // Decision refuses deleteOne; this factory does not

// ── 3. Register or reuse the mongoose model by name

function handBackTheFirstRegisteredModelOrRegisterThisSchema()
  // desks leftover-bind useDb with created.schema
```

Read the primary path out loud: *Booking and Release both need the same fight-row shape. Hold that shape here. Stamp the indexes the desk handed you. A resolved fight cannot change. Existing evidence Observation IDs cannot disappear. Query updates must already be looking at an open row and may only `$push` new evidence or resolve. If mongoose already registered that model name, hand the first one back. This file is not a collection. Do not open the fight. Do not hash the fingerprint. Do not pick Booking versus Release reasons. Do not bind the selected Mongo database. Do not merge the two desks. Do not merge the word catalog.*

That is the operation. `createGranotDiscrepancyModel` as “a shared schema helper” is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This is the shared fight-row factory. It is not a desk, not persist, and not the catalog.** Already-recommended desks leftover-own collection / reasons / getter / index constants. Leftover `discrepancies.ts` leftover-hashes and leftover-opens. Already-recommended `granotLifecycleSchemas.ts` leftover-owns the tuples this file leftover-asks. Do not move those in so “the factory owns leftover persist.” Do not add `getGranotDiscrepancyModel()` so “factory matches Receipt.”

2. **Document validate and query update are two different refuse lists.** Query leftover-blocks `$set reason_code` / `reason_fingerprint` / `discrepancy_kind` / wholesale `evidence`. Document `pre("validate")` leftover-only leftover-blocks a remembered resolved state and leftover-dropped evidence IDs. A leftover mongoose `doc.reason_code = …; doc.save()` on an **open** row leftover-would leftover-pass this factory. Leftover persist leftover-does not leftover-save that way — it leftover-`create`s and leftover-`$push`es. Do not copy the query refuse list onto `pre("validate")` from this rename so “document save matches query.” Do not drop the query refuse so “document save already remembers IDs.” Leave both until a later hook pass.

3. **Query leftover-requires `filter.state === "open"` as an exact string.** Leftover persist and leftover Owner resolve leftover-pass `{ state: "open", … }`. `{ state: { $eq: "open" } }` leftover-would leftover-throw `must guard on open state`. Do not widen the check onto `$eq` from this rename so “Mongo query sugar matches.” Do not drop the open guard so “`_id` alone can resolve.”

4. **`$push` is the refresh **seam**. `$set evidence` is forbidden.** Leftover persist leftover-appends one Observation, leftover-`$set`s `last_evidence_at`, leftover-`$inc`s only `evidence_revision`. Owner resolve leftover-`$set`s `state` + `resolution` and leftover-`$inc`s `revision`. Do not allow `$set evidence` so “refresh can replace the array.” Do not forbid `$push` so “the persist story cannot refresh.”

5. **`$unset` is forbidden entirely.** Optional `record_link_id` / `lead_ref` / `booking_id` / `cancellation_id` cannot be cleared on the query path. Leftover persist leftover-never leftover-unsets those. Do not allow `$unset` from this rename so “a corrected fight can drop the old link.” Do not add those fields to `$set` refuse so “Owner resolve cannot stamp `resolution`.”

6. **There is no delete refuse.** Already-recommended Decision leftover-blocks `deleteOne` / `deleteMany`. Replica leftover-cleanup leftover-uses `.collection.deleteMany` (hooks **do not** run anyway). Do not add delete refuse from this rename so “factory matches Decision.” Do not treat replica `deleteMany` as a product path.

7. **`GranotBookingDiscrepancy.test.ts` leftover-titles leftover-hook coverage it leftover-does not leftover-run.** The second test leftover-says “rejects Release reasons and unsafe resolved/evidence mutation” and leftover-only leftover-refuses a Release `reason_code`. Release twin leftover-does not leftover-mention hooks. There is **no** `granotDiscrepancyModel.test.ts`. Do not move desk reason tests here so “the factory owns leftover Booking validate.” Add hook proofs on **this** interface later.

8. **Replica seeds leftover-skip leftover-hooks.** `discrepancies.replica.test.ts` leftover-`collection.insertOne`s the Booking row (fingerprint leftover-padded from the ObjectId, not leftover-hashed). Unique-open 11000 leftover-uses leftover mongoose `create` (hooks run; unique leftover-lives on leftover Mongo). Do not treat seed `insertOne` as proof the factory leftover-accepted the row. Do not move the 11000 proof onto this file so “the factory owns leftover persist.”

9. **`mongoose.models[name]` leftover-returns the first registered schema.** A second `createGranotDiscrepancyModel` call with the same `model_name` and a different collection leftover-would leftover-hand leftover-back leftover-the leftover-first leftover-model. The two desks leftover-use leftover-different leftover-names. Do not delete the reuse so “every call leftover-rebuilds hooks.” Do not register a third kind under `GranotBookingDiscrepancy` so “one name owns both fights.”

10. **`timestamps: true` plus explicit `opened_at` / `last_evidence_at`.** Mongoose leftover-adds `createdAt` / `updatedAt`. Leftover persist leftover-stamps `opened_at` from the prepared Decision and leftover-`$set`s `last_evidence_at` from the new Observation. Do not drop `timestamps` from this rename so “factory matches Decision `timestamps: false`.” Do not drop `opened_at` so “`createdAt` is the opened clock.”

11. **Two revision counters.** Refresh leftover-increments only `evidence_revision`. Owner resolve leftover-increments `revision`. Unique leftover-does not leftover-include either counter — leftover persist after resolve leftover-inserts a new row for the same fingerprint. Do not increment `revision` on `$push` from this rename so “refresh matches resolve.” Do not add a sequence unique so “factory matches the leftover Release case.”

12. **`actorSchema` leftover-copies leftover `DurableActor` fields.** It leftover-imports the type and leftover-redeclares enums (`owner` / `admin` / `system`, six origins including `granot_lifecycle`). Do not import a leftover durable-work mongoose schema from this rename so “one actor schema owns every command.” Do not drop `origin` enum members so “discrepancy resolve can only be `vantage_admin`.”

13. **`GRANOT_LEAD_MODELS` here vs leftover `schemaHelpers` `LEAD_MODELS`.** Both are `FormLead` / `CallLead`. Booking / Cancellation leftover-ask the helper. This factory leftover-asks the catalog tuple. Do not merge them so “one Lead-model enum owns Sheet hints and fight rows.”

14. **`schema-and-crud-inputs.mdc` omits this factory and both discrepancy collections.** Do not add a Core Collections paragraph from this rename so “every Granot row is listed.” Do not invent a `CONTEXT.md` term. Knowledge still says there is no standalone discrepancy Service — do not invent `docs/knowledge/granot-lifecycle/discrepancies.md` in this pass.

15. **Leave sibling modules alone.** `createGranotDiscrepancies`, `createDiscrepancyFingerprint`, `reEvaluateGranotDiscrepancy`, `getGranotBookingDiscrepancyModel` are already the right **depth**. This file holds the shared shape and the mongoose guards.

## Testing

The **interface** is the test surface: `createGranotDiscrepancyModel` / `GranotDiscrepancyDocument` / `GranotDiscrepancyEvidence` / `GranotDiscrepancyKind` / `GranotDiscrepancyIndexContract`.

Today there is **no** `granotDiscrepancyModel.test.ts`. Neighbor desks already name part of the shape:

**Hold the shared identity-conflict desk shape and stamp caller indexes**
- `GranotBookingDiscrepancy.test.ts` leftover-asks leftover Booking reasons, leftover two-index catalog deep-equal, leftover `autoIndex === false`.
- `GranotReleaseDiscrepancy.test.ts` leftover-asks leftover Release reasons, leftover first index name, leftover collection name.

**Refuse illegal mutation of an open or resolved fight**
- No dedicated proof. The Booking test title leftover-claims leftover-hook coverage and leftover-does not leftover-run it.

Add on **this** interface (do not invent helper-unit tests):

- A factory-built schema leftover-`autoIndex`s `false` and leftover-`timestamps` `true`.
- `pre("validate")` leftover-throws leftover `A resolved discrepancy is immutable` after leftover `init` remembered `resolved`.
- `pre("validate")` leftover-throws leftover `Existing discrepancy evidence IDs are immutable` when a remembered Observation ID disappears.
- Query leftover-throws leftover `must guard on open state` when `filter.state` is missing.
- Query leftover-throws leftover `identity and evidence are immutable` on `$set evidence` / `$set reason_fingerprint` / `$pull`.
- Query leftover-allows leftover `$push evidence` when `filter.state === "open"`.
- Empty `evidence[]` leftover-refuses leftover validate (`at least one causal reference`).
- Fingerprint leftover-refuses leftover validate when it is not 64 hex.

Do **not** add a test per helper (`lockKindAndReasonsToWhatTheDeskHandedYou`, `refuseReplacementAndUnguardedQueryUpdates`, `leaveDeleteUnhooked`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** move `GranotBookingDiscrepancy.test.ts` / `GranotReleaseDiscrepancy.test.ts` onto this file so “the factory owns leftover Booking reasons.” Those stay on those desk **interfaces**.

Do **not** move `discrepancies.replica.test.ts` / leftover Owner review proofs into this file so “the factory owns leftover persist and review.” Unique-open-fingerprint 11000 / `CASE_REVISION_CONFLICT` / Correct Record Link stay on those command **interfaces**.

Do **not** add a fingerprint-hash test here. `createDiscrepancyFingerprint` lives on leftover `discrepancies.ts`.

## What I would not do

- A `GranotDiscrepancyModelService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `hooks.ts` / `indexes.ts` / `booking.ts` / `release.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit **seam**. Leftover persist already writes the discrepancy and the causal Decision in one transaction; leftover Owner commands already resolve inside the command transaction — do not move those writes into this file so “the factory owns leftover persist and review.”
- Treating `createGranotDiscrepancies` / `createDiscrepancyFingerprint` / `reEvaluateGranotDiscrepancy` / `correctGranotRecordLink` / `resolveGranotDiscrepancyNoAction` / `getGranotBookingDiscrepancyModel` / `getGranotReleaseDiscrepancyModel` as this story.
- Inventing a collection **seam** that has only one **adapter**.
- Silently "fixing" the document-vs-query refuse gap / exact `filter.state === "open"` string / missing delete hooks / lying Booking test title / missing dedicated test file / missing Core Collections paragraph while recommending a rename.
- Jumping to `validation/` while `models` has unchecked modules.
- Writing a whole-folder recommendation for `models`.
- Merging this file into already-recommended `GranotBookingDiscrepancy.ts` or `GranotReleaseDiscrepancy.ts` so “one file owns reasons and hooks.”
- Merging this file into already-recommended `granotLifecycleSchemas.ts` so “the catalog owns the factory.”
- Merging this file into leftover later `observabilityModelFactory.ts` so “one factory owns every selected-database desk.”
- Merging this file into leftover next `GranotCrmSource.ts` so “CRM source is a fight desk.”
- Adding `getGranotDiscrepancyModel()` so “factory matches Receipt.”
- Adding `collection: "granot_discrepancies"` so “one collection owns both fights.”
- Adding `deleteOne` refuse so “factory matches Decision.”
- Forbidding `$push` so “the persist story cannot refresh.”
- Allowing `$set evidence` so “refresh can replace the array.”
- Unique-indexing Job Number without the open-fingerprint partial so “resolved history cannot share a Job.”
- Treating leftover next `GranotCrmSource.ts` as this story.
- Reopening Wave A to enumerate `connectBookingToLead.ts` from this models pass.
