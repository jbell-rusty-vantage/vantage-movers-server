# Observational Admin UI — Build Handoff

The server-side observability + email-notification system is implemented and
shipping in `vantage-main-server` (branch `feat/server-observability-notifications`).
This document is the handoff for the `vantage-admin` Observational tab build.

The admin UI is the only remaining piece. It must fetch all Observational data
through the local `/api/proxy/...` route — never read the operational Mongo
collections directly.

## Branch to use

In `vantage-admin`, create and switch to:

```text
feat/observational-tab
```

## What already exists server-side

- Four Mongo collections: `operational_events`, `operational_incidents`,
  `notification_deliveries`, `operational_report_runs` (runtime/test/custom
  collection naming via `OBSERVABILITY_COLLECTION_MODE`).
- `recordOperationalEvent()` instrumented across auth, form/call leads, ZIP/state,
  Google Maps, CRM, bookings, cancellations, RingCentral (call-log sync,
  per-lead ingest, analytics reconcile, webhook), sheet sync (drain/partial/
  failed/write/quota/exhausted/queue-publish), unexpected route 5xx, and
  malformed body parsing.
- Incident dedupe/upsert by fingerprint, auto-resolution on matching success
  events, and inline immediate + throttled email policy.
- SendGrid email provider with `EMAIL_NOTIFICATIONS_MODE` (`live` | `sandbox` |
  `log_only` | `disabled`). **Default ships as `log_only`** — deliveries are
  recorded and subject/body are logged, but no real email is sent until flipped
  to `live`.
- Daily digest cron at `/api/cron/notifications-digest-daily` (12:00 UTC).
- All admin read/report endpoints below, protected by the existing
  `requireApiSecret` guard inherited by `v1.routes.ts`.

### Implementation notes / deviations

- `sheet_sync.intent.persisted` is intentionally **not** recorded: it runs
  inside the sheet-sync Mongo transaction (which can retry), so a durable event
  there would risk duplicate writes. It is dashboard-only and low value.
- A `finish`-based `http.request.slow` middleware was **not** added: recording
  after the response is sent risks a Vercel function freezing before the write
  completes. `http.body.parse_failed` is captured. Slow-request can be added
  later via an awaited hook if desired.
- The unit test suite runs with `OBSERVABILITY_ENABLED=false` and
  `OBSERVABILITY_COLLECTION_MODE=test` (see `scripts/test-setup.ts`) so
  observability never opens a DB connection or writes to production collections
  during tests. Production collection targeting requires both
  - `ALLOW_TEST_OBSERVABILITY=true` and `ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS=true`.
  - **Do not set `ALLOW_TEST_OBSERVABILITY` on Vercel** — deploy-time test runs would
    otherwise write observability noise. The server ignores that flag when `VERCEL=1`.

## Environment variables (fill values in `.env` / Vercel)

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
OBSERVABILITY_COLLECTION_MODE=runtime
OBSERVABILITY_COLLECTION_PREFIX=
OBSERVABILITY_EVENTS_COLLECTION=
OBSERVABILITY_INCIDENTS_COLLECTION=
OBSERVABILITY_NOTIFICATIONS_COLLECTION=
OBSERVABILITY_REPORT_RUNS_COLLECTION=
OBSERVABILITY_ROLLUPS_COLLECTION=

EMAIL_PROVIDER=sendgrid
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_NOTIFICATIONS_MODE=log_only
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
SENDGRID_TO_EMAIL=
SENDGRID_DEVELOPER_TO_EMAIL=
ALERT_EMAIL_REPLY_TO=
ALERT_EMAIL_MIN_LEVEL=error
ALERT_EMAIL_IMMEDIATE_LEVELS=critical
ALERT_EMAIL_THROTTLE_MINUTES=60
ALERT_EMAIL_DAILY_DIGEST_ENABLED=true
ALERT_EMAIL_DAILY_DIGEST_CRON_TIME=12:00
ALERT_EMAIL_OWNER_EVENTS=booking.created,cancellation.created,crm.form_lead.submit.failed,sheet_sync.drain.failed,ringcentral.call_log_sync.failed
ALERT_EMAIL_NEAR_WORTHY_DIGEST_EVENTS=lead.form.duplicate_detected,lead.call.form_fill_detected,zip_state.lookup.missing,sheet_sync.drain.partial_failure
```

`CRON_SECRET` already exists and protects the digest cron.

## Backend endpoints (reach via `/api/proxy/...`)

All return `{ ok: true, data }`; list endpoints return
`{ ok: true, data: { items, page, limit, total, has_next_page } }`; errors
return `{ ok: false, error, issues? }`. CSV endpoints return `text/csv`.

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

The proxy needs no path registration — any `api/v1/...` path flows through
`/api/proxy/[...path]`.

### Query parameters

Events (`/observability/events`, `events.csv`):

```text
from, to, level, category, workflow, event_key, source_company,
lead_name, lead_phone, lead_email, route, entity_type, entity_id,
run_id, request_id, notification_candidate, reportable, q,
page, limit, sort, direction
```

Incidents (`/observability/incidents`, `incidents.csv`):

```text
from, to, status, severity, category, workflow, event_key, source_company,
lead_name, lead_phone, lead_email, entity_type, entity_id, owner_visible,
q, page, limit, sort, direction
```

Notifications (`/observability/notifications`):

```text
from, to, status, purpose, recipient_type, provider, incident_id,
report_run_id, q, page, limit, direction
```

Reports list (`/observability/reports`): `report_key, status, page, limit`.

Incident status `PATCH` body:

```json
{ "status": "acknowledged", "actor": "owner@example.com", "note": "Investigating." }
```

Allowed transitions: `open -> acknowledged|resolved|ignored`,
`acknowledged -> resolved|ignored`, `ignored -> open`, `resolved -> open`,
`auto_resolved -> open`. Each mutation records an
`admin.incident.status_changed` event.

Report run `POST /observability/reports/run` body:

```json
{
  "report_key": "daily-owner-operational-summary",
  "from": "2026-06-01",
  "to": "2026-06-11",
  "timezone": "America/New_York",
  "category": "sheet_sync",
  "workflow": "...",
  "source_company": "...",
  "level": "error",
  "include_resolved": false
}
```

Report keys: `daily-owner-operational-summary`, `workflow-failure-summary`,
`source-company-issue-summary`, `sheet-sync-health-summary`,
`ringcentral-health-summary`, `notification-delivery-summary`,
`http-error-summary`. Each run is persisted with a stable `result_hash`
(re-running identical inputs yields the same hash).

### Overview response shape

```json
{
  "ok": true,
  "data": {
    "generated_at": "...",
    "period": { "from": "...", "to": "...", "timezone": "America/New_York" },
    "health": { "overall_status": "degraded", "open_critical": 1, "open_error": 4, "open_warn": 8 },
    "event_counts_by_level": [{ "key": "error", "count": 4 }],
    "event_counts_by_category": [],
    "event_counts_by_workflow": [],
    "top_open_incidents": [],
    "recent_critical_events": [],
    "sheet_sync": { "mode": "...", "jobs_by_status": {}, "pending": 0, "failed": 0, "backlog_age_ms": 0, "last_run": null },
    "ringcentral": { "open_incidents": 0 },
    "notifications": { "sent_today": 0, "failed_today": 0, "suppressed_today": 0 }
  }
}
```

## Admin UI plan (`vantage-admin`)

Follow the existing conventions documented in
`vantage-admin/.cursor/rules/project-organization.mdc`.

### Files to add / edit

| Area | File |
| --- | --- |
| Page route | `app/(dashboard)/observational/page.tsx` (thin server component) |
| Route guard | `server/auth/routeGuard.ts` -> add `/observational` to `DASHBOARD_PATH_PREFIXES` |
| Nav item | `components/layout/dashboard-nav.tsx` -> `{ label: "Observational", href: "/observational", icon: Activity }` (lucide `Activity` or `Radar`) |
| Main UI | `components/observability/observability-dashboard.tsx` (client) + tab subcomponents |
| API client | `lib/api/observability.ts` (new, mirror `lib/api/admin.ts`) |
| Types | extend `lib/api/types.ts` or co-locate in `observability.ts` |
| Query keys | `lib/query/keys.ts` -> `observability` namespace |
| Tests | `lib/query/keys.test.ts`, optional `lib/api/observability.test.ts` |

### Page layout (tabbed)

Use a URL-synced tab param (`?tab=events`) with the existing styled button-group
pattern from `components/analytics/analytics-dashboard.tsx` (there is no shadcn
`Tabs` primitive in the project). Tabs:

- **Overview** — KPI cards (overall status, open critical/error/warn, events
  today, notifications sent/failed, sheet-sync backlog) + counts-by-level/
  category/workflow + top open incidents + recent critical events. Reuse
  `SummaryCards`/`KpiCard` + Recharts patterns from the analytics dashboard.
- **Events** — `DataTable` + `FilterBar` + `PaginationControls` + `useUrlTableState`,
  row click opens `SidePanel` with full `details`/`trace`/linked incident and
  lead identity.
- **Incidents** — table + `SidePanel` with timeline, latest events, notification
  history, suggested action, and Acknowledge/Resolve/Ignore/Reopen buttons that
  call `PATCH .../incidents/:id/status` and invalidate
  `observability.overview/events/incidents`.
- **Reports** — report builder (type/date range/timezone/filters) calling
  `POST .../reports/run`; show metadata, `result_hash`, summary cards,
  deterministic grouped table, and CSV export.
- **Notifications** — `notification_deliveries` table + detail.
- **Sheet Sync** — reuse existing `/api/v1/admin/sheet-sync/health|jobs|runs|retry`
  endpoints; also show linked `sheet_sync` operational incidents.

### API client (`lib/api/observability.ts`)

Mirror `admin.ts` (`proxyUrl` + `requestJson`, `credentials: "include"`):

```text
fetchObservabilityOverview(filters)
fetchOperationalEvents(filters)
fetchOperationalEventDetail(id)
fetchOperationalIncidents(filters)
fetchOperationalIncidentDetail(id)
updateOperationalIncidentStatus(id, body)   // PATCH
fetchNotificationDeliveries(filters)
fetchOperationalReports(filters)
runOperationalReport(body)                   // POST
observabilityEventsExportUrl(filters)
observabilityIncidentsExportUrl(filters)
observabilityReportExportUrl(reportRunId)
```

### Query keys (`lib/query/keys.ts`)

```ts
observability: {
  all: ["observability"] as const,
  overview: (filters?) => [...queryKeys.observability.all, "overview", stableFilters(filters)] as const,
  events: (filters?) => [...queryKeys.observability.all, "events", stableFilters(filters)] as const,
  event: (id: string) => [...queryKeys.observability.all, "event", id] as const,
  incidents: (filters?) => [...queryKeys.observability.all, "incidents", stableFilters(filters)] as const,
  incident: (id: string) => [...queryKeys.observability.all, "incident", id] as const,
  notifications: (filters?) => [...queryKeys.observability.all, "notifications", stableFilters(filters)] as const,
  reports: (filters?) => [...queryKeys.observability.all, "reports", stableFilters(filters)] as const,
  reportRun: (id: string) => [...queryKeys.observability.all, "report-run", id] as const,
}
```

### Visual severity

`critical`/`error` = destructive (red), `warn` = warning (amber), `info` =
neutral/blue, `resolved` = success (green), `acknowledged` = warning,
`ignored` = muted. Extend the existing `StatusBadge` (`tone` values:
`default | success | warning | destructive | muted`).

### Entity linking

```text
form_lead       -> /form-leads?record=<id>
call_lead       -> /call-leads?record=<id>
booked_lead     -> /bookings?record=<id>
cancelled_lead  -> /cancellations?record=<id>
customer        -> /customers?record=<id>
sheet_sync_job  -> /observational?tab=sheet-sync&job_id=<id>
```

## Done when

- `/observational` nav item renders the tabbed dashboard behind the route guard.
- All data flows through `/api/proxy/...`.
- Incident status mutations work and invalidate the right query keys.
- Reports can be run and exported; the same inputs show the same `result_hash`.
- No raw secrets/headers/payloads are surfaced (the backend already enforces this).
