# Remember The Append-Only Mutation Evidence On The Selected Mongo Database — Unique Aggregate Plus Next Revision, Contact And Delete Reference-Only With No Values, Forbidden Raw Paths, Adjacent Nonnegative Revisions, Write-Once Hooks, Named Clocks The Migration Applies, Selected-Database Getter — Never Diff Or Stamp Here, Never Hash Contact, Never Rewrite A Prior Change, Never Auto-Create Indexes On Boot — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 53 of this service — `EntityChange.ts`
- Remaining in this service: `DomainCommandExecution.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/EntityChange.ts`
- Knowledge: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) section **EntityChange** (System of Record is Mongo; the executor owns one transaction, the durable Command, append-only `entity_changes`, aggregate revision stamps, and queued Sheet Sync intent — **this file never diffs named paths, never stamps `last_change_*`, never applies a command**). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections **does** name `EntityChange` (`entity_changes`) as append-only mutation evidence; unique `{ entity.model, entity.id, revision_after }` plus `{ command_execution_id }`, `{ entity.model, entity.id, applied_at: -1 }`, and `{ changed_paths, applied_at: -1 }`; contact/address/`$deleted` are `reference_only` with no raw values; application updates/deletes are rejected. Do not rewrite that paragraph from this rename so “the Core Collections list invented hashed contact.” This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — it does **not** define Entity Change; knowledge links [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR-0001 copies. Already-recommended writer: [domain-commands-entity-change.md](domain-commands-entity-change.md) (`persistEntityChangeMutations` **asks** `getEntityChangeModel()`, `new Change({ _id: change_id })`, `save({ session })`, then CAS-stamps a surviving aggregate — **this file never collects, never stamps**). Already-recommended `$inc` CAS: [granot-lifecycle-aggregate-revision.md](granot-lifecycle-aggregate-revision.md) — **do not merge**. Already-recommended Form / Call / Booking / Cancellation / Record Link rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md), [models-booked-lead.md](models-booked-lead.md), [models-cancelled-lead.md](models-cancelled-lead.md), [models-granot-record-link.md](models-granot-record-link.md) (`last_change_id` refs `"EntityChange"` via leftover `granotLifecycleSchemas.ts` — **they are not this collection**). Already-recommended public employee-submit window bag: [models-public-submission-throttle-bucket.md](models-public-submission-throttle-bucket.md) (collection `public_submission_throttle_buckets`, default-connection only, unnamed TTL — **do not merge**). Already-recommended confirmation-SMS capacity: [models-lead-message-rate-limit.md](models-lead-message-rate-limit.md) — **do not merge**. Already-recommended Sheets minute budget: [models-sheet-sync-quota-bucket.md](models-sheet-sync-quota-bucket.md) — **do not merge**. Already-recommended Owner case: [models-booking-lead-reconciliation-case.md](models-booking-lead-reconciliation-case.md) — **do not merge**. Already-recommended Job Timeline hop: [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (raw `db.collection("entity_changes")` by Lead / Booking / Cancellation id; maps `command_name` / `applied_at` / `changed_paths` / `decision_id` and **never** field values — **does not import this file**). Already-recommended historical apply: [historical-consolidation-apply.md](historical-consolidation-apply.md) (`SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and **omits** this name). Already-recommended Granot timeline read: [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`getEntityChangeModel().find({ $or: entityRefs })` — **never persist**). Distinct from leftover next durable Command: leftover next `DomainCommandExecution.ts` — **do not merge**. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass. CONTRADICTIONS already names the copied `CONTACT_OR_ADDRESS_PATH` plus `FORBIDDEN_RAW_PATH` only on this file — do not silently merge those regexes.
- Callers: **selected-database getter is the write interface; default model is the hook / replica-count interface.** Already-recommended `domainCommands/entityChange.ts` is the **only** runtime writer: `persistEntityChangeMutations` **asks** `getEntityChangeModel()`, constructs `new Change({ _id: mutation.change_id, ... })`, `save({ session })`, then stamps a surviving Form / Call / Booking / Cancellation / Record Link. Already-recommended `existingWrites.ts` / `bookings.ts` and leftover Granot `createLeadFromGranot.ts` / `synchronizeLeadFromGranot.ts` / `bookingConfirmation.ts` / `bookingOwnerCommands.ts` / `connectBookingToLead.ts` / `referralBooking.ts` / `releaseOwnerCommands.ts` / leftover discrepancy / leftover RingCentral `callLeadConvergence.service.ts` **ask** persist — **they never import this file**. Already-recommended `granotLifecycle/projections.ts` **asks** `getEntityChangeModel().find({ $or: entityRefs }).lean()`. Already-recommended Job Timeline Mongo hop **asks** raw `entity_changes` and **does not** import this file. Leftover `scripts/migrations/granot-lifecycle-indexes.ts` **asks** `ENTITY_CHANGE_INDEXES` / `ENTITY_CHANGE_COLLECTION` (report-first; non-unique creates first; unique `{ entity.model, entity.id, revision_after }` after collision inventory). Tests: `EntityChange.test.ts` AC-32 **asks** default `EntityChange` + `getEntityChangeModel()` (named collection, four exact indexes, adjacent revisions, contact/`$deleted` `reference_only`, JSON omits payload / headers / unmasked contact, save and query hooks reject post-insert mutation — **does not** open a live write). Already-recommended `entityChange.test.ts` AC-32 classify / builder **asks** `DELETED_ENTITY_CHANGE_PATH` only. Already-recommended `entityChange.integration.test.ts` opt-in replica **asks** default `EntityChange.find`. Leftover RingCentral replica tests **ask** default `EntityChange.countDocuments` / `collection.deleteMany`. Leftover Granot Referral / Release replica tests **ask** `getEntityChangeModel()`. Leftover operations-registry projection tests stub `getEntityChangeModel().create`. Not this **interface**: `persistEntityChangeMutations` itself, `collectDocumentFieldChanges` itself, `compareAndSwapDomainRevision` itself, leftover next `DomainCommandExecution` itself, already-recommended Job Timeline assemble itself.
- Seams callers need: default `EntityChange` (first-registered connection — model tests and some replica counts) vs `getEntityChangeModel()` (selected `getMongoDatabaseName()` — persist and Granot timeline / replica writes); `autoIndex: false` vs leftover `pnpm migration:granot-lifecycle:indexes` apply; named `ENTITY_CHANGE_INDEXES` catalog (unique aggregate + next revision first among four) vs boot that must **not** create them; `new` + `save({ session })` through the getter vs **no** `createEntityChange` helper vs **no** `findOneAndUpdate`; write-once `pre("save")` plus query hooks on update / replace / delete vs already-recommended persist that only inserts; `timestamps: false` plus required `applied_at` vs already-recommended public throttle camelCase `createdAt`; default `__v`; default ObjectId `_id` that persist preallocates so stamp and row share one id; `provenance` as `Schema.Types.Mixed` (validate requires `source_system` + actor + initiator; optional `observation_channel` must be a known channel); `entity.model` enum `ENTITY_REF_MODELS` (includes Granot cases / discrepancies persist **never** stamps). There is no persist-helper **adapter** on this file. There is no HTTP **seam**. There is no hashed-contact **adapter**. There is no Customer / Agent **adapter**.
- Split later (only if the file outgrows one sitting): this ~323-line file is one sitting if you read it as remember the append-only mutation evidence on the selected Mongo database — unique aggregate plus next revision, contact and delete reference-only with no values, forbidden raw paths, adjacent nonnegative revisions, write-once hooks, named clocks the migration applies, selected-database getter — never diff or stamp here, never hash contact, never rewrite a prior change, never auto-create indexes on boot. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `validate.ts` / `hooks.ts`. Persist stays already-recommended `domainCommands/entityChange.ts`. Leftover next Command stays leftover next `DomainCommandExecution.ts`. Already-recommended public throttle / SMS capacity / Sheets minute budget stay those files.

`EntityChange` is a Mongoose model name. The owner question is: *Someone already mutated a Form Lead, Call Lead, Booking, Cancellation, or Record Link inside the named command’s Mongo write, and already decided which paths changed. Hold one append-only row on `entity_changes`. That row is this aggregate plus the next revision — one pair cannot have two rows. Remember that contact, address, or delete changed, and do not write the value — not even a hash. Low-risk relationship and lifecycle values may keep before and after. Refuse payload, headers, secrets, and tokens on any path. The next revision must be this one plus one. After insert, nobody may update, replace, or delete the row. If this process selected a different Mongo database, hand back that database’s model. Named clocks live on the schema so the reviewed migration can apply them. Do not auto-create indexes on boot. Do not diff the named paths. Do not stamp `last_change_id`. Do not invent hashed contact. Do not merge this into the leftover next Command.*

Who collect / classify / persist / stamp already lives in already-recommended `domainCommands/entityChange.ts`. Who apply the named command already lives in already-recommended `idempotency.ts`. Who hop Job Timeline already lives in already-recommended `mongo-evidence-loader.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the append-only mutation evidence on the selected Mongo database — unique aggregate plus next revision, contact and delete reference-only with no values, forbidden raw paths, adjacent nonnegative revisions, write-once hooks, named clocks the migration applies, selected-database getter — never diff or stamp here, never hash contact, never rewrite a prior change, never auto-create indexes on boot” story, not “an EntityChange CRUD dump,” and not Append This Entity Change itself:

1. **Hold the append-only mutation evidence row** — collection `entity_changes`, `timestamps: false`, `strict: true`, `autoIndex: false`. **No** `minimize: false`. **No** `toJSON` / `toObject` virtuals. **No** `versionKey: false` (default `__v`). Default ObjectId `_id`. Required nested `entity` `{ model enum ENTITY_REF_MODELS, id trimmed string }` `{ _id: false }`. Required `command_execution_id` ObjectId. Required trimmed `command_name`. Required `provenance` Mixed. Required `changed_paths` string array default `[]`. Required `fields` subdocs default `[]` (`path`, `value_mode` enum `stored` | `hashed` | `reference_only`, optional Mixed `before` / `after`, optional trimmed `before_hash` / `after_hash`). Required `revision_before` / `revision_after` Number `min: 0` plus `isNonnegativeIntegerRevision`. Required `applied_at` Date. `EntityChangeDocument` is the typed row. This beat does **not** walk named path lists. This beat does **not** `$set` `last_change_id`.

2. **Remember which aggregate revision this is — and hide contact, delete, and forbidden raw paths** — unique `{ entity.model, entity.id, revision_after }` is the identity. `pre("validate")` requires `revision_after === revision_before + 1`; `changed_paths` unique, locale-sorted, duplicate-free, and 1:1 with `fields.path`; contact / address / `$deleted` (`DELETED_ENTITY_CHANGE_PATH`) must be `reference_only` with **no** values or hashes; any `reference_only` field refuses values and hashes; `hashed` refuses raw before/after and requires `before_hash` or `after_hash` (reserved — already-recommended persist never emits it); `FORBIDDEN_RAW_PATH` (`payload` / `headers` / `secret` / `credential` / `authorization` / `cookie` / `password` / `token` / `api_key`) refuses the path; provenance requires a known `source_system` (`vantage` | `granot` | `ringcentral`) plus actor and initiator; optional `observation_channel` must be a leftover `OBSERVATION_CHANNELS` value. This beat does **not** classify unknown future paths (already-recommended persist already hid those before save). This beat does **not** SHA-256 contact.

3. **Refuse rewrite, stamp the named clocks, and bind the selected-database getter** — `pre("save")` allows `isNew` only; otherwise throw `EntityChange evidence is write-once`. Query hooks on `updateOne` / `updateMany` / `findOneAndUpdate` / `replaceOne` / `findOneAndReplace` / `deleteOne` / `deleteMany` / `findOneAndDelete` throw `EntityChange evidence cannot be updated, replaced, or deleted`. `ENTITY_CHANGE_INDEXES` declares four named clocks: unique `entity_change_entity_revision_unique`, `entity_change_command_execution_id`, `entity_change_entity_applied`, `entity_change_changed_paths_applied`. Default export `EntityChange` is `mongoose.models.EntityChange ?? mongoose.model(...)`. `getEntityChangeModel()` returns that default when `mongoose.connection.name === getMongoDatabaseName()`, else `useDb(..., { useCache: true })`. Leftover `pnpm migration:granot-lifecycle:indexes` applies non-unique first, then the unique revision key after collision inventory. This beat does **not** `createIndexes()` at boot. This beat does **not** delete the getter so “everyone uses the default like the public throttle.”

There is no collect operation. `collectDocumentFieldChanges` walks allowlists next door. There is no stamp operation. `stampAggregateRevision` `$set`s `last_change_*` next door. There is no HTTP list. Nobody pages these rows.

## Organization

Keep one file. This is the screenplay for “remember the append-only mutation evidence on the selected Mongo database — unique aggregate plus next revision, contact and delete reference-only with no values, forbidden raw paths, adjacent nonnegative revisions, write-once hooks, named clocks the migration applies, selected-database getter — never diff or stamp here, never hash contact, never rewrite a prior change, never auto-create indexes on boot.” Collect / persist / stamp already live in already-recommended `domainCommands/entityChange.ts`. Apply-once already lives on already-recommended `idempotency.ts`. `$inc` CAS already lives on already-recommended `aggregateRevision.ts`. Job Timeline hop already lives on already-recommended `mongo-evidence-loader.ts`. Leftover next Command already lives in a sibling **module**. Already-recommended public throttle / SMS capacity / Sheets minute budget / Owner case already live in sibling **modules**. Do not pull those in. Do not invent an `EntityChangeService` class. Do not invent a begin / complete Domain Command **seam** on this file. Do not invent a hashed-contact **adapter** so “the reserved mode is used.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `validate.ts` / `hooks.ts` each get a file.

Do not move `persistEntityChangeMutations` into this file so “the model owns the diff.” Do not move `stampAggregateRevision` into this file so “save stamps the Lead.” Do not merge this file into leftover next `DomainCommandExecution.ts` so “one row owns the Command and the Change.” Do not merge this file into already-recommended `PublicSubmissionThrottleBucket.ts` so “one bag owns throttle and mutation evidence.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getEntityChangeModel` | `appendOnlyMutationEvidenceOnTheSelectedDatabase` | persist and Granot timeline **ask** the selected database |
| `EntityChange` | `appendOnlyMutationEvidenceOnTheDefaultConnection` | model tests and some replica counts **ask** the first-registered connection |
| `ENTITY_CHANGE_COLLECTION` | `theMutationEvidenceCollectionName` | leftover migration and Job Timeline hop the string `entity_changes` |
| `ENTITY_CHANGE_INDEXES` | `theNamedMutationEvidenceClocks` | leftover migration applies non-unique first, then the unique revision key |
| `ENTITY_CHANGE_MODEL_NAME` | `theMutationEvidenceModelName` | `"EntityChange"` — Form / Call `last_change_id` refs this name |
| `DELETED_ENTITY_CHANGE_PATH` | `theDeleteDescriptorPath` | `"$deleted"` — persist builds `reference_only` with no values |
| `ENTITY_CHANGE_SOURCE_SYSTEMS` / `ENTITY_CHANGE_VALUE_MODES` | `whoWroteThisBook` / `howThisPathIsRemembered` | `vantage` \| `granot` \| `ringcentral`; `stored` \| `hashed` \| `reference_only` |
| `EntityChangeDocument` / `EntityChangeField` / `EntityChangeProvenance` | `ThisMutationEvidenceRow` | typed row + field + Mixed provenance |

Keep the old names as one-line aliases until already-recommended persist, leftover Granot timeline, leftover migration, and model tests migrate. Do not make callers learn `revision_after` / `value_mode` as the only domain language until those sites move. Do **not** delete `getEntityChangeModel` so “this matches the public throttle.” Do **not** add `createEntityChange` so “SMS save matches the Change.” Do **not** re-export `persistEntityChangeMutations` / `collectDocumentFieldChanges` from this file so “the model diffs.” Do **not** drop `hashed` from the enum so “unused modes vanish” — Core Collections and knowledge call it reserved.

**No class for the workflow.** The one type that *does* earn a name is the append-only mutation-evidence identity contract:

```ts
type AppendOnlyMutationEvidenceIdentity = {
  collection: "entity_changes"
  unique_entity_model_plus_id_plus_revision_after: true
  revision_after_equals_revision_before_plus_one: true
  contact_address_delete_are_reference_only: true
  stores_raw_contact: false
  stores_contact_hash: false
  hashed_mode_reserved: true
  forbidden_raw_paths_rejected: true
  write_once: true
  application_update_or_delete: false
  timestamps: false
  applied_at_is_the_clock: true
  versionKey: true
  object_id: true
  persist_preallocates_id: true
  selected_database_getter: true
  save_through_getter: true
  autoIndex: false
  named_index_catalog: true
  boot_creates_clocks: false
  migration: "pnpm migration:granot-lifecycle:indexes"
  model_test: true
  core_collections_names_this: true
  historical_side_effect: false
  job_timeline_hops_raw_collection: true
  job_timeline_imports_this: false
}
```

That is the handoff from “this process remembered an append-only mutation-evidence row” to “identity is aggregate plus next revision, contact never lands here, rewrite is refused, the migration owns the clocks, and persist asks the selected-database getter.” Do **not** add `{ stores_contact_hash: true }` so “the reserved mode is used.” Do **not** add `{ selected_database_getter: false }` so “this matches the public throttle.” Do **not** add `{ autoIndex: true }` so “boot matches the Owner case.” Do **not** add `{ timestamps: true }` so “this matches SMS.”

Leave already-recommended `domainCommands/entityChange.ts` on that file. Leave leftover next `DomainCommandExecution.ts` on that file. Leave already-recommended `PublicSubmissionThrottleBucket.ts` on that file. Leave already-recommended Form / Call / Booking on those files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// EntityChange.ts
// Someone already mutated a Lead, Booking, Cancellation, or Record Link
// inside the named command’s Mongo write.
// Hold one append-only row on entity_changes.
// That row is this aggregate plus the next revision.
// Remember that contact changed. Do not write the phone.
// Refuse payload, headers, secrets, and tokens.
// After insert, nobody may rewrite the row.
// If this process selected a different Mongo database,
// hand back that database’s model.
// Named clocks live on the schema so the reviewed migration can apply them.
// Do not auto-create indexes on boot.
// Do not diff the named paths.
// Do not stamp last_change_id.

// ── 1. Hold the append-only mutation evidence row ─────────

const EntityChangeSchema = new Schema(
  {
    entity: { type: entityRefSchema, required: true },
    command_execution_id: { type: Schema.Types.ObjectId, required: true },
    command_name: { type: String, required: true, trim: true },
    provenance: { type: Schema.Types.Mixed, required: true },
    changed_paths: { type: [String], required: true, default: [] },
    fields: { type: [entityChangeFieldSchema], required: true, default: [] },
    revision_before: { type: Number, required: true, min: 0, validate: isNonnegativeIntegerRevision },
    revision_after: { type: Number, required: true, min: 0, validate: isNonnegativeIntegerRevision },
    applied_at: { type: Date, required: true },
  },
  {
    collection: "entity_changes",
    timestamps: false,
    strict: true,
    autoIndex: false,
  },
)

// ── 2. Remember which aggregate revision this is —
// and hide contact, delete, and forbidden raw paths

function rememberWhichAggregateRevisionAndHideContact() {
  // unique { entity.model, entity.id, revision_after }
  // revision_after === revision_before + 1
  // changed_paths unique, sorted, 1:1 with fields.path
  // contact / address / $deleted → reference_only, no values, no hashes
  // hashed reserved: no raw values; require a hash
  // FORBIDDEN_RAW_PATH refuses the path
}

// ── 3. Refuse rewrite, stamp the named clocks,
// and bind the selected-database getter

function refuseRewriteAfterInsert() {
  // save: isNew only
  // update / replace / delete query hooks throw
}

export const theNamedMutationEvidenceClocks = [
  { name: "entity_change_entity_revision_unique", unique: true },
  { name: "entity_change_command_execution_id" },
  { name: "entity_change_entity_applied" },
  { name: "entity_change_changed_paths_applied" },
]

export const appendOnlyMutationEvidenceOnTheDefaultConnection =
  mongoose.models.EntityChange ??
  mongoose.model("EntityChange", EntityChangeSchema)

export function appendOnlyMutationEvidenceOnTheSelectedDatabase() {
  // getMongoDatabaseName(); useDb when the live connection is a different name
}

export {
  appendOnlyMutationEvidenceOnTheSelectedDatabase as getEntityChangeModel,
  appendOnlyMutationEvidenceOnTheDefaultConnection as EntityChange,
}
```

Read the primary path out loud: *A named command already mutated a Form Lead inside the executor’s Mongo write. Persist already hid the phone and preallocated this row’s id. The selected-database model saves one `entity_changes` row whose next revision is this one plus one, whose contact path is `reference_only` with no value, and whose provenance copied the speaker who already passed the gate. Unique aggregate plus next revision refuses a second row for the same step. After insert, an update or delete throws. The surviving Lead is stamped next door, not here. Job Timeline later hops the raw collection by Lead id and reads `command_name` / `changed_paths` / `decision_id` — never the phone. Do not hash contact from here. Do not auto-create the unique clock from here. Do not merge this into the leftover next Command.*

## Precise logic I would tighten while renaming

1. **This file does not diff and does not stamp.** Already-recommended `persistEntityChangeMutations` walks named path lists, hides contact, inserts through the getter, then `$set`s `last_change_id` / `last_changed_at` / `domain_revision` on a surviving aggregate. A delete writes `$deleted` and skips the stamp. Do not move collect or stamp into this file so “the model owns the Change.” Do not `$set` `last_change_id` from a post-save hook so “one save owns the Lead.”

2. **Contact regex is copied next door.** `CONTACT_OR_ADDRESS_PATH` is identical on already-recommended `domainCommands/entityChange.ts`. This file also rejects `FORBIDDEN_RAW_PATH`; persist never checks that regex (it already hid unknown future paths as `reference_only`). CONTRADICTIONS already names the copy. Do not delete the model copy so “one regex owns PII.” Do not start emitting `hashed` here so “the reserved mode is used.”

3. **Hashed mode is reserved and unused.** The enum and validate hook exist. Persist never sets `value_mode: "hashed"`. Knowledge says hashed is not invented for contact. Do not drop `hashed` from the enum so “unused modes vanish.” Do not teach persist to hash the phone so “we finally use the mode.”

4. **`entity.model` is wider than persist will stamp.** Leftover `ENTITY_REF_MODELS` includes Granot Booking / Release cases and discrepancies. Persist’s `writableAggregateModel` only stamps FormLead / CallLead / BookedLead / CancelledLead / GranotRecordLink and throws for anything else. Do not silently narrow the enum so “schema matches stamp” without a paired persist proof. Do not add `Customer` / `Agent` so “every collection has a Change.”

5. **Selected-database getter is load-bearing.** Persist and Granot timeline / replica writes **ask** `getEntityChangeModel()`. Model tests and some RingCentral replica counts **ask** default `EntityChange` after `connectMongo()`. Already-recommended public throttle has **no** getter. Do not delete the getter so “this matches throttle” without a paired persist selected-database proof. Do not delete the default export so “everyone must call the getter.”

6. **`autoIndex: false` — boot does not create the unique revision clock.** Leftover `pnpm migration:granot-lifecycle:indexes` applies non-unique first, then the unique key after collision inventory. Already-recommended public throttle / Owner case omit `autoIndex: false` and let boot create unnamed clocks. Do not flip `autoIndex: true` so “boot matches throttle.” Do not call `createIndexes()` from this file so “the model applies itself.”

7. **Write-once hooks reject application update and delete.** Persist only `save`s `isNew`. Replica cleanup uses `collection.deleteMany` (bypasses query hooks). Do not add an application `deleteOne` so “tests can clean through the model.” Do not switch persist to `findOneAndUpdate` upsert so “a retry can patch the row.”

8. **`timestamps: false` — `applied_at` is the clock.** Persist copies the executor’s `now`. Already-recommended SMS / throttle / Owner case use camelCase `createdAt` / `updatedAt`. Do not add `timestamps: true` so “this matches SMS.” Do not rename `applied_at` so “the Change matches Picker `created_at`.”

9. **Default `__v` remains.** The schema does not set `versionKey: false`. Persist does not CAS `__v`. Aggregate concurrency is leftover `domain_revision`, not this `__v`. Do not drop `__v` so “write-once needs no version.” Do not teach persist to increment `__v` so “the Change owns optimistic concurrency.”

10. **Persist preallocates `_id`.** Stamp and row share `mutation.change_id`. Do not switch persist to let Mongo mint `_id` so “the model owns identity” — the surviving aggregate would lose the shared id. Do not add `createEntityChange` that mints a new id.

11. **Provenance is Mixed.** Validate only checks `source_system`, actor, initiator, and optional channel. Receipt / Observation / Decision / case / discrepancy ids are optional ObjectIds; already-recommended persist drops non-hex RingCentral session strings. Do not require `receipt_id` so “every Change has a receipt.” Do not nest a strict provenance schema from this rename so “Mixed becomes a second writer.”

12. **`changed_paths` must already be sorted.** Persist’s `changedPathsFromFields` sorts before save. Validate re-checks uniqueness, sort, and 1:1 with `fields.path`. Do not drop the validate sort so “persist already sorted.” Do not sort inside the model so “callers can send any order” without a paired persist proof.

13. **Job Timeline hops the raw collection and does not import this file.** The loader `find`s `entity_changes` by Lead / Booking / Cancellation id and maps `command_name` / `applied_at` / `changed_paths` / `decision_id`. It does not read `fields`. CONTRADICTIONS already says that hop `find`s the full document then maps a subset. Do not teach the loader to import this model so “every hop uses the getter.” Do not add field values to that map so “the timeline can show the phone.”

14. **Historical apply omits this collection.** `SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and omits `entity_changes`. Leftover shadow / provenance migrations assert `fabricated_entity_changes: 0`. Do not add this collection to apply so “the Change is a side-effect of historical merge.” Do not teach apply to import this model.

15. **Core Collections already names this collection.** Do not rewrite that paragraph from this rename. Do not add hashed-contact language there so “the reserved mode is live.”

16. **Leave sibling modules alone.** `persistEntityChangeMutations` / leftover next `DomainCommandExecution` / already-recommended Form `last_change_id` are already the right **depth**.

## Testing

The interface of this file is the selected-database getter, the default-connection model, `ENTITY_CHANGE_COLLECTION`, `ENTITY_CHANGE_INDEXES`, `DELETED_ENTITY_CHANGE_PATH`, required adjacent revisions, unique sorted `changed_paths` 1:1 with `fields.path`, contact / address / `$deleted` `reference_only` with no values, `FORBIDDEN_RAW_PATH`, reserved `hashed` rules, incomplete-provenance reject, write-once save and query hooks, `timestamps: false`, default `__v`, `autoIndex: false`, and the omitted persist helper. `EntityChange.test.ts` already names AC-32 collection / four indexes / adjacent revisions / contact delete / JSON omit / post-insert reject on the default model.

I would keep a later focused model file on that interface. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.EntityChange ?? mongoose.model(...)`
- `getEntityChangeModel()` returns that default when the live connection name matches `getMongoDatabaseName()`, else `useDb`
- persist **asks** the getter, `new Change({ _id: change_id })`, `save({ session })` — **not** `findOneAndUpdate`
- unique `{ entity.model, entity.id, revision_after }` refuses a second row for the same step
- `revision_after` must equal `revision_before + 1`; negative revisions reject
- `phone_number` / `$deleted` validate as `reference_only` with no values or hashes
- `value_mode: "stored"` on `phone_number` rejects
- a `payload` / `headers` / `token` path rejects
- `hashed` with raw `after` rejects; `hashed` with neither hash rejects
- JSON of a valid contact+quoted row omits payload, headers, and unmasked phone
- `save` on `isNew: false` throws write-once; `updateOne` / `deleteOne` throw
- leftover migration **asks** `ENTITY_CHANGE_INDEXES` and applies non-unique first
- already-recommended persist / leftover Granot Owner modules **do not** import this file
- already-recommended Job Timeline hops raw `entity_changes` and **does not** import this file
- historical apply / verify omit `entity_changes`
- `schema-and-crud-inputs.mdc` already names this collection; this pass does not rewrite that paragraph
- leftover next `DomainCommandExecution` is a different collection; that file is out of this story
- already-recommended `PublicSubmissionThrottleBucket` is a different collection; that file is out of this story
- already-recommended Form / Call / Booking `last_change_id` refs this name; those files are out of this story

I would not test collect / classify / stamp, Sheet Sync after commit, leftover Granot confirm, or Job Timeline assemble from this file.

Do not add a test per helper (`theNextRevisionIsThisOnePlusOne`, `contactMustBeReferenceOnly`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- An `EntityChangeService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `invalidate`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `validate.ts` / `hooks.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (already-recommended persist stays inside `operation({ session })`; Sheet Sync finalize stays after commit; this file only validates and refuses rewrite).
- Treating `persistEntityChangeMutations` / `collectDocumentFieldChanges` / leftover next `DomainCommandExecution` / already-recommended public throttle / already-recommended `$inc` CAS as this story.
- Inventing a hashed-contact seam that has only the reserved enum as an adapter.
- Inventing a Customer seam that has only “every collection should stamp” as an adapter.
- Silently merging the contact regex with persist, emitting hashed contact, deleting the getter, flipping `autoIndex: true`, adding `timestamps: true`, requiring `receipt_id`, narrowing `ENTITY_REF_MODELS` to the five writable aggregates, teaching Job Timeline to import this model, adding `entity_changes` to historical `SIDE_EFFECT_COLLECTIONS`, or rewriting Core Collections while recommending a rename.
- Pulling `persistEntityChangeMutations` or `stampAggregateRevision` into this file.
- Merging this collection into leftover next `DomainCommandExecution`, already-recommended `PublicSubmissionThrottleBucket`, already-recommended `LeadMessageRateLimit`, already-recommended `SheetSyncQuotaBucket`, already-recommended Owner case, or already-recommended Form / Call / Booking.
- Silently reordering persist-then-stamp versus Sheet-Sync-after-commit, or unique-index apply versus collision inventory.
- Changing persist to `findOneAndUpdate` so “a retry can patch the row.”
- Dropping the default export or the getter in the same PR as the story names.
- Opening `validation/` or leftover next `DomainCommandExecution.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `DomainCommandExecution.ts` while writing this file.
