# Observability Service Review Report

Reviewed scope:

- `api/services/observability/`
- `api/config/domain/observability.ts`
- `api/routes/notification-cron.routes.ts`

Review focus: whether operational events are reliably captured, whether the intended observability Mongo collections are created/populated, and whether incidents, notifications, reports, and metrics derived from those events behave correctly.

## Executive Summary

The observability layer has a solid foundation: writes are best-effort, collection names are resolved consistently through `getObservabilityModel()`, events are sanitized before persistence, incidents are deduped, and admin reads/reports use the same model accessors as the writer.

The main functional risks are not in basic event insertion; they are around missing or skewed downstream capture/metrics:

- The configured `rollups` collection is never modeled or populated, so `operational_event_rollups` will not be created and no persisted rollup metrics are generated.
- Notification retry can fan out duplicate failed delivery records and can inflate sent/failed delivery metrics.
- Incident severity can remain stale if an existing deduped incident escalates from `warn`/`error` to `critical`.
- The notification cron route logs failures but does not record operational events/incidents for digest or retry job failures.
- Some capture flags are defined but not honored, especially slow-request capture and owner-event capture.

I would fix the high-priority items before updating project documentation, because the docs should reflect whether metrics are computed on demand only or also persisted to rollup collections.

## High-Priority Findings

### 1. Configured rollup collection is never created or populated

`observability.ts` defines a `rollups` collection key and names:

- Production: `operational_event_rollups`
- Test: `test_operational_event_rollups`
- Custom env: `OBSERVABILITY_ROLLUPS_COLLECTION`

However, there is no `OperationalEventRollup` model, no service that writes rollups, and no report/admin path that reads rollups. All current metrics are computed on demand from `operational_events`, `operational_incidents`, and `notification_deliveries`.

Impact:

- The expected rollup collection will not exist until something writes to it, and nothing currently does.
- Any documentation or admin expectations around persisted rollup metrics would be incorrect.
- Longer-term overview/report queries may become expensive as `operational_events` grows.

Recommended change:

- Either remove `rollups` from the collection config until it is implemented, or add an `OperationalEventRollup` model and a rollup job/service that aggregates by time bucket, level, category, workflow, event key, source company, and environment.
- If rollups are intentionally deferred, document that all current metrics are live aggregations, not persisted rollups.

### 2. Failed notification retry can duplicate delivery records and skew metrics

`retryFailedNotifications()` finds failed delivery records, then calls `sendNotification()`. `sendNotification()` always creates a new delivery record for the retry. After that, `retryFailedNotifications()` also mutates the original failed record:

- On retry success, the original failed record is marked `sent`, while the new retry delivery is also `sent`.
- On retry failure, the original remains failed and a new failed record also exists.
- Future retry runs can pick up both the original and newly-created failed retry records, increasing the retry set over time.
- The retry body uses `body_text_preview`, so retry emails may send a truncated 500-character body instead of the original full body.

Impact:

- Notification delivery metrics can overcount sent or failed emails.
- Retry attempts can fan out duplicate failed records.
- Audit history becomes ambiguous because an originally failed provider attempt can later be marked `sent`.
- Retried digest/alert email body content may be incomplete.

Recommended change:

- Store enough payload to retry safely, or explicitly mark retries as child attempts linked to the original.
- Do not mark the original failed delivery as `sent`; instead set it to `cancelled`/`superseded` or keep it failed with `next_attempt_at` and update only attempt metadata.
- Prefer retrying in-place through a lower-level provider send function, or add fields like `parent_delivery_id`, `last_attempt_at`, `next_attempt_at`, and `retry_of`.

### 3. Deduped incident severity does not escalate

`upsertIncidentForEvent()` sets `severity` only in `$setOnInsert`. If the first event for a fingerprint is `warn` and a later event with the same fingerprint is `error` or `critical`, the incident stays at the original lower severity.

Impact:

- Open incident counts by severity can understate current severity.
- `getObservabilityOverview()` can report `healthy` or `degraded` when a deduped incident has actually escalated to critical.
- Immediate notification policy may still send for the event, but the incident list and owner overview remain misleading.

Recommended change:

- On update, compare current severity rank with incoming severity and store the worse severity.
- Add a regression test for warn-to-critical escalation on the same fingerprint.

### 4. Notification cron failures are not captured as operational events

`notification-cron.routes.ts` catches errors from `sendDailyOwnerDigest()` and `retryFailedNotifications()` and returns a 500 response, but it only logs with pino. It does not call `recordOperationalEvent()`.

Impact:

- Digest/retry cron failures do not create `operational_events`.
- They do not upsert incidents.
- They do not appear in admin observability metrics except as raw logs.
- The notification policy already has developer-only event keys for `cron.trigger.failed` and `cron.auth.failed`, but this route does not emit those events.

Recommended change:

- Record an error event when the digest/retry job throws, for example `notification.digest_cron.failed` or `cron.notification_digest.failed`, category `cron` or `notification`, workflow `notification_digest`.
- Consider recording unauthorized attempts as `cron.auth.failed` with `notificationCandidate: false`, similar to the API secret middleware pattern.

## Medium-Priority Findings

### 5. Some observability config flags are defined but unused

These functions exist in `observability.ts` but are not fully wired into capture paths:

- `getObservabilitySlowRequestMs()` is not used by `httpLogger` or route error handling. Slow successful requests are never captured as operational events.
- `shouldCaptureOwnerEvents()` is defined but not used. Owner-worthy lifecycle events such as `booking.created`, `cancellation.created`, and `lead.form.created` are controlled indirectly by info-level persistence and notification owner event config.

Impact:

- Operators may believe slow requests or owner event capture can be configured, but the flags do not currently affect behavior.
- Setting `OBSERVABILITY_CAPTURE_INFO_EVENTS=false` or raising `OBSERVABILITY_EVENT_MIN_LEVEL` can suppress important owner-facing success milestones.

Recommended change:

- Add slow request capture in HTTP middleware or a response-finish hook, gated by `OBSERVABILITY_CAPTURE_HTTP_5XX` or a new explicit slow-request flag.
- Use `shouldCaptureOwnerEvents()` around owner lifecycle instrumentation, or remove the flag if owner events are intentionally governed only by event level.
- Consider a separate persistence path for configured owner events so owner milestones are not accidentally disabled with general info-noise reduction.

### 6. Report aggregations limit before deterministic sorting

Several report pipelines aggregate groups, apply `$limit: MAX_ROWS`, and only then sort in application code. Mongo can return arbitrary groups before the limit, so high-volume groups can be excluded if there are more than 5,000 groups.

Impact:

- Reports can miss top offenders in large datasets.
- `result_hash` remains deterministic for returned data, but the returned data may not be the true top rows.

Recommended change:

- Add `$sort` before `$limit` in aggregation pipelines, using the primary count metric descending and a stable secondary key where practical.

### 7. Top open incident sorting uses string severity order

`getObservabilityOverview()` sorts top open incidents with `{ severity: -1, last_seen_at: -1 }`. Since severity is stored as strings, this sorts lexicographically rather than by severity rank. `warn` can appear before `error` and `critical`.

Impact:

- The overview's `top_open_incidents` list can prioritize warnings over critical incidents.

Recommended change:

- Add a numeric severity rank field in the aggregation, or sort in application code with `critical > error > warn`.

### 8. Notification throttle is marked as sent even if sending fails

`dispatchEventNotifications()` calls `markIncidentNotified()` after `sendNotification()` regardless of `result.ok`. If the provider send fails, the incident's `next_notify_at` is still advanced.

Impact:

- A failed immediate notification can suppress follow-up alerts for the throttle window.
- The separate `notification.email.failed` event is recorded, but the original incident may not retry immediate notification promptly.

Recommended change:

- Only call `markIncidentNotified()` when `result.ok` is true.
- On failed sends, either leave `next_notify_at` unchanged or set a shorter retry-oriented delay.

## Lower-Priority Findings

### 9. Custom collection mode throws from config resolution inside best-effort write path

When `OBSERVABILITY_COLLECTION_MODE=custom` and a required collection env var is missing, `getObservabilityCollectionNames()` throws. In `recordOperationalEvent()` this is caught and logged, so business workflows continue. In admin/report read paths the same error will surface to the API caller.

Impact:

- This is acceptable fail-fast behavior, but startup diagnostics would be clearer if misconfiguration were detected before the first admin request or first event write.

Recommended change:

- Add a small startup/admin diagnostic endpoint or script that validates observability configuration and reports the resolved collection names.

### 10. Report input has `include_resolved`, but report definitions do not use it

`include_resolved` is normalized into filters, but report definitions mostly query events directly or count incidents without applying this flag.

Impact:

- Admins may expect `include_resolved` to change report output, but it currently has little or no effect.

Recommended change:

- Either apply the flag in incident-based reports or remove it from the report input until report definitions use it.

### 11. Notification delivery validation is looser than domain constants

The notification query schema accepts arbitrary trimmed strings for `status`, `purpose`, and `recipient_type`, while the model enums are stricter.

Impact:

- Invalid filters simply return no results instead of a validation error.

Recommended change:

- Use `NOTIFICATION_STATUSES`, `NOTIFICATION_PURPOSES`, and `NOTIFICATION_RECIPIENT_TYPES` in the query schema for better admin feedback.

## Positive Notes

- `recordOperationalEvent()` is appropriately best-effort and does not break business workflows.
- Event details are bounded and sanitized before persistence.
- Collection names are resolved at call time through `observabilityModelFactory`, so production/test/custom collection modes are consistently applied across the models that exist.
- The core event, incident, notification, and report-run schemas have useful indexes for the primary admin filters.
- Alert-loop prevention for `notification.*` events is present.
- Cron route authentication requires `CRON_SECRET` and accepts Vercel's bearer token format.

## Changes I Would Make First

1. Decide whether rollups are in scope now. If yes, implement `OperationalEventRollup` and a rollup writer/job. If not, remove or clearly mark the rollup collection config as reserved.
2. Fix notification retry semantics so retries do not create duplicate metric records or retry fan-out.
3. Update incident upsert to escalate severity for existing open/acknowledged incidents.
4. Record operational events for notification cron failures.
5. Wire or remove unused capture flags, especially slow request capture and owner-event capture.
6. Fix overview/report sorting so metrics prioritize true critical/high-count rows.

## Suggested Tests

- `recordOperationalEvent()` creates an event, incident, and notification delivery under enabled/log-only email mode.
- Repeated same-fingerprint events increment one incident and escalate severity to critical.
- Notification retry does not create duplicate retry candidates and does not mark an original failed attempt as sent.
- Notification cron failure records a `cron`/`notification` operational event.
- Report aggregations return the highest-count groups when more than `MAX_ROWS` groups exist.
- `OBSERVABILITY_CAPTURE_INFO_EVENTS=false` does not accidentally suppress explicitly configured owner lifecycle events, if that behavior is desired.
