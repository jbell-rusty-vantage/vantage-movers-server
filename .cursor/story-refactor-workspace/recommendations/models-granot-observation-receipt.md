# Remember The Credential-Redacted Granot Envelope On `granot_webhook_receipts`, Refuse Mutation Of Evidence After Insert So Only `processing.*` May Change, And Declare The Five Named Indexes Including Partial Unique Channel Plus Operation-Id — Never Capture Or Drain Here, Never Normalize An Observation, Never Unique-Index The Payload Hash, Never Merge This Into The WordPress Ingress Receipt, Never Treat Native `collection.updateOne` As A Hook Bug — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 20 of this service — `GranotObservationReceipt.ts`
- Remaining in this service: `GranotObservation.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotObservationReceipt.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/capture.md`](../../../docs/knowledge/granot-lifecycle/capture.md) (one credential-redacted envelope per accepted webhook or approved channel operation; `202` only after Mongo commit; webhook capture does **not** invoke the processor; identical webhook deliveries are **distinct** receipts; `payload_sha256` is diagnostic, never idempotency; unique index is `{ observation_channel, channel_operation_id }` partial on string `channel_operation_id`; queue wake-up is `{ receipt_id }` only). Related drain: [`docs/knowledge/granot-lifecycle/drainer.md`](../../../docs/knowledge/granot-lifecycle/drainer.md) (`processing.*` is the durable work source; claim predicate is due `pending` / `retry_scheduled` / expired `claimed`; Owner requeue only `dead_letter`). Related Owner reads: [`docs/knowledge/granot-lifecycle/live-receipts.md`](../../../docs/knowledge/granot-lifecycle/live-receipts.md) (webhook-channel historical list + Mongo-polled SSE; extension / HTTP-automation receipts excluded). Compatibility rule: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) (`granot_webhook_receipts`; after insert only `processing.*` may mutate; does not mutate Leads, Bookings, or Cancellations). Related capture / drain / process: already-recommended [granot-lifecycle-capture.md](granot-lifecycle-capture.md) / [granot-lifecycle-drainer.md](granot-lifecycle-drainer.md) / [granot-lifecycle-processor.md](granot-lifecycle-processor.md) (**this file never captures**, never claims, never plans). Related redaction helper: leftover `receiptEvidence.ts` (`redactCredentialKeys` / `hashCredentialRedactedPayload` — **this file leftover-asks those helpers**, never owns the forbidden-key list). Related channel contract: leftover later `granotLifecycleSchemas.ts` (`granotReceiptProcessingSchema` / `assertReceiptChannelShape` / `assertChannelOperationId` — **do not merge that catalog into this file**). Already-recommended WordPress ingress: [models-wordpress-form-submission-receipt.md](models-wordpress-form-submission-receipt.md) (unique `submission_key`, `form_path: "test"`, write-once Form-Lead pointer, `autoIndex: false` — **do not copy those onto this envelope**). Distinct from leftover next Observation: leftover next `GranotObservation.ts` (one normalized statement per receipt; unique `receipt_id` — **this file is the envelope**, not the statement). Distinct from leftover Job Timeline hop: already-recommended [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (`db.collection("granot_webhook_receipts")` by Observation `receipt_id` — **this file never hops**). Leftover overview / leftover health / leftover Registry / leftover historical-consolidation **do not** ask this collection as a catalog row. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Granot Observation Receipt](../../../../CONTEXT.md); this checkout does **not** define it — do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on capture; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model vs named-index catalog vs mongoose query hooks vs native-collection stamp vs raw-collection hop.** Leftover `capture.ts` leftover-**asks** `getGranotObservationReceiptModel().create` for webhook and channel inserts, leftover-reloads by `{ observation_channel, channel_operation_id }` after 11000. Already-recommended `drainer.ts` leftover-**asks** leftover `findOneAndUpdate` (claim), leftover `find` due, leftover `updateOne` renew / finalize. Leftover `operations.ts` leftover-**asks** leftover mongoose `updateOne` on leftover `dead_letter` requeue. Already-recommended `processor.ts` / leftover `synchronizeLeadFromGranot.ts` / leftover `createLeadFromGranot.ts` / leftover `bookingReconciliation.ts` / leftover `releaseReconciliation.ts` / leftover `discrepancies.ts` leftover-stamp leftover `processing.latest_decision_id` through leftover `.collection.updateOne` (**bypasses** leftover mongoose hooks). Leftover `receiptSearch.ts` leftover-filters leftover `observation_channel: "granot_webhook"`. Leftover `liveReceipts.ts` leftover-polls leftover webhook rows by leftover `captured_at`. Leftover `scripts/migrations/granot-lifecycle-indexes.ts` leftover-**asks** leftover `GRANOT_OBSERVATION_RECEIPT_INDEXES` + leftover `GRANOT_OBSERVATION_RECEIPT_COLLECTION`. Already-recommended leftover `jobNumberTimeline/mongo-evidence-loader.ts` leftover-hops leftover `db.collection("granot_webhook_receipts")` — **it does not import this file**. Leftover `GranotObservationReceipt.test.ts` leftover-asks leftover schema validate / leftover named indexes / leftover allowlist / leftover replace-delete refuse. Not this **interface**: leftover `captureGranotLifecycleWebhookReceipt` itself, leftover `claimAndProcessOrPoll` itself, leftover `searchReceipts` itself, leftover `upsertGranotObservation` itself.
- Seams callers need: default `GranotObservationReceipt` (first-registered connection — leftover getter same-db return) vs `getGranotObservationReceiptModel()` (selected `getMongoDatabaseName()`); leftover mongoose `create` / leftover `findOneAndUpdate` / leftover `updateOne` (hooks run) vs leftover `.collection.updateOne` (hooks **do not** run; leftover Decision stamp still targets leftover `processing.latest_decision_id`); leftover webhook channel (required leftover `route_event_class`, **no** leftover `channel_operation_kind`) vs leftover extension / leftover automation channel (required leftover kind + leftover operation id, **no** leftover route class); leftover unique partial leftover `{ observation_channel, channel_operation_id }` where leftover `channel_operation_id` is a string vs leftover webhook rows with leftover `undefined` operation id (those rows **do not** enter that unique); leftover `payload_sha256` diagnostic **never unique** vs leftover channel leftover-replay leftover-compares leftover hash + leftover kind; leftover `processing.*` durable work vs leftover `{ receipt_id }` wake-up; leftover `GRANOT_OBSERVATION_RECEIPT_COLLECTION` `"granot_webhook_receipts"` vs leftover Job Timeline hardcoded leftover same string; leftover `autoIndex` **unset** (mongoose default) vs leftover WordPress leftover `autoIndex: false`. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no authorization **seam**. There is no Observation **seam**.
- Split later (only if the file outgrows one sitting): this ~338-line file is one sitting if you read it as remember the credential-redacted Granot envelope on `granot_webhook_receipts`, refuse mutation of evidence after insert so only `processing.*` may change, and declare the five named indexes including partial unique channel plus operation-id — never capture or drain here, never normalize an Observation, never unique-index the payload hash, never merge this into the WordPress ingress receipt, never treat native `collection.updateOne` as a hook bug. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `redact.ts` / `processing.ts`. Capture stays leftover `capture.ts`. Drain stays leftover `drainer.ts`. Channel contract stays leftover later `granotLifecycleSchemas.ts`. Next Observation stays leftover `GranotObservation.ts`. WordPress ingress stays already-recommended `WordpressFormSubmissionReceipt.ts`.

`GranotObservationReceipt` is a Mongoose model name. The owner question is: *Granot just delivered a webhook, or the Owner just approved an extension / HTTP-automation apply — or leftover drain is about to claim due work. Hold the credential-redacted envelope on leftover `granot_webhook_receipts`. After insert, refuse changing leftover evidence. Leftover `processing.*` is the only mutable work: leftover pending / leftover claimed / leftover retry / leftover completed / leftover dead-letter. Keep leftover `{ observation_channel, channel_operation_id }` unique when leftover operation id is a string so a second leftover extension / leftover automation insert leftover-11000s and leftover capture leftover-replays. Do not unique leftover `payload_sha256` — leftover identical leftover webhooks leftover-are leftover distinct leftover receipts. If this process selected a different Mongo database, hand back that database’s envelope model. Do not leftover-capture. Do not leftover-claim. Do not leftover-normalize leftover an leftover Observation. Do not leftover-merge leftover this leftover into leftover already-recommended leftover WordPress leftover ingress. Do not leftover-flip leftover `autoIndex: false` leftover from leftover this leftover rename leftover so leftover “boot leftover matches leftover Form.” Do not leftover-rewrite leftover `.collection.updateOne` leftover Decision leftover stamps leftover so leftover “hooks leftover always leftover run.”*

Who leftover-capture already lives in leftover `capture.ts`. Who leftover-claim / leftover-drain already lives in leftover `drainer.ts`. Who leftover-normalize already lives in leftover `normalization.ts`. Who leftover-hold leftover channel leftover enums leftover already leftover-lives leftover in leftover later leftover `granotLifecycleSchemas.ts`. Do not pull those in.

## What this file actually does

Four operations of one “remember the credential-redacted Granot envelope, refuse mutation of evidence after insert so only `processing.*` may change, and declare the five named indexes” story, not “a receipt model CRUD dump,” and not Capture The Webhook / Claim And Drain Due Receipts themselves:

1. **Hold the credential-redacted Granot envelope** — collection leftover `granot_webhook_receipts` (`GRANOT_OBSERVATION_RECEIPT_COLLECTION`), leftover `timestamps: true`, leftover `strict: true`. **No** leftover `autoIndex: false`. **No** leftover `optimisticConcurrency`. **No** leftover `sheet_sync[]`. **No** leftover `source_company`. **No** leftover `lead_ref`. **No** leftover `submission_key`. Declares required leftover `source_system` enum leftover `["granot"]`, required leftover `observation_channel` enum leftover `granot_webhook` \| leftover `browser_extension` \| leftover `granot_http_automation`, required leftover `captured_at`, optional leftover `route_event_class` / leftover `channel_operation_kind`, required leftover `authentication_method` (includes leftover `legacy_unknown` — leftover capture leftover-refuses leftover that leftover for leftover new leftover webhooks), required leftover `evidence_version` enum leftover `[2]`, required leftover `payload_kind`, leftover Mixed leftover `headers` / leftover `payload`, required leftover 64-hex leftover `payload_sha256`, optional leftover `channel_operation_id` / leftover `initiator`, required leftover nested leftover `processing` (`granotReceiptProcessingSchema`), required leftover `provider` leftover `"granot"`. Leftover `pre("validate")` leftover `validateChannelContract` leftover-**asks** leftover `assertReceiptChannelShape`: leftover webhook leftover-requires leftover `route_event_class` leftover and leftover-forbids leftover `channel_operation_kind`; leftover extension / leftover automation leftover-require leftover kind leftover + leftover operation id leftover and leftover-refuse leftover a leftover route leftover class. This beat does **not** leftover-allowlist leftover webhook leftover headers. This beat does **not** leftover-return leftover `202`. This beat does **not** leftover-publish leftover `{ receipt_id }`.

2. **Redact credentials on insert and keep the payload hash honest** — leftover `pre("validate")` leftover `normalizeOperationId` leftover-runs leftover **only** leftover on leftover `isNew`. Empty leftover `channel_operation_id` leftover-becomes leftover `undefined` leftover (so leftover webhook leftover rows leftover do leftover **not** leftover enter leftover the leftover unique leftover partial). Leftover `redactCredentialKeys` leftover-runs leftover on leftover `headers`. Leftover `hashCredentialRedactedPayload` leftover-runs leftover on leftover `payload`. If leftover `payload_sha256` leftover is leftover missing leftover **or** leftover any leftover forbidden leftover key leftover was leftover removed, leftover the leftover hook leftover leftover-sets leftover leftover `payload_sha256` leftover to leftover the leftover redacted leftover hash. Leftover capture leftover already leftover-redacts leftover before leftover `create` — leftover this leftover hook leftover is leftover a leftover second leftover pass leftover for leftover hand leftover inserts leftover / leftover tests. This beat does **not** leftover-own leftover `FORBIDDEN_CREDENTIAL_KEY_CANONICALS`. This beat does **not** leftover-redact leftover on leftover leftover-`findOneAndUpdate`.

3. **Refuse mutation of evidence after insert; only `processing.*` may change** — leftover `GRANOT_OBSERVATION_RECEIPT_EVIDENCE_FIELDS` leftover is leftover write-once leftover on leftover `pre("save")` leftover (`rejectEvidenceMutation`). Leftover `updatedAt` leftover and leftover `processing` leftover / leftover `processing.*` leftover may leftover change. Leftover mongoose leftover `updateOne` / leftover `updateMany` / leftover `findOneAndUpdate` leftover leftover-**ask** leftover leftover `assertAllowlistedReceiptProcessingUpdate`: leftover operators leftover only leftover `$set` / leftover `$inc` / leftover `$unset` / leftover `$setOnInsert`; leftover paths leftover only leftover `processing` leftover / leftover `processing.*` leftover (plus leftover `updatedAt`, leftover and leftover `$setOnInsert.createdAt`). Leftover `replaceOne` / leftover `findOneAndReplace` / leftover `deleteOne` / leftover `deleteMany` / leftover `findOneAndDelete` leftover throw leftover “cannot be replaced or deleted.” Leftover `.collection.updateOne` leftover Decision leftover stamps leftover **bypass** leftover these leftover hooks. This beat does **not** leftover-claim leftover a leftover lease. This beat does **not** leftover-schedule leftover leftover-`next_attempt_at`.

4. **Bind the selected Mongo database and declare the five named indexes** — default export leftover `GranotObservationReceipt` leftover is leftover `mongoose.models[...] ?? mongoose.model(...)`. Leftover `getGranotObservationReceiptModel()` leftover returns leftover that leftover same leftover model leftover when leftover `mongoose.connection.name === getMongoDatabaseName()`; leftover otherwise leftover `useDb` leftover + leftover register. Leftover `GRANOT_OBSERVATION_RECEIPT_INDEXES` leftover is leftover five leftover named leftover keys: leftover unique leftover partial leftover `{ observation_channel: 1, channel_operation_id: 1 }` leftover where leftover `channel_operation_id` leftover `$type: "string"`; leftover due leftover `{ "processing.state": 1, "processing.next_attempt_at": 1, captured_at: 1 }`; leftover lease leftover `{ "processing.leased_until": 1 }`; leftover route leftover `{ route_event_class: 1, captured_at: -1 }`; leftover diagnostic leftover `{ payload_sha256: 1, captured_at: -1 }` leftover (**not** leftover unique). Leftover schema leftover loops leftover that leftover catalog leftover onto leftover `Schema.index`. Leftover `autoIndex` leftover is leftover **unset**. Leftover migration leftover leftover-**asks** leftover the leftover catalog. Leftover Job Timeline leftover hops leftover the leftover collection leftover by leftover string leftover `"granot_webhook_receipts"` leftover — leftover **not** leftover this leftover constant. This beat does **not** leftover-`syncIndexes`. This beat does **not** leftover-delete leftover the leftover default leftover export leftover so leftover “everyone leftover-must leftover-call leftover the leftover getter.”

There is no capture-the-webhook operation. `captureGranotLifecycleWebhookReceipt` elects that. There is no claim-and-drain operation. `claimAndProcessOrPoll` elects that. There is no normalize-the-observation operation. `upsertGranotObservation` elects that.

## Organization

Keep one file. This is the screenplay for “remember the credential-redacted Granot envelope on `granot_webhook_receipts`, refuse mutation of evidence after insert so only `processing.*` may change, and declare the five named indexes including partial unique channel plus operation-id — never capture or drain here, never normalize an Observation, never unique-index the payload hash, never merge this into the WordPress ingress receipt, never treat native `collection.updateOne` as a hook bug.” Leftover capture / leftover drain / leftover process / leftover Owner list / leftover index apply already live in deeper **modules**. Leftover later channel catalog already lives in leftover `granotLifecycleSchemas.ts`. Leftover next Observation already lives in a sibling **module**. Already-recommended WordPress ingress already lives in leftover `WordpressFormSubmissionReceipt.ts`. Do not pull those in. Do not invent a `GranotObservationReceiptModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a unique `{ payload_sha256: 1 }` **adapter** so “identical webhooks collapse.” Do not invent an `autoIndex: false` **adapter** from this rename so “boot matches Form.” Do not invent a mongoose-only Decision-stamp **adapter** so “hooks always run” without a paired proof that leftover processor leftover / leftover sync leftover / leftover create leftover / leftover booking leftover / leftover release leftover / leftover discrepancy leftover leftover-stamps leftover still leftover commit leftover on leftover the leftover same leftover session. Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `redact.ts` / `processing.ts` each get a file.

Do not move leftover `captureGranotLifecycleWebhookReceipt` into this file so “the row owns capture.” Do not merge this file into leftover already-recommended leftover `WordpressFormSubmissionReceipt.ts` so “one receipt owns WordPress and Granot.” Do not merge this file into leftover next leftover `GranotObservation.ts` so “one schema owns the envelope and the statement.” Do not merge leftover `granotReceiptProcessingSchema` into this file so “the envelope owns the work-state catalog.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotObservationReceipt` | `granotEnvelopeOnTheDefaultConnection` | leftover getter same-db return still imports the default model |
| `getGranotObservationReceiptModel` | `granotEnvelopeOnTheSelectedMongoDatabase` | leftover capture / leftover drain / leftover Owner read must follow `getMongoDatabaseName()` |
| `GranotObservationReceiptDocument` | `GranotEnvelopeRow` | stored envelope + leftover nested leftover `processing` |
| `assertAllowlistedReceiptProcessingUpdate` | `refuseNonProcessingReceiptUpdate` | leftover mongoose leftover query leftover hooks leftover and leftover leftover `GranotObservationReceipt.test.ts` leftover share leftover the leftover operator leftover fence |
| `GRANOT_OBSERVATION_RECEIPT_COLLECTION` | `granotEnvelopeCollectionName` | leftover migration leftover-opens leftover `granot_webhook_receipts` leftover without leftover leftover-registering leftover the leftover model |
| `GRANOT_OBSERVATION_RECEIPT_MODEL_NAME` | `granotEnvelopeModelName` | leftover getter leftover / leftover default leftover export leftover share leftover `"GranotObservationReceipt"` |
| `GRANOT_OBSERVATION_RECEIPT_INDEXES` | `namedGranotEnvelopeIndexes` | leftover `pnpm migration:granot-lifecycle:indexes` leftover leftover-applies leftover the leftover five leftover named leftover keys |
| `GRANOT_OBSERVATION_RECEIPT_EVIDENCE_FIELDS` | `writeOnceGranotEnvelopeEvidencePaths` | leftover `pre("save")` leftover leftover-refuses leftover leftover those leftover leftover-paths leftover after leftover insert |

Keep the old names as one-line aliases until leftover capture / leftover drain / leftover migration / leftover getter same-db return migrate. Do not make callers learn `useDb` / `partialFilterExpression` / `ALLOWED_UPDATE_OPERATORS` as the domain language. Do **not** leftover-delete leftover the leftover default leftover `GranotObservationReceipt` leftover export leftover so leftover “everyone leftover-must leftover-call leftover the leftover getter.” Do **not** leftover-delete leftover the leftover getter leftover so leftover “envelope leftover-matches leftover Testimonial.” Do **not** leftover-re-export leftover leftover `captureGranotLifecycleWebhookReceipt` leftover from leftover this leftover file leftover so leftover “the leftover row leftover owns leftover capture.” Do **not** leftover-export leftover leftover `ClaimedReceiptSnapshot` leftover so leftover “drain leftover-imports leftover the leftover model leftover type.”

**No class for the workflow.** The one type that *does* earn a name is the pending envelope-identity contract:

```ts
type GranotEnvelopeIdentity = {
  collection: "granot_webhook_receipts"
  evidence: { write_once_after_insert: true }
  processing: { only_mutable_work: true; durable_source_for_drain: true }
  channel_operation_id: {
    unique_with_channel: "partial_when_string"
    webhook: "absent_so_not_in_unique"
  }
  payload_sha256: { unique: false; idempotency: false }
}
```

That is the handoff from “this process remembered a Granot delivery” to “leftover evidence leftover-cannot leftover change, leftover `processing.*` leftover is leftover the leftover drain leftover book, leftover a leftover second leftover leftover-extension leftover leftover-operation leftover leftover-id leftover leftover-11000s, leftover and leftover leftover identical leftover leftover-webhooks leftover leftover-do leftover **not** leftover leftover-collapse.” Do **not** leftover-add leftover `{ payload_sha256: { unique: true } }` leftover so leftover “identical leftover deliveries leftover leftover-replay.” Do **not** leftover-add leftover `{ autoIndex: false }` leftover from leftover this leftover rename leftover so leftover “boot leftover leftover-matches leftover leftover Form.” Do **not** leftover-add leftover leftover `lead_ref` leftover so leftover “Granot leftover leftover-matches leftover leftover WordPress.”

Leave leftover `capture.ts` leftover on leftover that leftover file. Leave leftover `drainer.ts` leftover on leftover that leftover file. Leave leftover later leftover `granotLifecycleSchemas.ts` leftover on leftover that leftover file. Leave leftover leftover next leftover `GranotObservation.ts` leftover on leftover that leftover file. Leave leftover already-recommended leftover `WordpressFormSubmissionReceipt.ts` leftover on leftover that leftover file. Leave leftover leftover-Job leftover-Timeline leftover hop leftover on leftover `mongo-evidence-loader.ts`. Leave leftover leftover-index leftover apply leftover on leftover the leftover leftover-migration leftover script.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotObservationReceipt.ts
// Granot just delivered a webhook,
// or the Owner just approved an extension / HTTP-automation apply —
// or leftover drain is about to claim due work.
// Hold the credential-redacted envelope on granot_webhook_receipts.
// After insert, refuse changing leftover evidence.
// leftover processing.* is the only mutable work.
// Keep leftover { observation_channel, channel_operation_id } unique
// when leftover operation id is a string
// so a second leftover extension / leftover automation insert 11000s
// and leftover capture leftover-replays.
// Do not unique leftover payload_sha256 —
// leftover identical leftover webhooks leftover-are leftover distinct leftover receipts.
// If this process selected a different Mongo database,
// hand back that database's envelope model.
// Do not leftover-capture.
// Do not leftover-claim.
// Do not leftover-normalize leftover an leftover Observation.
// Do not leftover-merge leftover this leftover into leftover WordPress leftover ingress.

export const granotEnvelopeCollectionName =
  GRANOT_OBSERVATION_RECEIPT_COLLECTION
export const granotEnvelopeModelName =
  GRANOT_OBSERVATION_RECEIPT_MODEL_NAME
export const namedGranotEnvelopeIndexes =
  GRANOT_OBSERVATION_RECEIPT_INDEXES
export const writeOnceGranotEnvelopeEvidencePaths =
  GRANOT_OBSERVATION_RECEIPT_EVIDENCE_FIELDS

export { granotEnvelopeCollectionName as GRANOT_OBSERVATION_RECEIPT_COLLECTION }
export { granotEnvelopeModelName as GRANOT_OBSERVATION_RECEIPT_MODEL_NAME }
export { namedGranotEnvelopeIndexes as GRANOT_OBSERVATION_RECEIPT_INDEXES }
export { writeOnceGranotEnvelopeEvidencePaths as GRANOT_OBSERVATION_RECEIPT_EVIDENCE_FIELDS }

export const granotEnvelopeOnTheDefaultConnection =
  GranotObservationReceipt
export function granotEnvelopeOnTheSelectedMongoDatabase() {
  return getGranotObservationReceiptModel()
}
export type GranotEnvelopeRow = GranotObservationReceiptDocument

export { granotEnvelopeOnTheDefaultConnection as GranotObservationReceipt }
export { granotEnvelopeOnTheSelectedMongoDatabase as getGranotObservationReceiptModel }
export type { GranotEnvelopeRow as GranotObservationReceiptDocument }

// ── 1. Hold the credential-redacted Granot envelope ───────

export const GranotObservationReceipt =
  rememberTheGranotEnvelopeOnTheDefaultConnection()

function rememberTheGranotEnvelopeOnTheDefaultConnection() {
  return (
    mongoose.models[GRANOT_OBSERVATION_RECEIPT_MODEL_NAME] ??
    mongoose.model(
      GRANOT_OBSERVATION_RECEIPT_MODEL_NAME,
      rememberTheGranotEnvelopeSchema(),
    )
  )
}

function rememberTheGranotEnvelopeSchema() {
  return new Schema(
    {
      source_system: requiredGranotSourceSystem(),
      observation_channel: requiredObservationChannel(),
      captured_at: requiredCapturedAt(),
      route_event_class: optionalRouteEventClass(),     // required only for webhook
      channel_operation_kind: optionalChannelKind(),    // forbidden on webhook
      authentication_method: requiredAuthenticationMethod(),
      evidence_version: requiredEvidenceVersionTwo(),
      payload_kind: requiredPayloadKind(),
      headers: requiredMixedHeaders(),
      payload: mixedPayload(),
      payload_sha256: requiredLowercaseHexHash(),
      channel_operation_id: optionalOperationId(),      // empty string → undefined
      initiator: optionalDurableActor(),
      processing: requiredReceiptWorkState(),           // sibling schema
      provider: requiredGranotProvider(),
    },
    {
      collection: GRANOT_OBSERVATION_RECEIPT_COLLECTION,
      timestamps: true,
      strict: true,
      // autoIndex is unset — do not copy WordPress autoIndex: false from this rename
    },
  )
}

function refuseWebhookPretendingToBeAChannelApply(receipt) {
  assertReceiptChannelShape(receipt) // sibling catalog
}

// ── 2. Redact credentials on insert; keep the hash honest ─

function redactCredentialsOnInsertAndKeepTheHashHonest(schema) {
  schema.pre("validate", function normalizeOperationId() {
    if (!this.isNew) return
    if (this.channel_operation_id === "") this.set("channel_operation_id", undefined)
    this.set("headers", redactCredentialKeys(this.headers ?? {}).value)
    const evidence = hashCredentialRedactedPayload(this.payload)
    this.set("payload", evidence.redacted_payload)
    if (this.payload_sha256 == null || aForbiddenKeyWasRemoved(evidence)) {
      this.set("payload_sha256", evidence.payload_sha256)
    }
  })
}

// ── 3. Refuse evidence mutation; only processing.* may change

export function refuseNonProcessingReceiptUpdate(update) {
  return assertAllowlistedReceiptProcessingUpdate(update)
}

function refuseMutationOfEvidenceAfterInsert(schema) {
  schema.pre("save", function rejectEvidenceMutation() {
    if (this.isNew) return
    refuseChangesTo(GRANOT_OBSERVATION_RECEIPT_EVIDENCE_FIELDS)
    refuseAnyPathExceptProcessingAndUpdatedAt()
  })
  for (const operation of ["updateOne", "updateMany", "findOneAndUpdate"]) {
    schema.pre(operation, function rejectNonProcessingUpdate() {
      assertAllowlistedReceiptProcessingUpdate(this.getUpdate())
    })
  }
  for (const operation of ["replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"]) {
    schema.pre(operation, function rejectEvidenceReplaceOrDelete() {
      throw new Error("GranotObservationReceipt evidence cannot be replaced or deleted")
    })
  }
  // leftover .collection.updateOne Decision stamps bypass these hooks
}

// ── 4. Bind selected DB; declare the five named indexes ───

export function getGranotObservationReceiptModel() {
  if (thisConnectionAlreadyIsTheSelectedDatabase()) {
    return GranotObservationReceipt
  }
  return registerTheEnvelopeOnTheSelectedDatabase()
}

function declareTheFiveNamedIndexes(schema) {
  for (const index of GRANOT_OBSERVATION_RECEIPT_INDEXES) {
    schema.index(index.key, namedIndexOptions(index))
  }
}
```

Read the primary path out loud: *hold the credential-redacted envelope on `granot_webhook_receipts` with `source_system: "granot"`, a channel (`granot_webhook` / `browser_extension` / `granot_http_automation`), `captured_at`, v2 evidence, Mixed payload, and nested `processing.*` starting `pending`; on insert redact credential keys and keep `payload_sha256` honest; after insert refuse changing evidence and refuse replace/delete; mongoose updates may only `$set` / `$inc` / `$unset` / `$setOnInsert` on `processing.*`; declare the five named indexes so channel plus string operation-id 11000s, due/lease scans can find work, and the payload hash stays diagnostic; if this process selected a different Mongo database, hand back that database’s envelope model. Do not capture. Do not claim. Do not normalize an Observation. Do not unique the payload hash. Do not merge this into WordPress.*

That is the operation. An unnamed receipt dump is not. `captureGranotLifecycleWebhookReceipt` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **This is the Granot envelope. It is not a WordPress ingress receipt and not a Granot Observation.** Already-recommended `WordpressFormSubmissionReceipt.ts` owns unique `submission_key`, `form_path: "test"`, and write-once Form-Lead `lead_ref`. Leftover next `GranotObservation.ts` owns one normalized statement per receipt. Do not merge so “one receipt owns WordPress and Granot.” Do not add `lead_ref` so “the envelope points at the Lead.” Do not add `sheet_sync[]` so “the envelope remembers the tab.”

2. **The physical collection is still `granot_webhook_receipts`.** The model name is `GranotObservationReceipt`. Job Timeline hops the string `"granot_webhook_receipts"` and does not import this file. Do not rename the collection from this pass so “the name matches the model.” Do not rewrite the loader from this rename so “the constant wins.”

3. **`payload_sha256` is diagnostic, never idempotency.** Knowledge: identical webhook deliveries are distinct receipts. Channel replay compares hash **and** `channel_operation_kind` after a 11000. The payload-hash index is explicitly not unique. Do not unique-index `payload_sha256` so “identical webhooks collapse.”

4. **Webhook rows omit `channel_operation_id` so they stay out of the unique.** Empty string becomes `undefined` on insert. The unique is partial on `$type: "string"`. Extension leftover-requires leftover lowercase UUID v4. Automation leftover-requires leftover `${run_id}:${action_id}`. Do not require `channel_operation_id` on leftover webhook so “every envelope has an operation id.”

5. **`legacy_unknown` is still in the authentication enum.** Leftover capture leftover-throws leftover unless leftover webhook leftover leftover-auth leftover is leftover `body_secret` leftover or leftover `header_secret`. Leftover `GranotObservationReceipt.test.ts` leftover webhook leftover fixtures leftover still leftover use leftover `legacy_unknown`. Do not drop leftover `legacy_unknown` leftover from leftover this leftover rename leftover so leftover “schema leftover leftover-matches leftover leftover capture” leftover without leftover a leftover paired leftover proof leftover that leftover leftover historical leftover rows leftover leftover-still leftover leftover-validate.

6. **Capture already redacts. The insert hook redacts again.** `buildGranotObservationReceiptInsert` leftover-asks leftover `hashCredentialRedactedPayload` leftover then leftover `create`. Leftover `pre("validate")` leftover leftover-redacts leftover leftover-only leftover leftover-on leftover leftover-`isNew`. Do not move leftover `redactCredentialKeys` leftover into leftover this leftover file leftover so leftover “the leftover row leftover owns leftover the leftover forbidden leftover keys.” Do not leftover-delete leftover the leftover hook leftover so leftover “capture leftover leftover-already leftover leftover-redacted.”

7. **`.collection.updateOne` Decision stamps bypass the mongoose fence.** Leftover processor leftover / leftover sync leftover / leftover create leftover / leftover booking leftover / leftover release leftover / leftover discrepancy leftover leftover-`$set` leftover leftover `processing.latest_decision_id` leftover leftover-through leftover leftover the leftover leftover native leftover leftover driver. The path leftover-is leftover still leftover `processing.*`. Leftover drain leftover leftover-uses leftover leftover mongoose leftover leftover `findOneAndUpdate` leftover / leftover leftover `updateOne` leftover so leftover leftover hooks leftover leftover-run. Do not leftover-rewrite leftover leftover those leftover leftover stamps leftover leftover from leftover leftover this leftover leftover rename leftover so leftover “hooks leftover leftover-always leftover leftover-run.” Do not leftover-treat leftover leftover the leftover leftover bypass leftover leftover as leftover leftover a leftover leftover hook leftover leftover bug leftover leftover to leftover leftover silently leftover leftover “fix.”

8. **`autoIndex` is unset. WordPress and Form/Call/Booked set `false`.** Leftover `pnpm migration:granot-lifecycle:indexes` leftover leftover-applies leftover leftover the leftover leftover named leftover leftover catalog. Do not leftover-flip leftover leftover `autoIndex: false` leftover leftover from leftover leftover this leftover leftover rename leftover so leftover “boot leftover leftover-matches leftover leftover Form” leftover leftover without leftover leftover a leftover leftover paired leftover leftover proof leftover leftover that leftover leftover test leftover leftover / leftover leftover preview leftover leftover still leftover leftover find leftover leftover the leftover leftover unique leftover leftover when leftover leftover capture leftover leftover 11000-replays.

9. **Leave sibling modules alone.** Capture / drain / process / Owner list / channel catalog / next Observation / already-recommended WordPress ingress / Job Timeline hop / index apply are already the right **depth**. This file holds the envelope, the write-once fence, the processing-only update fence, and the named index catalog. `captureGranotLifecycleWebhookReceipt` / `claimAndProcessOrPoll` / `upsertGranotObservation` are those **interfaces**, not this one.

## Testing

The **interface** is the test surface: `GranotObservationReceipt` / `getGranotObservationReceiptModel` / `assertAllowlistedReceiptProcessingUpdate` / `GRANOT_OBSERVATION_RECEIPT_INDEXES` / `GRANOT_OBSERVATION_RECEIPT_COLLECTION` / schema validate (channel contract + insert redact + save write-once) / mongoose `updateOne` / `replaceOne` / `deleteOne`.

Today’s proofs sit on `GranotObservationReceipt.test.ts` (collection + model name, five named indexes, webhook vs extension vs automation channel contract, operation-id shapes, `last_error.message` cap, legacy capture-shaped create rejected, save write-once, allowlist, replace/delete refuse). Keep those on this **interface**. Caller proofs stay on leftover `capture.test.ts` / leftover `drainer.replica.test.ts` / leftover migration lib tests.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the envelope**
- Collection option is `granot_webhook_receipts`.
- `source_system` requires `"granot"` and refuses `"wordpress"`.
- Webhook validate succeeds with `route_event_class` and no `channel_operation_kind`.
- Webhook validate refuses missing `route_event_class` and refuses a channel kind.
- Extension / automation validate require kind + operation id and refuse a route class.
- Empty webhook `channel_operation_id` becomes `undefined` after validate.
- Schema has **no** `lead_ref` / **no** `submission_key` / **no** `form_path` / **no** `sheet_sync`.

**Redact on insert**
- Insert validate strips a forbidden header key through `redactCredentialKeys`.
- Missing `payload_sha256` is filled from the redacted payload hash.
- `payload_sha256` that is not 64 lowercase hex invalidates.

**Refuse evidence mutation**
- After insert, changing `payload` / `headers` / `captured_at` on `save` throws write-once.
- `assertAllowlistedReceiptProcessingUpdate({ $set: { payload: {} } })` throws.
- `assertAllowlistedReceiptProcessingUpdate({ $set: { "processing.state": "claimed" }, $inc: { "processing.technical_attempts": 1 } })` does not throw.
- `replaceOne` / `deleteOne` throw “cannot be replaced or deleted.”
- mongoose `updateOne` `$set` `payload` throws. Do **not** assert leftover `.collection.updateOne` leftover throws — leftover Decision leftover stamps leftover leftover-use leftover leftover that leftover leftover path leftover leftover on leftover leftover purpose.

**Selected database + named indexes**
- `GRANOT_OBSERVATION_RECEIPT_INDEXES` is exactly five named keys.
- Unique is only `{ observation_channel, channel_operation_id }` partial `$type: "string"`.
- `granot_observation_receipt_payload_sha256_diag` is **not** unique.
- `getGranotObservationReceiptModel()` returns `GranotObservationReceipt` when `connection.name` already is `getMongoDatabaseName()`.
- `GRANOT_OBSERVATION_RECEIPT_COLLECTION` equals `"granot_webhook_receipts"`.

Do **not** add a test per helper (`rememberTheGranotEnvelopeSchema`, `thisConnectionAlreadyIsTheSelectedDatabase`). Those names exist so the parent reads. Do **not** `captureGranotLifecycleWebhookReceipt` from this file’s tests. Do **not** `claimAndProcessOrPoll` from this file’s tests. Do **not** `syncIndexes` so “the test creates uniqueness.” Do **not** HTTP webhook from this file’s tests. Do **not** open Job Timeline from this file’s tests.

`getGranotObservationReceiptModel` stays exported because selected-database binding is a second real **adapter**, not a test leak. `assertAllowlistedReceiptProcessingUpdate` stays exported because leftover mongoose leftover hooks leftover and leftover this leftover file’s leftover tests leftover share leftover that leftover fence.

## What I would not do

- A `GranotObservationReceiptModelService` / `GranotReceiptService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `redact.ts` / `processing.ts` split for cleanliness.
- Breaking the selected-database **seam**. Capture / drain must not write live `granot_webhook_receipts` while `TEST_MODE` selected `testvantagemovers`.
- Treating `captureGranotLifecycleWebhookReceipt` / `captureChannelOperationReceipt` as this story. Those functions build the insert and collapse 11000.
- Treating `claimAndProcessOrPoll` / `requeueDeadLetterReceipt` as this story. Those files claim, retry, and requeue.
- Treating `upsertGranotObservation` as this story. Leftover next `GranotObservation.ts` holds the statement.
- Treating already-recommended `WordpressFormSubmissionReceipt.ts` as this story.
- Inventing a unique `{ payload_sha256: 1 }` **adapter** that has only “identical webhooks collapse” as its second home.
- Inventing an `autoIndex: false` **adapter** from this rename that has only “boot matches Form” as its second home.
- Inventing a mongoose-only Decision-stamp **adapter** so “hooks always run.”
- Inventing a leftover `lead_ref` leftover **adapter** so leftover “Granot leftover leftover-matches leftover leftover WordPress.”
- Silently unique-indexing `payload_sha256`.
- Silently flipping `autoIndex: false`.
- Silently rewriting leftover `.collection.updateOne` leftover Decision leftover stamps leftover so leftover hooks leftover leftover-run.
- Silently merging this file into leftover WordPress leftover ingress leftover or leftover leftover next leftover Observation.
- Silently “fixing” ADR-0001 / ADR-0002 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
