# Remember The Durable Outbound Confirmation SMS On The Selected Mongo Database — Public-Form Still Stores form_lead, Additive lead_ref Points At Form Or Call, Unique String Twilio SID, Unique Observation-Plus-Purpose For Granot, Default CamelCase Timestamps Plus Drain And Lease Clocks, Selected-Database Getter, And Save-Through-The-Getter — Never Remember Intent Here, Never Claim Or Send, Never Accept Twilio's Word, Never Merge This Into The Rate-Limit Bucket — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 48 of this service — `LeadMessage.ts`
- Remaining in this service: `LeadMessageRateLimit.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/LeadMessage.ts`
- Knowledge: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md) (System of Record is Mongo `lead_messages`; Twilio is the provider, not the authority; persist then dispatch-or-queue after the caller’s transaction commits; two purposes: public-form quote confirmation and Granot create-if-missing confirmation; voice forwarding is **not** a Lead Message — **this file never persists intent, never claims, never talks to Twilio, never accepts a callback**). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) (`LeadMessage` (`lead_messages`) is the durable outbound SMS record; public-form confirmations still store `form_lead`; additive `lead_ref` `{ model: "FormLead" | "CallLead", id }` is the polymorphic Lead pointer; Phase-1 backfill `pnpm migration:lead-message-lead-ref` copies `form_lead` onto `lead_ref` with `origin: public_form` and does **not** relax `form_lead`). Already-recommended remember / send / drain / callback / owner retry: [lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md) (`persistLeadMessageIntent` **asks** `createLeadMessage` after consent / capacity / skip; `dispatchPersistedLeadMessage` / `runLeadMessagingDrain` / `applyTwilioStatusCallback` / `listLeadMessages` / `getLeadMessage` / `requestLeadMessageRetry` **ask** `getLeadMessageModel` — **this file never decides consent, never reserves hourly capacity, never claims a 60s lease**). Already-recommended Granot six gates: [lead-messaging-granot-created-lead.md](lead-messaging-granot-created-lead.md) (`already_sent` is Mongo `11000` on `{ observation_id, purpose }` — **this file never walks the six gates**). Already-recommended Form Lead Ingestion: [form-lead.md](form-lead.md) (`persistLeadMessageIntent` inside the write; `dispatchOrQueuePersistedLeadMessage` after commit — **this file never forces the transaction**). Already-recommended SMS cohort: [analytics-sms-conversion.md](analytics-sms-conversion.md) (`getLeadMessageModel()` always opens live `lead_messages`; join is `$ifNull: ["$lead_ref.id", "$form_lead"]`; successful text is `SUCCESSFUL_LEAD_MESSAGE_STATUSES` in `config/domain/leadMessaging.ts` — **not this enum, not this file**). Already-recommended Admin Form browse: [admin-browse.md](admin-browse.md) (**asks** the getter by `form_lead` — **not** `lead_ref`). Already-recommended CRM Source recent texts: [operations-registry-crm-source-outbound-sms.md](operations-registry-crm-source-outbound-sms.md) (**asks** the getter `{ granot_crm_source }` — **this file never enables outbound SMS**). Already-recommended Job Timeline hop: [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (raw `db.collection("lead_messages")` — Form Lead `{ lead_ref.id OR form_lead }`; Call Lead `{ lead_ref.id }` only — **this file never hops**). Already-recommended historical apply / verify: [historical-consolidation-apply.md](historical-consolidation-apply.md) / [historical-consolidation-verify.md](historical-consolidation-verify.md) (`lead_messages` is a `SIDE_EFFECT_COLLECTIONS` member that must **not** grow during apply — **this file never journals**). Already-recommended HTTP desks: [routes-v1.md](routes-v1.md) Owner `GET/POST /api/v1/admin/lead-messages*`; [routes-twilio-message-status.md](routes-twilio-message-status.md); [routes-lead-messaging-cron.md](routes-lead-messaging-cron.md) — **never import this file**. Distinct from leftover next hourly / destination bucket: leftover next `LeadMessageRateLimit.ts` (collection `lead_message_rate_limits` — **do not merge**). Distinct from leftover later conversation recording: leftover later `LeadConversation.ts` — **do not merge**. Distinct from already-recommended Form / Call rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md) — **pointers, not this collection**. Distinct from already-recommended inbound-number interval: [models-ringcentral-inbound-route-assignment.md](models-ringcentral-inbound-route-assignment.md) — **do not merge**. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md) / [System of Record](../../../../CONTEXT.md); it does **not** define Lead Message — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model vs save-through-the-getter.** Already-recommended `leadMessaging.service.ts` is the **only** remember / claim / drain / callback / owner-retry writer. Persist **asks** `createLeadMessage` (injectable) after it has already decided skip / pending / queued. Claim / accept / fail / drain / callback / list / detail / retry **ask** `getLeadMessageModel()` after `connectMongo()`. Already-recommended `granotCreatedLead.ts` **asks** persist (not this file) and treats `11000` as `already_sent`. Already-recommended `formLead.service.ts` **asks** persist / send-or-wake — **not this file**. Already-recommended `adminBrowse.service.ts` **asks** the getter `{ form_lead }` plus `twilio_message_sid` `$type: "string"`. Already-recommended `smsConversion.service.ts` **asks** the getter `$match` successful statuses then `$ifNull` `lead_ref.id` / `form_lead`. Already-recommended `crmSourceOutboundSms.ts` `listRecentGranotCrmSourceSms` **asks** the getter `{ granot_crm_source }`. `scripts/migrations/lead-message-lead-ref.ts` copies `form_lead` onto `lead_ref` — **does not import this file**. Already-recommended Job Timeline hops `db.collection("lead_messages")` — **does not import this file**. Historical apply counts the collection string — **does not import this file**. Tests: `LeadMessage.test.ts` asks default `new LeadMessage` validate plus default `.schema.indexes()` for the unique SID partial — **never asks `createLeadMessage` / the getter / `lead_ref`**. `leadMessaging.service.test.ts` types `LeadMessageDocument` and injects persist. `smsConversion.service.test.ts` / `admin.service.test.ts` stub the getter. There is **no** runtime import of default `LeadMessage` except the getter returning it when `mongoose.connection.name === getMongoDatabaseName()`. Not this **interface**: `persistLeadMessageIntent` itself, `dispatchPersistedLeadMessage` itself, `applyTwilioStatusCallback` itself, `runLeadMessagingDrain` itself, `sendGranotCreatedLeadConfirmation` itself, `getSmsSuccessfullySentThenBooked` itself, Job Timeline hop itself.
- Seams callers need: default `LeadMessage` (first-registered connection — the getter returns it when `mongoose.connection.name === getMongoDatabaseName()`; the model test constructs and reads `.schema.indexes()` on the default) vs `getLeadMessageModel()` (selected `getMongoDatabaseName()` — persist save, claim, drain, callback, Owner list / detail / retry, Form browse, SMS cohort, CRM Source recent texts) vs `createLeadMessage` (`new` + `save({ session })` through that getter; persist injects it; claim / callback do **not** call it); `form_lead` (public form plus Granot Form Lead only) vs additive `lead_ref` (`FormLead` | `CallLead`); unique partial `{ twilio_message_sid: 1 }` where `$type: "string"` vs `null` SID (unsent / skipped / owner retry filter); unique partial `{ observation_id: 1, purpose: 1 }` where `observation_id` is ObjectId vs Granot `already_sent`; Admin Form browse / Owner list filter `form_lead` vs Analytics / Job Timeline join `lead_ref`; `timestamps: true` camelCase `createdAt` / `updatedAt` vs leftover next rate-limit bucket (also camelCase); default `__v`; omitted `autoIndex: false` (boot creates these clocks — there is **no** M5 `createIndexes()` for this collection); `minimize: false`; unused `toJSON` / `toObject` `{ virtuals: true }`. There is no persist-intent Domain Command **seam**. There is no HTTP **seam**. There is no Twilio **seam**. There is no quiet-hours **seam**.
- Split later (only if the file outgrows one sitting): this ~266-line file is one sitting if you read it as remember the durable outbound confirmation SMS on the selected Mongo database — public-form still stores `form_lead`, additive `lead_ref` points at Form or Call, unique string Twilio SID, unique Observation-plus-purpose for Granot, default camelCase timestamps plus drain and lease clocks, selected-database getter, and save-through-the-getter — never remember intent here, never claim or send, never accept Twilio's word, never merge this into the rate-limit bucket. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `persist.ts` / `dispatch.ts` / `callback.ts`. Persist / claim / drain / callback stay already-recommended `leadMessaging.service.ts`. Granot gates stay already-recommended `granotCreatedLead.ts`. Form Lead Ingestion stays already-recommended `formLead.service.ts`. SMS cohort stays already-recommended `smsConversion.service.ts`. Leftover next rate-limit bucket stays leftover next `LeadMessageRateLimit.ts`. Leftover later conversation stays leftover later `LeadConversation.ts`.

`LeadMessage` is a Mongoose model name. The owner question is: *The Lead is already being saved — or Granot create-if-missing already passed its six gates. Hold the confirmation SMS on `lead_messages`. Public form still stamps `form_lead`. Everyone who later joins a Lead uses additive `lead_ref` (Form or Call). Keep the current Twilio SID unique among strings so a callback finds one row. Keep Observation plus purpose unique so Granot cannot text the same minted Lead twice. If this process selected a different Mongo database, hand back that database’s Lead Message model and save the new row there. Do not decide consent. Do not reserve hourly capacity. Do not talk to Twilio. Do not expire a sending lease. Do not invent a selected-database-less default so “this matches the Picker selection.” Do not drop `form_lead` so “one pointer is enough” without a paired browse / list / backfill proof. Do not merge this into the leftover next rate-limit bucket.*

Who remember intent / claim / drain / accept Twilio already lives in already-recommended `leadMessaging.service.ts`. Who walk the six gates already lives in already-recommended `granotCreatedLead.ts`. Who reserve hourly / destination capacity already lives in leftover next `LeadMessageRateLimit.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the durable outbound confirmation SMS on the selected Mongo database — public-form still stores `form_lead`, additive `lead_ref` points at Form or Call, unique string Twilio SID, unique Observation-plus-purpose for Granot, default camelCase timestamps plus drain and lease clocks, selected-database getter, and save-through-the-getter — never remember intent here, never claim or send, never accept Twilio's word, never merge this into the rate-limit bucket” story, not “a Lead Message CRUD dump,” and not Remember The Outbound Confirmation SMS / Claim And Send Through Twilio themselves:

1. **Hold the durable outbound confirmation SMS** — collection `lead_messages`, `timestamps: true` (mongoose camelCase `createdAt` / `updatedAt`), `minimize: false`, `toJSON` / `toObject` `{ virtuals: true }` (**no** virtuals are declared). **No** `autoIndex: false`. **No** `versionKey: false` (default `__v`). **No** hooks. **No** `immutable`. Optional `form_lead` `ObjectId` `ref: "FormLead"` `index: true`. Optional nested `lead_ref` `{ model: "FormLead" | "CallLead", id: ObjectId }` — **no** `_id: false` (mongoose adds a nested `_id`). Required `origin` enum `LEAD_MESSAGE_ORIGINS` default `"public_form"`. Optional `lead_source_company` / `granot_crm_source` / `observation_id` refs. Optional `consent_basis` enum `OUTBOUND_SMS_CONSENT_BASES`. Optional `source_template_version`. Required `provider` default `"twilio"`. Required `channel` default `"sms"`. Required `purpose` enum `LEAD_MESSAGE_PURPOSES`. Required trimmed `message_key` / `template_version` / `to` / `from` / `body`. Required `dispatch_mode` enum `LEAD_MESSAGING_MODES`. Required `status` enum `LEAD_MESSAGE_STATUSES` default `"pending"`. `skip_reason` / `twilio_message_sid` / `provider_status` default `null`. `twilio_message_sids` default `[]`. Nested `attempts` (`_id: false`; outcome `accepted` | `retry_scheduled` | `uncertain` | `failed`) and `status_history` (`_id: false`; `status` is a free string — **not** `LEAD_MESSAGE_PROVIDER_STATUSES`). `attempt_count` default `0`. `next_attempt_at` / `leased_until` / `lease_owner` default `null`. `last_error_*` default `null`. `accepted_at` / `sent_at` / `delivered_at` default `null`. `manual_retry_requested_by` default `null`. `manual_retry_count` required default `0`. `LeadMessageDocument` is the handwritten type (not `InferSchemaType`). This beat does **not** check `sms_consent`. This beat does **not** build template v2. This beat does **not** ask Twilio.

2. **Remember which Lead it belongs to, which unique string Twilio SID it currently holds, which Observation-plus-purpose may send only once, and how drain / lease / callback find it** — `form_lead` is the public-form (and Granot Form Lead) pointer Admin Form browse / Owner list still filter. Additive `lead_ref` is the polymorphic pointer Analytics joins (`$ifNull` `lead_ref.id`, `form_lead`) and Job Timeline hops (Form `$or`; Call `lead_ref.id` only). Unique partial `{ twilio_message_sid: 1 }` where `$type: "string"` is the current SID identity — `null` SIDs do **not** collide; callback finds `$or` current SID / `twilio_message_sids`. Unique partial `{ observation_id: 1, purpose: 1 }` where `observation_id` exists and is ObjectId is Granot `already_sent`. `{ status: 1, next_attempt_at: 1, createdAt: 1 }` plus `{ leased_until: 1 }` are drain / lease clocks. Named `{ "lead_ref.model": 1, "lead_ref.id": 1, createdAt: -1 }` / `{ lead_source_company: 1, createdAt: -1 }` / `{ granot_crm_source: 1, createdAt: -1 }` / `{ purpose: 1, status: 1, createdAt: -1 }` are browse clocks. `{ form_lead: 1, createdAt: -1 }` duplicates the field `index: true`. There is **no** unique `message_key`. There is **no** unique `form_lead`. Phase-1 backfill copies `form_lead` onto `lead_ref` with `origin: public_form` and does **not** unset `form_lead`. This beat does **not** unique `to`. This beat does **not** enum `provider_status`.

3. **Stamp the clocks, hand back the selected-database model, and save a new row through that getter** — field `index: true` on `form_lead`. Compound clocks as above plus `{ twilio_message_sids: 1 }`. There is **no** `LEAD_MESSAGE_INDEXES` catalog. There is **no** collection-name export. Default export `LeadMessage` is `mongoose.models.LeadMessage ?? mongoose.model(...)`. `getLeadMessageModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. `createLeadMessage` asks the getter, `new Model(input)`, `save({ session })`. Its input omits `_id` / `attempts` / `status_history` / `attempt_count` / lease / error / accepted / sent / delivered / manual retry / timestamps / `twilio_message_sid` / `provider_status` / `twilio_message_sids` so schema defaults apply (empty attempts, `null` SID). Persist asks that helper. Claim / callback do **not**. The model test asks the default `.schema.indexes()` for the unique SID partial. This beat does **not** `syncIndexes` on boot. This beat does **not** delete the default export so “everyone must call the getter.”

There is no remember-intent operation. `persistLeadMessageIntent` elects skip / pending / queued then asks this save. There is no claim operation. `dispatchPersistedLeadMessage` `$set`s `sending` plus a 60s lease through the getter. There is no accept-Twilio operation. `applyTwilioStatusCallback` finds by SID through the getter.

## Organization

Keep one file. This is the screenplay for “remember the durable outbound confirmation SMS on the selected Mongo database — public-form still stores `form_lead`, additive `lead_ref` points at Form or Call, unique string Twilio SID, unique Observation-plus-purpose for Granot, default camelCase timestamps plus drain and lease clocks, selected-database getter, and save-through-the-getter — never remember intent here, never claim or send, never accept Twilio's word, never merge this into the rate-limit bucket.” Persist / claim / drain / callback / Granot gates / Form Lead Ingestion / SMS cohort / Job Timeline hop already live in deeper **modules**. Leftover next rate-limit bucket already lives in a sibling **module**. Do not pull those in. Do not invent a `LeadMessageService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent an `autoIndex: false` **adapter** so “this matches Form Lead” without a paired proof that boot no longer creates the unique SID clock. Do not invent a `form_lead`-required **adapter** so “every text is a Form Lead.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `persist.ts` / `dispatch.ts` each get a file.

Do not move `persistLeadMessageIntent` into this file so “the row owns consent.” Do not move `dispatchPersistedLeadMessage` into this file so “the row owns Twilio.” Do not move `applyTwilioStatusCallback` into this file so “the schema owns never-backward.” Do not merge this file into leftover next `LeadMessageRateLimit.ts` so “one schema owns the text and the hourly bucket.” Do not merge this file into leftover later `LeadConversation.ts` so “one schema owns outbound SMS and the conversation recording.” Do not merge this file into already-recommended `FormLead.ts` / `CallLead.ts` so “the Lead is the text.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `LeadMessage` | `outboundConfirmationSmsOnTheDefaultConnection` | the getter returns this default model when `mongoose.connection.name` already is `getMongoDatabaseName()`; the model test constructs and reads `.schema.indexes()` here |
| `getLeadMessageModel` | `outboundConfirmationSmsOnTheSelectedMongoDatabase` | persist save, claim, drain, callback, Owner list / detail / retry, Form browse, SMS cohort, and CRM Source recent texts must follow `getMongoDatabaseName()` |
| `createLeadMessage` | `saveTheOutboundConfirmationSmsOnTheSelectedMongoDatabase` | persist injects this `save({ session })`; claim does **not** call it |
| `LeadMessageDocument` | `OutboundConfirmationSms` | handwritten row + `_id` |
| `LeadMessageLeadRef` | `OutboundConfirmationSmsLeadPointer` | additive `{ model, id }` |
| `LeadMessageAttempt` | `OutboundConfirmationSmsAttempt` | nested claim outcome |
| `LeadMessageStatusEvent` | `OutboundConfirmationSmsProviderWord` | nested callback history |

Keep the old names as one-line aliases until persist, claim, drain, callback, Owner list, Form browse, SMS cohort, CRM Source recent texts, the model test, and inject sites migrate. Do not make callers learn `useDb` / `partialFilterExpression` / `createLeadMessage` as the only domain language until those sites move. Do **not** delete the default `LeadMessage` export so “everyone must call the getter” without a paired proof that the getter still returns the same first-registered model when the connection name matches **and** the model test still constructs and reads the unique SID clock. Do **not** delete the getter so “this matches the Picker selection” without a paired proof that persist / claim / Analytics still write / read the selected database. Do **not** re-export `persistLeadMessageIntent` / `dispatchPersistedLeadMessage` / `applyTwilioStatusCallback` from this file so “the row remembers intent or talks to Twilio.”

**No class for the workflow.** The one type that *does* earn a name is the outbound-confirmation identity contract:

```ts
type OutboundConfirmationSmsIdentity = {
  collection: "lead_messages"
  public_form_still_stores_form_lead: true
  additive_lead_ref: { model: "FormLead" | "CallLead"; id: "ObjectId" }
  phase1_backfill_copies_form_lead_onto_lead_ref: true
  phase1_backfill_relaxes_form_lead: false
  unique_current_sid: {
    twilio_message_sid: 1
    unique: true
    partialFilterExpression: { twilio_message_sid: { $type: "string" } }
  }
  unique_granot_observation_purpose: {
    observation_id: 1
    purpose: 1
    unique: true
    partialFilterExpression: { observation_id: { $exists: true, $type: "objectId" } }
  }
  admin_form_browse_filter: "form_lead"
  owner_list_form_filter: "form_lead"
  analytics_join: { $ifNull: ["$lead_ref.id", "$form_lead"] }
  job_timeline_form_hop: { $or: ["lead_ref.id", "form_lead"] }
  job_timeline_call_hop: "lead_ref.id"
  successful_statuses_live_on_this_schema: false
  provider_status_is_free_string: true
  lead_ref_nested_id_false: false
  timestamps: { createdAt: true, updatedAt: true }
  versionKey: true
  selected_database_getter: true
  save_through_getter: true
  default_export_runtime_import: false
  default_export_model_test_constructs_and_reads_indexes: true
  autoIndex: true
  named_index_catalog: false
  m5_createIndexes: false
}
```

That is the handoff from “this process remembered an outbound confirmation SMS” to “public form still stamps `form_lead`, Analytics can join a Call Lead through `lead_ref`, Granot 11000s a second text for the same Observation plus purpose, a string SID cannot belong to two rows, and boot creates those clocks.” Do **not** add `{ form_lead_required: true }` so “every text is a Form Lead.” Do **not** add `{ unique_current_sid: { twilio_message_sid: 1, unique: true } }` without the `$type: "string"` filter so “null SIDs collide.” Do **not** add `{ selected_database_getter: false }` so “this matches the Picker selection.” Do **not** add `{ autoIndex: false }` so “this matches Form Lead.”

Leave already-recommended `leadMessaging.service.ts` on that file. Leave already-recommended `granotCreatedLead.ts` on that file. Leave leftover next `LeadMessageRateLimit.ts` on that file. Leave leftover later `LeadConversation.ts` on that file. Leave already-recommended `FormLead.ts` / `CallLead.ts` on those files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// LeadMessage.ts
// The Lead is already being saved —
// or Granot create-if-missing already passed its six gates.
// Hold the confirmation SMS on lead_messages.
// Public form still stamps form_lead.
// Everyone who later joins a Lead uses additive lead_ref
// (Form or Call).
// Keep the current Twilio SID unique among strings
// so a callback finds one row.
// Keep Observation plus purpose unique
// so Granot cannot text the same minted Lead twice.
// If this process selected a different Mongo database,
// hand back that database's Lead Message model
// and save the new row there.
// Do not decide consent.
// Do not reserve hourly capacity.
// Do not talk to Twilio.
// Do not expire a sending lease.

// ── 1. Hold the durable outbound confirmation SMS ─────────

const LeadMessageSchema = new Schema(
  {
    form_lead: {
      type: Schema.Types.ObjectId,
      ref: "FormLead",
      required: false,
      index: true,
    },
    lead_ref: {
      model: { type: String, enum: ["FormLead", "CallLead"] },
      id: { type: Schema.Types.ObjectId },
    },
    origin: {
      type: String,
      enum: LEAD_MESSAGE_ORIGINS,
      required: true,
      default: "public_form",
    },
    observation_id: { type: Schema.Types.ObjectId, ref: "GranotObservation" },
    provider: { type: String, required: true, default: "twilio" },
    channel: { type: String, required: true, default: "sms" },
    purpose: { type: String, enum: LEAD_MESSAGE_PURPOSES, required: true },
    to: { type: String, required: true, trim: true },
    from: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    dispatch_mode: { type: String, enum: LEAD_MESSAGING_MODES, required: true },
    status: {
      type: String,
      enum: LEAD_MESSAGE_STATUSES,
      required: true,
      default: "pending",
    },
    twilio_message_sid: { type: String, default: null },
    twilio_message_sids: { type: [String], default: [] },
    attempts: { type: [attemptSchema], default: [] },
    status_history: { type: [statusEventSchema], default: [] },
    next_attempt_at: { type: Date, default: null },
    leased_until: { type: Date, default: null },
    lease_owner: { type: String, default: null },
    manual_retry_count: { type: Number, required: true, default: 0 },
  },
  {
    collection: "lead_messages",
    timestamps: true,
    minimize: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// ── 2. Remember which Lead, which unique string SID,
// which Observation-plus-purpose, and how drain finds it

function rememberWhichLeadWhichUniqueStringSidWhichObservationPlusPurposeAndHowDrainFindsIt() {
  // form_lead: public form + Granot Form Lead
  // lead_ref: Form or Call — Analytics / Job Timeline join here
  // unique partial { twilio_message_sid: 1 } where $type: "string"
  // unique partial { observation_id: 1, purpose: 1 } where ObjectId
  // drain: { status, next_attempt_at, createdAt } + { leased_until }
  // Phase-1 backfill copies form_lead onto lead_ref
  // and does not unset form_lead
}

// ── 3. Stamp the clocks, hand back the selected-database model,
// and save a new row through that getter

LeadMessageSchema.index({ form_lead: 1, createdAt: -1 })
LeadMessageSchema.index(
  { observation_id: 1, purpose: 1 },
  {
    name: "lead_message_observation_purpose_unique",
    unique: true,
    partialFilterExpression: {
      observation_id: { $exists: true, $type: "objectId" },
    },
  },
)
LeadMessageSchema.index(
  { twilio_message_sid: 1 },
  {
    unique: true,
    partialFilterExpression: { twilio_message_sid: { $type: "string" } },
  },
)
LeadMessageSchema.index({ status: 1, next_attempt_at: 1, createdAt: 1 })
LeadMessageSchema.index({ leased_until: 1 })

export const outboundConfirmationSmsOnTheDefaultConnection =
  mongoose.models.LeadMessage ??
  mongoose.model("LeadMessage", LeadMessageSchema)

export function outboundConfirmationSmsOnTheSelectedMongoDatabase() {
  const dbName = getMongoDatabaseName()
  if (mongoose.connection.name === dbName) {
    return outboundConfirmationSmsOnTheDefaultConnection
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true })
  return db.models.LeadMessage ?? db.model("LeadMessage", LeadMessageSchema)
}

export async function saveTheOutboundConfirmationSmsOnTheSelectedMongoDatabase(
  input,
  session?,
) {
  const Model = outboundConfirmationSmsOnTheSelectedMongoDatabase()
  return new Model(input).save({ session })
}

export {
  outboundConfirmationSmsOnTheDefaultConnection as LeadMessage,
}
export {
  outboundConfirmationSmsOnTheSelectedMongoDatabase as getLeadMessageModel,
}
export {
  saveTheOutboundConfirmationSmsOnTheSelectedMongoDatabase as createLeadMessage,
}
```

Read the primary path out loud: *Someone just asked for a confirmation text — a public-form quote with `sms_consent === true`, or a Granot create-if-missing Lead that already passed the six gates. Remember that as one `lead_messages` row on the selected Mongo database. Public form stamps both `form_lead` and `lead_ref { model: "FormLead" }`. Granot always stamps `lead_ref` and only stamps `form_lead` when the minted Lead is a Form Lead. Persist decides skipped / pending / queued, then asks this save inside the caller’s session. After commit the already-recommended send claims `sending` with a 60s lease and talks to Twilio elsewhere. A string SID cannot belong to two rows. The same Granot Observation plus purpose 11000s a second text. Do not decide consent from here. Do not talk to Twilio from here. Do not merge this into the rate-limit bucket.*

## Precise logic I would tighten while renaming

1. **Admin Form browse and Owner list still filter `form_lead`.** Already-recommended Form browse aggregates `{ form_lead, twilio_message_sid $type: "string" }`. Owner list filters `formLeadId` onto `form_lead`. Granot Call Lead texts have no `form_lead`. Analytics already joins `$ifNull` `lead_ref.id` / `form_lead`. Do not add `lead_ref.id` to browse from this rename so “Form browse matches Analytics” without a paired browse proof.

2. **Job Timeline hops the collection string, not this export.** Form Lead is `{ lead_ref.id OR form_lead }`. Call Lead is `{ lead_ref.id }` only. Do not teach the loader to import this file so “hop matches Form Lead.”

3. **Phase-1 backfill does not relax `form_lead`.** `pnpm migration:lead-message-lead-ref` copies `form_lead` onto `lead_ref` with `origin: public_form`. Do not unset `form_lead` so “one pointer is enough” without a paired backfill plus browse proof.

4. **`lead_ref` nested lacks `_id: false`.** Already-recommended WordPress receipt uses `{ _id: false }`. Mongoose adds a nested `_id` here. Do not flip `_id: false` so “pointer matches receipt” without a paired persist proof.

5. **`provider_status` is a free string.** Domain exports `LEAD_MESSAGE_PROVIDER_STATUSES`. This schema does not enum it. Nested `status_history.status` is also free. Do not enum `provider_status` from this rename so “the row matches the domain list” without a paired callback proof that an unknown incoming status still appends history.

6. **Successful-text statuses live in domain config, not here.** Analytics `$match`es `SUCCESSFUL_LEAD_MESSAGE_STATUSES` (`accepted` | `sent` | `delivered`). Do not add that set onto this schema so “the model owns the cohort.”

7. **`{ form_lead: 1, createdAt: -1 }` duplicates field `index: true`.** Do not drop the field index so “one clock is enough” without a paired browse proof. Do not unique `form_lead` so “one text per Form Lead.”

8. **`createLeadMessage` is a thin `new` + `save`.** Persist injects it after it has already decided skip / pending / queued. Claim / callback use the getter’s `findOneAndUpdate` / `updateOne`. Do not move persist into this helper so “the row owns consent.” Do not teach claim to call `createLeadMessage` so “one write path.”

9. **Default export has no runtime import.** Every runtime ask uses `getLeadMessageModel` or `createLeadMessage` (which asks the getter). The model test constructs the default and reads `.schema.indexes()`. Do not delete the default so “everyone must call the getter” without a paired getter **and** model-test proof. Do not switch the model test to the getter so “this matches persist” without that same proof.

10. **CamelCase timestamps plus `__v`.** Already-recommended Picker selection uses named `created_at` only and `versionKey: false`. Do not rename `createdAt` so “SMS matches Picker.” Do not drop `__v` so “this matches the nonce.”

11. **`toJSON` / `toObject` virtuals are on and unused.** This file declares no virtuals. Do not invent a virtual `lead` populate so “the text owns the Form Lead.”

12. **Boot creates these clocks; there is no M5 `createIndexes()`.** `autoIndex` is the mongoose default. Form Lead uses `autoIndex: false` plus a named migration catalog. Do not set `autoIndex: false` so “this matches Form Lead” without a paired boot plus unique-SID proof. Do not add a `LEAD_MESSAGE_INDEXES` catalog from this rename so “SMS matches the WordPress receipt.”

13. **Historical consolidation treats `lead_messages` as a side-effect that must not grow.** Apply journals a baseline count; verify refuses a delta. Do not teach apply to import this model so “side-effect matches Form Lead.”

14. **Software-map gap.** Job Timeline hops the collection string. HTTP desks never import this file. Owner list omits `body`. Do not invent those lines from this rename.

15. **Leave sibling modules alone.** `persistLeadMessageIntent` / `dispatchPersistedLeadMessage` / `applyTwilioStatusCallback` / `runLeadMessagingDrain` / `sendGranotCreatedLeadConfirmation` / leftover next rate-limit writes are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the selected-database getter, the save-through-the-getter helper, the handwritten-row type, optional `form_lead`, additive `lead_ref`, required `origin` default `"public_form"`, required `purpose` / `to` / `from` / `body` / `dispatch_mode`, `status` default `"pending"`, `provider` `"twilio"`, `channel` `"sms"`, `twilio_message_sid` default `null`, camelCase timestamps, default `__v`, the unique partial `{ twilio_message_sid: 1 }` where `$type: "string"`, the unique partial `{ observation_id: 1, purpose: 1 }` where ObjectId, the drain / lease clocks, omitted `autoIndex: false`, and the omitted `form_lead` required flag. `LeadMessage.test.ts` asks default `new LeadMessage` validate plus default `.schema.indexes()` for that unique SID partial. Persist / claim / callback tests ask the service, not this export.

I would keep that focused model file. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.LeadMessage ?? mongoose.model(...)`
- `getLeadMessageModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()` and registers on `useDb` otherwise
- `createLeadMessage` asks the getter and `save({ session })`
- persist asks `createLeadMessage` after it has already decided skip / pending / queued
- public form persist writes both `form_lead` and `lead_ref { model: "FormLead" }`
- Granot persist always writes `lead_ref` and writes `form_lead` only when the Lead is a Form Lead
- a second string `twilio_message_sid` misses (unique partial)
- `null` SIDs do **not** collide
- a second `{ observation_id, purpose }` misses (Granot `already_sent`)
- Admin Form browse / Owner list filter `form_lead`
- Analytics joins `$ifNull` `lead_ref.id` / `form_lead`
- Job Timeline hops `db.collection("lead_messages")` — Form `{ lead_ref.id OR form_lead }`, Call `{ lead_ref.id }` only — **not this export**
- historical apply / verify treat `lead_messages` as a side-effect that must not grow
- HTTP desks ask already-recommended remember / callback / cron — **not this export**
- Phase-1 backfill copies `form_lead` onto `lead_ref` and does **not** unset `form_lead`
- `schema-and-crud-inputs.mdc` already names `lead_messages`; this pass does not rewrite that paragraph
- leftover next `LeadMessageRateLimit` is a different collection; that file is out of this story
- leftover later `LeadConversation` is a different collection; that file is out of this story
- already-recommended `FormLead` / `CallLead` are different collections; those files are out of this story

I would not test persist consent, claim-and-send, quiet hours, callback never-backward, Granot six gates, SMS cohort math, or Job Timeline assemble from this file.

Do not add a test per helper (`theSidIsUniqueAmongStrings`, `theObservationPurposeIsUnique`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `LeadMessageService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `persist.ts` / `dispatch.ts` / `callback.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (Form Lead Ingestion already owns that seam; persist is inside the write, send-or-wake is after commit).
- Treating `persistLeadMessageIntent` / `dispatchPersistedLeadMessage` / `applyTwilioStatusCallback` / `runLeadMessagingDrain` / `sendGranotCreatedLeadConfirmation` / leftover next rate-limit / leftover later conversation as this story.
- Inventing a selected-database-less seam that has only the Picker default as an adapter.
- Inventing a `form_lead`-required seam that has only public form as an adapter.
- Silently dropping `form_lead`, uniquing `form_lead`, uniquing `twilio_message_sid` without the `$type: "string"` filter, enuming `provider_status`, flipping `lead_ref` `_id: false`, deleting the getter, deleting the default export, flipping `autoIndex: false`, adding a named-index catalog, renaming `createdAt`, dropping `__v`, rewriting Core Collections, or teaching Job Timeline to import this file while recommending a rename.
- Pulling `persistLeadMessageIntent`, `dispatchPersistedLeadMessage`, or `applyTwilioStatusCallback` into this file.
- Merging this collection into leftover next `LeadMessageRateLimit`, leftover later `LeadConversation`, already-recommended `FormLead`, already-recommended `CallLead`, or already-recommended inbound-number interval.
- Silently reordering persist-inside-transaction versus send-or-wake-after-commit, or claim versus Twilio create versus persist-accept.
- Changing owner retry to delete-the-row so “we match the consent hash.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or leftover next `LeadMessageRateLimit.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `LeadMessageRateLimit.ts` while writing this file.
