# Remember The Outbound Confirmation SMS, Send It Or Wake The Drain, Then Accept Twilio's Word — operational story

- Status: recommended
- Service: `leadMessaging` (Wave A, in-progress)
- Pass: 1 of this service — `leadMessaging.service.ts`
- Remaining in this service: `granotCreatedLead.ts`, `leadMessagingQueue.service.ts`, `twilioAdapter.ts` (`quietHours.ts` / `messageBuilder.ts` / `twilioVoice.ts` / `index.ts` skipped on open)
- Target: `src/services/leadMessaging/leadMessaging.service.ts`
- Knowledge: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md). Distinct from Form Lead Ingestion remember-then-dispatch (this file is the write and the send; Form Lead forces the transaction and isolates the throw): [recommendations/form-lead.md](form-lead.md). Distinct from Granot create-if-missing six gates / CRM Source template / always-append STOP: later `granotCreatedLead.ts`. Distinct from queue publish gate: later `leadMessagingQueue.service.ts`. Distinct from Twilio REST create / webhook signature: later `twilioAdapter.ts`. Distinct from Eastern midnight–7 / 8:00 AM wall clock: skipped `quietHours.ts`. Distinct from public-form template v2: skipped `messageBuilder.ts`. Distinct from voice forward TwiML (not a Lead Message): skipped `twilioVoice.ts`. Distinct from Analytics `sms-successfully-sent-then-booked` cohort (`SUCCESSFUL_LEAD_MESSAGE_STATUSES` lives in `config/domain/leadMessaging.ts`, not here). Distinct from Operations Registry CRM Source `outbound_sms` writes. Distinct from Sheet Sync outbox / drain. This checkout’s `CONTEXT.md` does not define Lead Message / confirmation SMS / quiet hours — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy.
- Callers: **six runtime import sites plus the barrel and one folder test.** Before-commit: `leads/formLead.service.ts` `createFormLeadInTransaction` calls `persistLeadMessageIntent` inside the Form Lead write (forced transaction when `sms_consent === true` and messaging is allowed). After-commit: `finalizeFormLeadCreateAfterCommit` calls `dispatchOrQueuePersistedLeadMessage` before Sheet Sync finalize and CRM Posting — a throw there must not fail the 201. Sibling `granotCreatedLead.ts` `sendGranotCreatedLeadConfirmation` calls the same persist + dispatch after its six gates (create-if-missing finalize swallows throws). Admin: `routes/v1.routes.ts` `listLeadMessages` / `getLeadMessage` / `requestLeadMessageRetry` (retry is 202). Provider: `routes/twilio-message-status.routes.ts` `applyTwilioStatusCallback` after sibling signature check. Drain: `api/queues/lead-messaging-consumer.ts` and `routes/lead-messaging-cron.routes.ts` both call `runLeadMessagingDrain`. Barrel: `leadMessaging/index.ts`. Test: `leadMessaging.service.test.ts`. Not callers: `updateFormLead` / Form correction, `createLeadFromGranot` (imports the sibling, not this file), voice routes, Analytics (reads the model + config statuses), admin browse of `lead_messages` (reads the model). `buildLeadConfirmationMessage` / `resolveLeadSmsQuietHoursDeferral` / `publishLeadMessagingWakeup` / `createTwilioSender` are sibling exports this file uses; they are not this **interface**.
- Seams callers need: before-commit remember vs after-commit send-or-wake; public-form persist (consent + server copy) vs Granot persist (caller body, no form consent); inline send vs queued wakeup; lease claim vs Twilio create vs persist-accept; quiet hours is Message Scheduling `sendAt`, not a `next_attempt_at` delay; callback never-backward vs SID-mismatch history; owner retry only when there is no Twilio SID vs reconcile when a SID exists; Form Lead Ingestion never fails because messaging threw
- Split later (only if the file outgrows one sitting): `rememberTheOutboundConfirmationSms.ts` / `sendOrWakeTheDrain.ts` / `claimAndSendThroughTwilio.ts` / `drainDueLeadMessages.ts` / `acceptTwilioDeliveryStatus.ts` / `retryAFailedLeadMessage.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `send.ts`, and never merge Granot gates, queue publish, Twilio REST, Eastern clock, template v2, or voice TwiML into this file

`persistLeadMessageIntent` / `dispatchPersistedLeadMessage` are executor mechanics. The owner question is: *The Lead is already being saved. If this person asked for a text (or Granot create-if-missing already passed its own gates), write the confirmation SMS in the same Mongo transaction so we do not lose the promise. After commit, either send it now or wake the drain. Claim the row with a short lease, talk to Twilio (schedule 8:00 AM Eastern when overnight is on), and remember exactly what Twilio said. If the lease dies mid-send, say we are uncertain — do not guess and do not auto-retry. When Twilio later calls back, never walk a status backward. The owner may retry only a failed text that never got a SID. A skipped row is never sent. A failed text must not fail the Form Lead create.*

Granot six-gate evaluation, queue publish, Twilio REST, Eastern clock, public-form copy, and voice already live in other **modules**. Do not pull those in.

## What this file actually does

Six operations, not “a messaging CRUD service,” and not Granot gates / voice / Analytics:

1. **Remember the outbound confirmation SMS** — write a `lead_messages` row in the caller’s session. Public form: no row when `sms_consent` is not boolean `true`, or when `TEST_MODE` blocks; otherwise server-owned template v2 (sibling) and `origin=public_form`. Granot: no form consent check; caller owns the body; `form_lead` only when the Lead is a Form Lead. Duplicate Form Lead / mode `disabled` / destination-country-hourly-cooldown become `status=skipped` with a reason. Skipped rows are never dispatched. Mode `queued` remembers `queued`; otherwise `pending`.

2. **Send it or wake the drain** — after commit. Null → `not_requested`. Skipped → `skipped`. Queued mode publishes a wakeup (sibling) and returns `queued`. Inline claims and sends. If this function throws after Twilio already accepted, re-read the row and return that status when it left the in-flight set. Otherwise return `failed`. Form Lead Ingestion still returns 201.

3. **Claim and send through Twilio** — take `pending` / `queued` / `retry_scheduled` → `sending` with a 60s lease. Mode `disabled` or test-mode block returns `{ status: "disabled" }` without calling Twilio and without rewriting the row. Missing status-callback URL fails closed. Quiet hours stay off unless explicitly enabled; when on and the Eastern hour is before 7, Twilio create still happens now with Message Scheduling `sendAt` = 8:00 AM that Eastern day (sibling clock + 15-minute / 35-day window + Messaging Service SID). Accept → `accepted` (`sent` only if Twilio already says `sent`). Lease miss or persist-of-accept miss → `uncertain`. 429 / `ECONNREFUSED` / `ENOTFOUND` / `EAI_AGAIN` and attempts `< 4` → `retry_scheduled` + wakeup. Timeout / 5xx / `ECONNRESET` → `uncertain`, not auto-retried. Other Twilio errors → `failed`. A later owner-event write cannot flip an accepted outcome.

4. **Drain due messages** — queue / cron / manual. Disabled / test-mode → `{ claimed: 0, outcomes: { disabled: 1 } }`. Expire leftover `sending` leases to `uncertain` (not retry). Then claim up to the drain limit of due `pending` / `queued` / `retry_scheduled` rows and send each through operation 3.

5. **Accept Twilio’s later word** — find by current SID or historic SIDs. SID mismatch: append history, do not change `status`. Unknown incoming status: history only. Known status: advance `provider_status` / `status` only when the current provider status is allowed to move forward. Terminal `delivered` / `read` / `failed` / `undelivered` / `canceled` ignore later callbacks. `scheduled` may advance to queued, sent, or failed.

6. **Owner browse and retry** — list omits `body` / attempts / history. Detail is the full row or 404. Retry accepts only `failed` / `undelivered` with no Twilio SID and `manual_retry_count < 3`, then queues and wakes the drain (202). A SID means reconcile, not retry (409).

There is no seventh mutate operation. Granot gates, voice TwiML, and the Analytics successful-text cohort are other files.

## Organization

Keep one file as the screenplay for “remember the outbound confirmation SMS, send it or wake the drain, then accept Twilio’s word.” Granot gates, queue publish, Twilio REST, Eastern clock, template v2, and voice already live in deeper **modules**. Do not pull those in. Do not invent a `LeadMessagingService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — Form Lead Ingestion already owns the transaction wrap; this file is the remember / send / accept story inside that **seam**. Do not invent a second quiet-hours **adapter** beside `resolveLeadSmsQuietHoursDeferral`. Do not invent a second Twilio **adapter** beside `createTwilioSender`. Do not invent a Granot-gate **adapter** beside later `granotCreatedLead.ts`.

Do not move persist into `formLead.service.ts` so “ingestion owns the text.” Do not move Granot gates here so “one persist owns every skip.” Do not move voice here so “one Twilio folder.” Do not split `create.ts` / `send.ts` / `update.ts`. Do not silently treat quiet hours as a drain delay. Do not silently retry `uncertain`.

**External interface** stays small (this is the test surface). Remember, send-or-wake, claim-and-send, drain, accept-callback, and owner retry are one story’s Lead Messaging, not six CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `persistLeadMessageIntent` | `rememberTheOutboundConfirmationSms` | Form Lead write + Granot sibling persist; two input shapes, one capacity reservation |
| `dispatchOrQueuePersistedLeadMessage` | `sendOrWakeTheDrain` | after-commit; Form Lead Ingestion must not fail |
| `dispatchPersistedLeadMessage` | `claimAndSendThroughTwilio` | inline path + drain + tests inject a sender |
| `queueInitialLeadMessage` | `wakeTheDrainForThisLeadMessage` | queued mode after persist |
| `runLeadMessagingDrain` | `drainDueLeadMessages` | queue consumer + cron |
| `applyTwilioStatusCallback` | `acceptTwilioDeliveryStatus` | status webhook after sibling signature check |
| `requestLeadMessageRetry` | `retryAFailedLeadMessage` | admin 202 |
| `listLeadMessages` | `listLeadMessagesForTheOwner` | admin list; omit body |
| `getLeadMessage` | `showTheLeadMessage` | admin detail |
| `buildLeadMessageTwilioSendInput` | `scheduleTheSendIfEasternNight` | quiet-hours Message Scheduling **seam** for claim-and-send + folder tests |
| `assertTwilioScheduleLeadTime` | `refuseASendAtTwilioWouldReject` | 15-minute / 35-day window |
| `normalizeSmsDestination` | `normalizeTheSmsDestination` | E.164 fold used at persist |
| `reserveLeadMessagingCapacity` | `reserveHourlyAndDestinationCapacity` | persist guard; injectable for tests |
| `classifyLeadMessagingFailure` | `classifyWhetherToRetryOrStayUncertain` | 429 vs timeout vs hard fail |
| `shouldApplyTwilioStatus` | (do not keep as the live **seam**) | exported and tested; the callback does not call it — see Precise logic |

Keep the old names as one-line aliases until Form Lead Ingestion, the Granot sibling, admin routes, the webhook, the consumer, and the cron migrate. Do not make callers learn `LEAD_MESSAGING_LEASE_MS` / `PROVIDER_STATUS_RANK` / `createTwilioSender` as the domain language.

**Principle: old exports stay as aliases.** `persistLeadMessageIntent` and `dispatchOrQueuePersistedLeadMessage` remain the imported names until Form Lead Ingestion points at the story names.

**No class for the workflow.** The type that *does* earn a name is the after-commit handoff Form Lead Ingestion already stores on the create result:

```ts
type LeadMessagingOutcome = {
  message_id: string | null
  status: string
}
```

That is the handoff from “we remembered (or skipped, or never wrote) a Lead Message” to “the Form Lead 201 can say `messaging_status`.” Do **not** add `skipped: true` so “one result owns skip,” do **not** add `body` so “the owner list can show the text,” and do **not** add `job_no` so “the text can take Job Number.”

`PersistFormLeadMessageInput` / `PersistGranotLeadMessageInput` stay the two remember **adapters**. They are not two public operations. The Granot six gates are not this bag.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadMessaging.service.ts
// The Lead is already being saved.
// If this person asked for a text, remember the confirmation SMS
// in the same Mongo write.
// After commit, send it now or wake the drain.
// Claim the row, talk to Twilio, remember exactly what Twilio said.
// If the lease dies mid-send, say uncertain — do not guess.
// When Twilio later calls back, never walk a status backward.
// The owner may retry only a failed text that never got a SID.
// A skipped row is never sent.
// A failed text must not fail the Form Lead create.
// This file does not decide Granot's six gates.
// This file does not write voice TwiML.

// ── 1. Remember the outbound confirmation SMS ─────────────

export async function rememberTheOutboundConfirmationSms(input, dependencies)
export const persistLeadMessageIntent = rememberTheOutboundConfirmationSms

function thisIsAGranotCreateIfMissingText(input)
function refuseWhenTestModeBlocks(input)
function refusePublicFormWithoutConsent(input)
function skipWhenDuplicateOrMessagingDisabled(input, mode)
async function skipWhenTheDestinationIsNotAllowed(destination, session)
function chooseRememberedStatus(skippedReason, mode)
async function writeThePublicFormConfirmation(input, destination, status, skippedReason)
async function writeTheGranotCreateIfMissingConfirmation(input, destination, status, skippedReason)

export function normalizeTheSmsDestination(value)
export async function reserveHourlyAndDestinationCapacity(destination, session)

// ── 2. Send it or wake the drain ──────────────────────────

export async function sendOrWakeTheDrain(message, dependencies)
export const dispatchOrQueuePersistedLeadMessage = sendOrWakeTheDrain

function nothingWasRequested(message)
function thisRowMustNeverSend(message)
async function returnThePersistedStatusIfTwilioAlreadyAccepted(messageId)

// ── 3. Claim and send through Twilio ──────────────────────

export async function claimAndSendThroughTwilio(messageId, sender, dependencies)
export const dispatchPersistedLeadMessage = claimAndSendThroughTwilio

function refuseToTalkToTwilioWhenMessagingIsOff()
async function claimTheLeadMessageForSending(messageId)
export function scheduleTheSendIfEasternNight(input)
export function refuseASendAtTwilioWouldReject(sendAt, now)
async function rememberThatTwilioAcceptedTheMessage(message, result, sendInput)
async function rememberThatTheSendFailed(message, startedAt, error)
export function classifyWhetherToRetryOrStayUncertain(error, attemptCount)

// ── 4. Drain due messages ─────────────────────────────────

export async function drainDueLeadMessages(source)
export const runLeadMessagingDrain = drainDueLeadMessages

async function markExpiredSendingLeasesUncertain()
async function findTheNextDueLeadMessage(now)

export async function wakeTheDrainForThisLeadMessage(messageId)
export const queueInitialLeadMessage = wakeTheDrainForThisLeadMessage

// ── 5. Accept Twilio's later word ─────────────────────────

export async function acceptTwilioDeliveryStatus(input)
export const applyTwilioStatusCallback = acceptTwilioDeliveryStatus

function thisCallbackIsForAnOldSid(message, messageSid)
function thisProviderStatusIsUnknown(incoming)
function thisCallbackWouldWalkTheStatusBackward(current, incoming)

// ── 6. Owner browse and retry ─────────────────────────────

export async function listLeadMessagesForTheOwner(input)
export const listLeadMessages = listLeadMessagesForTheOwner

export async function showTheLeadMessage(id)
export const getLeadMessage = showTheLeadMessage

export async function retryAFailedLeadMessage(id, requestedBy)
export const requestLeadMessageRetry = retryAFailedLeadMessage

function refuseRetryWhenAProviderSidAlreadyExists(message)
function refuseRetryWhenTheManualBudgetIsGone(message)
function refuseRetryFromThisStatus(status)
```

Read the primary path out loud: *The Form Lead is being saved. The person said yes to SMS. Remember the confirmation text in that same write — destination as E.164, server-owned copy, capacity reserved. If it is a Duplicate Lead or messaging is off, remember a skipped row and stop. After commit, send it now (or wake the drain). Claim the row with a short lease. If it is Eastern night and quiet hours are on, still create the Twilio message now, scheduled for 8:00 AM. If Twilio accepts, remember accepted. If the lease is gone, say uncertain. If Twilio 429s, schedule a retry. If the network is ambiguous, stay uncertain and do not guess. When Twilio later says delivered, advance. When Twilio later says failed after delivered, ignore it. A failed text must not fail the Form Lead create.*

That is the operation. `persistLeadMessageIntent` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`shouldApplyTwilioStatus` is not the callback.** Folder tests lock the exported helper. `acceptTwilioDeliveryStatus` rebuilds rank with `allowedCurrent` and never calls the helper. Name the live callback as the **interface**. Do not silently wire the helper so “one rank function wins,” and do not delete the tests until they claim the callback.

2. **Two remember shapes, one capacity reservation.** Public form owns consent and the sibling template. Granot owns the body and skips form consent. Share destination normalize + capacity + mode/skip. Do not pull the six Granot gates here so “one persist owns create-if-missing.” Those gates are later `granotCreatedLead.ts`.

3. **`sendOrWakeTheDrain` can return `failed` while the row is still in-flight.** After a throw it re-reads. If status is still `pending` / `queued` / `sending` / `retry_scheduled`, it returns `failed`. The Form Lead 201 then says failed while drain may still send. Name the containment beat so that lie is visible. Do not silently return the in-flight status so “the 201 becomes honest” in this rename.

4. **Quiet hours is Message Scheduling, not a drain delay.** `scheduleTheSendIfEasternNight` sets `sendAt`. Drain does not look at the Eastern hour. Do not add `next_attempt_at` for overnight so “the cron waits until 8.” Missing Messaging Service SID or an out-of-window `sendAt` fails closed today — keep that.

5. **Disabled at send time does not rewrite the row.** Persist may have written `pending`. Claim-and-send returns `{ status: "disabled" }` and leaves the row. Drain no-ops. Do not silently mark those rows `skipped` so “disabled means skipped.”

6. **Hourly capacity increments before the limit check.** A skip for `hourly_capacity_reached` still burned a count. Name `reserveHourlyAndDestinationCapacity` so that is visible. Do not decrement on skip in this rename.

7. **Owner events always say `entity.type: "form_lead"`.** Granot create-if-missing may text a Call Lead. `messageLeadId` already falls back to `lead_ref`. Do not silently change the entity type so “Call Lead events match the Lead.” Leave the lying type visible until a tested change.

8. **List filters `form_lead` as a raw string.** Admin query already parsed an id. Mongoose may miss ObjectId documents. Do not silently wrap `toObjectId` in this rename. Detail already uses `findById`.

9. **`classifyWhetherToRetryOrStayUncertain` is the live failure story; helper-unit tests already lock it.** Keep those as interface tests for the classification **seam** drain and claim-and-send share. Do not add a second copy on `handleDispatchFailure`.

10. **Leave sibling modules alone.** `buildLeadConfirmationMessage`, `resolveLeadSmsQuietHoursDeferral`, `publishLeadMessagingWakeup`, and `createTwilioSender` are already the right **depth**. This file orchestrates them. Voice TwiML is not a Lead Message.

11. **Do not silently move `SUCCESSFUL_LEAD_MESSAGE_STATUSES` here** so “messaging owns the Analytics cohort.” That set lives in config and is read by Analytics.

12. **Do not silently retry `uncertain`.** Knowledge already says timeout / 5xx / expired lease stay uncertain. Auto-retry is only definite unsent failures under the attempt budget.

## Testing

The **interface** is the test surface: `rememberTheOutboundConfirmationSms`, `sendOrWakeTheDrain`, `claimAndSendThroughTwilio`, `drainDueLeadMessages`, `acceptTwilioDeliveryStatus`, `retryAFailedLeadMessage`, plus the quiet-hours send input and the failure classification.

Today’s `leadMessaging.service.test.ts` already names consent, duplicate/disabled/test persist, Granot persist without form consent, destination skip, quiet-hours off-by-default / 8:00 AM / missing SID / schedule window, E.164, dispatch kill switches, 429 vs timeout vs budget, exported rank helper, and after-commit containment. That is a strong start and still not the whole story. Replace helper-only rank tests with callback tests. Do not add a test per helper.

**Remember**
- Public form without boolean `true` consent writes no row.
- Duplicate Form Lead writes `skipped` / `duplicate_lead` and is never dispatched.
- Mode `disabled` writes `skipped` / `messaging_disabled`.
- `TEST_MODE` without the escape hatch writes no row.
- Country / invalid destination / hourly / cooldown persist as `skipped` with that reason.
- Granot persist does not require form consent, reserves capacity once, sets `form_lead` only for Form Leads, and stores `lead_ref`.
- Public-form body is sibling template v2, not caller text.

**Send or wake**
- Null → `not_requested`. Skipped → `skipped`, no Twilio.
- Inline sends. Queued wakes the drain and returns `queued`.
- Throw after Twilio accepted → return `accepted` (or the persisted non-in-flight status), not `failed`.
- Throw with no persisted accept → today’s `failed` containment (do not change the 201 contract here).

**Claim and send**
- Disabled / test-mode → `{ status: "disabled" }`, sender not called, row not rewritten.
- Claim `pending` / `queued` / `retry_scheduled` only.
- Quiet hours off → no `sendAt`. Quiet hours on before 7 Eastern → Twilio create now with `sendAt` 8:00 AM that day and a Messaging Service SID.
- Missing SID or out-of-window `sendAt` fails closed.
- Accept persist miss / expired lease → `uncertain`.
- 429 under budget → `retry_scheduled` + wakeup. Timeout / 5xx → `uncertain`. Other errors → `failed`.
- Owner-event throw after accept cannot flip the returned status.

**Drain / callback / retry**
- Drain marks expired `sending` leases `uncertain`, then sends due rows only.
- Callback SID mismatch records history and does not change `status`.
- Terminal provider status ignores a later callback.
- `scheduled` may advance to queued, sent, or failed.
- Retry: `failed` / `undelivered`, no SID, under 3 → `queued` + wakeup. SID present → 409 reconcile. Wrong status or budget → 409.
- Owner list omits `body`.

**Not this interface**
- Granot six gates / STOP append / `already_sent` stay on later `granotCreatedLead.ts`.
- Queue publish env gate stays on later `leadMessagingQueue.service.ts`.
- Webhook signature stays on later `twilioAdapter.ts`.
- Voice forward / hangup stay on skipped `twilioVoice.ts`.
- Analytics successful-text cohort stays on config + Analytics.
- Form Lead Ingestion force-transaction / 201 isolation stays on [recommendations/form-lead.md](form-lead.md).

Do **not** add a test per helper (`refusePublicFormWithoutConsent`, `thisCallbackIsForAnOldSid`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`claimAndSendThroughTwilio` stays exported because drain and the injected-sender tests are a second real **adapter**, not a test leak.

## What I would not do

- A `LeadMessagingService` class with `create` / `update` / `delete` / `send`.
- Thirty two-line functions that only wrap `createLeadMessage` or `recordOperationalEvent`.
- Moving this into a CRUD folder (`create.ts` / `send.ts` / `update.ts` / `delete.ts`) for cleanliness.
- Breaking the before-commit / after-commit **seam**. Persist stays inside the Form Lead write. Twilio stays after commit.
- Treating Granot `sendGranotCreatedLeadConfirmation`, voice TwiML, Sheet Sync drain, or Analytics cohort as this story.
- Inventing a quiet-hours drain **seam** that has only one **adapter** (Message Scheduling already owns overnight).
- Inventing a second Twilio sender **seam** besides `createTwilioSender`.
- Silently “fixing” `uncertain` into auto-retry, or quiet hours into `next_attempt_at`, while recommending a rename.
- Jumping to `sheetSync` while `granotCreatedLead.ts` is unchecked.
- Writing a whole-folder recommendation for `leadMessaging`.
- Teaching this file the six Granot gates, STOP append, or CRM Source template.
- Returning the SMS body on the owner list.
- Failing Form Lead create because Twilio threw.
