---
type: Service
title: Lead Messaging
description: Persist and dispatch outbound confirmation SMS for public Form Leads and Granot create-if-missing Leads.
tags: [lead-messaging, form-lead]
status: draft
stale_after: 2026-09-21
resource: src/services/leadMessaging/leadMessaging.service.ts
applies_to:
  - src/services/leadMessaging/leadMessaging.service.ts
  - src/services/leadMessaging/granotCreatedLead.ts
  - src/services/leadMessaging/quietHours.ts
  - src/services/leadMessaging/leadMessagingQueue.service.ts
  - src/config/domain/leadMessaging.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/leadMessaging/leadMessaging.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T00:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Primary code:** `src/services/leadMessaging/leadMessaging.service.ts`, `src/services/leadMessaging/granotCreatedLead.ts`, `src/config/domain/leadMessaging.ts`  
**Domain terms used:** [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Lead Messaging

**System of Record:** MongoDB `lead_messages` (`LeadMessage`). Twilio is the provider, not the authority.

**Role:** Persist outbound SMS intent, then dispatch or queue after the caller’s Mongo transaction commits. Two purposes exist: public-form quote confirmation and Granot create-if-missing confirmation. Voice forwarding (`twilioVoice.ts`) is a separate webhook helper, not a Lead Message.

## HTTP / queue / cron

| Surface | Path | Function |
|---------|------|----------|
| Form create | `POST /api/v1/form-leads` | `persistLeadMessageIntent` in the Form Lead transaction; `dispatchOrQueuePersistedLeadMessage` after commit ([`form-lead.md`](./form-lead.md)) |
| Granot create-if-missing | `createLeadFromGranot` finalize | `sendGranotCreatedLeadConfirmation` after Sheet Sync finalize ([`processor.md`](../granot-lifecycle/processor.md)) |
| Admin list / detail | `GET /api/v1/admin/lead-messages`, `GET /api/v1/admin/lead-messages/:id` | `listLeadMessages` (omits `body` / attempts / history), `getLeadMessage` |
| Admin retry | `POST /api/v1/admin/lead-messages/:id/retry` | `requestLeadMessageRetry` → 202 |
| Provider callback | Twilio message-status webhook | `applyTwilioStatusCallback` |
| Queue | `api/queues/lead-messaging-consumer.ts` | `runLeadMessagingDrain("queue")` |
| Cron | `ALL /api/cron/lead-messaging-drain` | `runLeadMessagingDrain("cron")` (`CRON_SECRET`) |

`LEAD_MESSAGING_MODE` is `disabled` (default / unknown), `inline`, or `queued`. Queue publish is gated by `shouldPublishLeadMessagingQueue()` (Vercel runtime plus matching `VERCEL_ENV`); Mongo still owns drain order. Test runner never sends; `TEST_MODE` also blocks unless `LEAD_MESSAGING_ALLOW_TEST_MODE=true` outside the runner.

## Happy path — public Form Lead

1. Route parses `sms_consent`. Only boolean `true` (or the Zod true parse) continues.
2. `createFormLead` forces a transaction when consent is true and messaging is allowed in this runtime.
3. `persistLeadMessageIntent` writes `origin=public_form`, `purpose=quote_request_confirmation`, server-owned copy from `buildLeadConfirmationMessage` (template v2). Destination is normalized to E.164 when the digits are a safe US 10/11-digit shape.
4. After commit, `dispatchOrQueuePersistedLeadMessage` either `dispatchPersistedLeadMessage` (`inline`) or `queueInitialLeadMessage` (`queued`). Dispatch failure is isolated: Form create still returns 201 with `messaging_status`.

## Skip / fail paths — persist

| Condition | Result |
|-----------|--------|
| `TEST_MODE` and not the allow-test escape hatch | `null` (no row) |
| Public form and `sms_consent` is not `true` | `null` (no row) |
| Duplicate Form Lead | row `status=skipped`, `skip_reason=duplicate_lead` |
| Mode `disabled` | row `skipped` / `messaging_disabled` |
| Capacity / destination guard | row `skipped` with `invalid_destination`, `country_not_allowed` (default prefix `+1`), `hourly_capacity_reached` (default 200/hour), or `destination_cooldown` (default 15 minutes) |

Skipped rows are never dispatched.

## Dispatch

`dispatchPersistedLeadMessage` claims `pending` / `queued` / `retry_scheduled` → `sending` with a 60s lease. Mode `disabled` or test-mode block returns `{ status: "disabled" }` without calling Twilio.

Quiet hours stay off unless `LEAD_MESSAGING_QUIET_HOURS_ENABLED=true`. When on and the America/New_York hour is before 7, the Twilio create still happens immediately with Message Scheduling `sendAt` = 8:00 AM that Eastern calendar day. Requires `TWILIO_MESSAGING_SERVICE_SID` and a SendAt inside Twilio’s 15-minute / 35-day window; missing SID or an out-of-window SendAt fails closed. This is not a cron / `next_attempt_at` delay. 7:00 AM Eastern and later send immediately.

| Provider / helper outcome | Persisted status |
|---------------------------|------------------|
| Twilio accepted / scheduled | `accepted` (`sent` only if provider already says `sent`) |
| Lease expired after Twilio accepted | `uncertain` |
| Persist of accept fails | `uncertain` |
| 429 / `ECONNREFUSED` / `ENOTFOUND` / `EAI_AGAIN` and attempts `< 4` | `retry_scheduled` + wakeup |
| Timeout / 5xx / `ECONNRESET` | `uncertain`, **not** auto-retried |
| Other Twilio errors | `failed` |
| Expired `sending` lease on drain | `uncertain` |

If `dispatchOrQueuePersistedLeadMessage` throws after Twilio already accepted, it re-reads the row and returns that status instead of `failed` when the row left the in-flight set. A later `recordMessagingEvent` failure cannot flip an accepted outcome.

Status callbacks apply only to the current `twilio_message_sid` and never move backward. `scheduled` is rank 1 (may advance to queued, sent, or failed). Terminal `delivered` / `read` / `failed` / `undelivered` / `canceled` ignore later callbacks. Sid-mismatch history is recorded but does not change `status`.

## Happy path — Granot create-if-missing

`createLeadFromGranot` always attaches an `sms` payload in `pending`. Finalize calls `sendGranotCreatedLeadConfirmation` after Sheet Sync and swallows throws so a failed text never affects the created Lead.

All six gates must pass, first blocker wins:

1. `LEAD_MESSAGING_MODE` is not `disabled`
2. `GRANOT_LEAD_CREATED_SMS_ENABLED` is an explicit boolean `true`
3. CRM Source `lead_created_policy === create_if_missing` (`link_only` never texts)
4. `GranotCrmSource.outbound_sms.enabled === true`
5. `consent_basis` is not `not_attested`
6. Destination phone is present (capacity still runs inside persist)

Body uses the CRM Source template (placeholders `{first_name}`, `{company}` only) and always appends `Reply STOP to opt out.` Duplicate unique-index (`11000`) returns `already_sent`. Invalid ObjectIds return `blocked:invalid_refs` without persist. Granot persist does **not** require Form `sms_consent`; it stores `lead_ref` (Form or Call) and only sets `form_lead` for Form Leads.

## Manual retry

`requestLeadMessageRetry` accepts only `failed` / `undelivered` rows with no Twilio SID, `manual_retry_count < 3`. Otherwise 409 (`ConflictError`): already has a SID (reconcile, do not retry), retry limit, or wrong status.

## Related services

- [`form-lead.md`](./form-lead.md) — when create persists intent
- [`domain-commands.md`](./domain-commands.md) — Granot create finalize
- [`operations-registry.md`](./operations-registry.md) — CRM Source `outbound_sms` writes
