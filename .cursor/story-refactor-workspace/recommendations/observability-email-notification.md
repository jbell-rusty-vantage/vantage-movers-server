# Hand SendGrid This Email, Or Only Log It, And Keep One Delivery Row — operational story

- Status: recommended
- Service: `observability` (Wave A, in-progress)
- Pass: 2 of this service — `emailNotification.service.ts`
- Remaining in this service: `notificationPolicy.ts`, `operationalIncident.service.ts`, `adminObservability.service.ts`, `operationalReports.service.ts`, `notificationDigest.service.ts`
- Target: `src/services/observability/emailNotification.service.ts`
- Knowledge: none (`docs/knowledge/services/` has no Observability Service). Software map: [`.cursor/rules/observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) (best-effort; never break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron; public import is the folder barrel; models via `getObservabilityModel()` / leftover `getNotificationDeliveryModel()`; env policy in `src/config/domain/observability.ts`; **in-place retry** on the original `NotificationDelivery`; only leftover policy may advance Incident throttle after this file returns `ok: true`; rollups are deferred). Distinct from already-recommended write-this-happening-down: [`observability-record-operational-event.md`](observability-record-operational-event.md) (that file **asks** later policy, then writes `notification.email.failed` when this send fails and is not leftover-skipped — this file never records an Operational Event). Distinct from later immediate email policy: `notificationPolicy.ts` (`dispatchEventNotifications` **asks** this with leftover `purpose: "immediate_alert"`; leftover throttle / leftover owner-vs-developer / leftover `notification.*` loop fence stay there). Distinct from later daily digest + failed-row picker: `notificationDigest.service.ts` (**asks** this for leftover `purpose: "daily_digest"`, then **asks** leftover `retryNotificationDeliveryInPlace` for recently-failed rows). Distinct from later Incident upsert: `operationalIncident.service.ts`. Distinct from later Admin Dashboard desk / leftover `listNotificationDeliveries` / leftover home `sent_today`: `adminObservability.service.ts`. Distinct from later operational reports: `operationalReports.service.ts` (leftover purpose `weekly_report` exists in config; this file does not send it). Distinct from leftover Wave B digest cron: `src/routes/notification-cron.routes.ts` (thin; **asks** later digest, not this file). Distinct from leftover SendGrid env / leftover `EMAIL_NOTIFICATIONS_MODE` (default leftover `log_only`): `src/config/domain/observability.ts`. Distinct from leftover `NotificationDelivery` schema: `src/models/NotificationDelivery.ts` (`body_text` kept so a retry can resend the full letter; leftover `body_text_preview` is the 500-char audit clip). Distinct from already-recommended Twilio SMS: [`lead-messaging-twilio-adapter.md`](lead-messaging-twilio-adapter.md) (Lead Message, not owner email). Distinct from already-recommended Granot Section 33 catalog: [`granot-lifecycle-observability.md`](granot-lifecycle-observability.md) (that catalog **asks** leftover record, not this file). This checkout’s `CONTEXT.md` names “Workflow Observational” in the intro and does not define Notification Delivery / owner email — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an Observability Service file in this rename.
- Callers: later `notificationPolicy.ts` (`sendNotification` by path, leftover `SendNotificationResult`). Later `notificationDigest.service.ts` (`sendNotification` + `retryNotificationDeliveryInPlace` by path). Folder barrel `observability/index.ts` re-exports **only** `sendNotification` — leftover retry stays path-only. No domain / Wave B file imports this send. Wave B `notification-cron.routes.ts` **asks** later digest, not this **interface**. Later Admin desk **reads** leftover deliveries; it does not send. Tests: **no** `emailNotification.service.test.ts`. Leftover `src/config/domain/observability.test.ts` covers leftover mode default `log_only` and leftover `EMAIL_NOTIFICATIONS_MODE=disabled` → leftover `isEmailNotificationsEnabled()` false — not that this file wrote a row, called SendGrid, or retried in place. Later digest / Admin / record tests do not prove this send.
- Seams callers need: first try (`sendNotification`: leftover disabled / leftover no-recipients / leftover no-from skip **without** a row; otherwise write one leftover `sending` row, leftover `log_only` marks leftover `sent` with no provider call, leftover `sandbox` / leftover `live` call SendGrid) vs in-place retry (`retryNotificationDeliveryInPlace`: same leftover `_id`, leftover `$inc attempt_count`, never a second row). Never throw. Never write an Operational Event (the caller does that). There is no begin / complete **seam**. There is no Domain Command **seam**. There is no Incident-throttle **seam** (later policy only advances after `ok: true`). There is no Twilio **seam**.
- Split later (only if the file outgrows one sitting): this ~430-line file is one sitting if you read it as hand SendGrid this email, or only log it, and keep one delivery row — skip without a row when email is off, write one row when we try, leftover `log_only` never calls the provider, a failure stays on that row with leftover `next_attempt_at`, a retry bumps the same row. Do **not** split first-try / retry / SendGrid into `create.ts` / `update.ts` / `send.ts`. Do **not** pull later policy / digest / Incident / Admin desk here so “email owns the company.” If it later splits: `deliverThisOperationalEmail.ts` / `retryThisFailedEmailOnTheSameRow.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `send.ts`

`sendNotification` / `retryNotificationDeliveryInPlace` / `sendViaSendgrid` are executor mechanics. The owner question is: *Something just happened, or the morning digest is due. Try to email the owner or a developer. Write down that we tried — one row. If email is off, do not write a row. If we are only logging, mark that row sent and do not call SendGrid. If we are live or sandbox, call SendGrid. If SendGrid fails, keep this same row failed and say when to try again. When the digest cron asks us to retry, do not make a second row — bump the attempt on this one. Never throw. Never write an Operational Event — the caller does that so we do not email about the email.*

Later immediate email policy, later digest picker, later Incident upsert, later Admin desk, leftover env flags, leftover delivery schema, leftover write-this-happening-down, and already-recommended Twilio SMS already live in other **modules**. Do not pull those in.

## What this file actually does

Two adapters of one “hand SendGrid this email, or only log it, and keep one delivery row” story, not “an email CRUD service,” and not the policy or the digest picker:

1. **Deliver this operational email** — `sendNotification`. Leftover `EMAIL_NOTIFICATIONS_ENABLED=false` or leftover mode `disabled`: return leftover-skipped `email_disabled`, leftover status `cancelled`, **no** row. Trim leftover `to`; empty list: leftover-warn `no_recipients`, leftover-skipped, **no** row. Leftover `SENDGRID_FROM_EMAIL` missing: leftover-warn `no_from_email`, leftover-skipped, **no** row. Otherwise leftover `connectMongo`, create one leftover `notification_deliveries` row (`channel: "email"`, leftover `provider` from leftover `getEmailProvider()` default leftover `sendgrid`, leftover `status: "sending"`, leftover `attempt_count: 1`, leftover 500-char preview). Leftover mode `log_only`: mark leftover `sent`, leftover-info the subject / leftover preview, return `ok: true` — **no** SendGrid. Leftover `sandbox` / leftover `live`: leftover `sendViaSendgrid` (leftover missing API key marks leftover `failed` + leftover `next_attempt_at`; leftover `sgMail.send` with leftover `mailSettings.sandboxMode`; leftover `x-message-id` when present; leftover success leftover `sent`; leftover SendGrid throw leftover `failed` + leftover backoff). Outer catch: leftover-error `delivery_persistence_failed`, return leftover `failed`, never throw.

2. **Retry this failed email on the same row** — `retryNotificationDeliveryInPlace`. Leftover disabled: leftover-skipped, leftover status `cancelled`, leftover `attemptCount: 0`, **do not** rewrite the row. Missing leftover `_id`: leftover-skipped `delivery_not_found`. Empty leftover `to`: leftover-cancel the row (`No recipients configured`). Otherwise leftover `$inc attempt_count`, leftover status `sending`, leftover `body_text` falls back to leftover preview if the full letter is gone. Leftover `log_only`: mark leftover `sent` with leftover `provider_response.retry: true`. Otherwise the same leftover SendGrid beat, spreading leftover `attemptCount` onto the result. **No** second row. **No** leftover `connectMongo` (later digest already connected).

There is no third owner operation. Leftover `ensureSendgridKey` / leftover `bodyPreview` / leftover `nextAttemptAt` (`min(60, 5 * 2^(attempt-1))` minutes) are leftover beats, not public **seams**. Do not export leftover `sendViaSendgrid` as a public **seam**. Do not export later `dispatchEventNotifications` from this file as if this story owned the policy. Do not export later `retryFailedNotifications` from this file as if this story owned the picker.

## Organization

Keep one file. This is the screenplay for “hand SendGrid this email, or only log it, and keep one delivery row.” Immediate policy, digest picker, Incident upsert, Admin desk, leftover env flags, leftover delivery schema, leftover write-this-happening-down, and Twilio SMS already live in deeper **modules**. Do not pull those in. Do not invent an `EmailNotificationService` class. Do not invent a begin / complete **seam** — this is after-the-fact best-effort, not a Domain Command. Do not invent a second SendGrid **adapter** beside leftover `sendViaSendgrid`. Do not invent a second retry **adapter** that inserts a child row.

Do not split first-try vs retry vs SendGrid into CRUD files. Do not move SendGrid into later `notificationPolicy.ts` so “policy owns the provider.” Do not move leftover `log_only` into leftover `logger.ts` so “one log folder.” Do not record `notification.email.failed` here so “the adapter owns the loop fence” — that re-record lives on already-recommended leftover record so this file stays free of an import cycle.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `sendNotification` | `deliverThisOperationalEmail` | later policy (immediate) + later digest (morning summary); never throws |
| `retryNotificationDeliveryInPlace` | `retryThisFailedEmailOnTheSameRow` | later digest cron; same leftover `_id`; never a second row |
| `SendNotificationInput` | `EmailWeAreAboutToTry` | leftover purpose / leftover `to` / leftover subject / leftover body / leftover event / leftover Incident / leftover report-run |
| `SendNotificationResult` | `HowTheEmailAttemptEnded` | leftover `ok` / leftover-skipped / leftover `deliveryId` / leftover status — policy throttles only on `ok: true`; leftover record writes a second happening only when failed and not leftover-skipped |
| `RetryNotificationResult` | `HowTheInPlaceRetryEnded` | same result plus leftover `attemptCount` |

Keep the old names as one-line aliases until later policy, later digest, and the folder barrel migrate. Do not make callers learn leftover `EMAIL_NOTIFICATIONS_MODE` / leftover `sendViaSendgrid` / leftover `x-message-id` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the attempt outcome this file already exports:

```ts
type HowTheEmailAttemptEnded = {
  /* today's SendNotificationResult — ok, skipped, reason, deliveryId, status, errorMessage */
}
```

That is the handoff from “we tried (or we refused to try)” to “later policy may throttle, leftover record may write `notification.email.failed`, later digest may count leftover `sent`.” Do **not** add a `persist: boolean` field so “every caller looks like a command,” and do **not** collapse leftover retry into this type so “every send looks like the first try.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// emailNotification.service.ts
// Try to email the owner or a developer.
// Write down that we tried — one row.
// If email is off, do not write a row.
// If we are only logging, mark that row sent and do not call SendGrid.
// If we are live or sandbox, call SendGrid.
// If SendGrid fails, keep this same row failed and say when to try again.
// When the digest asks us to retry, bump this row. Never a second row.
// Never throw.
// Never write an Operational Event — the caller does that
// so we do not email about the email.

// ── 1. Deliver this operational email ─────────────────────

export async function deliverThisOperationalEmail(email)
export const sendNotification = deliverThisOperationalEmail

function emailIsOff()                                 // leftover enabled + leftover mode disabled
function thereIsNoOneToEmail(recipients)              // leftover trim; empty → no row
function weHaveNoFromAddress()                        // leftover SENDGRID_FROM_EMAIL
async function writeTheSendingRow(email, recipients)  // leftover attempt_count 1
async function onlyLogItAndMarkSent(delivery, email)  // leftover log_only; no provider
async function handSendGridThisEmail(delivery, email, sandbox)
function rememberTheSendgridKeyOnce(apiKey)
function clipTheBodyForAudit(body)                    // leftover 500 chars
function whenToTryThisRowAgain(attemptCount)          // leftover 5, 10, 20, 40, then 60 minutes

export type EmailWeAreAboutToTry = { /* today's SendNotificationInput */ }
export type HowTheEmailAttemptEnded = { /* today's SendNotificationResult */ }

// ── 2. Retry this failed email on the same row ────────────

export async function retryThisFailedEmailOnTheSameRow(deliveryId)
export const retryNotificationDeliveryInPlace = retryThisFailedEmailOnTheSameRow

async function loadTheSameDeliveryRow(deliveryId)
async function cancelTheRowWhenNobodyIsLeft(delivery)
async function bumpTheAttemptOnThisRow(delivery)      // leftover $inc; leftover body or leftover preview
async function onlyLogTheRetryAndMarkSent(delivery)

export type HowTheInPlaceRetryEnded = HowTheEmailAttemptEnded & { attemptCount: number }
```

Read the primary path out loud: *Later policy decided the owner should hear about a leftover `booking.created`. Ask this file to deliver leftover purpose `immediate_alert`. Email is on. There are leftover `to` addresses and a leftover from. Write one leftover `sending` row. Today leftover mode is `log_only`, so mark that row leftover `sent`, leftover-info the subject, and do not call SendGrid. Return `ok: true`. Later policy advances leftover `next_notify_at` because this was ok. Already-recommended leftover record does not write `notification.email.failed` because this was not a failure. If leftover mode had been `live` and SendGrid had thrown, this same row would be leftover `failed` with leftover `next_attempt_at` in five minutes, `ok: false`, and leftover record would write a second happening that must not email. Tomorrow leftover digest may pick that failed row and ask leftover retry — leftover `$inc attempt_count` on **this** `_id`, never a second row. If Mongo throws while writing the first row, leftover-error and return leftover `failed`. Never throw. The Booking is already saved.*

That is the operation. `sendViaSendgrid` is the leftover provider beat, not a second live path. `dispatchEventNotifications` is not this send.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Never throw is the product.** The rule and the comment say notification paths must not break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron. Later policy and later digest already `await` this and read leftover `ok` / leftover-skipped. Do not start throwing so “the caller can retry,” and do not `await` this inside a Domain Command transaction so “the email commits with the Booking.”

2. **Never write an Operational Event here.** The comment says the caller decides. Already-recommended leftover record owns the leftover `notification.email.failed` re-record so later policy stays free of an import cycle and leftover `category: "notification"` cannot loop. Do not call leftover `writeThisHappeningDown` from this file so “the adapter owns the failure event,” and do not skip that leftover re-record when leftover `dispatchResult.skipped` is true — leftover record already distinguishes leftover-skipped vs leftover failed.

3. **In-place retry is the product.** The rule: update the original leftover `NotificationDelivery` with leftover `attempt_count` / leftover `last_attempt_at` / leftover `next_attempt_at`; do not create retry fan-out rows; do not mark the original leftover failed attempt as a separate leftover sent metric. Later digest leftover `MAX_RETRY_ATTEMPTS` is 3 and leftover batch is 25 — those stay on the picker. Do not `Delivery.create` on retry so “each attempt is searchable,” and do not insert a leftover child `dedupe_key` so “metrics can sum attempts.”

4. **Leftover skip does not write a row.** Leftover disabled / leftover no-recipients / leftover no-from return leftover status `cancelled` **without** a leftover `NotificationDelivery`. Later Admin leftover `sent_today` / leftover `failed_today` will not show those refusals. Do not start inserting leftover `cancelled` rows so “the desk can audit skips,” and do not treat leftover-skipped as leftover `ok: true` so “policy throttles a send that never happened.”

5. **Leftover `log_only` is leftover `sent` and leftover `ok: true`.** Default leftover `EMAIL_NOTIFICATIONS_MODE` is leftover `log_only` so the pipeline can be verified before leftover live mail. Later policy therefore advances leftover Incident throttle. Later Admin leftover `sent_today` counts these. Do not return leftover `ok: false` on leftover `log_only` so “throttle only after a real inbox,” and do not skip the leftover row so “log_only is just pino” — the leftover delivery is how leftover digest / leftover desk prove the pipeline.

6. **Leftover `getEmailProvider()` is stored; leftover SendGrid is the only talk.** Leftover `EMAIL_PROVIDER` may say leftover `resend` / leftover `ses` / leftover `mailgun`; leftover `sendViaSendgrid` still calls `@sendgrid/mail`. Do not add those providers in this rename so “the field is honest,” and do not drop leftover `provider` so “we only have SendGrid.”

7. **Leftover `connectMongo` runs on the first try, not on leftover retry.** Later digest already connected before leftover `find({ status: "failed" })`. Later policy runs after leftover record already connected. Do not add leftover `connectMongo` to leftover retry so “retry is standalone,” and do not remove it from leftover send so “the caller always connected” — a future barrel caller might not have.

8. **Leftover backoff lives on the failed row.** Leftover `nextAttemptAt(1)` is five minutes, then 10 / 20 / 40 / cap 60. First leftover create stamps leftover `attempt_count: 1` **before** leftover SendGrid, so the first leftover fail already uses leftover attempt 1. Leftover retry leftover `$inc`s first, then leftover SendGrid uses the bumped leftover `delivery.attempt_count`. Do not reset leftover `attempt_count` to 0 on leftover success so “the next fail looks new,” and do not compute leftover backoff from leftover digest’s leftover `MAX_RETRY_ATTEMPTS` so “the adapter owns the picker cap.”

9. **Leftover retry may resend leftover preview when leftover `body_text` is gone.** The model keeps leftover `body_text` so a retry can resend the full letter. Leftover `body_text ?? body_text_preview` is the leftover fence. Do not drop leftover `body_text` after leftover `sent` so “Mongo stays small,” and do not invent a second leftover body collection so “preview and letter split.”

10. **Leftover purpose `weekly_report` / leftover `test` are config only.** Later digest sends leftover `daily_digest`. Later policy sends leftover `immediate_alert`. This file stores leftover purpose and does not choose recipients. Do not send leftover `weekly_report` from later `operationalReports.service.ts` in this pass, and do not refuse unknown leftover purpose so “the adapter owns the catalog” — leftover enum already lives in leftover config.

11. **The barrel exports leftover send, not leftover retry.** Later policy / later digest import by path. No domain file should learn leftover `sendNotification` from leftover `observability/index.ts`. Do not add leftover `retryNotificationDeliveryInPlace` to the barrel so “anyone can retry,” and do not call leftover send from leftover `httpLogger` so “5xx emails skip policy.”

12. **Leave sibling modules alone.** Later `dispatchEventNotifications` (leftover posture / leftover throttle / leftover subject), later `retryFailedNotifications` (leftover 24h / leftover 3 attempts / leftover 25), later `upsertIncidentForEvent`, leftover `writeThisHappeningDown`, leftover `getSendgridConfig` are already the right **depth**. This file orchestrates leftover row + leftover SendGrid.

13. **Do not silently add rollups.** The rule says rollups are deferred. Leftover home cards count leftover deliveries. Do not write a leftover metrics row from this file so “sent_today is cheap.”

14. **Do not treat Twilio as this story.** Already-recommended leftover `handTwilioTheSms` is a Lead Message. This file is owner / developer email. Do not share leftover `ensureSendgridKey` with leftover Twilio so “one provider folder.”

## Testing

The **interface** is the test surface: `deliverThisOperationalEmail`, `retryThisFailedEmailOnTheSameRow`.

Today there is no `emailNotification.service.test.ts`. Leftover flag tests next door only prove leftover mode defaults. That is not enough for a story this load-bearing.

Add tests that name the operation. They will need a replica / injected leftover Delivery **or** a stubbed leftover `sgMail.send` — do not hit leftover live SendGrid from `pnpm test`:

**Deliver this operational email**
- Never throws when leftover Mongo create, leftover update, or leftover `sgMail.send` throws; leftover-error / leftover-warn and return leftover `failed` or leftover-skipped.
- Leftover disabled / leftover `EMAIL_NOTIFICATIONS_ENABLED=false`: leftover-skipped `email_disabled`, **no** row.
- Leftover empty `to` / leftover missing from: leftover-skipped, **no** row.
- Leftover `log_only`: one leftover row leftover `sent`, leftover `ok: true`, leftover `sgMail.send` is **not** called.
- Leftover `live` / leftover `sandbox` with leftover missing API key: leftover row leftover `failed`, leftover `next_attempt_at` set, leftover `ok: false`.
- Leftover `sandbox`: leftover `mailSettings.sandboxMode.enable` is true; leftover success leftover `sent` + leftover `provider_message_id` when leftover `x-message-id` exists.
- Leftover SendGrid throw: same leftover `_id` leftover `failed`, leftover `error_message`, leftover backoff, leftover `ok: false`.

**Retry this failed email on the same row**
- Leftover disabled: leftover-skipped, leftover `attemptCount: 0`, row unchanged.
- Missing leftover `_id`: leftover-skipped `delivery_not_found`.
- Empty leftover `to`: leftover row leftover `cancelled`.
- Leftover `$inc attempt_count` on the **same** leftover `_id`; no second leftover create.
- Leftover `log_only` retry: leftover `sent` with leftover `provider_response.retry: true`.
- Leftover `body_text` missing: leftover preview is what leftover SendGrid would send.

Do **not** add a test per helper (`rememberTheSendgridKeyOnce`, `clipTheBodyForAudit`, `whenToTryThisRowAgain`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export leftover `sendViaSendgrid` “so the test can assert sandboxMode” as a public **seam**.

## What I would not do

- An `EmailNotificationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `Delivery.create` / leftover `sgMail.send`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `send.ts`) for cleanliness.
- Breaking the never-throw **seam**. SendGrid and leftover Delivery must not sit inside a Domain Command write.
- Treating later `dispatchEventNotifications` or later `sendDailyOwnerDigest` as this story. Those choose leftover who / leftover when / leftover subject.
- Treating already-recommended leftover `handTwilioTheSms` as this story. That origin is a Lead Message.
- Inventing a begin / complete **seam** that has only one **adapter**.
- Inventing a second leftover SendGrid **adapter** beside leftover `sendViaSendgrid`.
- Silently inserting leftover `cancelled` skip rows so “the desk is complete.”
- Silently calling leftover `writeThisHappeningDown` from this file so “failures are always events.”
- Jumping to `reporting` while this service has unchecked modules.
- Writing a whole-folder recommendation for `observability`.
