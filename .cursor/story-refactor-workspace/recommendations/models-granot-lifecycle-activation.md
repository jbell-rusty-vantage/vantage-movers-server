# Remember One Write-Once Granot Lifecycle Clock On `granot_lifecycle_activations`, Refuse Every Mutation After Insert Including Delete And Upsert, And Declare The One Named Unique `{ key: 1 }` Index — Never Activate Here, Never Classify Historical Versus Live, Never Flip The Ten Flags, Never Merge This Into The Decision Or The Statement — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 23 of this service — `GranotLifecycleActivation.ts`
- Remaining in this service: `GranotRecordLink.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotLifecycleActivation.ts`
- Knowledge: [`docs/granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md`](../../../docs/granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md) (section “Activation is not an env var”: until this row exists every receipt is `historical_shadow`; unique write-once `key: "granot_lifecycle"`; Owner `POST /api/v1/admin/granot-lifecycle/activation`; a second activate is `409`; rollback never deletes this row — it only turns flags off). Related processor: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) (pre-activation and `captured_at < activated_at` stay `historical_shadow` forever; live-shadow Decisions are never promoted — **this file never classifies**). Related health: [`docs/knowledge/granot-lifecycle/observability.md`](../../../docs/knowledge/granot-lifecycle/observability.md) / [`docs/knowledge/granot-lifecycle/projections.md`](../../../docs/knowledge/granot-lifecycle/projections.md) (health includes activation; IDs are masked — **this file never projects**). Related Booking / Referral: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) (automatic open/refresh passes only after activation and live-mode classification — **this file never opens a case**). Compatibility rule: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) (`granot_lifecycle_activations`; write-once; unique `{ key: 1 }`; no API delete/edit). Related Owner command: already-recommended [granot-lifecycle-operations.md](granot-lifecycle-operations.md) (`activateGranotLifecycle` find-then-create, raced find or 11000 → `ALREADY_ACTIVATED`, after-commit audit/metric — **this file never starts the clock**). Related classify: `src/config/domain/granotLifecycle.ts` `classifyExecutionMode` (null `activated_at` or `captured_at < activated_at` → `historical_shadow`; else shadow → `live_shadow`, otherwise `live` — **this file never classifies**). Related already-recommended Decision: [models-synchronization-decision.md](models-synchronization-decision.md) (collection `synchronization_decisions`; unique `{ observation_id, attempt }`; `timestamps: false` — **do not copy that unique or that clock onto this row**). Related already-recommended statement: [models-granot-observation.md](models-granot-observation.md) (collection `granot_observations`; unique `receipt_id`; `timestamps: true`; `autoIndex` unset — **do not copy those onto this row**). Related leftover next Record Link: leftover next `GranotRecordLink.ts` (current job-level link aggregate; unique partial `{ provider, normalized_job_no }` where `state:"active"` — **this file is the clock**, not the link). Related channel catalog: leftover later `granotLifecycleSchemas.ts` (`GRANOT_LIFECYCLE_ACTIVATION_KEY` only — **do not merge that catalog into this file**). Job Timeline does **not** hop `granot_lifecycle_activations`. Leftover overview / leftover Registry / leftover historical-consolidation **do not** ask this collection as a catalog row. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model vs named-index catalog vs mongoose write-once hooks vs Owner find-then-create vs classify-by-`activated_at`.** Already-recommended `operations.ts` **asks** `getGranotLifecycleActivationModel()` `findOne({ key: "granot_lifecycle" })` then `create([document], { session })` (raced find or 11000 becomes `ALREADY_ACTIVATED` — **not** a Decision-style meaning compare). Already-recommended `processor.ts` **asks** the getter `findOne` and hands `activated_at` to `classifyExecutionMode`. `createLeadFromGranot.ts` **asks** the getter `findOne` plus `.sort({ activated_at: -1 })` then classifies. `bookingOwnerCommands.ts` / `referralBooking.ts` **ask** the getter `findOne` and refuse when the Observation is missing, not live, or `captured_at < activated_at`. `projections.ts` **asks** the getter `findOne` for health (`present` / masked id / `activated_at` / `processor_version` — never `reason`, never `activated_by`). `scripts/migrations/granot-lifecycle-indexes.ts` **asks** `GRANOT_LIFECYCLE_ACTIVATION_INDEXES` + `GRANOT_LIFECYCLE_ACTIVATION_COLLECTION`. Shadow-process / certification scripts **ask** the getter `findOne` as a cutoff proof. `GranotLifecycleActivation.test.ts` **asks** schema validate / named unique / write-once `save` / mongoose `updateOne` / `findOneAndUpdate` upsert / `deleteOne`. Replica fixtures in `referralBooking.replica.test.ts` use `.collection.insertOne` / `.collection.findOne` (hooks do not run). Not this **interface**: `activateGranotLifecycle` itself, `classifyExecutionMode` itself, `projectGranotLifecycleHealth` itself, `projectActivation` itself.
- Seams callers need: default `GranotLifecycleActivation` (first-registered connection — getter same-db return) vs `getGranotLifecycleActivationModel()` (selected `getMongoDatabaseName()`); mongoose `create` / `findOne` (hooks run on create) vs `.collection.insertOne` / `.collection.deleteMany` (hooks **do not** run); unique `{ key: 1 }` vs already-recommended Decision `{ observation_id, attempt }` vs already-recommended statement `receipt_id`; write-once **entire document including delete** vs already-recommended envelope `processing.*` allowlist; `timestamps: { createdAt: true, updatedAt: false }` vs Decision `timestamps: false` vs statement `timestamps: true` (`activated_at` is the cutoff clock; `createdAt` is insert time); `autoIndex: false` vs statement unset; `GRANOT_LIFECYCLE_ACTIVATION_COLLECTION` `"granot_lifecycle_activations"` vs no Job Timeline hop; nested `activated_by` origin enum `vantage_admin` | `external_sheet_ingestion` | `reporting_projection` vs `DurableActor` (which also allows `browser_extension` / `granot_lifecycle` / `ringcentral`). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no authorization **seam**. There is no classify **seam**. There is no flag **seam**.
- Split later (only if the file outgrows one sitting): this ~130-line file is one sitting if you read it as remember one write-once Granot lifecycle clock on `granot_lifecycle_activations`, refuse every mutation after insert including delete and upsert, and declare the one named unique `{ key: 1 }` index — never activate here, never classify historical versus live, never flip the ten flags, never merge this into the Decision or the statement. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `activate.ts` / `classify.ts`. Activate stays already-recommended `operations.ts`. Classify stays `granotLifecycle.ts`. Channel key constant stays leftover later `granotLifecycleSchemas.ts`. Next Record Link stays leftover `GranotRecordLink.ts`.

`GranotLifecycleActivation` is a Mongoose model name. The owner question is: *The Owner just started — or the processor / create / Booking / Referral / health is about to ask whether live effects may even be considered. Hold one write-once Granot lifecycle clock on `granot_lifecycle_activations`. Unique `{ key: 1 }` so a second insert 11000s and the Owner command reports already activated instead of editing the row. After insert refuse changing anything, including delete and upsert — this is not `processing.*` work and rollback is flags off, never erase the clock. If this process selected a different Mongo database, hand back that database’s activation model. Do not activate here. Do not classify historical versus live. Do not flip the ten flags. Do not merge this into the Decision or the statement.*

Who starts the clock already lives in `operations.ts`. Who classifies already lives in `src/config/domain/granotLifecycle.ts`. Who holds the key constant already lives in leftover later `granotLifecycleSchemas.ts`. Who holds the current job-level link already lives in leftover next `GranotRecordLink.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember one write-once Granot lifecycle clock, refuse every mutation after insert including delete and upsert, and declare the one named unique `{ key: 1 }` index” story, not “an activation model CRUD dump,” and not Start The Write-Once Clock / Classify Historical Versus Live / Flip The Ten Flags themselves:

1. **Hold one write-once Granot lifecycle clock** — collection `granot_lifecycle_activations` (`GRANOT_LIFECYCLE_ACTIVATION_COLLECTION`), `timestamps: { createdAt: true, updatedAt: false }`, `strict: true`, `autoIndex: false`. **No** `optimisticConcurrency`. **No** `sheet_sync[]`. **No** `source_company`. **No** `processing`. **No** `payload` Mixed. **No** Observation contact. **No** Decision `outcome`. Declares required `key` enum `[GRANOT_LIFECYCLE_ACTIVATION_KEY]` (`"granot_lifecycle"`), required `activated_at`, required nested `activated_by` (`DurableActor` shape: `actor_type` / `actor_id` / `actor_label` / `actor_role` / `request_id` / `origin` — origin enum here is `vantage_admin` | `external_sheet_ingestion` | `reporting_projection`; subdoc `{ _id: false }`), required `reason` (trim, min 10, max 1000), required `processor_version` (trim, min 1, max 100). Type also names `createdAt`. This beat does **not** start the clock. This beat does **not** refuse Admin. This beat does **not** hide `reason` / `activated_by` from a DTO.

2. **Refuse every mutation after insert, including delete and upsert** — `pre("save")` `rejectActivationMutation` throws “GranotLifecycleActivation is write-once” unless `isNew`. mongoose `updateOne` / `updateMany` / `findOneAndUpdate` / `replaceOne` / `findOneAndReplace` / `deleteOne` / `deleteMany` / `findOneAndDelete` all throw “cannot be updated, replaced, deleted, or upserted after existence.” There is **no** `processing.*` allowlist. `.collection.insertOne` / `.collection.updateOne` / `.collection.deleteMany` **bypass** these hooks. This beat does **not** throw `ALREADY_ACTIVATED`. This beat does **not** persist an Operational Event.

3. **Bind the selected Mongo database and declare the one named unique index** — default export `GranotLifecycleActivation` is `mongoose.models[...] ?? mongoose.model(...)`. `getGranotLifecycleActivationModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb` + register. `GRANOT_LIFECYCLE_ACTIVATION_INDEXES` is one named key: unique `{ key: 1 }` (`granot_lifecycle_activation_key_unique`). The schema loops that catalog onto `Schema.index`. `autoIndex` is **`false`**. The migration **asks** the catalog (non-unique first — this catalog has none — then unique). Job Timeline does **not** hop this collection. This beat does **not** `syncIndexes`. This beat does **not** delete the default export so “everyone must call the getter.”

There is no start-the-clock operation. `activateGranotLifecycle` elects that. There is no classify-historical-versus-live operation. `classifyExecutionMode` elects that. There is no flip-the-ten-flags operation. `getGranotLifecycleFlags` elects that.

## Organization

Keep one file. This is the screenplay for “remember one write-once Granot lifecycle clock on `granot_lifecycle_activations`, refuse every mutation after insert including delete and upsert, and declare the one named unique `{ key: 1 }` index — never activate here, never classify historical versus live, never flip the ten flags, never merge this into the Decision or the statement.” Owner activate / classify / health / index apply already live in deeper **modules**. The key constant already lives in leftover later `granotLifecycleSchemas.ts`. Already-recommended Decision and statement already live in sibling **modules**. Leftover next Record Link already lives in a sibling **module**. Do not pull those in. Do not invent a `GranotLifecycleActivationService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second `{ activated_at: -1 }` unique **adapter** so “many clocks can exist and we pick the newest.” Do not invent a leftover `processing.*` **adapter** from this rename so “activation matches envelope drain.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `activate.ts` / `classify.ts` each get a file.

Do not move `activateGranotLifecycle` into this file so “the row owns the Owner command.” Do not move `classifyExecutionMode` into this file so “the clock owns historical versus live.” Do not merge this file into already-recommended `SynchronizationDecision.ts` so “one schema owns the Decision and the clock.” Do not merge this file into leftover next `GranotRecordLink.ts` so “one schema owns the clock and the job link.” Do not merge `GRANOT_LIFECYCLE_ACTIVATION_KEY` into this file so “the clock owns the vocabulary catalog.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotLifecycleActivation` | `granotLifecycleClockOnTheDefaultConnection` | getter same-db return still imports the default model |
| `getGranotLifecycleActivationModel` | `granotLifecycleClockOnTheSelectedMongoDatabase` | Owner persist / processor classify / create / Booking / Referral / health must follow `getMongoDatabaseName()` |
| `GranotLifecycleActivationDocument` | `GranotLifecycleClockRow` | stored clock + nested `activated_by` |
| `GRANOT_LIFECYCLE_ACTIVATION_COLLECTION` | `granotLifecycleClockCollectionName` | migration opens `granot_lifecycle_activations` without registering the model |
| `GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME` | `granotLifecycleClockModelName` | getter / default export share `"GranotLifecycleActivation"` |
| `GRANOT_LIFECYCLE_ACTIVATION_INDEXES` | `namedGranotLifecycleClockIndexes` | `pnpm migration:granot-lifecycle:indexes` applies the one named unique `{ key: 1 }` |

Keep the old names as one-line aliases until Owner persist / migration / getter same-db return migrate. Do not make callers learn `useDb` / `isNew` as the domain language. Do **not** delete the default `GranotLifecycleActivation` export so “everyone must call the getter.” Do **not** delete the getter so “clock matches Testimonial.” Do **not** re-export `activateGranotLifecycle` from this file so “the row owns the Owner command.” Do **not** export `classifyExecutionMode` so “the clock owns historical versus live.” Do **not** export `ALREADY_ACTIVATED` so “persist imports the model type.”

**No class for the workflow.** The one type that *does* earn a name is the pending clock-identity contract:

```ts
type GranotLifecycleClockIdentity = {
  collection: "granot_lifecycle_activations"
  key: { unique: true; only_value: "granot_lifecycle"; one_clock: true }
  evidence: { write_once_after_insert: true; delete_forbidden: true; processing_mutable: false }
  persist: { find_then_create: true; mongoose_upsert: false; meaning_compare: false }
  cutoff: { field: "activated_at"; flags_do_not_erase: true }
}
```

That is the handoff from “this process remembered the Owner started the clock” to “a second `key: granot_lifecycle` 11000s, mongoose cannot `$set` or delete after insert, and later receipts compare `captured_at` to `activated_at`.” Do **not** add `{ activated_at: { unique: false, many_clocks: true } }` so “create can sort newest.” Do **not** add `{ processing: granotReceiptProcessingSchema }` so “clock matches envelope drain.” Do **not** flip `timestamps: false` from this rename so “clock matches Decision.” Do **not** unset `autoIndex` from this rename so “boot matches statement.”

Leave `operations.ts` on that file. Leave `classifyExecutionMode` on `granotLifecycle.ts`. Leave already-recommended `SynchronizationDecision.ts` on that file. Leave leftover later `granotLifecycleSchemas.ts` on that file. Leave leftover next `GranotRecordLink.ts` on that file. Leave index apply on the migration script.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotLifecycleActivation.ts
// The Owner just started the write-once Granot lifecycle clock —
// or leftover processor / leftover create / leftover Booking /
// leftover Referral / leftover health is about to ask
// whether live effects may even be considered.
// Hold one write-once clock on granot_lifecycle_activations.
// Unique { key: 1 } so a second insert 11000s
// and the Owner command reports already activated
// instead of editing the row.
// After insert refuse changing anything, including delete —
// this is not processing.* work, and rollback is flags off.
// If this process selected a different Mongo database,
// hand back that database’s activation model.
// Do not activate here.
// Do not classify historical versus live.
// Do not flip the ten flags.

import type { DurableActor } from "../services/durableWork/types"
import { GRANOT_LIFECYCLE_ACTIVATION_KEY } from "./granotLifecycleSchemas"

// ── 1. Hold one write-once Granot lifecycle clock ─────────

export const GRANOT_LIFECYCLE_ACTIVATION_COLLECTION =
  "granot_lifecycle_activations"
export const GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME =
  "GranotLifecycleActivation"

export type GranotLifecycleActivationDocument = {
  key                    // enum ["granot_lifecycle"] only
  activated_at           // the cutoff clock
  activated_by           // DurableActor nest — origin narrowed here
  reason                 // trim 10–1000; Owner projection omits this
  processor_version      // trim 1–100
  createdAt              // insert time; updatedAt is off
}

function rememberTheClockShape()
function rememberTheOwnerWhoStartedIt()
function refuseASecondKey besidesGranotLifecycle()

// ── 2. Refuse every mutation after insert ─────────────────

function rejectActivationMutationOnSave()     // throw unless isNew
function rejectActivationQueryMutation()      // update / replace / delete / upsert throw
// no processing.* allowlist
// .collection.* bypasses these hooks — do not "fix" that from this rename

// ── 3. Bind the selected Mongo database and declare the one named unique index

export const GRANOT_LIFECYCLE_ACTIVATION_INDEXES = [
  { name: "granot_lifecycle_activation_key_unique",
    key: { key: 1 }, unique: true },
]

export const GranotLifecycleActivation = /* default connection */
export function getGranotLifecycleActivationModel()
  // same model when connection.name === getMongoDatabaseName()
  // otherwise useDb + register
```

Read the primary path out loud: *The Owner started the clock — or a later receipt needs to know whether it landed before that moment. Hold that one row on `granot_lifecycle_activations` keyed by `granot_lifecycle`. Unique so a second insert 11000s and the Owner command says already activated instead of editing. After insert refuse changing anything, including delete. If this process selected another Mongo database, hand back that database’s activation model. Do not activate here. Do not classify here. Do not flip flags here.*

That is the operation. `GranotLifecycleActivation.create` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This is the clock. It is not the Owner command and not the classifier.** Already-recommended `operations.ts` owns find-then-create, `ALREADY_ACTIVATED`, after-commit audit, and the projection that omits `reason` / `activated_by`. `classifyExecutionMode` owns `historical_shadow` / `live_shadow` / `live`. Do not move those in so “the row owns activate and classify.”

2. **Unique `{ key: 1 }` means at most one clock. `createLeadFromGranot` still `.sort({ activated_at: -1 })`.** That sort tells a later reader many rows could exist. Do not add a second activation key from this rename so “the sort is honest.” Do not drop the unique so “we can keep a history of clocks.” Leave the sort on `createLeadFromGranot.ts`.

3. **The nested origin enum is narrower than `DurableActor`.** This schema allows `vantage_admin` | `external_sheet_ingestion` | `reporting_projection`. `DurableActor` also allows `browser_extension` / `granot_lifecycle` / `ringcentral`. The Owner write path always stamps `vantage_admin`. Do not widen the schema from this rename so “the nest matches DurableActor.” Do not drop `external_sheet_ingestion` / `reporting_projection` so “activate only ever writes vantage_admin.”

4. **`timestamps: { createdAt: true, updatedAt: false }` is load-bearing.** `activated_at` is the cutoff the classifier reads. `createdAt` is insert time. `updatedAt` would lie because the row cannot update. Do not flip `timestamps: false` so “clock matches Decision.” Do not flip `timestamps: true` so “clock matches statement.”

5. **`autoIndex: false` is already set here.** Already-recommended Decision sets `false`. Already-recommended statement leaves it unset. Do not unset it from this rename so “boot matches statement.” Do not copy this `false` onto leftover next `GranotRecordLink.ts` without reading that file.

6. **Replica cleanup that calls mongoose `deleteMany` fights this file.** `operations.test.ts` concurrent-activation cleanup uses `Activation.deleteMany(...)`. These hooks throw on `deleteMany`. Replica Referral seeds use `.collection.insertOne` on purpose. Do not remove the delete hook from this rename so “the replica test can clean.” Leave cleanup on `.collection.deleteMany`.

7. **11000 here is already-activated, not Decision replay.** Owner persist maps duplicate-key to `ALREADY_ACTIVATED`. There is no `decisionMeaningEquals`. Do not rewrite persist onto Decision find-then-compare so “every write-once row replays meaning.”

8. **Leave sibling modules alone.** `activateGranotLifecycle`, `classifyExecutionMode`, `projectGranotLifecycleHealth`, `GRANOT_LIFECYCLE_ACTIVATION_KEY` are already the right **depth**. This file holds the row.

## Testing

The **interface** is the test surface: `GranotLifecycleActivation` / `getGranotLifecycleActivationModel` / `GRANOT_LIFECYCLE_ACTIVATION_INDEXES` / `GRANOT_LIFECYCLE_ACTIVATION_COLLECTION`.

Today’s `GranotLifecycleActivation.test.ts` already names the operation:

**Hold one clock**
- Named collection is `granot_lifecycle_activations`; model name is `GranotLifecycleActivation`.
- Getter returns the same model name on the selected database.
- One named index matches the catalog; unique is `{ key: 1 }` only.
- Invented key `"other"` refuses enum.

**Refuse every mutation after insert**
- `save()` on `isNew === false` throws write-once.
- mongoose `updateOne` / `findOneAndUpdate` upsert / `deleteOne` throw “cannot be updated, replaced, deleted, or upserted.”

Do **not** add a test per helper (`rememberTheClockShape`, `refuseASecondKeyBesidesGranotLifecycle`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** move `operations.test.ts` Owner activate / Admin refuse / audit-cannot-roll-back / concurrent-winner proofs into this file so “the row owns the command.” `ALREADY_ACTIVATED` / omitted `reason` / omitted `activated_by` stay on the operations **interface**.

Do **not** add a classify test here. `classifyExecutionMode` lives on `granotLifecycle.ts` and does not import this file.

## What I would not do

- A `GranotLifecycleActivationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `activate.ts` / `classify.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit **seam**. Owner activate already inserts inside a transaction and audits after commit — do not move that audit into this file so “the row owns the Operational Event.”
- Treating `activateGranotLifecycle` / `classifyExecutionMode` / `projectGranotLifecycleHealth` as this story.
- Inventing a leftover `processing.*` **seam** that has only one **adapter**.
- Silently "fixing" `createLeadFromGranot`’s `.sort({ activated_at: -1 })` / the narrower origin enum / replica `deleteMany` / `timestamps` while recommending a rename.
- Jumping to `validation/` while `models` has unchecked modules.
- Writing a whole-folder recommendation for `models`.
- Merging this file into already-recommended `SynchronizationDecision.ts` so “one schema owns the Decision and the clock.”
- Merging `GRANOT_LIFECYCLE_ACTIVATION_KEY` into this file so “the clock owns the vocabulary catalog.”
- Adding a deactivate / delete-activation path so “rollback can erase the clock.”
- Flipping any of the ten Granot lifecycle flags from this rename so “the clock turns effects on.”
- Treating leftover next `GranotRecordLink.ts` as this story.
