# routes-sheet-sync-cron

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/sheet-sync-cron.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: the router/default export.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

1. **The route refuses when mode is not queued; the drain does not.** This file **200** `{ skipped: true }` and never **asks**. Wave A drain still runs if the consumer or Admin retry reach it on a legacy host. Wave A drain already said leave both. Do not add `getSheetSyncMode()` inside `runSheetSyncDrain` so “disabled never drains.” Do not delete this fence so “the service already checked.”

2. **Mode defaults to `legacy`.** Unknown values fall back to `legacy`. `queued` is opt-in. Already-recommended rematch defaults **on**. Already-recommended RingCentral flags default **false**. Knowledge locks this default so a deploy without the env still uses `waitUntil`. Do not default queued so “the safety net always claims.” Do not treat unknown as `disabled` so “nonsense looks like a kill switch.”

7. **There is no factory inject.** Already-recommended Call Log AC-17 **asks** `createRingCentralCronRouter`. Today’s harness mounts the live default and proves auth plus non-queued skip. Disabled / legacy skip is already testable by setting `SHEET_SYNC_MODE` — `getSheetSyncMode` reads env (and runtime override) at request time, and this file will not **ask** drain. Do not add `createSheetSyncCronRouter` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

8. **`requireCronAuth` is a copy of sibling crons.** Rematch / RingCentral / lead-messaging / Granot lifecycle use the same Bearer-or-header 500/401. Reporting 503s `"CRON_SECRET is not configured."` CPL uses `"CRON_SECRET is not configured"`. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** desk **and** the siblings. Park the copy.

12. **Admin retry has no mode gate; this tick does.** Health **shows** mode. Retry still starts the drain. The consumer also **asks** drain whenever it runs. Do not add `SHEET_SYNC_MODE` onto Admin retry so “retry matches cron.” Do not delete this fence so “every start matches retry.”

13. **This desk never uses `x-api-secret`, Owner HMAC, Granot webhook secret, Twilio signature, RingCentral Validation-Token, or live-host `x-debug-token`.** `app.ts` mounts **before** `v1Routes`. `CRON_SECRET` is the handshake. Do not remount `requireApiSecret` so “it matches Admin retry.” Do not hide this ALL behind Owner HMAC so “cron matches leftover admin.”

16. **Leave sibling modules alone.** `runSheetSyncDrain` / `getSheetSyncMode` are already the right **depth**. This file orchestrates the HTTP **adapter**.

## Current endpoint contract restored

ALL `/api/cron/sheet-sync-drain` uses CRON_SECRET Bearer or x-cron-secret (missing 500, wrong 401). Mode is read before drain: anything except queued returns 200 skipped with the resolved mode in reason. Queued invokes runSheetSyncDrain("cron"), returning 200 skipped false with summary, or 500 with current Error.message/fallback. This route never equates HTTP success with a finished Sheet projection; job outcomes and durable intent remain authoritative.

This is source inspection, not evidence that HTTP/provider tests ran. Preserve the existing error punctuation and status when migrating callers.
