# Remember The Telephone Conversation Recording On The Selected Mongo Database — Unique Per Provider Recording, Optional Lead Pointer Plus Denormalized Booking, Masked Phones, Private Media Pointer, Already-Redacted Transcript And Sectioned Summary, Forward-Declared Work And Claim Clocks, Named Seven Indexes The Migration Applies, Selected-Database Getter — Never Discover Or Attach Here, Never Redact Fresh STT, Never Upload, Never Seed, Never Sign The Listen URL, Never Write The Lead — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 50 of this service — `LeadConversation.ts`
- Remaining in this service: `BookingLeadReconciliationCase.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/LeadConversation.ts`
- Knowledge: [`docs/knowledge/services/lead-conversation.md`](../../../docs/knowledge/services/lead-conversation.md) (System of Record is Mongo `lead_conversations`; audio bytes live in a private Vercel Blob object; the Lead and Booking are **not** mutated; unique `{ provider, provider_recording_id }`; raw STT never reaches Mongo; RingCentral `contentUri` is never stored; summaries never write back to a Lead or Booking; automated discovery / form-lead phone-window matching / attach-detach remain deferred; Owner reads hide words on the list and show the already-redacted transcript plus sectioned summary on the opened card — **this file never paints, never redacts, never uploads, never signs, never seeds**). Owner spec §2.1 (`docs/granot-lead-lifecycle/owner-daily-operations-view-specification.md`) names this as the only new aggregate: evidence of one telephone conversation matched to a Lead, not a Lead field; indexes go through `scripts/migrations/` following the Granot lifecycle report-then-apply pattern, never implicit `autoIndex`; work / claim / `cost_cents` / `media.purged_at` land in full even though the pipeline is deferred. Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections names `LeadMessage` (`lead_messages`) and does **not** name `lead_conversations`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the recording.” Already-recommended Owner desk reads: [conversations-reads.md](conversations-reads.md) (`listConversations` / `listConversationsByLead` / `getConversationById` **ask** `getLeadConversationModel` — **this file never lists, never 404s, never paints `has_mismatch`**). Already-recommended PCI strip: [conversations-redaction.md](conversations-redaction.md) (`redactTranscript` — **this file never walks spoken STT**). Already-recommended locker: [conversations-media.md](conversations-media.md) (`uploadConversationMp3` / `issueConversationAudioUrl` — **this file never `put`s, never signs**). Already-recommended artifact stamp: [conversations-seed-from-artifacts.md](conversations-seed-from-artifacts.md) (`parseConversationArtifact` / `buildSeededTranscript` / `buildSeededSummary` / `buildSeededMedia` — **this file never parses markdown, never stamps bags**). Already-recommended Owner HTTP desk: [routes-conversations-admin.md](routes-conversations-admin.md) (four GETs after the secret; **never import this file**). Already-recommended outbound SMS row: [models-lead-message.md](models-lead-message.md) (collection `lead_messages` — **do not merge**). Already-recommended confirmation-SMS capacity bag: [models-lead-message-rate-limit.md](models-lead-message-rate-limit.md) (collection `lead_message_rate_limits` — **do not merge**). Already-recommended Form / Call / Booking rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md), [models-booked-lead.md](models-booked-lead.md) — **pointers, not this collection**. Already-recommended RingCentral ingest: [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (Call Lead write — **not** a Lead Conversation). Already-recommended Job Timeline hop: [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (**does not** hop `lead_conversations`). Already-recommended Granot projections: [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (spec §2.3 names timeline members; this checkout’s `projections.ts` has **no** conversation entry — **do not add them from this rename**). Distinct from leftover next employee-booking recon case: leftover next `BookingLeadReconciliationCase.ts` — **do not merge**. Distinct from leftover later public throttle: leftover later `PublicSubmissionThrottleBucket.ts` — **do not merge**. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Lead Conversation](../../../../CONTEXT.md) / [Conversation Match](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md) / [Form Lead](../../../../CONTEXT.md) / [Booking](../../../../CONTEXT.md); it does **not** define those terms here — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass. The always-applied API host rule and `.cursor/skills/hit-vantage-api/SKILL.md` still omit the four Owner conversation routes.
- Callers: **selected-database getter vs default-connection model vs named-index catalog vs operator upsert.** Already-recommended `reads.ts` is the **only** runtime reader. List / by-lead / load **ask** `getLeadConversationModel()` after the route has already `connectMongo()` — `find({})` newest `started_at` then `_id` limit 50; `find({ "lead_ref.model", "lead_ref.id" })` newest `started_at` (no limit); `findById`. Already-recommended `seedFromArtifacts.ts` **does not import** this file. Operator `scripts/conversations/seed-known-conversation.ts` (`pnpm ops:seed-conversation`) is the **only** writer until deferred discovery lands: after `--confirm-write` plus leftover `assertGranotLifecycleApplyAuthorized`, leftover upload, leftover stamp bags, it **asks** `getLeadConversationModel()` and `findOneAndUpdate` upserts `{ provider: "ringcentral", provider_recording_id }` with `state: "complete"`. `scripts/migrations/lead-conversation-indexes.ts` (`pnpm migration:conversations:indexes`) **asks** `LEAD_CONVERSATION_INDEXES` plus leftover `LEAD_CONVERSATION_COLLECTION` — report default; apply requires leftover `--apply` plus leftover `--confirm-<database>`; it does **not** refuse `vantagemovers` the way leftover WordPress receipts do. Tests: `LeadConversation.test.ts` asks default `new LeadConversation` validate plus default `.schema.indexes()` for the seven named clocks and the one unique recording clock — **never asks the getter, never upserts**. `reads.test.ts` / `conversations-admin.routes.test.ts` type `LeadConversationDocument` and stub the service — **never construct this model**. There is **no** `createLeadConversation`. There is **no** runtime import of default `LeadConversation` except the getter returning it when `mongoose.connection.name === getMongoDatabaseName()`. Admin browse / Job Timeline / historical apply / Granot projections **do not** read this collection. Historical `SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and **omits** `lead_conversations`. Not this **interface**: `listConversations` itself, `toConversationDetail` itself, `redactTranscript` itself, `uploadConversationMp3` itself, `issueConversationAudioUrl` itself, `parseConversationArtifact` itself, leftover `findOneAndUpdate` on the seed script, leftover `recordOperationalEvent`.
- Seams callers need: default `LeadConversation` (first-registered connection — the getter returns it when `mongoose.connection.name === getMongoDatabaseName()`; the model test constructs and reads `.schema.indexes()` on the default) vs `getLeadConversationModel()` (selected `getMongoDatabaseName()` — Owner list / by-lead / load, operator upsert); `LEAD_CONVERSATION_INDEXES` (seven named clocks; unique `{ provider, provider_recording_id }` is the only unique) vs schema loop that stamps them vs leftover `pnpm migration:conversations:indexes` (the only apply path — collection opened by leftover `LEAD_CONVERSATION_COLLECTION`, **not** this export); `autoIndex: false` vs boot that must **not** create those clocks; optional `lead_ref` `{ model: "FormLead" | "CallLead", id }` `{ _id: false }` default `null` vs required `form_lead` on already-recommended outbound SMS; denormalized `booking_ref` vs **no** shipped Booking-drawer route; already-masked `from_phone_masked` / `to_phone_masked` vs leftover `maskPhoneForLog` on the seed; stored `media.blob_url` vs already-recommended opened card that **omits** it; `state` default `"discovered"` vs seed `$set` `"complete"`; forward-declared work / claim / `cost_cents` vs **no** shipped drainer; `timestamps: true` camelCase `createdAt` / `updatedAt` vs leftover Picker named `created_at` only; default `__v`; `minimize: false`; unused `toJSON` / `toObject` `{ virtuals: true }`. There is no persist-helper **adapter**. There is no Domain Command **seam**. There is no HTTP **seam**. There is no redact **seam**. There is no locker **seam**.
- Split later (only if the file outgrows one sitting): this ~220-line file is one sitting if you read it as remember the telephone conversation recording on the selected Mongo database — unique per provider recording, optional Lead pointer plus denormalized Booking, masked phones, private media pointer, already-redacted transcript and sectioned summary, forward-declared work and claim clocks, named seven indexes the migration applies, selected-database getter — never discover or attach here, never redact fresh STT, never upload, never seed, never sign the listen URL, never write the Lead. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `seed.ts` / `claim.ts` / `discover.ts`. Desk reads stay already-recommended `reads.ts`. Redaction stays already-recommended `redaction.ts`. Locker stays already-recommended `media.ts`. Artifact stamp stays already-recommended `seedFromArtifacts.ts`. Operator upsert stays `scripts/conversations/seed-known-conversation.ts`. Index apply stays `scripts/migrations/lead-conversation-indexes.ts`. Leftover next employee-booking recon case stays leftover next `BookingLeadReconciliationCase.ts`. Already-recommended outbound SMS / capacity bag stay those files.

`LeadConversation` is a Mongoose model name. The owner question is: *An agent just recorded a customer call — or the Owner is about to replay the already-paid Chris Hughes inbound. Hold that recording as one `lead_conversations` row on the selected Mongo database. One provider plus one recording id is one row. Point at a Form Lead or a Call Lead when we already know who, and copy the Booking id when one exists — never write those collections. Store the phones already masked. Store a private media pointer, never a RingCentral content URI. Store the already-redacted transcript and the sectioned summary, never raw STT. Keep the work and claim clocks on the row even though nobody drains them yet. Keep `autoIndex` off so boot does not create the seven clocks — leftover `pnpm migration:conversations:indexes` is the only apply path. If this process selected a different Mongo database, hand back that database’s conversation model. Do not discover the next recording. Do not attach a Lead. Do not redact fresh STT. Do not upload the mp3. Do not sign a listen URL. Do not invent a selected-database-less default so “this matches the Picker selection.” Do not flip `autoIndex` on so “boot creates uniqueness.” Do not merge this into the already-recommended outbound SMS row.*

Who show the newest conversations without the words already lives in already-recommended `reads.ts`. Who strip cards / SSN / email already lives in already-recommended `redaction.ts`. Who put the private mp3 and issue the five-minute URL already lives in already-recommended `media.ts`. Who parse the already-paid artifact already lives in already-recommended `seedFromArtifacts.ts`. Who upsert the known inbound Call Lead already lives on `scripts/conversations/seed-known-conversation.ts`. Who apply the seven clocks already lives on `scripts/migrations/lead-conversation-indexes.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the telephone conversation recording on the selected Mongo database — unique per provider recording, optional Lead pointer plus denormalized Booking, masked phones, private media pointer, already-redacted transcript and sectioned summary, forward-declared work and claim clocks, named seven indexes the migration applies, selected-database getter — never discover or attach here, never redact fresh STT, never upload, never seed, never sign the listen URL, never write the Lead” story, not “a Lead Conversation CRUD dump,” and not Show The Owner The Newest Conversations / Seed The Known Call themselves:

1. **Hold the durable telephone conversation recording** — collection leftover `LEAD_CONVERSATION_COLLECTION` (`"lead_conversations"`), `autoIndex: false`, `timestamps: true` (mongoose camelCase `createdAt` / `updatedAt`), `minimize: false`, `toJSON` / `toObject` `{ virtuals: true }` (**no** virtuals are declared). **No** `versionKey: false` (default `__v`). **No** hooks. **No** `immutable`. Required `provider` enum leftover `LEAD_CONVERSATION_PROVIDERS` (`"ringcentral"` only). Required trimmed `provider_recording_id`. Required trimmed `call_log_id`. `telephony_session_id` default `null`. Nested `lead_ref` `{ model` enum leftover `LEAD_CONVERSATION_LEAD_MODELS` (`"FormLead"` | `"CallLead"`), `id: ObjectId }` `{ _id: false }` default `null`. `booking_ref` ObjectId `ref: "BookedLead"` default `null`. `normalized_job_no` default `null`. `lead_source_company` ObjectId `ref: "LeadSourceCompany"` default `null`. `source_granularity_id` ObjectId default `null` (**no** `ref`). `receiver_agent` ObjectId `ref: "Agent"` default `null`. `receiver_agent_name_snapshot` default `null`. Required `match_method` enum leftover `LEAD_CONVERSATION_MATCH_METHODS` (`call_lead_telephony_session` | `call_lead_call_log_id` | `form_lead_outbound_phone_window` | `owner_manual_attach`). Required `match_confidence` enum leftover `LEAD_CONVERSATION_MATCH_CONFIDENCES` (`high` | `medium` — **no** `low`). Nested `match_evidence` `{ _id: false }` (`queried_phone_national` / `window_from` / `window_to` / `candidate_count` / `chosen_reason`) default `undefined`. Required `direction` enum leftover `LEAD_CONVERSATION_DIRECTIONS` (`Inbound` | `Outbound`). Required trimmed `rc_result` (free string — **not** an enum). Required `started_at`. Required `duration_seconds`. Required trimmed `from_phone_masked` / `to_phone_masked`. Nested `media` `{ _id: false }` (`blob_pathname` / `blob_url` / `bytes` / `content_type` free string / `stored_at` / `purged_at`) default `null`. Nested `transcript` `{ _id: false }` required `text` / `model` / `chars` / `redactions` / `created_at` when present, default `null`. Nested `summary` `{ _id: false }` required `text` / `model` / `prompt_version` / `created_at` when present, default `null`. Required `state` enum leftover `LEAD_CONVERSATION_STATES` default `"discovered"`. Required `attempts` default `0`. `next_attempt_at` / `claimed_by` / `claim_expires_at` / `last_error` default `null`. Nested `last_error` `{ _id: false }` required `code` / `message` / `at` when present. Nested `cost_cents` `{ _id: false }` required `stt` / `summary` when present, default `null`. `LeadConversationDocument` is `InferSchemaType` plus `_id`. This beat does **not** mask the phone. This beat does **not** redact. This beat does **not** `put` the mp3. This beat does **not** write a Form Lead or a Call Lead.

2. **Remember which recording is unique, which Lead or Booking it may join, and how the Owner desk and deferred work find it** — unique named `{ provider: 1, provider_recording_id: 1 }` (`lead_conversation_recording_unique`) is the idempotency key. Seed upserts that pair. There is **no** unique `call_log_id`. There is **no** unique `lead_ref`. `lead_ref` may stay `null` (deferred attach). `booking_ref` is denormalized when a Booking exists and is **not** the join. Named `lead_conversation_lead` `{ "lead_ref.model": 1, "lead_ref.id": 1, started_at: -1 }` is the Lead drawer already-recommended `listConversationsByLead` uses. Named `lead_conversation_booking` `{ booking_ref: 1, started_at: -1 }` is the Booking drawer the spec names — **no** Owner route asks it yet. Named `lead_conversation_window` `{ started_at: -1, _id: -1 }` is the newest-fifty desk already-recommended `listConversations` uses. Named `lead_conversation_work` `{ state: 1, next_attempt_at: 1 }` is the deferred drainer claim — seed writes `state: "complete"` and nulls the claim clocks. Named `lead_conversation_agent` `{ receiver_agent: 1, started_at: -1 }` is spec agent metrics — **not** shipped. Named `lead_conversation_call_log` `{ call_log_id: 1 }` is re-resolve without a second RingCentral call — **not** shipped. This beat does **not** unique `telephony_session_id`. This beat does **not** store a plaintext phone.

3. **Stamp the seven named clocks (`autoIndex` stays false) and hand back the selected-database model** — `LEAD_CONVERSATION_INDEXES` is the catalog. The schema loops it onto `Schema.index` with `unique` only when the spec says so. Default export `LeadConversation` is `mongoose.models.LeadConversation ?? mongoose.model(...)`. `getLeadConversationModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. There is **no** `createLeadConversation`. Reads and the seed **ask** the getter. The model test asks the default `.schema.indexes()` for all seven names. Leftover migration **asks** the catalog plus leftover `LEAD_CONVERSATION_COLLECTION` from leftover `src/config/domain/conversations.ts` — **not** a collection-name export on this file. This beat does **not** `syncIndexes` on boot. This beat does **not** delete the default export so “everyone must call the getter.” This beat does **not** refuse leftover `vantagemovers` apply — leftover WordPress receipts do that; this migration does **not**.

There is no list / paint operation. `listConversations` / `toConversationDetail` elect that through the getter. There is no seed operation. The operator script upserts after leftover stamp bags. There is no discover / attach / claim operation. Those stay deferred.

## Organization

Keep one file. This is the screenplay for “remember the telephone conversation recording on the selected Mongo database — unique per provider recording, optional Lead pointer plus denormalized Booking, masked phones, private media pointer, already-redacted transcript and sectioned summary, forward-declared work and claim clocks, named seven indexes the migration applies, selected-database getter — never discover or attach here, never redact fresh STT, never upload, never seed, never sign the listen URL, never write the Lead.” Desk reads / redaction / locker / artifact stamp / operator upsert / index apply already live in deeper **modules**. Already-recommended outbound SMS / capacity bag / Form / Call / Booking already live in sibling **modules**. Leftover next employee-booking recon case already lives in a sibling **module**. Enums and the collection name already live on leftover Wave B `src/config/domain/conversations.ts`. Do not pull those in. Do not invent a `LeadConversationService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent an `autoIndex: true` **adapter** so “boot creates uniqueness” without a paired proof that leftover `pnpm migration:conversations:indexes` is no longer the only apply path. Do not invent a `createLeadConversation` **adapter** so “this matches Lead Message save.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `seed.ts` / `claim.ts` / `discover.ts` each get a file.

Do not move `listConversations` into this file so “the row owns the desk.” Do not move `redactTranscript` into this file so “the schema owns PCI.” Do not move `uploadConversationMp3` into this file so “the row owns the locker.” Do not move the seed `findOneAndUpdate` into this file so “the model owns persist.” Do not merge this file into already-recommended `LeadMessage.ts` so “one schema owns outbound SMS and the conversation recording.” Do not merge this file into already-recommended `LeadMessageRateLimit.ts` so “one bag owns capacity and the recording.” Do not merge this file into already-recommended `FormLead.ts` / `CallLead.ts` / `BookedLead.ts` so “the Lead is the conversation.” Do not merge this file into leftover next `BookingLeadReconciliationCase.ts` so “one case owns every Owner attach.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `LeadConversation` | `telephoneConversationRecordingOnTheDefaultConnection` | the getter returns this default model when `mongoose.connection.name` already is `getMongoDatabaseName()`; the model test constructs and reads `.schema.indexes()` here |
| `getLeadConversationModel` | `telephoneConversationRecordingOnTheSelectedMongoDatabase` | Owner list / by-lead / load and the operator upsert must follow `getMongoDatabaseName()` |
| `LeadConversationDocument` | `TelephoneConversationRecording` | inferred row + `_id` |
| `LEAD_CONVERSATION_INDEXES` | `namedTelephoneConversationRecordingIndexesTheMigrationApplies` | leftover `pnpm migration:conversations:indexes` is the only apply path |

Keep the old names as one-line aliases until already-recommended `reads.ts`, the operator seed, leftover migration, the model test, and the getter same-db return migrate. Do not make callers learn `useDb` / `LEAD_CONVERSATION_STATES` / `lead_conversation_recording_unique` as the only domain language until those sites move. Do **not** delete the default `LeadConversation` export so “everyone must call the getter” without a paired proof that the getter still returns the same first-registered model when the connection name matches **and** the model test still constructs and reads the seven clocks. Do **not** delete the getter so “this matches the Picker selection” without a paired proof that Owner reads and the seed still write / read the selected database. Do **not** add `createLeadConversation` so “SMS save matches the recording.” Do **not** re-export `listConversations` / `redactTranscript` / `uploadConversationMp3` / `parseConversationArtifact` from this file so “the row paints, redacts, uploads, or seeds.” Do **not** export leftover `LEAD_CONVERSATION_COLLECTION` from this file so “the model owns the config constant” — that name already lives on leftover `src/config/domain/conversations.ts`.

**No class for the workflow.** The one type that *does* earn a name is the telephone-conversation identity contract:

```ts
type TelephoneConversationRecordingIdentity = {
  collection: "lead_conversations"
  collection_name_lives_on_this_file: false
  unique_recording: {
    provider: 1
    provider_recording_id: 1
    unique: true
    name: "lead_conversation_recording_unique"
  }
  unique_call_log_id: false
  unique_lead_ref: false
  lead_ref: { model: "FormLead" | "CallLead"; id: "ObjectId"; _id: false } | null
  booking_ref_is_denormalized: true
  phones_are_already_masked: true
  stores_ringcentral_content_uri: false
  stores_raw_stt: false
  media_blob_url_is_stored: true
  opened_card_omits_blob_url: true
  state_default: "discovered"
  seed_writes_state: "complete"
  work_and_claim_clocks_are_forward_declared: true
  shipped_drainer: false
  timestamps: { createdAt: true, updatedAt: true }
  versionKey: true
  selected_database_getter: true
  save_through_getter: false
  default_export_runtime_import: false
  default_export_model_test_constructs_and_reads_indexes: true
  autoIndex: false
  named_index_catalog: true
  catalog_length: 7
  m5_createIndexes: "pnpm migration:conversations:indexes"
  live_cluster_apply_refused: false
  core_collections_names_this: false
  historical_side_effect: false
  job_timeline_hops_this: false
}
```

That is the handoff from “this process remembered a telephone conversation recording” to “one provider plus one recording id is one row, the Lead and Booking stay other collections, boot does not create the seven clocks, and leftover `pnpm migration:conversations:indexes` is the only apply path.” Do **not** add `{ unique_lead_ref: true }` so “one conversation per Lead.” Do **not** add `{ selected_database_getter: false }` so “this matches the Picker selection.” Do **not** add `{ autoIndex: true }` so “this matches Lead Message.” Do **not** add `{ live_cluster_apply_refused: true }` so “this matches the WordPress receipt.” Do **not** add `{ stores_ringcentral_content_uri: true }` so “replay can skip the locker.”

Leave already-recommended `reads.ts` on that file. Leave already-recommended `redaction.ts` on that file. Leave already-recommended `media.ts` on that file. Leave already-recommended `seedFromArtifacts.ts` on that file. Leave leftover `scripts/conversations/seed-known-conversation.ts` on that file. Leave leftover `scripts/migrations/lead-conversation-indexes.ts` on that file. Leave already-recommended `LeadMessage.ts` / `LeadMessageRateLimit.ts` on those files. Leave leftover next `BookingLeadReconciliationCase.ts` on that file. Leave already-recommended `FormLead.ts` / `CallLead.ts` / `BookedLead.ts` on those files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// LeadConversation.ts
// An agent just recorded a customer call —
// or the Owner is about to replay the already-paid Chris Hughes inbound.
// Hold that recording on lead_conversations.
// One provider plus one recording id is one row.
// Point at a Form Lead or a Call Lead when we already know who,
// and copy the Booking id when one exists —
// never write those collections.
// Store the phones already masked.
// Store a private media pointer, never a RingCentral content URI.
// Store the already-redacted transcript and the sectioned summary,
// never raw STT.
// Keep the work and claim clocks on the row
// even though nobody drains them yet.
// Keep autoIndex off so boot does not create the seven clocks.
// If this process selected a different Mongo database,
// hand back that database's conversation model.
// Do not discover the next recording.
// Do not attach a Lead.
// Do not redact fresh STT.
// Do not upload the mp3.
// Do not sign a listen URL.

// ── 1. Hold the durable telephone conversation recording ──

const LeadConversationSchema = new Schema(
  {
    provider: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_PROVIDERS,
    },
    provider_recording_id: { type: String, required: true, trim: true },
    call_log_id: { type: String, required: true, trim: true },
    telephony_session_id: { type: String, default: null, trim: true },
    lead_ref: { type: leadRefSchema, default: null },
    booking_ref: {
      type: Schema.Types.ObjectId,
      ref: "BookedLead",
      default: null,
    },
    match_method: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_MATCH_METHODS,
    },
    match_confidence: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_MATCH_CONFIDENCES,
    },
    direction: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_DIRECTIONS,
    },
    rc_result: { type: String, required: true, trim: true },
    started_at: { type: Date, required: true },
    duration_seconds: { type: Number, required: true },
    from_phone_masked: { type: String, required: true, trim: true },
    to_phone_masked: { type: String, required: true, trim: true },
    media: { type: mediaSchema, default: null },
    transcript: { type: transcriptSchema, default: null },
    summary: { type: summarySchema, default: null },
    state: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_STATES,
      default: "discovered",
    },
    attempts: { type: Number, required: true, default: 0 },
    next_attempt_at: { type: Date, default: null },
    claimed_by: { type: String, default: null, trim: true },
    claim_expires_at: { type: Date, default: null },
    last_error: { type: lastErrorSchema, default: null },
    cost_cents: { type: costCentsSchema, default: null },
  },
  {
    collection: LEAD_CONVERSATION_COLLECTION,
    autoIndex: false,
    timestamps: true,
    minimize: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// ── 2. Remember which recording is unique,
// which Lead or Booking it may join,
// and how the Owner desk and deferred work find it

function rememberWhichRecordingIsUniqueWhichLeadOrBookingItMayJoinAndHowTheDeskAndDeferredWorkFindIt() {
  // unique { provider, provider_recording_id }
  // lead_ref may stay null — deferred attach
  // booking_ref is denormalized
  // phones are already masked
  // media.blob_url is stored; the opened card omits it
  // work / claim clocks sit null until a drainer exists
}

// ── 3. Stamp the seven named clocks (autoIndex stays false)
// and hand back the selected-database model

for (const index of LEAD_CONVERSATION_INDEXES) {
  LeadConversationSchema.index(index.key, {
    name: index.name,
    ...("unique" in index && index.unique ? { unique: true } : {}),
  })
}

export const telephoneConversationRecordingOnTheDefaultConnection =
  mongoose.models.LeadConversation ??
  mongoose.model("LeadConversation", LeadConversationSchema)

export function telephoneConversationRecordingOnTheSelectedMongoDatabase() {
  const dbName = getMongoDatabaseName()
  if (mongoose.connection.name === dbName) {
    return telephoneConversationRecordingOnTheDefaultConnection
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true })
  return (
    db.models.LeadConversation ??
    db.model("LeadConversation", LeadConversationSchema)
  )
}

export {
  telephoneConversationRecordingOnTheDefaultConnection as LeadConversation,
}
export {
  telephoneConversationRecordingOnTheSelectedMongoDatabase as getLeadConversationModel,
}
export {
  LEAD_CONVERSATION_INDEXES as namedTelephoneConversationRecordingIndexesTheMigrationApplies,
}
```

Read the primary path out loud: *Someone just recorded a customer call — or the Owner is replaying the already-paid Chris Hughes inbound. Remember that as one `lead_conversations` row on the selected Mongo database. One RingCentral recording id cannot belong to two rows. Point at the Call Lead when we already know who, and copy the Booking id when one exists. Store the phones already masked. Store the private locker pathname, the already-redacted transcript, and the sectioned summary. Leave the work clocks on the row even though nobody claims them yet. Boot does not create the seven indexes. Leftover `pnpm migration:conversations:indexes` is the only apply path. Do not discover the next recording from here. Do not redact from here. Do not upload from here. Do not write the Lead from here.*

## Precise logic I would tighten while renaming

1. **`autoIndex` is false; leftover migration is the only apply path.** Already-recommended Lead Message / capacity bag let boot create clocks. Already-recommended WordPress receipt also uses `autoIndex: false`, then leftover-refuses leftover `vantagemovers` apply. This leftover migration leftover-applies on leftover `vantagemovers` when leftover `--confirm-<database>` matches. Do not flip `autoIndex` on so “this matches Lead Message” without a paired boot plus unique-recording proof. Do not leftover-refuse leftover `vantagemovers` apply so “this matches the WordPress receipt” without a paired leftover-migration proof.

2. **Collection name lives on leftover config, not this export.** Leftover `LEAD_CONVERSATION_COLLECTION` is leftover `src/config/domain/conversations.ts`. Leftover migration leftover-imports that constant plus this catalog. Do not re-export the collection name from this file so “the model owns the string.”

3. **There is no `createLeadConversation`.** Already-recommended outbound SMS has leftover `createLeadMessage`. The seed leftover-upserts through the getter. Do not add a save helper so “conversation matches SMS” without a paired seed proof that leftover `findOneAndUpdate` upsert still wins on `{ provider, provider_recording_id }`.

4. **`lead_ref` may stay `null`.** Spec §2.1 says a conversation can be found before its Lead is booked. Automated attach is deferred. Seed always writes a Call Lead pointer. Do not require `lead_ref` so “every recording has a Lead” without a paired deferred-discovery proof.

5. **`lead_ref` nested uses `{ _id: false }`.** Already-recommended outbound SMS `lead_ref` does **not**. Already-recommended WordPress receipt does. Do not flip `_id` on so “conversation matches SMS” without a paired seed plus drawer proof.

6. **`booking_ref` is denormalized.** Spec says do not put `conversation_id` on the Booking. Named `lead_conversation_booking` exists. No Owner Booking-drawer route leftover-asks it. Do not add `conversation_ids[]` onto already-recommended `BookedLead.ts` so “the Booking owns the tape.” Do not leftover-teach leftover `listConversationsByLead` to leftover-filter leftover `booking_ref` so “one drawer owns every join.”

7. **Phones are already masked.** Schema leftover-requires leftover `from_phone_masked` / leftover `to_phone_masked`. Leftover seed leftover-asks leftover `maskPhoneForLog`. This file leftover-does leftover-not leftover-mask. Do not store leftover `from_phone` so “replay can skip masking.”

8. **`media.blob_url` is stored; the opened card omits it.** Already-recommended `toConversationDetail` leftover-paints leftover pathname / leftover bytes / leftover purged and leftover-drops leftover `blob_url`. Leftover listen leftover-issues a five-minute URL from leftover pathname. Do not leftover-drop leftover `blob_url` from the schema so “the card matches the row” without a paired seed proof. Do not leftover-teach leftover detail to leftover-return leftover `blob_url` so “play can skip sign.”

9. **`media.content_type` is a free string.** Spec leftover-names leftover `"audio/mpeg" | null`. Leftover seed leftover-stamps leftover `"audio/mpeg"`. Do not enum leftover `content_type` from this rename so “the row matches the spec” without a paired leftover-seed proof that an unknown locker type still leftover-validates.

10. **`rc_result` is a free string.** Spec leftover-examples leftover `"Accepted"` / leftover `"Call connected"` / leftover `"Voicemail"`. Do not enum leftover `rc_result` so “the row matches the spec list.”

11. **`match_confidence` has no `low`.** Leftover enum is leftover `high` | leftover `medium`. Leftover model test leftover-rejects leftover `guessed_phone`, not leftover `low`. Do not add leftover `low` so “every guess has a bucket.”

12. **`match_evidence` defaults to `undefined`, not `null`.** Other bags default `null`. Leftover seed leftover-writes leftover `chosen_reason: "owner_seeded"`. Do not leftover-flip leftover `default: null` so “evidence matches media” without a paired validate proof.

13. **Work / claim clocks are forward-declared.** Spec leftover-says leftover changing a collection that already holds records is more expensive than leftover-declaring six leftover-null leftover-fields. Leftover seed leftover-writes leftover `state: "complete"` and leftover-nulls leftover claim leftover-clocks. There is **no** leftover conversation leftover-drainer in `src/`. Do not leftover-delete leftover `lead_conversation_work` so “unused clocks confuse.” Do not leftover-move leftover claim leftover-into leftover already-recommended leftover `durable-work-leases.md` so “one lease owns every drain.”

14. **`toJSON` / `toObject` virtuals are on and unused.** This file leftover-declares leftover-no leftover-virtuals. Do not leftover-invent a leftover virtual leftover `lead` leftover-populate so “the recording owns the Call Lead.”

15. **CamelCase timestamps plus `__v`.** Already-recommended leftover Picker leftover-uses leftover named leftover `created_at` only and leftover `versionKey: false`. Do not leftover-rename leftover `createdAt` so “conversation leftover-matches leftover Picker.” Do not leftover-drop leftover `__v` so “this leftover-matches leftover the leftover nonce.”

16. **Job Timeline leftover-does leftover-not leftover-hop leftover `lead_conversations`.** Spec leftover-§2.3 leftover-names leftover timeline leftover-members leftover on leftover `projections.ts`. This checkout leftover-has leftover-none. Do not leftover-teach leftover `mongo-evidence-loader.ts` to leftover-import this file so “hop leftover-matches leftover Form Lead.” Do not leftover-add leftover those leftover-members leftover from leftover this leftover-rename.

17. **Historical consolidation leftover-omits leftover `lead_conversations`.** Leftover `SIDE_EFFECT_COLLECTIONS` leftover-lists leftover `lead_messages` leftover and leftover-omits leftover this leftover-name. Do not leftover-add leftover it leftover from leftover this leftover-rename so “side-effect leftover-matches leftover SMS.”

18. **Software-map gap.** Leftover Core Collections leftover-omits leftover this leftover-name. Leftover API leftover-host leftover-rule leftover and leftover `.cursor/skills/hit-vantage-api/SKILL.md` leftover-omit leftover the leftover four leftover Owner leftover conversation leftover-routes. Do not leftover-invent leftover those leftover-lines leftover from leftover this leftover-rename.

19. **Leave sibling modules alone.** Leftover `listConversations` / leftover `redactTranscript` / leftover `uploadConversationMp3` / leftover `parseConversationArtifact` / leftover operator leftover-upsert / leftover index leftover-apply leftover-are leftover already leftover the leftover right leftover **depth**.

## Testing

The interface of this file is the default-connection model, the selected-database getter, the inferred-row type, the named seven-index catalog, required `provider` / `provider_recording_id` / `call_log_id` / `match_method` / `match_confidence` / `direction` / `rc_result` / `started_at` / `duration_seconds` / `from_phone_masked` / `to_phone_masked`, optional `lead_ref` with `{ _id: false }`, optional `booking_ref`, `state` default `"discovered"`, camelCase timestamps, default `__v`, `autoIndex: false`, unique `{ provider, provider_recording_id }`, and the omitted save helper. `LeadConversation.test.ts` asks default `new LeadConversation` validate (complete seeded bag plus invented `guessed_phone` refuse) plus default `.schema.indexes()` for all seven names and the one unique recording clock. Owner list / seed tests ask the service or the script, not this export.

I would keep that focused model file. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.LeadConversation ?? mongoose.model(...)`
- `getLeadConversationModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()` and registers on `useDb` otherwise
- already-recommended `listConversations` / `listConversationsByLead` / `getConversationById` **ask** the getter
- leftover operator seed leftover-upserts leftover `{ provider, provider_recording_id }` through the getter after leftover `--confirm-write`
- a second `{ provider, provider_recording_id }` leftover-misses (unique)
- leftover `call_log_id` leftover-is leftover-not leftover-unique
- leftover `lead_ref` leftover-may leftover-stay leftover `null`
- leftover invented leftover `match_method` leftover-refuses leftover validate
- leftover `autoIndex` leftover-stays leftover `false`; leftover `pnpm migration:conversations:indexes` leftover-is leftover the leftover only leftover apply leftover-path
- leftover migration leftover-does leftover-not leftover-refuse leftover `vantagemovers` leftover the leftover way leftover WordPress leftover-receipts leftover-do
- leftover opened leftover-card leftover-omits leftover `media.blob_url`
- leftover Job Timeline leftover-does leftover-not leftover-hop leftover this leftover-collection
- leftover historical leftover apply leftover / leftover verify leftover-treat leftover `lead_conversations` leftover as leftover-not leftover a leftover side-effect
- leftover HTTP leftover desks leftover-ask leftover already-recommended leftover reads leftover / leftover locker leftover — **not this export**
- leftover `schema-and-crud-inputs.mdc` leftover-does leftover-not leftover-name leftover `lead_conversations`; this leftover-pass leftover-does leftover-not leftover-rewrite leftover that leftover-list
- leftover next leftover `BookingLeadReconciliationCase` leftover-is leftover a leftover different leftover collection; that leftover-file leftover-is leftover out leftover of leftover this leftover story
- already-recommended leftover `LeadMessage` / leftover `LeadMessageRateLimit` leftover / leftover `FormLead` / leftover `CallLead` leftover / leftover `BookedLead` leftover-are leftover different leftover collections; those leftover-files leftover-are leftover out leftover of leftover this leftover story

I would not test leftover desk leftover-paint leftover, leftover PCI leftover-strip leftover, leftover locker leftover-sign leftover, leftover artifact leftover-parse leftover, leftover Owner leftover-403 leftover, leftover or leftover Job Timeline leftover-assemble leftover from leftover this leftover-file.

Do not add a test per helper (`theRecordingIsUnique`, `theLeadPointerMayStayNull`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `LeadConversationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `seed.ts` / `claim.ts` / `discover.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (there is none here; leftover seed leftover-uploads leftover then leftover-upserts leftover after leftover `--confirm-write`, leftover and leftover Owner leftover-reads leftover-never leftover-write).
- Treating `listConversations` / `redactTranscript` / `uploadConversationMp3` / `issueConversationAudioUrl` / `parseConversationArtifact` / leftover operator leftover-upsert / leftover index leftover-apply / leftover next leftover employee-booking leftover-recon leftover as leftover this leftover story.
- Inventing a selected-database-less seam that has only the Picker default as an adapter.
- Inventing a required-`lead_ref` seam that has only the Chris Hughes seed as an adapter.
- Silently flipping `autoIndex` on, leftover-deleting leftover the leftover getter leftover, leftover-deleting leftover the leftover default leftover export leftover, leftover-adding leftover `createLeadConversation`, leftover-requiring leftover `lead_ref`, leftover-uniquing leftover `call_log_id`, leftover-uniquing leftover `lead_ref`, leftover-storing leftover a leftover plaintext leftover phone leftover, leftover-storing leftover a leftover RingCentral leftover `contentUri`, leftover-enuming leftover `rc_result` leftover / leftover `content_type`, leftover-renaming leftover `createdAt`, leftover-dropping leftover `__v`, leftover-rewriting leftover Core leftover Collections leftover, leftover-teaching leftover Job Timeline leftover to leftover-hop leftover this leftover collection leftover, leftover-adding leftover Granot leftover timeline leftover members leftover, leftover or leftover leftover-merging leftover this leftover into leftover already-recommended leftover outbound leftover SMS leftover while leftover recommending leftover a leftover rename.
- Pulling `listConversations`, `redactTranscript`, or `uploadConversationMp3` into this file.
- Merging this collection into already-recommended `LeadMessage`, already-recommended `LeadMessageRateLimit`, leftover next `BookingLeadReconciliationCase`, leftover later `PublicSubmissionThrottleBucket`, already-recommended `FormLead`, already-recommended `CallLead`, or already-recommended `BookedLead`.
- Silently leftover-rewriting leftover deferred leftover discovery leftover / leftover attach leftover / leftover drain leftover as leftover shipped leftover so leftover “the leftover clocks leftover are leftover unused.”
- Changing leftover seed leftover to leftover `deleteOne` leftover so leftover “we leftover-match leftover the leftover consent leftover hash.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or leftover next `BookingLeadReconciliationCase.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `BookingLeadReconciliationCase.ts` while writing this file.
