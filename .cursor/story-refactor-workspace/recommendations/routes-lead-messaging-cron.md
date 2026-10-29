# routes-lead-messaging-cron

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/lead-messaging-cron.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: the router/default export.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

1. **This desk has no mode gate; Sheet Sync’s cron does.** Already-recommended Sheet Sync **200** `{ skipped: true }` and never **asks** drain unless `queued`. This file always **asks** `connectMongo` then drain. Wave A drain no-ops only when `disabled` / test-mode. Inline leftover `pending` and `retry_scheduled` still must send. Do not copy the Sheet Sync queued-only fence here so “every five-minute desk matches.” Do not add `getLeadMessagingMode()` on this route so “disabled never opens Mongo” without a paired HTTP proof that `inline` still drains leftover `pending`.

8. **`connectMongo` lives on this desk and on the consumer, not inside Wave A drain.** Already-recommended Sheet Sync drain connects itself; that cron does not. SMS status also connects before apply. Do not move `connectMongo` into `runLeadMessagingDrain` in this rename so “every caller matches Sheet Sync” without a paired consumer + cron proof. Do not drop the connect so “drain already opened it.”

10. **`requireCronAuth` is a copy of sibling crons.** Rematch / RingCentral / Sheet Sync / Granot lifecycle use the same Bearer-or-header 500/401. Reporting 503s `"CRON_SECRET is not configured."` CPL uses `"CRON_SECRET is not configured"`. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** desk **and** the siblings. Park the copy.

14. **Inline leftover `pending` is why this tick must not copy Sheet Sync’s queued-only fence.** Persist writes `pending` when mode is `inline`, `queued` when mode is `queued`. After-commit inline may throw and Wave A containment can say `failed` while the row is still in-flight. Cron is the five-minute safety net for that leftover, for a missed wake-up, and for `retry_scheduled`. Do not refuse `inline` so “only queued hosts drain.”

15. **This desk never uses `x-api-secret`, Owner HMAC, Granot webhook secret, Twilio signature, RingCentral Validation-Token, or live-host `x-debug-token`.** `app.ts` mounts **before** `v1Routes`. `CRON_SECRET` is the handshake. Do not remount `requireApiSecret` so “it matches Owner retry.” Do not hide this ALL behind Owner HMAC so “cron matches leftover admin.” Do not accept `x-twilio-signature` so “one Twilio secret owns hybrid messaging.”

18. **Leave sibling modules alone.** `runLeadMessagingDrain` / `getLeadMessagingMode` are already the right **depth**. This file orchestrates the HTTP **adapter**.

## Current endpoint contract restored

ALL `/api/cron/lead-messaging-drain` accepts CRON_SECRET Bearer or x-cron-secret (missing 500 “CRON_SECRET is not set”, wrong 401), connects Mongo and calls runLeadMessagingDrain("cron"). Success returns 200 { ok, summary }; failure logs then currently echoes Error.message or “Lead messaging drain failed” at 500. Keep that actual envelope distinct from the fixed CPL/Granot error responses. Sending policy and claim ordering remain in the service.

This is source inspection, not evidence that HTTP/provider tests ran. Preserve the existing error punctuation and status when migrating callers.
