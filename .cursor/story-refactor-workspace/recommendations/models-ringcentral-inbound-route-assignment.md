# Remember The Inbound-Number To Live Call Feed Interval On The Selected Mongo Database — One Open Interval Per Card, Immutable Card Company Feed And Start, Close By Stamping Until And Active False Never Delete, Default CamelCase Timestamps Plus Unnamed Route-From Route-Until Unique-Open And Feed-Active Clocks, And The Selected-Database Getter — Never Activate Or Reassign Or Archive Here, Never Resolve A Call Here, Never Merge This Into The Inbound-Number Card — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 47 of this service — `RingCentralInboundRouteAssignment.ts`
- Remaining in this service: `LeadMessage.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/RingCentralInboundRouteAssignment.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (lumps already-recommended `ringCentralRegistry.ts` / already-recommended `ringCentralValidation.ts` as “inbound-route snapshot used at Call Qualification time” — that sentence names already-recommended `ringCentralSnapshot.ts`, **not this file**). Call Qualification names the collection: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (`ringcentral_inbound_routes` plus effective-dated `ringcentral_inbound_route_assignments`; webhook uses the shared cached book; each Call Log run loads one immutable book; “Target-number gating always uses `resolveRingCentralInboundRoute(snapshot, phone, callStartedAt)`. There is no static fallback.” — **this file never resolves a call**). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (runtime consumers import Registry commands / queries / resolvers rather than registry models — already-recommended Owner write, snapshot, health, overview, Lead Source projection, Granot create, and adoption still ask this getter). Already-recommended Owner write: [operations-registry-ring-central-registry.md](operations-registry-ring-central-registry.md) (`activateRingCentralRoute` / `reassignRingCentralRoute` **create** one row then `$set` the already-recommended card live / ever-activated / phone-locked; `deactivateRingCentralRoute` **closes** the open row then archives the card; list / get / dependency preview **ask** `getRingCentralInboundRouteAssignmentModel` — **this file never activates, never reassigns, never archives the card**). Already-recommended inbound-number book: [operations-registry-ring-central-snapshot.md](operations-registry-ring-central-snapshot.md) (loader `Assignment.find({})` sorted by `effective_from` — **not** `active: true`; resolve is `effective_from <= callStartedAt < effective_until` — **this file never builds the book**). Already-recommended HTTP desk: [routes-ringcentral-registry.md](routes-ringcentral-registry.md) (**asks** Owner write — **never imports this file**). Already-recommended overview: [operations-registry-queries-overview.md](operations-registry-queries-overview.md) (does **not** count this collection). Already-recommended health: [operations-registry-queries-health.md](operations-registry-queries-health.md) (**asks** the getter `find({ effective_until: { $exists: false } })` then `buildRingCentralHealthFindings` — active-without-exactly-one-open / `registry.ringcentral_assignment_inconsistent`). Already-recommended Lead Source projection: [operations-registry-queries-lead-source-projection.md](operations-registry-queries-lead-source-projection.md) (list count asks `{ source_granularity, effective_until missing, active: true }`; detail load asks `{ source_granularity, effective_until missing }` **without** `active: true`). Already-recommended Granot create: [granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md) (`assertSingleActiveRingCentralAssignment` asks every row for that company + Feed, then requires exactly one `active` in-window interval and a live valid card — **this file never creates a Lead**). Already-recommended adoption: [ringcentral-call-lead-convergence.md](ringcentral-call-lead-convergence.md) (`assertVerifiedRoute` `findById`s the qualified `routeAssignmentId` and requires `assignment.active === true` plus the call-start window — **this file never adopts**). Already-recommended Call Lead row: [models-call-lead.md](models-call-lead.md) (`ringcentral.route_assignment_id` `ref: "RingCentralInboundRouteAssignment"` — **a pointer, not this collection**). Already-recommended inbound-number card: [models-ringcentral-inbound-route.md](models-ringcentral-inbound-route.md) (collection `ringcentral_inbound_routes`; unique `phone_number`; `phone_locked` / `ever_activated` / `validation_status`; snapshot loads `{ ever_activated: true, validation_status: "valid" }` — **do not merge**). Already-recommended Source Company / first-class Feed: [models-lead-source-company.md](models-lead-source-company.md), [models-lead-source-granularity.md](models-lead-source-granularity.md) — **do not merge**. Distinct from leftover next SMS row: `LeadMessage.ts` (collection `lead_messages`; `form_lead` plus additive `lead_ref` — **this file never owns that collection**). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections does **not** name `ringcentral_inbound_route_assignments`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the assignment interval.” M5: `scripts/migrations/operations-registry-ringcentral.ts` asks Owner write plus `getRingCentralInboundRouteAssignmentModel().createIndexes()`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — it does not define inbound number / inbound route / assignment interval / Call Qualification; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model.** Already-recommended `ringCentralRegistry.ts` is the **only** Owner write. Mongo **adapter** asks `getRingCentralInboundRouteAssignmentModel()` after `connectMongo()`: list / get `find` by `route` (list without history adds `effective_until: { $exists: false }`; current is the row with no `effective_until`); dependency preview counts `{ route, effective_until missing, active: true }` plus all-history; activate / reassign `closeOpenAssignment` then `create` `{ route, source_company, source_granularity, effective_from: now, active: true, created_by }` (activate refuses if the card is already live **and** an open row exists; reassign refuses unless the card is live **and** an open row exists); archive closes then `$set`s the card `active: false`. `closeOpenAssignment` finds `{ route, effective_until missing }`, refuses more than one open row, then `updateOne` `$set` `{ effective_until: at, active: false }` — it does **not** `deleteOne`. Already-recommended `ringCentralSnapshot.ts` asks the getter `find({})` sorted by `effective_from` — **not** `active: true`. Already-recommended health asks `{ effective_until missing }`. Already-recommended Lead Source projection list asks `{ source_granularity, effective_until missing, active: true }`; detail asks `{ source_granularity, effective_until missing }`. Already-recommended Granot create asks `{ source_company, source_granularity }` then filters `active` plus the now-window. Already-recommended adoption `findById`s the qualified assignment. M5 asks `createIndexes()` on this getter. `granot-inbound-call-creation-policy.ts` and `dump-operations-name-link-inventory.ts` ask the getter. Tests: `RingCentralInboundRouteAssignment.test.ts` asks default `RingCentralInboundRouteAssignment.schema.indexes()` for the unique partial `{ route: 1 }` where `active: true` — **never constructs `new RingCentralInboundRouteAssignment`**. `ringCentralRegistry.test.ts` stubs the getter. `ringCentralSnapshot.test.ts` asks `buildRingCentralRouteSnapshot` fixtures — **never this export**. `ownerLanguageDeck.test.ts` / `leadSourceProjection.test.ts` use the getter as fixtures. Replica tests create through the getter. There is **no** runtime import of default `RingCentralInboundRouteAssignment` except the getter returning it when `mongoose.connection.name === getMongoDatabaseName()` and the model test reading `.schema.indexes()`. Job Timeline does **not** hop this collection. Historical consolidation does **not** list `ringcentral_inbound_route_assignments`. Already-recommended HTTP desk asks Owner write — **not this file**. Not this **interface**: `activateRingCentralRoute` itself, `reassignRingCentralRoute` itself, `deactivateRingCentralRoute` itself, `resolveRingCentralInboundRoute` itself, `createLeadFromGranot` itself, `assertVerifiedRoute` itself.
- Seams callers need: default `RingCentralInboundRouteAssignment` (first-registered connection — the getter returns it when `mongoose.connection.name === getMongoDatabaseName()`; the model test reads `.schema.indexes()` on the default) vs `getRingCentralInboundRouteAssignmentModel()` (selected `getMongoDatabaseName()` — Owner write, snapshot load, health load, Lead Source projection, Granot create, adoption, M5); unique partial `{ route: 1 }` where `active: true` vs Registry open find `{ route, effective_until missing }` vs snapshot resolve time window that does **not** read `assignment.active`; schema `immutable` on `route` / `source_company` / `source_granularity` / `effective_from` vs Registry `create` plus `updateOne` close (close never patches those four); `active` default `true` vs already-recommended card `active` default `false`; close `$set`s `effective_until` **and** `active: false` vs snapshot that still loads closed rows; Lead Source list `active: true` plus open vs detail open-only; Granot create `active` plus now-window vs snapshot time window only; `timestamps: true` camelCase `createdAt` / `updatedAt` vs leftover next SMS named clocks if any; default `__v`; omitted `autoIndex: false` vs M5 `createIndexes()` (boot **and** M5 create the same unnamed clocks); already-recommended inbound-number card vs this interval. There is no activate / reassign / archive Domain Command **seam**. There is no HTTP **seam**. There is no resolve **seam**. There is no phone-fold **seam**.
- Split later (only if the file outgrows one sitting): this ~92-line file is one sitting if you read it as remember the inbound-number to live call Feed interval on the selected Mongo database — one open interval per card, immutable card company Feed and start, close by stamping until and active false never delete, default camelCase timestamps plus unnamed route-from route-until unique-open and Feed-active clocks, and the selected-database getter — never activate or reassign or archive here, never resolve a call here, never merge this into the inbound-number card. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `interval.ts` / `activate.ts` / `reassign.ts`. Owner write stays already-recommended `ringCentralRegistry.ts`. Snapshot resolve stays already-recommended `ringCentralSnapshot.ts`. Already-recommended inbound-number card stays already-recommended `RingCentralInboundRoute.ts`. Already-recommended Call Lead `route_assignment_id` stays already-recommended `CallLead.ts`. Leftover next SMS row stays `LeadMessage.ts`.

`RingCentralInboundRouteAssignment` is a Mongoose model name. The owner question is: *Owner just turned on a RingCentral inbound-number card — or is pointing that live card at a different call Feed. Hold the interval on `ringcentral_inbound_route_assignments`. Keep exactly one `active` row per card so Registry cannot elect a second live Feed. Freeze the card, the company, the Feed, and the start the moment the row is born. Close by stamping `effective_until` and `active: false` — never delete the interval, because yesterday’s Call Log still has to resolve that window. If this process selected a different Mongo database, hand back that database’s assignment model. Do not turn the card on. Do not pick the Feed. Do not decide which incoming call becomes a Call Lead. Do not invent a selected-database-less default so “this matches the Picker selection.” Do not add `active: true` to snapshot load so “closed intervals vanish from history.” Do not merge this into the already-recommended inbound-number card.*

Who activate / reassign / archive already lives in already-recommended `ringCentralRegistry.ts`. Who load / resolve already lives in already-recommended `ringCentralSnapshot.ts`. Who hold the inbound-number card already lives in already-recommended `RingCentralInboundRoute.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the inbound-number to live call Feed interval on the selected Mongo database — one open interval per card, immutable card company Feed and start, close by stamping until and active false never delete, default camelCase timestamps plus unnamed route-from route-until unique-open and Feed-active clocks, and the selected-database getter — never activate or reassign or archive here, never resolve a call here, never merge this into the inbound-number card” story, not “a RingCentral assignment CRUD dump,” and not Activate An Inbound Number / Load The Book Of Inbound Numbers themselves:

1. **Hold the assignment interval** — collection `ringcentral_inbound_route_assignments`, `timestamps: true` (mongoose camelCase `createdAt` / `updatedAt`), `toJSON` / `toObject` `{ virtuals: true }` (**no** virtuals are declared). **No** `autoIndex: false`. **No** `versionKey: false` (default `__v`). **No** hooks. Required `route` `ObjectId` `ref: "RingCentralInboundRoute"` `immutable: true`. Required `source_company` `ObjectId` `ref: "LeadSourceCompany"` `immutable: true` `index: true`. Required `source_granularity` `ObjectId` `ref: "LeadSourceGranularity"` `immutable: true` `index: true`. Required `effective_from` `immutable: true`. Optional `effective_until`. Required `active` default `true` `index: true`. Required nested `created_by` `_id: false` actor snapshot (`actor_type` / `actor_id` / `actor_label` / `actor_role` lowercase). Optional trimmed `change_reason`. `RingCentralInboundRouteAssignmentDocument` is `InferSchemaType` plus `_id`. This beat does **not** `create`. This beat does **not** load a Feed. This beat does **not** ask RingCentral.

2. **Remember which unique open interval belongs to which card, which company and Feed it points at, when it started, and when it closed** — unique partial `{ route: 1 }` where `active: true` is the live-Feed identity. Open for Owner write / list-current / close / health / Lead Source detail is `effective_until` missing. Snapshot resolve is `effective_from <= callStartedAt` and (`effective_until` missing or `callStartedAt < effective_until`) and does **not** read `assignment.active`. Granot create and adoption require `assignment.active === true` **and** the now / call-start window. Close `$set`s both `effective_until` and `active: false`. Schema `immutable` on `route` / `source_company` / `source_granularity` / `effective_from` fires only on document `save`; Owner write `create`s those four and `updateOne`s only the close pair. There is **no** phone column. There is **no** `phone_locked`. There is **no** `validation_status`. There is **no** `owner_email` column. This beat does **not** unique `source_company`. This beat does **not** unique `source_granularity`.

3. **Stamp the unnamed clocks and hand back the selected-database model** — field `index: true` on `source_company`, `source_granularity`, and `active`. Compound `{ route: 1, effective_from: 1 }` / `{ route: 1, effective_until: 1 }` / unique partial `{ route: 1 }` where `active: true` / `{ source_granularity: 1, active: 1 }`. There is **no** `RINGCENTRAL_INBOUND_ROUTE_ASSIGNMENT_INDEXES` catalog. There is **no** collection-name export. Default export `RingCentralInboundRouteAssignment` is `mongoose.models.RingCentralInboundRouteAssignment ?? mongoose.model(...)`. `getRingCentralInboundRouteAssignmentModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Owner write / snapshot / health / Lead Source projection / Granot create / adoption / M5 ask the getter. The model test asks the default `.schema.indexes()`. M5 also asks `createIndexes()`. This beat does **not** `syncIndexes` on boot. This beat does **not** delete the default export so “everyone must call the getter.”

There is no turn-on operation. `activateRingCentralRoute` writes this row through the getter and `$set`s the already-recommended card. There is no point-at-a-different-Feed operation. `reassignRingCentralRoute` closes then creates. There is no archive operation. `deactivateRingCentralRoute` closes then archives the card. There is no resolve-a-call operation. `resolveRingCentralInboundRoute` lives on already-recommended snapshot. There is no create-a-Lead operation.

## Organization

Keep one file. This is the screenplay for “remember the inbound-number to live call Feed interval on the selected Mongo database — one open interval per card, immutable card company Feed and start, close by stamping until and active false never delete, default camelCase timestamps plus unnamed route-from route-until unique-open and Feed-active clocks, and the selected-database getter — never activate or reassign or archive here, never resolve a call here, never merge this into the inbound-number card.” Owner write / snapshot resolve / health findings / Granot “exactly one assignment” / adoption already live in deeper **modules**. Already-recommended inbound-number card already lives in a sibling **module**. Do not pull those in. Do not invent a `RingCentralInboundRouteAssignmentService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent an `autoIndex: false` **adapter** so “this matches Call Lead” without a paired proof that boot no longer creates the unique-open clock. Do not invent a snapshot `active: true` **adapter** so “closed intervals vanish from history.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `interval.ts` / `activate.ts` each get a file.

Do not move `activateRingCentralRoute` into this file so “the row owns turn-on.” Do not move `resolveRingCentralInboundRoute` into this file so “the interval owns Call Qualification.” Do not move `closeOpenAssignment` into this file so “the schema owns close.” Do not merge this file into already-recommended `RingCentralInboundRoute.ts` so “one schema owns the card and the interval.” Do not merge this file into already-recommended `CallLead.ts` so “the Call Lead is the assignment.” Do not merge this file into already-recommended `LeadSourceCompany.ts` / `LeadSourceGranularity.ts` so “one catalog schema owns companies, Feeds, and intervals.” Do not merge this file into leftover next `LeadMessage.ts` so “SMS is the assignment.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `RingCentralInboundRouteAssignment` | `inboundNumberToLiveCallFeedIntervalOnTheDefaultConnection` | the getter returns this default model when `mongoose.connection.name` already is `getMongoDatabaseName()`; the model test reads `.schema.indexes()` here |
| `getRingCentralInboundRouteAssignmentModel` | `inboundNumberToLiveCallFeedIntervalOnTheSelectedMongoDatabase` | Owner write, snapshot load, health load, Lead Source projection, Granot create, adoption, and M5 must follow `getMongoDatabaseName()` |
| `RingCentralInboundRouteAssignmentDocument` | `InboundNumberToLiveCallFeedInterval` | inferred document + `_id` |

Keep the old names as one-line aliases until Owner write, snapshot, health, Lead Source projection, Granot create, adoption, M5, inbound-policy script, dump, the model test, and replica tests migrate. Do not make callers learn `useDb` / `effective_until` / `updateOne` as the only domain language until those sites move. Do **not** delete the default `RingCentralInboundRouteAssignment` export so “everyone must call the getter” without a paired proof that the getter still returns the same first-registered model when the connection name matches **and** the model test still reads the unique-open clock. Do **not** delete the getter so “this matches the Picker selection” without a paired proof that Registry still writes the selected database. Do **not** re-export `activateRingCentralRoute` / `resolveRingCentralInboundRoute` / `closeOpenAssignment` from this file so “the row turns the card on or resolves the call.”

**No class for the workflow.** The one type that *does* earn a name is the assignment-interval identity contract:

```ts
type InboundNumberToLiveCallFeedIntervalIdentity = {
  collection: "ringcentral_inbound_route_assignments"
  unique_open_per_card: { route: 1, unique: true, partialFilterExpression: { active: true } }
  live_lookup_key: "route + missing effective_until"
  snapshot_resolve_window: "effective_from <= callStartedAt < effective_until"
  snapshot_reads_assignment_active: false
  snapshot_load_filter: {}
  close_sets: { effective_until: "at", active: false }
  close_deletes: false
  immutable_at_create: ["route", "source_company", "source_granularity", "effective_from"]
  schema_immutable_fires_on_document_save_only: true
  registry_open_is_create: true
  registry_close_is_updateOne: true
  active_default: true
  card_active_default: false
  granot_and_adoption_require_active_and_window: true
  lead_source_list_filter: { effective_until_missing: true, active: true }
  lead_source_detail_filter: { effective_until_missing: true }
  health_open_filter: { effective_until_missing: true }
  timestamps: { createdAt: true, updatedAt: true }
  versionKey: true
  selected_database_getter: true
  default_export_runtime_import: false
  default_export_model_test_reads_indexes: true
  autoIndex: true
  named_index_catalog: false
  m5_createIndexes: true
  unnamed_indexes: [
    { source_company: 1 },
    { source_granularity: 1 },
    { active: 1 },
    { route: 1, effective_from: 1 },
    { route: 1, effective_until: 1 },
    { route: 1, unique: true, partialFilterExpression: { active: true } },
    { source_granularity: 1, active: 1 },
  ]
}
```

That is the handoff from “this process remembered an inbound-number to live call Feed interval” to “Registry may create it open and later stamp until, snapshot may load every interval without reading `active`, Granot create and adoption may refuse unless one interval is live **and** in-window, Mongo may unique the open row per card, and boot plus M5 create the unnamed clocks.” Do **not** add `{ snapshot_reads_assignment_active: true }` so “closed intervals vanish from history.” Do **not** add `{ close_deletes: true }` so “we match the consent hash.” Do **not** add `{ selected_database_getter: false }` so “this matches the Picker selection.” Do **not** add `{ autoIndex: false }` so “this matches Call Lead.” Do **not** add `{ unique_open_per_card: { route: 1, unique: true } }` so “one interval ever per card.” Do **not** add `{ phone_number_unique: true }` so “the interval owns the inbound number.”

Leave already-recommended `RingCentralInboundRoute.ts` on that file. Leave already-recommended `CallLead.ts` on that file. Leave already-recommended `LeadSourceCompany.ts` / `LeadSourceGranularity.ts` on those files. Leave leftover next `LeadMessage.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// RingCentralInboundRouteAssignment.ts
// Owner just turned on a RingCentral inbound-number card —
// or is pointing that live card at a different call Feed.
// Hold the interval on ringcentral_inbound_route_assignments.
// Keep exactly one active row per card
// so Registry cannot elect a second live Feed.
// Freeze the card, the company, the Feed, and the start
// the moment the row is born.
// Close by stamping effective_until and active: false.
// Never delete the interval.
// If this process selected a different Mongo database,
// hand back that database's assignment model.
// Do not turn the card on.
// Do not pick the Feed.
// Do not decide which incoming call becomes a Call Lead.

// ── 1. Hold the assignment interval ───────────────────────

const RingCentralInboundRouteAssignmentSchema = new Schema(
  {
    route: {
      type: Schema.Types.ObjectId,
      ref: "RingCentralInboundRoute",
      required: true,
      immutable: true,
    },
    source_company: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceCompany",
      required: true,
      immutable: true,
      index: true,
    },
    source_granularity: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceGranularity",
      required: true,
      immutable: true,
      index: true,
    },
    effective_from: { type: Date, required: true, immutable: true },
    effective_until: { type: Date },
    active: { type: Boolean, required: true, default: true, index: true },
    created_by: { type: registryActorSnapshotSchema, required: true },
    change_reason: { type: String, trim: true },
  },
  {
    collection: "ringcentral_inbound_route_assignments",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// ── 2. Remember which unique open interval belongs to which card

function rememberWhichUniqueOpenIntervalBelongsToWhichCardWhichCompanyAndFeedItPointsAtWhenItStartedAndWhenItClosed() {
  // unique partial { route: 1 } where active: true
  // open for Owner write / list-current / close / health:
  //   effective_until missing
  // snapshot resolve: effective_from <= callStartedAt < effective_until
  // snapshot does not read assignment.active
  // Granot create / adoption require active plus the window
  // close $sets effective_until and active: false — never delete
  // schema immutable on route / company / Feed / from
  // fires on document save; Registry create + updateOne close
  // no phone column — the card owns the folded number
}

// ── 3. Stamp the unnamed clocks and hand back the selected-database model

RingCentralInboundRouteAssignmentSchema.index({ route: 1, effective_from: 1 })
RingCentralInboundRouteAssignmentSchema.index({ route: 1, effective_until: 1 })
RingCentralInboundRouteAssignmentSchema.index(
  { route: 1 },
  { unique: true, partialFilterExpression: { active: true } },
)
RingCentralInboundRouteAssignmentSchema.index({ source_granularity: 1, active: 1 })

export const inboundNumberToLiveCallFeedIntervalOnTheDefaultConnection =
  mongoose.models.RingCentralInboundRouteAssignment ??
  mongoose.model(
    "RingCentralInboundRouteAssignment",
    RingCentralInboundRouteAssignmentSchema,
  )

export function inboundNumberToLiveCallFeedIntervalOnTheSelectedMongoDatabase() {
  const dbName = getMongoDatabaseName()
  if (mongoose.connection.name === dbName) {
    return inboundNumberToLiveCallFeedIntervalOnTheDefaultConnection
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true })
  return (
    db.models.RingCentralInboundRouteAssignment ??
    db.model(
      "RingCentralInboundRouteAssignment",
      RingCentralInboundRouteAssignmentSchema,
    )
  )
}

export {
  inboundNumberToLiveCallFeedIntervalOnTheDefaultConnection as RingCentralInboundRouteAssignment,
}
export {
  inboundNumberToLiveCallFeedIntervalOnTheSelectedMongoDatabase as getRingCentralInboundRouteAssignmentModel,
}
```

Read the primary path out loud: *Owner just turned on a RingCentral inbound-number card and pointed it at a live call Feed. Remember that as one interval: this card, this company, this Feed, starting now, active, created by this Owner. Registry freezes those four the moment it creates the row. First activate also locks the already-recommended card’s phone forever. Reassign closes the open interval — stamps `effective_until` and `active: false` — then creates the next one. Archive closes the same way and then marks the card inactive; it does not delete yesterday’s window. Snapshot later loads every interval and resolves the call by the start clock, not by whether the interval is still the live Feed. Granot create and adoption still refuse unless exactly one interval is live and in-window. Do not turn the card on from here. Do not pick the Feed from here. Do not resolve the call from here. Do not merge this into the inbound-number card.*

## Precise logic I would tighten while renaming

1. **Operations Registry knowledge names the wrong file as the snapshot.** The Service lumps `ringCentralRegistry.ts` / `ringCentralValidation.ts` as “inbound-route snapshot used at Call Qualification time.” That sentence already names already-recommended `ringCentralSnapshot.ts`. Do not rewrite that Service from this rename so “the assignment model owns Call Qualification.” Park the missing collection sentence for a later knowledge pass.

2. **Core Collections omits this file.** `schema-and-crud-inputs.mdc` does not name `ringcentral_inbound_route_assignments`. Do not add that rule line from this rename.

3. **Open is not the same clock as `active`.** Owner write, list-current, close, health, and Lead Source detail treat open as `effective_until` missing. The unique partial treats live as `active: true`. Close writes both. Healthy data keeps them paired. Health `registry.ringcentral_assignment_inconsistent` is the desk when an open row is `active: false` or points at a dead Feed. Do not drop `active: false` from close so “open is enough” without a paired unique-open plus health proof. Do not drop the `effective_until` filter from close so “`active: true` is enough” without a paired activate / reassign proof that two rows with `effective_until` missing still miss.

4. **Snapshot does not filter `assignment.active`.** Loader is `Assignment.find({})`. Resolve is the start / until window. Archive stops *new* ingest by closing the interval; yesterday’s Call Log still has to resolve the closed window. Do not add `active: true` to snapshot load so “closed intervals vanish from history” without a paired snapshot proof that a call started inside a just-closed window still hits.

5. **Granot create and adoption require live plus the window.** `assertSingleActiveRingCentralAssignment` filters `active === true` and the now-window, then asks the already-recommended card `{ active: true, validation_status: "valid" }`. `assertVerifiedRoute` `findById`s the qualified assignment and requires `assignment.active === true` plus the call-start window. Snapshot does not read `assignment.active`. Do not drop `active` from those asks so “Granot matches snapshot” without a paired create / adoption proof.

6. **Lead Source list and detail disagree on `active`.** List count asks `{ source_granularity, effective_until missing, active: true }`. Detail load asks `{ source_granularity, effective_until missing }` and then hops already-recommended cards. Do not add `active: true` to detail so “detail matches list” without a paired projection proof that an inconsistent open row still appears on the desk. Do not drop `active: true` from list so “list matches detail” without a paired count proof.

7. **Schema `immutable` never sees close.** `route` / `source_company` / `source_granularity` / `effective_from` are `immutable: true` on document `save`. Owner write `create`s those four and `updateOne`s only `effective_until` / `active`. Do not teach Registry to `save()` the close so “the schema owns lock” without a paired activate / reassign proof. Do not make `effective_until` immutable so “the interval can never close.”

8. **Two open rows are a Registry dependency, not a schema miss.** `closeOpenAssignment` refuses `rows.length > 1`. The unique partial only fences `active: true`. A pair of `active: false` rows with missing `effective_until` can exist if someone wrote past Registry. Do not change the unique partial to `{ route: 1 }` without a filter so “one interval ever per card” without a paired historical-window plus snapshot proof.

9. **Close never deletes.** `updateOne` `$set`s `effective_until` / `active: false`. Do not switch close to `deleteOne` so “we match the consent hash” without a paired Call Log plus snapshot proof that a call started in the deleted window still misses — and that is the wrong miss.

10. **`active` default is the opposite of the already-recommended card.** This file defaults `true`. The card defaults `false`. Activate creates `{ active: true }` here and `$set`s the card live. Do not flip this default to `false` so “assignment matches the card” without a paired activate plus unique-open proof.

11. **There is no phone on this file.** The already-recommended card owns `phone_number` and the fold. Snapshot folds `route.phone_number` when it builds the book. Do not add `phone_number` here so “the interval owns Call Qualification” without a paired card plus snapshot proof.

12. **Actor snapshot is copied from the already-recommended card.** `registryActorSnapshotSchema` is inline here and again on already-recommended `RingCentralInboundRoute.ts`. Do not extract a shared `registryActor.ts` from this rename so “one actor schema owns every Registry row.”

13. **Default export has no runtime import.** Every runtime ask uses `getRingCentralInboundRouteAssignmentModel`. The model test asks the default `.schema.indexes()`. Already-recommended inbound-number overview asks the card getter, not this collection. Do not delete the default so “everyone must call the getter” without a paired getter **and** model-test proof. Do not switch the model test to the getter so “this matches Owner write” without that same proof.

14. **CamelCase timestamps plus `__v`.** Already-recommended Picker selection uses named `created_at` only and `versionKey: false`. Do not rename `createdAt` so “assignment matches Picker.” Do not drop `__v` so “this matches the nonce.”

15. **`toJSON` / `toObject` virtuals are on and unused.** This file declares no virtuals. Do not invent a virtual `route` populate so “the interval owns the card.”

16. **M5 asks `createIndexes()` and boot already creates the same clocks.** `autoIndex` is the mongoose default. Do not set `autoIndex: false` so “this matches Call Lead” without a paired M5 plus boot proof. Do not drop the model test’s unique-partial assertion so “indexes are an implementation detail.”

17. **Software-map gap.** Job Timeline does not hop this collection. Historical consolidation does not list it. Already-recommended HTTP desk never imports this file. Already-recommended overview does not count it. Do not invent those lines from this rename.

18. **Leave sibling modules alone.** `activateRingCentralRoute` / `reassignRingCentralRoute` / `deactivateRingCentralRoute` / `resolveRingCentralInboundRoute` / `closeOpenAssignment` / already-recommended card writes are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the selected-database getter, the inferred-row type, required immutable `route` / `source_company` / `source_granularity` / `effective_from`, optional `effective_until`, `active` default `true`, required `created_by`, camelCase timestamps, default `__v`, the unnamed `{ route: 1, effective_from: 1 }` / `{ route: 1, effective_until: 1 }` / unique partial `{ route: 1 }` where `active: true` / `{ source_granularity: 1, active: 1 }`, omitted `autoIndex: false`, and the omitted phone column. `RingCentralInboundRouteAssignment.test.ts` asks the default `.schema.indexes()` for that unique partial. `ringCentralRegistry.test.ts` asks the getter as a stub. `ringCentralSnapshot.test.ts` asks `buildRingCentralRouteSnapshot` — **never this export**.

I would keep that focused model file. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.RingCentralInboundRouteAssignment ?? mongoose.model(...)`
- `getRingCentralInboundRouteAssignmentModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()` and registers on `useDb` otherwise
- Owner write asks the getter after `connectMongo()` and creates `{ route, source_company, source_granularity, effective_from, active: true, created_by }`
- a second `active: true` row for the same card misses (unique partial)
- activate refuses when the card is already live **and** an open row exists
- reassign refuses unless the card is live **and** an open row exists
- close `$set`s `effective_until` and `active: false` and does **not** `deleteOne`
- two open rows (`effective_until` missing) miss as a Registry dependency
- snapshot asks `find({})` and does **not** filter `assignment.active`
- snapshot resolve uses `effective_from <= callStartedAt < effective_until`
- Granot create / adoption require `assignment.active` plus the window
- health asks `{ effective_until missing }`
- Lead Source list asks `{ effective_until missing, active: true }`; detail asks `{ effective_until missing }`
- HTTP desk asks Owner write — **not this export**
- Job Timeline does not hop `ringcentral_inbound_route_assignments`
- historical consolidation does not list `ringcentral_inbound_route_assignments`
- live writers never persist a phone on this row
- `schema-and-crud-inputs.mdc` still does not name `ringcentral_inbound_route_assignments`; this pass does not invent that rule line
- Operations Registry knowledge still names snapshot on the wrong file; this pass does not invent that line
- already-recommended `RingCentralInboundRoute` is a different collection; that file is out of this story
- already-recommended `CallLead` `ringcentral.route_assignment_id` is a pointer; that file is out of this story
- already-recommended `LeadSourceCompany` / `LeadSourceGranularity` are different collections; those files are out of this story
- leftover next `LeadMessage` is a different collection; that file is out of this story

I would not test Owner activate / reassign / archive, snapshot resolve, Granot create, adoption, Call Qualification, or Job Timeline assemble from this file.

Do not add a test per helper (`theCloseStampsUntil`, `theSnapshotOmitsActive`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `RingCentralInboundRouteAssignmentService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `interval.ts` / `activate.ts` / `reassign.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (Owner write’s `withRegistryMutation` is already that seam; do not invent a second one here).
- Treating `activateRingCentralRoute` / `reassignRingCentralRoute` / `deactivateRingCentralRoute` / `resolveRingCentralInboundRoute` / `closeOpenAssignment` / already-recommended inbound-number card writes / already-recommended Call Lead ingest / leftover next SMS as this story.
- Inventing a selected-database-less seam that has only the Picker default as an adapter.
- Inventing a snapshot-`active: true` seam that has only archive as an adapter.
- Silently adding `active: true` to snapshot load, switching close to `deleteOne`, dropping `active: false` from close, flipping `active` default to `false`, adding `phone_number`, deleting the getter, deleting the default export, flipping `autoIndex: false`, renaming `createdAt`, dropping `__v`, rewriting Operations Registry knowledge, adding a Core Collections line, adding a named-index catalog, uniquing `{ route: 1 }` without the `active: true` filter, or extracting a shared actor schema while recommending a rename.
- Pulling `activateRingCentralRoute`, `resolveRingCentralInboundRoute`, or `closeOpenAssignment` into this file.
- Merging this collection into already-recommended `RingCentralInboundRoute`, already-recommended `CallLead`, already-recommended `LeadSourceCompany`, already-recommended `LeadSourceGranularity`, or leftover next `LeadMessage`.
- Silently reordering `connectMongo` versus getter create, close-then-create versus create-then-close, or assignment close versus card archive.
- Changing close to delete-the-row so “we match the consent hash.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or leftover next `LeadMessage.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `LeadMessage.ts` while writing this file.
