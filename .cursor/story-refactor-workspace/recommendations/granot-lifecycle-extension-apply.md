# Apply This Owner-Approved Granot Row From The Extension — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 3 of this service — `extensionApply.ts`
- Remaining in this service: `automationApply.ts`, `automationCompatibility.ts`, `normalization.ts`, and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/extensionApply.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/extension-apply.md`. Distinct from receipt insert: `recommendations/granot-lifecycle-capture.md` + `docs/knowledge/granot-lifecycle/capture.md`. Distinct from the webhook queue wake-up: `recommendations/granot-lifecycle-queue-publisher.md`. Distinct from HTTP automation apply: `docs/knowledge/granot-lifecycle/automation-apply.md` + next module `automationApply.ts`. Distinct from claim/drain: `docs/knowledge/granot-lifecycle/drainer.md`. Distinct from Observation normalize / processor / Lead writes: `docs/knowledge/granot-lifecycle/normalization.md`, `processor.md`. Distinct from Follow Up CSV write and Booked Jobs CSV write: `recommendations/enrichment-call-lead-enrichment.md` / `recommendations/reconciliation-booked-call-lead.md`. Distinct from ordinary Form Edit: `PATCH /api/v1/form-leads/:id`. This checkout’s `CONTEXT.md` does not define Granot Observation Receipt / Observation Channel / Synchronization Decision / System of Record — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/extension-granot-apply.routes.ts` (`PATCH /api/v1/form-leads/:id/granot-sync`, `POST /api/v1/call-leads/enrichment/sync`, `POST /api/v1/call-leads/booked-reconciliation/sync`; Owner initiator + Zod + kind filter, then this file; HTTP stays `200 { ok, data }`). Mounted from `v1.routes.ts`. Tests: `extensionApply.test.ts`, `extension-granot-apply.test.ts`. Replica file `extensionApply.replica.test.ts` calls `captureChannelOperationReceipt` only — not this apply. Not callers: `queuePublisher.ts`, `syncCallLeadEnrichment`, `syncBookedCallLeadReconciliation`, `automationApply.ts`, webhook routes, ordinary Form PATCH.
- Seams callers need: after-capture direct claim (never publish) vs webhook after-commit wake-up; processed Decision vs still-working answer; injected `capture` / `claimAndProcess` for tests; PII-safe compatibility result (fixed messages, no payload echo)
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `form-sync.ts` / `enrichment-sync.ts` / `booked-sync.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`applyExtensionGranotItem` is executor mechanics. The owner question is: *the owner just approved this Granot row from the browser extension. Keep it as a browser-extension receipt, try to process it now, and answer the extension with a safe sentence. The extension does not decide identity. If we cannot finish now, say we accepted it — the receipt still stands. Do not wake the webhook queue. Do not write a Lead or a Booking from this file.*

Receipt insert, claim/drain, Observation normalize, source policy, identity, desired-state, processor, Lead create/sync, Booking/Release commands, Follow Up CSV write, Booked Jobs CSV write, and HTTP automation apply already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “an apply CRUD service,” and not capture / drain / CSV sync:

1. **Apply this owner-approved Granot row from the extension** — take a strict apply item (`operation_id`, `operation_kind`, bounded `granot_statement`, optional `expected_target`) plus an Owner `browser_extension` initiator. Keep it through channel capture as `observation_channel: "browser_extension"`, `authentication_method: "extension_session"`, `payload_schema_hint: "extension_granot_apply_item_v1"`. The payload is the whole item, never a `quoted` patch. Then call `claimAndProcessOrPoll` on that `receipt_id` **directly** — no queue publish. Replay (same operation id + hash + kind) reuses the receipt and claims again. If the claim returns `processed`, copy observation / decision / target / effect `changed_paths` (empty while shadow stays on) and map the Decision to a fixed safe sentence. If the Owner named an `expected_target` and the processed Lead is a different Form/Call id, force `outcome: "conflict"` and clear `changed_paths` — never override the stored target. Every other claim shape (`accepted_for_processing`, lost claim, poll miss, processing disabled, `dead_letter`, `skipped`) becomes `processing_state: "accepted_for_processing"` with the same operation id, no `error_code`, and the sentence “Accepted for processing.” This function does not compare the Owner session. It does not Zod-parse. It does not filter `lead_snapshot_apply` vs `booking_action_apply`. It does not write a Lead or a Booking.

There is no second mutate operation. `mapSynchronizationOutcomeMessage` is the fixed-sentence fold for that one answer. Three HTTP URLs are route **adapters**, not three stories in this file.

## Organization

Keep one file. This is the screenplay for “apply this owner-approved Granot row from the extension.” Channel capture, claim/drain, automation translation, and the three HTTP fences already live in deeper **modules**. Do not pull those in. Do not invent an `ExtensionApplyService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is receipt apply plus a compatibility answer, not a Domain Command. Do not invent a Form-shaped found / ambiguous **seam** that has only one real adapter here.

Do not split this ~145-line file into form / enrichment / booked folders. Those are three URLs over one apply. Do not move the safe-message table into `observability.ts` “because messages are events.” Do not move `maybeConflictOutcome` into `identity.ts` “because it mentions a Lead id.” Do not merge this file into `automationApply.ts` so “every channel apply looks the same.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `applyExtensionGranotItem` | `applyThisOwnerApprovedGranotRowFromTheExtension` | three Owner URLs; tests inject capture / claim |
| `mapSynchronizationOutcomeMessage` | `sayWhatHappenedInASafeSentence` | compatibility body; never echo Granot fields |
| `ExtensionGranotApplyResult` | `ExtensionApplyAnswer` | `{ operation_id, receipt_id, processing_state, … }` the route returns as `data` |
| `ApplyExtensionGranotItemInput` | `OwnerApprovedExtensionApply` | item + initiator + headers; routes build this |
| `ExtensionApplyDeps` | `ApplyThisRowDeps` | test **seam**: override capture and claim |

Keep the old names as one-line aliases until the three apply routes migrate. Do not make callers learn `EXTENSION_APPLY_ITEM_SCHEMA_HINT` / `SyncClaimResult` / `changed_paths` as the domain language.

`capture` / `claimAndProcess` on the deps bag stay test **seams**. They are not a second public operation. Default remains `captureChannelOperationReceipt` and `claimAndProcessOrPoll(receiptId)` — **without** the initiator.

**No class for the workflow.** The type that *does* earn a name is the answer the extension will refresh:

```ts
type ExtensionApplyAnswer = {
  operation_id: string
  receipt_id: string
  processing_state: "completed" | "accepted_for_processing"
  observation_id?: string
  decision_id?: string
  outcome?: SynchronizationOutcome
  target?: EntityRef
  changed_paths: string[]
  message: string
}
```

That is the handoff from “we captured and tried to claim” to “the extension can show a safe sentence and refresh the same operation id.” Do **not** add `error_code` so “we match automation,” and do **not** add `quoted` / `patch` so “the old enrichment URL still looks like a Call Lead write.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// extensionApply.ts
// The owner approved this Granot row from the extension.
// Keep it as a browser-extension receipt.
// Try to process that receipt now.
// Answer with a safe sentence.
// The extension does not decide identity.
// This file does not publish the webhook queue.
// This file does not write a Lead or a Booking.
// Replay claims the same receipt again.

// ── 1. Apply this owner-approved Granot row ───────────────

export async function applyThisOwnerApprovedGranotRowFromTheExtension(input, deps?)

async function keepTheApprovedRowAsABrowserExtensionReceipt(input)
  // channel: browser_extension; auth: extension_session; hint v1
async function tryToProcessThatReceiptNow(receipt_id)
  // claimAndProcessOrPoll(receipt_id) — initiator already on the receipt
function translateTheClaimForTheExtension(item, receipt_id, claimed)
function refuseWhenTheLeadIsNotTheOneTheOwnerExpected(expected, actual, outcome)
  // conflict + clear changed_paths; never override the stored target
export function sayWhatHappenedInASafeSentence(outcome)
```

Read the primary path out loud: *The owner clicked apply on a Follow Up row, a Booked Jobs row, or a Form Granot sync. The route already proved Owner session, parsed the item, and refused the wrong kind for that URL. Keep the item as a browser-extension receipt. Try to claim and process that receipt now. If a Decision is already stored, tell the extension it completed — unless the Lead we processed is not the Lead the owner named, in which case say conflict and show no field changes. If we are still working, processing is off, or the receipt is dead-lettered, say we accepted it and keep the same operation id so they can refresh. Never send the Granot body back. Never wake the webhook queue. Never call the CSV Follow Up or Booked Jobs writers.*

That is the operation. `deps.capture` is not a different story. `applyAutomationPlanAction` is not this apply.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The `/sync` URLs are this file, not the CSV writers.** `POST /call-leads/enrichment/sync` is Owner `lead_snapshot_apply`. `POST /call-leads/booked-reconciliation/sync` is Owner `booking_action_apply`. `syncCallLeadEnrichment` and `syncBookedCallLeadReconciliation` remain Granot CSV `--apply`. Route tests only assert those CSV functions still exist — they are not callers. Do not point the URLs back at the CSV writes so the path “matches the name,” and do not delete the CSV helpers so the route table “wins.”

2. **This apply claims; the webhook publishes.** After channel capture, this file calls `claimAndProcessOrPoll`. It never calls `wakeTheDrainForThisWebhookReceipt`. Webhook capture never claims; the route may publish `{ receipt_id }` after commit. Do not publish from here so “every receipt wakes the queue,” and do not move this claim into `capture.ts` so “keep + process is one insert.”

3. **The default claim wrapper drops the initiator.** `ExtensionApplyDeps.claimAndProcess` is typed `(receiptId, initiator)`. The unchecked default is `(receiptId) => claimAndProcessOrPoll(receiptId)`. The real drain **interface** is `(receiptId, DrainerDeps?)` — a second argument that is an initiator would be misread as deps. Knowledge already says the initiator lives on the receipt. Tests inject a two-arg function and assert `origin: "browser_extension"`. Do not start passing the actor into `claimAndProcessOrPoll` so the deps type “wins,” and do not delete the test assertion so “the runtime path never sends it.”

4. **`pending_match` is completed here; automation remaps it.** A processed Decision with `outcome: "pending_match"` stays `processing_state: "completed"` and the sentence “Pending source-scoped match.” `applyAutomationPlanAction` treats stored `pending_match` as non-terminal `accepted_for_processing`. Do not remap here so “every channel looks like automation,” and do not change automation so “every apply looks like the extension.”

5. **`dead_letter` and processing-disabled are accepted, with no `error_code`.** Lost claim, poll miss, `skipped` (`processing_disabled` / `not_found` / `invalid_id`), and `dead_letter` all become `accepted_for_processing`. Automation maps disabled to `accepted_for_processing` + `GRANOT_PROCESSING_DISABLED`, and dead-letter to `technical_failure` + `GRANOT_RECEIPT_DEAD_LETTER`. Do not add `error_code` to this answer so “the extension can retry smarter,” and do not start returning `technical_failure` so the unions match.

6. **Expected-target conflict is a translation, not an override.** `refuseWhenTheLeadIsNotTheOneTheOwnerExpected` only fires when both expected and actual are present and actual is a Form/Call Lead whose model or id differs. The stored `target` stays the actual Lead. `changed_paths` clears. A missing actual, or an actual that is not a Lead, keeps the processor outcome. Route `assertExpectedTarget` already refused URL/body disagreement with `400` before this file ran. Do not write the expected id onto the result so “the owner’s pick wins,” and do not 409 from this file so “conflict looks like capture idempotency.”

7. **`changed_paths` come only from processor effect summaries.** They flatten `effects[].changed_paths` and stay `[]` while shadow is on, and also stay `[]` after an expected-target conflict. Do not invent paths from the Granot statement so “the extension can highlight cells,” and do not treat `already_current` as a reason to skip the flatten — the processor already sent `[]`.

8. **Messages are a closed table.** `sayWhatHappenedInASafeSentence` maps every `SynchronizationOutcome` plus `accepted_for_processing`. Tests lock “Invalid Granot statement” and that `conflict` does not contain `synthetic-ref`. The apply result JSON must not include `Bearer`. Do not interpolate job number, source, or agent so “the owner sees which row,” and do not reuse observability event titles as these sentences.

9. **Replay still claims.** Same operation id + same hash + same kind is `replayed` capture, then `claimAndProcess` again. That is how a refresh reads a later Decision. Automation may return a stored terminal action receipt without recapture. Do not skip the claim on `replayed` so “we already answered,” and do not treat a different hash as replay — that `409` is capture’s fight.

10. **This file does not own Owner, Zod, or kind.** Lowercase UUID v4, batch max 100, unique operation ids, `lead_snapshot_apply` only on enrichment `/sync`, `booking_action_apply` only on booked `/sync`, Form URL id vs `expected_target`, and `403 GRANOT_OWNER_REQUIRED` live on the route. Employee, secret-only, and Admin create no receipt. Do not pull those fences in so “apply is self-contained,” and do not let this file accept a `quoted` patch because ordinary Form Edit still does.

11. **`extensionApply.replica.test.ts` is not this apply.** It proofs concurrent channel-capture uniqueness (`inserted` + `replayed`, or one winner + `409`). It never imports `applyThisOwnerApprovedGranotRowFromTheExtension`. Do not move those cases into this recommendation’s test list as if apply owned the unique index, and do not delete them so “the filename is wrong.”

12. **Leave sibling modules alone.** `keepThisApprovedChannelOperationAsAGranotObservationReceipt` stays in `capture.ts`. `claimAndProcessOrPoll` stays in `drainer.ts`. `applyAutomationPlanAction` stays the next module. `EXTENSION_APPLY_ITEM_SCHEMA_HINT` stays in `applyItem.ts`. `createBrowserExtensionOwnerInitiator` stays in `durableWork/actors.ts`. This file orchestrates capture → claim → safe answer.

13. **Do not treat Follow Up enrichment, Booked Jobs recon, CRM Posting, webhook `202`, or Owner Booking commands as this story.** Those write Leads, Bookings, or wake a queue. This file keeps a receipt and answers the extension. Do not write a whole-folder recommendation for `granotLifecycle`.

## Testing

The **interface** is the test surface: `applyThisOwnerApprovedGranotRowFromTheExtension` (today `applyExtensionGranotItem`). `{ processing_state, outcome, message, changed_paths, operation_id, receipt_id }` is part of that **interface**. `sayWhatHappenedInASafeSentence` stays exported because the compatibility sentence is a second real **adapter**, not a test leak.

Today’s `extensionApply.test.ts` already locks capture-then-claim (`browser_extension` / `extension_session` / payload is the item / no `Bearer` in the result), replay still returns the stored processor result, `accepted_for_processing` keeps the same operation id, expected-target disagreement is `conflict` with cleared paths, and messages never echo payload values. Keep those. Add the gaps that name the operation:

**Apply this owner-approved Granot row from the extension**
- Default (non-injected) claim is `claimAndProcessOrPoll(receipt_id)` only — initiator is not a drain deps bag.
- This file does not call the webhook publisher.
- Processed `pending_match` → `processing_state: "completed"`, sentence “Pending source-scoped match,” not remapped to accepted.
- Claim `skipped` (`processing_disabled` / `not_found` / `invalid_id`) or `dead_letter` → `accepted_for_processing`, no `error_code`.
- Expected-target miss (no actual, or actual not a Form/Call Lead) keeps the processor outcome.
- Capture throw (`409` idempotency / `503`) propagates; this file does not swallow it into accepted.

Do **not** add a test per helper (`keepTheApprovedRowAsABrowserExtensionReceipt`, `refuseWhenTheLeadIsNotTheOneTheOwnerExpected`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Owner `403`, Zod unknown keys, UUID v4, batch-100, kind filters, or URL/`expected_target` `400` here — `extension-granot-apply.test.ts` already locks those and that no path imports the CSV writers. Do not re-test concurrent capture uniqueness — that lives on the replica file and on `capture.ts`. Do not re-test `claimAndProcessOrPoll` lease math, Observation normalize, Follow Up CSV write, Booked Jobs CSV write, or `applyAutomationPlanAction` here. Do not add a test that this file publishes — it must not. Do not add a test that `/enrichment/sync` calls `syncCallLeadEnrichment` — it must not.

## What I would not do

- An `ExtensionApplyService` class with `create` / `update` / `apply`.
- Thirty two-line functions that only wrap `capture()` or `claimAndProcessOrPoll()`.
- Moving this into a CRUD folder, or into `capture.ts` / `drainer.ts` / `automationApply.ts` “for cleanliness.”
- Publishing a webhook wake-up, or waiting on `{ published: true }`.
- Pointing `/enrichment/sync` or `/booked-reconciliation/sync` back at the CSV writers.
- Remapping `pending_match` or `dead_letter` to match automation.
- Passing the Owner initiator into `claimAndProcessOrPoll` as if it were `DrainerDeps`.
- Echoing Granot fields, adding `error_code`, or restoring a `quoted` patch.
- Teaching CRM Posting, ordinary Form Edit, or Owner Booking commands to call this file.
- Writing a whole-folder recommendation for `granotLifecycle`.
