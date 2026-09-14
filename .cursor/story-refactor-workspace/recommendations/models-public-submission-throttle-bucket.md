# Remember The Public Employee-Submit Window Bags On The Default Mongo Connection — Unique Hashed-Or-Literal Key Plus Floored Window, Count With Min Zero, TTL When expires_at Arrives, Unnamed Unique And Expiry Clocks The Boot Creates, Default-Connection Model Only — Never Floor Or Increment Here, Never Compare 10 Or 250, Never Store The Raw Client Key, Never Add A Selected-Database Getter From This Rename — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 52 of this service — `PublicSubmissionThrottleBucket.ts`
- Remaining in this service: `EntityChange.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/PublicSubmissionThrottleBucket.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (System of Record is Mongo `booked_leads` plus `booking_lead_reconciliation_cases`; public submit step 1 bumps global + per-client bags on `PublicSubmissionThrottleBucket`; defaults 300s window, 10/client, 250/global; over limit → 429 — **this file never floors the window, never `$inc`s, never compares 10 or 250, never books, never matches**). This checkout’s `CONTEXT.md` **does** define [`employee booking submission`](../../../../CONTEXT.md), [`booking lead reconciliation case`](../../../../CONTEXT.md), [`employee booking origin`](../../../../CONTEXT.md), and [`matching unavailable`](../../../../CONTEXT.md) — it does **not** define a public throttle bag; link those terms; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections names Form / Call / Booking / WordPress receipt / Granot / `LeadMessage` and does **not** name `public_submission_throttle_buckets`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the public window.” Ceilings live in `src/config/domain/bookingReconciliation.ts` (`publicThrottleWindowSeconds` default 300, `publicThrottlePerClientLimit` default 10, `publicThrottleGlobalLimit` default 250) — **not this file**. Already-recommended public submit: [employee-bookings-submit-employee-booking.md](employee-bookings-submit-employee-booking.md) (`enforceEmployeeBookingThrottle` **asks** default `PublicSubmissionThrottleBucket.findOneAndUpdate` **before** prepare / duplicate / job uniqueness / the write — **this file never throttles**). Already-recommended HTTP desk: [routes-v1.md](routes-v1.md) (`POST /api/v1/employee-booking-submissions` secret + 64-hex `x-public-client-key-hash` then `submitEmployeeBooking` — **never import this file**; `GET /api/v1/employee-booking-options` does **not** bump). Already-recommended Owner case: [models-booking-lead-reconciliation-case.md](models-booking-lead-reconciliation-case.md) (collection `booking_lead_reconciliation_cases` — **do not merge**). Already-recommended confirmation-SMS capacity: [models-lead-message-rate-limit.md](models-lead-message-rate-limit.md) (collection `lead_message_rate_limits`, string `_id`, selected-database getter, `count` **no** `min` — **do not merge**). Already-recommended Sheets minute budget: [models-sheet-sync-quota-bucket.md](models-sheet-sync-quota-bucket.md) (collection `sheet_sync_quota_buckets`, unique triple, TTL `expireAfterSeconds: 3600` on `window_start`, **no** `expires_at`, **no** getter — **do not merge**). Already-recommended outbound SMS row: [models-lead-message.md](models-lead-message.md) — **do not merge**. Already-recommended Form / Call / Booking rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md), [models-booked-lead.md](models-booked-lead.md) — **not this collection**. Already-recommended historical apply: [historical-consolidation-apply.md](historical-consolidation-apply.md) (`SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and **omits** this name). Already-recommended Job Timeline hop: [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (**does not** hop `public_submission_throttle_buckets`). Distinct from leftover next append-only mutation evidence: leftover next `EntityChange.ts` — **do not merge**. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model only — there is no selected-database getter.** Already-recommended `submitEmployeeBooking.service.ts` is the **only** runtime writer. `submitEmployeeBooking` **asks** `enforceEmployeeBookingThrottle(context.clientKeyHash)` first. That helper always bumps `key_hash: "global"` (the **literal** string — not a hash), then bumps `clientKeyHash.trim()` when the route sent one. `bumpThrottleBucket` floors `Date.now()` to `windowSeconds`, `$inc`s `count` on `{ key_hash, window_start }` (`upsert`, `returnDocument: "after"`, `setDefaultsOnInsert: true`, `.orFail()`), and `$setOnInsert`s `expires_at: windowStart + windowSeconds * 2000`. Then `count > limit` is 429. The public route **always** sends a 64-hex hash after `connectMongo()`, so both bags always bump on HTTP. A caller that omits `clientKeyHash` burns only global. There is **no** `getPublicSubmissionThrottleBucketModel`. There is **no** `createPublicSubmissionThrottleBucket`. Owner desk / rematch / Best Relocation leadless / ordinary admin leadless / Granot Confirm / Form Lead ingest / WordPress receipt / GET options / tariff **do not** import this file. Tests: there is **no** `PublicSubmissionThrottleBucket.test.ts`. There is **no** `submitEmployeeBooking.service.test.ts`. `v1.routes.test.ts` only asserts the path is registered. Config tests parse the three `EMPLOYEE_BOOKING_PUBLIC_THROTTLE_*` env ints — **never ask this model**. Not this **interface**: `submitEmployeeBooking` itself, `enforceEmployeeBookingThrottle` itself, `getBookingReconciliationConfig` itself, leftover next `EntityChange` itself.
- Seams callers need: default `PublicSubmissionThrottleBucket` (first-registered connection — the only live upsert; there is **no** selected-database getter) vs mongoose `findOneAndUpdate` upsert (submit) vs **no** `new` + `save`; unique `{ key_hash, window_start }` vs already-recommended SMS string `_id` vs already-recommended Sheets `{ scope, op_class, window_start }`; required trimmed `key_hash` that may be the literal `"global"` **or** the already-hashed 64-hex header vs **no** plaintext client key; required `window_start` (submit floors; this file does not); required `count` default `0` **with** `min: 0` vs already-recommended SMS `count` with **no** `min`; required `expires_at` vs `$setOnInsert` only vs unnamed TTL `{ expires_at: 1 }` `expireAfterSeconds: 0` vs already-recommended Sheets TTL on `window_start` at 3600s; `timestamps: true` camelCase `createdAt` / `updatedAt`; default `__v`; default ObjectId `_id`; omitted `autoIndex: false` (boot creates the unique pair plus the TTL clock — there is **no** named catalog and **no** `pnpm migration:*` for this collection). There is no persist-helper **adapter**. There is no selected-database **adapter**. There is no Domain Command **seam**. There is no HTTP **seam**. There is no floor-or-increment **seam**.
- Split later (only if the file outgrows one sitting): this ~35-line file is one sitting if you read it as remember the public employee-submit window bags on the default Mongo connection — unique hashed-or-literal key plus floored window, count with min zero, TTL when `expires_at` arrives, unnamed unique and expiry clocks the boot creates, default-connection model only — never floor or increment here, never compare 10 or 250, never store the raw client key, never add a selected-database getter from this rename. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `global.ts` / `client.ts` / `throttle.ts`. Submit stays already-recommended `submitEmployeeBooking.service.ts`. Ceilings stay `src/config/domain/bookingReconciliation.ts`. Already-recommended SMS capacity stays `LeadMessageRateLimit.ts`. Already-recommended Sheets minute budget stays `SheetSyncQuotaBucket.ts`. Already-recommended Owner case stays `BookingLeadReconciliationCase.ts`. Leftover next mutation evidence stays leftover next `EntityChange.ts`.

`PublicSubmissionThrottleBucket` is a Mongoose model name. The owner question is: *Someone is about to book a Job from the public employee form. Hold this window’s global ask count, and this client’s ask count, as two bags on `public_submission_throttle_buckets`. The global bag’s key is the word `global` — not a hash. The client bag’s key is the 64-hex the route already sent — never the raw client key. One pair of key plus floored window cannot have two bags. Stamp how many times we touched the bag. Forget the row when `expires_at` arrives. Boot creates the unnamed clocks. There is no selected-database getter. Do not floor the window. Do not increment. Do not compare 10 or 250. Do not invent a getter so “this matches conversation.” Do not store the plaintext client key so “throttle can skip the header hash.” Do not merge this into the leftover next mutation evidence, the already-recommended SMS capacity bag, or the already-recommended Owner case.*

Who bump / compare / 429 already lives in already-recommended `submitEmployeeBooking.service.ts`. Who own 300 / 10 / 250 already lives in `src/config/domain/bookingReconciliation.ts`. Who require the 64-hex header already lives in already-recommended `v1.routes.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the public employee-submit window bags on the default Mongo connection — unique hashed-or-literal key plus floored window, count with min zero, TTL when `expires_at` arrives, unnamed unique and expiry clocks the boot creates, default-connection model only — never floor or increment here, never compare 10 or 250, never store the raw client key, never add a selected-database getter from this rename” story, not “a throttle CRUD dump,” and not Throttle The Public Form itself:

1. **Hold the public employee-submit window bag** — collection `public_submission_throttle_buckets`, `timestamps: true` (mongoose camelCase `createdAt` / `updatedAt`). **No** `minimize: false`. **No** `toJSON` / `toObject` virtuals. **No** `autoIndex: false`. **No** `versionKey: false` (default `__v`). **No** hooks. **No** `immutable`. Default ObjectId `_id`. Required trimmed string `key_hash`. Required `window_start` Date. Required `count` Number default `0` **with** `min: 0`. Required `expires_at` Date. `PublicSubmissionThrottleBucketDocument` is `InferSchemaType` plus `_id`. This beat does **not** floor `Date.now()`. This beat does **not** `$inc`. This beat does **not** compare 10 or 250.

2. **Remember which key and which floored window this is — and when Mongo may forget it** — unique `{ key_hash, window_start }` is the identity. Global submit writes `key_hash: "global"` after it has already decided the window. Client submit writes the already-trimmed 64-hex header as `key_hash` — this file never SHA-256s, and `createHash` in already-recommended submit hashes the candidate snapshot, not this bag. There is **no** unique `{ key_hash }` without the window. There is **no** unique `kind` discriminator — global and client share the same four columns. `expires_at` is required. Submit `$setOnInsert`s `windowStart + windowSeconds * 2000` (default 600s after a 300s window start). Later bumps in the same window do **not** refresh that clock. Unnamed TTL `{ expires_at: 1 }` `expireAfterSeconds: 0` deletes when that clock arrives. This beat does **not** unique `count`. This beat does **not** store the raw client key.

3. **Stamp the unique pair plus the TTL clock and bind the default-connection model** — `PublicSubmissionThrottleBucketSchema.index({ key_hash: 1, window_start: 1 }, { unique: true })` and `.index({ expires_at: 1 }, { expireAfterSeconds: 0 })`. There is **no** `PUBLIC_SUBMISSION_THROTTLE_INDEXES` catalog. There is **no** collection-name export. There is **no** `createPublicSubmissionThrottleBucket`. Default export `PublicSubmissionThrottleBucket` is `mongoose.models.PublicSubmissionThrottleBucket ?? mongoose.model(...)`. There is **no** `getPublicSubmissionThrottleBucketModel`. Submit asks that default after the route `connectMongo()`. Boot creates both unnamed clocks. This beat does **not** `useDb`. This beat does **not** delete the default export so “everyone must call a getter that does not exist.” This beat does **not** invent a selected-database getter from this rename.

There is no throttle operation. `enforceEmployeeBookingThrottle` elects global-then-client, `$inc`s, then 429s. There is no book / match operation. `submitEmployeeBooking` elects that after this ask. There is no Owner-list operation. Nobody pages these bags.

## Organization

Keep one file. This is the screenplay for “remember the public employee-submit window bags on the default Mongo connection — unique hashed-or-literal key plus floored window, count with min zero, TTL when `expires_at` arrives, unnamed unique and expiry clocks the boot creates, default-connection model only — never floor or increment here, never compare 10 or 250, never store the raw client key, never add a selected-database getter from this rename.” Submit / route header / config ceilings already live in deeper **modules**. Already-recommended SMS capacity / Sheets minute budget / Owner case / outbound SMS row / Form / Call / Booking already live in sibling **modules**. Leftover next mutation evidence already lives in a sibling **module**. Do not pull those in. Do not invent a `PublicSubmissionThrottleBucketService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a selected-database **adapter** beside today’s default export so “this matches conversation” without a paired submit selected-database proof. Do not invent an `autoIndex: false` **adapter** so “boot matches conversation” without a paired migration. Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `global.ts` / `client.ts` / `throttle.ts` each get a file.

Do not move `enforceEmployeeBookingThrottle` into this file so “the bag owns 250.” Do not move `getBookingReconciliationConfig` into this file so “the bag owns 300.” Do not merge this file into already-recommended `LeadMessageRateLimit.ts` so “one schema owns SMS and the public window.” Do not merge this file into already-recommended `SheetSyncQuotaBucket.ts` so “one bag owns Sheets and the employee form.” Do not merge this file into already-recommended `BookingLeadReconciliationCase.ts` so “one bag owns throttle and the case.” Do not merge this file into leftover next `EntityChange.ts` so “one row owns the window and the mutation evidence.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `PublicSubmissionThrottleBucket` | `publicEmployeeSubmitWindowBagOnTheDefaultConnection` | the only runtime upsert — submit asks this default after `connectMongo()` |
| `PublicSubmissionThrottleBucketDocument` | `PublicEmployeeSubmitWindowBag` | inferred row + `_id` |

Keep the old names as one-line aliases until already-recommended submit migrates. Do not make callers learn `expireAfterSeconds` / `key_hash` / `window_start` as the only domain language until that site moves. Do **not** add `getPublicSubmissionThrottleBucketModel` so “this matches conversation” without a paired proof that submit still writes the selected database. Do **not** add `createPublicSubmissionThrottleBucket` so “SMS save matches the bag.” Do **not** re-export `submitEmployeeBooking` / `enforceEmployeeBookingThrottle` / `getBookingReconciliationConfig` from this file so “the bag throttles or owns 250.” Do **not** export a named index catalog that does not exist on disk.

**No class for the workflow.** The one type that *does* earn a name is the public employee-submit window identity contract:

```ts
type PublicEmployeeSubmitWindowBagIdentity = {
  collection: "public_submission_throttle_buckets"
  unique_key_hash_plus_window_start: true
  global_key_is_literal_global: true
  stores_plaintext_client_key: false
  stores_already_hashed_client_header: true
  kind_discriminator: false
  count_min: 0
  increment_then_compare: true
  global_bumped_before_client: true
  missing_client_hash_burns_global_only: true
  http_always_sends_64_hex: true
  expires_at_set_on_insert_only: true
  expires_at_is_window_start_plus_two_windows: true
  ttl: { expires_at: 1, expireAfterSeconds: 0 }
  timestamps: { createdAt: true, updatedAt: true }
  versionKey: true
  object_id: true
  selected_database_getter: false
  save_through_getter: false
  autoIndex: true
  named_index_catalog: false
  boot_creates_clocks: true
  model_test: false
  core_collections_names_this: false
  historical_side_effect: false
  job_timeline_hops_this: false
}
```

That is the handoff from “this process remembered a public employee-submit window bag” to “identity is hashed-or-literal key plus floored window, Mongo forgets the row when `expires_at` arrives, boot creates those clocks, and there is no selected-database getter.” Do **not** add `{ selected_database_getter: true }` so “this matches conversation.” Do **not** add `{ stores_plaintext_client_key: true }` so “throttle can skip the header hash.” Do **not** add `{ count_min: false }` so “this matches SMS.” Do **not** add `{ ttl: { window_start: 1, expireAfterSeconds: 3600 } }` so “this matches Sheets.” Do **not** add `{ autoIndex: false }` so “this matches Form Lead.”

Leave already-recommended `submitEmployeeBooking.service.ts` on that file. Leave already-recommended `LeadMessageRateLimit.ts` on that file. Leave already-recommended `SheetSyncQuotaBucket.ts` on that file. Leave already-recommended `BookingLeadReconciliationCase.ts` on that file. Leave leftover next `EntityChange.ts` on that file. Leave already-recommended `BookedLead.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// PublicSubmissionThrottleBucket.ts
// Someone is about to book a Job from the public employee form.
// Hold this window’s global ask count,
// and this client’s ask count,
// as two bags on public_submission_throttle_buckets.
// The global bag’s key is the word global — not a hash.
// The client bag’s key is the 64-hex the route already sent —
// never the raw client key.
// Forget the row when expires_at arrives.
// Boot creates the unnamed clocks.
// There is no selected-database getter.
// Do not floor the window.
// Do not increment.
// Do not compare 10 or 250.

// ── 1. Hold the public employee-submit window bag ─────────

const PublicSubmissionThrottleBucketSchema = new Schema(
  {
    key_hash: { type: String, required: true, trim: true },
    window_start: { type: Date, required: true },
    count: { type: Number, required: true, default: 0, min: 0 },
    expires_at: { type: Date, required: true },
  },
  {
    collection: "public_submission_throttle_buckets",
    timestamps: true,
  },
)

// ── 2. Remember which key and which floored window
// this is — and when Mongo may forget it

function rememberWhichKeyAndFlooredWindowAndWhenMongoMayForgetIt() {
  // unique { key_hash, window_start }
  // global key_hash is the literal "global"
  // client key_hash is the already-hashed 64-hex header
  // no plaintext client key
  // no kind discriminator
  // expires_at: windowStart + windowSeconds * 2000, $setOnInsert only
}

// ── 3. Stamp the unique pair plus the TTL clock
// and bind the default-connection model

PublicSubmissionThrottleBucketSchema.index(
  { key_hash: 1, window_start: 1 },
  { unique: true },
)
PublicSubmissionThrottleBucketSchema.index(
  { expires_at: 1 },
  { expireAfterSeconds: 0 },
)

export const publicEmployeeSubmitWindowBagOnTheDefaultConnection =
  mongoose.models.PublicSubmissionThrottleBucket ??
  mongoose.model(
    "PublicSubmissionThrottleBucket",
    PublicSubmissionThrottleBucketSchema,
  )

export {
  publicEmployeeSubmitWindowBagOnTheDefaultConnection as PublicSubmissionThrottleBucket,
}
```

Read the primary path out loud: *An employee just posted a Job on the public form. The route already required a secret and a 64-hex `x-public-client-key-hash`, then `connectMongo()`. Submit asks the default model before it prepares the Job. The global bag is the word `global` plus this 300-second floor; `$inc` count, then refuse if the count is past 250. That refusal still burned the increment and never touched the client bag. The client bag is the header hash plus the same floor; `$inc`, then refuse if the count is past 10. A duplicate `submission_id` 200 later still burned both bags. Mongo forgets each bag when its `expires_at` arrives — two windows after the floor, stamped only on insert. Do not floor the window from here. Do not store the raw client key from here. Do not merge this into the leftover next mutation evidence or the already-recommended SMS capacity bag.*

## Precise logic I would tighten while renaming

1. **Capacity increments before the limit check.** Already-recommended `enforceEmployeeBookingThrottle` `$inc`s then compares `count > limit`. A 429 for global 250 or client 10 still burned a count. Already-recommended book-the-employee-Job named the 429. Do not decrement from this rename so “a skip gives the slot back.”

2. **Global is bumped before client.** If global is already over 250, the client bag is never touched. If the client is over 10, global already burned. Do not reorder so “client is first” without a paired submit proof. Do not bump client when global 429s so “every ask writes both bags.”

3. **Throttle runs before duplicate and before the write.** An existing `booking_origin=employee_booking` + `submission_id` is a 200 after both bags already `$inc`d. Do not move the bump after the duplicate find so “a retry is free.” Do not teach submit to skip the bump on `duplicate_submission`.

4. **The global key is the literal word `global`.** The field is named `key_hash`. Do not SHA-256 `"global"` so “every key is hashed” without a paired submit rewrite. Do not rename the column from this pass so “the name matches the literal.”

5. **The client key is the header the route already hashed.** This file never `createHash`s. Submit’s `createHash` is the candidate-snapshot hash for the Owner case, not this bag. Do not persist the raw `x-public-client-key-hash` preimage so “throttle can skip hashing.” Do not import `createHash` into this file so “the bag owns SHA-256.”

6. **A missing `clientKeyHash` burns only global.** The HTTP path always sends 64 hex. Direct `submitEmployeeBooking` callers may omit it. Do not teach the service to 400 on a missing hash so “the bag matches the route” — that 400 already lives on already-recommended `v1.routes.ts`.

7. **`expires_at` is `$setOnInsert` only.** A later bump in the same window keeps the first clock. Default stamp is `windowStart + 2 * windowSeconds`, not `now + 2 * windowSeconds`. A bump at 4:59 in a 300s window still dies at the floor plus 600s. Do not refresh `expires_at` on every `$inc` so “the bag lives two more windows.” Do not switch the stamp to `now + 600s` so “every bag lives ten minutes from now” without a paired submit proof.

8. **TTL is `expireAfterSeconds: 0` on `expires_at`.** Already-recommended Sheets minute budget TTLs `window_start` at 3600 seconds and has **no** `expires_at`. Already-recommended SMS capacity uses this same `expires_at` + `0` shape. Do not switch this TTL to 3600-from-window so “the public form matches Sheets.” Do not drop the TTL so “throttle is durable like the Booking.”

9. **`count` has `min: 0`.** Already-recommended SMS capacity has **no** `min`. Already-recommended Sheets minute budget has **no** `min`. Do not drop `min: 0` so “this matches SMS” without a paired upsert proof.

10. **Unique `{ key_hash, window_start }` can throw on concurrent upsert.** Submit does not retry 11000. Do not add a retry loop from this rename so “races are quiet.” Leave the index on the model.

11. **Default export is the only runtime import.** There is no getter. The route `connectMongo()`s first. Do not add `getPublicSubmissionThrottleBucketModel` so “this matches conversation” without a paired submit selected-database proof. Do not delete the default so “everyone must call a getter that does not exist.”

12. **CamelCase timestamps plus `__v`.** Already-recommended Picker selection uses named `created_at` only and `versionKey: false`. Already-recommended SMS capacity and Owner case use this same camelCase plus `__v`. Do not rename `createdAt` so “throttle matches Picker.” Do not drop `__v` so “this matches the nonce.”

13. **No `createPublicSubmissionThrottleBucket`.** Submit upserts. Already-recommended outbound SMS row has `createLeadMessage`. Do not add a save helper so “the bag matches the text.”

14. **GET options does not bump.** `GET /api/v1/employee-booking-options` is secret-only and never imports this file. Owner desk / rematch / Best Relocation leadless / ordinary admin leadless / Granot Confirm / Form Lead ingest / WordPress receipt / tariff never import this file. Do not teach those paths to `$inc` so “every public write shares the window.”

15. **Core Collections, historical apply, and Job Timeline omit this collection.** `schema-and-crud-inputs.mdc` does **not** name `public_submission_throttle_buckets`. Historical `SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and omits this name. Job Timeline does not hop this name. Do not add this collection to those lists from this rename so “the bag is a side-effect of apply.” Do not teach apply to import this model.

16. **There is no model test.** Config tests parse the three env ints. Route tests assert the path. Do not add a live Mongo throttle test on this file so “the schema owns 250.”

17. **Software-map gap.** HTTP desks never import this file. Admin never lists these bags. Do not invent those lines from this rename.

18. **Leave sibling modules alone.** `enforceEmployeeBookingThrottle` / `submitEmployeeBooking` / leftover next `EntityChange` writes are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the inferred-row type, required trimmed `key_hash`, required `window_start`, `count` default `0` with `min: 0`, required `expires_at`, camelCase timestamps, default `__v`, default ObjectId `_id`, the unnamed unique `{ key_hash, window_start }`, the unnamed TTL `{ expires_at: 1 }` `expireAfterSeconds: 0`, omitted `autoIndex: false`, omitted selected-database getter, and the omitted save helper. There is no model test today. Submit tests do not exist; route tests ask the path, not this export.

I would keep a later focused model file on that interface. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.PublicSubmissionThrottleBucket ?? mongoose.model(...)`
- there is **no** `getPublicSubmissionThrottleBucketModel`
- submit asks the default after the route `connectMongo()` and **before** prepare / duplicate / the write
- global `key_hash` is the literal `"global"`; `$inc` then `count > 250` is 429
- that 429 still burned the increment and did **not** bump the client bag
- client `key_hash` is the already-hashed 64-hex header; plaintext client key is **not** stored
- client 429 still burned global
- a later duplicate `submission_id` 200 still burned both bags
- a caller that omits `clientKeyHash` burns only global
- `expires_at` is `$setOnInsert` `windowStart + 2 * windowSeconds`; later `$inc`s do not refresh it
- HTTP desks ask already-recommended submit / options — **not this export**
- GET options / Owner desk / rematch / Best Relocation leadless / Form Lead ingest do **not** read this collection
- historical apply / verify omit `public_submission_throttle_buckets`
- Job Timeline does **not** hop this collection
- `schema-and-crud-inputs.mdc` does **not** name this collection; this pass does not rewrite that paragraph
- already-recommended `LeadMessageRateLimit` is a different collection; that file is out of this story
- already-recommended `SheetSyncQuotaBucket` is a different collection; that file is out of this story
- already-recommended `BookingLeadReconciliationCase` is a different collection; that file is out of this story
- leftover next `EntityChange` is a different collection; that file is out of this story

I would not test prepare / auto-match / claim / Owner case open, Sheet Sync after commit, the 300 / 10 / 250 config parsers, or the 64-hex header 400 from this file.

Do not add a test per helper (`theGlobalBagIsTheWordGlobal`, `theClientBagIsTheHeaderHash`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `PublicSubmissionThrottleBucketService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `global.ts` / `client.ts` / `throttle.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (already-recommended submit owns that seam; this bump is **before** the write, Sheet Sync finalize is after commit).
- Treating `submitEmployeeBooking` / `enforceEmployeeBookingThrottle` / `getBookingReconciliationConfig` / leftover next `EntityChange` / already-recommended SMS capacity / already-recommended Sheets minute budget / already-recommended Owner case as this story.
- Inventing a selected-database seam that has only conversation’s getter as an adapter.
- Inventing a plaintext-client-key seam that has only throttle as an adapter.
- Silently decrementing on 429, reordering global-before-client, moving the bump after duplicate, hashing `"global"`, storing the raw client key, adding a getter, deleting the default export, flipping `autoIndex: false`, adding a named-index catalog, adding `createPublicSubmissionThrottleBucket`, renaming `createdAt`, dropping `__v`, dropping `count` `min: 0`, switching TTL to 3600-from-`window_start`, rewriting Core Collections, or teaching historical apply to list this collection while recommending a rename.
- Pulling `enforceEmployeeBookingThrottle` or `getBookingReconciliationConfig` into this file.
- Merging this collection into already-recommended `LeadMessageRateLimit`, already-recommended `SheetSyncQuotaBucket`, already-recommended `BookingLeadReconciliationCase`, leftover next `EntityChange`, already-recommended `LeadMessage`, already-recommended Form / Call / Booking, or already-recommended conversation recording.
- Silently reordering throttle-before-write versus Sheet-Sync-after-commit, or `$inc` versus the ceiling check.
- Changing submit to `deleteOne` so “we match the consent hash.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or leftover next `EntityChange.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `EntityChange.ts` while writing this file.
