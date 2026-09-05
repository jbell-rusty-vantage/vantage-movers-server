# Session story-observability-email-notification-2026-09-05T2212Z

- Date (UTC): 2026-09-05T22:12Z
- Service / module: `observability` / `emailNotification.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/188

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 26 / 1 / 11
- Recommendations on disk: 185
- Current service / next module (TRAVERSAL): `observability` (in-progress) / `emailNotification.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-b8b5` with a stale seed (NOW pointed at unvisited `observability` / enumerate / 184 recs / PR #186). Checked out `docs/story-refactor` before choosing the module. Disk already had `observability-record-operational-event.md`, lock none, `observability` in-progress, next `emailNotification.service.ts`. PR #187 was already open.

## This pass

- opened new service?: no
- path or skip: recommended `emailNotification.service.ts` → [recommendations/observability-email-notification.md](../recommendations/observability-email-notification.md)
- operations named: deliver this operational email (`sendNotification`: leftover disabled / leftover no-recipients / leftover no-from skip without a row; otherwise one leftover `sending` row; leftover `log_only` marks leftover `sent` with no provider; leftover `sandbox` / leftover `live` call SendGrid; never throws; never writes an Operational Event); retry this failed email on the same row (`retryNotificationDeliveryInPlace`: leftover `$inc attempt_count` on the same leftover `_id`; never a second row)
- remaining in this service: `notificationPolicy.ts`, `operationalIncident.service.ts`, `adminObservability.service.ts`, `operationalReports.service.ts`, `notificationDigest.service.ts`

## Stock at end

- Visited / in-progress / unvisited: 26 / 1 / 11
- Current service / next module: `observability` (in-progress) / `notificationPolicy.ts`

## Messages posted

- 2026-09-05T2212Z next-run

## Ideas parked

- none

## Contradictions

- No `docs/knowledge/services/` Observability Service. Rule `.cursor/rules/observability-service.mdc` is the software map. Already-recommended `granotLifecycle/observability.ts` is a different catalog.
- Leftover `getEmailProvider()` is stored on the row; leftover `sendViaSendgrid` is the only provider talk.
- Leftover skip (disabled / no-recipients / no-from) returns leftover `cancelled` without a leftover `NotificationDelivery`.
- Leftover `log_only` is leftover `sent` and leftover `ok: true`, so later policy advances leftover Incident throttle.
- Leftover `connectMongo` runs on the first try, not on leftover retry.
- Leftover purpose `weekly_report` / leftover `test` are config only; this file does not send them.
- Barrel re-exports leftover `sendNotification`, not leftover `retryNotificationDeliveryInPlace`.
- No `emailNotification.service.test.ts`. Leftover config tests cover leftover mode defaults only.
- This checkout’s `CONTEXT.md` does not define Notification Delivery. `docs/adr/` is absent.
