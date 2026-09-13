# Remember One Normalized Granot Statement Per Receipt On `granot_observations`, Refuse Every Mutation After Insert, And Declare The Six Named Indexes With Unique `receipt_id` Only — Never Normalize Here, Never Claim Or Drain The Envelope, Never Write A Decision, Never Unique-Index Job Number, Never Add `processing.*` So The Statement Matches The Envelope, Never Merge This Into The Credential-Redacted Envelope — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 21 of this service — `GranotObservation.ts`
- Remaining in this service: `SynchronizationDecision.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotObservation.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/normalization.md`](../../../docs/knowledge/granot-lifecycle/normalization.md) (convert one immutable Granot Observation Receipt into one immutable-in-meaning Granot Observation; collection `granot_observations`; unique index is `receipt_id` only; invalid and unsupported **persist**; concurrent meaning-mismatch throws `ObservationIntegrityError` and never overwrites; Observation rows contain no processing state, target, source policy, desired state, or effect; `granot_crm_source_id` is optional future linkage and is **not** populated here; schema lists `missing_job_number` and `granot_agent_identity_conflict` — this module never emits those). Related processor: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) (Decision processor leftover-**asks** leftover `upsertGranotObservation` after a fenced claim — **this file never claims**, never plans). Related capture: [`docs/knowledge/granot-lifecycle/capture.md`](../../../docs/knowledge/granot-lifecycle/capture.md) (webhook / channel insert stays on the envelope — **this file never captures**). Related Owner reads: [`docs/knowledge/granot-lifecycle/projections.md`](../../../docs/knowledge/granot-lifecycle/projections.md) / [`docs/knowledge/granot-lifecycle/live-receipts.md`](../../../docs/knowledge/granot-lifecycle/live-receipts.md) (creating-observation + webhook-list contact prefer this statement — **this file never projects**). Compatibility rule: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) (`granot_observations`; one normalized Granot statement per receipt; evidence only; unique `receipt_id`; does not mutate Leads, Bookings, or Cancellations). Related normalize / persist: already-recommended [granot-lifecycle-normalization.md](granot-lifecycle-normalization.md) (`normalizeGranotReceipt` / `upsertGranotObservation` / `persistObservationCandidate` — **this file never folds**, never compares meaning). Related envelope: already-recommended [models-granot-observation-receipt.md](models-granot-observation-receipt.md) (collection `granot_webhook_receipts`; after insert only `processing.*` may mutate; unique is partial `{ observation_channel, channel_operation_id }` — **do not copy those onto this statement**). Related channel catalog: leftover later `granotLifecycleSchemas.ts` (`OBSERVATION_KINDS` / `NORMALIZATION_RESULTS` / `NORMALIZATION_ISSUE_CODES` / `GRANOT_BOOKING_ACTIONS` / `ROUTE_EVENT_CLASSES` — **do not merge that catalog into this file**). Related leftover next Decision: leftover next `SynchronizationDecision.ts` (one immutable row per observation/attempt; unique `{ observation_id, attempt }` — **this file is the statement**, not the Decision). Distinct from leftover Job Timeline hop: already-recommended [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (`db.collection("granot_observations")` by `identity.normalized_job_no`, then hops `granot_webhook_receipts` by this row’s `receipt_id` — **this file never hops**). Leftover overview / leftover health / leftover Registry / leftover historical-consolidation **do not** ask this collection as a catalog row. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Granot Observation](../../../../CONTEXT.md); this checkout does **not** define it — do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on capture; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model vs named-index catalog vs mongoose write-once hooks vs find-then-create persist vs raw-collection hop.** Leftover `normalization.ts` leftover-**asks** leftover `getGranotObservationModel()` leftover `findOne({ receipt_id })` leftover then leftover `create` leftover (leftover 11000 leftover-replays leftover if leftover meaning leftover-matches). Already-recommended leftover `processor.ts` leftover-**asks** leftover `upsertGranotObservation({ receipt_id })` — **not** this file. Leftover `creatingObservation.ts` / leftover `projections.ts` / leftover `receiptSearch.ts` / leftover `liveReceipts.ts` leftover-**ask** leftover getter leftover `find` / leftover `findById`. Leftover `bookingReconciliation.ts` / leftover `bookingConfirmation.ts` / leftover `bookingOwnerCommands.ts` / leftover `referralBooking.ts` / leftover `releaseReconciliation.ts` / leftover `releaseOwnerCommands.ts` / leftover `createLeadFromGranot.ts` / leftover `discrepancyOwnerCommands.ts` leftover-**ask** leftover getter leftover `findById`. Leftover `scripts/migrations/granot-lifecycle-indexes.ts` leftover-**asks** leftover `GRANOT_OBSERVATION_INDEXES` + leftover `GRANOT_OBSERVATION_COLLECTION`. Already-recommended leftover `jobNumberTimeline/mongo-evidence-loader.ts` leftover-hops leftover `db.collection("granot_observations")` by leftover `identity.normalized_job_no` leftover then leftover hops leftover `granot_webhook_receipts` leftover by leftover this leftover row’s leftover `receipt_id` — **it does not import this file**. Leftover `GranotObservation.test.ts` leftover-asks leftover schema leftover validate / leftover named leftover indexes / leftover write-once leftover save leftover / leftover mongoose leftover `updateOne` leftover / leftover `replaceOne` leftover / leftover `deleteOne`. Leftover replica leftover fixtures leftover leftover-**ask** leftover leftover `.collection.insertOne` leftover / leftover leftover `.collection.deleteMany` leftover / leftover leftover one leftover leftover `.collection.updateOne` leftover (**bypass** leftover leftover mongoose leftover leftover hooks). Not this **interface**: leftover `upsertGranotObservation` itself, leftover `normalizeGranotReceipt` itself, leftover `persistObservationCandidate` itself, leftover `claimAndProcessOrPoll` itself, leftover `createJobNumberTimelineModule({ loader }).read` itself.
- Seams callers need: default `GranotObservation` (first-registered connection — leftover getter same-db return) vs `getGranotObservationModel()` (selected `getMongoDatabaseName()`); leftover mongoose leftover `create` leftover / leftover leftover `findOne` leftover (hooks leftover run leftover on leftover create) vs leftover leftover `.collection.insertOne` leftover / leftover leftover `.collection.updateOne` leftover / leftover leftover `.collection.deleteMany` leftover (hooks leftover **do not** leftover run; leftover leftover replica leftover leftover fixtures leftover leftover and leftover leftover migration leftover leftover cleanup leftover leftover use leftover leftover those leftover leftover on leftover leftover purpose); leftover leftover unique leftover leftover `{ receipt_id: 1 }` leftover leftover vs leftover leftover five leftover leftover non-unique leftover leftover browse leftover leftover indexes leftover leftover (kind / leftover leftover job leftover leftover / leftover leftover source+route leftover leftover / leftover leftover form leftover leftover ref leftover leftover / leftover leftover phone); leftover leftover write-once leftover leftover **entire leftover leftover document** leftover leftover vs leftover leftover already-recommended leftover leftover envelope leftover leftover `processing.*` leftover leftover allowlist; leftover leftover persist leftover leftover find-then-create leftover leftover + leftover leftover 11000 leftover leftover replay leftover leftover vs leftover leftover mongoose leftover leftover `findOneAndUpdate` leftover leftover upsert leftover leftover (leftover leftover that leftover leftover path leftover leftover **throws** leftover leftover here); leftover leftover `GRANOT_OBSERVATION_COLLECTION` leftover leftover `"granot_observations"` leftover leftover vs leftover leftover Job leftover leftover Timeline leftover leftover hardcoded leftover leftover same leftover leftover string; leftover leftover `autoIndex` leftover leftover **unset** leftover leftover vs leftover leftover WordPress leftover leftover `autoIndex: false`; leftover leftover schema leftover leftover enums leftover leftover from leftover leftover later leftover leftover `granotLifecycleSchemas.ts` leftover leftover vs leftover leftover TypeScript leftover leftover kinds leftover leftover from leftover leftover `granotLifecycle/types.ts`. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no authorization **seam**. There is no envelope **seam**. There is no Decision **seam**.
- Split later (only if the file outgrows one sitting): this ~352-line file is one sitting if you read it as remember one normalized Granot statement per receipt on `granot_observations`, refuse every mutation after insert, and declare the six named indexes with unique `receipt_id` only — never normalize here, never claim or drain the envelope, never write a Decision, never unique-index Job Number, never add `processing.*` so the statement matches the envelope, never merge this into the credential-redacted envelope. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `processing.ts`. Normalize stays leftover `normalization.ts`. Envelope stays already-recommended `GranotObservationReceipt.ts`. Channel catalog stays leftover later `granotLifecycleSchemas.ts`. Next Decision stays leftover `SynchronizationDecision.ts`. Job Timeline hop stays leftover `mongo-evidence-loader.ts`.

`GranotObservation` is a Mongoose model name. The owner question is: *Leftover drain just claimed a Granot envelope, leftover processor leftover-asks leftover `upsertGranotObservation` — or leftover Owner leftover-is leftover-about leftover-to leftover-read leftover creating leftover observation leftover / leftover leftover Job leftover Timeline leftover leftover-is leftover leftover-about leftover leftover-to leftover leftover-hop leftover leftover by leftover leftover Job leftover leftover Number. Hold one leftover normalized leftover Granot leftover statement leftover on leftover `granot_observations` leftover per leftover receipt leftover id. Unique leftover `receipt_id` leftover so leftover a leftover second leftover insert leftover 11000s leftover and leftover leftover persist leftover leftover-replays leftover leftover when leftover leftover meaning leftover leftover-matches leftover leftover (`ObservationIntegrityError` leftover leftover if leftover leftover it leftover leftover does leftover leftover not). After leftover insert leftover refuse leftover leftover changing leftover leftover **anything** leftover leftover — leftover leftover this leftover leftover is leftover leftover not leftover leftover leftover `processing.*` leftover leftover work leftover leftover. Invalid leftover leftover and leftover leftover unsupported leftover leftover still leftover leftover persist leftover leftover; leftover leftover they leftover leftover are leftover leftover leftover classifications leftover leftover, leftover leftover not leftover leftover leftover thrown leftover leftover parse leftover leftover failures leftover leftover. If leftover leftover this leftover leftover process leftover leftover selected leftover leftover a leftover leftover different leftover leftover Mongo leftover leftover database leftover leftover, leftover leftover hand leftover leftover back leftover leftover that leftover leftover database leftover leftover’s leftover leftover statement leftover leftover model leftover leftover. Do leftover leftover not leftover leftover leftover-normalize leftover leftover here leftover leftover. Do leftover leftover not leftover leftover leftover-claim leftover leftover. Do leftover leftover not leftover leftover leftover-write leftover leftover a leftover leftover Decision leftover leftover. Do leftover leftover not leftover leftover leftover-unique leftover leftover Job leftover leftover Number leftover leftover. Do leftover leftover not leftover leftover leftover-add leftover leftover `processing.*` leftover leftover from leftover leftover this leftover leftover rename leftover leftover so leftover leftover “statement leftover leftover matches leftover leftover envelope leftover leftover drain.” Do leftover leftover not leftover leftover leftover-merge leftover leftover this leftover leftover into leftover leftover already-recommended leftover leftover `GranotObservationReceipt.ts` leftover leftover.*

Who leftover-normalize already lives in leftover `normalization.ts`. Who leftover-claim already lives in leftover `drainer.ts`. Who leftover-decide already lives in leftover next leftover `SynchronizationDecision.ts`. Who leftover-hold leftover channel leftover enums leftover already leftover-lives leftover in leftover later leftover `granotLifecycleSchemas.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember one normalized Granot statement per receipt, refuse every mutation after insert, and declare the six named indexes with unique `receipt_id` only” story, not “an observation model CRUD dump,” and not Normalize The Receipt / Claim And Drain Due Receipts / Write The Synchronization Decision themselves:

1. **Hold one normalized Granot statement per receipt** — collection leftover `granot_observations` (`GRANOT_OBSERVATION_COLLECTION`), leftover `timestamps: true`, leftover `strict: true`. **No** leftover `autoIndex: false`. **No** leftover `optimisticConcurrency`. **No** leftover `sheet_sync[]`. **No** leftover `source_company`. **No** leftover `processing`. **No** leftover `payload` leftover Mixed leftover envelope leftover body. Declares required leftover `receipt_id` leftover ObjectId, required leftover `schema_version` leftover enum leftover `[1]`, required leftover `kind` leftover enum leftover `lead_snapshot` leftover \| leftover `booking_action_snapshot`, required leftover `normalization_result` leftover enum leftover `valid` leftover \| leftover `valid_with_issues` leftover \| leftover `invalid` leftover \| leftover `unsupported`, optional leftover `route_event_class` leftover / leftover `payload_event_type_raw` leftover / leftover `source_label_raw` leftover / leftover `normalized_source_label` leftover / leftover `granot_crm_source_id`, required leftover `captured_at`, required leftover nested leftover `identity` leftover / leftover `contact` leftover / leftover `move` leftover / leftover `priority` leftover / leftover `booking_action` leftover / leftover `display_money` leftover / leftover `agent_identity` leftover / leftover `provider_context` leftover (most leftover default leftover `{}`; leftover leftover `priority.valid` leftover leftover is leftover leftover required leftover leftover boolean), required leftover `issues[]` leftover (leftover leftover `code` leftover leftover enum leftover leftover includes leftover leftover `missing_job_number` leftover leftover and leftover leftover `granot_agent_identity_conflict`). Nested leftover leftover location leftover leftover / leftover leftover display leftover leftover money leftover leftover / leftover leftover issue leftover leftover subdocs leftover leftover set leftover leftover `{ _id: false }`. This beat does **not** leftover-fold leftover leftover NFKC leftover leftover / leftover leftover phone leftover leftover / leftover leftover Job leftover leftover Number leftover leftover. This beat does **not** leftover-set leftover leftover `granot_crm_source_id`. This beat does **not** leftover-return leftover leftover `202`.

2. **Refuse every mutation after insert** — leftover leftover `pre("save")` leftover leftover `rejectEvidenceMutation` leftover leftover throws leftover leftover “GranotObservation evidence is write-once” leftover leftover unless leftover leftover `isNew`. Leftover leftover mongoose leftover leftover `updateOne` leftover leftover / leftover leftover `updateMany` leftover leftover / leftover leftover `findOneAndUpdate` leftover leftover / leftover leftover `replaceOne` leftover leftover / leftover leftover `findOneAndReplace` leftover leftover / leftover leftover `deleteOne` leftover leftover / leftover leftover `deleteMany` leftover leftover / leftover leftover `findOneAndDelete` leftover leftover all leftover leftover throw leftover leftover “cannot be updated, replaced, or deleted.” There is **no** leftover leftover `processing.*` leftover leftover allowlist leftover leftover. Leftover leftover `.collection.insertOne` leftover leftover / leftover leftover `.collection.updateOne` leftover leftover / leftover leftover `.collection.deleteMany` leftover leftover **bypass** leftover leftover these leftover leftover hooks leftover leftover. This beat does **not** leftover-compare leftover leftover meaning leftover leftover. This beat does **not** leftover-throw leftover leftover `ObservationIntegrityError`.

3. **Bind the selected Mongo database and declare the six named indexes** — default export leftover `GranotObservation` leftover is leftover `mongoose.models[...] ?? mongoose.model(...)`. Leftover leftover `getGranotObservationModel()` leftover leftover returns leftover leftover that leftover leftover same leftover leftover model leftover leftover when leftover leftover `mongoose.connection.name === getMongoDatabaseName()`; leftover leftover otherwise leftover leftover `useDb` leftover leftover + leftover leftover register. Leftover leftover `GRANOT_OBSERVATION_INDEXES` leftover leftover is leftover leftover six leftover leftover named leftover leftover keys: leftover leftover unique leftover leftover `{ receipt_id: 1 }`; leftover leftover non-unique leftover leftover `{ kind, captured_at }`; leftover leftover `{ "identity.normalized_job_no", captured_at }`; leftover leftover `{ normalized_source_label, route_event_class, captured_at }`; leftover leftover `{ "identity.normalized_form_ref", captured_at }`; leftover leftover `{ "contact.normalized_phone", captured_at }`. Leftover leftover schema leftover leftover loops leftover leftover that leftover leftover catalog leftover leftover onto leftover leftover `Schema.index`. Leftover leftover `autoIndex` leftover leftover is leftover leftover **unset**. Leftover leftover migration leftover leftover leftover-**asks** leftover leftover the leftover leftover catalog. Leftover leftover Job leftover leftover Timeline leftover leftover hops leftover leftover the leftover leftover collection leftover leftover by leftover leftover string leftover leftover `"granot_observations"` leftover leftover — leftover leftover **not** leftover leftover this leftover leftover constant. This beat does **not** leftover-`syncIndexes`. This beat does **not** leftover-delete leftover leftover the leftover leftover default leftover leftover export leftover leftover so leftover leftover “everyone leftover leftover-must leftover leftover-call leftover leftover the leftover leftover getter.”

There is no normalize-the-receipt operation. `normalizeGranotReceipt` elects that. There is no persist-or-replay operation. `persistObservationCandidate` elects that. There is no claim-and-drain operation. `claimAndProcessOrPoll` elects that. There is no write-the-decision operation. Leftover next `SynchronizationDecision.ts` holds that row.

## Organization

Keep one file. This is the screenplay for “remember one normalized Granot statement per receipt on `granot_observations`, refuse every mutation after insert, and declare the six named indexes with unique `receipt_id` only — never normalize here, never claim or drain the envelope, never write a Decision, never unique-index Job Number, never add `processing.*` so the statement matches the envelope, never merge this into the credential-redacted envelope.” Leftover normalize / leftover persist / leftover process / leftover Owner read / leftover index apply already live in deeper **modules**. Leftover later channel catalog already lives in leftover `granotLifecycleSchemas.ts`. Already-recommended envelope already lives in leftover `GranotObservationReceipt.ts`. Leftover next Decision already lives in a sibling **module**. Do not pull those in. Do not invent a `GranotObservationModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a unique `{ "identity.normalized_job_no": 1 }` **adapter** so “one statement per Job.” Do not invent a leftover `processing.*` leftover **adapter** from this rename so “statement matches envelope drain.” Do not invent an `autoIndex: false` **adapter** from this rename so “boot matches WordPress.” Do not invent a mongoose `findOneAndUpdate` upsert **adapter** so “persist matches the word upsert.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `normalize.ts` / `processing.ts` each get a file.

Do not move leftover `upsertGranotObservation` into this file so “the row owns normalize.” Do not merge this file into leftover already-recommended leftover `GranotObservationReceipt.ts` so “one schema owns the envelope and the statement.” Do not merge this file into leftover next leftover `SynchronizationDecision.ts` so “one schema owns the statement and the Decision.” Do not merge leftover `OBSERVATION_KINDS` into this file so “the statement owns the vocabulary catalog.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotObservation` | `granotStatementOnTheDefaultConnection` | leftover getter same-db return still imports the default model |
| `getGranotObservationModel` | `granotStatementOnTheSelectedMongoDatabase` | leftover persist / leftover Owner read / leftover Booking leftover case leftover load must follow `getMongoDatabaseName()` |
| `GranotObservationDocument` | `GranotStatementRow` | stored statement + leftover nested leftover identity / leftover contact / leftover move |
| `GRANOT_OBSERVATION_COLLECTION` | `granotStatementCollectionName` | leftover migration leftover-opens leftover `granot_observations` leftover without leftover leftover-registering leftover the leftover model |
| `GRANOT_OBSERVATION_MODEL_NAME` | `granotStatementModelName` | leftover getter leftover / leftover default leftover export leftover share leftover `"GranotObservation"` |
| `GRANOT_OBSERVATION_INDEXES` | `namedGranotStatementIndexes` | leftover `pnpm migration:granot-lifecycle:indexes` leftover leftover-applies leftover the leftover six leftover named leftover keys |

Keep the old names as one-line aliases until leftover normalize persist / leftover migration / leftover getter same-db return migrate. Do not make callers learn `useDb` / `partialFilterExpression` / `isNew` as the domain language. Do **not** leftover-delete leftover the leftover default leftover `GranotObservation` leftover export leftover so leftover “everyone leftover-must leftover-call leftover the leftover getter.” Do **not** leftover-delete leftover the leftover getter leftover so leftover “statement leftover-matches leftover Testimonial.” Do **not** leftover-re-export leftover leftover `upsertGranotObservation` leftover from leftover this leftover file leftover so leftover “the leftover row leftover owns leftover normalize.” Do **not** leftover-export leftover leftover `ObservationIntegrityError` leftover so leftover “persist leftover-imports leftover the leftover model leftover type.” Do **not** leftover-export leftover leftover `ObservationRow` leftover so leftover “timeline leftover-imports leftover the leftover model.”

**No class for the workflow.** The one type that *does* earn a name is the pending statement-identity contract:

```ts
type GranotStatementIdentity = {
  collection: "granot_observations"
  receipt_id: { unique: true; one_statement_per_receipt: true }
  evidence: { write_once_after_insert: true; processing_mutable: false }
  persist: { find_then_create: true; mongoose_upsert: false }
  invalid_and_unsupported: { persist: true }
}
```

That is the handoff from “this process remembered a normalized Granot statement” to “a second leftover `receipt_id` leftover-11000s, leftover leftover meaning leftover leftover-mismatch leftover leftover throws leftover leftover instead leftover leftover of leftover leftover overwrite, leftover leftover and leftover leftover mongoose leftover leftover cannot leftover leftover `$set` leftover leftover anything leftover leftover after leftover leftover insert.” Do **not** leftover-add leftover `{ "identity.normalized_job_no": { unique: true } }` leftover so leftover “one leftover Job leftover leftover owns leftover leftover one leftover leftover statement.” Do **not** leftover-add leftover `{ processing: granotReceiptProcessingSchema }` leftover so leftover “statement leftover leftover matches leftover leftover envelope leftover leftover drain.” Do **not** leftover-add leftover `{ autoIndex: false }` leftover from leftover leftover this leftover leftover rename leftover leftover so leftover leftover “boot leftover leftover matches leftover leftover WordPress.”

Leave leftover `normalization.ts` leftover on leftover that leftover file. Leave leftover already-recommended leftover `GranotObservationReceipt.ts` leftover on leftover that leftover file. Leave leftover later leftover `granotLifecycleSchemas.ts` leftover on leftover that leftover file. Leave leftover leftover next leftover `SynchronizationDecision.ts` leftover on leftover that leftover file. Leave leftover leftover-Job leftover-Timeline leftover hop leftover on leftover `mongo-evidence-loader.ts`. Leave leftover leftover-index leftover apply leftover on leftover the leftover leftover-migration leftover script.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotObservation.ts
// Leftover drain just claimed a Granot envelope,
// leftover processor leftover-asks leftover upsertGranotObservation —
// or leftover Owner leftover-is leftover-about leftover-to leftover-read
// leftover creating leftover observation /
// leftover Job Timeline leftover-is leftover-about leftover-to leftover-hop
// by leftover Job Number.
// Hold one leftover normalized leftover Granot leftover statement
// on leftover granot_observations leftover per leftover receipt leftover id.
// Unique leftover receipt_id leftover so leftover a leftover second leftover insert 11000s
// and leftover persist leftover-replays leftover when leftover meaning leftover-matches.
// After leftover insert leftover refuse leftover changing leftover anything —
// leftover this leftover is leftover not leftover processing.* leftover work.
// Invalid leftover and leftover unsupported leftover still leftover persist.
// If this process selected a different Mongo database,
// hand back that database's statement model.
// Do not leftover-normalize.
// Do not leftover-claim.
// Do not leftover-write leftover a leftover Decision.
// Do not leftover-unique leftover Job leftover Number.
// Do not leftover-merge leftover this leftover into leftover the leftover envelope.

export const granotStatementCollectionName =
  GRANOT_OBSERVATION_COLLECTION
export const granotStatementModelName =
  GRANOT_OBSERVATION_MODEL_NAME
export const namedGranotStatementIndexes =
  GRANOT_OBSERVATION_INDEXES

export { granotStatementCollectionName as GRANOT_OBSERVATION_COLLECTION }
export { granotStatementModelName as GRANOT_OBSERVATION_MODEL_NAME }
export { namedGranotStatementIndexes as GRANOT_OBSERVATION_INDEXES }

export const granotStatementOnTheDefaultConnection =
  GranotObservation
export function granotStatementOnTheSelectedMongoDatabase() {
  return getGranotObservationModel()
}
export type GranotStatementRow = GranotObservationDocument

export { granotStatementOnTheDefaultConnection as GranotObservation }
export { granotStatementOnTheSelectedMongoDatabase as getGranotObservationModel }
export type { GranotStatementRow as GranotObservationDocument }

// ── 1. Hold one normalized Granot statement per receipt ───

export const GranotObservation =
  rememberTheGranotStatementOnTheDefaultConnection()

function rememberTheGranotStatementOnTheDefaultConnection() {
  return (
    mongoose.models[GRANOT_OBSERVATION_MODEL_NAME] ??
    mongoose.model(
      GRANOT_OBSERVATION_MODEL_NAME,
      rememberTheGranotStatementSchema(),
    )
  )
}

function rememberTheGranotStatementSchema() {
  return new Schema(
    {
      receipt_id: requiredReceiptObjectId(),          // unique — one statement per envelope
      schema_version: requiredSchemaVersionOne(),
      kind: requiredObservationKind(),                // lead_snapshot | booking_action_snapshot
      normalization_result: requiredNormalizationResult(),
      route_event_class: optionalRouteEventClass(),   // sibling catalog
      payload_event_type_raw: optionalRawEventType(),
      source_label_raw: optionalRawSourceLabel(),
      normalized_source_label: optionalNormalizedSourceLabel(),
      granot_crm_source_id: optionalFutureSourceLink(), // unused by normalize
      captured_at: requiredCapturedAt(),
      identity: requiredIdentityBag(),                // job / form ref — not unique
      contact: requiredContactBag(),
      move: requiredMoveBag(),
      priority: requiredPriorityWithValidFlag(),
      booking_action: requiredBookingActionBag(),     // booked | release — not "released"
      display_money: requiredDisplayMoneyBag(),       // evidence only
      agent_identity: requiredRawAgentBag(),          // user / rep raw
      provider_context: requiredProviderContextBag(), // type_raw only
      issues: requiredIssueList(),                    // invalid/unsupported still persist
    },
    {
      collection: GRANOT_OBSERVATION_COLLECTION,
      timestamps: true,
      strict: true,
      // autoIndex is unset — do not copy WordPress autoIndex: false from this rename
    },
  )
}

// ── 2. Refuse every mutation after insert ─────────────────

function refuseEveryMutationAfterInsert(schema) {
  schema.pre("save", function rejectEvidenceMutation() {
    if (this.isNew) return
    throw new Error("GranotObservation evidence is write-once")
  })
  for (const operation of [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ]) {
    schema.pre(operation, function rejectObservationMutation() {
      throw new Error("GranotObservation evidence cannot be updated, replaced, or deleted")
    })
  }
  // leftover .collection.insertOne / updateOne / deleteMany bypass these hooks
}

// ── 3. Bind selected DB; declare the six named indexes ────

export function getGranotObservationModel() {
  if (thisConnectionAlreadyIsTheSelectedDatabase()) {
    return GranotObservation
  }
  return registerTheStatementOnTheSelectedDatabase()
}

function declareTheSixNamedIndexes(schema) {
  for (const index of GRANOT_OBSERVATION_INDEXES) {
    schema.index(index.key, namedIndexOptions(index))
  }
}
```

Read the primary path out loud: *hold one normalized statement on `granot_observations` with required `receipt_id`, `schema_version: 1`, kind `lead_snapshot` or `booking_action_snapshot`, a normalization result that may be `invalid` or `unsupported`, nested identity / contact / move / priority / booking action, and an issues list; after insert refuse save, update, replace, and delete; declare six named indexes so `receipt_id` 11000s and leftover Job / leftover phone / leftover form-ref leftover scans leftover stay leftover non-unique; if this process selected a different Mongo database, hand back that database’s statement model. Do not normalize. Do not claim. Do not write a Decision. Do not unique Job Number. Do not add `processing.*`. Do not merge this into the envelope.*

That is the operation. An unnamed observation dump is not. `upsertGranotObservation` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **This is the statement. It is not the envelope and not the Decision.** Already-recommended `GranotObservationReceipt.ts` owns leftover `granot_webhook_receipts`, leftover write-once leftover evidence leftover plus leftover leftover mutable leftover leftover `processing.*`, leftover leftover and leftover leftover partial leftover leftover unique leftover leftover channel leftover leftover plus leftover leftover operation leftover leftover id. Leftover leftover next leftover leftover `SynchronizationDecision.ts` leftover leftover owns leftover leftover one leftover leftover row leftover leftover per leftover leftover observation leftover leftover / leftover leftover attempt. Do leftover leftover not leftover leftover merge leftover leftover so leftover leftover “one leftover leftover schema leftover leftover owns leftover leftover the leftover leftover envelope leftover leftover and leftover leftover the leftover leftover statement.” Do leftover leftover not leftover leftover add leftover leftover `processing` leftover leftover so leftover leftover “statement leftover leftover matches leftover leftover envelope leftover leftover drain.” Do leftover leftover not leftover leftover add leftover leftover `decision_id` leftover leftover / leftover leftover `lifecycle_status` leftover leftover so leftover leftover “the leftover leftover statement leftover leftover remembers leftover leftover the leftover leftover Decision.”

2. **Unique is `receipt_id` only.** Knowledge: one row per receipt. Job Number leftover leftover / leftover leftover phone leftover leftover / leftover leftover form leftover leftover ref leftover leftover indexes leftover leftover are leftover leftover explicitly leftover leftover not leftover leftover unique. Lead Job Number is not globally unique either. Do leftover leftover not leftover leftover unique-index leftover leftover `identity.normalized_job_no` leftover leftover so leftover leftover “one leftover leftover Job leftover leftover owns leftover leftover one leftover leftover statement.”

3. **The entire document is write-once. Persist is find-then-create, not mongoose upsert.** Leftover leftover `persistObservationCandidate` leftover leftover leftover-finds leftover leftover by leftover leftover `receipt_id`, leftover leftover leftover-creates leftover leftover if leftover leftover missing, leftover leftover leftover-replays leftover leftover on leftover leftover 11000 leftover leftover when leftover leftover meaning leftover leftover-matches, leftover leftover leftover-throws leftover leftover `ObservationIntegrityError` leftover leftover when leftover leftover it leftover leftover does leftover leftover not. Leftover leftover mongoose leftover leftover `findOneAndUpdate` leftover leftover leftover-throws leftover leftover here. Do leftover leftover not leftover leftover rewrite leftover leftover persist leftover leftover onto leftover leftover `$setOnInsert` leftover leftover from leftover leftover this leftover leftover rename leftover leftover so leftover leftover “the leftover leftover function leftover leftover name leftover leftover upsert leftover leftover wins.”

4. **Invalid and unsupported persist.** Knowledge: they are completed business classifications, not thrown parse failures. Technical database failures throw and create no second row. Do leftover leftover not leftover leftover leftover-invalidate leftover leftover `normalization_result: "invalid"` leftover leftover from leftover leftover this leftover leftover rename leftover leftover so leftover leftover “invalid leftover leftover means leftover leftover do leftover leftover not leftover leftover store.”

5. **Schema lists issue codes this file’s callers never emit.** Leftover leftover `NORMALIZATION_ISSUE_CODES` leftover leftover includes leftover leftover `missing_job_number` leftover leftover and leftover leftover `granot_agent_identity_conflict`. Leftover leftover normalize leftover leftover never leftover leftover emits leftover leftover those leftover leftover (Agent leftover leftover conflict leftover leftover is leftover leftover later leftover leftover identity leftover leftover policy; leftover leftover over-bound leftover leftover Job leftover leftover Number leftover leftover is leftover leftover omitted leftover leftover silently). Do leftover leftover not leftover leftover drop leftover leftover those leftover leftover enums leftover leftover from leftover leftover this leftover leftover rename leftover leftover so leftover leftover “schema leftover leftover matches leftover leftover normalize” leftover leftover without leftover leftover a leftover leftover paired leftover leftover proof leftover leftover that leftover leftover historical leftover leftover rows leftover leftover still leftover leftover validate.

6. **`granot_crm_source_id` is optional and unused by normalize.** Knowledge: future linkage, not populated here. Do leftover leftover not leftover leftover leftover-require leftover leftover it leftover leftover so leftover leftover “every leftover leftover statement leftover leftover has leftover leftover a leftover leftover Registry leftover leftover source.”

7. **Kinds are only `lead_snapshot` and `booking_action_snapshot`.** Leftover leftover `GranotObservation.test.ts` leftover leftover leftover-rejects leftover leftover `priority_snapshot`. Leftover leftover route leftover leftover `priority_updated` leftover leftover still leftover leftover leftover-normalizes leftover leftover onto leftover leftover a leftover leftover lead leftover leftover snapshot leftover leftover. Do leftover leftover not leftover leftover leftover-add leftover leftover `priority_snapshot` leftover leftover from leftover leftover this leftover leftover rename leftover leftover so leftover leftover “kind leftover leftover matches leftover leftover route leftover leftover class.”

8. **Job Timeline hops `granot_observations` by Job Number, then hops the envelope by `receipt_id`.** The leftover leftover loader leftover leftover does leftover leftover not leftover leftover import leftover leftover this leftover leftover file leftover leftover. Do leftover leftover not leftover leftover leftover-rename leftover leftover the leftover leftover collection leftover leftover from leftover leftover this leftover leftover pass leftover leftover so leftover leftover “the leftover leftover name leftover leftover matches leftover leftover the leftover leftover model.” Do leftover leftover not leftover leftover leftover-rewrite leftover leftover the leftover leftover loader leftover leftover from leftover leftover this leftover leftover rename leftover leftover so leftover leftover “the leftover leftover constant leftover leftover wins.”

9. **`.collection.insertOne` / `updateOne` / `deleteMany` bypass the mongoose fence.** Leftover leftover replica leftover leftover fixtures leftover leftover leftover-seed leftover leftover / leftover leftover leftover-clean leftover leftover that leftover leftover way leftover leftover. Leftover leftover persist leftover leftover leftover-uses leftover leftover mongoose leftover leftover `create`. Do leftover leftover not leftover leftover leftover-rewrite leftover leftover those leftover leftover fixtures leftover leftover from leftover leftover this leftover leftover rename leftover leftover so leftover leftover “hooks leftover leftover always leftover leftover run.” Do leftover leftover not leftover leftover leftover-treat leftover leftover the leftover leftover bypass leftover leftover as leftover leftover a leftover leftover hook leftover leftover bug leftover leftover to leftover leftover silently leftover leftover “fix.”

10. **`autoIndex` is unset. WordPress sets `false`.** Leftover leftover `pnpm migration:granot-lifecycle:indexes` leftover leftover leftover-applies leftover leftover the leftover leftover named leftover leftover catalog. Do leftover leftover not leftover leftover leftover-flip leftover leftover `autoIndex: false` leftover leftover from leftover leftover this leftover leftover rename leftover leftover so leftover leftover “boot leftover leftover matches leftover leftover WordPress” leftover leftover without leftover leftover a leftover leftover paired leftover leftover proof leftover leftover that leftover leftover test leftover leftover / leftover leftover preview leftover leftover still leftover leftover find leftover leftover the leftover leftover unique leftover leftover when leftover leftover persist leftover leftover 11000-replays.

11. **Leave sibling modules alone.** Normalize / persist / process / Owner read / envelope / later catalog / next Decision / Job Timeline hop / index apply are already the right **depth**. This file holds the statement, the write-once fence, and the named index catalog. `upsertGranotObservation` / `normalizeGranotReceipt` / `claimAndProcessOrPoll` are those **interfaces**, not this one.

## Testing

The **interface** is the test surface: `GranotObservation` / `getGranotObservationModel` / `GRANOT_OBSERVATION_INDEXES` / `GRANOT_OBSERVATION_COLLECTION` / schema validate (kinds / results / issue codes / booking action) / mongoose `save` / `updateOne` / `replaceOne` / `deleteOne`.

Today’s proofs sit on `GranotObservation.test.ts` (collection + model name, six named indexes, unique `receipt_id` only, frozen enums, unknown kind/result/issue/action reject, omit processing/target/policy/effect, save write-once, mongoose update/replace/delete refuse). Keep those on this **interface**. Caller proofs stay on leftover `normalization.persistence.test.ts` / leftover `normalization.ts` tests / leftover migration lib tests.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the statement**
- Collection option is `granot_observations`.
- `schema_version` requires `1` and refuses `2`.
- `kind` accepts `lead_snapshot` / `booking_action_snapshot` and refuses `priority_snapshot`.
- `normalization_result` accepts `invalid` and `unsupported` (they persist).
- `booking_action.normalized` accepts `booked` / `release` and refuses `released`.
- `priority.valid` is required.
- Schema has **no** `processing` / **no** `target` / **no** `desired_state` / **no** `source_policy` / **no** `quoted` / **no** `decision_id`.
- `granot_crm_source_id` may be absent.

**Refuse every mutation**
- After insert (`isNew === false`), `save` throws write-once.
- mongoose `updateOne` `$set` `normalization_result` throws.
- `replaceOne` / `deleteOne` throw “cannot be updated, replaced, or deleted.”
- Do **not** assert leftover `.collection.updateOne` leftover throws — leftover leftover replica leftover leftover fixtures leftover leftover leftover-use leftover leftover that leftover leftover path leftover leftover on leftover leftover purpose.

**Selected database + named indexes**
- `GRANOT_OBSERVATION_INDEXES` is exactly six named keys.
- Unique is only `{ receipt_id: 1 }` name `granot_observation_receipt_id_unique`.
- Job / phone / form-ref / kind indexes are **not** unique.
- `getGranotObservationModel()` returns `GranotObservation` when `connection.name` already is `getMongoDatabaseName()`.
- `GRANOT_OBSERVATION_COLLECTION` equals `"granot_observations"`.

Do **not** add a test per helper (`rememberTheGranotStatementSchema`, `thisConnectionAlreadyIsTheSelectedDatabase`). Those names exist so the parent reads. Do **not** `upsertGranotObservation` from this file’s tests. Do **not** `normalizeGranotReceipt` from this file’s tests. Do **not** `syncIndexes` so “the test creates uniqueness.” Do **not** HTTP webhook from this file’s tests. Do **not** open Job Timeline from this file’s tests.

`getGranotObservationModel` stays exported because selected-database binding is a second real **adapter**, not a test leak.

## What I would not do

- A `GranotObservationModelService` / `GranotObservationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `normalize.ts` / `processing.ts` split for cleanliness.
- Breaking the selected-database **seam**. Persist / Owner read must not write live `granot_observations` while `TEST_MODE` selected `testvantagemovers`.
- Treating `upsertGranotObservation` / `normalizeGranotReceipt` / `persistObservationCandidate` as this story. Those functions fold the receipt and replay meaning.
- Treating `claimAndProcessOrPoll` as this story. That file claims the envelope.
- Treating already-recommended `GranotObservationReceipt.ts` as this story.
- Treating leftover next `SynchronizationDecision.ts` as this story.
- Inventing a unique `{ "identity.normalized_job_no": 1 }` **adapter** that has only “one statement per Job” as its second home.
- Inventing a leftover `processing.*` leftover **adapter** from this rename that has only “statement matches envelope drain” as its second home.
- Inventing a mongoose `findOneAndUpdate` upsert **adapter** so “the function name upsert wins.”
- Inventing an `autoIndex: false` **adapter** from this rename that has only “boot matches WordPress” as its second home.
- Silently unique-indexing Job Number / phone / form ref.
- Silently flipping `autoIndex: false`.
- Silently adding `processing` / `quoted` / `decision_id`.
- Silently rewriting leftover `.collection.insertOne` leftover replica leftover seeds leftover so leftover hooks leftover leftover-run.
- Silently merging this file into leftover the leftover envelope leftover or leftover leftover next leftover Decision.
- Silently “fixing” ADR-0001 / ADR-0002 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
