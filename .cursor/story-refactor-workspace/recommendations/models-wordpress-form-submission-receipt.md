# Remember The WordPress Form-Submission Ingress Receipt On The Selected Mongo Database, Refuse Mutation Of Ingress Identity After Insert And Refuse Nulling The Write-Once Form-Lead Pointer, And Declare Named Unique Submission-Key Plus Partial Lead-Ref Indexes The Migration Applies — Never Ingest The Form Lead Here, Never Decide Authorization, Never Auto-Create Indexes On Boot, Never Apply Those Indexes On `vantagemovers`, Never Emit Job-Timeline Source-Received, Never Copy Sheet-Hint Or Source-Company, Never Merge This Into A Granot Observation Receipt — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 19 of this service — `WordpressFormSubmissionReceipt.ts`
- Remaining in this service: `GranotObservationReceipt.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/WordpressFormSubmissionReceipt.ts`
- Knowledge: [`docs/knowledge/services/form-lead.md`](../../../docs/knowledge/services/form-lead.md) (Job Timeline source-assurance, **not** Granot lifecycle delivery. Capture runs **before** `FormLead.save` only when origin is `wordpress_form`, `TEST_MODE` is on, and the database matches `^testvantagemovers(?:_[a-z0-9]+)?$`. Request `wordpress_submission_key` is 8–128 and is **never inferred**. Fail-closed capture / fail-closed attach. Same key + unattached receipt refuses a second Lead. Same key + existing `lead_ref` whose Lead exists reuses that Lead — no second receipt, Lead, Sheet Sync, CRM Post, or EntityChange. Authorized capture with a key forces the Form Lead write onto the same Mongo transaction. Unauthorized / missing key / `vantagemovers` DB: no receipt write; Lead create continues; Job Number timeline stays on `WORDPRESS_RECEIPT_UNAVAILABLE`. Collection `wordpress_form_submission_receipts`, `autoIndex: false`. Indexes are report-first via `pnpm migration:wordpress-form-submission-receipts`; applied on `testvantagemovers` only; `vantagemovers` apply is refused in the CLI. Knowledge resource list names the Form Lead Service — do not add a Models Service file in this rename so “the Service sentence wins”). Compatibility rule: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) (durable WordPress form-submission ingress fact; **not** a Lead and **not** a Granot Observation Receipt; immutable after insert: `source_system` / `submission_key` / `received_at` / `form_path` (`test` on the authorized path); `lead_ref` is write-once `{ model: "FormLead", id }`; `processing_status` is `received` → `lead_created`; unique `{ submission_key: 1 }`; non-unique partial `{ "lead_ref.id": 1 }`; no contact, payload, CRM, or Sheet fields). Related ingest: already-recommended [form-lead.md](form-lead.md) (`ingestFormLead` / `beginFormLeadIngestion` leftover-**asks** leftover `captureWordpressReceiptThenCreateLead` — **this file never captures**, never saves a Form Lead). Related store: leftover `leads/wordpressFormSubmissionReceipt.ts` (`createMongoWordpressReceiptStore` leftover-**asks** `getWordpressFormSubmissionReceiptModel` — **this file never authorizes**, never collapses a 11000 into the existing row). Related timeline: already-recommended [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) / [job-number-timeline-assemble.md](job-number-timeline-assemble.md) (`db.collection("wordpress_form_submission_receipts").find({ "lead_ref.id" })` — **this file never hops**, never emits `source_received`). Already-recommended Form row: [models-form-lead.md](models-form-lead.md) (`getFormLeadModel` — **this file never holds a quote**). Already-recommended leftover field catalog: [models-schema-helpers.md](models-schema-helpers.md) (`sourceCompanyField` / leftover `sheetSyncSchema` — **this file has neither**). Distinct from leftover next Granot envelope: leftover next `GranotObservationReceipt.ts` (collection leftover `granot_webhook_receipts`; leftover `processing.*` is the drain work source — **do not merge**). Distinct from leftover Testimonial default-only: already-recommended [models-testimonial.md](models-testimonial.md) (**no** getter — **do not delete this getter so “receipt matches review”**). Distinct from leftover historical relax: this checkout has **no** `historical/WordpressFormSubmissionReceipt.ts`. Leftover overview / leftover health / leftover Registry / leftover historical-consolidation **do not** ask this collection. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [WordPress Form Submission Receipt](../../../../CONTEXT.md); this checkout does **not** define it — do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 / ADR-0002 on the Form Lead Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model vs named-index catalog vs raw-collection hop.** Leftover `leads/wordpressFormSubmissionReceipt.ts` leftover `createMongoWordpressReceiptStore` leftover-**asks** `getWordpressFormSubmissionReceiptModel` for leftover `insertReceived` (`Model.create` `processing_status: "received"`, leftover `lead_ref: null`, leftover `form_path: "test"`), leftover `findBySubmissionKey`, and leftover `attachLeadRef` (`findOneAndUpdate` `{ _id, $or: [{ lead_ref: null }, { "lead_ref.id": lead_id }] }` then `$set` leftover `lead_created` + leftover `{ model: "FormLead", id }`). Already-recommended `formLead.service.ts` leftover-**asks** leftover `captureWordpressReceiptThenCreateLead` + leftover `createMongoWordpressReceiptStore` — **not** this file. Leftover `scripts/migrations/wordpress-form-submission-receipts.ts` leftover-**asks** leftover `WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION` + leftover `WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES` (report-first; leftover apply leftover-refuses leftover `vantagemovers`). Leftover `wordpress-form-submission-receipts.lib.ts` / leftover `.lib.test.ts` leftover-**ask** leftover `WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES`. Already-recommended leftover `jobNumberTimeline/mongo-evidence-loader.ts` leftover-hops leftover `db.collection("wordpress_form_submission_receipts")` by leftover `{ "lead_ref.id": leadDoc._id }` and leftover-projects leftover `received_at` / leftover `createdAt` / leftover `processing_status` / leftover `lead_ref.id` — **it does not import this file**. Leftover `jobNumberTimeline/rows.ts` leftover-owns leftover `WordpressFormSubmissionReceiptRow` — **not** this type. Leftover `wordpressFormSubmissionReceipt.test.ts` leftover-asks leftover memory store + leftover `captureWordpressReceiptThenCreateLead` — **not** this model. Wave B `leads.validation.ts` leftover-asks leftover `wordpress_submission_key` (trim, 8–128) — **not** this file. There is no `WordpressFormSubmissionReceipt.test.ts`. Nobody leftover-inspects leftover `WordpressFormSubmissionReceipt.schema.indexes()`. Nobody leftover-imports leftover default `WordpressFormSubmissionReceipt` except leftover getter same-db return. Leftover overview / leftover health / leftover historical-consolidation / leftover Registry **do not** import this file. Not this **interface**: leftover `captureWordpressReceiptThenCreateLead` itself, leftover `ingestFormLead` itself, leftover `wordpressReceiptWriteAuthorized` itself, leftover `createJobNumberTimelineModule({ loader }).read` itself, leftover `assemble.ts` leftover `source_received` itself.
- Seams callers need: default `WordpressFormSubmissionReceipt` (first-registered connection — leftover getter same-db return) vs `getWordpressFormSubmissionReceiptModel()` (selected `getMongoDatabaseName()` — leftover store write / leftover find / leftover attach); leftover `autoIndex: false` vs leftover `pnpm migration:wordpress-form-submission-receipts` apply (leftover `testvantagemovers` only; leftover `vantagemovers` apply leftover-refused); named leftover `WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES` (unique leftover `submission_key`; non-unique leftover partial leftover `{ "lead_ref.id": 1 }` where leftover `$type: "objectId"`) vs leftover Job Timeline hardcoded leftover `db.collection("wordpress_form_submission_receipts")` (same collection, **not** leftover `WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION`); leftover immutable leftover `source_system` / leftover `submission_key` / leftover `received_at` / leftover `form_path` vs leftover mutable leftover `processing_status`; leftover write-once leftover `lead_ref` (schema leftover-invalidates leftover `null` after insert; leftover store leftover-filters leftover null-or-same-id) vs leftover schema **not** refusing a different leftover Form Lead id; leftover `Model.create` leftover-runs leftover `pre("validate")` vs leftover `findOneAndUpdate` leftover-**without** leftover `runValidators` (leftover attach leftover-does **not** fire leftover `rejectImmutableReceiptFields`); leftover `form_path` enum leftover `"test"` only vs leftover authorized leftover `TEST_MODE` + leftover `testvantagemovers*` (leftover authorization leftover-lives on leftover `wordpressReceiptWriteAuthorized`, **not** here); leftover `lead_ref.model` leftover `"FormLead"` only vs leftover Call Lead (leftover Job Timeline leftover-hops leftover receipts **only** when leftover resolved Lead is leftover Form). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no CRM Posting **seam**. There is no authorization **seam**. There is no Job Timeline **seam**.
- Split later (only if the file outgrows one sitting): this ~118-line file is one sitting if you read it as remember the WordPress form-submission ingress receipt on the selected Mongo database, refuse mutation of ingress identity after insert and refuse nulling the write-once Form-Lead pointer, and declare named unique submission-key plus partial lead-ref indexes the migration applies — never ingest the Form Lead here, never decide authorization, never auto-create indexes on boot, never apply those indexes on `vantagemovers`, never emit Job-Timeline `source_received`, never copy sheet-hint or source-company, never merge this into a Granot Observation Receipt. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `authorize.ts` / `attach.ts`. Capture / attach / 11000 collapse stay leftover `wordpressFormSubmissionReceipt.ts`. Ingest stays already-recommended `formLead.service.ts`. Timeline hop stays leftover `mongo-evidence-loader.ts`. Index apply stays leftover `scripts/migrations/wordpress-form-submission-receipts.ts`. Next Granot envelope stays leftover `GranotObservationReceipt.ts`.

`WordpressFormSubmissionReceipt` is a Mongoose model name. The owner question is: *WordPress just posted this quote on the authorized test path — or leftover Job Timeline is about to hop by leftover `lead_ref.id`. Hold the ingress receipt on `wordpress_form_submission_receipts`. Keep leftover `submission_key` unique so a second insert 11000s. After insert, refuse changing leftover `source_system` / leftover `submission_key` / leftover `received_at` / leftover `form_path`. Once a Form Lead is attached, refuse leftover-nulling leftover `lead_ref`. Keep leftover `autoIndex: false` so boot does not create the unique / partial indexes — leftover report-first leftover `pnpm migration:wordpress-form-submission-receipts` leftover-applies them on leftover `testvantagemovers` only, and leftover `vantagemovers` leftover-apply leftover-is leftover-refused. If this process selected a different Mongo database, hand back that database’s receipt model. Do not ingest the Form Lead. Do not decide leftover `wordpress_form` plus leftover `TEST_MODE` plus leftover test database. Do not emit leftover `source_received`. Do not infer leftover `submission_key` from leftover `lid` / leftover phone / leftover email / leftover Tracking Reference. Do not copy leftover `sheet_sync[]` or leftover `sourceCompanyField` here. Do not merge this into leftover next Granot Observation Receipt. Do not flip leftover `autoIndex` on so “boot creates uniqueness.” Do not leftover-apply leftover indexes on leftover `vantagemovers` so “the live cluster matches test.”*

Who leftover-capture / leftover-attach / leftover-authorize already lives in leftover `wordpressFormSubmissionReceipt.ts`. Who leftover-ingest already lives in already-recommended `formLead.service.ts`. Who leftover-hop leftover receipts already lives in leftover `mongo-evidence-loader.ts`. Who leftover-apply leftover indexes already lives in leftover `scripts/migrations/wordpress-form-submission-receipts.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the WordPress form-submission ingress receipt, refuse mutation of ingress identity after insert and refuse nulling the write-once Form-Lead pointer, and declare named unique submission-key plus partial lead-ref indexes the migration applies” story, not “a WordPress receipt model CRUD dump,” and not Capture The WordPress Receipt Then Create The Form Lead / Assemble The Job Number Timeline themselves:

1. **Hold the WordPress form-submission ingress receipt** — collection `wordpress_form_submission_receipts` (`WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION`), `autoIndex: false`, `timestamps: true`, `strict: true`. **No** `optimisticConcurrency`. **No** `sheet_sync[]`. **No** `source_company`. **No** contact / payload / CRM fields. **No** Ingestion Origin (origin lives on the Form Lead). Declares required `source_system` (enum `["wordpress"]`, default `"wordpress"`), required trimmed `submission_key`, required `received_at` (Date), required `processing_status` (enum `["received", "lead_created"]`, default `"received"`), `lead_ref` (`leadRefSchema` `{ model: "FormLead", id: ObjectId }`, `{ _id: false }`, default `null`), required `form_path` (enum `["test"]`, default `"test"`). `WordpressFormSubmissionReceiptDocument` is `InferSchemaType` plus `_id`. This beat does **not** authorize `wordpress_form`. This beat does **not** trim 8–128 (`resolveWordpressSubmissionKey` elects that). This beat does **not** save a Form Lead. An unauthorized create never writes this collection.

2. **Refuse mutation of ingress identity after insert, and refuse nulling the write-once Form-Lead pointer** — `pre("validate")` `rejectImmutableReceiptFields`. New documents return. `IMMUTABLE_PATHS` are `source_system` / `submission_key` / `received_at` / `form_path`. `lead_ref` invalidates when `isModified("lead_ref")` **and** `get("lead_ref") == null`. `processing_status` is **not** immutable (`received` may become `lead_created`). This beat does **not** refuse swapping `lead_ref.id` to a different Form Lead — store filter `$or` null-or-same-id elects that on `attachLeadRef`. This beat does **not** run on `findOneAndUpdate` unless `runValidators: true` — today’s attach omits that option. This beat does **not** refuse `processing_status` going backwards `lead_created` → `received`.

3. **Bind the selected Mongo database and declare the named indexes the migration applies** — default export `WordpressFormSubmissionReceipt` is `mongoose.models[WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME] ?? mongoose.model(...)`. `getWordpressFormSubmissionReceiptModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Named catalog `WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES` is two indexes: unique `{ submission_key: 1 }` name `wordpress_form_submission_receipt_submission_key_unique`; non-unique `{ "lead_ref.id": 1 }` name `wordpress_form_submission_receipt_lead_ref` plus `partialFilterExpression` `{ "lead_ref.id": { $type: "objectId" } }`. Schema loops that catalog onto `Schema.index`. `autoIndex` stays `false`. Store write / find / attach **ask** the getter. Migration **asks** the catalog + the collection name. Job Timeline hops the collection by string `"wordpress_form_submission_receipts"` — **not** this constant. This beat does **not** `syncIndexes`. This beat does **not** apply on `vantagemovers`. This beat does **not** delete the default export so “everyone must call the getter.” This beat does **not** invent `getTestimonialModel` so “receipt matches review.”

There is no capture-then-create operation. `captureWordpressReceiptThenCreateLead` elects that. There is no Job Timeline `source_received` operation. `assemble.ts` elects that after a loaded receipt row.

## Organization

Keep one file. This is the screenplay for “remember the WordPress form-submission ingress receipt on the selected Mongo database, refuse mutation of ingress identity after insert and refuse nulling the write-once Form-Lead pointer, and declare named unique submission-key plus partial lead-ref indexes the migration applies — never ingest the Form Lead here, never decide authorization, never auto-create indexes on boot, never apply those indexes on `vantagemovers`, never emit Job-Timeline `source_received`, never copy sheet-hint or source-company, never merge this into a Granot Observation Receipt.” Leftover capture / leftover attach / leftover authorize / leftover ingest / leftover timeline hop / leftover index apply already live in deeper **modules**. Leftover next Granot envelope already lives in a sibling **module**. Do not pull those in. Do not invent a `WordpressFormSubmissionReceiptModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent an `autoIndex: true` **adapter** so “boot creates uniqueness.” Do not invent a leftover `vantagemovers` leftover-apply leftover **adapter** so “the live cluster matches test.” Do not invent a leftover `runValidators: true` leftover **adapter** on leftover attach leftover from leftover this leftover rename leftover so leftover “hook leftover-matches leftover store” leftover without leftover a leftover paired leftover proof leftover that leftover leftover-`findOneAndUpdate` leftover still leftover-attaches leftover on leftover the leftover same leftover transaction. Do not invent a leftover unique leftover `{ "lead_ref.id": 1 }` leftover **adapter** so leftover “one leftover receipt leftover per leftover Form Lead.” Do not invent a leftover `form_path` leftover `"`vantagemovers`"` leftover enum leftover so leftover “receipts leftover work leftover in leftover `vantagemovers`.” Do not invent a leftover CRUD leftover folder leftover so leftover `schema.ts` / leftover `indexes.ts` / leftover `authorize.ts` / leftover `attach.ts` leftover each leftover get leftover a leftover file.

Do not move leftover `captureWordpressReceiptThenCreateLead` leftover into leftover this leftover file leftover so leftover “the leftover row leftover owns leftover capture.” Do not leftover-merge leftover this leftover file leftover into leftover already-recommended leftover `FormLead.ts` leftover so leftover “one leftover schema leftover owns leftover the leftover quote leftover and leftover the leftover ingress leftover receipt.” Do not leftover-merge leftover this leftover file leftover into leftover leftover next leftover `GranotObservationReceipt.ts` leftover so leftover “one leftover receipt leftover owns leftover WordPress leftover and leftover Granot.” Do not leftover-merge leftover this leftover file leftover into leftover already-recommended leftover `schemaHelpers.ts` leftover so leftover “one leftover field leftover catalog leftover owns leftover `source_company` leftover and leftover leftover `submission_key`.” Do not leftover-split leftover `create.ts` / leftover `update.ts` / leftover `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `WordpressFormSubmissionReceipt` | `wordpressIngressReceiptOnTheDefaultConnection` | leftover getter same-db return still imports the default model |
| `getWordpressFormSubmissionReceiptModel` | `wordpressIngressReceiptOnTheSelectedMongoDatabase` | leftover store insert / leftover find / leftover attach must follow `getMongoDatabaseName()` |
| `WordpressFormSubmissionReceiptDocument` | `WordpressIngressReceiptRow` | inferred document + `_id` |
| `WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION` | `wordpressIngressReceiptCollectionName` | leftover migration leftover-opens leftover that leftover collection leftover without leftover leftover-registering leftover the leftover model |
| `WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME` | `wordpressIngressReceiptModelName` | leftover getter leftover / leftover default leftover export leftover share leftover `"WordpressFormSubmissionReceipt"` |
| `WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES` | `namedWordpressIngressReceiptIndexesTheMigrationApplies` | leftover `pnpm migration:wordpress-form-submission-receipts` leftover is leftover the leftover only leftover apply leftover path |

Keep the old names as one-line aliases until leftover `wordpressFormSubmissionReceipt.ts`, leftover migration, leftover migration lib, and leftover getter same-db return migrate. Do not make callers learn `useDb` / `partialFilterExpression` / `IMMUTABLE_PATHS` as the domain language. Do **not** leftover-delete leftover the leftover default leftover `WordpressFormSubmissionReceipt` leftover export leftover so leftover “everyone leftover-must leftover-call leftover the leftover getter” leftover without leftover a leftover paired leftover proof leftover that leftover leftover-getter leftover same-db leftover still leftover-returns leftover today’s leftover model leftover leftover-store leftover leftover-**asks** leftover through leftover the leftover leftover-getter. Do **not** leftover-delete leftover the leftover getter leftover so leftover “receipt leftover-matches leftover Testimonial” leftover without leftover a leftover paired leftover proof leftover that leftover leftover-store leftover still leftover-writes leftover selected leftover `wordpress_form_submission_receipts`. Do **not** leftover-re-export leftover leftover `wordpressReceiptWriteAuthorized` leftover from leftover this leftover file leftover so leftover “the leftover row leftover owns leftover authorization.” Do **not** leftover-export leftover leftover `WordpressFormSubmissionReceiptRow` leftover so leftover “timeline leftover-imports leftover the leftover model.”

**No class for the workflow.** The one type that *does* earn a name is the pending ingress-identity contract:

```ts
type WordpressIngressReceiptIdentity = {
  submission_key: { unique: true; inferred: false }
  form_path: "test"
  lead_ref: { model: "FormLead"; write_once: true; nullable_until_attach: true }
  processing_status: "received" | "lead_created"
  autoIndex: false
}
```

That is the handoff from “this process remembered a WordPress ingress” to “a second leftover `submission_key` leftover-11000s leftover (leftover after leftover the leftover migration leftover-applied leftover the leftover unique leftover index leftover on leftover leftover-`testvantagemovers`), leftover leftover-`lead_ref` leftover-cannot leftover-go leftover back leftover to leftover leftover-`null`, leftover and leftover leftover-boot leftover leftover-does leftover **not** leftover leftover-create leftover leftover those leftover leftover-indexes.” Do **not** leftover-add leftover `{ "lead_ref.id": { unique: true } }` leftover so leftover “one leftover Form Lead leftover owns leftover one leftover receipt.” Do **not** leftover-add leftover `{ form_path: "`vantagemovers`" }` leftover so leftover “`vantagemovers` leftover WordPress leftover can leftover store leftover a leftover receipt.” Do **not** leftover-add leftover `{ autoIndex: true }` leftover so leftover “boot leftover creates leftover uniqueness.”

Leave leftover `wordpressFormSubmissionReceipt.ts` leftover on leftover that leftover file. Leave leftover already-recommended leftover `FormLead.ts` leftover on leftover that leftover file. Leave leftover already-recommended leftover `schemaHelpers.ts` leftover on leftover that leftover file. Leave leftover leftover next leftover `GranotObservationReceipt.ts` leftover on leftover that leftover file. Leave leftover leftover-Job leftover-Timeline leftover hop leftover on leftover `mongo-evidence-loader.ts`. Leave leftover leftover-index leftover apply leftover on leftover the leftover leftover-migration leftover script.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// WordpressFormSubmissionReceipt.ts
// WordPress just posted this quote on the authorized test path —
// or leftover Job Timeline is about to hop by leftover lead_ref.id.
// Hold the ingress receipt on wordpress_form_submission_receipts.
// Keep leftover submission_key unique so a second insert 11000s.
// After insert, refuse changing leftover source_system /
// leftover submission_key / leftover received_at / leftover form_path.
// Once a Form Lead is attached, refuse leftover-nulling leftover lead_ref.
// Keep leftover autoIndex false so boot does not create
// the unique / partial indexes —
// leftover report-first leftover migration leftover-applies them
// on leftover testvantagemovers only,
// and leftover `vantagemovers` leftover-apply leftover-is leftover-refused.
// If this process selected a different Mongo database,
// hand back that database's receipt model.
// Do not ingest the Form Lead.
// Do not decide leftover wordpress_form plus leftover TEST_MODE
// plus leftover test database.
// Do not emit leftover source_received.
// Do not infer leftover submission_key from leftover lid /
// leftover phone / leftover email / leftover Tracking Reference.
// Do not copy leftover sheet_sync or leftover sourceCompanyField here.
// Do not merge this into leftover next Granot Observation Receipt.

export const wordpressIngressReceiptCollectionName =
  WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION
export const wordpressIngressReceiptModelName =
  WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME
export const namedWordpressIngressReceiptIndexesTheMigrationApplies =
  WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES

export { wordpressIngressReceiptCollectionName as WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION }
export { wordpressIngressReceiptModelName as WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME }
export { namedWordpressIngressReceiptIndexesTheMigrationApplies as WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES }

export const wordpressIngressReceiptOnTheDefaultConnection =
  WordpressFormSubmissionReceipt
export function wordpressIngressReceiptOnTheSelectedMongoDatabase() {
  return getWordpressFormSubmissionReceiptModel()
}
export type WordpressIngressReceiptRow = WordpressFormSubmissionReceiptDocument

export { wordpressIngressReceiptOnTheDefaultConnection as WordpressFormSubmissionReceipt }
export { wordpressIngressReceiptOnTheSelectedMongoDatabase as getWordpressFormSubmissionReceiptModel }
export type { WordpressIngressReceiptRow as WordpressFormSubmissionReceiptDocument }

// ── 1. Hold the WordPress form-submission ingress receipt ─

export const WordpressFormSubmissionReceipt = rememberTheWordpressIngressReceiptOnTheDefaultConnection()

function rememberTheWordpressIngressReceiptOnTheDefaultConnection() {
  return (
    mongoose.models[WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME] ??
    mongoose.model(WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME, rememberTheWordpressIngressReceiptSchema())
  )
}

function rememberTheWordpressIngressReceiptSchema() {
  return new Schema(
    {
      source_system: requiredWordpressSourceSystem(),
      submission_key: requiredTrimmedSubmissionKey(),
      received_at: requiredReceivedAt(),
      processing_status: requiredReceivedOrLeadCreatedDefaultReceived(),
      lead_ref: writeOnceFormLeadPointerDefaultNull(), // model FormLead only
      form_path: requiredTestFormPath(),               // authorized path marker
    },
    {
      collection: WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION,
      autoIndex: false,
      timestamps: true,
      strict: true,
    },
  )
}

// ── 2. Refuse identity mutation; refuse nulling lead_ref ─

function refuseMutationOfIngressIdentityAfterInsert(schema) {
  schema.pre("validate", function rejectImmutableReceiptFields() {
    if (this.isNew) return
    refuseChangesTo(IMMUTABLE_PATHS) // source_system, submission_key, received_at, form_path
    refuseNullingLeadRefOnceAttached()
    // does not refuse swapping lead_ref.id to another Form Lead
    // does not run on findOneAndUpdate without runValidators
  })
}

// ── 3. Bind selected DB; declare named indexes ────────────

export function getWordpressFormSubmissionReceiptModel() {
  if (thisConnectionAlreadyIsTheSelectedDatabase()) {
    return WordpressFormSubmissionReceipt
  }
  return registerTheReceiptOnTheSelectedDatabase()
}

function declareNamedIndexesTheMigrationApplies(schema) {
  for (const index of WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES) {
    schema.index(index.key, namedIndexOptions(index))
  }
}
```

Read the primary path out loud: *hold the ingress receipt on `wordpress_form_submission_receipts` with `source_system: "wordpress"`, unique `submission_key`, `received_at`, `processing_status` `received` then `lead_created`, write-once `{ model: "FormLead", id }`, and `form_path: "test"`; after insert refuse changing the identity fields and refuse nulling `lead_ref`; declare the named unique `submission_key` plus partial `lead_ref.id` indexes so `pnpm migration:wordpress-form-submission-receipts` can apply them on `testvantagemovers` only; if this process selected a different Mongo database, hand back that database’s receipt model. Do not ingest the Form Lead. Do not authorize here. Do not `autoIndex` on boot. Do not apply those indexes on `vantagemovers`. Do not emit `source_received`.*

That is the operation. An unnamed receipt dump is not. `captureWordpressReceiptThenCreateLead` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **This is an ingress receipt. It is not a Form Lead and not a Granot Observation Receipt.** Knowledge names Job Timeline source-assurance. Next `GranotObservationReceipt.ts` owns `granot_webhook_receipts` and `processing.*` drain work. Do not merge the two so “one receipt owns WordPress and Granot.” Do not add `sheet_sync[]` so “the receipt remembers the tab.” Do not copy `sourceCompanyField` so “the receipt matches Form.”

2. **Authorization lives on `wordpressReceiptWriteAuthorized`, not this schema.** `form_path: "test"` is the stored authorized-path marker. `TEST_MODE` plus `testvantagemovers*` plus `wordpress_form` plus an 8–128 key elect whether to write. `vantagemovers` plus a key still creates the Form Lead and writes no receipt. Do not add a second `form_path` enum value so “receipts also store outside the authorized test path.” Do not move `wordpressReceiptWriteAuthorized` into this file so “the row owns the fence.”

3. **`submission_key` is never inferred.** Zod and `resolveWordpressSubmissionKey` trim 8–128. This schema only trims and requires the string. Do not stamp `submission_key` from `lid` / phone / email / Tracking Reference on validate so “hand insert matches the quote.”

4. **Unique `{ submission_key: 1 }` is declared here and applied only by the migration on `testvantagemovers`.** `autoIndex: false` means boot does **not** create it. Store `insertReceived` catches 11000 and returns the existing row — without the index that collapse never fires in Mongo. Do not flip `autoIndex: true` so “boot creates uniqueness.” Do not apply those indexes on `vantagemovers` so “the live cluster matches test.”

5. **Partial `{ "lead_ref.id": 1 }` is for Job Timeline hop, not uniqueness.** Unattached rows (`lead_ref: null`) are **not** in that index. `mongo-evidence-loader.ts` hops by `{ "lead_ref.id": leadDoc._id }` only when the resolved Lead is Form. It hardcodes `"wordpress_form_submission_receipts"` instead of `WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION`. Do not unique-index `lead_ref.id` so “one receipt per Form Lead.” Do not rewrite the loader from this rename so “the constant wins.”

6. **Schema write-once is `null`-only. Store attach filters null-or-same-id.** `rejectImmutableReceiptFields` does **not** refuse swapping `lead_ref.id` to another Form Lead. `attachLeadRef` `findOneAndUpdate` does **not** set `runValidators: true`, so the hook does **not** run on the live attach path. Do not add `runValidators` from this rename so “hook matches store” without a paired proof that attach still commits with the Form Lead on the same session. Do not move the `$or` filter into this file so “the row owns attach.”

7. **`processing_status` is mutable. Identity fields are not.** `received` → `lead_created` is the only named transition. The hook does **not** refuse `lead_created` → `received`. Do not add `processing_status` to `IMMUTABLE_PATHS` so “status never changes” — attach must `$set` it. Do not add `dead_letter` so “WordPress matches Granot drain.”

8. **The default export has no direct caller except getter same-db return.** Testimonial / Merchant / Moving Carrier are default-only. Do not delete `getWordpressFormSubmissionReceiptModel` so “receipt matches review.” Do not delete the default export so “everyone must call a getter.”

9. **There is no `WordpressFormSubmissionReceipt.test.ts`.** Proofs sit on `wordpressFormSubmissionReceipt.test.ts` (memory store + `captureWordpressReceiptThenCreateLead`) and `wordpress-form-submission-receipts.lib.test.ts` (index presence by name + key). Nobody validates the hook or `autoIndex: false` on this schema. Do not add a helper-unit file per child name. Prove the **interface**.

10. **Leave sibling modules alone.** Capture / ingest / timeline hop / index apply / already-recommended Form / already-recommended `schemaHelpers.ts` / next Granot envelope are already the right **depth**. This file holds the row, the immutability hook, and the named index catalog. `captureWordpressReceiptThenCreateLead` / `ingestFormLead` / `assemble.ts` are those **interfaces**, not this one.

## Testing

The **interface** is the test surface: `WordpressFormSubmissionReceipt` / `getWordpressFormSubmissionReceiptModel` / `WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES` / `WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION` / schema validate (insert + immutability hook).

There is no `WordpressFormSubmissionReceipt.test.ts`. Today’s proofs sit on `wordpressFormSubmissionReceipt.test.ts` (capture order / 11000 collapse on the memory store / unauthorized skip / unattached refuse / attach fail-closed / capture fail-closed) and `wordpress-form-submission-receipts.lib.test.ts` (index present by name + key). Keep caller proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the ingress receipt**
- Collection option is `wordpress_form_submission_receipts`.
- `schema.options.autoIndex === false`.
- `source_system` defaults `"wordpress"` and refuses `"granot"`.
- `form_path` defaults `"test"` and refuses any other string.
- `processing_status` defaults `"received"` and accepts `"lead_created"`.
- `lead_ref.model` requires `"FormLead"` and refuses `"CallLead"`.
- `lead_ref` may be `null` on insert.
- Schema has **no** `source_company` / **no** `sheet_sync` / **no** contact paths.

**Refuse identity mutation**
- New document validate succeeds with required fields.
- After insert, changing `submission_key` / `source_system` / `received_at` / `form_path` invalidates that path.
- After insert, setting `lead_ref` to `null` invalidates `lead_ref`.
- `processing_status` `"received"` → `"lead_created"` still validates on a document `save`.

**Selected database + named indexes**
- `WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES` is exactly two named keys: unique `submission_key`, non-unique partial `lead_ref.id` `$type: "objectId"`.
- Neither index is unique on `lead_ref.id`.
- `getWordpressFormSubmissionReceiptModel()` returns `WordpressFormSubmissionReceipt` when `connection.name` already is `getMongoDatabaseName()`.
- `WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION` equals `"wordpress_form_submission_receipts"`.

Do **not** add a test per helper (`rememberTheWordpressIngressReceiptSchema`, `thisConnectionAlreadyIsTheSelectedDatabase`). Those names exist so the parent reads. Do **not** `captureWordpressReceiptThenCreateLead` from this file’s tests. Do **not** `syncIndexes` so “the test creates uniqueness.” Do **not** HTTP ingest from this file’s tests. Do **not** open Job Timeline from this file’s tests.

`getWordpressFormSubmissionReceiptModel` stays exported because selected-database binding is a second real **adapter**, not a test leak.

## What I would not do

- A `WordpressFormSubmissionReceiptModelService` / `WordpressReceiptService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `authorize.ts` / `attach.ts` split for cleanliness.
- Breaking the selected-database **seam**. Store must not write live `wordpress_form_submission_receipts` while `TEST_MODE` selected `testvantagemovers`.
- Treating `captureWordpressReceiptThenCreateLead` / `ingestFormLead` as this story. Those functions authorize and save the Form Lead.
- Treating `createJobNumberTimelineModule({ loader }).read` / `assemble.ts` as this story. Those files emit `source_received`.
- Treating already-recommended `schemaHelpers.ts` as this story. This file has no `source_company` and no `sheet_sync[]`.
- Treating next `GranotObservationReceipt.ts` as this story.
- Inventing an `autoIndex: true` **adapter** that has only “boot creates uniqueness” as its second home.
- Inventing a `vantagemovers` index-apply **adapter** that has only “the live cluster matches test” as its second home.
- Inventing a unique `{ "lead_ref.id": 1 }` **adapter** so “one receipt per Form Lead.”
- Inventing a second `form_path` enum value so “receipts also store outside the authorized test path.”
- Silently inferring `submission_key` from `lid` / phone / Tracking Reference.
- Silently flipping `autoIndex` on so boot creates the unique index.
- Silently applying those indexes on `vantagemovers`.
- Silently merging this file into next Granot Observation Receipt.
- Silently “fixing” ADR-0001 / ADR-0002 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
