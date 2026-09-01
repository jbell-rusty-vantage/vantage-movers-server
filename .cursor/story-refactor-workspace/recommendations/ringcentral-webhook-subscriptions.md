# Say Which Inbound Telephony Sessions We Want RingCentral To Deliver — The Whole Account, Or Only Numbers That Currently Resolve In The Leftover Registry Snapshot — Then Remember The Subscription They Created: Persist By Subscription Id In The Unsuffixed Mongo Collection, Or Write One Locked Local File If Mongo Is Missing Or The Upsert Failed — Never Talk To RingCentral, Never Capture A Delivery, Never Evaluate, Never Persist A Session, Never Ingest, Never Create A Call Lead — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 6 of this service — `webhook-subscriptions.ts`
- Remaining in this service: `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/webhook-subscriptions.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (never names this file; related-modules table jumps leftover capture → leftover normalize → already-recommended party persist; Debug / local tooling names `pnpm ringcentral:webhook:monitor` and gitignored `scripts/dev_ops/ringcentral/*`, not this **interface**). Distinct from already-recommended keep: [recommendations/ringcentral-webhook-capture.md](ringcentral-webhook-capture.md) (keeps a raw **delivery** on `_test`-suffixed `webhookEvents`; unused `RINGCENTRAL_TELEPHONY_SESSIONS_EVENT_FILTER` is the same path **without** `?direction=Inbound`; this file owns the live inbound filter and never inserts a delivery). Distinct from leftover payload fold: skipped `webhook-event-normalizer.ts` (maps **every** party; this file never reads a payload). Distinct from leftover local-file: skipped `local-webhook-capture.ts` (gitignored JSONL of deliveries; comments name missing `ringcentral-webhook-create-local.ts`; this file writes one locked JSON of **subscription** metadata). Distinct from leftover config: `ringcentral-config.ts` (`webhookFilterMode` `per-number` | `account` from `RINGCENTRAL_WEBHOOK_FILTER_MODE`; this file’s `mode` default is hardcoded `"account"` and **does not ask** leftover config; leftover config also says subscription metadata is **intentionally not** `_test`-suffixed). Distinct from leftover mongo helper: `ringcentral-mongo.ts` (`getRingCentralDb` / `isMongoConfigured` — this file inlines `connectMongo` + `useDb` and reads `MONGO_URI` itself). Distinct from leftover HTTP: `client.ts` (`ringCentralRequest` — this file never POSTs `/subscription`). Distinct from leftover registry snapshot: unvisited `operationsRegistry` `loadRingCentralRouteSnapshot` / `listActiveRingCentralSnapshotNumbers` (per-number **asks** those; account mode never does). Distinct from leftover ingest / leftover Call Log vet / leftover seed / already-recommended party persist / already-recommended collapse / already-recommended session persist. Distinct from Wave B `POST /api/webhooks/ringcentral` (already-recommended keep always; leftover process only when enabled — Wave B never **asks** this file). This checkout’s `CONTEXT.md` does not define Call Qualification / Call Lead Ingestion / Caller Match Key — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **none in this checkout. No file test.** Gitignored `scripts/dev_ops/**` (rules name `scripts/dev_ops/ringcentral/ringcentral-webhook-create.ts`; leftover local-file comments name `ringcentral-webhook-create-local.ts` / `pnpm ringcentral:webhook:create:local`) are the intended **askers** of leftover `buildRingCentralTelephonyEventFilters` then leftover `storeRingCentralWebhookSubscriptionMetadata` after leftover `ringCentralRequest` creates the subscription. `.gitignore` lists `.ringcentral-webhook-subscription.json`. Leftover config comments this file by path. Wave B webhook POST, leftover local-file append, already-recommended keep, leftover normalize, leftover ingest, leftover client, leftover Call Log vet, leftover seed, leftover analytics, leftover provenance — **do not import this file**.
- Seams callers need: account-wide inbound filter vs per-number filters (caller passes `mode`; leftover config owns `webhookFilterMode` but this file does not ask it); fold-the-RingCentral-response vs persist (fold throws without an id; persist **asks** fold then Mongo-or-file); Mongo upsert by `subscriptionId` vs one locked local file (file is the fallback, not a second write); `saved: true, target: "mongo" | "file"` (type also has `"none"` — never returned)
- Split later (only if the file outgrows one sitting): this ~207-line file is one sitting if you read it as say which inbound telephony sessions we want RingCentral to deliver — the whole account, or only numbers that currently resolve in the leftover registry snapshot — then remember the subscription they created: persist by subscription id in the unsuffixed Mongo collection, or write one locked local file if Mongo is missing or the upsert failed; never talk to RingCentral, never capture a delivery, never evaluate, never persist a session, never ingest, never create a Call Lead. If it later splits: `sayWhichInboundTelephonySessionsWeWantDelivered.ts` / `rememberTheSubscriptionRingCentralJustCreated.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `store.ts` / `build.ts`, and never merge leftover client, leftover capture, leftover local-file, leftover config names, leftover mongo helper, leftover ingest, leftover Call Log vet, leftover registry snapshot, or Wave B webhook HTTP into this file

`buildRingCentralTelephonyEventFilters` / `storeRingCentralWebhookSubscriptionMetadata` / `buildRingCentralWebhookSubscriptionMetadata` are executor mechanics. The owner question is: *We are about to ask RingCentral to deliver inbound telephony-sessions notifications. Say which filters we want: one account-wide inbound filter, or one inbound filter per number that currently resolves in the leftover Operations Registry snapshot. After RingCentral creates that subscription, remember it. Fold the response. Refuse if there is no subscription id. Persist by that id in `ringcentral_webhook_subscriptions` — no `_test` suffix, leftover config already said this metadata is safe to share. If Mongo is missing or the upsert failed, write one locked local JSON file and still say we saved. Do not POST the subscription. Do not capture a delivery. Do not evaluate. Do not persist a session. Do not ingest. Do not create a Call Lead.*

Already-recommended keep, leftover normalize, leftover local-file, leftover client, leftover config names, leftover mongo helper, leftover registry snapshot, leftover ingest, leftover Call Log vet, leftover seed, already-recommended party persist, already-recommended collapse, already-recommended session persist, and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “say which inbound telephony sessions we want RingCentral to deliver — the whole account, or only numbers that currently resolve in the leftover registry snapshot — then remember the subscription they created: persist by subscription id in the unsuffixed Mongo collection, or write one locked local file if Mongo is missing or the upsert failed — never talk to RingCentral, never capture a delivery, never evaluate, never persist a session, never ingest, never create a Call Lead” story, not “a subscription CRUD store,” and not leftover client / leftover capture:

1. **Say which inbound telephony sessions we want delivered** — `buildRingCentralTelephonyEventFilters(mode = "account")`. Account → one string: `/restapi/v1.0/account/~/telephony/sessions?direction=Inbound`. Per-number → **asks** leftover `loadRingCentralRouteSnapshot` then leftover `listActiveRingCentralSnapshotNumbers`, then the same inbound path plus `&phoneNumber=` `encodeURIComponent` for each active number. Empty active list → `[]`. This beat does **not** ask leftover `getRingCentralWebhookFilterMode`. This beat does **not** POST to RingCentral. This beat does **not** persist.

2. **Remember the subscription RingCentral just created** — `storeRingCentralWebhookSubscriptionMetadata(raw)`. **Asks** leftover `buildRingCentralWebhookSubscriptionMetadata` (exported fold: require `id`, copy filters / delivery / status / `expiresIn`, compute `expirationTime` from `now + expiresIn` seconds, keep `raw`). `MONGO_URI` set → leftover inline `connectMongo` + `useDb`, unique `{ subscriptionId }`, `$setOnInsert` provider / id / `createdAt`, `$set` the rest. Success → `{ saved: true, target: "mongo" }`. Mongo throw → warn `ringcentral.webhook.subscription_metadata.mongo_failed_falling_back` and fall through. No `MONGO_URI`, or that fall-through → write `.ringcentral-webhook-subscription.json` at `0o600` and return `{ saved: true, target: "file", path: LOCAL_SUBSCRIPTION_METADATA_PATH }`. This beat does **not** call leftover client. This beat does **not** capture a delivery. This beat does **not** return `target: "none"`.

There is no create-subscription operation. There is no renew operation. There is no delete-subscription operation. There is no capture operation. There is no evaluate operation. There is no session persist. There is no ingest. There is no Call Lead write. Leftover `ringCentralRequest` is the HTTP **adapter**. Already-recommended keep is the delivery-audit **adapter**. Leftover `appendLocalRingCentralWebhookEvent` is the local delivery-JSONL **adapter**. Leftover `ingestRingCentralQualifiedCall` is the only promotion gate.

`LOCAL_SUBSCRIPTION_METADATA_PATH` / `RingCentralWebhookSubscriptionMetadata` / `RingCentralSubscriptionStoreResult` sit on the remember path. They are not extra owner operations. Do not invent a dashboard for the unused `status` / `expirationTime` indexes in this rename. Collection name is a private constant, not leftover config, and is **never** `_test`-suffixed.

## Organization

Keep one file as the screenplay for “say which inbound telephony sessions we want RingCentral to deliver — the whole account, or only numbers that currently resolve in the leftover registry snapshot — then remember the subscription they created: persist by subscription id in the unsuffixed Mongo collection, or write one locked local file if Mongo is missing or the upsert failed; never talk to RingCentral, never capture a delivery, never evaluate, never persist a session, never ingest, never create a Call Lead.” Already-recommended keep, leftover normalize, leftover local-file, leftover client, leftover config names, leftover mongo helper, leftover registry snapshot, leftover ingest, leftover Call Log vet, leftover seed, already-recommended party persist, already-recommended collapse, already-recommended session persist, and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `WebhookSubscriptionService` class. Do not invent a begin / complete **seam** — this file’s write is one upsert or one file write, not a command transaction. Do not invent a create-subscription **adapter** beside leftover `ringCentralRequest`. Do not invent a capture **adapter** beside already-recommended keep. Do not invent a filter-mode **adapter** beside leftover `getRingCentralWebhookFilterMode`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `store.ts` / `build.ts`. Those are persistence verbs, not the owner story. Do not move leftover client’s POST into this file so “one file owns subscribe and remember.” Do not move already-recommended keep’s unused telephony-path constant into this file so “one constant owns subscribe and capture.” Do not silently leftover-ingest after persist so “one write owns remember and promote.” Do not silently suffix the collection so “all RingCentral collections match.” Do not silently ask leftover `webhookFilterMode` so “one env owns the mode” without a paired operator-script test.

**External interface** stays small (this is the test surface). Say-which-filters and remember-the-subscription are one story’s subscribe-and-remember, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildRingCentralTelephonyEventFilters` | `sayWhichInboundTelephonySessionsWeWantDelivered` | operator create-script needs the filter list **before** leftover client POSTs |
| `storeRingCentralWebhookSubscriptionMetadata` | `rememberTheSubscriptionRingCentralJustCreated` | same script needs persist **after** leftover client returns |
| `buildRingCentralWebhookSubscriptionMetadata` | `foldTheSubscriptionResponseOrRefuseWithoutAnId` | persist **asks** this; a script may inspect without writing |
| `LOCAL_SUBSCRIPTION_METADATA_PATH` | `theLockedLocalFileWhenMongoCannotHoldTheSubscription` | persist returns this path; `.gitignore` already names it |
| `RingCentralWebhookSubscriptionMetadata` | `RememberedInboundTelephonySubscription` | the row Mongo / the file hold |
| `RingCentralSubscriptionStoreResult` | `WhetherWeRememberedInMongoOrInTheLockedFile` | `{ saved, target, path? }` |

Keep the old names as one-line aliases until the gitignored operator scripts and any later file test migrate. Do not make callers learn `updateOne` / `$setOnInsert` / `0o600` / `SUBSCRIPTIONS_COLLECTION` as the domain language.

**Principle: old exports stay as aliases.** `buildRingCentralTelephonyEventFilters` remains the imported name until the operator create-script migrates. `storeRingCentralWebhookSubscriptionMetadata` remains the imported name until that script’s persist migrates.

**No class for the workflow.** The type that *does* earn a name is the bag persist already returns, plus the filter-mode fork the first export already names:

```ts
type WhetherWeRememberedInMongoOrInTheLockedFile = {
  saved: true
  target: "mongo" | "file"  // "none" is on the type today and is never returned
  path?: string             // only when target is file
}

type WhichInboundTelephonyWeWantDelivered =
  | { mode: "account" }     // one ?direction=Inbound filter
  | { mode: "per-number" }  // leftover snapshot’s currently resolving numbers
```

That is the handoff from “these are the filters we want delivered” to “leftover client may POST; this file then remembers the subscription id.” Do **not** add `deliveryUrl` so “this file can replace leftover client,” do **not** add `rawBody` so “this file can replace already-recommended keep,” and do **not** add `ingestEligible` so “this file can replace leftover ingest.”

Do not add `ringCentralRequest` as a public story **seam** on this file — leftover client already owns that export. Do not add `captureRingCentralWebhookEvent` as a public **seam** — already-recommended keep already owns that. Do not add `getRingCentralWebhookFilterMode` as a public **seam** — leftover config already owns that. Do not export `getSubscriptionsCollection` / `ensureSubscriptionIndexes` / `valueToString` as public **seams** — they exist so the parent reads.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// webhook-subscriptions.ts
// We are about to ask RingCentral to deliver inbound
// telephony-sessions notifications.
// Say which filters we want: the whole account,
// or only numbers that currently resolve in the leftover registry.
// After RingCentral creates that subscription, remember it.
// Persist by subscription id. If Mongo is missing, write one locked file.
// Do not talk to RingCentral. Do not capture a delivery.
// Do not evaluate. Do not persist a session. Do not ingest.

// ── 1. Say which inbound telephony sessions we want delivered ─

export async function sayWhichInboundTelephonySessionsWeWantDelivered(
  mode: "account" | "per-number" = "account",
)

function theAccountWideInboundTelephonyFilter()
async function theInboundFiltersForNumbersThatCurrentlyResolve()  // leftover snapshot
function encodeEachActiveNumberOntoTheInboundFilter(phoneNumber)

// ── 2. Remember the subscription RingCentral just created ─────

export async function rememberTheSubscriptionRingCentralJustCreated(raw)

export function foldTheSubscriptionResponseOrRefuseWithoutAnId(raw)
async function persistBySubscriptionIdInTheUnsuffixedCollection(metadata)
function fallBackToTheLockedLocalFileWhenMongoCannotHold(metadata, error?)
```

Read the primary path out loud: *If the caller asked for the whole account, hand back one inbound telephony-sessions filter. If they asked per-number, load the leftover Operations Registry snapshot, keep only numbers that currently resolve, and hang each encoded number on that same inbound filter. After leftover client creates the subscription, fold the response. Refuse if there is no id. If Mongo is configured, upsert by that id in the unsuffixed collection. If Mongo is missing or that upsert failed, write one locked local JSON file. Say we saved. Do not POST. Do not capture the next delivery. Do not evaluate. Do not persist a session. Do not ingest. Do not create a Call Lead.*

That is the operation. `storeRingCentralWebhookSubscriptionMetadata` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **No in-repo caller.** Gitignored `scripts/dev_ops/ringcentral/` is the intended **ask**. Wave B webhook POST never imports this file. Do not invent a Wave B subscribe route so “subscriptions become HTTP.” Do not delete the exports so “nothing imports them.” Do not move leftover client’s POST in so “runtime finally owns subscribe.”

2. **`mode` defaults to `"account"` and never asks leftover `getRingCentralWebhookFilterMode`.** Leftover config already resolved `RINGCENTRAL_WEBHOOK_FILTER_MODE`. An operator script that forgets to pass leftover config’s mode silently subscribes to the whole account. Do not silently ask leftover config so “one env owns the mode” without a paired operator-script test. Do not delete the argument so “the env is the only **seam**.”

3. **Per-number with an empty leftover snapshot returns `[]`.** Leftover client would POST no filters. Do not silently fall back to the account filter so “we always subscribe to something.” Do not throw so “empty is illegal” without a paired leftover-registry test.

4. **Collection is unsuffixed `ringcentral_webhook_subscriptions`.** Leftover config’s comment already said this metadata is safe to share. Every other RingCentral collection goes through leftover `getRingCentralCollectionName` and gets `_test` unless leftover collection mode turns that suffix off. Do not silently suffix so “all RingCentral collections match” without a paired leftover-config test. Knowledge’s invariant (“RingCentral Mongo collections use `_test` suffix”) is already false for this file — do not “fix” the knowledge in this rename.

5. **`target: "none"` is on the result type and is never returned.** Persist always `saved: true`. Do not start returning `none` so “a third failure path exists” without a paired persist test. Do not drop `saved` so “target is enough.”

6. **Mongo success never writes the local file. File success overwrites one JSON.** A second subscription id is a second Mongo row and a **clobber** of the local file. Do not silently append so “the file matches Mongo” without a paired local-file test. Do not write the file on Mongo success so “both adapters stay warm.”

7. **Fold computes `expirationTime` from `now + expiresIn`.** RingCentral’s own expiration field, if present on `raw`, is kept only inside `raw`. Indexes exist on `status` and `expirationTime`; this file never lists, renews, or expires. Do not silently copy a provider expiration field so “the clock matches RingCentral” without a paired fold test. Do not invent a renew **seam** so “the unused indexes earn a caller.”

8. **This file copies `valueToString` / `valueToNumber`.** Already-recommended keep **asks** leftover normalizer’s helpers. Do not silently import those helpers so “one fold owns strings” in this rename — leftover normalizer is payload fold, not subscription fold.

9. **This file inlines `connectMongo` + `useDb` and reads `MONGO_URI` itself.** Leftover mongo helper already exports `getRingCentralDb` / `isMongoConfigured`. Already-recommended session persist **asks** leftover mongo helper; already-recommended keep still inlines. Do not silently switch helpers so “one mongo **adapter** owns RingCentral” in this rename.

10. **Runtime `createIndex` for `subscriptionId` / `status` / `expirationTime`.** Leftover Call Log state fails closed when its unique key is missing and never creates it. This file creates its own, same as already-recommended keep. Do not silently stop creating so “indexes become a migration” without a paired first-persist test.

11. **File write uses `0o600`. Leftover local-file append does not set a mode.** Do not silently drop the mode so “both local files match.” Do not silently add `0o600` to leftover local-file so “all RingCentral files lock.”

12. **`TELEPHONY_SESSIONS_FILTER` here includes no query. Already-recommended keep’s unused `RINGCENTRAL_TELEPHONY_SESSIONS_EVENT_FILTER` is the same path.** This file is the one that adds `?direction=Inbound`. Do not point already-recommended keep at this constant so “one filter owns subscribe and capture.” Do not delete already-recommended keep’s dead export from this pass — that file is already recommended.

13. **Leave sibling modules alone.** Leftover client, leftover capture, leftover local-file, leftover config names, leftover mongo helper, leftover registry snapshot, leftover ingest, leftover Call Log vet, leftover seed, already-recommended party persist, already-recommended collapse, and already-recommended session persist already live at the right **depth**. This file orchestrates leftover snapshot **asks** only in per-number mode.

## Testing

The **interface** is the test surface: `sayWhichInboundTelephonySessionsWeWantDelivered`, `rememberTheSubscriptionRingCentralJustCreated`.

There is no file test today. Knowledge’s `call-candidate.test.ts` proves leftover normalize + already-recommended evaluate, not this file. Add tests that name the operation. Do not treat leftover client, leftover capture, leftover ingest, or Wave B POST as this file’s proof.

**Say which inbound telephony sessions we want delivered**
- Default / `"account"` → one filter, `?direction=Inbound`, no `phoneNumber`.
- `"per-number"` with two leftover-active numbers → two filters, each inbound + encoded `phoneNumber`.
- `"per-number"` with an empty leftover snapshot → `[]`.
- This beat never **asks** leftover `getRingCentralWebhookFilterMode`.
- This beat never **asks** leftover `ringCentralRequest`.

**Remember the subscription RingCentral just created**
- Response with an id → one unsuffixed row, `{ saved: true, target: "mongo" }`, `$setOnInsert` keeps the first `createdAt`.
- Same id again → still one row, filters / status / `raw` updated.
- No id → throw; no Mongo write; no file write.
- No `MONGO_URI` → `{ saved: true, target: "file" }`, path is `.ringcentral-webhook-subscription.json`, mode `0o600`.
- Mongo throw → same file bag, warn, no throw out of persist.
- Collection name is `ringcentral_webhook_subscriptions` with no `_test` suffix even when leftover collection mode is test.
- This beat never **asks** leftover client. This beat never **asks** already-recommended keep. This beat never returns a Call Lead id. This beat never **asks** leftover ingest.

Do **not** add a test per helper (`theAccountWideInboundTelephonyFilter`, `encodeEachActiveNumberOntoTheInboundFilter`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add leftover client, leftover capture, leftover local-file append, leftover ingest, already-recommended party persist, already-recommended session persist, leftover Call Log vet, or Wave B `ingestSessionLead` as this file’s proof. Gitignored operator scripts stay on those scripts — they **ask** this interface; they do not own the filters or the remembered row.

## What I would not do

- A `WebhookSubscriptionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `store.ts` / `build.ts`) “for cleanliness.”
- Breaking the say-filters-then-leftover-client-POSTs-then-remember **seam**, leftover config’s unsuffixed-collection **seam**, or leftover snapshot’s per-number **seam**.
- Treating leftover `ringCentralRequest`, already-recommended `keepThisRawRingCentralTelephonyDeliveryAsAnAuditRow`, leftover `appendLocalRingCentralWebhookEvent`, leftover `ingestRingCentralQualifiedCall`, or leftover `vetRingCentralCallLogRecord` as this story. Those are different **adapters**.
- Inventing a create-subscription **seam** that has only one **adapter** (this file never POSTs).
- Silently merging leftover client into this file, silently suffixing the collection, silently asking leftover `webhookFilterMode`, silently falling back from empty per-number to account, or silently leftover-ingesting after persist, while recommending a rename.
- Jumping to leftover ingest while this service still has unchecked Wave A modules.
- Writing a whole-folder recommendation for `ringcentral`.
