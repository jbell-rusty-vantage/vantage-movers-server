# Keep This Granot Delivery As An Observation Receipt — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 1 of this service — `capture.ts`
- Remaining in this service: `queuePublisher.ts`, `extensionApply.ts`, `automationApply.ts`, and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/capture.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/capture.md`. Distinct from webhook secret middleware: `src/middleware/requireGranotWebhookSecret.ts`. Distinct from the queue wake-up: `queuePublisher.ts` + `docs/knowledge/granot-lifecycle/drainer.md`. Distinct from Owner extension apply: `docs/knowledge/granot-lifecycle/extension-apply.md`. Distinct from HTTP automation apply: `docs/knowledge/granot-lifecycle/automation-apply.md` + `docs/knowledge/services/granot-http-collector.md`. Distinct from Observation normalize: `docs/knowledge/granot-lifecycle/normalization.md`. Distinct from the processor: `docs/knowledge/granot-lifecycle/processor.md`. Distinct from CRM Posting: `docs/knowledge/services/form-lead.md`. Distinct from Follow Up / Booked Jobs refresh: `recommendations/enrichment-call-lead-enrichment.md` / `recommendations/reconciliation-booked-call-lead.md`. This checkout’s `CONTEXT.md` does not define Granot Observation Receipt / Observation Channel / System of Record — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/granot-webhook.routes.ts` (`captureGranotLifecycleWebhookReceipt` then `publishGranotLifecycleReceiptWakeup`; `202` only after commit). `extensionApply.ts` `applyExtensionGranotItem` (channel capture, then `claimAndProcessOrPoll`; no publish). `automationApply.ts` `applyAutomationPlanAction` (same). Seed/scripts: `scripts/migrations/granot-lifecycle-unit31-seed.ts`, `scripts/granot-lifecycle-unit34/seed-disposable-certification.ts`. Tests: `capture.test.ts`, `granot-webhook.routes.test.ts`, `extensionApply.replica.test.ts`, `automationApply.replica.test.ts`.
- Seams callers need: webhook persist (every delivery is a new receipt; no idempotency) vs channel persist (same channel + operation ID + same hash **and** kind replays; different hash or kind is `409`); the route’s after-commit `{ receipt_id }` wake-up vs channel apply’s direct claim; injected persist/load for tests
- Split later (only if the file outgrows one sitting): keep one file — webhook keep and channel keep are one sitting. Never `webhook.ts` / `channel.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`captureGranotLifecycleWebhookReceipt` / `captureChannelOperationReceipt` / `buildGranotObservationReceiptInsert` are executor mechanics. The owner question is: *Granot just sent a webhook, or the owner approved an extension / HTTP automation apply. Keep that delivery as a credential-redacted Granot Observation Receipt, pending. This file never normalizes, never claims, never writes a Lead or a Booking, and never publishes the queue wake-up.*

Secret compare, queue publish, claim/drain, Observation normalize, source policy, identity, desired-state, processor, and CRM Posting already live in other **modules**. Do not pull those in.

## What this file actually does

One story with two adapters, not “a receipt CRUD service,” and not apply / drain / normalize:

1. **Keep this webhook delivery as a Granot Observation Receipt** — refuse unless auth is proven `body_secret` or `header_secret` (`legacy_unknown` never writes). Keep only five headers (`content-type`, `content-length`, `user-agent`, `x-request-id`, `x-vercel-id`), each value truncated to 1,024 characters. Hash the credential-redacted body (`receiptEvidence`). Insert a complete v2 webhook receipt: `observation_channel: "granot_webhook"`, route-derived `route_event_class`, nested `processing.*` pending at `captured_at`, `provider: "granot"` retained while `source_system` is the v2 authority. No `channel_operation_*`, no `initiator`, no flat `processing_status`. Payload keys are evidence, not a schema. Identical deliveries are **distinct** receipts; `payload_sha256` is diagnostic, never idempotency. This adapter does not publish and does not invoke the processor. The route returns `202` only after this insert commits, then may wake `{ receipt_id }`.

2. **Keep this approved channel operation as a Granot Observation Receipt** — refuse a webhook channel, an unproven auth method, or a mismatched initiator (extension requires `extension_session` + `browser_extension` origin; automation requires `automation_owner_approval` + `vantage_admin` origin). Same header allowlist and credential-redacted hash. Insert with `channel_operation_id` / `channel_operation_kind` / `initiator` / optional schema hint; no `route_event_class`. Unique `{ observation_channel, channel_operation_id }` (partial on string id): first write is `inserted`; duplicate key + same hash **and** same kind is `replayed`; different hash **or** kind is `OperationIdempotencyConflictError` (`409`) and creates no second row; duplicate key with no reload winner, or any non-11000 persist failure, is `CaptureUnavailableError` (`503`). Metrics increment on insert only, not replay. This adapter does not publish. Extension and automation apply then call `claimAndProcessOrPoll` themselves.

There is no third mutate operation. `claimAndProcessOrPoll`, Observation upsert, Decision, Lead create/sync, and Booking/Release cases live in later **modules**.

## Organization

Keep one file. This is the screenplay for “keep this Granot delivery as an Observation Receipt.” Credential redact/hash, webhook secret compare, queue publish, claim/drain, and apply translation already live in deeper **modules**. Do not pull those in. Do not invent a `GranotCaptureService` class. Do not invent a canonical-command `begin` / `complete` **seam** — capture is receipt insert, not a Domain Command. Do not invent a Form-shaped found / ambiguous **seam** that has only one real adapter.

Do not split this ~360-line file into `webhook.ts` and `channel.ts`. The two adapters share the header allowlist and the redacted-hash insert. Do not move the header allowlist into `receiptEvidence.ts` “because redaction already lives there.” Do not move unique-index replay into `drainer.ts` “because that file already claims.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `captureGranotLifecycleWebhookReceipt` | `keepThisWebhookDeliveryAsAGranotObservationReceipt` | three Granot webhook routes + seed scripts |
| `captureChannelOperationReceipt` | `keepThisApprovedChannelOperationAsAGranotObservationReceipt` | Owner extension apply + HTTP automation apply |
| `buildGranotObservationReceiptInsert` | `prepareTheWebhookReceipt` | tests and callers that need the v2 shape without Mongo |
| `buildGranotChannelReceiptInsert` | `prepareTheChannelReceipt` | same for the channel shape; replay compares this hash |
| `allowlistGranotWebhookHeaders` | `keepOnlyTheFiveSafeHeaders` | both adapters; route tests lock the five names |
| `CaptureGranotLifecycleWebhookResult` | `KeptWebhookReceipt` | `{ receipt_id }` the route publishes then returns |
| `CaptureChannelOperationResult` | `KeptChannelReceipt` | `{ status: inserted \| replayed, receipt_id, payload_sha256 }` |

Keep the old names as one-line aliases until the webhook router, `extensionApply`, `automationApply`, and the Unit 31/34 seeds migrate. Do not make callers learn `11000` / `payload_sha256` / `GRANOT_WEBHOOK_STORED_HEADER_ALLOWLIST` as the domain language.

`PersistGranotObservationReceipt` / `PersistGranotChannelReceipt` / `LoadChannelReceiptByOperation` stay test **seams**. They are not a third public operation. Default remains Mongo `create` / `findOne` after `connectMongo`.

**No class for the workflow.** The type that *does* earn a name is the pending insert bag the persist **seam** receives:

```ts
type WebhookReceiptWeAreAboutToKeep = {
  /* today's GranotObservationReceiptInsert — no operation id, no initiator */
}

type ChannelReceiptWeAreAboutToKeep = {
  /* today's GranotChannelReceiptInsert — operation id + initiator, no route class */
}
```

That is the handoff from “we redacted and shaped the evidence” to “Mongo may insert.” Do **not** collapse these into one insert type so “every receipt looks the same,” and do **not** add a `publish` field so “every write looks like Form ingest after-commit.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// capture.ts
// Granot sent a webhook, or the owner approved an apply.
// Keep that delivery as a credential-redacted Observation Receipt, pending.
// Every webhook delivery is a new receipt.
// An approved channel operation with the same id and the same hash is the same receipt.
// This file does not compare the webhook secret.
// This file does not publish the queue wake-up.
// This file does not normalize, claim, or write a Lead.

// ── 1. Keep this webhook delivery ─────────────────────────

export async function keepThisWebhookDeliveryAsAGranotObservationReceipt(input, persist?)

function refuseUnlessWebhookAuthIsProven(method)     // body_secret | header_secret only
function keepOnlyTheFiveSafeHeaders(headers)         // 1,024-char truncate
function redactAndHashTheBody(payload)               // sibling receiptEvidence
function prepareTheWebhookReceipt(input)
async function writeANewPendingWebhookReceipt(prepared)
function countTheKeptWebhookReceipt(routeClass)

// ── 2. Keep this approved channel operation ───────────────

export async function keepThisApprovedChannelOperationAsAGranotObservationReceipt(input, persist?, loadExisting?)

function refuseAWebhookChannelHere(channel)
function refuseUnlessChannelAuthAndInitiatorFit(channel, auth, initiator)
function prepareTheChannelReceipt(input)
async function writeThePendingChannelReceiptOrReplayTheWinner(prepared)
function sameHashAndKindIsTheSameReceipt(existing, prepared)
function differentHashOrKindIsAConflict(existing, prepared) // 409, no second row
function missingWinnerAfterADuplicateKeyIsUnavailable()     // 503
function countTheKeptChannelReceiptOnlyWhenInserted(channel)
```

Read the primary path out loud: *Granot posted lead-created (or priority-updated, or booking-status-changed). The route already proved the secret and stripped it. Keep only the five safe headers. Strip secrets from the body and hash what remains. Write a pending webhook receipt. Every delivery is a new row even when the hash matches yesterday. Return the receipt id. The route may then try to wake the queue; if that fails, the receipt still stands and the answer is still 202. When the owner approves an extension or HTTP automation apply, keep that operation the same way — except the same channel plus operation id plus hash plus kind is a replay, and a different hash or kind is a conflict. Do not normalize. Do not claim. Do not create a Lead here.*

That is the operation. `buildGranotObservationReceiptInsert` is not a different story. `applyExtensionGranotItem` is not this write.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file does not publish.** The webhook route calls `publishGranotLifecycleReceiptWakeup` **after** insert and still returns `202` when publish fails or throws. Channel capture never publishes; apply files enter `claimAndProcessOrPoll` directly. Knowledge already says so. Do not move publish into `keepThisWebhookDeliveryAsAGranotObservationReceipt` so “capture owns the wake-up,” and do not start publishing from channel capture so “every receipt wakes the queue.”

2. **`202` cannot precede commit.** Capture failure creates no row, does not publish, and the route answers `503`. Do not return a receipt id before persist so the route can “answer faster,” and do not publish from a `catch` so “the cron will find it.”

3. **Webhook deliveries are never idempotent.** Two identical posts are two receipts that may share `payload_sha256`. Channel unique-index replay is the other adapter. Do not start reusing a webhook row so “identical Granot retries collapse,” and do not drop channel uniqueness so “every apply is a new receipt.”

4. **`payload_sha256` is diagnostic on the webhook path and the replay key on the channel path.** Same helper, two meanings. Do not teach webhook capture to find-by-hash so the field “means identity,” and do not stop hashing channel payloads so “operation id is enough.”

5. **Proven auth is a write fence, not this file’s secret compare.** Middleware owns timing-safe compare and deletes `x-api-secret` before capture. This file only refuses `legacy_unknown` (and channel mismatches). Do not import `evaluateGranotWebhookAuthentication` so “capture is honest about auth,” and do not accept `legacy_unknown` so leftover compatibility “can write.”

6. **Webhook and channel insert shapes must stay different.** Webhook has `route_event_class` and no initiator. Channel has `channel_operation_*` + `initiator` and no route class. Tests lock the absent keys. Do not add `route_event_class` onto channel rows so “every receipt has an event,” and do not add `initiator` onto webhook rows so “every receipt has an actor.”

7. **Channel duplicate-key with no reload winner is `503`, not `409`.** A unique-index race that cannot load the winner is `CaptureUnavailableError`. Hash/kind mismatch after a successful reload is `OperationIdempotencyConflictError`. Do not map a missing winner to `409` so “every duplicate is a conflict,” and do not swallow non-11000 errors as replay.

8. **Metrics increment after a successful webhook persist, and only on channel `inserted`.** Replay does not bump `receipts_total`. Do not count replays so “every apply looks like a new receipt.”

9. **Payload keys are not validated here.** Unused Granot fields may appear or disappear (`service_type`, `cubic_rate`). Capture stores the redacted Mixed body. Normalization later reads known optional keys. Do not add Zod here so “bad Granot is refused earlier,” and do not drop unknown keys so “the receipt is clean.”

10. **`provider: "granot"` is leftover beside `source_system: "granot"`.** Knowledge already keeps both. Do not delete `provider` so v2 “wins,” and do not start reading `provider` as the channel.

11. **Header allowlist is shared and narrow.** `authorization`, `cookie`, `x-api-secret`, `x-forwarded-for`, and `x-granot-delivery-id` are dropped even before redact. Redact still strips forbidden keys inside the body. Do not store `x-granot-delivery-id` so “we can idempotency the webhook,” and do not widen the allowlist so “debug is easier.”

12. **Leave sibling modules alone.** `hashCredentialRedactedPayload` stays in `receiptEvidence.ts`. `publishGranotLifecycleReceiptWakeup` stays in `queuePublisher.ts` (next module). `applyExtensionGranotItem` / `applyAutomationPlanAction` stay the apply screenplays. `claimAndProcessOrPoll` stays in `drainer.ts`. Secret compare stays in middleware. This file orchestrates allowlist → redact/hash → refuse bad auth → insert or replay.

13. **Do not treat Follow Up enrichment, Booked Jobs recon, CRM Posting, or Owner Booking commands as this story.** Those write Leads or Bookings. Capture inserts a receipt only. Do not write a whole-folder recommendation for `granotLifecycle`.

## Testing

The **interface** is the test surface: `keepThisWebhookDeliveryAsAGranotObservationReceipt` and `keepThisApprovedChannelOperationAsAGranotObservationReceipt` (today `captureGranotLifecycleWebhookReceipt` / `captureChannelOperationReceipt`). The prepared insert shapes and `{ inserted | replayed, receipt_id }` are part of that **interface**.

Today’s `capture.test.ts` already locks v2 webhook shape, header allowlist, redacted hash, distinct identical deliveries, proven-auth refuse, extension insert, same-hash replay, different-hash `409`, automation insert, and different-kind `409`. Keep those. Add the gaps that name the operation:

**Keep this webhook delivery**
- Proven `body_secret` / `header_secret` writes a pending v2 receipt with route class from the **caller**, not payload `event_type`.
- `legacy_unknown` throws before persist; receipts_total stays 0.
- Secrets in headers and body never appear in the stored document or the hash input.
- Two identical deliveries → two receipt ids, same diagnostic hash.
- Persist throw → no receipt id (route test already proves `503` and no publish). This file’s default persist is Mongo `create`; do not re-test the route’s `202` envelope here.

**Keep this approved channel operation**
- Extension + `extension_session` + `browser_extension` initiator inserts; no `route_event_class`.
- Automation + `automation_owner_approval` + `vantage_admin` initiator inserts.
- Webhook channel, wrong auth, or wrong initiator origin throws before persist.
- Same channel + operation id + hash + kind after `11000` → `replayed`; receipts_total does not increment.
- Same id + different hash **or** different kind → `409 GRANOT_OPERATION_IDEMPOTENCY_CONFLICT`.
- `11000` then `loadExisting` returns null → `503 GRANOT_CAPTURE_UNAVAILABLE`.
- Non-11000 persist failure → `503`, not replay.

Do **not** add a test per helper (`keepOnlyTheFiveSafeHeaders` beyond the already-locked five names, `refuseUnlessWebhookAuthIsProven`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test secret compare, queue publish gates (`VERCEL`, `TEST_MODE`), `claimAndProcessOrPoll`, Observation normalize, Follow Up enrichment, Booked Jobs recon, or `applyExtensionGranotItem` here. Do not add a test that channel capture publishes — it must not.

## What I would not do

- A `GranotCaptureService` class with `create` / `insert` / `replay`.
- Thirty two-line functions that only wrap `create()`.
- Moving this into a CRUD folder, or splitting `webhook.ts` / `channel.ts` “for cleanliness.”
- Publishing from this file, or claiming/processing from this file.
- Making webhook capture idempotent by hash, or dropping channel unique-index replay.
- Accepting `legacy_unknown`, storing `x-granot-delivery-id`, or schema-validating Granot payload keys.
- Teaching CRM Posting, Follow Up enrichment, or Booked Jobs recon to write a receipt.
- Writing a whole-folder recommendation for `granotLifecycle`.
