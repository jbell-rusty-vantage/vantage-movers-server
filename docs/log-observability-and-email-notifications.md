# Log Observability and Email Notifications Evolution

This document proposes the next evolution of logging and operational visibility for the Vantage Movers main server.

The goal is to make server behavior searchable, filterable, reportable, and alertable without losing the practical simplicity of the current Vercel-hosted Express API.

## Current State

The server already has a useful foundation:

- The API uses `pino` through `api/logger.ts` with JSON stdout logs, ISO timestamps, string log levels, `service`, `env`, and optional Vercel `region`.
- HTTP requests are logged through `api/middleware/httpLogger.ts`, including request IDs, method, route, status code, origin, user agent, content type, and response time.
- Service code emits named structured events through `msg`, for example `sheet_sync.drain.run_summary`, `ringcentral.call_log_sync.completed`, and `ringcentral.call_log_sync.failed`.
- Server-side route failures are mapped through `AppError` and logged with stable fields like `errorCode`, `statusCode`, `errorName`, and safe metadata.
- Sheet sync, RingCentral sync, queue consumer, and cron paths already create domain-specific summaries.
- Sensitive request headers are redacted, and some domain payloads have dedicated log-safe summaries.

The current gap is not that logs are missing. The gap is that logs are still mostly an execution trace inside Vercel stdout. They are not yet an operator-friendly event stream with explicit severity, ownership, notification rules, report queries, and searchable operational history.

## Target Outcome

The next version should let an operator answer these questions quickly:

- Did any critical workflow fail today?
- Which source company or route is causing errors?
- Are Google Sheet sync jobs backing up, failing, or being retried?
- Did RingCentral webhook, Call Log sync, or Analytics reconcile stop working?
- Are CRM submissions failing or timing out?
- Which errors need owner attention versus developer-only investigation?
- What should be included in a daily owner report?

The system should support three visibility layers:

- Developer logs: high-cardinality JSON logs emitted to stdout and visible in Vercel.
- Operational events: durable, indexed Mongo records for important business and infrastructure events.
- Notifications and reports: email alerts and digests generated from operational events.

## Recommended Architecture

Keep `pino` as the runtime logger, but add an application-owned operational event layer.

The important distinction:

- `logger.info(...)` remains for debugging, deployment logs, and local traceability.
- `recordOperationalEvent(...)` is used when an event should be searchable later, included in reports, or eligible for email notifications.

This avoids trying to turn every log line into a report row. Only events that matter operationally become durable records.

## Operational Event Model

Add a Mongo model under `api/models/OperationalEvent.ts`.

Suggested fields:

- `occurred_at`: Date of the event.
- `level`: `debug`, `info`, `warn`, `error`, or `critical`.
- `status`: `open`, `acknowledged`, `resolved`, `ignored`, or `auto_resolved`.
- `event_key`: Stable machine-readable name such as `sheet_sync.drain.failed`.
- `category`: Broad area such as `http`, `sheet_sync`, `ringcentral`, `crm`, `google_sheets`, `mongo`, `queue`, `cron`, `lead`, `booking`, or `notification`.
- `workflow`: More specific workflow such as `form_lead_create`, `call_lead_ingest`, `sheet_sync_drain`, `ringcentral_call_log_sync`, or `crm_submit`.
- `summary`: Short human-readable sentence.
- `details`: Small structured object safe for logs and reports.
- `entity_type`: Optional entity type such as `form_lead`, `call_lead`, `booked_lead`, `sheet_sync_job`, or `ringcentral_call`.
- `entity_id`: Optional Mongo ID or external ID.
- `lead_name`: Optional owner-facing lead/customer name when the event is tied to a lead workflow.
- `lead_phone`: Optional owner-facing lead/customer phone number when the event is tied to a lead workflow.
- `lead_email`: Optional owner-facing lead/customer email when the event is tied to a lead workflow.
- `source_company`: Optional company/source label.
- `route`: Optional HTTP route.
- `request_id`: Optional request ID from `pino-http`.
- `run_id`: Optional cron, queue, or sync run ID.
- `dedupe_key`: Optional key used to collapse repeated failures.
- `first_seen_at`: Date for the first event in a deduped incident.
- `last_seen_at`: Date for the latest event in a deduped incident.
- `count`: Number of times this incident has repeated.
- `next_notify_at`: Date used for notification throttling.
- `notified_at`: Date of the last successful notification.
- `resolved_at`: Date when resolved.

Recommended indexes:

- `{ occurred_at: -1 }`
- `{ level: 1, occurred_at: -1 }`
- `{ status: 1, level: 1, occurred_at: -1 }`
- `{ category: 1, workflow: 1, occurred_at: -1 }`
- `{ event_key: 1, occurred_at: -1 }`
- `{ dedupe_key: 1, status: 1 }`
- `{ entity_type: 1, entity_id: 1, occurred_at: -1 }`
- `{ source_company: 1, occurred_at: -1 }`

This gives fast filters for admin views, one-off scripts, daily reports, and email digest generation.

## Event Naming Standard

Use a predictable dot-separated naming convention:

```text
<category>.<workflow_or_component>.<outcome>
```

Examples:

```text
http.request.failed
mongo.connection.failed
crm.submit.failed
google_sheets.write.failed
sheet_sync.job.failed
sheet_sync.drain.partial_failure
sheet_sync.drain.failed
ringcentral.webhook.capture.failed
ringcentral.call_log_sync.failed
ringcentral.analytics_reconcile.failed
notification.email.failed
```

Keep `msg` in pino logs aligned with `event_key` when possible. This makes Vercel log search and Mongo event search use the same words.

## Severity Rules

Use severity based on owner impact, not just technical error type.

`critical`:

- A lead intake path is down.
- CRM submission is failing for live leads.
- Google Sheet sync cannot drain after retries.
- RingCentral call lead capture has failed repeatedly.
- Mongo is unreachable in production.
- Email notifications themselves are failing repeatedly.

`error`:

- A single cron run fails but should retry.
- A sheet sync job exhausts attempts.
- A third-party API call fails for a live workflow.
- An unexpected 5xx occurs on a public API route.

`warn`:

- A request is rejected for expected validation or auth reasons at unusual volume.
- A job is deferred due to quota.
- A duplicate or missing document condition needs visibility but not immediate action.

`info`:

- Successful cron summaries.
- Successful queue drain summaries.
- Lead, booking, cancellation, and customer lifecycle milestones useful for reporting.

## Owner-Facing Lead Identity Policy

Operational events must be safe to expose in owner/admin reports, but the owner needs enough customer context to act quickly. For lead, booking, cancellation, customer, CRM, RingCentral, and sheet-sync events tied to a real customer record, the Observational tab should show the customer's name, phone number, and email when available.

Do not store raw secrets, request headers, full CRM endpoints, access tokens, cookies, API secrets, or raw request bodies.

For customer identifiers:

- Show `lead_name`, `lead_phone`, and `lead_email` in owner/admin views when they come from an existing Vantage lead/customer/booking/cancellation document or from a validated incoming lead being created.
- Prefer storing these fields as first-class top-level event fields instead of burying them inside unstructured `details`; this makes owner search and filtering straightforward.
- Keep developer-only traces, third-party payload fragments, request headers, and raw CRM/RingCentral/Google responses out of owner-facing details.
- Use masked phone/email only for developer-only low-context logs, unauthenticated rejected requests, unknown callers that did not become leads, or any event not tied to an actual Vantage customer/lead record.
- Never include raw third-party payloads in `details`.

The existing helpers in `api/utils/logging/` should become the shared location for masking and event-safe summaries.

## Email Notification Capability

The owner has requested email notifications. The recommended approach is to add a dedicated notification service that reads operational events rather than sending email directly from every failing code path.

Add:

- `api/services/notifications/emailNotification.service.ts`
- `api/services/notifications/notificationPolicy.ts`
- `api/models/NotificationDelivery.ts`
- `api/routes/notification-cron.routes.ts`

Recommended provider:

- Use SendGrid first because `@sendgrid/mail` and `scripts/sendgrid/sendgrid-test-email.ts` already exist in this repo.
- Keep the notification service behind a provider interface so Resend, Mailgun, or AWS SES can be substituted later if needed.

Suggested environment variables:

```text
OBSERVABILITY_ENABLED=true
OBSERVABILITY_WRITE_MODE=enabled
OBSERVABILITY_COLLECTION_MODE=runtime
OBSERVABILITY_COLLECTION_PREFIX=
OBSERVABILITY_EVENTS_COLLECTION=
OBSERVABILITY_INCIDENTS_COLLECTION=
OBSERVABILITY_NOTIFICATIONS_COLLECTION=
OBSERVABILITY_REPORT_RUNS_COLLECTION=

EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=...
SENDGRID_FROM_EMAIL=alerts@vantagequotes.com
ALERT_EMAIL_FROM=alerts@vantagequotes.com
ALERT_EMAIL_TO=owner@example.com,developer@example.com
ALERT_EMAIL_REPLY_TO=...
ALERT_EMAIL_ENABLED=true
ALERT_EMAIL_MIN_LEVEL=error
ALERT_EMAIL_DIGEST_ENABLED=true
ALERT_EMAIL_IMMEDIATE_LEVELS=critical
ALERT_EMAIL_THROTTLE_MINUTES=60
ALERT_EMAIL_OWNER_EVENTS=booking.created,cancellation.created,crm.form_lead.submit.failed,sheet_sync.drain.failed,ringcentral.call_log_sync.failed
```

Environment control rules:

- `OBSERVABILITY_ENABLED=false` disables all Mongo event writes and notification decisions.
- `OBSERVABILITY_WRITE_MODE=log_only` mirrors event decisions to `pino` but does not write the observability collections.
- `OBSERVABILITY_COLLECTION_MODE=runtime` follows `TEST_MODE`: production names in normal mode, test names in `TEST_MODE=true`.
- `OBSERVABILITY_COLLECTION_MODE=production` forces production collection names even if local scripts are running.
- `OBSERVABILITY_COLLECTION_MODE=test` forces test collection names.
- `OBSERVABILITY_COLLECTION_MODE=custom` requires explicit collection names through the `OBSERVABILITY_*_COLLECTION` variables.
- Email notification flags must be separate from event capture. It should be possible to record events while email is disabled.

The first implementation should support:

- Immediate email for `critical` events.
- Throttled email for repeated `error` events.
- Daily digest for `warn` and `error` events.
- Notification delivery records so failures are visible and retries are safe.

## Notification Policy

Do not email every log line. Email only events that match policy.

Immediate owner alerts:

- `critical` operational event in production.
- `crm.submit.failed` after retries or repeated failures.
- `sheet_sync.drain.failed`.
- `sheet_sync.drain.partial_failure` when failed jobs are greater than zero for multiple runs.
- `ringcentral.call_log_sync.failed`.
- `ringcentral.analytics_reconcile.failed`.
- `mongo.connection.failed` in production.
- `booking.created` and `cancellation.created` when included in `ALERT_EMAIL_OWNER_EVENTS`.
- `auth.scoped_key.config_invalid`, because source partners may be unable to post allowed leads.

Digest-only owner alerts:

- Sheet sync deferred jobs.
- Validation spikes by route.
- Duplicate lead spikes by source company.
- Successful daily RingCentral and sheet sync summaries.
- Count of new form leads, call leads, bookings, cancellations, and customers.
- Source-scoped API keys that successfully hit allowed routes.
- CRM posts that completed successfully.
- Call leads ingested during the RingCentral Call Log cron.
- Call leads marked as form fills.

Developer-only alerts:

- Unexpected 5xx with stack trace.
- Notification provider failures.
- Queue consumer failures.
- Cron route authorization or trigger failures.

Near-notification owner signals:

- Duplicate form leads.
- ZIP/state lookup misses, especially repeated misses that produce `not_found` state values.
- Sheet sync quota deferrals.
- Individual sheet write failures before attempts are exhausted.
- Scoped source-company key forbidden on route/source mismatch.
- Duplicate RingCentral call leads or repeated already-processed calls.

These signals should be visible in the Observational tab and included in the digest by default. They should become immediate owner alerts only when they repeat above thresholds or affect live lead intake.

Recommended throttling:

- Dedupe by `dedupe_key`.
- Send first email immediately for critical events.
- Suppress repeated identical emails for 30 to 60 minutes.
- Include repeat count and last-seen timestamp in the next email.
- Auto-resolve incidents when a matching success event occurs.

## Reports

Once operational events are stored in Mongo, reports become simple queries instead of manual Vercel log searches.

Useful reports:

- Daily owner digest: lead counts, bookings, cancellations, sheet sync health, RingCentral health, and open incidents.
- Weekly operational summary: error trends by workflow, top failing source companies, retry counts, and resolved incidents.
- Sheet sync report: claimed, synced, failed, deferred, exhausted attempts, and oldest pending job.
- RingCentral report: fetched records, qualified calls, created call leads, duplicate calls, and failed syncs.
- HTTP health report: 5xx by route, slow routes, top origins, and request volume by route.
- CRM report: successful submits, failed submits, retry status, and affected lead IDs.

Admin endpoints can be added later under `/api/v1/admin/operational-events` with the existing API secret guard and pagination conventions.

## Admin Search and Filtering

Add admin read endpoints after the event model exists:

```text
GET /api/v1/admin/operational-events
GET /api/v1/admin/operational-events/:id
GET /api/v1/admin/operational-events/summary
PATCH /api/v1/admin/operational-events/:id/status
```

Support filters:

- `level`
- `status`
- `category`
- `workflow`
- `event_key`
- `source_company`
- `entity_type`
- `entity_id`
- `lead_name`
- `lead_phone`
- `lead_email`
- `route`
- `from`
- `to`
- `q`

Keep the response shape consistent with existing admin browse responses:

```json
{
  "ok": true,
  "data": {
    "items": [],
    "page": 1,
    "limit": 50,
    "total": 0,
    "has_next_page": false
  }
}
```

## Where To Instrument First

Start with the workflows that already have summaries and owner impact.

Phase 1 events:

- `sheet_sync.drain.run_summary`
- `sheet_sync.drain.run_failed`
- `sheet_sync.consumer.drained`
- `ringcentral.call_log_sync.completed`
- `ringcentral.call_log_sync.failed`
- `ringcentral.analytics_reconcile.completed`
- `ringcentral.analytics_reconcile.failed`
- `crm.submit.failed`
- `google_sheets.write.failed`
- unexpected API 5xx from `sendError`

Phase 2 events:

- lead created
- call lead created
- booking created
- cancellation created
- customer created
- duplicate lead detected
- webhook validation spike
- slow route threshold exceeded

Phase 3 events:

- report generation
- notification delivery summaries
- notification failures
- owner acknowledgements
- auto-resolution events

## Implementation Plan

1. Add `OperationalEvent` model and indexes.
2. Add `recordOperationalEvent(input)` service with safe defaults, dedupe support, and optional pino mirroring.
3. Add event-safe masking helpers in `api/utils/logging/`.
4. Instrument sheet sync drain failures and summaries.
5. Instrument RingCentral sync failures and summaries.
6. Instrument unexpected API 5xx handling.
7. Add notification delivery model.
8. Add email provider interface and Resend implementation.
9. Add notification policy with immediate critical alerts and throttled error alerts.
10. Add a Vercel cron route for email digests.
11. Add admin browse/search endpoints for operational events.
12. Add scripts for ad hoc reports while the admin UI is still evolving.

## Suggested Vercel Cron Additions

Keep existing crons and add notification jobs:

```json
{
  "path": "/api/cron/notifications-digest-daily",
  "schedule": "0 12 * * *"
}
```

If immediate alerts are sent inline by `recordOperationalEvent`, the cron only needs to handle digests and retrying failed notification deliveries.

If immediate alerts are queued instead, add a more frequent notification drain:

```json
{
  "path": "/api/cron/notifications-drain",
  "schedule": "*/5 * * * *"
}
```

For the first version, prefer inline send for critical events plus daily digest cron. That is simpler and enough for the owner request.

## Example Operational Event

```json
{
  "occurred_at": "2026-06-11T18:00:00.000Z",
  "level": "error",
  "status": "open",
  "event_key": "sheet_sync.drain.partial_failure",
  "category": "sheet_sync",
  "workflow": "sheet_sync_drain",
  "summary": "Sheet sync drain completed with failed jobs.",
  "details": {
    "trigger": "cron",
    "runId": "666b00000000000000000001",
    "claimed": 20,
    "synced": 17,
    "failed": 2,
    "deferred": 1
  },
  "run_id": "666b00000000000000000001",
  "dedupe_key": "sheet_sync.drain.partial_failure:production",
  "count": 1
}
```

## Example Owner Email

Subject:

```text
[Vantage Alert] Sheet sync partial failure
```

Body:

```text
Sheet sync completed with failed jobs.

Environment: production
Workflow: sheet_sync_drain
Run ID: 666b00000000000000000001
Claimed: 20
Synced: 17
Failed: 2
Deferred: 1
First seen: 2026-06-11 2:00 PM ET

Recommended action:
Review failed sheet sync jobs in the admin endpoint or run the failed sheet sync resync script.
```

Keep owner emails short, factual, and action-oriented. Developer emails can include stack traces and deeper metadata.

## Operational Guardrails

- Only send owner alerts from production unless explicitly enabled for preview.
- Always record notification attempts and provider responses without storing secrets.
- Never let notification failure break the original business workflow.
- If email sending fails, record `notification.email.failed` as an operational event.
- Avoid alert loops by preventing notification failure events from immediately sending owner email.
- Keep all event and notification writes best-effort unless the event is part of a dedicated admin/reporting workflow.

## Success Criteria

This evolution is successful when:

- Operators can filter incidents by workflow, level, status, source company, and date.
- Owner alerts arrive for real workflow failures without noisy duplicate emails.
- Daily reports can be generated from Mongo without manually searching Vercel logs.
- Vercel logs and Mongo operational events use the same event keys.
- A production incident can be understood from one operational event record plus linked entity IDs.
- Sensitive headers, tokens, and raw customer payloads do not appear in logs, events, emails, or reports.

