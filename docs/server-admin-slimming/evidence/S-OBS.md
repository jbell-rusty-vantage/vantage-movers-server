# S-OBS lane evidence: SLIM-04 OperationalEvents callsite surgery

Scope: every server file outside the Granot lifecycle, Sales Intelligence, Number Activity, conversations, admin and analytics folders that wrote OperationalEvents, plus the `/admin/observability/**` HTTP surface, the notification-digest cron and the invitation mail settings. Branch `slim/server-admin`. Nothing is committed; the coordinator commits.

## What changed and why

The spec (§4) retires the OperationalEvents subsystem and requires kept workflows to keep their diagnostics in the existing structured pino logger (`src/logger.ts`). Each `recordOperationalEvent` call in this lane became a `logger.<level>` call. The call keeps the event key as `msg`, the severity (`critical` is logged as `error` with `severity: "critical"`), `workflow`, entity ids, bounded error codes and the request id where one existed. Lead names, phone numbers, emails, caller names, raw payloads and provider bodies are not copied into the new log lines. Where a logger line with the same meaning already sat next to the event, the event was deleted and that line was kept (geocoding, analytics reconcile, sheet-sync queue publish, RingCentral cron, call-log sync lease lines, CRM submit). Business errors, retry and lease behavior, transaction ordering and return values are unchanged. Owner alert emails and digests go away with the subsystem.

| Area | Files | Notes |
| --- | --- | --- |
| HTTP | `src/app.ts`, `src/middleware/requireApiSecret.ts`, `src/routes/v1.routes.ts` | Malformed-body log gains `content_type`. Auth decisions are logged by `logAuthEvent` (msg, workflow `api_secret`, request_id, method, route, source_company, closed reasons, scoped key name, user id and roles). No secret or token is logged. The timing-safe `secretsEqual` and the signed-role flow are untouched. `sendError` keeps its exact HTTP contract. Its two existing `log.error` lines now carry `event_key` (`lead.route.failed` / `booking.route.failed` / `cancellation.route.failed` / `http.request.5xx`), `workflow`, `method`, `route` and `status_code`, and `captureRouteFailureEvent` is gone. |
| Removed HTTP surface | `v1.routes.ts` (17 `/admin/observability/**` and `/admin/exports/observability/**` registrations and handlers), `src/validation/v1/observability.validation.ts`, its barrel export in `src/validation/v1.validation.ts` | These paths now get the normal 404. |
| Digest cron | `src/routes/notification-cron.routes.ts` (deleted), its `app.use` registration in `src/app.ts`, and the `notifications-digest-daily` schedule in `vercel.json` | |
| Observability services | Deleted: `adminObservability.service.ts`, `adminObservability.service.test.ts`, `operationalReports.service.ts`, `operationalReports.test.ts`, `notificationDigest.service.ts`. `observability/index.ts` no longer re-exports them. | Kept for wave 2, as instructed: `recordOperationalEvent`, `notificationPolicy`, `emailNotification.service`, `operationalIncident.service`, `index`, `testObservabilitySink`, the four models with their factory, and `config/domain/observability.ts`. |
| Mail config | New `src/config/domain/mail.ts`, which has `SendgridConfig { apiKey, fromEmail, replyTo }` and `getSendgridConfig()`, plus `mail.test.ts` | `adminInvites/inviteEmail.service.ts` now imports from it. `config/domain/observability.ts` now gets transport settings from `mail.ts` and keeps only `getAlertEmailRecipients()` (`SENDGRID_TO_EMAIL`, `SENDGRID_DEVELOPER_TO_EMAIL`) for the wave-2-deleted `notificationPolicy`. `emailNotification.service.ts` and `notificationPolicy.ts` were repointed. Invitations write no delivery record and import no notification model. |
| Lead, Booking, Cancellation | `bookings/bookedLead.service.ts`, `cancellations/cancelledLead.service.ts`, `leads/{callLead.service,formLead.service,leadCplResolution,leadLocation.service}.ts`, `employeeBookings/{bookingLeadReconciliation,reconciliationRematch,submitEmployeeBooking}.service.ts`, `crm/crm.service.ts` | `recordMissingLeadCplRate` keeps its name and is now a synchronous `void` logger call, because Granot-lane callers still `await` it. The CRM HTTP error log level went from info to error, which matches the old pino mirror. `crm.form_lead.submit.skipped` was already logged by `postTheLeadToGranotWhenDue`, so that duplicate event is gone. |
| Messaging and voice | `leadMessaging/leadMessaging.service.ts`, `routes/twilio-voice.routes.ts` | Logs carry no `to`/`from` numbers (Twilio voice masks them with `maskPhoneForLog`). The redundant try/catch around the "accepted" event is removed. |
| Commands | `domainCommands/idempotency.ts` | `logCommandOutcome` is synchronous and runs after the transaction, as before. |
| Ingestion | `ingestion/{health,worker}.ts`, `routes/best-relocation-ingestion-cron.routes.ts` | `emitIngestionHealthSignal` is synchronous; the worker no longer awaits it. |
| Registry | `operationsRegistry/{cplCorrections,labelMappings,sourceRegistry,ringCentralRegistry,ringCentralSnapshot,runtimeTelemetry,index}.ts`, `queries/{health,overview,findingTranslation}.ts`, `cpl/cplRate.service.ts` | See "Registry Health/Overview" below. The `recordEvent` dependency on CPL corrections is removed and the `logCplCorrectionEvent` helper replaces it. |
| RingCentral | `ringcentral/{analytics-reconcile,call-log-sync,ringcentral-call-lead-ingest}.service.ts`, `routes/{ringcentral-cron,ringcentral-webhook}.routes.ts` | Call-log sync no longer has a `recordEvent` dependency. It adds a `ringcentral.call_log_sync.started` log, and the lease-lost and failed lines are enriched. Ingest keeps an injectable `recordEvent` log sink, now typed `(entry: RingCentralIngestLogEntry) => unknown` with a pino default. The name stays because the protected Daily test `src/services/dailyOperations/recordDomainFacts.test.ts` injects `recordEvent: async () => null`, and that file may not be edited. |
| Sheet Sync | `sheetSync/drainer/runSheetSyncDrain.ts`, `sheetSync/sheetSyncQueue.service.ts` | `sheet_sync.drain.run_summary` is kept. Partial failure, drain failure, write failed, job exhausted and deferred quota are logged. Daily `recordSheetSyncDailyOperationsFact` calls and their order are untouched. The duplicates loop and deferred branch still satisfy the Daily text invariants. |
| Reporting | `reporting/{reportingObservability,reportingAudit}.ts`, and the callers `routes/{reporting,google-drive-oauth}.routes.ts` and `reporting/reportingWorker.ts` (`.catch` removed) | Only the generic OperationalEvents writes are gone. Every emitter is a synchronous logger call with the same key catalog. `ReportingRun`, delivery, definition history and the health scan (`scanReportingOperationalHealth`) behave as before. |
| Docs | `docs/knowledge/services/form-lead.md`, `docs/knowledge/services/operations-registry.md` | Operational Events are now described as diagnostic log keys, and the Registry compatibility and source-resolution Health semantics are updated. |

### Registry Health/Overview (event-derived fields)

- `queries/health.ts` and `queries/overview.ts` no longer read `operational_events`.
- **Removed finding** `registry.source_resolution_failures`, together with `buildSourceResolutionEventFindings` and its translation row. No authoritative retained store records source-resolution failures, so the finding is not kept or invented. The failures are logged at error/warn as `operations_registry.source_resolution_ambiguous` / `_not_found`.
- **Compatibility reads**: the durable merge is gone (`recordDurableCompatibilityRead` and `mergeDurableCompatibilityTelemetry` are deleted). `recordCompatibilityRead` keeps the existing process-local counter and also logs `operations_registry.compatibility_read`. The finding `registry.compatibility_reads_remaining` remains, but it now states the truth: the count covers "this server instance since it started", with evidence `observation_scope: "server_instance"` in place of `observation_window_started_at: "2026-09-01"`. The Owner translation text was updated to match. Overview `runtime` is plain `getRegistryRuntimeTelemetry()`.

## Deleted files

- `src/routes/notification-cron.routes.ts`
- `src/validation/v1/observability.validation.ts`
- `src/services/observability/adminObservability.service.ts`
- `src/services/observability/adminObservability.service.test.ts`
- `src/services/observability/operationalReports.service.ts`
- `src/services/observability/operationalReports.test.ts`
- `src/services/observability/notificationDigest.service.ts`

## Tests changed

- Rewritten `src/middleware/requestTelemetry.test.ts`. It now asserts the real stdout pino stream. It checks one `auth.scoped_key.accepted`, then forbidden/rejected/rejected at warn, the HTTP 200/503 duration logs, and the v1 500 with `event_key: "http.request.5xx"`, `status_code: 500` at error. It checks that neither secret appears.
- `leads/callLead.service.test.ts`, `operationsRegistry/cplCorrections.test.ts` and `ringcentral/call-log-sync.service.test.ts` now use a `mock.method(logger, …)` spy in place of the test sink. The PII and owner-hash assertions now cover the run log entries.
- `operationsRegistry/runtimeTelemetry.test.ts`: the two durable-merge tests are deleted (they tested deleted code). The process-local counter test is kept.
- New `src/config/domain/mail.test.ts`.

## Checks run (real results)

- `DOTENV_CONFIG_PATH=C:/nonexistent.env node --import tsx --import ./ops/test-setup.ts --test` covered 85 non-replica test files: Registry, leads, bookings, cancellations, employee bookings, lead messaging, ingestion, Sheet Sync, Reporting, domain commands, CRM, geocoding, CPL, admin-invite, Twilio, RingCentral, best-relocation, reporting and Drive-OAuth routes, and the observability and mail config tests. First run: 644 tests, 631 pass, 3 fail. All 3 failures were in `cplCorrections.test.ts`, which still read the event sink. After converting it: `cplCorrections.test.ts` and `mail.test.ts` gave 21/21 pass.
- `requestTelemetry.test.ts` and `requireApiSecret.test.ts`: 13/13 pass.
- `call-log-sync.service.test.ts` and `ringcentral-call-lead-ingest.service.test.ts`: 29/29 pass.
- `callLead.service.test.ts`: 18/18 pass.
- `dailyOperations/recordDomainFacts.test.ts` (protected, unmodified), `admin-invite-email-internal.routes.test.ts`, `sourceResolution.test.ts`, `runtimeTelemetry.test.ts` and `queries/health.test.ts`: 59/59 pass. The admin-invite route test was failing in the baseline and passes here.
- `pnpm typecheck` fails overall, but every remaining error is in other lanes' files: Sales Intelligence routes and tests, `numberActivity/*`, `ops/lib`, `ops/full-backfill`, `ops/inspect-number-rollups`, `ops/report-si-state` and `ops/slimming`. None is in an S-OBS file. A per-file semantic diagnostic pass (TypeScript program API over `tsconfig.json`) also showed zero errors in S-OBS files. An earlier `pnpm typecheck` run was blocked by a syntax error in another lane's `numberActivity/directorySync.ts`.
- Protected Daily Operations paths: `git status` shows no changes under `src/services/dailyOperations`, the `DailyOperations*` models or `config/domain/dailyOperations.ts`.
- Not run: replica suites, because this lane changes no transaction or persistence path.

## Retained behavior preserved

- `sendError` keeps the same statuses and bodies for Zod, VersionError, AppError (registry bodies included) and unexpected errors.
- Auth keeps the same status codes, the `RUN_SCOPE_DENIED` 403 and the timing-safe comparison.
- Invitations: `sendAdminInviteEmail` reads `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` and `ALERT_EMAIL_REPLY_TO` via `config/domain/mail.ts`, with an unchanged result contract (route test green).
- Daily facts keep their calls and order: Booking, Call Lead, Form Lead, CRM failed, Sheet Sync, Lead Message accept and status callback, and the RingCentral adoption conflict (protected test green).
- Reporting run, delivery and health keep their behavior, with the same event key catalog now emitted as log keys.

## Cross-lane items

1. **Admin (A-*)**: delete the `/observational` UI and every Admin client for `/api/v1/admin/observability/**` and `/api/v1/admin/exports/observability/**`. Those routes now return 404.
2. **Admin**: `lib/api/registryEntityLinks.ts` remediation action `review_source_resolution` no longer has a producer (finding `registry.source_resolution_failures` is removed). `components/operations-registry/registry-overview.tsx` still reads `registry.compatibility_reads_remaining` → `evidence.read_count`. That field is unchanged, but it is now a per-instance count, so any "since 2026-09-01" wording in Admin should be dropped.
3. **Wave-2 integrator**: delete the remaining `services/observability/*` files, the four models with `observabilityModelFactory`, `config/domain/observability.ts` with its test, `ops/test-setup.ts` and `scripts/dev_ops/test-setup.ts` sink installation, and the `OBSERVABILITY_*` / `EMAIL_NOTIFICATIONS_*` test env lines. Also delete `.cursor/rules/observability-service.mdc` and `src/services/observability/*.md`. No S-OBS file imports any of them.
4. **S-GRANOT**: `src/routes/granot-webhook.routes.test.ts` asserts `getCapturedOperationalEvents()` for `granot_lifecycle.capture.failed` and needs to follow the Granot Health replacement.

## Obsolete environment names (from `config/domain/observability.ts`)

Already dead in production code after this lane (only the config module and its test read them): `OBSERVABILITY_CAPTURE_HTTP_5XX`, `OBSERVABILITY_CAPTURE_AUTH_EVENTS`, `OBSERVABILITY_CAPTURE_ZIP_STATE_EVENTS`, `ALERT_EMAIL_DAILY_DIGEST_ENABLED`, `ALERT_EMAIL_DAILY_DIGEST_CRON_TIME`.

Obsolete once wave 2 deletes the subsystem: `OBSERVABILITY_ENABLED`, `OBSERVABILITY_WRITE_MODE`, `OBSERVABILITY_COLLECTION_MODE`, `OBSERVABILITY_COLLECTION_PREFIX`, `OBSERVABILITY_EVENTS_COLLECTION`, `OBSERVABILITY_INCIDENTS_COLLECTION`, `OBSERVABILITY_NOTIFICATIONS_COLLECTION`, `OBSERVABILITY_REPORT_RUNS_COLLECTION`, `OBSERVABILITY_EVENT_MIN_LEVEL`, `OBSERVABILITY_CAPTURE_OWNER_EVENTS`, `OBSERVABILITY_CAPTURE_INFO_EVENTS`, `OBSERVABILITY_SLOW_REQUEST_MS`, `OBSERVABILITY_DETAILS_MAX_BYTES`, `OBSERVABILITY_BULK_BATCH_SIZE`, `EMAIL_PROVIDER`, `EMAIL_NOTIFICATIONS_ENABLED`, `EMAIL_NOTIFICATIONS_MODE`, `SENDGRID_TO_EMAIL`, `SENDGRID_DEVELOPER_TO_EMAIL`, `ALERT_EMAIL_MIN_LEVEL`, `ALERT_EMAIL_IMMEDIATE_LEVELS`, `ALERT_EMAIL_THROTTLE_MINUTES`, `ALERT_EMAIL_OWNER_EVENTS`, `ALERT_EMAIL_NEAR_WORTHY_DIGEST_EVENTS`. The same applies to the test-only `ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS` and `ALLOW_TEST_EMAIL_NOTIFICATIONS`.

Retained: `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `ALERT_EMAIL_REPLY_TO` (invitations, via `config/domain/mail.ts`) and `CRON_SECRET` (other crons).

## DATA-MANIFEST NEEDS

- **Remove (after wave 2 and S-GRANOT cut their remaining writers and readers):** the whole OperationalEvents family in the selected runtime DB. Production names: `operational_events`, `operational_incidents`, `notification_deliveries`, `operational_report_runs`. Test names: `test_operational_events`, `test_operational_incidents`, `test_notification_deliveries`, `test_operational_report_runs`. Add any `OBSERVABILITY_COLLECTION_PREFIX`-prefixed or `OBSERVABILITY_*_COLLECTION` custom names, resolved from each deployment's env. Never drop by prefix guess. After this lane no reader is left outside Granot/SI. In particular, these `operational_events` documents now have no reader:
  - `event_key ∈ {operations_registry.compatibility_read, operations_registry.source_resolution_ambiguous, operations_registry.source_resolution_not_found}` (Registry Health/Overview).
  - All `/admin/observability/**` list, detail, export and report reads.
  - All `notification_deliveries` reads (digest and retry).
  - All `operational_report_runs` reads and writes (operational reports).
- **Do NOT remove**: all `reporting_*` collections (`ReportingRun` and delivery, definition and destination history are unrelated to `operational_report_runs`), `sheet_sync_runs` / `sheet_sync_jobs`, `cpl_correction_jobs`, `domain_command_executions`, `lead_messages`, `booking_lead_reconciliation_cases`, `public_submission_throttle_buckets`, `operations_registry_changes`, RingCentral call-log state, processed-calls and analytics snapshot collections, `ingestion_runs` / `external_data_connections`, and every Daily Operations collection.
- No object or blob keys are affected by this lane.
