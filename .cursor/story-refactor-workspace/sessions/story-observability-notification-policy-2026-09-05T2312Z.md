# Session story-observability-notification-policy-2026-09-05T2312Z

- Date (UTC): 2026-09-05T23:12Z
- Service / module: `observability` / `notificationPolicy.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / new PR after #188 merged

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 26 / 1 / 11
- Recommendations on disk: 186
- Current service / next module (TRAVERSAL): `observability` (in-progress) / `notificationPolicy.ts`

This checkout booted on `cursor/vantage-server-story-refactor-0314` with a stale seed (NOW pointed at `emailNotification.service.ts` / 185 recs / PR #187). Checked out `docs/story-refactor` before choosing the module. Disk already had `observability-email-notification.md`, lock none, `observability` in-progress, next `notificationPolicy.ts`. PR #188 was already merged.

## This pass

- opened new service?: no
- path or skip: recommended `notificationPolicy.ts` → [recommendations/observability-notification-policy.md](../recommendations/observability-notification-policy.md)
- operations named: ask whether the owner or a developer should hear about this happening right now (`dispatchEventNotifications`: leftover `notification.*` / leftover category `notification` stay quiet; leftover owner-event list or leftover immediate level or leftover min-level + leftover `notification_candidate` emails leftover owner or leftover developer; leftover Incident `next_notify_at` in the future leftover-suppresses; leftover throttle only after leftover `ok: true`; never throws; never writes an Operational Event)
- remaining in this service: `operationalIncident.service.ts`, `adminObservability.service.ts`, `operationalReports.service.ts`, `notificationDigest.service.ts`

## Stock at end

- Visited / in-progress / unvisited: 26 / 1 / 11
- Current service / next module: `observability` (in-progress) / `operationalIncident.service.ts`

## Messages posted

- 2026-09-05T2312Z next-run

## Ideas parked

- none

## Contradictions

- No `docs/knowledge/services/` Observability Service. Rule `.cursor/rules/observability-service.mdc` is the software map. Already-recommended `granotLifecycle/observability.ts` is a different catalog.
- Leftover `observability-review-report.md` still claims leftover `markIncidentNotified` runs regardless of leftover `ok`. Current code is leftover `if (incident && result.ok)`.
- Leftover `ALERT_EMAIL_OWNER_EVENTS` defaults empty. Leftover `DEVELOPER_ONLY_EVENT_KEYS` is hardcoded.
- Leftover developer `to` falls back to leftover owner `to`.
- Leftover `info` owner milestones have leftover `incident: null`, so leftover throttle never starts.
- Failed leftover send does not start leftover `next_notify_at`; leftover digest leftover-retries the leftover delivery row instead.
- Barrel re-exports leftover `dispatchEventNotifications`. Only leftover record calls it by path.
- No `notificationPolicy.test.ts`. Leftover config tests cover leftover env defaults only.
- This checkout’s `CONTEXT.md` does not define immediate owner email. `docs/adr/` is absent.
