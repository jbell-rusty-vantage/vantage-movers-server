# Observational Admin Implementation Specification

This is the deeper implementation specification for turning the log evolution plan into an Observational tab in `vantage-admin`.

The design has two hard boundaries:

- `vantage-main-server` owns operational persistence, event capture, notification policy, summary report generation, and all reads from the production business database.
- `vantage-admin` owns the protected dashboard UI only. It must fetch Observational data through local `/api/proxy/...` routes, never by reading the operational Mongo databases directly.

## Product Goal

The Observational tab should be the owner/admin control room for server health and workflow health.

It should answer:

- What is broken right now?
- What failed today, grouped by workflow and source company?
- Which incidents are still open?
- Are sheet sync, RingCentral, CRM, and Mongo healthy?
- Which owner notifications were sent?
- Can we generate the same daily report twice and get the same result?
- Can a developer jump from a report row to the underlying event, incident, entity, or run?

The tab is not meant to replace Vercel logs. It is meant to turn important runtime behavior into durable business-operational records.

## System Overview

Use four persistence layers:

- `operational_events`: append-mostly event records for important workflow facts and failures.
- `operational_incidents`: deduped, stateful incident records created from events.
- `notification_deliveries`: durable email notification attempts and results.
- `operational_report_runs`: deterministic report execution records, including filter snapshots and result hashes.

Optionally add `operational_event_rollups` after the event table reaches meaningful size. Do not add rollups first; the initial system should be queryable directly from indexed events.

## Environment Controls

Observability and email notification behavior must be controlled by environment variables. The owner wants this on from the beginning, but the code should still support safe disable, log-only operation, and test collection isolation.

### Core Observability Flags

```text
OBSERVABILITY_ENABLED=true
OBSERVABILITY_WRITE_MODE=enabled
OBSERVABILITY_EVENT_MIN_LEVEL=info
OBSERVABILITY_CAPTURE_OWNER_EVENTS=true
OBSERVABILITY_CAPTURE_INFO_EVENTS=true
OBSERVABILITY_CAPTURE_HTTP_5XX=true
OBSERVABILITY_CAPTURE_AUTH_EVENTS=true
OBSERVABILITY_CAPTURE_ZIP_STATE_EVENTS=true
OBSERVABILITY_SLOW_REQUEST_MS=3000
OBSERVABILITY_DETAILS_MAX_BYTES=16384
OBSERVABILITY_BULK_BATCH_SIZE=500
```

Meanings:

- `OBSERVABILITY_ENABLED=false`: do not write observability collections and do not evaluate notification policy.
- `OBSERVABILITY_WRITE_MODE=enabled`: write Mongo events/incidents normally.
- `OBSERVABILITY_WRITE_MODE=log_only`: emit pino logs for the same event decisions, but do not write observability collections.
- `OBSERVABILITY_WRITE_MODE=disabled`: same as `OBSERVABILITY_ENABLED=false`; useful for explicit deploy posture.
- `OBSERVABILITY_EVENT_MIN_LEVEL=info`: lowest persisted event level. Owner-worthy lifecycle events should use `info` and remain enabled by default.
- `OBSERVABILITY_CAPTURE_OWNER_EVENTS=true`: capture owner business milestones such as booking created, cancellation created, duplicate lead, CRM posted, and RingCentral leads ingested.
- `OBSERVABILITY_CAPTURE_INFO_EVENTS=true`: capture successful workflow summaries. If false, only `warn`, `error`, and `critical` events persist.
- `OBSERVABILITY_CAPTURE_HTTP_5XX=true`: record unexpected 5xx responses from route error handling.
- `OBSERVABILITY_CAPTURE_AUTH_EVENTS=true`: record source-scoped API key accept/deny decisions without secrets.
- `OBSERVABILITY_CAPTURE_ZIP_STATE_EVENTS=true`: record ZIP/state lookup misses and fallback behavior.
- `OBSERVABILITY_SLOW_REQUEST_MS=3000`: threshold for `http.request.slow`.

### Collection Selection

The implementation must let operators control whether observability writes use production, test, or custom collections.

```text
OBSERVABILITY_COLLECTION_MODE=runtime
OBSERVABILITY_COLLECTION_PREFIX=
OBSERVABILITY_EVENTS_COLLECTION=
OBSERVABILITY_INCIDENTS_COLLECTION=
OBSERVABILITY_NOTIFICATIONS_COLLECTION=
OBSERVABILITY_REPORT_RUNS_COLLECTION=
OBSERVABILITY_ROLLUPS_COLLECTION=
```

Allowed modes:

```text
runtime
production
test
custom
```

Resolution rules:

- `runtime`: follow `TEST_MODE`. If `TEST_MODE=true`, use test collection names. Otherwise use production names.
- `production`: force production collection names.
- `test`: force test collection names.
- `custom`: require explicit `OBSERVABILITY_EVENTS_COLLECTION`, `OBSERVABILITY_INCIDENTS_COLLECTION`, `OBSERVABILITY_NOTIFICATIONS_COLLECTION`, and `OBSERVABILITY_REPORT_RUNS_COLLECTION`.
- `OBSERVABILITY_COLLECTION_PREFIX` prepends a prefix to default names, for example `dev_operational_events`.

Default collection names:

```text
operational_events
operational_incidents
notification_deliveries
operational_report_runs
operational_event_rollups
```

Default test collection names:

```text
test_operational_events
test_operational_incidents
test_notification_deliveries
test_operational_report_runs
test_operational_event_rollups
```

Add a config module:

```text
api/config/domain/observability.ts
```

Export:

```typescript
export function isObservabilityEnabled(): boolean;
export function getObservabilityWriteMode(): "enabled" | "log_only" | "disabled";
export function getObservabilityCollectionNames(): {
  events: string;
  incidents: string;
  notifications: string;
  reportRuns: string;
  rollups: string;
};
export function getObservabilityEventMinLevel(): "debug" | "info" | "warn" | "error" | "critical";
export function shouldCaptureOwnerEvents(): boolean;
export function shouldCaptureInfoEvents(): boolean;
export function shouldCaptureAuthEvents(): boolean;
export function shouldCaptureZipStateEvents(): boolean;
export function getObservabilitySlowRequestMs(): number;
```

Use the same call-time env read style as `api/config/domain/sheetSync.ts`, so tests and scripts can change environment posture without reloading modules.

### Email Notification Flags

SendGrid should be the default provider because `@sendgrid/mail` and `scripts/sendgrid/sendgrid-test-email.ts` already exist in this repo.

```text
EMAIL_PROVIDER=sendgrid
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_NOTIFICATIONS_MODE=live
SENDGRID_API_KEY=SG....
SENDGRID_FROM_EMAIL=alerts@vantagequotes.com
SENDGRID_TO_EMAIL=owner@example.com
SENDGRID_DEVELOPER_TO_EMAIL=developer@example.com
ALERT_EMAIL_REPLY_TO=
ALERT_EMAIL_MIN_LEVEL=error
ALERT_EMAIL_IMMEDIATE_LEVELS=critical
ALERT_EMAIL_THROTTLE_MINUTES=60
ALERT_EMAIL_DAILY_DIGEST_ENABLED=true
ALERT_EMAIL_DAILY_DIGEST_CRON_TIME=12:00
ALERT_EMAIL_OWNER_EVENTS=booking.created,cancellation.created,crm.form_lead.submit.failed,sheet_sync.drain.failed,ringcentral.call_log_sync.failed
ALERT_EMAIL_NEAR_WORTHY_DIGEST_EVENTS=lead.form.duplicate_detected,lead.call.form_fill_detected,zip_state.lookup.missing,sheet_sync.drain.partial_failure
```

Email modes:

- `live`: send real email.
- `sandbox`: use provider sandbox mode when available and still record `notification_deliveries`.
- `log_only`: render notification subject/body into logs and delivery records, but do not call SendGrid.
- `disabled`: do not create email deliveries.

Email rules:

- Email flags must not control event capture. Event capture can be enabled while email is disabled.
- Never let SendGrid failure fail the original owner workflow.
- SendGrid failures create `notification.email.failed` events, but those events must not recursively email the owner.

## Mongo Collections

### `operational_events`

Purpose:

Durable event stream for searchable/filterable workflow behavior. This collection powers the event table, event detail drawer, grouping widgets, and report inputs.

Collection name:

```text
operational_events
```

Mongoose model:

```text
api/models/OperationalEvent.ts
```

Fields:

```text
_id: ObjectId
occurred_at: Date
received_at: Date
level: "debug" | "info" | "warn" | "error" | "critical"
event_key: string
category: "http" | "mongo" | "crm" | "google_sheets" | "sheet_sync" | "ringcentral" | "queue" | "cron" | "lead" | "booking" | "cancellation" | "customer" | "notification" | "report" | "admin"
workflow: string
summary: string
details: object
fingerprint: string
dedupe_key: string | null
environment: "production" | "preview" | "development" | string
service: "vantage-main-server"
region: string | null
request_id: string | null
route: string | null
method: string | null
status_code: number | null
duration_ms: number | null
entity_type: string | null
entity_id: string | null
lead_name: string | null
lead_phone: string | null
lead_email: string | null
source_company: string | null
job_no: string | null
run_id: string | null
trace: object | null
pii_policy: "none" | "masked" | "internal"
incident_id: ObjectId | null
notification_candidate: boolean
reportable: boolean
createdAt: Date
updatedAt: Date
```

Field notes:

- `occurred_at` is when the domain event happened.
- `received_at` is when the server saved it. In most cases this is the same as `occurred_at`.
- `fingerprint` is a stable hash of `environment`, `event_key`, `workflow`, `entity_type`, `entity_id`, `route`, and a normalized error message when applicable.
- `dedupe_key` is a human-meaningful grouping key. It can be the same as `fingerprint`, but it should be readable enough for debugging.
- `details` must be small, bounded, and safe. It should not store raw request bodies or third-party payloads.
- `trace` can hold safe technical context such as `errorName`, `errorCode`, `causeMessage`, and a shortened stack hash. Full stack traces should remain in pino/Vercel logs unless explicitly needed.
- `reportable=false` is useful for internal noise that should be searchable but not included in owner reports.
- `lead_name`, `lead_phone`, and `lead_email` are intentionally owner-facing when an event is tied to an actual lead, booking, cancellation, customer, CRM submission, RingCentral call lead, or sheet-sync job for a customer record. They should be copied from validated Vantage documents or validated lead creation input, not from raw untrusted payload blobs.

Indexes:

```javascript
OperationalEventSchema.index({ occurred_at: -1 });
OperationalEventSchema.index({ level: 1, occurred_at: -1 });
OperationalEventSchema.index({ category: 1, workflow: 1, occurred_at: -1 });
OperationalEventSchema.index({ event_key: 1, occurred_at: -1 });
OperationalEventSchema.index({ source_company: 1, occurred_at: -1 });
OperationalEventSchema.index({ lead_phone: 1, occurred_at: -1 });
OperationalEventSchema.index({ lead_email: 1, occurred_at: -1 });
OperationalEventSchema.index({ entity_type: 1, entity_id: 1, occurred_at: -1 });
OperationalEventSchema.index({ request_id: 1, occurred_at: -1 });
OperationalEventSchema.index({ run_id: 1, occurred_at: -1 });
OperationalEventSchema.index({ incident_id: 1, occurred_at: -1 });
OperationalEventSchema.index({ reportable: 1, occurred_at: -1 });
OperationalEventSchema.index({ fingerprint: 1, occurred_at: -1 });
```

Optional text index:

```javascript
OperationalEventSchema.index({
  event_key: "text",
  workflow: "text",
  summary: "text",
  source_company: "text",
  lead_name: "text",
  lead_phone: "text",
  lead_email: "text",
  job_no: "text",
  entity_id: "text",
});
```

Retention:

- Keep raw events for 180 days initially.
- Keep critical/error events for 400 days if storage remains small.
- Do not add TTL until there is a working export/report snapshot path.

### `operational_incidents`

Purpose:

Stateful issue records built from one or more events. This is what the owner sees as "needs attention".

Collection name:

```text
operational_incidents
```

Mongoose model:

```text
api/models/OperationalIncident.ts
```

Fields:

```text
_id: ObjectId
status: "open" | "acknowledged" | "resolved" | "ignored" | "auto_resolved"
severity: "warn" | "error" | "critical"
fingerprint: string
dedupe_key: string
event_key: string
category: string
workflow: string
title: string
summary: string
environment: string
service: string
source_company: string | null
route: string | null
entity_type: string | null
entity_id: string | null
lead_name: string | null
lead_phone: string | null
lead_email: string | null
run_id: string | null
first_event_id: ObjectId
latest_event_id: ObjectId
first_seen_at: Date
last_seen_at: Date
resolved_at: Date | null
acknowledged_at: Date | null
acknowledged_by: string | null
ignored_at: Date | null
ignored_by: string | null
count: number
last_details: object
owner_visible: boolean
notification_state: {
  immediate_sent_at: Date | null
  digest_sent_at: Date | null
  next_notify_at: Date | null
  suppressed_count: number
}
createdAt: Date
updatedAt: Date
```

Indexes:

```javascript
OperationalIncidentSchema.index({ status: 1, severity: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ severity: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ category: 1, workflow: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ event_key: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ source_company: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ lead_phone: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ lead_email: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ fingerprint: 1, status: 1 });
OperationalIncidentSchema.index({ owner_visible: 1, status: 1, last_seen_at: -1 });
```

Unique/open dedupe:

Use a partial unique index so only one open/acknowledged incident exists for a fingerprint:

```javascript
OperationalIncidentSchema.index(
  { fingerprint: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["open", "acknowledged"] } },
  },
);
```

Resolution rules:

- Manual resolution sets `status=resolved`, `resolved_at`, and keeps history.
- Auto-resolution happens when a matching success event is recorded, for example `sheet_sync.drain.run_summary` with `failed=0` after an open `sheet_sync.drain.partial_failure`.
- Ignored incidents should not send owner notifications, but should remain searchable.

### `notification_deliveries`

Purpose:

Track owner/developer emails and provider outcomes. This enables retries, auditability, and visibility when notification sending fails.

Collection name:

```text
notification_deliveries
```

Mongoose model:

```text
api/models/NotificationDelivery.ts
```

Fields:

```text
_id: ObjectId
channel: "email"
provider: "resend" | "sendgrid" | "ses" | "mailgun" | string
purpose: "immediate_alert" | "daily_digest" | "weekly_report" | "test"
status: "queued" | "sending" | "sent" | "failed" | "suppressed" | "cancelled"
recipient_type: "owner" | "developer" | "internal"
to: string[]
from: string
reply_to: string | null
subject: string
body_text_preview: string
event_id: ObjectId | null
incident_id: ObjectId | null
report_run_id: ObjectId | null
dedupe_key: string | null
provider_message_id: string | null
provider_response: object | null
error_message: string | null
attempt_count: number
next_attempt_at: Date | null
sent_at: Date | null
createdAt: Date
updatedAt: Date
```

Indexes:

```javascript
NotificationDeliverySchema.index({ status: 1, next_attempt_at: 1 });
NotificationDeliverySchema.index({ purpose: 1, createdAt: -1 });
NotificationDeliverySchema.index({ incident_id: 1, createdAt: -1 });
NotificationDeliverySchema.index({ event_id: 1, createdAt: -1 });
NotificationDeliverySchema.index({ report_run_id: 1, createdAt: -1 });
NotificationDeliverySchema.index({ dedupe_key: 1, createdAt: -1 });
```

Retention:

- Keep deliveries for at least 400 days.
- The body preview should be enough for audit, not a full copy of every email.

### `operational_report_runs`

Purpose:

Persist deterministic report executions so an admin can rerun, compare, export, and cite reports.

Collection name:

```text
operational_report_runs
```

Mongoose model:

```text
api/models/OperationalReportRun.ts
```

Fields:

```text
_id: ObjectId
report_key: string
report_version: number
status: "running" | "completed" | "failed"
requested_by: "admin" | "cron" | "script" | string
database_scope: "production"
period: {
  from: Date
  to: Date
  timezone: string
  granularity: "hour" | "day" | "week" | "month"
}
filters: object
input_watermark: {
  events_max_occurred_at: Date | null
  events_count: number
  incidents_count: number
}
result: object
result_hash: string
csv_export_path: string | null
error_message: string | null
started_at: Date
finished_at: Date | null
createdAt: Date
updatedAt: Date
```

Indexes:

```javascript
OperationalReportRunSchema.index({ report_key: 1, "period.from": -1, "period.to": -1 });
OperationalReportRunSchema.index({ status: 1, started_at: -1 });
OperationalReportRunSchema.index({ result_hash: 1 });
OperationalReportRunSchema.index({ requested_by: 1, started_at: -1 });
```

Determinism contract:

- Every report has a `report_key` and integer `report_version`.
- Every report records normalized filters.
- Every report uses `[from, to)` date boundaries.
- Every report stores timezone explicitly, defaulting to `America/New_York` for owner reports.
- Every report sorts grouped rows deterministically by primary metric descending, then label ascending.
- Every report stores `result_hash` computed from canonical JSON of `{ report_key, report_version, period, filters, result }`.

### Optional `operational_event_rollups`

Do not add this in the first pass unless event volume is already too high.

Purpose:

Precomputed hourly/daily counts for dashboard cards and charts.

Fields:

```text
bucket_start: Date
bucket_size: "hour" | "day"
event_key: string
category: string
workflow: string
level: string
source_company: string | null
route: string | null
count: number
critical_count: number
error_count: number
warn_count: number
createdAt: Date
updatedAt: Date
```

Unique index:

```javascript
OperationalEventRollupSchema.index(
  {
    bucket_start: 1,
    bucket_size: 1,
    event_key: 1,
    category: 1,
    workflow: 1,
    level: 1,
    source_company: 1,
    route: 1,
  },
  { unique: true },
);
```

## Efficient Server Execution Specification

### Capture Only Operationally Meaningful Events

Do not persist every HTTP success request. Vercel/pino stdout remains the source for raw request logs.

Persist events for:

- Workflow successes that are useful in owner reports.
- All `warn`, `error`, and `critical` workflow failures.
- Cron, queue, and external integration summaries.
- Slow requests above a configured threshold.
- Unexpected 5xx responses.
- Notification delivery outcomes.
- Admin report generation and incident status changes.

Skip or sample:

- Normal `GET` browse requests.
- Health checks.
- High-volume successful request logs.
- Validation failures unless volume crosses a threshold.

### `recordOperationalEvent(input)`

Add a service:

```text
api/services/observability/recordOperationalEvent.ts
```

Signature:

```typescript
type RecordOperationalEventInput = {
  level: "debug" | "info" | "warn" | "error" | "critical";
  eventKey: string;
  category: string;
  workflow: string;
  summary: string;
  details?: Record<string, unknown>;
  occurredAt?: Date;
  requestId?: string | number | object;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  entity?: {
    type: string;
    id: string;
  };
  leadIdentity?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  sourceCompany?: string;
  jobNo?: string;
  runId?: string;
  dedupeKey?: string;
  notificationCandidate?: boolean;
  reportable?: boolean;
  ownerVisible?: boolean;
  autoResolveKey?: string;
};
```

Behavior:

1. Normalize and validate the event.
2. Sanitize `details`.
3. Normalize lead identity fields when provided.
4. Compute `fingerprint`.
5. Insert one `operational_events` document.
6. If level is `warn`, `error`, or `critical`, upsert an `operational_incidents` document.
7. If a matching success event includes `autoResolveKey`, resolve the matching open incident.
8. If notification policy matches, create or send notification.
9. Mirror a compact log line to `pino` with the same `event_key`.

### Owner-Facing Lead Identity

The Observational tab should show lead/customer context to the owner. Operational records should therefore carry first-class lead identity fields when a workflow is tied to a real customer or lead.

Allowed owner-facing fields:

```text
lead_name
lead_phone
lead_email
source_company
job_no
entity_type
entity_id
```

When to include them:

- A form lead is created, rejected after validation, submitted to CRM, marked duplicate, booked, cancelled, or synced to sheets.
- A call lead is created from RingCentral webhook or Call Log sync.
- A booking, cancellation, or customer workflow fails.
- A sheet-sync job is tied to a lead, booking, cancellation, or customer document.
- A CRM or Google Sheets failure affects a specific customer record.

Where to get them:

- Prefer the saved Mongo document after validation and normalization.
- During creation, use the validated request input only after schema validation succeeds.
- For sheet-sync jobs, reload the linked entity and copy its current identity snapshot when recording the event.

What not to do:

- Do not copy identity from raw unvalidated webhook payloads.
- Do not store raw request bodies just to preserve identity.
- Do not put customer identity only inside `details`; top-level fields make owner search and grouping practical.
- Do not include customer identity on unauthenticated rejected requests or generic infrastructure failures with no customer entity.

Normalization:

- `lead_name`: trim whitespace and prefer the display name already used by the model.
- `lead_phone`: use the customer-facing normalized/display phone available on the document.
- `lead_email`: trim and lowercase when the source model stores lowercase email.
- Empty strings become `null`.

### Save Path Performance

Use a single awaited write for important events. Do not fire-and-forget Mongo writes in Vercel functions; the runtime can freeze before the promise completes.

Recommended write patterns:

For `info` reportable events:

```text
insertOne operational_events
return
```

For `warn/error/critical` events:

```text
insertOne operational_events
updateOne operational_incidents with upsert
optionally update event.incident_id
evaluate notification policy
return
```

For hot repeated failures:

```text
insertOne event
updateOne incident with $inc count, $set last_seen_at/latest_event_id/last_details
do not send email if next_notify_at is in the future
```

The insert plus incident upsert should normally be two writes. Avoid wrapping in a transaction; atomic perfection is not worth the latency and fragility here. If the event insert succeeds and the incident update fails, the event remains searchable and a later repair script can reconstruct incidents.

### Incident Upsert Shape

Use `findOneAndUpdate` or `updateOne` against open states:

```javascript
{
  fingerprint,
  status: { $in: ["open", "acknowledged"] }
}
```

Update:

```javascript
{
  $setOnInsert: {
    status: "open",
    severity,
    fingerprint,
    dedupe_key,
    event_key,
    category,
    workflow,
    title,
    environment,
    service,
    first_event_id: eventId,
    first_seen_at: occurredAt,
    owner_visible,
  },
  $set: {
    summary,
    source_company,
    route,
    entity_type,
    entity_id,
    lead_name,
    lead_phone,
    lead_email,
    run_id,
    latest_event_id: eventId,
    last_seen_at: occurredAt,
    last_details: details,
  },
  $inc: {
    count: 1,
    "notification_state.suppressed_count": shouldSuppress ? 1 : 0,
  }
}
```

### Bounded Details

`details` should be bounded before write:

- Maximum depth: 4.
- Maximum string length: 500 characters.
- Maximum array items: 20.
- Maximum serialized size target: 16 KB.
- Replace large objects with `"[object]"`, large arrays with `"[array:n]"`, and unsupported values with `"[unsupported]"`.

This prevents event writes from becoming expensive or accidentally storing raw payloads.

### Request Context

Add a helper to convert an Express request into safe event context:

```text
api/services/observability/requestEventContext.ts
```

Fields:

```text
request_id
route
method
status_code
origin
user_agent_family
```

Do not store full headers. The existing `httpLogger` redaction policy should remain the raw request logging boundary.

### Failure Isolation

Observability must never break live business workflows.

Rules:

- Event write failures are logged with `logger.warn` or `logger.error`.
- Event write failures do not change API responses.
- Critical notification failures create `notification.email.failed` events, but those events must not recursively trigger owner notifications.
- Report generation failures are stored in `operational_report_runs`, not thrown into unrelated user workflows.

### Connection Efficiency

All event writes reuse `connectMongo()` and existing Mongoose connection reuse from `api/db.ts`.

Do not create a second Mongo client for observability.

Do not write events before the main workflow has connected to Mongo if the workflow otherwise does not need Mongo. For request paths that already call `connectMongo()`, event persistence can use the existing connection.

### Bulk and Backfill Events

For scripts or backfills that generate many events:

- Use `recordOperationalEventsBulk(inputs)`.
- Convert inputs to sanitized docs in memory.
- Use `OperationalEvent.bulkWrite([{ insertOne: ... }], { ordered: false })`.
- Build incident updates separately with grouped fingerprints.
- Limit each bulk batch to 500 events.

Do not use bulk writes from normal request handlers.

## Event Taxonomy

Use these categories first:

```text
http
mongo
crm
google_sheets
sheet_sync
ringcentral
queue
cron
lead
booking
cancellation
customer
notification
report
admin
```

Use stable event keys:

```text
http.request.5xx
http.request.slow
mongo.connection.failed
crm.submit.completed
crm.submit.failed
google_sheets.write.completed
google_sheets.write.failed
sheet_sync.drain.completed
sheet_sync.drain.partial_failure
sheet_sync.drain.failed
sheet_sync.job.failed
ringcentral.webhook.capture.completed
ringcentral.webhook.capture.failed
ringcentral.call_log_sync.completed
ringcentral.call_log_sync.failed
ringcentral.analytics_reconcile.completed
ringcentral.analytics_reconcile.failed
lead.form.created
lead.call.created
booking.created
cancellation.created
notification.email.sent
notification.email.failed
report.operational.completed
report.operational.failed
admin.incident.status_changed
```

## Owner-Worthy Operational Data Matrix

This is the implementation map for the next agent. It names the most important owner/system data, where it happens today, what event to record, and whether it should trigger immediate email, digest email, or dashboard-only visibility.

Notification posture values:

- `immediate`: email the owner quickly, subject to throttling.
- `digest`: include in daily owner digest and show prominently in the Observational tab.
- `near`: not usually emailed by itself, but email if repeated, paired with failures, or over threshold.
- `dashboard`: searchable/filterable but no owner email by default.

### Lead And Source Intake

| Owner data | Capture point | Event key | Level | Notification | Required fields |
| --- | --- | --- | --- | --- | --- |
| Source company with valid scoped secret hit an allowed route | `api/middleware/requireApiSecret.ts` after route/source checks pass for a scoped key | `auth.scoped_key.accepted` | `info` | `digest` | `source_company`, `route`, `method`, `scoped_key_name`, `request_id` |
| Source company secret rejected for route/source mismatch | `requireApiSecret` when matching scoped key fails route/source authorization | `auth.scoped_key.forbidden` | `warn` | `near` | `source_company`, `route`, `method`, `scoped_key_name`, `forbidden_reason`, `request_id` |
| Unknown or missing API secret | `requireApiSecret` on 401 | `auth.api_secret.rejected` | `warn` | `near` | `route`, `method`, `reject_reason`, `request_id`; never store secret |
| Scoped key config invalid | `requireApiSecret` JSON parse/config catch | `auth.scoped_key.config_invalid` | `error` | `immediate` | `route`, `method`, `request_id` |
| Form lead created | `api/services/leads/formLead.service.ts#createFormLead` after Mongo write and sheet-sync intent commit | `lead.form.created` | `info` | `digest` | `lead_name`, `lead_phone`, `lead_email`, `source_company`, `entity_id`, `pickup_zip`, `delivery_zip`, `pickup_state`, `delivery_state`, `local`, `duplicate`, `cpl`, `post_to_granot` |
| Duplicate form lead detected and saved as duplicate | `createFormLead` after `isDuplicateFormLead(...)` returns true and lead is saved | `lead.form.duplicate_detected` | `warn` | `near` | `lead_name`, `lead_phone`, `lead_email`, `source_company`, `entity_id`, `duplicate=true`, `matched_by=email|phone|both` when available |
| Form lead duplicate lookup failed | `createFormLead` around duplicate lookup catch if added | `lead.form.duplicate_check_failed` | `error` | `immediate` | `lead_phone`, `lead_email`, `source_company`, `errorName`, `causeMessage` |
| Call lead created from public route | `api/services/leads/callLead.service.ts#createCallLead` after Mongo write and sheet-sync finalize | `lead.call.created` | `info` | `digest` | `lead_name`, `lead_phone`, `lead_email`, `source_company`, `entity_id`, `form_fill`, `pickup_zip`, `delivery_zip`, `local`, `cpl` |
| Call lead is a form fill | `createCallLead` and `createRingCentralCallLead` when `form_fill=true`; also `duplicateLead.service.ts#markMatchingCallLeadsWithFormFill` when existing call leads are flipped | `lead.call.form_fill_detected` | `info` | `digest` | `lead_phone`, `source_company`, `entity_id`, `form_lead_id`, `matched_call_lead_count` |
| Form lead marked existing call leads as form fill | `markMatchingCallLeadsWithFormFill` after matched call leads save | `lead.form.call_leads_marked_form_fill` | `info` | `digest` | `form_lead_id`, `source_company`, `lead_phone`, `matched_call_lead_count`, `call_lead_ids` capped |

Implementation note:

`isDuplicateFormLead` currently returns `boolean`. To capture `matched_by` and matched lead IDs, add a richer helper such as `findDuplicateFormLeadMatch(...)` returning `{ duplicate, matchedBy, matchedLeadIds }`, then keep `isDuplicateFormLead(...)` as a compatibility wrapper.

### ZIP And State Resolution

| Owner data | Capture point | Event key | Level | Notification | Required fields |
| --- | --- | --- | --- | --- | --- |
| Pickup or delivery ZIP did not resolve to a state and caller-supplied state was missing | `api/services/leads/leadLocation.service.ts#resolveRequiredLocation` | `zip_state.lookup.missing` | `warn` | `near` | `pickup_zip`, `delivery_zip`, `missing_pickup_state`, `missing_delivery_state`, `fallback_state`, `workflow=form_lead_create|form_lead_update` |
| Optional call lead ZIP did not resolve | `leadLocation.service.ts#resolveOptionalLocation` | `zip_state.optional_lookup.missing` | `info` or `warn` | `dashboard` | `pickup_zip`, `delivery_zip`, `missing_pickup_state`, `missing_delivery_state`, `workflow=call_lead_create|call_lead_update` |
| Google Maps ZIP lookup unavailable | `api/services/googleMaps/geocoding.ts#logAuthOrRequestFailure` | `zip_state.google_maps.unavailable` | `warn` | `near` | `provider=google_maps`, `fallback=zippopotamus`, `causeMessage` |
| Google Maps ZIP lookup HTTP failure | `googleMaps/geocoding.ts` when response is not ok | `zip_state.google_maps.failed` | `warn` | `near` | `zip`, `status`, `provider=google_maps` |

Implementation note:

Do not record one email-worthy event for every invalid ZIP. Record the lead-specific missing state event for owner context, and let repeated failures roll into incidents by fingerprint such as `zip_state.lookup.missing:pickup` or `zip_state.google_maps.unavailable`.

### RingCentral Call Leads

| Owner data | Capture point | Event key | Level | Notification | Required fields |
| --- | --- | --- | --- | --- | --- |
| Call leads ingested during Call Log cron run | `api/services/ringcentral/call-log-sync.service.ts#runRingCentralCallLogSync` after successful summary | `ringcentral.call_log_sync.completed` | `info` | `digest` | `windowFrom`, `windowTo`, `fetchedRecords`, `candidateRecords`, `qualifiedRecords`, `leadsCreated`, `duplicatesFlagged`, `ingestActions` |
| Individual RingCentral qualified call created a real call lead | `api/services/ringcentral/ringcentral-call-lead-ingest.service.ts#ingestRingCentralQualifiedCall` after `createRingCentralCallLead` | `ringcentral.call_lead.created` | `info` | `digest` | `lead_phone`, `lead_name`, `source_company`, `entity_id`, `telephonySessionId`, `callLogId`, `ingestionSource`, `durationSeconds`, `duplicate`, `duplicateReason` |
| RingCentral qualified call was duplicate | `ingestRingCentralQualifiedCall` when action is `lead_created_duplicate` | `ringcentral.call_lead.duplicate_created` | `warn` | `near` | `lead_phone`, `source_company`, `entity_id`, `telephonySessionId`, `callLogId`, `duplicateReason` |
| RingCentral already processed a call | `ingestRingCentralQualifiedCall` existing processed branch | `ringcentral.call_lead.skipped_already_processed` | `info` | `dashboard` | `telephonySessionId`, `callLogId`, `previousStatus`, `ingestionSource`, `callLeadId` |
| RingCentral Call Log sync failed | `runRingCentralCallLogSync` catch and cron route catch | `ringcentral.call_log_sync.failed` | `error` | `immediate` | `windowFrom`, `windowTo`, `errorName`, `causeMessage` |
| Webhook ingest failed for a qualified session | `api/routes/ringcentral-webhook.routes.ts#ingestSessionLead` catch | `ringcentral.webhook.ingest_failed` | `error` | `immediate` | `telephonySessionId`, `source_company`, `lead_phone`, `durationSeconds`, `causeMessage` |
| Analytics reconcile snapshot completed | `api/services/ringcentral/analytics-reconcile.service.ts#runRingCentralAnalyticsReconcile` | `ringcentral.analytics_reconcile.completed` | `info` | `digest` | `windowFrom`, `windowTo`, `groupCount`, `totalAnsweredOver120` |
| Analytics reconcile failed | cron route catch around `runRingCentralAnalyticsReconcile` | `ringcentral.analytics_reconcile.failed` | `error` | `immediate` | `windowFrom`, `windowTo`, `causeMessage` |

Implementation note:

For owner reports, the Call Log cron summary should list the newly created call lead IDs and the top source companies when possible. Keep per-lead events separate from the cron summary so the owner can click into a specific lead.

### Booking And Cancellation

| Owner data | Capture point | Event key | Level | Notification | Required fields |
| --- | --- | --- | --- | --- | --- |
| Booking created | `api/services/bookings/bookedLead.service.ts#createBookedLead` when `outcome.kind === "create"` | `booking.created` | `info` | `immediate` or `digest` by env | `entity_id`, `job_no`, `lead_name`, `lead_phone`, `lead_email`, `source_company`, `lead_model`, `lead_ref`, `deposit_amount`, `total_binder_amount`, `merchant`, `agent_names`, `local`, `warnings` |
| Existing booking upserted | `createBookedLead` when `outcome.kind === "upsert"` | `booking.upserted` | `info` | `digest` | same as booking created plus `previous_booking_id` |
| Duplicate booking submission ignored | `createBookedLead` when `outcome.kind === "duplicate"` | `booking.duplicate_submission_ignored` | `warn` | `near` | `entity_id`, `submission_id`, `job_no`, `lead_ref`, `lead_model` |
| Booking create/update failed | route `sendError` AppError branch or service catch if added | `booking.write.failed` | `error` | `immediate` | `lead_ref`, `lead_model`, `job_no`, `source_company`, `errorCode`, `statusCode`, `causeMessage` |
| Cancellation created | `api/services/cancellations/cancelledLead.service.ts#createCancelledLead` after commit/finalize | `cancellation.created` | `info` | `immediate` or `digest` by env | `entity_id`, `booking_id`, `job_no`, `lead_name`, `lead_phone`, `lead_email`, `source_company`, `reason`, `refund_amount`, `cancelled_by`, `agent`, `merchant` |
| Cancellation create/update failed | route `sendError` AppError branch or service catch if added | `cancellation.write.failed` | `error` | `immediate` | `booking_id`, `job_no`, `reason`, `errorCode`, `statusCode`, `causeMessage` |

Implementation note:

The owner may want booking and cancellation emails immediately even though they are success events. Keep this controlled by `ALERT_EMAIL_OWNER_EVENTS`, not hardcoded.

### CRM Posting

| Owner data | Capture point | Event key | Level | Notification | Required fields |
| --- | --- | --- | --- | --- | --- |
| CRM form lead post started | `api/services/crm/crm.service.ts#submitFormLeadToCrm` before fetch | `crm.form_lead.submit.started` | `info` | `dashboard` | `entity_id`, `lead_name`, `lead_phone`, `lead_email`, `source_company`, `companyLabel`, `endpoint=safe` |
| CRM posted successfully | `submitFormLeadToCrm` on `response.ok` | `crm.form_lead.submit.completed` | `info` | `digest` | `entity_id`, `lead_name`, `lead_phone`, `lead_email`, `source_company`, `companyLabel`, `status` |
| CRM returned HTTP error | `submitFormLeadToCrm` on non-ok response | `crm.form_lead.submit.http_error` | `error` | `immediate` | `entity_id`, `lead_name`, `lead_phone`, `lead_email`, `source_company`, `companyLabel`, `status`, `responseText` capped |
| CRM network/unknown failure | `submitFormLeadToCrm` catch | `crm.form_lead.submit.failed` | `error` | `immediate` | `entity_id`, `lead_name`, `lead_phone`, `lead_email`, `source_company`, `companyLabel`, `causeMessage` |
| CRM skipped because duplicate or flag disabled | `formLead.service.ts#createFormLead` skipped branch | `crm.form_lead.submit.skipped` | `info` | `dashboard` | `entity_id`, `source_company`, `duplicate`, `post_to_granot`, `companyLabel`, `requestedCompanyLabel` |

Implementation note:

CRM event records can include owner-facing lead identity, but `details` must not include the full encoded CRM payload or endpoint query-string secrets.

### Sheet Sync

| Owner data | Capture point | Event key | Level | Notification | Required fields |
| --- | --- | --- | --- | --- | --- |
| Sheet sync intent persisted for domain write | `api/services/sheetSync/sheetSyncCoordinator.ts#persistSheetSyncIntent` after enqueue in queued mode | `sheet_sync.intent.persisted` | `info` | `dashboard` | `operation`, `resource`, `entity_type`, `entity_id`, `lead_name`, `lead_phone`, `lead_email` when reloadable |
| Sheet sync queue wake-up published | `api/services/sheetSync/sheetSyncQueue.service.ts#publishSheetSyncWakeup` success | `sheet_sync.queue.published` | `info` | `dashboard` | `reason`, `topic`, `messageId` |
| Sheet sync queue publish failed | `publishSheetSyncWakeup` catch | `sheet_sync.queue.publish_failed` | `error` | `near` | `reason`, `topic`, `causeMessage` |
| Sheet sync cron drain completed | `api/services/sheetSync/drainer/runSheetSyncDrain.ts` run summary | `sheet_sync.drain.completed` | `info` | `digest` | `trigger`, `runId`, `claimed`, `synced`, `failed`, `deferred` |
| Sheet sync cron drain partial failure | `runSheetSyncDrain` when `failed > 0 || deferred > 0` | `sheet_sync.drain.partial_failure` | `warn` or `error` | `near`; immediate if repeated | `trigger`, `runId`, `claimed`, `synced`, `failed`, `deferred`, `oldestFailedJob` if available |
| Sheet sync cron drain failed | `runSheetSyncDrain` catch and `sheet-sync-cron.routes.ts` catch | `sheet_sync.drain.failed` | `error` | `immediate` | `trigger`, `runId`, `claimed`, `synced`, `failed`, `deferred`, `causeMessage` |
| Individual sheet write failed | `api/services/sheetSync/drainer/batchWriter.ts#failGroup` or after outcomes grouped per job | `sheet_sync.write.failed` | `error` | `near`; immediate if exhausted attempts | `jobId`, `resource`, `operation`, `entity_type`, `entity_id`, `spreadsheetId`, `tabName`, `action`, `error` |
| Sheet write deferred due to quota | `batchWriter.ts#deferGroup` | `sheet_sync.write.deferred_quota` | `warn` | `near` | `spreadsheetId`, `tabName`, `writes`, `quota_budget_exhausted` |
| Job exhausted attempts | `runSheetSyncDrain#markJobFailure` when attempts reaches max | `sheet_sync.job.exhausted` | `error` | `immediate` | `jobId`, `resource`, `operation`, `entity_type`, `entity_id`, `attempts`, `last_error` |

Implementation note:

Sheet sync event identity should be best-effort. For `source_lead`, `booking_chain`, and `cancellation_chain` jobs, reload the linked document in the drainer or planner and attach `lead_name`, `lead_phone`, `lead_email`, `source_company`, and `job_no` when available.

### Route And Service Failures

| Owner data | Capture point | Event key | Level | Notification | Required fields |
| --- | --- | --- | --- | --- | --- |
| Unexpected 5xx in lead routes | `api/routes/v1.routes.ts#sendError` for non-AppError or AppError >=500, inspect `requestPath(req)` | `lead.route.failed` | `error` | `immediate` | `route`, `method`, `request_id`, `statusCode`, `errorName`, `errorCode`, `causeMessage` |
| Unexpected 5xx in booking routes | same `sendError` path | `booking.route.failed` | `error` | `immediate` | same fields plus `lead_ref`, `job_no` when parseable |
| Unexpected 5xx in cancellation routes | same `sendError` path | `cancellation.route.failed` | `error` | `immediate` | same fields plus `booking_id`, `job_no` when parseable |
| Malformed request body | `api/index.ts` body parse error handler | `http.body.parse_failed` | `warn` | `near` | `route`, `method`, `request_id`, `origin`, `contentType` |
| Slow owner-impacting route | `httpLogger` custom success object or follow-up middleware | `http.request.slow` | `warn` | `dashboard`; digest if repeated | `route`, `method`, `statusCode`, `duration_ms`, `request_id` |

Implementation note:

Do not emit owner emails for every 4xx validation failure. Use aggregation/threshold incidents for spikes by source company or route.

## Backend Admin API

Add a focused service folder:

```text
api/services/observability/
```

Suggested modules:

```text
recordOperationalEvent.ts
operationalEventSanitizer.ts
operationalIncident.service.ts
notificationPolicy.ts
emailNotification.service.ts
operationalReports.service.ts
adminObservability.service.ts
```

Add validation:

```text
api/validation/v1/observability.validation.ts
```

Re-export from:

```text
api/validation/v1.validation.ts
```

Add admin routes in `api/routes/v1.routes.ts`:

```text
GET   /api/v1/admin/observability/overview
GET   /api/v1/admin/observability/events
GET   /api/v1/admin/observability/events/:id
GET   /api/v1/admin/observability/incidents
GET   /api/v1/admin/observability/incidents/:id
PATCH /api/v1/admin/observability/incidents/:id/status
GET   /api/v1/admin/observability/notifications
GET   /api/v1/admin/observability/reports
POST  /api/v1/admin/observability/reports/run
GET   /api/v1/admin/exports/observability/events.csv
GET   /api/v1/admin/exports/observability/incidents.csv
GET   /api/v1/admin/exports/observability/reports/:id.csv
```

All routes use the existing `requireApiSecret` protection inherited by `v1.routes.ts`.

### Query Parameters

Shared filters:

```text
from
to
level
severity
status
category
workflow
event_key
source_company
lead_name
lead_phone
lead_email
route
entity_type
entity_id
run_id
request_id
notification_candidate
reportable
q
page
limit
sort
direction
```

Defaults:

```text
from = start of current day America/New_York for overview
to = now
limit = 50
sort = occurred_at or last_seen_at
direction = desc
```

Do not expose `database_scope` for Observational v1. Operational events live in the production operational database because they describe the running production server, not historical business records.

### Overview Response

```json
{
  "ok": true,
  "data": {
    "generated_at": "2026-06-11T18:00:00.000Z",
    "period": {
      "from": "2026-06-11T04:00:00.000Z",
      "to": "2026-06-11T18:00:00.000Z",
      "timezone": "America/New_York"
    },
    "health": {
      "overall_status": "degraded",
      "open_critical": 1,
      "open_error": 4,
      "open_warn": 8
    },
    "event_counts_by_level": [],
    "event_counts_by_category": [],
    "event_counts_by_workflow": [],
    "top_open_incidents": [],
    "recent_critical_events": [],
    "sheet_sync": {
      "mode": "outbox",
      "pending": 0,
      "failed": 0,
      "backlog_age_ms": 0,
      "last_run": null
    },
    "ringcentral": {
      "last_call_log_sync": null,
      "last_analytics_reconcile": null,
      "open_incidents": 0
    },
    "notifications": {
      "sent_today": 0,
      "failed_today": 0,
      "suppressed_today": 0
    }
  }
}
```

The `sheet_sync` field can reuse the existing `getSheetSyncHealth()` service. That gives the Observational tab one unified health surface while preserving the existing sheet-sync admin endpoints.

### Events List Response

Use the same pagination shape as existing admin browse endpoints:

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

Projection for list rows:

```text
_id
occurred_at
level
event_key
category
workflow
summary
source_company
lead_name
lead_phone
lead_email
route
entity_type
entity_id
run_id
incident_id
notification_candidate
reportable
```

Event detail should include full sanitized `details`, `trace`, and linked incident summary.

### Incidents List Response

List projection:

```text
_id
status
severity
event_key
category
workflow
title
summary
source_company
route
entity_type
entity_id
first_seen_at
last_seen_at
count
owner_visible
notification_state
```

Incident detail should include:

- Incident document.
- Latest 50 linked events.
- Linked notification deliveries.
- Suggested operator action.

### Status Mutation

Route:

```text
PATCH /api/v1/admin/observability/incidents/:id/status
```

Body:

```json
{
  "status": "acknowledged",
  "actor": "admin-user-id-or-email",
  "note": "Investigating sheet sync failures."
}
```

Allowed status transitions:

```text
open -> acknowledged
open -> resolved
open -> ignored
acknowledged -> resolved
acknowledged -> ignored
ignored -> open
resolved -> open
```

Each mutation records an `admin.incident.status_changed` operational event.

## Deterministic Summary Reports

Reports should be deterministic functions of:

```text
report_key
report_version
period
timezone
filters
input collections
```

Initial report keys:

```text
daily-owner-operational-summary
workflow-failure-summary
source-company-issue-summary
sheet-sync-health-summary
ringcentral-health-summary
notification-delivery-summary
http-error-summary
```

### Daily Owner Operational Summary

Inputs:

- `operational_events`
- `operational_incidents`
- `notification_deliveries`
- existing sheet sync health/runs/jobs
- lead/booking/cancellation counts from current analytics services if needed

Sections:

- Executive status: healthy, degraded, or critical.
- New critical/error/warn incidents.
- Resolved incidents.
- Sheet sync status.
- RingCentral status.
- CRM/Google Sheets failures.
- Notifications sent and failed.
- Lead/booking/cancellation counts if included.
- Recommended actions.

### Workflow Failure Summary

Group by:

```text
category
workflow
event_key
level
```

Metrics:

```text
event_count
incident_count
open_incident_count
critical_count
error_count
warn_count
first_seen_at
last_seen_at
```

### Source Company Issue Summary

Group by:

```text
source_company
workflow
event_key
```

Metrics:

```text
event_count
open_incident_count
affected_entity_count
latest_event_at
```

### Report Execution

Report generation can run synchronously for small date ranges.

For larger ranges:

- Create `operational_report_runs` with `status=running`.
- Execute aggregation.
- Save result and `result_hash`.
- Return report run ID.

For v1, synchronous execution is acceptable if:

- Date range is capped at 90 days.
- Aggregations use indexed `$match` first.
- Result rows are capped.
- Exports are capped at 5,000 rows.

## Efficient Aggregation Patterns

All report pipelines must start with an indexed date match:

```javascript
{ $match: { occurred_at: { $gte: from, $lt: to }, reportable: true } }
```

Then apply selective filters:

```javascript
{
  $match: {
    ...(category ? { category } : {}),
    ...(workflow ? { workflow } : {}),
    ...(source_company ? { source_company } : {}),
    ...(level ? { level } : {}),
  }
}
```

Then group:

```javascript
{
  $group: {
    _id: {
      category: "$category",
      workflow: "$workflow",
      event_key: "$event_key",
      level: "$level"
    },
    event_count: { $sum: 1 },
    first_seen_at: { $min: "$occurred_at" },
    last_seen_at: { $max: "$occurred_at" }
  }
}
```

Keep `$lookup` out of list endpoints. Detail endpoints may fetch linked records with separate indexed queries.

## Vantage Admin Observational Tab

Add a protected dashboard route:

```text
vantage-admin/app/(dashboard)/observational/page.tsx
```

Add a dashboard component folder:

```text
vantage-admin/components/observational/
```

Suggested components:

```text
observational-dashboard.tsx
observational-overview-cards.tsx
observational-events-table.tsx
observational-incidents-table.tsx
observational-event-detail.tsx
observational-incident-detail.tsx
observational-report-builder.tsx
observational-report-result.tsx
observational-notifications-table.tsx
observational-filter-bar.tsx
```

Add nav item:

```text
Label: Observational
Href: /observational
Icon: Activity or Radar
```

### Page Layout

Use a tabbed dashboard layout inside `/observational`.

Tabs:

- Overview
- Events
- Incidents
- Reports
- Notifications
- Sheet Sync

The Sheet Sync tab can initially link to or embed existing sheet-sync health/jobs/runs data from `vantage-main-server`. If there is not yet a dedicated admin UI for those existing endpoints, this is where it should appear.

### Overview Tab

Top cards:

- Overall status.
- Open critical incidents.
- Open errors.
- Open warnings.
- Events today.
- Notifications sent today.
- Notification failures.
- Sheet sync backlog.

Charts/tables:

- Events by level.
- Events by category.
- Events by workflow.
- Top source companies with issues.
- Recent critical events.
- Top open incidents.

Actions:

- Refresh.
- Export events CSV for current filters.
- Run daily owner report.

### Events Tab

Use existing admin table patterns:

- `DataTable`
- `TableLoadingState`
- `TableErrorState`
- `DateRangeFilter`
- `FilterField`
- `SelectFilter`
- `PaginationControls`
- `useUrlTableState`
- `queryKeys`

Columns:

```text
Occurred
Level
Event
Workflow
Category
Summary
Source
Lead Name
Phone
Email
Entity
Route
Incident
Reportable
```

Filters:

```text
Date range
Level
Category
Workflow
Event key
Source company
Lead name
Lead phone
Lead email
Entity type
Entity ID
Route
Run ID
Request ID
Reportable
Search
```

Row click:

Open a `SidePanel` with event detail:

- Summary.
- Details JSON.
- Trace summary.
- Linked incident.
- Lead name, phone, and email when available.
- Linked entity ID.
- Request ID.
- Run ID.

### Incidents Tab

Columns:

```text
Last Seen
Severity
Status
Title
Workflow
Source
Lead
Count
Owner Visible
Notifications
```

Filters:

```text
Status
Severity
Category
Workflow
Event key
Source company
Lead name
Lead phone
Lead email
Owner visible
Date range
Search
```

Row click:

Open a `SidePanel` with:

- Incident timeline.
- Latest linked events.
- Lead name, phone, and email when available.
- Notification history.
- Suggested operator action.
- Acknowledge, resolve, ignore, or reopen buttons.

Status mutation behavior:

- Call `/api/proxy/api/v1/admin/observability/incidents/:id/status`.
- Invalidate `queryKeys.observability.incidents`, `queryKeys.observability.events`, and `queryKeys.observability.overview`.
- Show a `FeedbackMessage` on success/failure.

### Reports Tab

Report builder controls:

- Report type.
- Date range.
- Timezone.
- Group by.
- Level.
- Category.
- Workflow.
- Source company.
- Include resolved incidents.
- Include owner-only summary.

Report result sections:

- Report metadata.
- Result hash.
- Generated at.
- Summary cards.
- Deterministic grouped table.
- Export CSV.
- Send owner email if authorized by policy.

For v1, report definitions should be fixed server-side. The admin UI can choose filters, but not arbitrary Mongo pipelines.

### Notifications Tab

Columns:

```text
Created
Purpose
Status
Recipient Type
Subject
Provider
Attempts
Sent At
Error
```

Filters:

```text
Status
Purpose
Recipient type
Provider
Date range
Incident ID
Report run ID
Search
```

Row detail:

- Delivery metadata.
- Provider response.
- Error message.
- Linked incident/event/report.

### Sheet Sync Tab

Use existing backend endpoints:

```text
GET /api/v1/admin/sheet-sync/health
GET /api/v1/admin/sheet-sync/jobs
GET /api/v1/admin/sheet-sync/runs
GET /api/v1/admin/sheet-sync/runs/:id
POST /api/v1/admin/sheet-sync/retry
```

Display:

- Health card.
- Jobs by status.
- Oldest pending job.
- Last run summary.
- Failed jobs table.
- Runs table.
- Retry failed jobs action.

Also show linked operational incidents for `sheet_sync`.

## Vantage Admin API Client Changes

Add types to:

```text
vantage-admin/lib/api/types.ts
```

Types:

```text
OperationalEvent
OperationalIncident
NotificationDelivery
OperationalReportRun
ObservabilityOverviewResponse
OperationalReportKey
```

Add functions to:

```text
vantage-admin/lib/api/admin.ts
```

Functions:

```typescript
fetchObservabilityOverview(filters)
fetchOperationalEvents(filters)
fetchOperationalEventDetail(id)
fetchOperationalIncidents(filters)
fetchOperationalIncidentDetail(id)
updateOperationalIncidentStatus(id, body)
fetchNotificationDeliveries(filters)
fetchOperationalReports(filters)
runOperationalReport(body)
observabilityEventsExportUrl(filters)
observabilityIncidentsExportUrl(filters)
observabilityReportExportUrl(reportRunId)
```

Add query keys to:

```text
vantage-admin/lib/query/keys.ts
```

Shape:

```typescript
observability: {
  all: ["observability"],
  overview: (filters) => [...],
  events: (filters) => [...],
  eventDetail: (id) => [...],
  incidents: (filters) => [...],
  incidentDetail: (id) => [...],
  notifications: (filters) => [...],
  reports: (filters) => [...],
  reportRun: (id) => [...],
}
```

## UI State and Filtering

Use URL state for all filters so the owner/developer can share a view.

Examples:

```text
/observational?tab=incidents&status=open&severity=critical
/observational?tab=events&category=ringcentral&level=error
/observational?tab=reports&report_key=daily-owner-operational-summary&from=2026-06-01&to=2026-06-11
```

The current `useUrlTableState` supports table filters. The Observational dashboard can either:

- Reuse it with a `tab` field, or
- Add a small `useUrlDashboardState` helper if tab state becomes awkward.

Keep pagination, sort, and filters server-side.

## Visual Severity Rules

Use consistent status treatment:

```text
critical: red, strongest emphasis
error: red
warn: amber
info: blue or neutral
resolved: green
acknowledged: gold/amber
ignored: steel/neutral
```

The existing `StatusBadge` can be extended if it already supports enough variants. Otherwise add an Observational-specific badge component in `components/observational/`.

## Linking Strategy

Events and incidents should link to business records when possible, but should not assume every entity has a detail page.

Mapping:

```text
form_lead -> /form-leads?record=<id>
call_lead -> /call-leads?record=<id>
booked_lead -> /bookings?record=<id>
cancelled_lead -> /cancellations?record=<id>
customer -> /customers?record=<id>
agent -> /agents?record=<id>
sheet_sync_job -> /observational?tab=sheet-sync&job_id=<id>
sheet_sync_run -> /observational?tab=sheet-sync&run_id=<id>
```

If detail routes do not exist, open the corresponding list page with filters.

## Implementation Order

1. Add `api/config/domain/observability.ts` with env readers for enablement, write mode, collection names, capture flags, email policy, and SendGrid mode.
2. Add `OperationalEvent`, `OperationalIncident`, `NotificationDelivery`, and `OperationalReportRun` models using collection names from the observability config.
3. Add `api/services/observability/operationalEventSanitizer.ts`, `leadIdentity.ts`, and `recordOperationalEvent.ts`.
4. Add incident dedupe/upsert logic in `api/services/observability/operationalIncident.service.ts`.
5. Add SendGrid-backed notification provider and delivery persistence in `api/services/observability/emailNotification.service.ts`.
6. Instrument auth/source-secret decisions in `api/middleware/requireApiSecret.ts`.
7. Instrument form lead create, duplicate detection, call lead form-fill detection, and call lead create in `api/services/leads/`.
8. Instrument ZIP/state fallback in `api/services/leads/leadLocation.service.ts` and Google Maps lookup failures in `api/services/googleMaps/geocoding.ts`.
9. Instrument booking create/upsert/duplicate and cancellation create in `api/services/bookings/` and `api/services/cancellations/`.
10. Instrument CRM started/completed/http_error/failed/skipped in `api/services/crm/` and `api/services/leads/formLead.service.ts`.
11. Instrument RingCentral per-lead ingest and Call Log cron summaries in `api/services/ringcentral/`.
12. Instrument sheet-sync intent, queue publish, drain summary, partial failure, run failure, write failure, quota deferral, and exhausted jobs in `api/services/sheetSync/`.
13. Instrument unexpected route failures in `api/routes/v1.routes.ts#sendError` and malformed body parsing in `api/index.ts`.
14. Add admin observability service and validation schemas.
15. Add admin observability routes.
16. Add report generation service with fixed report definitions.
17. Add Vantage Admin API types, client functions, and query keys.
18. Add `/observational` nav item and page shell.
19. Build Overview, Events, and Incidents tabs.
20. Build Reports and Notifications tabs.
21. Fold existing sheet-sync health/jobs/runs into the Sheet Sync tab.
22. Add CSV exports.
23. Add tests for env collection resolution, event sanitization, lead identity capture, incident dedupe, SendGrid delivery mode, report determinism, backend query filters, and admin API URL construction.

## Testing Specification

Backend unit tests:

- `recordOperationalEvent` inserts sanitized event.
- Error event creates or updates incident.
- Repeated fingerprint increments incident count.
- Success event auto-resolves matching incident.
- Notification policy suppresses repeated sends.
- Report result hash is stable for same inputs.
- Report rows sort deterministically.
- Query filters generate indexed Mongo filters.

Admin tests:

- API client builds expected proxy URLs.
- Query keys include stable filter objects.
- Observational filters preserve URL state.
- Incident status mutation invalidates correct query keys.
- Report builder sends normalized filters.

Manual verification:

- Trigger a test operational event.
- Confirm it appears in Vercel logs and Observational Events.
- Trigger repeated failure.
- Confirm one incident increments count.
- Resolve incident.
- Confirm it leaves open incident cards.
- Run daily report twice.
- Confirm result hash matches.
- Send test email.
- Confirm notification delivery is recorded.

## Open Decisions

Provider:

- Default recommendation remains Resend unless Vantage already has a preferred email provider.

Retention:

- Start with 180 days for events and 400 days for incidents, deliveries, and reports.

Owner visibility:

- Add `owner_visible` to incidents and reports early so developer-only noise does not leak into owner-facing summaries.

Historical scope:

- Keep Observational v1 production-only. Historical business data can be included in analytics reports, but operational events describe the running server.

Rollups:

- Add rollups only after direct indexed queries become slow.

## Definition of Done

The architecture is complete when:

- Important workflow events are durable, searchable, and grouped by stable fields.
- Repeated failures create one incident with an incrementing count.
- Owner email notifications are policy-driven and throttled.
- Daily owner reports are deterministic and persisted with result hashes.
- `vantage-admin` has an Observational nav item with Overview, Events, Incidents, Reports, Notifications, and Sheet Sync tabs.
- All admin data flows through `/api/proxy/...`.
- No raw secrets, raw headers, or raw third-party payloads are stored in event, incident, notification, or report collections.

