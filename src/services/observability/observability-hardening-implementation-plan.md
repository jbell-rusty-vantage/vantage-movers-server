# Observability Hardening Implementation Plan

This plan is based on the current observability service, config, models, and notification cron route. It turns the review findings in `observability-review-report.md` into an implementation sequence without changing behavior yet.

Primary goals:

- Preserve the current best-effort behavior: observability must not break lead, booking, cancellation, CRM, RingCentral, or sheet-sync workflows.
- Make event capture, incident state, notifications, and metrics trustworthy.
- Clarify whether metrics are live aggregations only or backed by persisted rollups.
- Add targeted tests for the high-risk behavior before updating broader project documentation.

## Current Baseline

Existing persisted collections:

- `operational_events`, via `api/models/OperationalEvent.ts`
- `operational_incidents`, via `api/models/OperationalIncident.ts`
- `notification_deliveries`, via `api/models/NotificationDelivery.ts`
- `operational_report_runs`, via `api/models/OperationalReportRun.ts`

Configured but not implemented:

- `operational_event_rollups`, named in `api/config/domain/observability.ts` but with no model or writer.

Important service entry points:

- `recordOperationalEvent.ts`: main write path for events, incident upsert, auto-resolution, and notification dispatch.
- `operationalIncident.service.ts`: incident dedupe/upsert and auto-resolution.
- `notificationPolicy.ts`: immediate alert policy and incident notification-state updates.
- `emailNotification.service.ts`: delivery persistence and provider send.
- `notificationDigest.service.ts`: daily digest and failed-delivery retry.
- `operationalReports.service.ts`: deterministic report generation.
- `adminObservability.service.ts`: overview, list/detail, exports, and incident status mutation.
- `notification-cron.routes.ts`: Vercel cron route for daily digest and retries.

## Implementation Phases

### Phase 1: Stabilize Incident State and Notification Semantics

This should be the first implementation pass because it fixes misleading owner/admin state without changing the external API shape.

#### 1.1 Escalate deduped incident severity

Files:

- `api/services/observability/operationalIncident.service.ts`
- `api/config/domain/observability.ts`
- `api/services/observability/operationalIncident.service.test.ts` (new)

Plan:

- Use `observabilityLevelRank()` or a small incident severity rank helper to compare the existing incident severity with the incoming severity.
- When `upsertIncidentForEvent()` updates an existing open/acknowledged incident, preserve the worse severity.
- Keep `$setOnInsert` for new incident defaults, but add update logic that can raise `severity`.
- Avoid lowering severity automatically when later lower-severity events arrive.

Acceptance criteria:

- First `warn`, then same-fingerprint `critical`, leaves one open incident with `severity: "critical"` and `count: 2`.
- First `critical`, then same-fingerprint `warn`, leaves severity as `critical`.
- Event creation remains best-effort even if incident update fails.

#### 1.2 Only mark incidents notified when a send succeeds

Files:

- `api/services/observability/notificationPolicy.ts`
- `api/services/observability/notificationPolicy.test.ts` (new or expanded)

Plan:

- In `dispatchEventNotifications()`, call `markIncidentNotified()` only when `sendNotification()` returns `ok: true`.
- If the send fails, do not advance `notification_state.next_notify_at`.
- Optionally add a shorter retry marker later, but keep this pass conservative.

Acceptance criteria:

- Failed provider result does not throttle the original incident for the full alert throttle window.
- Successful provider result still sets `immediate_sent_at` and `next_notify_at`.
- Suppressed repeated alerts still increment `notification_state.suppressed_count`.

#### 1.3 Fix failed notification retry semantics

Files:

- `api/models/NotificationDelivery.ts`
- `api/services/observability/emailNotification.service.ts`
- `api/services/observability/notificationDigest.service.ts`
- `api/services/observability/notificationDigest.service.test.ts` (new)

Recommended model additions:

- `parent_delivery_id: ObjectId | null`
- `last_attempt_at: Date | null`
- `next_attempt_at: Date | null` is already present but unused
- `superseded_at: Date | null` or use existing `cancelled` status for superseded original attempts
- Optional: `body_text: string | null` if full retry body is required

Plan:

- Decide whether retries should be represented in-place or as child delivery records.
- Preferred approach: retry in place for failed deliveries so metrics count one logical delivery, with `attempt_count` and `last_attempt_at` reflecting attempts.
- If child records are retained, mark the original as `cancelled`/superseded and exclude superseded records from summary metrics.
- Stop marking an original failed provider attempt as `sent` after a child retry succeeds.
- Do not retry from `body_text_preview` unless truncated body sends are acceptable. Either store a retry-safe full `body_text` or only retry delivery types where the current preview is the intended full body.
- Start using `next_attempt_at` so retry cadence is explicit and index-backed.

Acceptance criteria:

- A failed delivery retried successfully does not produce two `sent` records in same-period metrics.
- Repeated retry failures do not fan out into an expanding retry set.
- `attempt_count` reaches `MAX_RETRY_ATTEMPTS` and then stops retrying.
- Retry tests cover both success and repeated failure paths.

### Phase 2: Capture Cron and HTTP Observability Gaps

This phase improves coverage for events that currently only appear in raw logs or config.

#### 2.1 Record notification cron failures

Files:

- `api/routes/notification-cron.routes.ts`
- `api/services/observability/index.ts` if additional exports are needed
- `api/routes/notification-cron.routes.test.ts` (new)

Plan:

- Import `recordOperationalEvent()`.
- In the route catch block, record an error event before returning 500.
- Suggested event:
  - `eventKey: "notification.digest_cron.failed"`
  - `category: "cron"` or `category: "notification"`
  - `workflow: "notification_digest"`
  - `dedupeKey: notification.digest_cron.failed:${environment}`
  - `notificationCandidate: true`
- In `requireCronAuth()`, optionally record unauthorized attempts as:
  - `eventKey: "cron.auth.failed"`
  - `category: "cron"`
  - `workflow: "notification_digest"`
  - `notificationCandidate: false`
- Be careful with Express middleware: `requireCronAuth()` is currently synchronous. If recording auth failures, either make it async and handle best-effort failures or delegate to a helper with `void recordOperationalEvent(...)`.

Acceptance criteria:

- A thrown digest or retry job creates a searchable operational event and incident.
- Unauthorized cron requests still return 401 and do not block on observability failures.
- Missing `CRON_SECRET` still returns 500 without leaking secret-related detail.

#### 2.2 Wire slow-request capture

Files:

- `api/middleware/httpLogger.ts` or a new middleware such as `api/middleware/observabilityHttpCapture.ts`
- `api/index.ts`
- `api/config/domain/observability.ts`
- `api/middleware/httpLogger.test.ts` or new middleware tests

Plan:

- Use `getObservabilitySlowRequestMs()` to capture successful or non-5xx slow requests.
- Avoid duplicate capture for 5xx errors already recorded by `captureRouteFailureEvent()` in `v1.routes.ts`.
- Suggested event:
  - `eventKey: "http.request.slow"`
  - `category: "http"`
  - `workflow: "http_request"`
  - `level: "warn"`
  - `statusCode`, `durationMs`, route, method, request id
  - `notificationCandidate: false`
- Implement as response-finish middleware if pino's `responseTime` is not conveniently available for event recording.
- Consider excluding health checks, cron endpoints, or static root endpoints from slow-request capture if they create noise.

Acceptance criteria:

- A request exceeding `OBSERVABILITY_SLOW_REQUEST_MS` records one event.
- A fast request records none.
- A 5xx route failure is not double-recorded as both slow and failed unless explicitly intended.

#### 2.3 Decide and enforce owner-event capture behavior

Files:

- `api/config/domain/observability.ts`
- Owner lifecycle instrumentation files, likely:
  - `api/services/bookings/bookedLead.service.ts`
  - `api/services/cancellations/cancelledLead.service.ts`
  - `api/services/leads/formLead.service.ts`
  - `api/services/crm/crm.service.ts`
- Tests around event persistence and config gating

Decision needed:

- Option A: `OBSERVABILITY_CAPTURE_OWNER_EVENTS=false` suppresses owner-facing success milestones.
- Option B: owner milestones are always persisted unless observability is disabled, and the flag is removed to avoid false configurability.

Recommended approach:

- Keep owner lifecycle events enabled by default and make them independent of generic info-noise suppression.
- Add a helper such as `shouldPersistOwnerLifecycleEvent(eventKey)` or an input flag like `ownerVisible: true` plus event-level logic that preserves explicitly owner-visible events even when `OBSERVABILITY_CAPTURE_INFO_EVENTS=false`.

Acceptance criteria:

- Config behavior is intentional and documented in tests.
- Owner milestones are not accidentally lost when reducing info-level noise.

### Phase 3: Make Metrics and Reports Accurate

This phase fixes misleading ordering, report limits, and unused filters.

#### 3.1 Fix top open incident severity ordering

Files:

- `api/services/observability/adminObservability.service.ts`
- `api/services/observability/adminObservability.service.test.ts` (new)

Plan:

- Replace string severity sort with rank-aware sorting.
- Options:
  - Aggregation with `$addFields: { severity_rank: ... }`
  - Fetch a bounded result and sort in application code
- Rank order should be `critical > error > warn`.

Acceptance criteria:

- Overview top incidents place critical incidents before error/warn, then sort by `last_seen_at`.

#### 3.2 Sort report aggregations before limiting

Files:

- `api/services/observability/operationalReports.service.ts`
- `api/services/observability/operationalReports.test.ts`

Plan:

- For each aggregation that groups rows and then limits, add `$sort` before `$limit`.
- Use count/event_count descending first.
- Add stable secondary sort fields where possible:
  - `"_id.event_key": 1`
  - `"_id.workflow": 1`
  - `"_id.source_company": 1`
  - `"_id.route": 1`
- Keep application-level `sortRows()` as a final deterministic guard.

Acceptance criteria:

- Reports return true highest-count rows when group count exceeds `MAX_ROWS`.
- Existing result hash behavior stays deterministic for the returned rows.

#### 3.3 Apply or remove `include_resolved`

Files:

- `api/validation/v1/observability.validation.ts`
- `api/services/observability/operationalReports.service.ts`
- Report tests

Decision needed:

- If reports are event-based only, remove `include_resolved` from report input until incident-based reports use it.
- If retained, use it in incident-backed report definitions by filtering incident statuses.

Recommended approach:

- Keep the input only if a report definition actually uses incidents.
- For the daily owner summary, decide whether open/resolved incident counts should be affected by the flag. If not, do not expose the flag globally.

Acceptance criteria:

- Every accepted report input field has a visible effect or a documented reason for no effect.

#### 3.4 Tighten notification delivery query validation

Files:

- `api/validation/v1/observability.validation.ts`
- Validation tests

Plan:

- Import and use:
  - `NOTIFICATION_STATUSES`
  - `NOTIFICATION_PURPOSES`
  - `NOTIFICATION_RECIPIENT_TYPES`
- Replace arbitrary strings for `status`, `purpose`, and `recipient_type` with enums.

Acceptance criteria:

- Invalid notification filters return validation errors instead of empty successful results.
- Existing valid admin filters continue to parse.

### Phase 4: Decide Rollup Strategy

This is the only larger design decision in the plan. It should be settled before the docs are updated.

#### Option A: Defer rollups and remove active config

Files:

- `api/config/domain/observability.ts`
- `api/config/domain/observability.test.ts`
- Documentation later

Plan:

- Remove `rollups` from `ObservabilityCollectionKey`, default collection names, and custom env requirements.
- Document that all current dashboard/report metrics are live Mongo aggregations over raw events/incidents/deliveries.

Pros:

- Smallest implementation.
- No background job or consistency concerns.
- Matches the current actual behavior.

Cons:

- Overview/report queries may become heavier over time.
- Re-adding rollups later requires another config/doc update.

#### Option B: Implement persisted event rollups

Files:

- `api/models/OperationalEventRollup.ts` (new)
- `api/services/observability/operationalEventRollup.service.ts` (new)
- `api/services/observability/recordOperationalEvent.ts`
- `api/services/observability/adminObservability.service.ts`
- `api/services/observability/operationalReports.service.ts` if reports should read rollups
- `api/services/observability/index.ts`
- Tests for rollup writes and overview reads

Suggested schema:

- `bucket_start: Date`
- `bucket_end: Date`
- `granularity: "hour" | "day"`
- `environment: string`
- `service: string`
- `level: ObservabilityLevel`
- `category: OperationalEventCategory`
- `workflow: string`
- `event_key: string`
- `source_company: string | null`
- `route: string | null`
- `count: number`
- `first_seen_at: Date`
- `last_seen_at: Date`

Suggested indexes:

- Unique compound index on bucket identity:
  - `granularity`, `bucket_start`, `environment`, `service`, `level`, `category`, `workflow`, `event_key`, `source_company`, `route`
- Query index:
  - `granularity`, `bucket_start`, `category`, `workflow`

Write strategy:

- Start with inline best-effort increments from `recordOperationalEvent()` after event creation.
- Use `$inc: { count: 1 }`, `$min: { first_seen_at: occurredAt }`, `$max: { last_seen_at: occurredAt }`, and `$setOnInsert` for dimensions.
- If inline writes become too expensive, move rollup generation to a scheduled job using raw events as source of truth.

Read strategy:

- Keep raw events as source of truth for detail tables and exports.
- Use rollups only for overview charts and longer-range summary reports.
- For short windows or custom filters not covered by rollup dimensions, fall back to live aggregation.

Acceptance criteria:

- First recorded event creates or increments matching hourly and/or daily rollup docs.
- Repeated events increment the same rollup bucket.
- Rollup failure does not fail event recording.
- Admin overview can read from rollups for supported windows or clearly remains live aggregation.

Recommendation:

- If production event volume is modest right now, choose Option A for this hardening pass and explicitly defer rollups.
- If the admin dashboard is expected to query long ranges frequently, choose Option B and implement daily/hourly rollups before publishing docs that mention rollup metrics.

### Phase 5: Configuration Diagnostics and Tests

#### 5.1 Add observability config validation

Files:

- `api/config/domain/observability.ts`
- Optional script: `scripts/dev_ops/validate-observability-config.ts`
- Optional admin endpoint if useful

Plan:

- Add a pure helper such as `validateObservabilityConfig()` that returns `{ ok, errors, warnings, collectionNames }`.
- Validate custom collection env vars, email mode/provider requirements, and recipient presence.
- Do not fail startup unless explicitly desired; use this for diagnostics and tests.

Acceptance criteria:

- Misconfigured custom collection mode is detected with a clear error.
- Email live/sandbox modes warn when `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, or recipients are missing.

#### 5.2 Add focused service tests

Recommended new or expanded tests:

- `operationalIncident.service.test.ts`
  - severity escalation
  - no severity downgrade
  - auto-resolution by dedupe key
- `notificationPolicy.test.ts`
  - failed send does not throttle
  - successful send throttles
  - notification category never loops
- `notificationDigest.service.test.ts`
  - retry success/failure semantics
  - max attempts respected
- `notification-cron.routes.test.ts`
  - cron auth success/failure
  - route failure records operational event
- `adminObservability.service.test.ts`
  - severity rank sorting
- `operationalReports.test.ts`
  - aggregation sort before limit
  - `include_resolved` behavior or removal
- `observability.validation.test.ts`
  - notification enum filters

## Suggested Work Order

1. Implement incident severity escalation and tests.
2. Fix notification throttle-on-failure and retry semantics.
3. Record notification cron failures as operational events.
4. Fix overview/report sorting and validation gaps.
5. Decide rollup strategy and either remove/defer the config or implement the model/service.
6. Wire slow-request capture and settle owner-event capture behavior.
7. Add configuration diagnostics.
8. Run `pnpm test` and `pnpm run typecheck`.
9. Update project documentation only after the above behavior is final.

## Documentation Updates After Implementation

Do not update broader docs until implementation decisions are complete. When ready, update:

- `docs/log-observability-and-email-notifications.md`
- `docs/observational-admin-implementation-spec.md`
- Any admin handoff/runbook docs that mention collection names, rollups, cron behavior, or email retry behavior.

Documentation should explicitly state:

- Which collections exist and what writes them.
- Whether rollups are implemented or deferred.
- Which env flags are active and what behavior they control.
- What the daily notification cron records on success/failure.
- How notification retries are counted in metrics.
