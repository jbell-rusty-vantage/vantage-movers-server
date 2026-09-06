# Email The Owner This Morning's Observational Card Then Retry Failed Delivery Rows — operational story

- Status: recommended
- Service: `observability` (Wave A, visited)
- Pass: 7 of this service — `notificationDigest.service.ts`
- Remaining in this service: none
- Target: `src/services/observability/notificationDigest.service.ts`
- Knowledge: none (`docs/knowledge/services/` has no Observability Service). Software map: [`.cursor/rules/observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) (best-effort; never break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron; public import is the folder barrel; env policy in `src/config/domain/observability.ts`). Distinct from already-recommended leftover morning card: [`observability-admin-observability.md`](observability-admin-observability.md) (`getObservabilityOverview({})` is Eastern start-of-day through now — this file **asks** that card; it does not aggregate). Distinct from already-recommended leftover Delivery row: [`observability-email-notification.md`](observability-email-notification.md) (this file **asks** `sendNotification` with `purpose: "daily_digest"` and **asks** `retryNotificationDeliveryInPlace` on each due `_id`). Distinct from already-recommended leftover named reports: [`observability-operational-reports.md`](observability-operational-reports.md) (`daily-owner-operational-summary` is a citeable run; this file never runs it). Distinct from already-recommended leftover Incident upsert: [`observability-operational-incident.md`](observability-operational-incident.md) (`digest_sent_at` lives on the Incident document; this file never writes it). Distinct from leftover Wave B cron: `src/routes/notification-cron.routes.ts` (auth + one `try` that calls both exports). Distinct from leftover Vercel schedule: `vercel.json` path `/api/cron/notifications-digest-daily` at `0 12 * * *`. This checkout’s `CONTEXT.md` names “Workflow Observational” and does not define a morning letter — do not invent a glossary copy. `docs/adr/` is absent — do not invent ADR copies. Do not add an Observability Service file in this rename.
- Callers: Wave B `src/routes/notification-cron.routes.ts` (barrel import: `sendDailyOwnerDigest` then `retryFailedNotifications` in one `try`). Folder barrel `observability/index.ts` re-exports both names. No domain service imports this file. Tests: **no** `notificationDigest.service.test.ts`.
- Seams callers need: morning letter (`sendDailyOwnerDigest`: skip without Mongo when email or the daily-letter flag is off, or when `ownerToEmails` is empty; otherwise ask the live card, then ask `sendNotification`) vs due-row picker (`retryFailedNotifications`: email-off returns `{ retried: 0 }`; else find due failed Delivery rows and ask in-place retry). There is no begin / complete **seam**. There is no Domain Command **seam**. There is no leftover report **seam**. There is no leftover Incident `digest_sent_at` **seam**.
- Split later (only if the file outgrows one sitting): this ~120-line file is one sitting if you read it as email the owner this morning’s Observational card, then retry failed Delivery rows. Do **not** split into `digest.ts` / `retry.ts`. Do **not** pull leftover overview / leftover SendGrid / leftover cron here. If it later splits: `emailTheOwnerThisMorningsObservationalCard.ts` / `retryRecentlyFailedDeliveryRowsOnTheSameRow.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts`

`sendDailyOwnerDigest` / `retryFailedNotifications` / `DailyDigestResult` are executor mechanics. The owner question is: *Every morning I want one short letter about this Eastern morning’s Observational card, not a pile of emails from each Incident. If email or the daily letter is off, do not write a row. If it is on, copy the live card into one paragraph and stamp one Delivery row as `daily_digest`. Then, if email is still on, find recently failed Delivery rows that are due and bump each one in place. A throw from the card skips retry. A skipped or failed letter does not. Do not run the named daily-owner report. Do not stamp `digest_sent_at`.*

Already-recommended leftover write-this-happening-down, leftover Delivery row, leftover policy, leftover Incident upsert, leftover Observational desk, leftover named reports, leftover env flags already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one morning-cron story, not “a notification CRUD service,” and not leftover overview or leftover named reports:

1. **Email the owner this morning’s Observational card** — `sendDailyOwnerDigest`. `isEmailNotificationsEnabled()` false **or** `isAlertEmailDailyDigestEnabled()` false → `{ skipped: true, reason: "digest_disabled", sent: false }` with no Mongo and no card. Empty `getSendgridConfig().ownerToEmails` → `{ skipped: true, reason: "no_recipients", sent: false }`. Else `await getObservabilityOverview({})` (Eastern SOD → now; **can throw**). Subject: `` `[Vantage] Daily operational summary — ${overview.health.overall_status}` ``. Body from private `buildDigestBody`. Then `sendNotification({ purpose: "daily_digest", recipientType: "owner", to: ownerToEmails, subject, bodyText })`. Return `{ skipped: result.skipped, reason: result.reason, sent: result.ok }`. `sendNotification` does not throw.

2. **Retry recently failed Delivery rows on the same row** — `retryFailedNotifications`. Email off → `{ retried: 0 }` (does **not** read the daily-letter flag). Else `connectMongo`, find `NotificationDelivery` where `status === "failed"`, `attempt_count < 3`, `createdAt >= now - 24h`, and `next_attempt_at` missing or `<= now`. Oldest `createdAt` first. Limit 25. Project `_id` only. No `purpose` filter. For each id, `retryNotificationDeliveryInPlace(delivery._id)`. Count only `result.ok`.

`buildDigestBody` is a beat of operation 1, not a public **seam**. Do not export it.

## Organization

Keep one file. Two operations belong together because the cron always runs them in that order, and a card throw is the only thing that skips retry. Leftover overview, leftover Delivery send/retry, leftover named reports, leftover Incident upsert, leftover cron auth already live in deeper **modules**. Do not pull those in. Do not invent a `NotificationDigestService` class. Do not invent a begin / complete **seam**. Do not invent a second SendGrid **adapter**. Do not invent a second overview **adapter**.

Do not split letter vs retry into CRUD files. Do not start writing `digest_sent_at` here so “the letter owns the Incident.” Do not start running `daily-owner-operational-summary` so “the letter owns the report.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `sendDailyOwnerDigest` | `emailTheOwnerThisMorningsObservationalCard` | Wave B morning cron; skip or stamp one `daily_digest` row |
| `retryFailedNotifications` | `retryRecentlyFailedDeliveryRowsOnTheSameRow` | Same cron, after the letter; bounded in-place retry |
| `DailyDigestResult` | `HowTheMorningLetterEnded` | `{ skipped, reason?, sent }` the cron JSON echoes |

Keep the old names as one-line aliases until the cron and the folder barrel migrate. Do not make callers learn `buildDigestBody` as the domain language.

**No class for the workflow.** The type that *does* earn a name is how the morning letter ended:

```ts
type HowTheMorningLetterEnded = {
  skipped: boolean
  reason?: string
  sent: boolean
}
```

That is the handoff from “we asked the card” to “the cron JSON says skipped or sent.” Do **not** add `persist: boolean`, and do **not** collapse leftover named-report runs into this type.

## The file, as a story

```ts
export async function emailTheOwnerThisMorningsObservationalCard(): Promise<HowTheMorningLetterEnded> {
  // ── 1. Email the owner this morning’s Observational card
  // email off or daily-letter flag off → skipped digest_disabled, sent false
  // no Owner To: → skipped no_recipients, sent false
  // ask getObservabilityOverview({}) — Eastern SOD → now (can throw)
  // ask sendNotification({ purpose: "daily_digest", recipientType: "owner", to, subject, bodyText })
  // return { skipped: result.skipped, reason: result.reason, sent: result.ok }
}

export async function retryRecentlyFailedDeliveryRowsOnTheSameRow(): Promise<{ retried: number }> {
  // ── 2. Retry recently failed Delivery rows on the same row
  // email off → { retried: 0 }
  // else find due failed rows (24h, attempt_count < 3, next_attempt_at due, limit 25)
  // for each _id ask retryNotificationDeliveryInPlace; count only result.ok
}

/** @deprecated Use emailTheOwnerThisMorningsObservationalCard */
export const sendDailyOwnerDigest = emailTheOwnerThisMorningsObservationalCard
/** @deprecated Use retryRecentlyFailedDeliveryRowsOnTheSameRow */
export const retryFailedNotifications = retryRecentlyFailedDeliveryRowsOnTheSameRow
export type DailyDigestResult = HowTheMorningLetterEnded
```

Every morning the Owner should get one short letter about this Eastern morning, not a pile of emails from each Incident. The file first asks whether email and the daily letter are both on, then whether any Owner address exists. If either answer is no, it returns How The Morning Letter Ended as skipped and never asks SendGrid. If both are yes, it asks the live Observational card for Eastern midnight through now, writes one paragraph from that card, and asks `sendNotification` to stamp one Delivery row as `daily_digest`. The same cron then asks retry recently failed Delivery rows: if email is off, retried is zero; else it finds up to twenty-five failed rows from the last twenty-four hours that still have attempts left and whose `next_attempt_at` is due, oldest first, and asks `retryNotificationDeliveryInPlace` for each id. It counts only ok answers. A throw from the card skips retry. A skipped or failed letter does not. Same-morning retry of a just-failed letter waits five minutes.

## Precise logic I would tighten while renaming

1. **The file comment lies about the window.** The header says “the last day’s health.” `getObservabilityOverview({})` uses `America/New_York` start-of-day through now. Vercel fires `0 12 * * *` UTC (about 8am ET / 7am EST), so the body is midnight-to-morning, not the previous calendar day and not a rolling twenty-four hours. Retry *does* use last-twenty-four-hours on `createdAt`. Do not silently change the letter window to match the comment.

2. **`overall_status` is live, and warn does not move it.** Subject uses `overview.health.overall_status`: `critical` if any open/acknowledged critical Incident, else `degraded` if any open error, else `healthy`. Open warnings stay on the body (`Open warnings: N`) and never change the subject. That is leftover overview’s rule — do not recompute a fourth status here so “the letter looks more urgent.”

3. **`sent_today` is the period, not a calendar day.** Body line `Notifications today — sent: …` copies leftover overview counts for `[from, to)`. At 8am ET that is midnight-to-morning, including the letter row if `log_only` already marked it sent before the card was asked (it is not — the card is asked first). Do not rename the copied keys in this file.

4. **Body drops most of the card.** Copied: overall status; open critical / error / warn; `event_counts_by_level` as `  {key}: {count}` under `Events by level (today):`; notifications sent/failed/suppressed; up to ten `  [severity] title (x{count})` under `Top open incidents:` when the list is non-empty; CTA `Open the Observational tab in the admin dashboard for full detail.` Dropped: category/workflow counts, recent critical Events, `sheet_sync`, `ringcentral`. Do not silently paste the rest so “the letter is the card.”

5. **Retry ignores the daily-letter flag.** Email off stops both paths. Letter flag off still retries if email is on. Do not add the letter flag to retry so “digest off means quiet.”

6. **Retry has no purpose filter.** Immediate-alert failures and a failed morning letter are in the same twenty-five. The in-place helper does **not** re-check `status === "failed"` or `attempt_count < 3` — this find is the gate. Passing a sent id would bump and resend. Do not add a second status guard in this file so “retry owns the row rules”; those rules stay on the Delivery **module** if they move.

7. **Same-cron retry of a just-failed letter waits.** First send stamps `attempt_count: 1`. A SendGrid failure sets `next_attempt_at` via `min(60, 5 * 2^(attempt-1))` minutes (five minutes on the first fail). The find requires `next_attempt_at` missing or `<= now`, so the letter that just failed is not in this batch. A row gets at most two in-place retries after the first send (`attempt_count < 3`).

8. **A card throw skips retry; a skipped letter does not.** `sendNotification` never throws. Overview **can**. The cron’s one `try` means overview throw → `notification.digest_cron.failed` + HTTP 500 and **no** retry. `digest_disabled` / `no_recipients` / helper skip / SendGrid fail still run retry. Cron auth is local `requireCronAuth` on `CRON_SECRET` (Bearer or `x-cron-secret`), not `requireVantageCronAuth`. Log line is `notification.cron.digest.failed`; Event key is `notification.digest_cron.failed`.

9. **Unused knobs this file never reads.** `digest_sent_at` on `OperationalIncident` is never written. `ALERT_EMAIL_NEAR_WORTHY_DIGEST_EVENTS` / `isAlertEmailNearWorthyDigestEnabled()` are never read. `getAlertEmailDailyDigestCronTime()` (default `"12:00"`) is unused — Vercel owns `0 12 * * *`. `weekly_report` is never sent. Named report `daily-owner-operational-summary` is never run. This file never writes an Operational Event.

10. **Gates use the boolean helpers, not a runtime bag.** Code calls `isEmailNotificationsEnabled()`, `isAlertEmailDailyDigestEnabled()`, and `getSendgridConfig()`. There is no `getObservabilityEmailRuntime()` in this file. Retry passes `delivery._id` (ObjectId), not `String(id)`.

Out of scope: leftover overview aggregation, leftover SendGrid / attempt math, leftover cron auth, leftover named reports, leftover Incident upsert. Do not silently “fix” the last-day comment, start writing `digest_sent_at`, or start running the named daily-owner report in this rename.

## Testing

The **interface** is the test surface. There is no `notificationDigest.service.test.ts` today. Add one file that imports the story names (aliases are enough if the new names are not on disk yet). Mock `isEmailNotificationsEnabled`, `isAlertEmailDailyDigestEnabled`, `getSendgridConfig`, `getObservabilityOverview`, `sendNotification`, `connectMongo`, `getNotificationDeliveryModel` / `find`, and `retryNotificationDeliveryInPlace`.

Prove:

- **Letter off or email off** — returns skipped `digest_disabled`, `sent: false`. Overview and `sendNotification` not called.
- **No Owner To:** — skipped `no_recipients`. Overview not called.
- **Happy letter** — overview called with `{}`; `sendNotification` called with `purpose: "daily_digest"`, `recipientType: "owner"`, the Owner list, a subject that includes `overview.health.overall_status`, and a body that includes `Overall status:`, `Open critical incidents:`, `Open errors:`, `Open warnings:`, `Events by level (today):`, `Notifications today`, at least one `Top open incidents:` line when the card has rows, and `Open the Observational tab in the admin dashboard for full detail.` Return maps `skipped` / `reason` / `sent: result.ok`.
- **Card throw** — reject; `sendNotification` not called. (Cron skips retry; that assertion stays in a route test.)
- **Letter skipped by helper** — `sendNotification` returns skipped; this file returns the same `skipped` / `reason` and `sent: false`.
- **SendGrid failed** — helper returns `ok: false`, `skipped: false`; this file returns `skipped: false`, `sent: false`.
- **Retry email off** — `{ retried: 0 }`; `find` not called.
- **Retry letter-flag off, email on** — `find` still runs.
- **Retry query** — `find` args include `status: "failed"`, `attempt_count: { $lt: 3 }`, `createdAt: { $gte: <about 24h ago> }`, `$or` on `next_attempt_at`, `.sort({ createdAt: 1 })`, `.limit(25)`, `.select({ _id: 1 })`.
- **Retry count** — two ids, first `ok: true`, second `ok: false` → `retried === 1`; both ids passed through as ObjectIds.
- **Retry empty** — `{ retried: 0 }`.
- **No purpose filter** — the `find` filter has no `purpose` key.

Do not assert SendGrid HTTP, leftover Delivery attempt math, or leftover overview aggregation here. Do not require a live cron hit.

## What I would not do

- Do not invent a `NotificationDigestService` class.
- Do not split `digest.ts` / `retry.ts` / `create.ts` / `update.ts` / `delete.ts`.
- Do not move leftover overview queries, leftover SendGrid, or leftover cron auth into this file.
- Do not start writing `digest_sent_at` as a silent fix.
- Do not silently change the letter window from Eastern SOD to last-twenty-four-hours to match the file comment. If product wants last day, that is a later change with a test.
- Do not start running `daily-owner-operational-summary` from this cron.
- Do not treat unused near-worthy / cron-time env helpers as live gates.
- Do not add a purpose filter or a second `status === "failed"` guard here so “retry looks safer” without a product decision.
- Do not jump to `reporting` until this recommendation exists and the checklist marks this module.
- Do not break the cron order (letter then retry) or the “card throw skips retry” **seam**.
