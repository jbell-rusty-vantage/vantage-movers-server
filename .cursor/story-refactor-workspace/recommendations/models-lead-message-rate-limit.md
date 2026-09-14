# Remember The Hourly And Destination Confirmation-SMS Capacity Buckets On The Selected Mongo Database — String _id Is hourly-Plus-UTC-Hour Or destination-Plus-SHA256, Kind Discriminates The Two Bags, Count Plus Last-Reserved And Decision-Token, TTL When expires_at Arrives, Default CamelCase Timestamps, Selected-Database Getter — Never Reserve Or Normalize Here, Never Store The Phone, Never Merge This Into The Outbound SMS Row — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 49 of this service — `LeadMessageRateLimit.ts`
- Remaining in this service: `LeadConversation.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/LeadMessageRateLimit.ts`
- Knowledge: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md) (System of Record is Mongo `lead_messages`; Twilio is the provider, not the authority; persist then dispatch-or-queue after the caller’s transaction commits; capacity / destination guard writes a skipped `lead_messages` row with `invalid_destination`, `country_not_allowed` (default prefix `+1`), `hourly_capacity_reached` (default 200/hour), or `destination_cooldown` (default 15 minutes) — **this file never persists intent, never decides E.164 or country, never increments, never compares the hourly ceiling, never hashes the phone, never talks to Twilio**). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections names `LeadMessage` (`lead_messages`) and does **not** name `lead_message_rate_limits`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the hourly bag.” Config ceilings live in `src/config/domain/leadMessaging.ts` (`getLeadMessagingHourlyLimit` default 200, `getLeadMessagingDestinationCooldownMs` default 15 minutes, `getLeadMessagingAllowedCountryPrefixes` default `+1`) — **not this file**. Already-recommended remember / send / drain / callback: [lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md) (`persistLeadMessageIntent` **asks** `reserveLeadMessagingCapacity` after consent / duplicate / disabled; `reserveLeadMessagingCapacity` **asks** `getLeadMessageRateLimitModel` — hourly `$inc` then ceiling check; destination pipeline `$cond` on cooldown — **this file never reserves**). Already-recommended Granot six gates: [lead-messaging-granot-created-lead.md](lead-messaging-granot-created-lead.md) (gate 6 is “destination present”; capacity still runs inside persist — **this file never walks the six gates**). Already-recommended Form Lead Ingestion: [form-lead.md](form-lead.md) (`persistLeadMessageIntent` inside the write — **this file never forces the transaction**). Already-recommended outbound SMS row: [models-lead-message.md](models-lead-message.md) (collection `lead_messages` — **do not merge**). Already-recommended Sheets minute budget: [models-sheet-sync-quota-bucket.md](models-sheet-sync-quota-bucket.md) (collection `sheet_sync_quota_buckets`, unique triple, TTL `expireAfterSeconds: 3600` on `window_start`, **no** selected-database getter — **do not merge**). Already-recommended HTTP desks: [routes-v1.md](routes-v1.md) Owner `GET/POST /api/v1/admin/lead-messages*`; [routes-twilio-message-status.md](routes-twilio-message-status.md); [routes-lead-messaging-cron.md](routes-lead-messaging-cron.md) — **never import this file**. Distinct from leftover later conversation recording: leftover later `LeadConversation.ts` — **do not merge**. Distinct from leftover later public-form throttle: leftover later `PublicSubmissionThrottleBucket.ts` (unique `{ key_hash, window_start }`, ObjectId `_id`, `count` `min: 0`, **no** getter — **do not merge**). Distinct from already-recommended Form / Call rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md) — **not this collection**. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md) / [System of Record](../../../../CONTEXT.md); it does **not** define Lead Message or capacity bucket — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model.** Already-recommended `leadMessaging.service.ts` `reserveLeadMessagingCapacity` is the **only** runtime writer. It **asks** `getLeadMessageRateLimitModel()` after it has already refused a non-E.164 destination and a disallowed country prefix. Hourly `findOneAndUpdate` upserts `_id: hourly:${UTC-hour ISO}` and `$inc`s `count`. Destination `findOneAndUpdate` (update pipeline) upserts `_id: destination:${sha256(E.164)}` and `$cond`s `last_reserved_at` / `last_decision_token`. Persist **asks** reserve only when duplicate / disabled did not already skip — then writes the `lead_messages` skip or pending row through already-recommended `createLeadMessage`. Persist tests inject `evaluateGuard` and **never** ask this getter. The model test constructs default `new LeadMessageRateLimit` and validates defaults — **never asks the getter, never `$inc`s, never reads `.schema.indexes()`**. There is **no** `createLeadMessageRateLimit`. There is **no** runtime import of default `LeadMessageRateLimit` except the getter returning it when `mongoose.connection.name === getMongoDatabaseName()`. Admin list / Form browse / SMS cohort / Job Timeline / historical apply **do not** read this collection. Historical `SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and **omits** `lead_message_rate_limits`. Not this **interface**: `reserveLeadMessagingCapacity` itself, `persistLeadMessageIntent` itself, `normalizeSmsDestination` itself, `getLeadMessagingHourlyLimit` itself.
- Seams callers need: default `LeadMessageRateLimit` (first-registered connection — the getter returns it when `mongoose.connection.name === getMongoDatabaseName()`; the model test constructs here) vs `getLeadMessageRateLimitModel()` (selected `getMongoDatabaseName()` — the only live reserve write); string `_id` (`hourly:${hourStart.toISOString()}` vs `destination:${sha256 hex}`) vs **no** unique compound clock besides `_id`; required `kind` enum `hourly` | `destination` vs fields that are **not** kind-discriminated (`last_reserved_at` / `last_decision_token` live on hourly rows too); required `count` default `0` (**no** `min`) vs destination `count` that increments even when cooldown denies; `last_reserved_at` / `last_decision_token` default `null` vs reserve’s destination `$cond`; required `expires_at` vs hourly `hourStart + 2h` vs destination `now + cooldown*2` vs unnamed TTL `{ expires_at: 1 }` `expireAfterSeconds: 0`; `timestamps: true` camelCase `createdAt` / `updatedAt` vs leftover later public throttle (also camelCase) vs already-recommended Picker (named `created_at` only); default `__v`; omitted `autoIndex: false` (boot creates the TTL clock — there is **no** M5 `createIndexes()` for this collection). There is no persist-intent Domain Command **seam**. There is no HTTP **seam**. There is no reserve **seam**. There is no phone-hash **seam**. There is no `createLeadMessageRateLimit` **adapter**.
- Split later (only if the file outgrows one sitting): this ~60-line file is one sitting if you read it as remember the hourly and destination confirmation-SMS capacity buckets on the selected Mongo database — string `_id` is hourly-plus-UTC-hour or destination-plus-SHA256, kind discriminates the two bags, count plus last-reserved and decision-token, TTL when `expires_at` arrives, default camelCase timestamps, selected-database getter — never reserve or normalize here, never store the phone, never merge this into the outbound SMS row. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `hourly.ts` / `destination.ts` / `reserve.ts`. Reserve stays already-recommended `leadMessaging.service.ts`. Persist stays already-recommended `persistLeadMessageIntent`. Ceilings stay `src/config/domain/leadMessaging.ts`. Already-recommended outbound SMS row stays `LeadMessage.ts`. Leftover later conversation stays leftover later `LeadConversation.ts`. Leftover later public throttle stays leftover later `PublicSubmissionThrottleBucket.ts`. Already-recommended Sheets minute budget stays `SheetSyncQuotaBucket.ts`.

`LeadMessageRateLimit` is a Mongoose model name. The owner question is: *Someone is about to remember a confirmation SMS. Hold this UTC hour’s send count, and this destination’s last successful reserve, as two string-id bags on `lead_message_rate_limits`. The hourly bag is `hourly:` plus the UTC hour. The destination bag is `destination:` plus the SHA-256 of the already-normalized E.164 — never the phone. Stamp how many times we touched the bag, when the destination last reserved, and the one-time token that proves this ask won the cooldown. Forget the row when `expires_at` arrives. If this process selected a different Mongo database, hand back that database’s bag model. Do not decide E.164. Do not increment. Do not compare 200. Do not hash the phone. Do not invent a selected-database-less default so “this matches the Picker selection.” Do not store the plaintext destination so “cooldown can skip hashing.” Do not merge this into the leftover later conversation or the already-recommended outbound SMS row.*

Who reserve / increment / compare already lives in already-recommended `reserveLeadMessagingCapacity`. Who remember the skipped or pending text already lives in already-recommended `persistLeadMessageIntent`. Who own 200 / 15 minutes / `+1` already lives in `src/config/domain/leadMessaging.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the hourly and destination confirmation-SMS capacity buckets on the selected Mongo database — string `_id` is hourly-plus-UTC-hour or destination-plus-SHA256, kind discriminates the two bags, count plus last-reserved and decision-token, TTL when `expires_at` arrives, default camelCase timestamps, selected-database getter — never reserve or normalize here, never store the phone, never merge this into the outbound SMS row” story, not “a rate-limit CRUD dump,” and not Reserve Hourly And Destination Capacity itself:

1. **Hold the confirmation-SMS capacity bucket** — collection `lead_message_rate_limits`, `timestamps: true` (mongoose camelCase `createdAt` / `updatedAt`). **No** `minimize: false`. **No** `toJSON` / `toObject` virtuals. **No** `autoIndex: false`. **No** `versionKey: false` (default `__v`). **No** hooks. **No** `immutable`. Required string `_id`. Required `kind` enum `"destination"` | `"hourly"`. Required `count` Number default `0` (**no** `min`). `last_reserved_at` Date default `null`. `last_decision_token` String default `null`. Required `expires_at` Date. `LeadMessageRateLimitDocument` is the handwritten type (not `InferSchemaType`). This beat does **not** `$inc`. This beat does **not** floor the UTC hour. This beat does **not** SHA-256 the destination.

2. **Remember which bag this is — this UTC hour, or this hashed destination — and when Mongo may forget it** — `_id` is the identity. Hourly reserve writes `hourly:${hourStart.toISOString()}` after `setUTCMinutes(0, 0, 0)`. Destination reserve writes `destination:${sha256(E.164).hex}`. There is **no** unique compound `{ kind, window }` clock. There is **no** unique `{ destination }` clock — the phone never lands here. `kind` is required on the schema and `$set` on both upserts; the extra fields are **not** kind-gated (an hourly row may carry `null` `last_reserved_at`). `expires_at` is required. Hourly reserve stamps `hourStart + 2 hours`. Destination reserve stamps `now + cooldownMs * 2` (default 30 minutes). Unnamed TTL `{ expires_at: 1 }` `expireAfterSeconds: 0` deletes when that clock arrives. This beat does **not** unique `kind`. This beat does **not** store `to`.

3. **Stamp the TTL clock and hand back the selected-database model** — `LeadMessageRateLimitSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })`. There is **no** `LEAD_MESSAGE_RATE_LIMIT_INDEXES` catalog. There is **no** collection-name export. There is **no** `createLeadMessageRateLimit`. Default export `LeadMessageRateLimit` is `mongoose.models.LeadMessageRateLimit ?? mongoose.model(...)`. `getLeadMessageRateLimitModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Reserve asks that getter. The model test constructs the default and does **not** read `.schema.indexes()`. This beat does **not** `syncIndexes` on boot. This beat does **not** delete the default export so “everyone must call the getter.”

There is no reserve operation. `reserveLeadMessagingCapacity` elects `invalid_destination` / `country_not_allowed` / `hourly_capacity_reached` / `destination_cooldown` then asks this getter. There is no persist-intent operation. Persist writes the skipped or pending `lead_messages` row elsewhere. There is no Owner-list operation. Nobody pages these bags.

## Organization

Keep one file. This is the screenplay for “remember the hourly and destination confirmation-SMS capacity buckets on the selected Mongo database — string `_id` is hourly-plus-UTC-hour or destination-plus-SHA256, kind discriminates the two bags, count plus last-reserved and decision-token, TTL when `expires_at` arrives, default camelCase timestamps, selected-database getter — never reserve or normalize here, never store the phone, never merge this into the outbound SMS row.” Reserve / persist / config ceilings already live in deeper **modules**. Already-recommended outbound SMS row / already-recommended Sheets minute budget already live in sibling **modules**. Leftover later conversation / leftover later public throttle already live in sibling **modules**. Do not pull those in. Do not invent a `LeadMessageRateLimitService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent an `autoIndex: false` **adapter** so “this matches Form Lead” without a paired proof that boot no longer creates the TTL clock. Do not invent a `createLeadMessageRateLimit` **adapter** so “this matches Lead Message save.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `hourly.ts` / `destination.ts` / `reserve.ts` each get a file.

Do not move `reserveLeadMessagingCapacity` into this file so “the bag owns the ceiling.” Do not move `normalizeSmsDestination` into this file so “the bag owns E.164.” Do not merge this file into already-recommended `LeadMessage.ts` so “one schema owns the text and the hourly bucket.” Do not merge this file into leftover later `LeadConversation.ts` so “one schema owns capacity and the conversation recording.” Do not merge this file into leftover later `PublicSubmissionThrottleBucket.ts` so “one throttle owns every public window.” Do not merge this file into already-recommended `SheetSyncQuotaBucket.ts` so “one bag owns Sheets and SMS.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `LeadMessageRateLimit` | `confirmationSmsCapacityBucketOnTheDefaultConnection` | the getter returns this default model when `mongoose.connection.name` already is `getMongoDatabaseName()`; the model test constructs here |
| `getLeadMessageRateLimitModel` | `confirmationSmsCapacityBucketOnTheSelectedMongoDatabase` | live reserve must follow `getMongoDatabaseName()` |
| `LeadMessageRateLimitDocument` | `ConfirmationSmsCapacityBucket` | handwritten row + string `_id` |

Keep the old names as one-line aliases until reserve, the model test, and inject sites migrate. Do not make callers learn `useDb` / `expireAfterSeconds` / `hourly:` as the only domain language until those sites move. Do **not** delete the default `LeadMessageRateLimit` export so “everyone must call the getter” without a paired proof that the getter still returns the same first-registered model when the connection name matches **and** the model test still constructs. Do **not** delete the getter so “this matches the Picker selection” without a paired proof that reserve still writes the selected database. Do **not** add `createLeadMessageRateLimit` so “SMS save matches the bucket.” Do **not** re-export `reserveLeadMessagingCapacity` / `getLeadMessagingHourlyLimit` from this file so “the bag reserves or owns 200.”

**No class for the workflow.** The one type that *does* earn a name is the confirmation-SMS capacity identity contract:

```ts
type ConfirmationSmsCapacityBucketIdentity = {
  collection: "lead_message_rate_limits"
  id_shapes: ["hourly:${utcHourIso}", "destination:${sha256Hex}"]
  kinds: ["hourly", "destination"]
  stores_plaintext_destination: false
  unique_compound_kind_window: false
  count_min: false
  destination_count_increments_on_cooldown_deny: true
  last_reserved_fields_are_kind_gated: false
  hourly_expires_at: "hourStart + 2h"
  destination_expires_at: "now + cooldownMs * 2"
  ttl: { expires_at: 1, expireAfterSeconds: 0 }
  timestamps: { createdAt: true, updatedAt: true }
  versionKey: true
  selected_database_getter: true
  save_through_getter: false
  default_export_runtime_import: false
  default_export_model_test_constructs: true
  autoIndex: true
  named_index_catalog: false
  m5_createIndexes: false
  core_collections_names_this: false
  historical_side_effect: false
}
```

That is the handoff from “this process remembered a confirmation-SMS capacity bag” to “hourly identity is the UTC hour string, destination identity is the SHA-256 of the already-normalized phone, Mongo forgets the row when `expires_at` arrives, and boot creates that TTL clock.” Do **not** add `{ stores_plaintext_destination: true }` so “cooldown can skip hashing.” Do **not** add `{ selected_database_getter: false }` so “this matches the Picker selection.” Do **not** add `{ unique_compound_kind_window: true }` so “SMS matches Sheets.” Do **not** add `{ autoIndex: false }` so “this matches Form Lead.” Do **not** add `{ count_min: 0 }` so “this matches the public throttle.”

Leave already-recommended `leadMessaging.service.ts` on that file. Leave already-recommended `LeadMessage.ts` on that file. Leave leftover later `LeadConversation.ts` on that file. Leave leftover later `PublicSubmissionThrottleBucket.ts` on that file. Leave already-recommended `SheetSyncQuotaBucket.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// LeadMessageRateLimit.ts
// Someone is about to remember a confirmation SMS.
// Hold this UTC hour’s send count,
// and this destination’s last successful reserve,
// as two string-id bags on lead_message_rate_limits.
// The hourly bag is hourly: plus the UTC hour.
// The destination bag is destination: plus the SHA-256
// of the already-normalized E.164 — never the phone.
// Forget the row when expires_at arrives.
// If this process selected a different Mongo database,
// hand back that database’s bag model.
// Do not decide E.164.
// Do not increment.
// Do not compare 200.
// Do not hash the phone.

// ── 1. Hold the confirmation-SMS capacity bucket ──────────

const LeadMessageRateLimitSchema = new Schema(
  {
    _id: { type: String, required: true },
    kind: {
      type: String,
      enum: ["destination", "hourly"],
      required: true,
    },
    count: { type: Number, required: true, default: 0 },
    last_reserved_at: { type: Date, default: null },
    last_decision_token: { type: String, default: null },
    expires_at: { type: Date, required: true },
  },
  {
    collection: "lead_message_rate_limits",
    timestamps: true,
  },
)

// ── 2. Remember which bag this is — this UTC hour,
// or this hashed destination — and when Mongo may forget it

function rememberWhichBagThisIsAndWhenMongoMayForgetIt() {
  // hourly:_id = hourly:${UTC hour ISO}
  // destination:_id = destination:${sha256(E.164)}
  // no plaintext phone
  // no unique { kind, window }
  // expires_at: hourly hourStart+2h; destination now+cooldown*2
}

// ── 3. Stamp the TTL clock and hand back
// the selected-database model

LeadMessageRateLimitSchema.index(
  { expires_at: 1 },
  { expireAfterSeconds: 0 },
)

export const confirmationSmsCapacityBucketOnTheDefaultConnection =
  mongoose.models.LeadMessageRateLimit ??
  mongoose.model("LeadMessageRateLimit", LeadMessageRateLimitSchema)

export function confirmationSmsCapacityBucketOnTheSelectedMongoDatabase() {
  const dbName = getMongoDatabaseName()
  if (mongoose.connection.name === dbName) {
    return confirmationSmsCapacityBucketOnTheDefaultConnection
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true })
  return (
    db.models.LeadMessageRateLimit ??
    db.model("LeadMessageRateLimit", LeadMessageRateLimitSchema)
  )
}

export {
  confirmationSmsCapacityBucketOnTheDefaultConnection as LeadMessageRateLimit,
}
export {
  confirmationSmsCapacityBucketOnTheSelectedMongoDatabase as getLeadMessageRateLimitModel,
}
```

Read the primary path out loud: *Someone just asked for a confirmation text — a public-form quote with `sms_consent === true`, or a Granot create-if-missing Lead that already passed the six gates. Duplicate and disabled already skipped without touching these bags. Reserve asks the selected-database model. The hourly bag is `hourly:` plus this UTC hour; `$inc` count, then refuse if the count is past 200. That refusal still burned the increment. The destination bag is `destination:` plus the SHA-256 of the E.164; a fresh UUID wins only when `last_reserved_at` is empty or older than 15 minutes. A lost cooldown still increments destination `count`. Persist then writes a skipped or pending `lead_messages` row elsewhere. Mongo forgets each bag when its `expires_at` arrives. Do not decide E.164 from here. Do not store the phone from here. Do not merge this into the outbound SMS row.*

## Precise logic I would tighten while renaming

1. **Hourly capacity increments before the limit check.** Already-recommended `reserveLeadMessagingCapacity` `$inc`s then compares `count > getLeadMessagingHourlyLimit()`. A skip for `hourly_capacity_reached` still burned a count. Already-recommended remember named that. Do not decrement from this rename so “a skip gives the slot back.”

2. **Destination `count` increments even when cooldown denies.** The pipeline `$add`s `count` unconditionally; `$cond` only protects `last_reserved_at` / `last_decision_token`. Reserve decides cooldown by `last_decision_token !== this UUID`, not by `count`. Do not teach reserve to skip the `$add` so “deny means no write” without a paired persist proof.

3. **`kind` does not gate the extra fields.** Hourly upserts never set `last_reserved_at`. The schema still defaults those fields on every row. Do not split `hourly.ts` / `destination.ts` so “each kind owns its columns.”

4. **`_id` is the only uniqueness.** There is no unique `{ kind, window }` like Sheets and no unique `{ key_hash, window_start }` like the leftover later public throttle. Do not add those clocks so “one throttle pattern” without a paired reserve rewrite proof.

5. **The phone never lands here.** Destination identity is SHA-256 of already-normalized E.164. Do not persist `to` so “cooldown can skip hashing.” Do not import `normalizeSmsDestination` into this file so “the bag owns E.164.”

6. **TTL is `expireAfterSeconds: 0` on `expires_at`.** Already-recommended Sheets minute budget TTLs `window_start` at 3600 seconds. Already-recommended Picker / consent hash use `expires_at` + `0` like this file. Do not switch this TTL to 3600-from-window so “SMS matches Sheets.” Do not drop the TTL so “capacity is durable like the text.”

7. **Hourly `expires_at` is the hour start plus two hours, not now plus two hours.** A reserve at 18:59 still dies at 20:00 UTC. Do not change the stamp so “every bag lives two hours from now” without a paired reserve proof.

8. **Duplicate / disabled skip before reserve.** Persist does **not** ask this getter when `duplicate_lead` or `messaging_disabled` is already set. Do not teach persist to reserve first so “every skip burns hourly.”

9. **Default export has no runtime import.** Every runtime ask uses `getLeadMessageRateLimitModel`. The model test constructs the default and does **not** read `.schema.indexes()`. Do not delete the default so “everyone must call the getter” without a paired getter **and** model-test proof. Do not switch the model test to the getter so “this matches reserve” without that same proof.

10. **CamelCase timestamps plus `__v`.** Already-recommended Picker selection uses named `created_at` only and `versionKey: false`. Already-recommended outbound SMS row uses this same camelCase plus `__v`. Do not rename `createdAt` so “capacity matches Picker.” Do not drop `__v` so “this matches the nonce.”

11. **No `createLeadMessageRateLimit`.** Already-recommended outbound SMS row has `createLeadMessage` (`new` + `save` through the getter). Reserve upserts. Do not add a save helper so “the bag matches the text.”

12. **`count` has no `min`.** Leftover later public throttle uses `min: 0`. Do not add `min: 0` so “capacity matches the public window” without a paired upsert proof.

13. **Core Collections and historical apply omit this collection.** `schema-and-crud-inputs.mdc` names `lead_messages` and does **not** name `lead_message_rate_limits`. Historical `SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and omits this name. Do not add this collection to either list from this rename so “the bag is a side-effect of apply.” Do not teach apply to import this model.

14. **Persist tests inject `evaluateGuard`.** `leadMessaging.service.test.ts` never asks this getter. The model test never `$inc`s. Do not add a live Mongo reserve test on this file so “the schema owns 200.”

15. **Software-map gap.** HTTP desks never import this file. Admin never lists these bags. Job Timeline does not hop `lead_message_rate_limits`. Do not invent those lines from this rename.

16. **Leave sibling modules alone.** `reserveLeadMessagingCapacity` / `persistLeadMessageIntent` / `normalizeSmsDestination` / leftover later conversation writes are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the selected-database getter, the handwritten-row type, required string `_id`, required `kind` enum `hourly` | `destination`, `count` default `0`, `last_reserved_at` / `last_decision_token` default `null`, required `expires_at`, camelCase timestamps, default `__v`, the unnamed TTL `{ expires_at: 1 }` `expireAfterSeconds: 0`, omitted `autoIndex: false`, and the omitted save helper. `LeadMessageRateLimit.test.ts` asks default `new LeadMessageRateLimit` validate for those defaults. Reserve / persist tests ask the service (usually through injected `evaluateGuard`), not this export.

I would keep that focused model file. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.LeadMessageRateLimit ?? mongoose.model(...)`
- `getLeadMessageRateLimitModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()` and registers on `useDb` otherwise
- reserve asks the getter after E.164 / country prefix already passed
- hourly `_id` is `hourly:${UTC hour ISO}`; `$inc` then `count > 200` is `hourly_capacity_reached`
- that skip still burned the increment
- destination `_id` is `destination:${sha256(E.164)}`; plaintext `to` is **not** stored
- destination cooldown deny still increments `count`; `last_decision_token` stays the previous UUID
- persist does **not** ask this getter for `duplicate_lead` / `messaging_disabled`
- persist writes the skipped or pending row on already-recommended `lead_messages`, not here
- HTTP desks ask already-recommended remember / callback / cron — **not this export**
- Admin / Form browse / SMS cohort / Job Timeline do **not** read this collection
- historical apply / verify omit `lead_message_rate_limits`
- `schema-and-crud-inputs.mdc` does **not** name this collection; this pass does not rewrite that paragraph
- already-recommended `LeadMessage` is a different collection; that file is out of this story
- leftover later `LeadConversation` is a different collection; that file is out of this story
- leftover later `PublicSubmissionThrottleBucket` is a different collection; that file is out of this story
- already-recommended `SheetSyncQuotaBucket` is a different collection; that file is out of this story

I would not test persist consent, claim-and-send, quiet hours, callback never-backward, Granot six gates, E.164 normalize, or the 200 / 15-minute config parsers from this file.

Do not add a test per helper (`theHourlyBagIsTheUtcHour`, `theDestinationBagIsTheHash`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `LeadMessageRateLimitService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `hourly.ts` / `destination.ts` / `reserve.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (Form Lead Ingestion already owns that seam; persist — including this reserve — is inside the write, send-or-wake is after commit).
- Treating `reserveLeadMessagingCapacity` / `persistLeadMessageIntent` / `normalizeSmsDestination` / leftover later conversation / leftover later public throttle / already-recommended outbound SMS row as this story.
- Inventing a selected-database-less seam that has only the Picker default as an adapter.
- Inventing a plaintext-destination seam that has only cooldown as an adapter.
- Silently decrementing hourly on skip, adding `{ kind, window }` uniqueness, storing `to`, deleting the getter, deleting the default export, flipping `autoIndex: false`, adding a named-index catalog, adding `createLeadMessageRateLimit`, renaming `createdAt`, dropping `__v`, adding `count` `min: 0`, rewriting Core Collections, or teaching historical apply to list this collection while recommending a rename.
- Pulling `reserveLeadMessagingCapacity` or `normalizeSmsDestination` into this file.
- Merging this collection into already-recommended `LeadMessage`, leftover later `LeadConversation`, leftover later `PublicSubmissionThrottleBucket`, already-recommended `SheetSyncQuotaBucket`, already-recommended Form / Call Lead, or already-recommended inbound-number interval.
- Silently reordering persist-inside-transaction versus send-or-wake-after-commit, or hourly `$inc` versus the ceiling check.
- Changing reserve to `deleteOne` so “we match the consent hash.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or leftover later `LeadConversation.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `LeadConversation.ts` while writing this file.
