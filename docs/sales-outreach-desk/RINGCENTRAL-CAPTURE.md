# RingCentral capture for the Sales Outreach Desk

October 4, 2026. Grounded in server `main@ecc76257` and RingCentral developer documentation. This supersedes SPECIFICATION §15 where they differ. Markers: **[doc]** = stated in RingCentral docs (URL), **[code]** = verified in our server, **[inferred]** = engineering judgment to prove in shadow.

## 1. What runs today [code]

| Piece | Behaviour |
| --- | --- |
| Auth | One app, one JWT user (`RC_JWT`, `RC_CLIENT_ID`/`RC_CLIENT_SECRET`), token cached in Mongo. All work shares one rate bucket per API group. |
| Webhook subscription | **One** owned subscription, **one** filter: `/restapi/v1.0/account/~/telephony/sessions` (account-level, all directions, no `withRecordings`). Mode `"all"` in `webhook-subscriptions.ts`. Renewed by cron `15 6 * * *`; repaired only when `Blacklisted`/`Suspended`. Requests `expiresIn` 630,720,000 s (20 y). No `verificationToken`. |
| Webhook route | `POST /api/webhooks/ringcentral`: echoes `Validation-Token`, stores receipt in `ringcentral_webhook_events`, always 200. `fanOutCaptureProjection` queues a `capture_projection` job **only when the receipt has a `telephonySessionId`** (a message-store event would be stored then ignored). Minute `job-recovery` closes enqueue gaps. |
| Call Log | `call-log-reconcile` cron `3-59/5`: account Call Log `type=Voice&view=Detailed`, 240-min trailing re-read, gap records, `known_complete_through`, ≤ 20 requests/run; with `SALES_INTELLIGENCE_CALL_LOG_SYNC=on`, an account **Call Log Sync** (FSync then ISync token) inside each run. `call_log_refresh` job per hang-up at +90 s, +2/+5/+15 min (low lane, 45-min expiry). Nightly 36-h sweep `40 7 * * *`. Legacy inbound call-lead sync every 30 min (separate ingestion path; leave it alone). |
| Rate gate | `rateLimitGate.ts`: Mongo sliding 60-s window per group. Heavy (Call Log list/by-id, Call Log Sync, recordings): high lane 8/min (waits ≤ 70 s), low lane 4/min (never waits). Everything else = `other`, **unbudgeted**. Built after the 2026-09-25 incident where per-call refresh jobs sent ~40 Heavy req/min against a 10/min limit. |
| Rep attribution | Read-time only: first connected user party's `extension_id` → `rep_identity_links` (reviewed, effective at call start). No per-rep/day projection. |
| SMS | **No rep SMS capture.** Only RingCentral Accounts nudges send from the JWT user's own extension. |

## 2. Platform facts that drive the design

- Account telephony sessions cover every extension on the account; extension-level covers one; both need `CallControl`. Filters accept `direction`, `missedCall`, `phoneNumber`, `statusCode`, `withRecordings`. [doc] https://developers.ringcentral.com/guide/notifications/event-filters/account-telephony-sessions
- Telephony notifications are not sent for parties outside the subscriber's scope or in another session (transfers, conferences). Event order is **not** guaranteed; use `sequence`. [doc] https://developers.ringcentral.com/guide/voice/telephony-session-notifications
- Message store events exist **only per extension**: `/restapi/v1.0/account/~/extension/{id}/message-store?type=SMS[&direction=]`, need `ReadMessages`. No account-level message-store event. `/message-store/instant` is inbound only. [doc] https://developers.ringcentral.com/guide/notifications/event-filters/message
- An admin may subscribe one subscription to many user extensions, one `eventFilters` entry per user; non-admin attempts fail with `SUB-405`. Subscription count limit per user+app → `SUB-505`. [doc] https://developers.ringcentral.com/guide/messaging/sms/receiving-sms-mms , https://developers.ringcentral.com/api-reference/Subscriptions/createSubscription . Community answers cite ~20 subscriptions per user+app and very large filter counts; not in official docs.
- Message-store events carry only `changes[]{type,newCount,updatedCount}` (new events usually include `newMessageIds`; **updates carry no ids**). Sync the mailbox to learn what changed. [doc]
- SMS statuses: `Queued`, `Sent`, `Delivered`, `DeliveryFailed`, `SendingFailed`, `Received`. **Delivered/DeliveryFailed are not supported by US mobile carriers**, so `Sent` is the practical confirmation. Fields: `creationTime`, `lastModifiedTime`, `messageStatus`, `direction`, `from/to`, `conversationId`, `smsDeliveryTime`. [doc] https://developers.ringcentral.com/guide/messaging/message-store/messaging
- WebHook max `expiresIn` = **315,360,000 s (10 years)**. Optional `verificationToken`. Endpoint must answer validation within 3 s. Failing endpoints become `Blacklisted` (delete + recreate). Deliveries are retried briefly then dropped — assume **at-most-once**. [doc] https://developers.ringcentral.com/guide/notifications/webhooks/creating-webhooks , https://developers.ringcentral.com/guide/notifications/webhooks/troubleshooting
- A completed call takes 15–30 s to appear in the Call Log. RingCentral calls Call Log polling "not a supported use case" for real time and recommends telephony-session events. [doc] https://developers.ringcentral.com/guide/voice/call-log
- Rate limits per (user, app): Light 50/min, Medium 40/min, Heavy 10/min, Auth 5/min; 60-s penalty, and requests during a penalty restart it. Call Log, Call Log Sync, Active Calls and account presence are **Heavy**; message list, **message sync**, subscription renew and extension presence are **Light**; create subscription is Medium. [doc] https://developers.ringcentral.com/guide/basics/rate-limits . Webhook deliveries do not consume API limits [inferred].

## 3. Decision: subscriptions

**Answer to "subscribe to multiple webhooks filtered to our rep accounts?"** For **calls: no**, keep the single account-level telephony subscription. For **SMS: yes**, a second subscription with one filter per reviewed rep mailbox. That is the only way RingCentral delivers message-store events.

| Subscription | Filters | Why |
| --- | --- | --- |
| `calls` (existing) | `/restapi/v1.0/account/~/telephony/sessions` | Already live. Covers outbound, answered inbound, transfers, queue legs and missed calls for **every** extension, which Numbers and capture coverage also need. Per-extension filters would lose cross-session legs and multiply renewals. Cost: 0 API calls. Rep filtering happens in our code via `rep_identity_links`. |
| `rep_sms` (new, app-owned) | `/restapi/v1.0/account/~/extension/{rcExtensionId}/message-store?type=SMS` — one per reviewed `sales_rep` link (no `direction`, so inbound replies update Last interaction) | Only per-extension message events exist. When the reviewed rep set changes, `PUT` the subscription with the new filter list (also renews). |

Both: `expiresIn` 315,360,000; a generated `deliveryMode.verificationToken` checked on every delivery (accept header `Verification-Token`, case-insensitive); stored in `ringcentral_webhook_subscriptions` with `purpose`. The daily renew cron also checks that `rep_sms` filters equal the current reviewed rep set and that both are `Active`. A 5-minute health check (`ownerCoverage`) reports `subscription_missing|expired|blacklisted|filter_drift` per channel (olr CW2 adds `token_missing|deliveries_refused`); never touch foreign subscriptions. The token is accepted only on create: RingCentral ignores `verificationToken` on `PUT`, so adding a token to an existing subscription means replacing it (create with a token, then delete the old one) — incident 2026-10-06.

## 4. Decision: calls (latency without spending Heavy budget)

1. **Webhook = fast signal.** From telephony parties derive the rep extension, direction and earliest `eventTime` for the session. The desk shows the call immediately as **awaiting confirmation**. It is not credit and never a miss (IMPL-07 in IMPLEMENTATION-PLAN).
2. **Call Log ISync every minute in staffed hours = confirmation.** Move the account Call Log Sync ISync out of the 5-minute reconcile into its own cron `* * * * *` that runs when New York time is in [07:45, 20:30) (outside: the existing 5-minute reconcile carries it). One Heavy request returns ≤ 250 changed records; follow pages only when full. Confirmed (call present in Call Log, terminal) typically within 60–120 s of hang-up. Goal target p95 ≤ 3 min holds.
3. **Narrow `call_log_refresh`** to sessions that ISync has not confirmed 5 minutes after hang-up (it was the largest Heavy consumer and the cause of the September incident). Keep the 45-min expiry.
4. Keep the 5-minute window reconcile (gap repair, `known_complete_through`) and the nightly sweep unchanged.
5. **Wake the desk** after `capture_projection` and after each ISync batch commit: enqueue `outreach_contact_change` for the touched `call_interactions` ids.

## 5. Decision: rep SMS capture

- Webhook receipt for `rep_sms` → durable receipt (existing table) → coalesced per-mailbox sync intent (debounce 5–10 s). Extend `webhookFanout.ts` to route message-store receipts instead of dropping them.
- Mailbox sync: `GET /restapi/v1.0/account/~/extension/{id}/message-sync?syncType=ISync&syncToken=…` (FSync on first run or token loss, `dateFrom` = enrollment start or 7 days), Light group. Store token + coverage in `sales_intelligence_sync_state` scope `rep_sms:<extensionId>` with `known_complete_through` only when the sync completed without error.
- **Safety poll every 5 minutes per mailbox during staffed hours**, staggered, because update events carry no ids and dropped deliveries are not replayed.
- Upsert `ringcentral_rep_sms_evidence` keyed by account + owning extension + message id. Metadata only (no bodies). Map status: `Sent`/`Delivered` → credit (sent time = `creationTime` unless a better sent timestamp is proven); `Queued` → none; `SendingFailed`/`DeliveryFailed` → revoke + recompute (P07d). Inbound `Received` → history + Last interaction only.
- Sender/origin (P07e): owning extension = the reviewed rep's mailbox. A message from a shared/company number, or one whose owner extension is not a reviewed `sales_rep`, is `pending_identity`. Automated Lead Messages (`lead_messages`) are a different system and never rep credit.
- Association: the counterpart number → `contact_numbers` → unique attached Lead (IMPL-07).

## 6. Proof the operator must run before SMS cadence is enforced (E01)

A read-only script (`ops/ringcentral/prove-rep-sms-access.ts`, written in SRV-5) against production, run by the user:

1. `GET /restapi/v1.0/account/~/extension/{repExt}/message-store?messageType=SMS&perPage=1` for each reviewed rep → expect 200 (not 403).
2. `GET …/message-sync?syncType=FSync&recordCount=1` → expect 200 and a `syncToken`.
3. Confirm one SMS the rep sent from the RingCentral app today appears with `direction: Outbound` and `messageStatus: Sent`.
4. Dry-validate the subscription body (no create). Creating the subscription is a separate, user-authorized step.

Until it passes, `controls.rep_sms_capture_enabled` stays false and the desk shows SMS as `pending — RingCentral SMS not connected`. Calls and the 100-call goal do not depend on it.

## 7. Cron and budget plan (≈10 reps, ≈1,000 calls/day account-wide, 12 staffed hours) [inferred]

| Cron / job | Schedule (UTC cron; NY gate in handler) | Group | Requests/hour |
| --- | --- | --- | --- |
| Call Log ISync (new lane) | `* * * * *`, runs 07:45–20:30 NY | Heavy (high lane) | ~60 |
| Window reconcile (existing) | `3-59/5 * * * *` | Heavy | ~24–36 |
| `call_log_refresh` (narrowed) | per unconfirmed call | Heavy (low lane) | ~5–10 |
| Nightly sweep (existing) | `40 7 * * *` | Heavy | burst, off-hours |
| SMS mailbox sync (webhook-driven, debounced) | event | Light | ~100–200 |
| SMS safety poll | `*/5` per mailbox, staggered | Light | ~120 |
| Subscription renew/filter check | `15 6 * * *` + on rep-set change | Light/Medium | ~0 |
| Desk evaluate / dirty / revision reconcile / entity_changes tail | `* * * * *` / `*/5` | none (Mongo) | 0 |

Heavy ≈ 95–105/h, about 17% of 600/h and steady (today peaks 110–150/h). Light ≈ 220–320/h, about 10% of 3,000/h. Add a budgeted **`light` lane** to `rateLimitGate.ts` (e.g. 40/min high, 10/min low) and honour `Retry-After`. Faster crons do not create provider capacity; backfill only uses spare capacity.

## 8. Honest states on the desk

| State | Calls | SMS |
| --- | --- | --- |
| `confirmed` | Terminal and present in Call Log | `Sent`/`Delivered` in a completed mailbox sync |
| `awaiting confirmation` | Webhook seen, Call Log not yet | Event seen, sync pending |
| `pending` (not a miss) | Deadline passed but `known_complete_through` < deadline + 2 min, an open gap, or webhook-silence flag | Mailbox `known_complete_through` < deadline, or last good sync > 10 min |
| `missed` | Only when coverage is complete past the deadline | Same |

As built (Outreach lifecycle repair, deployed 2026-10-06, engine `sod-engine-v2`, decision D-A1b): the "pending" row above is the obligation's outcome, not the channel status the desk shows. A passed deadline that only coverage cannot prove yet shows **`due`** with `verification.state: unverified` ("Due — not yet verified"; the Lead stays in Needs contact); the channel status `pending` is kept for evidence uncertainty (unconfirmed evidence that could fulfil the deadline, or no coverage for the channel). Coverage for verdicts = the provisional-capped Call Log `known_complete_through` minus the settlement allowance (`evidence.call_settlement_allowance_minutes`, default 2), never past the contact-event derivation watermark; the evaluate cron re-evaluates a waiting row as soon as that coverage passes its deadline (`coverage_wait`). SMS coverage = the worst **current** reviewed `sales_rep` mailbox (retired mailboxes are left out). As built, webhook silence does not hold a deadline back; it only affects the header below.

Header: "Calls updated 20 s ago" (min of last webhook receipt and last ISync success), "SMS delayed" (worst reviewed mailbox), "Granot observed 4 min ago" (latest accepted observation).

**Freshness source as built (A3-fresh, 2026-10-06; `reads/freshness.ts`).** Thresholds are runtime configuration (`deskTimingOf`; defaults in brackets).

- Calls confirmation instant `last_confirmation_at` = the later of the minute ISync lane's `isync_lane.last_success_at` and the 5-minute reconcile's own Call Log Sync success (`reconcile_sync_success_at`; a run in sync mode `shadow` or `off` never confirms). Both stamps are sticky: a run that stores no token leaves the previous success in place. Outside staffed hours only the reconcile confirms.
- `last_webhook_at` = the newest stored telephony webhook receipt. Inside the staffed window [07:45, 20:30) New York, once today's call webhook stream has started, "Calls updated" = min(confirmation, newest webhook). Before the day's first call webhook, and outside the window, it is the confirmation alone.
- `fresh` needs all of: confirmation within `evidence.capture_freshness_tolerance_minutes` [10]; coverage — max(`observed_complete_through`, `known_complete_through`), the observed watermark has no provisional-row cap (decision D-A3 extended to the header) — within `evidence.today_coverage_tolerance_minutes` + `evidence.call_settlement_allowance_minutes` [25 + 2]; and, once today's stream has started, the newest webhook within `evidence.webhook_silence_minutes` [30].
- Otherwise `delayed` with the first `reason` that applies: the reconcile's error code, `confirmation_stale`, `coverage_behind`, `webhook_silent`. `unknown` (`no_capture_state`) with neither a confirmation nor a watermark. `webhook_silent` never fires before the first call webhook of the day; a missing, expired, blacklisted or refused subscription is reported by the 5-minute health rows `webhook_subscription_health:{calls,rep_sms}`, not by the chip.
- SMS: `not_connected` while `controls.rep_sms_capture_enabled` is off; otherwise the worst current reviewed mailbox, `fresh` within the capture freshness tolerance; `freshness.sms.pending` counts SMS events of the last 7 days still waiting for a reviewed sender or a Lead.

## 9. Code deltas (owned by SRV-5)

1. `webhook-subscription-lifecycle.ts`: 10-year cap; `verificationToken`; `purpose: calls|rep_sms`; filter-set reconcile for `rep_sms`.
2. `routes/ringcentral-webhook.routes.ts` / `numberActivity/webhookFanout.ts`: verify token; route message-store receipts to the SMS sync intent.
3. New `services/ringcentral/repSms/` (sync client, mapper, coverage) + `ringcentral_rep_sms_evidence` model.
4. `numberActivity/reconcileCallLog.ts` / `callLogClient.ts`: extract ISync into the minute lane; `callLogRefresh.ts` narrowed.
5. `rateLimitGate.ts`: `light` lane; add Active Calls / account presence to the Heavy regex for safety.
6. Mocks for every provider call; no test reaches RingCentral.
