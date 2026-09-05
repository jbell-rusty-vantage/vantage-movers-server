# Ask Whether The Owner Or A Developer Should Hear About This Happening Right Now — operational story

- Status: recommended
- Service: `observability` (Wave A, in-progress)
- Pass: 3 of this service — `notificationPolicy.ts`
- Remaining in this service: `operationalIncident.service.ts`, `adminObservability.service.ts`, `operationalReports.service.ts`, `notificationDigest.service.ts`
- Target: `src/services/observability/notificationPolicy.ts`
- Knowledge: none (`docs/knowledge/services/` has no Observability Service). Software map: [`.cursor/rules/observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) (best-effort; never break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron; public import is the folder barrel; models via `getObservabilityModel()` / leftover Incident getter; env policy in `src/config/domain/observability.ts`; **only leftover policy may advance Incident throttle after leftover `sendNotification` returns `ok: true`**; rollups are deferred). Distinct from already-recommended write-this-happening-down: [`observability-record-operational-event.md`](observability-record-operational-event.md) (that file **asks** this after persist + leftover Incident upsert, then writes `notification.email.failed` when this returns leftover failed and not leftover-skipped — this file never records an Operational Event). Distinct from already-recommended leftover SendGrid row: [`observability-email-notification.md`](observability-email-notification.md) (this file **asks** leftover `sendNotification` with leftover `purpose: "immediate_alert"`; leftover `log_only` / leftover sandbox / leftover live / leftover in-place retry stay there). Distinct from later daily digest + failed-row picker: `notificationDigest.service.ts` (leftover `purpose: "daily_digest"`; leftover `ALERT_EMAIL_NEAR_WORTHY_DIGEST_EVENTS` / leftover `digest_sent_at` stay there — this file never reads them). Distinct from later Incident upsert: `operationalIncident.service.ts` (opens / grows / leftover auto-resolves the Incident; this file only stamps leftover `notification_state.immediate_sent_at` / leftover `next_notify_at` / leftover `suppressed_count`). Distinct from later Admin Dashboard desk: `adminObservability.service.ts`. Distinct from later operational reports: `operationalReports.service.ts`. Distinct from leftover Wave B digest cron: `src/routes/notification-cron.routes.ts` (thin; **asks** later digest, not this file). Distinct from leftover env flags / leftover `ALERT_EMAIL_*` / leftover `SENDGRID_TO_EMAIL` / leftover `SENDGRID_DEVELOPER_TO_EMAIL`: `src/config/domain/observability.ts`. Distinct from leftover `OperationalIncident` schema: `src/models/OperationalIncident.ts` (leftover `notification_state.digest_sent_at` is later digest). Distinct from already-recommended Granot Section 33 catalog: [`granot-lifecycle-observability.md`](granot-lifecycle-observability.md) (that catalog **asks** leftover record, not this file). Distinct from already-recommended Twilio SMS: [`lead-messaging-twilio-adapter.md`](lead-messaging-twilio-adapter.md). This checkout’s `CONTEXT.md` names “Workflow Observational” in the intro and does not define immediate owner email / leftover throttle — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an Observability Service file in this rename.
- Callers: already-recommended `recordOperationalEvent.ts` (`dispatchEventNotifications` by path; leftover `notification.email.failed` re-record lives there). Folder barrel `observability/index.ts` re-exports leftover `dispatchEventNotifications`. No domain / Wave B file imports this policy — they **ask** leftover record. Later digest / later Admin / leftover cron do **not** call this. Tests: **no** `notificationPolicy.test.ts` (leftover `observability-hardening-implementation-plan.md` still lists it as to-be-created). Leftover `src/config/domain/observability.test.ts` covers leftover mode default `log_only`, leftover `EMAIL_NOTIFICATIONS_MODE=disabled` → leftover `isEmailNotificationsEnabled()` false, leftover immediate levels default leftover `critical`, leftover `ALERT_EMAIL_OWNER_EVENTS` CSV parse — not that this file stayed quiet, emailed, or throttled. Leftover `observability-review-report.md` still claims leftover `markIncidentNotified` runs regardless of leftover `ok` — **stale**; current code is leftover `if (incident && result.ok)`.
- Seams callers need: decide-then-maybe-email (`dispatchEventNotifications`: leftover observability / leftover email off → `null`; leftover `notification.*` / leftover category `notification` → leftover-none; leftover owner-event list **or** leftover immediate level **or** leftover min-level + leftover `notification_candidate` → leftover owner or leftover developer; leftover Incident `next_notify_at` in the future → leftover suppress, `null`; leftover empty `to` → `null`; otherwise leftover `sendNotification` leftover `immediate_alert`; leftover Incident throttle only after leftover `ok: true`). Never throw. Never write an Operational Event (the caller does that). There is no begin / complete **seam**. There is no Domain Command **seam**. There is no leftover SendGrid **seam**. There is no leftover digest **seam**.
- Split later (only if the file outgrows one sitting): this ~260-line file is one sitting if you read it as ask whether the owner or a developer should hear about this happening right now — stay quiet about leftover `notification.*`, stay quiet when the same Incident was just emailed, hand leftover email the letter only when leftover posture says so, and only then start the leftover throttle clock. Do **not** split leftover posture / leftover throttle / leftover subject into `decide.ts` / `notify.ts` / `throttle.ts`. Do **not** pull leftover record / leftover SendGrid / later digest / later Incident upsert here so “policy owns the company.” If it later splits: `decideWhetherThisHappeningEmailsRightNow.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `notify.ts`

`dispatchEventNotifications` / `resolvePosture` / `markIncidentNotified` are executor mechanics. The owner question is: *We already wrote the happening down. Should the owner or a developer get an email right now? Never email about the email. If this is the same Incident we just emailed about, count the silence and stop. If we do email, only after that send succeeds do we say “do not page this family again until the leftover throttle clock runs out.” Never throw. Never write an Operational Event — leftover record does that so we do not loop.*

Later leftover SendGrid row, later digest picker, later Incident upsert, later Admin desk, leftover env flags, leftover write-this-happening-down, leftover Granot catalog, and already-recommended Twilio SMS already live in other **modules**. Do not pull those in.

## What this file actually does

One owner operation, not “a notification CRUD service,” and not the leftover SendGrid row or the leftover digest picker:

1. **Ask whether the owner or a developer should hear about this happening right now** — `dispatchEventNotifications`. Leftover `OBSERVABILITY_ENABLED=false` or leftover email off (leftover `EMAIL_NOTIFICATIONS_ENABLED=false` **or** leftover mode `disabled`): return `null`, **no** leftover SendGrid, **no** leftover throttle write. Leftover `resolvePosture`: leftover category `notification` **or** leftover `event_key` starting `notification.` → leftover-none (the loop fence). Leftover `ALERT_EMAIL_OWNER_EVENTS` contains this leftover key → leftover `immediate_owner`, unless leftover `DEVELOPER_ONLY_EVENT_KEYS` (leftover `http.request.5xx` / leftover `queue.consumer.failed` / leftover `sheet_sync.queue.publish_failed` / leftover `cron.trigger.failed` / leftover `cron.auth.failed`) → leftover `immediate_developer`. Else leftover immediate levels (default leftover `critical`) **or** leftover level rank ≥ leftover `ALERT_EMAIL_MIN_LEVEL` (default leftover `error`) **and** leftover `notification_candidate` → same leftover owner / leftover developer split. Else leftover-none → `null`. Leftover Incident present and leftover `notification_state.next_notify_at` still in the future: leftover `$inc suppressed_count`, return `null`. Leftover `recipientsFor`: leftover developer list, else leftover owner list when leftover developer `to` is empty. Leftover empty `to`: `null`. Otherwise leftover `sendNotification` leftover `purpose: "immediate_alert"` with leftover `[Vantage]` subject on leftover `info` / leftover `debug`, leftover `[Vantage Alert]` otherwise, leftover body of leftover summary / leftover environment / leftover key / leftover workflow / leftover level / leftover source / leftover customer / leftover job / leftover record / leftover run / leftover route / first 12 leftover details clipped to 200 chars / leftover Incident count + leftover first-seen + leftover last-seen. Leftover Incident **and** leftover `result.ok`: leftover `$set immediate_sent_at` + leftover `next_notify_at` (`now + leftover ALERT_EMAIL_THROTTLE_MINUTES`, default 60). Leftover throttle / leftover suppress Mongo throws: leftover-warn, do not throw. Return leftover `SendNotificationResult` when a send was attempted, else `null`.

There is no second owner operation. Leftover `formatDetailValue` / leftover `isSuccessMilestone` / leftover `buildSubject` / leftover `buildBody` / leftover `markIncidentNotified` / leftover `markIncidentSuppressed` are leftover beats, not public **seams**. Do not export leftover `resolvePosture` as a public **seam**. Do not export leftover `sendNotification` from this file as if this story owned the leftover SendGrid row. Do not export later `retryFailedNotifications` from this file as if this story owned the leftover digest picker. Do not export leftover `writeThisHappeningDown` from this file as if this story owned the leftover `notification.email.failed` re-record.

## Organization

Keep one file. This is the screenplay for “ask whether the owner or a developer should hear about this happening right now.” Leftover write-this-happening-down, leftover SendGrid row, leftover digest picker, leftover Incident upsert, leftover Admin desk, leftover env flags, leftover Granot catalog, and Twilio SMS already live in deeper **modules**. Do not pull those in. Do not invent a `NotificationPolicyService` class. Do not invent a begin / complete **seam** — this is after-the-fact best-effort, not a Domain Command. Do not invent a second leftover email **adapter** beside already-recommended leftover `deliverThisOperationalEmail`. Do not invent a second leftover Incident **adapter** beside later `upsertIncidentForEvent`.

Do not split leftover posture vs leftover throttle vs leftover subject into CRUD files. Do not move leftover `notification.email.failed` into this file so “policy owns every email outcome” — that re-record lives on already-recommended leftover record so this file stays free of an import cycle. Do not move leftover `log_only` into this file so “policy owns the provider.” Do not write leftover `digest_sent_at` here so “one notification_state writer.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `dispatchEventNotifications` | `askWhetherTheOwnerShouldHearAboutThisHappeningRightNow` | leftover record **asks** after persist + leftover Incident; never throws; `null` means stay quiet |

Keep the old name as a one-line alias until leftover record and the folder barrel migrate. Do not make callers learn leftover `NotifyPosture` / leftover `DEVELOPER_ONLY_EVENT_KEYS` / leftover `ALERT_EMAIL_THROTTLE_MINUTES` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the leftover send outcome this file already returns:

```ts
type HowTheImmediateEmailAttemptEnded = {
  /* today's SendNotificationResult | null — null = stay quiet; leftover ok / leftover-skipped / leftover failed when we tried */
}
```

That is the handoff from “we decided (or refused)” to “leftover record may write `notification.email.failed` when leftover failed and not leftover-skipped.” Do **not** add a `persist: boolean` field so “every caller looks like a command,” and do **not** collapse later leftover digest into this type so “every email looks like an immediate alert.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// notificationPolicy.ts
// We already wrote the happening down.
// Should the owner or a developer hear about it right now?
// Never email about the email.
// If this is the same Incident we just emailed about, count the silence and stop.
// If we do email, only after that send succeeds
// do we start the leftover throttle clock.
// Never throw.
// Never write an Operational Event — leftover record does that
// so we do not loop.

// ── 1. Ask whether the owner or a developer should hear about this happening right now ─

export async function askWhetherTheOwnerShouldHearAboutThisHappeningRightNow({
  event,
  incident,
})
export const dispatchEventNotifications =
  askWhetherTheOwnerShouldHearAboutThisHappeningRightNow

function observabilityOrEmailIsOff()                  // leftover enabled + leftover email enabled
function thisHappeningMustStayQuiet(event)            // leftover category notification / leftover notification.*
function whoShouldHearIfAnyone(event)                 // leftover owner-event list, leftover immediate level, leftover min-level + leftover candidate, leftover developer-only keys
function thisIncidentWasJustEmailed(incident, now)    // leftover next_notify_at still in the future
async function countTheSilenceOnThisIncident(incidentId)
function whoReceivesThisLetter(posture)               // leftover developer list, else leftover owner list
function subjectForThisHappening(event)               // leftover [Vantage] on leftover info / leftover debug; leftover [Vantage Alert] otherwise
function letterForThisHappening(event, incident)      // leftover summary + leftover identity + leftover first 12 details
async function handTheImmediateLetterToEmail(event, incident, recipients)
async function startTheThrottleClockOnlyAfterTheSendSucceeded(incidentId, sentAt)

type WhoShouldHearIfAnyone = "immediate_owner" | "immediate_developer" | "none"
```

Read the primary path out loud: *Leftover record just wrote `booking.created` and there is no Incident because leftover info is not a leftover failure. Ask this file whether anyone should hear. Observability is on. Email is on. This is not leftover `notification.*`. Leftover `ALERT_EMAIL_OWNER_EVENTS` contains `booking.created`, and that key is not leftover developer-only, so leftover posture is leftover owner. There is no leftover `next_notify_at` to honor. Leftover owner `to` is present. Hand leftover email leftover purpose `immediate_alert` with leftover `[Vantage]` plus the leftover summary. Today leftover mode is leftover `log_only`, so leftover email marks one leftover row leftover `sent` and returns leftover `ok: true`. There is no Incident, so leftover throttle is not written. Leftover record does not write `notification.email.failed` because this was leftover ok. If this had been leftover `http.request.5xx`, leftover developer `to` would have been used (or leftover owner `to` if that list is empty). If this had been leftover `notification.email.failed`, leftover posture would have been leftover-none and we would have returned `null` so we never email about the email. If leftover SendGrid had failed on a leftover critical Incident, leftover `next_notify_at` would stay unset so the next leftover happening of that family can try again — leftover digest may also leftover-retry the same leftover delivery row, which is a different story. Never throw. The Booking is already saved.*

That is the operation. `resolvePosture` is the leftover who-hears beat, not a second live path. `sendNotification` is not this decision. Later leftover `sendDailyOwnerDigest` is not this decision.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Never throw is the product.** The rule and the comment say notification paths must not break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron. Leftover record already `try`s this and leftover-warns `observability.notification.dispatch_failed`. Leftover throttle / leftover suppress already leftover-warn on Mongo throw. Do not start throwing so “the caller can retry,” and do not `await` this inside a Domain Command transaction so “the email commits with the Booking.”

2. **Never write an Operational Event here.** Leftover record owns leftover `notification.email.failed` so this file stays free of an import cycle and leftover `category: "notification"` cannot loop. Do not call leftover `writeThisHappeningDown` from this file so “policy owns the failure event,” do not set leftover `notificationCandidate: true` on that second happening, and do not skip the leftover re-record when leftover `dispatchResult.skipped` is true — leftover record already distinguishes leftover-skipped vs leftover failed.

3. **The loop fence is the product.** Leftover category `notification` **or** leftover `event_key` starting `notification.` → leftover-none **before** leftover owner-event list and leftover severity. Do not let leftover `ALERT_EMAIL_OWNER_EVENTS=notification.email.failed` page the owner so “the env list is absolute,” and do not drop leftover category check so “the prefix is enough” — leftover record sets both on purpose.

4. **Throttle advances only after leftover `ok: true`.** The rule says so. Current code matches. Leftover `observability-review-report.md` still describes the old leftover-always-advance bug — do not “fix” the report in this rename, and do not revert to leftover-always-advance so “the Incident stops paging after a failed SendGrid.” Leftover `log_only` is leftover `ok: true`, so leftover throttle **does** start after a leftover log-only send. Do not refuse leftover `ok` on leftover `log_only` so “throttle only after a real inbox” — that change belongs on already-recommended leftover email, not here.

5. **A failed leftover send does not start leftover `next_notify_at`.** The next leftover happening of that leftover fingerprint will leftover `sendNotification` again (a **new** leftover delivery row). Later leftover digest leftover-retries the **same** leftover failed row. Two leftover retry stories. Do not call leftover `retryNotificationDeliveryInPlace` from this file so “policy owns both retries,” and do not write leftover `next_attempt_at` onto the Incident so “one clock.”

6. **No Incident means no leftover throttle.** Leftover `info` owner milestones (`booking.created`) never open an Incident (leftover record leftover `FAILURE_LEVELS` are leftover `warn` / leftover `error` / leftover `critical`). Leftover Incident upsert throw also leaves leftover `incident: null`, then leftover email may still run. Every leftover `booking.created` can email. Do not open an Incident from leftover `info` so “milestones throttle,” and do not skip leftover email because upsert failed.

7. **Leftover owner-event list is empty by default.** Leftover `getAlertEmailOwnerEvents()` is leftover `ALERT_EMAIL_OWNER_EVENTS` CSV with no checked-in default. Without that env, leftover `booking.created` stays quiet unless leftover severity / leftover `notification_candidate` fires. Do not hardcode leftover `booking.created` / leftover `cancellation.created` into leftover `DEVELOPER_ONLY_EVENT_KEYS` so “the owner always hears,” and do not treat leftover empty list as leftover “email every leftover `info`.”

8. **Leftover developer-only keys are hardcoded; leftover owner events are env.** Leftover `http.request.5xx` and friends cannot be retuned without a code change. If leftover `ALERT_EMAIL_OWNER_EVENTS` also lists one of those keys, leftover `isDeveloperOnly` still wins the leftover recipient. Do not move leftover developer keys into leftover env in this rename so “everything is tunable,” and do not drop leftover owner-list-then-developer-override so “env always means owner inbox.”

9. **Leftover developer `to` falls back to leftover owner `to`.** Empty leftover `SENDGRID_DEVELOPER_TO_EMAIL` still pages leftover `SENDGRID_TO_EMAIL` and leftover `recipientType` becomes leftover `owner`. Do not return leftover-none on empty leftover developer list so “5xx never reaches the owner,” and do not invent a third leftover `to` so “fallback is a different inbox.”

10. **Leftover `warn` is not leftover email by default.** Leftover min level is leftover `error`. Leftover immediate levels default leftover `critical`. Leftover record defaults leftover `notificationCandidate` true only on leftover `error` / leftover `critical`. Leftover `warn` with leftover candidate true still fails leftover `meetsMinLevel` unless leftover `ALERT_EMAIL_IMMEDIATE_LEVELS` includes leftover `warn`. Do not treat leftover `notification_candidate` as leftover “always email” so “the flag is honest,” and do not raise leftover default min to leftover `warn` so “more pages.”

11. **Leftover near-worthy digest events are not this file.** Leftover `getAlertEmailNearWorthyDigestEvents` / leftover `digest_sent_at` / leftover `ALERT_EMAIL_DAILY_DIGEST_*` stay on later leftover digest. Do not read leftover near-worthy here so “policy owns every owner letter,” and do not send leftover `daily_digest` from leftover `info` so “one email path.”

12. **The barrel exports leftover policy.** Leftover record imports by path. No domain file should learn leftover `dispatchEventNotifications` from leftover `observability/index.ts` and skip leftover record’s leftover failure re-record. Do not call leftover policy from leftover `httpLogger` so “5xx emails skip leftover persist,” and do not remove the barrel export on this pass because “nothing else calls it.”

13. **Leave sibling modules alone.** Leftover `writeThisHappeningDown` (leftover persist + leftover `notification.email.failed`), leftover `deliverThisOperationalEmail` (leftover row + leftover SendGrid), later `upsertIncidentForEvent`, later `retryFailedNotifications`, leftover `getAlertEmailOwnerEvents` / leftover `getSendgridConfig` are already the right **depth**. This file orchestrates leftover posture + leftover throttle + leftover ask.

14. **Do not silently add rollups.** The rule says rollups are deferred. Leftover home cards count leftover deliveries. Do not write a leftover metrics row from this file so “suppressed_count is cheap.”

15. **Do not treat the stale leftover review report as current code.** Leftover `observability-review-report.md` says leftover `markIncidentNotified` runs regardless of leftover `ok`. Leftover hardening plan already asked for leftover `ok: true` only, and that is what the file does. Rename against the file, not the leftover report. Do not rewrite that leftover markdown in this pass.

## Testing

The **interface** is the test surface: `askWhetherTheOwnerShouldHearAboutThisHappeningRightNow`.

Today there is no `notificationPolicy.test.ts`. Leftover flag tests next door only prove leftover env defaults. That is not enough for a story this load-bearing.

Add tests that name the operation. They will need a replica / injected leftover Incident **or** a stubbed leftover `sendNotification` — do not hit leftover live SendGrid from `pnpm test`:

**Ask whether the owner should hear about this happening right now**
- Never throws when leftover Incident update or leftover `sendNotification` throws; leftover-warn and return leftover `null` / leftover result.
- Leftover observability off / leftover email off: `null`, leftover `sendNotification` is **not** called, leftover Incident is **not** written.
- Leftover `category: "notification"` **or** leftover `event_key` `notification.email.failed`: leftover-none, `null`, even when leftover `ALERT_EMAIL_OWNER_EVENTS` lists that key.
- Leftover `ALERT_EMAIL_OWNER_EVENTS` contains leftover `booking.created` (leftover `info`, leftover `incident: null`): leftover `sendNotification` leftover `purpose: "immediate_alert"`, leftover `recipientType: "owner"`, leftover `[Vantage]` subject; leftover throttle is **not** written.
- Leftover `http.request.5xx` with leftover developer `to`: leftover `recipientType: "developer"`. Empty leftover developer `to`: leftover owner `to` and leftover `recipientType: "owner"`.
- Leftover `critical` emails even when leftover `notification_candidate` is false (leftover immediate level). Leftover `error` + leftover candidate emails. Leftover `warn` + leftover candidate does **not** email on leftover default min leftover `error`.
- Leftover Incident leftover `next_notify_at` in the future: leftover `$inc suppressed_count`, leftover `sendNotification` is **not** called, `null`.
- Leftover `sendNotification` leftover `ok: true` with leftover Incident: leftover `immediate_sent_at` + leftover `next_notify_at` ≈ now + leftover throttle minutes.
- Leftover `sendNotification` leftover `ok: false` / leftover-skipped: leftover `next_notify_at` stays unset.
- Leftover empty leftover `to`: `null`, no leftover send.

Do **not** add a test per helper (`thisHappeningMustStayQuiet`, `subjectForThisHappening`, `letterForThisHappening`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export leftover `resolvePosture` “so the test can assert leftover developer-only” as a public **seam**.

## What I would not do

- A `NotificationPolicyService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `sendNotification` / leftover `Incident.updateOne`.
- Moving this into a CRUD folder (`decide.ts` / `notify.ts` / `throttle.ts`) for cleanliness.
- Breaking the never-throw **seam**. Leftover email and leftover Incident throttle must not sit inside a Domain Command write.
- Treating already-recommended leftover `deliverThisOperationalEmail` or later leftover `sendDailyOwnerDigest` as this story. Those hand leftover SendGrid the letter or pick leftover failed rows.
- Treating already-recommended leftover `writeThisHappeningDown` as this story. That persist + leftover `notification.email.failed` re-record is a different origin.
- Inventing a begin / complete **seam** that has only one **adapter**.
- Inventing a second leftover email **adapter** beside leftover `sendNotification`.
- Silently moving leftover `notification.email.failed` into this file so “policy owns the loop.”
- Silently advancing leftover `next_notify_at` on leftover failed SendGrid so “the stale leftover review report is implemented.”
- Jumping to `reporting` while this service has unchecked modules.
- Writing a whole-folder recommendation for `observability`.
