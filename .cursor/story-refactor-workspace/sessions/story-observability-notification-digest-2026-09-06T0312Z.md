# Session story-observability-notification-digest-2026-09-06T0312Z

- Date (UTC): 2026-09-06T03:12Z
- Service / module: `observability` / `notificationDigest.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/193

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 26 / 1 / 11
- Recommendations on disk: 190 (garbage digest file present from a failed write; overwritten this pass)
- Current service / next module (TRAVERSAL): `observability` (in-progress) / `notificationDigest.service.ts`

This checkout held the lock in `NOW.md` from the start of the run (`2026-09-06T03:12:16Z`). Disk on `docs/story-refactor` at `aa40c29` already had 190 clean recommendations through `observability-operational-reports.md`. PR #192 was already merged.

## This pass

- opened new service?: no
- path or skip: recommended `notificationDigest.service.ts` → [recommendations/observability-notification-digest.md](../recommendations/observability-notification-digest.md)
- operations named: email the owner this morning’s Observational card (`sendDailyOwnerDigest`: skip `digest_disabled` / `no_recipients`; ask `getObservabilityOverview({})` Eastern SOD → now; stamp one `daily_digest` Delivery row; map `skipped` / `reason` / `sent`); retry recently failed Delivery rows on the same row (`retryFailedNotifications`: email-off → `retried: 0`; else 24h / `attempt_count < 3` / due `next_attempt_at` / limit 25 / no purpose filter; count only in-place `ok`). Not leftover named reports, not `digest_sent_at`, not leftover SendGrid math.
- remaining in this service: none (`observability` visited)

## Stock at end

- Visited / in-progress / unvisited: 27 / 0 / 11
- Current service / next module: `reporting` (unvisited) / enumerate `src/services/reporting/`

## Messages posted

- 2026-09-06T0312Z next-run

## Ideas parked

- none

## Contradictions

- File comment says last day’s health. Letter window is Eastern SOD → now. Retry is last 24h on Delivery `createdAt`.
- `digest_sent_at`, near-worthy digest env, and `getAlertEmailDailyDigestCronTime()` are unused.
- `overall_status` is `critical` / `degraded` / `healthy`; open warnings do not move the subject.
- In-place retry does not re-check `status === "failed"`; this find is the gate.
- Card throw skips retry; skipped/failed letter does not.
- No Observability Service. Rule `.cursor/rules/observability-service.mdc` is the software map.
- This checkout’s `CONTEXT.md` does not define a morning letter. `docs/adr/` is absent.
- No `notificationDigest.service.test.ts`.
