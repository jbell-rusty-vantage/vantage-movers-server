# Remember The Inbound-Number Card On The Selected Mongo Database — One Unique Phone Per Card, Lock That Phone After First Activate, Start Inactive And Unvalidated, Provider Always RingCentral, Archive Never Delete, Default CamelCase Timestamps Plus Unnamed Unique Phone Clock Plus Active / Validation Browse Clocks Plus Sparse RingCentral Id Clocks, And The Selected-Database Getter — Never Fold Or Record Or Validate Or Activate Here, Never Resolve A Call Here, Never Write An Assignment Here, Never Merge This Into The Assignment Interval — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 46 of this service — `RingCentralInboundRoute.ts`
- Remaining in this service: `RingCentralInboundRouteAssignment.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/RingCentralInboundRoute.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (lumps already-recommended `ringCentralRegistry.ts` / already-recommended `ringCentralValidation.ts` as “inbound-route snapshot used at Call Qualification time” — that sentence names already-recommended `ringCentralSnapshot.ts`, **not this file**). Call Qualification names the collection: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (`ringcentral_inbound_routes` plus effective-dated next `ringcentral_inbound_route_assignments`; webhook uses the shared cached book; each Call Log run loads one immutable book; “Target-number gating always uses `resolveRingCentralInboundRoute(snapshot, phone, callStartedAt)`. There is no static fallback.” — **this file never resolves a call**). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (runtime consumers import Registry commands / queries / resolvers rather than registry models — already-recommended Owner write, snapshot, health, overview, Lead Source projection, Granot create, and adoption still ask this getter). Already-recommended Owner write: [operations-registry-ring-central-registry.md](operations-registry-ring-central-registry.md) (`recordOrCorrectAnInboundNumber` / `validateRingCentralRoute` / `activateRingCentralRoute` / `reassignRingCentralRoute` / `deactivateRingCentralRoute` / `recordRingCentralRouteObservation` **ask** `getRingCentralInboundRouteModel` — **this file never records, never asks RingCentral, never closes an assignment, never forgets the cache**). Already-recommended inbound-number book: [operations-registry-ring-central-snapshot.md](operations-registry-ring-central-snapshot.md) (loader selects `{ ever_activated: true, validation_status: "valid" }` — **not** `active: true`; resolve lives on the snapshot — **this file never builds the book**). Already-recommended HTTP desk: [routes-ringcentral-registry.md](routes-ringcentral-registry.md) (**asks** Owner write — **never imports this file**). Already-recommended overview: [operations-registry-queries-overview.md](operations-registry-queries-overview.md) (**asks** the getter `countDocuments` total / `{ active: true }`). Already-recommended health: [operations-registry-queries-health.md](operations-registry-queries-health.md) (**asks** the getter `find({})` then `buildRingCentralHealthFindings` — `invalid` / active-without-exactly-one-open / assignment-target). Already-recommended Lead Source projection: [operations-registry-queries-lead-source-projection.md](operations-registry-queries-lead-source-projection.md) (**asks** the getter `find({ _id: { $in: routeIds } })`). Already-recommended Granot create: [granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md) (`assertSingleActiveRingCentralAssignment` asks `{ active: true, validation_status: "valid" }` after exactly one live assignment — **this file never creates a Lead**). Already-recommended adoption: [ringcentral-call-lead-convergence.md](ringcentral-call-lead-convergence.md) (`assertVerifiedRoute` asks the same `{ active: true, validation_status: "valid" }` — **this file never adopts**). Already-recommended Call Lead row: [models-call-lead.md](models-call-lead.md) (`ringcentral.route_id` `ref: "RingCentralInboundRoute"` — **a pointer, not this collection**). Already-recommended Source Company / first-class Feed: [models-lead-source-company.md](models-lead-source-company.md), [models-lead-source-granularity.md](models-lead-source-granularity.md) — **do not merge**. Already-recommended Picker selection: [models-google-picker-selection.md](models-google-picker-selection.md) (omitted getter, named `created_at` only, consume stamps `consumed_at` — **do not copy that fence here**). Distinct from next assignment interval: `RingCentralInboundRouteAssignment.ts` (collection `ringcentral_inbound_route_assignments`; unique partial `{ route: 1 }` where `active: true`; immutable `route` / company / Feed / `effective_from` — **this file never owns that collection**). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections does **not** name `ringcentral_inbound_routes`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the inbound-number card.” M5: `scripts/migrations/operations-registry-ringcentral.ts` asks Owner write plus `getRingCentralInboundRouteModel().createIndexes()`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — it does not define inbound number / inbound route / Call Qualification; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model.** Already-recommended `ringCentralRegistry.ts` is the **only** Owner write and last-seen import. Mongo **adapter** asks `getRingCentralInboundRouteModel()` after `connectMongo()`: create / patch `findOneAndUpdate` (upsert when no id; `$unset` validation + RingCentral ids when the unlocked phone changes), validate `findByIdAndUpdate`, activate / reassign `$set` `active` / `ever_activated` / `phone_locked` plus `$unset` archive fields, archive `$set` `active: false` / `archived_at` (does **not** `$unset` `phone_locked`), last-seen `$max` `last_seen_in_call_log_at` / `last_seen_in_webhook_at` plus optional `$addToSet` `observed_target_names` (no Registry Change). Already-recommended `ringCentralSnapshot.ts` asks the getter `find({ ever_activated: true, validation_status: "valid" })` — **not** `active: true`. Already-recommended overview asks the getter `countDocuments({})` / `{ active: true }`. Already-recommended health asks the getter `find({})`. Already-recommended Lead Source projection asks the getter `find({ _id: { $in: routeIds } })`. Already-recommended Granot create asks `{ _id, active: true, validation_status: "valid" }`. Already-recommended adoption asks the same pair. M5 asks `createIndexes()` on this getter. `granot-inbound-call-creation-policy.ts` and `dump-operations-name-link-inventory.ts` ask the getter. Tests: `ringCentralRegistry.test.ts` stubs the getter for activate / reassign / `can_deactivate` **gone** — **never constructs `new RingCentralInboundRoute`**. `ringCentralSnapshot.test.ts` asks `buildRingCentralRouteSnapshot` fixtures — **never this export**. `ownerLanguageDeck.test.ts` / `leadSourceProjection.test.ts` use the getter as fixtures. Replica tests create through the getter. There is **no** `RingCentralInboundRoute.test.ts`. There is **no** runtime import of default `RingCentralInboundRoute` except the getter returning it when `mongoose.connection.name === getMongoDatabaseName()`. Job Timeline does **not** hop this collection. Historical consolidation does **not** list `ringcentral_inbound_routes`. Already-recommended HTTP desk asks Owner write — **not this file**. Not this **interface**: `createOrUpdateRingCentralRoute` itself, `validateRingCentralRoute` itself, `activateRingCentralRoute` itself, `resolveRingCentralInboundRoute` itself, last-seen itself, `createLeadFromGranot` itself, `assertVerifiedRoute` itself.
- Seams callers need: default `RingCentralInboundRoute` (first-registered connection — the getter returns it when `mongoose.connection.name === getMongoDatabaseName()`; overview and historical consolidation do **not** import the default) vs `getRingCentralInboundRouteModel()` (selected `getMongoDatabaseName()` — Owner write, snapshot load, overview count, health load, Lead Source projection, Granot create, adoption, M5); unique required `phone_number` vs Registry `normalizePhoneNumberToE164Like` plus service-level `findOne({ phone_number, _id: { $ne } })`; schema `immutable` function `this.phone_locked === true` vs Registry `findOneAndUpdate` (document `save` immutable may **not** fire); `phone_locked` default `false` vs activate `$set` `true` forever vs archive that does **not** unlock; `active` default `false` vs snapshot that does **not** filter `active` vs Granot / adoption that require `active: true` **and** `valid`; `ever_activated` default `false` vs snapshot filter `ever_activated: true`; `validation_status` enum `"unvalidated" | "valid" | "invalid"` default `"unvalidated"` vs validator `"unavailable"` stored as `unvalidated`; `provider` enum `"ringcentral"` immutable default `"ringcentral"`; `timestamps: true` camelCase `createdAt` / `updatedAt` vs Picker named `created_at` only; default `__v` vs Picker `versionKey: false`; omitted `autoIndex: false` vs M5 `createIndexes()` (boot **and** M5 create the same unnamed clocks); next assignment interval vs this card. There is no record / validate / activate Domain Command **seam**. There is no HTTP **seam**. There is no resolve **seam**. There is no phone-fold **seam**.
- Split later (only if the file outgrows one sitting): this ~113-line file is one sitting if you read it as remember the inbound-number card on the selected Mongo database — one unique phone per card, lock that phone after first activate, start inactive and unvalidated, provider always RingCentral, archive never delete, default camelCase timestamps plus unnamed unique phone clock plus active / validation browse clocks plus sparse RingCentral id clocks, and the selected-database getter — never fold or record or validate or activate here, never resolve a call here, never write an assignment here, never merge this into the assignment interval. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `phone.ts` / `validation.ts` / `activate.ts`. Owner write stays already-recommended `ringCentralRegistry.ts`. Snapshot resolve stays already-recommended `ringCentralSnapshot.ts`. Next assignment interval stays `RingCentralInboundRouteAssignment.ts`. Already-recommended Call Lead `route_id` stays already-recommended `CallLead.ts`.

`RingCentralInboundRoute` is a Mongoose model name. The owner question is: *Owner just named a RingCentral inbound number in the catalog — or M5 is about to seed one from a leftover queue mapping. Hold the card on `ringcentral_inbound_routes`. Keep the folded phone unique so Registry cannot elect a second card. Start the card inactive, unlocked, and unvalidated. After first activate, lock that phone forever — archive must not unlock it. Remember whether the card is live, whether it was ever turned on, whether this RingCentral account can still see the number, the RingCentral ids validate stamped, last-seen Call Log / webhook `$max`, and `created_by`. If this process selected a different Mongo database, hand back that database’s inbound-number model. Do not fold the phone. Do not ask RingCentral. Do not turn the number on. Do not close an assignment. Do not decide which incoming call becomes a Call Lead. Do not invent a selected-database-less default so “this matches the Picker selection.” Do not add `active: true` to snapshot load so “archive hides the card from ingest.” Do not merge this into the next assignment interval.*

Who record / validate / activate / archive / stamp last-seen already lives in already-recommended `ringCentralRegistry.ts`. Who load / resolve already lives in already-recommended `ringCentralSnapshot.ts`. Who hold the assignment interval already lives in next `RingCentralInboundRouteAssignment.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the inbound-number card on the selected Mongo database — one unique phone per card, lock that phone after first activate, start inactive and unvalidated, provider always RingCentral, archive never delete, default camelCase timestamps plus unnamed unique phone clock plus active / validation browse clocks plus sparse RingCentral id clocks, and the selected-database getter — never fold or record or validate or activate here, never resolve a call here, never write an assignment here, never merge this into the assignment interval” story, not “a RingCentral inbound-route CRUD dump,” and not Record An Inactive Inbound Number / Load The Book Of Inbound Numbers themselves:

1. **Hold the inbound-number card** — collection `ringcentral_inbound_routes`, `timestamps: true` (mongoose camelCase `createdAt` / `updatedAt`), `toJSON` / `toObject` `{ virtuals: true }` (**no** virtuals are declared). **No** `autoIndex: false`. **No** `versionKey: false` (default `__v`). **No** hooks. Required `provider` enum `["ringcentral"]` default `"ringcentral"` `immutable: true`. Required trimmed `phone_number` `unique: true` `immutable` function `this.phone_locked === true`. Required `phone_locked` default `false`. Required trimmed `display_label`. Required `active` default `false` `index: true`. Required `ever_activated` default `false`. Optional `archived_at`. Optional trimmed `deactivation_reason`. Optional trimmed `ringcentral_phone_number_id` / `ringcentral_extension_id` / `ringcentral_queue_id` / `ringcentral_queue_name`. `observed_target_names` `[String]` default `[]`. Required `validation_status` enum `["unvalidated", "valid", "invalid"]` default `"unvalidated"` `index: true`. Optional trimmed `validation_code` / `validation_message`. Optional `validated_at`. Optional nested `validated_by` `_id: false` actor snapshot (`actor_type` / `actor_id` / `actor_label` / `actor_role` lowercase). Optional `last_seen_in_call_log_at` / `last_seen_in_webhook_at`. Required trimmed `created_from` default `"admin"`. Required nested `created_by` same actor snapshot. `RingCentralInboundRouteDocument` is `InferSchemaType` plus `_id`. This beat does **not** `create`. This beat does **not** fold E164. This beat does **not** ask RingCentral.

2. **Remember which unique phone belongs to which card, whether it is locked, whether it is live, whether it was ever turned on, whether this account can see it, and the last-seen clocks** — unique `phone_number` is the identity. Live writers fold `normalizePhoneNumberToE164Like` **before** they write. There is **no** E164 validator on this schema. `phone_locked` defaults `false`. First activate `$set`s `phone_locked: true`. Archive `$set`s `active: false` **and** `archived_at` and does **not** `$unset` `phone_locked`. Schema `immutable` on `phone_number` fires only on document `save`; Owner write uses `findOneAndUpdate` and fences the locked phone in `ringCentralRegistry.ts`. `active` default `false` matches Registry create. Snapshot loads `{ ever_activated: true, validation_status: "valid" }` and does **not** read `route.active`. Granot create and adoption require `{ active: true, validation_status: "valid" }`. `validation_status` has **no** `"unavailable"` — validator `"unavailable"` is stored `unvalidated`. Last-seen is `$max` without a Registry Change and without cache forget. This beat does **not** unique `display_label`. This beat does **not** unique an owner — there is **no** `owner_email` column.

3. **Stamp the unnamed clocks and hand back the selected-database model** — field `unique: true` on `phone_number` plus `index: true` on `active` and `validation_status`. Compound `{ active: 1, validation_status: 1 }`. Sparse `{ ringcentral_phone_number_id: 1 }` / `{ ringcentral_extension_id: 1 }` / `{ ringcentral_queue_id: 1 }`. There is **no** `RINGCENTRAL_INBOUND_ROUTE_INDEXES` catalog. There is **no** collection-name export. Default export `RingCentralInboundRoute` is `mongoose.models.RingCentralInboundRoute ?? mongoose.model(...)`. `getRingCentralInboundRouteModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Owner write / snapshot / overview / health / Lead Source projection / Granot create / adoption / M5 ask the getter. M5 also asks `createIndexes()`. This beat does **not** `syncIndexes` on boot. This beat does **not** delete the default export so “everyone must call the getter.”

There is no record-the-card operation. `createOrUpdateRingCentralRoute` writes this row through the getter. There is no ask-RingCentral operation. `validateRingCentralRoute` stamps `validation_status`. There is no turn-on operation. `activateRingCentralRoute` `$set`s `active` / `ever_activated` / `phone_locked` and the next assignment interval owns the open row. There is no resolve-a-call operation. `resolveRingCentralInboundRoute` lives on already-recommended snapshot. There is no create-a-Lead operation.

## Organization

Keep one file. This is the screenplay for “remember the inbound-number card on the selected Mongo database — one unique phone per card, lock that phone after first activate, start inactive and unvalidated, provider always RingCentral, archive never delete, default camelCase timestamps plus unnamed unique phone clock plus active / validation browse clocks plus sparse RingCentral id clocks, and the selected-database getter — never fold or record or validate or activate here, never resolve a call here, never write an assignment here, never merge this into the assignment interval.” Owner write / snapshot resolve / phone fold / account inventory / health findings / Granot “exactly one assignment” / adoption already live in deeper **modules**. Next assignment interval already lives in a sibling **module**. Do not pull those in. Do not invent a `RingCentralInboundRouteService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent an `autoIndex: false` **adapter** so “this matches Call Lead” without a paired proof that boot no longer creates the unique phone clock. Do not invent a snapshot `active: true` **adapter** so “archive hides the card from ingest.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `phone.ts` / `validation.ts` each get a file.

Do not move `createOrUpdateRingCentralRoute` into this file so “the row owns record.” Do not move `resolveRingCentralInboundRoute` into this file so “the card owns Call Qualification.” Do not move `normalizePhoneNumberToE164Like` into this file so “the schema owns the fold.” Do not merge this file into next `RingCentralInboundRouteAssignment.ts` so “one schema owns the card and the interval.” Do not merge this file into already-recommended `CallLead.ts` so “the Call Lead is the inbound number.” Do not merge this file into already-recommended `LeadSourceCompany.ts` so “one catalog schema owns companies and inbound numbers.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `RingCentralInboundRoute` | `inboundNumberCardOnTheDefaultConnection` | the getter returns this default model when `mongoose.connection.name` already is `getMongoDatabaseName()` |
| `getRingCentralInboundRouteModel` | `inboundNumberCardOnTheSelectedMongoDatabase` | Owner write, snapshot load, overview count, health load, Lead Source projection, Granot create, adoption, and M5 must follow `getMongoDatabaseName()` |
| `RingCentralInboundRouteDocument` | `InboundNumberCard` | inferred document + `_id` |

Keep the old names as one-line aliases until Owner write, snapshot, overview, health, Lead Source projection, Granot create, adoption, M5, inbound-policy script, dump, and replica tests migrate. Do not make callers learn `useDb` / `phone_locked` / `findOneAndUpdate` as the only domain language until those sites move. Do **not** delete the default `RingCentralInboundRoute` export so “everyone must call the getter” without a paired proof that the getter still returns the same first-registered model when the connection name matches. Do **not** delete the getter so “this matches the Picker selection” without a paired proof that Registry still writes the selected database. Do **not** re-export `createOrUpdateRingCentralRoute` / `resolveRingCentralInboundRoute` / `normalizePhoneNumberToE164Like` from this file so “the row records the card or resolves the call.”

**No class for the workflow.** The one type that *does* earn a name is the inbound-number-card identity contract:

```ts
type InboundNumberCardIdentity = {
  collection: "ringcentral_inbound_routes"
  phone_number_unique: true
  live_lookup_key: "normalizePhoneNumberToE164Like(phone_number)"
  phone_fold_lives_in_registry: true
  phone_locked_default: false
  activate_locks_phone_forever: true
  archive_unlocks_phone: false
  schema_immutable_phone_when_locked: true
  schema_immutable_fires_on_document_save_only: true
  registry_write_is_findOneAndUpdate: true
  provider: "ringcentral"
  provider_immutable: true
  active_default: false
  ever_activated_default: false
  validation_status_default: "unvalidated"
  validation_enum: ["unvalidated", "valid", "invalid"]
  unavailable_stored_as: "unvalidated"
  snapshot_load_filter: { ever_activated: true, validation_status: "valid" }
  snapshot_filters_active: false
  granot_and_adoption_require: { active: true, validation_status: "valid" }
  timestamps: { createdAt: true, updatedAt: true }
  versionKey: true
  selected_database_getter: true
  default_export_has_runtime_import: false
  autoIndex: true
  named_index_catalog: false
  m5_createIndexes: true
  unnamed_indexes: [
    { phone_number: 1, unique: true },
    { active: 1 },
    { validation_status: 1 },
    { active: 1, validation_status: 1 },
    { ringcentral_phone_number_id: 1, sparse: true },
    { ringcentral_extension_id: 1, sparse: true },
    { ringcentral_queue_id: 1, sparse: true },
  ]
}
```

That is the handoff from “this process remembered an inbound-number card” to “Registry may create it inactive, snapshot may load ever-activated valid cards without reading `active`, Granot create and adoption may refuse unless the card is live **and** valid, Mongo may unique the folded phone, and boot plus M5 create the unnamed clocks.” Do **not** add `{ snapshot_filters_active: true }` so “archive hides ingest.” Do **not** add `{ archive_unlocks_phone: true }` so “the Owner can reuse the number.” Do **not** add `{ selected_database_getter: false }` so “this matches the Picker selection.” Do **not** add `{ autoIndex: false }` so “this matches Call Lead.” Do **not** add `{ timestamps: { created_at: true, updated_at: false } }` so “this matches the Picker nonce.” Do **not** add `{ phone_fold_lives_in_registry: false }` so “the schema owns E164.”

Leave next `RingCentralInboundRouteAssignment.ts` on that file. Leave already-recommended `CallLead.ts` on that file. Leave already-recommended `LeadSourceCompany.ts` / `LeadSourceGranularity.ts` on those files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// RingCentralInboundRoute.ts
// Owner just named a RingCentral inbound number
// in the catalog — or M5 is about to seed one.
// Hold the card on ringcentral_inbound_routes.
// Keep the folded phone unique
// so Registry cannot elect a second card.
// Start inactive, unlocked, and unvalidated.
// After first activate, lock that phone forever.
// Archive must not unlock it.
// If this process selected a different Mongo database,
// hand back that database's inbound-number model.
// Do not fold the phone.
// Do not ask RingCentral.
// Do not turn the number on.
// Do not close an assignment.
// Do not decide which incoming call becomes a Call Lead.

// ── 1. Hold the inbound-number card ───────────────────────

const RingCentralInboundRouteSchema = new Schema(
  {
    provider: {
      type: String,
      enum: ["ringcentral"],
      required: true,
      default: "ringcentral",
      immutable: true,
    },
    phone_number: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      immutable: function (this: { phone_locked?: boolean }) {
        return this.phone_locked === true
      },
    },
    phone_locked: { type: Boolean, required: true, default: false },
    display_label: { type: String, required: true, trim: true },
    active: { type: Boolean, required: true, default: false, index: true },
    ever_activated: { type: Boolean, required: true, default: false },
    archived_at: { type: Date },
    deactivation_reason: { type: String, trim: true },
    ringcentral_phone_number_id: { type: String, trim: true },
    ringcentral_extension_id: { type: String, trim: true },
    ringcentral_queue_id: { type: String, trim: true },
    ringcentral_queue_name: { type: String, trim: true },
    observed_target_names: { type: [String], default: [] },
    validation_status: {
      type: String,
      enum: ["unvalidated", "valid", "invalid"],
      required: true,
      default: "unvalidated",
      index: true,
    },
    validation_code: { type: String, trim: true },
    validation_message: { type: String, trim: true },
    validated_at: { type: Date },
    validated_by: { type: registryActorSnapshotSchema },
    last_seen_in_call_log_at: { type: Date },
    last_seen_in_webhook_at: { type: Date },
    created_from: { type: String, required: true, trim: true, default: "admin" },
    created_by: { type: registryActorSnapshotSchema, required: true },
  },
  {
    collection: "ringcentral_inbound_routes",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// ── 2. Remember which unique phone belongs to which card

function rememberWhichUniquePhoneBelongsToWhichCardWhetherItIsLockedWhetherItIsLiveWhetherItWasEverTurnedOnWhetherThisAccountCanSeeItAndTheLastSeenClocks() {
  // unique phone_number
  // live lookup: normalizePhoneNumberToE164Like(phone_number)
  // no E164 validator on this schema
  // phone_locked default false — activate sets true forever
  // archive does not unlock
  // schema immutable fires on document save; Registry uses findOneAndUpdate
  // active default false — snapshot does not filter active
  // ever_activated default false — snapshot loads ever_activated + valid
  // Granot create / adoption require active + valid
  // validation_status unvalidated | valid | invalid
  // unavailable stores as unvalidated
  // last-seen is $max without a Registry Change
}

// ── 3. Stamp the unnamed clocks and hand back the selected-database model

RingCentralInboundRouteSchema.index({ active: 1, validation_status: 1 })
RingCentralInboundRouteSchema.index({ ringcentral_phone_number_id: 1 }, { sparse: true })
RingCentralInboundRouteSchema.index({ ringcentral_extension_id: 1 }, { sparse: true })
RingCentralInboundRouteSchema.index({ ringcentral_queue_id: 1 }, { sparse: true })

export const inboundNumberCardOnTheDefaultConnection =
  mongoose.models.RingCentralInboundRoute ??
  mongoose.model("RingCentralInboundRoute", RingCentralInboundRouteSchema)

export function inboundNumberCardOnTheSelectedMongoDatabase() {
  const dbName = getMongoDatabaseName()
  if (mongoose.connection.name === dbName) {
    return inboundNumberCardOnTheDefaultConnection
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true })
  return (
    db.models.RingCentralInboundRoute ??
    db.model("RingCentralInboundRoute", RingCentralInboundRouteSchema)
  )
}

export { inboundNumberCardOnTheDefaultConnection as RingCentralInboundRoute }
export { inboundNumberCardOnTheSelectedMongoDatabase as getRingCentralInboundRouteModel }
```

Read the primary path out loud: *Owner just named a RingCentral inbound number in the catalog. Remember it as one card: this unique folded phone, a display label, inactive, unlocked, unvalidated, provider RingCentral, created by this Owner. Registry folds the phone before it writes. First activate locks that phone forever, marks the card live and ever-activated, and the next assignment interval opens the live Feed. Snapshot later loads every card that was ever turned on and still carries a valid stamp — it does not ask whether the card is live right now, because archive already closed the assignment interval. Granot create and adoption still refuse unless the card is live and valid. Call Log and webhook may `$max` last-seen without a Registry Change. Do not fold from here. Do not ask RingCentral from here. Do not resolve the call from here. Do not write the assignment from here.*

## Precise logic I would tighten while renaming

1. **Operations Registry knowledge names the wrong file as the snapshot.** The Service lumps `ringCentralRegistry.ts` / `ringCentralValidation.ts` as “inbound-route snapshot used at Call Qualification time.” That sentence already names already-recommended `ringCentralSnapshot.ts`. Do not rewrite that Service from this rename so “the model owns Call Qualification.” Park the missing collection sentence for a later knowledge pass.

2. **Core Collections omits this file.** `schema-and-crud-inputs.mdc` does not name `ringcentral_inbound_routes`. Do not add that rule line from this rename.

3. **Schema `immutable` on `phone_number` may not fire on Registry writes.** `immutable: function () { return this.phone_locked === true }` is a document `save` fence. Owner write uses `findOneAndUpdate` and fences a locked phone in `ringCentralRegistry.ts` (`IMMUTABLE_FIELD`). Do not teach Registry to `save()` so “the schema owns lock” without a paired activate proof on already-recommended Owner write **interface**. Do not drop the service fence so “schema immutable is enough.”

4. **Snapshot does not filter `active`.** Loader selects `{ ever_activated: true, validation_status: "valid" }`. Archive stops ingest by closing the assignment interval. Do not add `active: true` to snapshot load so “archive hides the card from ingest” without a paired snapshot proof that a just-archived number with a still-open interval still misses — and that historical intervals still resolve.

5. **Granot create and adoption require live plus valid.** `assertSingleActiveRingCentralAssignment` and `assertVerifiedRoute` ask `{ active: true, validation_status: "valid" }`. Snapshot does not. Do not drop `active` from those asks so “Granot matches snapshot” without a paired create / adoption proof.

6. **`unavailable` is not a stored status.** Validator may return `"unavailable"`. `validationUpdate` stores `"unvalidated"`. Do not add `"unavailable"` to this enum so “the schema matches the validator” without a paired validate plus health proof (`registry.ringcentral_validation_failed` reads `invalid`, not `unvalidated`).

7. **Phone fold lives in Registry.** This file only trims. Do not add an E164 validator so “hand insert matches Registry” without a paired M5 / Registry proof.

8. **Unique phone is both a schema clock and a Registry find.** `unique: true` plus `findOne({ phone_number, _id: { $ne } })` → `DUPLICATE_IDENTIFIER`. Do not drop the service find so “Mongo unique is enough” without a paired create proof that remediation still points at the existing card.

9. **Archive never deletes and never unlocks.** `deactivateRingCentralRoute` `$set`s `active: false` / `archived_at`. Dependency preview counts Call Leads and still returns `can_deactivate: true`. Do not switch archive to `deleteOne` so “we match the consent hash.” Do not unlock `phone_locked` so “the Owner can reuse the number” without a paired archive plus create proof.

10. **Last-seen has no Registry Change and no cache forget.** `recordRingCentralRouteObservation` `$max`s `last_seen_in_*` and `$addToSet`s `observed_target_names`. Do not teach last-seen to ask `withRegistryMutation` so “every write is audited.” Do not forget `RINGCENTRAL_ROUTE_CACHE_KEY` from last-seen so “last-seen rebuilds the book.”

11. **Default export has no runtime import.** Every runtime ask uses `getRingCentralInboundRouteModel`. Already-recommended Source Company overview asks default `LeadSourceCompany.countDocuments`. This overview asks the getter. Do not delete the default so “everyone must call the getter” without a paired getter proof. Do not switch overview to the default so “this matches Source Company.”

12. **CamelCase timestamps plus `__v`.** Already-recommended Picker selection uses named `created_at` only and `versionKey: false`. Do not rename `createdAt` so “inbound matches Picker.” Do not drop `__v` so “this matches the nonce.”

13. **`toJSON` / `toObject` virtuals are on and unused.** This file declares no virtuals. Do not invent a virtual `current_assignment` so “the card owns the interval.”

14. **Actor snapshot is copied onto next Assignment.** `registryActorSnapshotSchema` is inline here and again on next `RingCentralInboundRouteAssignment.ts`. Do not extract a shared `registryActor.ts` from this rename so “one actor schema owns every Registry row.”

15. **M5 asks `createIndexes()` and boot already creates the same clocks.** `autoIndex` is the mongoose default. Do not set `autoIndex: false` so “this matches Call Lead” without a paired M5 plus boot proof.

16. **Software-map gap.** Job Timeline does not hop this collection. Historical consolidation does not list it. Already-recommended HTTP desk never imports this file. There is no `RingCentralInboundRoute.test.ts`. Do not invent those lines from this rename.

17. **Leave sibling modules alone.** `createOrUpdateRingCentralRoute` / `validateRingCentralRoute` / `activateRingCentralRoute` / `resolveRingCentralInboundRoute` / `normalizePhoneNumberToE164Like` / next assignment writes are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the selected-database getter, the inferred-row type, unique required `phone_number`, `phone_locked` default `false`, `immutable` function on `phone_number`, `provider` `"ringcentral"`, `active` default `false`, `ever_activated` default `false`, `validation_status` default `"unvalidated"`, required `created_by`, camelCase timestamps, default `__v`, the unnamed unique `{ phone_number: 1 }`, `{ active: 1, validation_status: 1 }`, sparse RingCentral id clocks, omitted `autoIndex: false`, and the omitted E164 validator. There is no `RingCentralInboundRoute.test.ts`. `ringCentralRegistry.test.ts` asks the getter as a stub. `ringCentralSnapshot.test.ts` asks `buildRingCentralRouteSnapshot` — **never this export**.

I would add a focused model file if that is the house style by then. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.RingCentralInboundRoute ?? mongoose.model(...)`
- `getRingCentralInboundRouteModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()` and registers on `useDb` otherwise
- Owner write asks the getter after `connectMongo()` and creates `{ provider: "ringcentral", phone_locked: false, active: false, ever_activated: false, validation_status: "unvalidated", observed_target_names: [], created_by }`
- Registry folds the phone **before** it writes
- a second card with the same folded phone misses (`DUPLICATE_IDENTIFIER`)
- activate `$set`s `phone_locked: true` / `active: true` / `ever_activated: true`
- archive `$set`s `active: false` and does **not** unlock `phone_locked`
- snapshot asks `{ ever_activated: true, validation_status: "valid" }` and does **not** filter `active`
- Granot create / adoption ask `{ active: true, validation_status: "valid" }`
- overview asks the getter `countDocuments`
- health asks `find({})`
- HTTP desk asks Owner write — **not this export**
- Job Timeline does not hop `ringcentral_inbound_routes`
- historical consolidation does not list `ringcentral_inbound_routes`
- live writers never persist an unfolded phone as the unique key
- `schema-and-crud-inputs.mdc` still does not name `ringcentral_inbound_routes`; this pass does not invent that rule line
- Operations Registry knowledge still names snapshot on the wrong file; this pass does not invent that line
- next `RingCentralInboundRouteAssignment` is a different collection; that file is out of this story
- already-recommended `CallLead` `ringcentral.route_id` is a pointer; that file is out of this story
- already-recommended `LeadSourceCompany` / `LeadSourceGranularity` are different collections; those files are out of this story
- already-recommended Picker selection is a different collection; that file is out of this story

I would not test Owner record / validate / activate, snapshot resolve, Granot create, adoption, Call Qualification, phone fold, or Job Timeline assemble from this file.

Do not add a test per helper (`theActivateLocksThePhone`, `theSnapshotOmitsActive`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `RingCentralInboundRouteService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `phone.ts` / `validation.ts` / `activate.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (Owner write’s `withRegistryMutation` is already that seam; do not invent a second one here).
- Treating `createOrUpdateRingCentralRoute` / `validateRingCentralRoute` / `activateRingCentralRoute` / `resolveRingCentralInboundRoute` / `normalizePhoneNumberToE164Like` / next assignment writes / already-recommended Call Lead ingest / already-recommended Picker selection as this story.
- Inventing a selected-database-less seam that has only the Picker default as an adapter.
- Inventing a snapshot-`active: true` seam that has only archive as an adapter.
- Silently adding `active: true` to snapshot load, unlocking `phone_locked` on archive, switching archive to `deleteOne`, adding `"unavailable"` to the enum, adding an E164 validator, deleting the getter, deleting the default export, flipping `autoIndex: false`, renaming `createdAt`, dropping `__v`, rewriting Operations Registry knowledge, adding a Core Collections line, adding a named-index catalog, or extracting a shared actor schema while recommending a rename.
- Pulling `createOrUpdateRingCentralRoute`, `resolveRingCentralInboundRoute`, or `normalizePhoneNumberToE164Like` into this file.
- Merging this collection into next `RingCentralInboundRouteAssignment`, already-recommended `CallLead`, already-recommended `LeadSourceCompany`, already-recommended `LeadSourceGranularity`, or already-recommended Picker selection.
- Silently reordering `connectMongo` versus getter create, validate-then-activate versus activate-then-validate, or assignment close versus card archive.
- Changing consume-style last-seen to delete-the-row so “we match the consent hash.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or next `RingCentralInboundRouteAssignment.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `RingCentralInboundRouteAssignment.ts` while writing this file.
