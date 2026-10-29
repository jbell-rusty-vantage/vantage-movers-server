# routes-booking-reconciliation-cron

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/booking-reconciliation-cron.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: the router/default export.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

2. **Rematch defaults on.** `autoRematchEnabled` is `env !== "false"`. Already-recommended RingCentral Call Log / snapshot flags default **false**. Knowledge locks this default. Do not default rematch off so “this desk matches Call Log dormant deploy.”

3. **`getBookingReconciliationConfig()` parses reasons / delays / batch before the flag branch.** A disabled tick with a bad `BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS` still throws (unknown reason / empty list). That throw is unhandled Express. Do not split `autoRematchEnabled` into its own reader in this rename so “disabled never parses reasons” without a paired HTTP proof that Wave A rematch and submit still share one config object. Park the parse.

6. **There is no factory inject.** Already-recommended Call Log AC-17 **asks** `createRingCentralCronRouter`. Today’s harness mounts the live default and only proves auth. Disabled skip is already testable by setting `BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED=false` — `getBookingReconciliationConfig` reads env at request time, and this file will not **ask** rematch. Do not add `createBookingReconciliationCronRouter` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default. Add the disabled-skip proof at this **interface**.

7. **`requireCronAuth` is a copy of sibling crons.** Sheet-sync / RingCentral / lead-messaging / Granot lifecycle use the same Bearer-or-header 500/401. Reporting 503s `"CRON_SECRET is not configured."` CPL uses `"CRON_SECRET is not configured"`. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** desk **and** the siblings. Park the copy.

11. **This desk never uses `x-api-secret`, Owner HMAC, Granot webhook secret, Twilio signature, RingCentral Validation-Token, or live-host `x-debug-token`.** `app.ts` mounts **before** `v1Routes`. `CRON_SECRET` is the handshake. Do not remount `requireApiSecret` so “it matches reporting.” Do not hide this ALL behind Owner HMAC so “cron matches leftover admin.”

14. **Leave sibling modules alone.** `runDueBookingLeadRematches` / `getBookingReconciliationConfig` are already the right **depth**. This file orchestrates the HTTP **adapter**.

## Current endpoint contract restored

ALL `/api/cron/booking-reconciliation-rematch` is mounted by app before v1. Bearer CRON_SECRET or x-cron-secret is accepted; missing secret is 500 “CRON_SECRET is not set”, wrong credential 401. It parses the full config before checking autoRematchEnabled, then returns 200 skipped with “auto rematch disabled”, or calls runDueBookingLeadRematches({ actor: "cron" }) and returns summary. There is no route catch around config/drain errors. Keep default-on behavior and the separation from Owner reconciliation commands.

This is source inspection, not evidence that HTTP/provider tests ran. Preserve the existing error punctuation and status when migrating callers.
