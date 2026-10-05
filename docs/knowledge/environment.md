---
type: Reference
title: Environment variables
description: Every environment variable the main server reads, by owning module, plus the names retired by the 2026-10 server/admin slimming. Read this instead of searching process.env. Values are never stored here.
tags: [environment, configuration]
status: draft
stale_after: 2027-03-31
resource: src/config/
applies_to:
  - src/config/
  - src/config/domain/
  - src/auth/extension/config.ts
  - src/middleware/requireApiSecret.ts
  - src/services/ringcentral/ringcentral-config.ts
  - src/services/ringcentral/rateLimitGate.ts
  - src/services/numberActivity/reconcileCallLog.ts
  - src/services/numberActivity/webhookRecovery.ts
owners: [team:main-server]
sources:
  - id: config
    resource: src/config/domain/
    title: Mode-aware domain configuration modules
  - id: sales-intelligence-flags
    resource: src/config/domain/salesIntelligence.ts
  - id: slimming-env
    resource: docs/server-admin-slimming/evidence/INTEGRATION-SERVER.md
    title: Slimming integration evidence (obsolete names from lanes S-AI, S-OUT, S-OBS)
generated:
  by: process:docs-keeper
  at: 2026-10-04T00:00:00Z
---

# Environment variables

This is the inventory for `vantage-main-server`. Do not grep `process.env` to discover a name. **Values are never stored here**; "default" means the code default when the name is unset.

Rebuilt on 2026-10-04 from the configuration code on branch `slim/server-admin` (`src/config/domain/**` and the few modules that own their own settings, listed in each section). A flag is on only when its trimmed value is the literal the row describes (usually `true`). "Required" means the process throws or refuses that feature when the value is blank at use time. "Secret" means never log or commit it.

The database name outside `TEST_MODE` is the literal `vantagemovers` (`src/config/domain/runtime.ts`). It is not an environment variable. `api/` and `vercel.json` define no variables.

Admin has its own variables. Three names must match across the two processes: `VANTAGE_API_SECRET`, `VANTAGE_ADMIN_PROXY_SIGNING_SECRET`, and the Admin `VANTAGE_API_BASE_URL` (this server's origin).

## Runtime and Mongo

| Name | Default | Required | Secret | Owner and purpose |
| --- | --- | --- | --- | --- |
| `MONGO_URI` | none | yes | yes | `src/db.ts` `connectMongo()`: Atlas connection string. |
| `MONGO_DNS_SERVERS` | system DNS | no | no | `src/db.ts`: comma-separated DNS servers for the driver. |
| `TEST_MODE` | off | no | no | `runtime.ts`: `true` selects the test database and `TEST_`-prefixed sheet ids. |
| `TEST_MONGO_DATABASE_NAME` | `testvantagemovers` | no | no | `runtime.ts`: isolated database when `TEST_MODE` is true. |
| `NODE_ENV` | none | no | no | `production` sets the log level and other production gates. |
| `LOG_LEVEL` | `info` in production, else `debug` | no | no | `src/logger.ts`: pino level. |
| `NODE_TEST_CONTEXT` | unset | no | no | Set by the Node test runner. |
| `VANTAGE_TEST_RUNNER` | unset | no | no | Test-runner marker when `true`. |

## Auth and API secrets

| Name | Default | Required | Secret | Owner and purpose |
| --- | --- | --- | --- | --- |
| `VANTAGE_API_SECRET` | none | yes, unless a scoped key or Bearer auth covers the route | yes | `requireApiSecret.ts`: global `x-api-secret`. Must match Admin. Also the Best Relocation live-apply fallback. |
| `VANTAGE_SCOPED_API_KEYS` | none | no | yes | `requireApiSecret.ts`: JSON array of named route-scoped keys. |
| `SALES_INTELLIGENCE_SCOPED_KEY_NAME` | none | no | no | `requireApiSecret.ts`: the retired Sales Intelligence scoped key is refused on every route (403 `RUN_SCOPE_DENIED`). Remove it, together with that key's entry in `VANTAGE_SCOPED_API_KEYS`, once no caller sends the key. |
| `VANTAGE_ADMIN_PROXY_SIGNING_SECRET` | none | for signed Owner writes | yes | `operationsRegistry/config.ts`: HMAC for Admin proxy actor headers. Must match Admin. |
| `VANTAGE_ADMIN_PROXY_SIGNATURE_MAX_AGE_MS` | `300000` | no | no | Max signature age, capped at the default. |
| `OPERATIONS_REGISTRY_ALLOW_UNSIGNED_PREVIEW` | off | no | no | Allows unsigned actor headers outside production. |
| `EXTENSION_ACCESS_TOKEN_SECRET` | none | for extension auth | yes | `src/auth/extension/config.ts`: signs extension access tokens. |
| `EXTENSION_REFRESH_TOKEN_SECRET` | none | for extension auth | yes | Signs extension refresh tokens. |
| `EXTENSION_ACCESS_TOKEN_TTL_SECONDS` | `900` | no | no | Access-token lifetime. |
| `EXTENSION_REFRESH_TOKEN_TTL_DAYS` | `90` | no | no | Refresh-token lifetime. |
| `REPORTING_CONFIRMATION_SECRET` | falls back to `API_SECRET`, then `VANTAGE_API_SECRET` | no | yes | `reporting.service.ts`: signs run confirmations. |
| `REPORTING_EVIDENCE_SECRET` | falls back to the confirmation secret chain | no | yes | Signs reporting evidence. |
| `API_SECRET` | none | no | yes | Legacy fallback read only after the two reporting secrets. |
| `CRM_API_ID` | none | to submit Form Leads | yes | `crm/crmConfig.ts`: Granot lead-gateway credential. |
| `CRM_MOVER_REF` | none | to submit Form Leads | yes | Granot mover-ref credential. |
| `GRANOT_WEBHOOK_SECRET` | none | webhooks reject if unset | yes | `granotWebhook.ts`: shared secret for inbound Granot webhooks. |
| `GRANOT_NETWORK_USERNAME` / `GRANOT_NETWORK_PASSWORD` | none | to run the HTTP collector | yes | `granotHttpCollector/runWorkflow.ts`. Legacy aliases `MAIN_LOGIN_USERNAME` / `MAIN_LOGIN_PASSWORD`. |
| `GRANOT_USERNAME` / `GRANOT_PASSWORD` | none | to run the HTTP collector | yes | Same module. Legacy aliases `SPECIFIC_USERNAME` / `SPECIFIC_PASSWORD`. |

## RingCentral

`src/services/ringcentral/ringcentral-config.ts` is the single source for RingCentral toggles.

| Name | Default | Secret | Purpose |
| --- | --- | --- | --- |
| `RC_CLIENT_ID`, `RC_CLIENT_SECRET` | none | yes | OAuth client (`ringcentral/auth.ts`). Required for token exchange. |
| `RC_JWT` | none | yes | JWT bearer assertion. |
| `RC_SERVER_URL` | none | no | RingCentral API origin. |
| `RC_TOKEN_STORE` | `file` | no | `mongo` or file token cache. |
| `RINGCENTRAL_ACCOUNT_ID` | empty | no | Configured account: capture fallback, Accounts messages. |
| `RINGCENTRAL_WEBHOOK_URL` | none | no | Public webhook URL for subscription create/renew. |
| `RINGCENTRAL_NGROK_WEBHOOK_URL` | none | no | Local tunnel URL, only when the caller allows it. |
| `RINGCENTRAL_DEV_DEBUG_TOKEN` | none | yes | Debug gate on the local webhook route. |
| `RINGCENTRAL_WEBHOOK_ENABLED` | `true` | no | Run qualification on telephony webhooks. |
| `RINGCENTRAL_CALL_LOG_SYNC_ENABLED` | `false` | no | Qualified-call Call Log sync cron. |
| `RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED` | `false` | no | Analytics reconcile cron (count-only). |
| `RINGCENTRAL_CREATE_CALL_LEADS` | `false` | no | Insert real `call_leads`. |
| `RINGCENTRAL_SHADOW_CALL_LEADS` | `false` | no | Write the shadow collection instead. |
| `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` | `false` | no | Adopt qualified calls onto Granot-created Call Leads. |
| `RINGCENTRAL_WEBHOOK_CALL_LOG_VALIDATE` | `false` | no | Confirm webhook sessions against the Call Log. |
| `RINGCENTRAL_COLLECTION_MODE` | `test` | no | `production` or test-suffixed collections. |
| `RINGCENTRAL_WEBHOOK_FILTER_MODE` | `account` | no | `per-number` or `account`. |
| `RINGCENTRAL_DUPLICATE_WINDOW_HOURS` | `24` | no | Duplicate Lead window. |
| `RINGCENTRAL_CALL_LOG_SYNC_LOOKBACK_MINUTES` / `_OVERLAP_MINUTES` / `_ROLLING_LOOKBACK_MINUTES` | `30` / `15` / `720` | no | Qualified-call sync window. |
| `RINGCENTRAL_ANALYTICS_END_BUFFER_MINUTES` | `2` | no | Trims Analytics `timeTo`. |
| `RINGCENTRAL_ROUTE_VALIDATION_MAX_AGE_MS` | `86400000` | no | Freshness of a validated inbound route. |
| `RINGCENTRAL_REGISTRY_SNAPSHOT_MAX_AGE_MS` / `RINGCENTRAL_REGISTRY_LAST_KNOWN_VALID_MAX_AGE_MS` | `300000` / `1800000` | no | Registry snapshot TTLs. |
| `RINGCENTRAL_REGISTRY_MAPPING_CHECKSUM` | none | no | Expected route-mapping checksum. |
| `RINGCENTRAL_RATE_GATE` | on | no | `off` disables the shared Mongo rate gate (`rateLimitGate.ts`). |
| `RINGCENTRAL_HEAVY_REQUESTS_PER_MINUTE` | `8` (1–10) | no | Heavy-group sends per minute for high-priority callers. |
| `RINGCENTRAL_HEAVY_LOW_PRIORITY_PER_MINUTE` | `4` (0–10) | no | Heavy-group sends per minute for low-priority callers. |
| `RINGCENTRAL_RATE_GATE_MAX_WAIT_MS` | `70000` | no | Longest a high-priority caller waits for a slot. |

## Sales Intelligence (Numbers and RingCentral Accounts)

Flags are read by `csiFlag` in `src/config/domain/salesIntelligence.ts`: `SALES_INTELLIGENCE_<NAME>`, on only when the value is `true`, default off. Service docs: [sales-intelligence-foundation.md](services/sales-intelligence-foundation.md).

| Name | What it gates |
| --- | --- |
| `SALES_INTELLIGENCE_ENABLED` | Owner Numbers/Accounts routes, MCP history reads, rebuild drain, retention. |
| `SALES_INTELLIGENCE_CAPTURE_WEBHOOK` | Webhook fan-out, receipt recovery, capture drain, `call_log_refresh` and `rep_sms_sync` drains, subscription cron. Rep SMS capture (and the `rep_sms` subscription step) is additionally gated by the desk control `controls.rep_sms_capture_enabled`, never by an env flag. |
| `SALES_INTELLIGENCE_CAPTURE_CALL_LOG` | Call Log reconcile, nightly sweep and the staffed-hours minute ISync lane. |
| `SALES_INTELLIGENCE_DIRECTORY_SYNC` | Daily directory snapshot. |
| `SALES_INTELLIGENCE_ATTACHMENT_REFRESH` | Number↔Lead attachment refresh, Lead attachment wake-ups, attachment commands. |
| `SALES_INTELLIGENCE_AUTO_ATTACH` | Sole-match automatic attach. Off keeps Owner commands only. |
| `SALES_INTELLIGENCE_NUDGE_ENABLED` | RingCentral Accounts messages and their repair. |
| `SALES_INTELLIGENCE_WEBHOOK_AUTO_CREATE` | Subscription cron may create the owned all-direction subscription. |
| `SALES_INTELLIGENCE_FORM_LEAD_NUMBERS` | A non-duplicate Form Lead's phone creates a Contact Number. |
| `SALES_INTELLIGENCE_NUMBERS_HAS_CALLS_DEFAULT` | Numbers list hides form-only Numbers unless `include_form_only`. |
| `SALES_INTELLIGENCE_RECEIVER_LATEST_WINS` | Granot lifecycle Lead planner: Granot's latest rep replaces an automatic `receiver_agent` (`granotLifecycle/leadDesiredState.ts`). |
| `SALES_INTELLIGENCE_REP_ACCESS` | A signed rep passes the CSI boundary; every retained route then refuses it. |

Other Sales Intelligence settings:

| Name | Default | Secret | Owner and purpose |
| --- | --- | --- | --- |
| `SALES_INTELLIGENCE_DEPLOYMENT_ID` | none | no | `csiDataset()`: dataset stamp on jobs and state. Required wherever CSI writes. |
| `SALES_INTELLIGENCE_CALL_LOG_SYNC` | `off` | no | `reconcileCallLog.ts`: `on`/`true` drives account Call Log Sync, `shadow` counts only. `on` also runs the staffed-hours minute ISync lane (`callLogIsyncLane.ts`) and narrows `call_log_refresh` to sessions ISync has not confirmed. |
| `SALES_INTELLIGENCE_CALL_LOG_ROLLING_LOOKBACK_MINUTES` | `720` (floor 720) | no | Cold-start reach and outer bound on a repaired gap. |
| `SALES_INTELLIGENCE_CALL_LOG_SAFETY_LOOKBACK_MINUTES` | `90` | no | How far the incremental start may reach back. |
| `SALES_INTELLIGENCE_CALL_LOG_OVERLAP_MINUTES` | `15` | no | Cursor overlap. |
| `SALES_INTELLIGENCE_CALL_LOG_MAX_PAGES` | `20` | no | Provider requests per reconcile run. |
| `SALES_INTELLIGENCE_CALL_LOG_SETTLE_HORIZON_MINUTES` | `240` (floor 60) | no | Trailing re-read reach. |
| `SALES_INTELLIGENCE_CALL_LOG_QUARANTINE_AFTER` | `3` | no | Consecutive failures before quarantine. |
| `SALES_INTELLIGENCE_CALL_LOG_QUARANTINE_RETRIES_PER_RUN` | `5` | no | Quarantine re-reads per run. |
| `SALES_INTELLIGENCE_CALL_LOG_SWEEP_LOOKBACK_HOURS` | `36` | no | Nightly sweep reach. |
| `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_LOOKBACK_MINUTES` | `720` | no | `webhookRecovery.ts`: receipt recovery lookback. |
| `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_OVERLAP_MINUTES` | `5` | no | Recovery overlap. |
| `SALES_INTELLIGENCE_WEBHOOK_RECOVERY_BATCH` / `_MAX_PAGES` / `_DEADLINE_MS` | `200` / `10` / `30000` | no | Recovery page size, pages per run, wall-clock budget. |
| `SALES_INTELLIGENCE_QUEUE_TOPIC` | `sales-intelligence-events` in Vercel production, else `-dev` | no | `webhookFanout.ts`: queue topic override. |
| `SALES_INTELLIGENCE_FANOUT_ACK_TIMEOUT_MS` | `2500` | no | Webhook ack budget. |
| `SALES_INTELLIGENCE_COVERAGE_CACHE_MS` | `5000` | no | `coverage.ts`: in-process coverage memo. |
| `SALES_INTELLIGENCE_RETENTION_ACTIVITY_DAYS` | `730` (`0` disables) | no | `csiRetentionDays()`: Call activity retention when no Owner policy is installed. |
| `SALES_INTELLIGENCE_ADMIN_BASE_URL` | empty | no | Admin origin for Accounts message links and the Admin invite-email link check (`admin-invite-email-internal.routes.ts`). |
| `SALES_INTELLIGENCE_NUDGE_CHANNELS` | unset | no | `csiNudgeConfiguration()`: comma allowlist of `team_messaging`, `sms_to_rep`, `pager`; unknown names throw. Unset: Team Messaging on, others off. |
| `SALES_INTELLIGENCE_NUDGE_TEAM_MESSAGING_ENABLED` / `_SMS_ENABLED` / `_PAGER_ENABLED` | see allowlist | no | Per-channel overrides; an explicit `false` only narrows. The retained command accepts only `team_messaging` and `pager`. |
| `SALES_INTELLIGENCE_NUDGE_PER_REP_PER_HOUR` | `6` (1–100) | no | Hourly cap per directory User. `SALES_INTELLIGENCE_NUDGE_HOURLY_LIMIT` is the alias read only when this is unset. |
| `SALES_INTELLIGENCE_NUDGE_SENDER_EXTENSION_ID` / `_EXTENSION_NUMBER` / `_PERSON_ID` / `_DID` | empty | no | Sender identity for Accounts messages. |

## Google, Sheets, Reporting and ingestion

Sheet container ids are required through `getRequiredEnv` (`runtime.ts`, names in `sheets.ts`); in `TEST_MODE` the same names are read with a `TEST_` prefix. Not secrets: `MASTER_LEADS_SHEET_ID`, `MASTER_BOOKED_SHEET_ID`, `TBM_LEADS_SHEET_ID`, `TBM_PRIME_LEADS_SHEET_ID`, `TOP10_LEADS_SHEET_ID`, `BEST_RELOCATION_LEADS_SHEET_ID`, `GETMOVERS_LEADS_SHEET_ID`, `MAINSITE_LEADS_SHEET_ID`. `TARIFF_SHEET_ID` (`tariff.ts`) is the tariff adjustment workbook.

| Name | Default | Secret | Owner and purpose |
| --- | --- | --- | --- |
| `WRITE_SOURCE_LEAD_SHEETS` | off | no | Also write source-company lead sheets. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | none | yes | `googleAuth.ts`: service-account credential; one is required to call Sheets. |
| `GOOGLE_SERVICE_ACCOUNT_TEST_JSON` / `GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64` | none | yes | Test-mode credential. |
| `SERVICE_ACCOUNT_LOCAL_FILE` / `SERVICE_ACCOUNT_LOCAL_FILE_JSON` | none | yes | Local credential fallback (`googleAuth/serviceAccount.ts`, Best Relocation ingest). |
| `GOOGLE_APPLICATION_CREDENTIALS` | none | yes | File path; the reporting live harness refuses to run when set. |
| `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT` | none | no | Project id fallback. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`, `GOOGLE_OAUTH_OWNER_EMAIL`, `GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN` | none | secret and key are | `googleDriveOAuth.ts`: required for Drive OAuth. The key is 32 random bytes, canonical base64. |
| `GOOGLE_OAUTH_OWNER_EMAILS` | none | no | Extra Owner emails. |
| `GOOGLE_OAUTH_REDIRECT_URI` | production callback | no | OAuth callback. |
| `GOOGLE_OAUTH_COMPLETION_REDIRECT_URL` | none | no | Browser return after consent. |
| `GOOGLE_DRIVE_EXPORT_FOLDER_ID` | none | no | Export folder. |
| `GOOGLE_PICKER_API_KEY` / `GOOGLE_PICKER_APP_ID` | none | key is | `googlePicker.ts`: required together for the picker. |
| `SHEET_SYNC_MODE` | `legacy` | no | `sheetSync.ts`: `queued`, `legacy` or `disabled`. |
| `SHEET_SYNC_QUEUE_TOPIC` / `SHEET_SYNC_CONSUMER_GROUP` | `sheet-sync-events` in Vercel production, else `-dev` / `sheet-sync-drainer` | no | Queue wiring. |
| `SHEET_SYNC_READS_PER_MINUTE_BUDGET` / `_WRITES_` / `_PROJECT_READS_` / `_PROJECT_WRITES_` | `45` / `45` / `250` / `250` | no | Google quota budgets. |
| `SHEET_SYNC_MAX_PAYLOAD_BYTES`, `_MAX_JOBS_PER_DRAIN`, `_MAX_COALESCED_ENTITIES_PER_DRAIN`, `_MAX_ROWS_PER_BATCH`, `_MAX_WRITE_SUBREQUESTS_PER_CALL`, `_MAX_RUN_DURATION_MS`, `_LEASE_DURATION_MS`, `_DEBOUNCE_WINDOW_MS`, `_MAX_ATTEMPTS` | `1500000`, `500`, `500`, `500`, `100`, `60000`, `120000`, `3000`, `8` | no | Drainer bounds. |
| `REPORTING_GOOGLE_DELIVERY_ENABLED` | off | no | `reporting.ts`: external Google writes for Reporting. |
| `REPORTING_ENABLED_DATASETS` | every dataset | no | Dataset allowlist. |
| `BEST_RELOCATION_INGEST_ENABLED` | off | no | `ingestion/worker.ts` heartbeat ingest. |
| `BEST_RELOCATION_SYNC_SHEET_ID`, `BACKFILL_BEST_RELOCATION_SHEET_ID`, `BACKFILL_BOOKED_SHEET_ID`, `BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID` | none | no | Ingest and backfill sheet ids. |

Reporting live-test harness (`reportingLiveTest.ts`; not used by normal traffic): `REPORTING_LIVE_TEST_ENABLED`, `REPORTING_LIVE_TEST_EXPORT_ROOT_FOLDER_ID`, `REPORTING_LIVE_TEST_DENYLIST_WORKBOOK_ID`, `REPORTING_LIVE_TEST_RUN_TAG_PREFIX`, `REPORTING_LIVE_TEST_ARTIFACT_MAX_AGE_MS`, `REPORTING_LIVE_TEST_INJECT_TRANSIENT_FAILURES`, `REPORTING_PRODUCTION_GOOGLE_OAUTH_CLIENT_ID`, `REPORTING_PRODUCTION_GOOGLE_OAUTH_OWNER_EMAIL`, `GITHUB_SHA`, `GITHUB_RUN_ID`.

## Email and SMS

Mail (`src/config/domain/mail.ts`, read at call time by Admin invitations, `adminInvites/inviteEmail.service.ts`). These three names are **kept** after the slimming:

| Name | Default | Secret | Purpose |
| --- | --- | --- | --- |
| `SENDGRID_API_KEY` | none | yes | SendGrid key. Without it the invite email answers `not_configured` and Admin falls back to copy-link. |
| `SENDGRID_FROM_EMAIL` | none | no | From address. |
| `ALERT_EMAIL_REPLY_TO` | none | no | Reply-to address (the name is historical). |

Twilio (`leadMessaging.ts`). The account SID, primary auth token, from number and status callback are required when credentials are loaded.

| Name | Default | Secret | Purpose |
| --- | --- | --- | --- |
| `TWILIO_ACCOUNT_SID` | none | identifier | Account SID. |
| `TWILIO_PRIMARY_AUTH_TOKEN` | none | yes | Auth token. |
| `TWILIO_FROM_NUMBER` | none | no | From number. |
| `TWILIO_STATUS_CALLBACK_URL` | none | no | Status callback. |
| `TWILIO_MESSAGING_SERVICE_SID` | none | no | Optional Messaging Service (quiet-hours scheduling). |
| `TWILIO_VOICE_WEBHOOK_URL` / `TWILIO_VOICE_FORWARD_TO` | code defaults | no | Voice webhook and forward destination (must be E.164 and differ from the from number). |
| `LEAD_MESSAGING_MODE` | `disabled` | no | `disabled`, `inline` or `queued`. |
| `LEAD_MESSAGING_ALLOW_TEST_MODE` | off | no | Real SMS against test data. |
| `LEAD_MESSAGING_QUIET_HOURS_ENABLED` | off | no | Eastern quiet hours. |
| `GRANOT_LEAD_CREATED_SMS_ENABLED` | `false` | no | SMS when Granot creates a Lead. |
| `LEAD_MESSAGING_QUEUE_TOPIC` | `lead-messaging-events` in Vercel production, else `-dev` | no | Queue topic. |
| `LEAD_MESSAGING_DESTINATION_COOLDOWN_MINUTES` / `LEAD_MESSAGING_HOURLY_LIMIT` / `LEAD_MESSAGING_ALLOWED_COUNTRY_PREFIXES` | `15` / `200` / `+1` | no | Send guards. |

## Vercel, cron and Granot lifecycle

| Name | Default | Secret | Purpose |
| --- | --- | --- | --- |
| `CRON_SECRET` | none | yes | Bearer secret for every `/api/cron/*` route. Required. |
| `VERCEL`, `VERCEL_ENV`, `VERCEL_REGION` | injected | no | Runtime detection; queue publish needs `VERCEL=1` with a region, production topics need `VERCEL_ENV=production`. |
| `VERCEL_DEPLOYMENT_ID`, `VERCEL_GIT_COMMIT_SHA` | injected | no | `deploymentStamp.ts`: deployed commit record (Vercel production only). |
| `DEPLOYMENT_COMMIT_SHA` | none | no | Same stamp for CLI deploys (`vercel deploy --prod -e DEPLOYMENT_COMMIT_SHA=...`). |
| `GRANOT_LIFECYCLE_QUEUE_TOPIC` | `granot-lifecycle-events` in Vercel production, else `-dev` | no | Lifecycle queue topic. |
| `GRANOT_AUTOMATION_APPLY_ENABLED` | off | no | HTTP collector apply step. |

Granot lifecycle flags (`granotLifecycle.ts`), each `true` or `false` if set: `GRANOT_LIFECYCLE_PROCESSING_ENABLED` (default `true`), `GRANOT_LIFECYCLE_SHADOW_MODE` (`true`), and the eight effect flags `GRANOT_LIFECYCLE_{LEAD_WRITES,LEAD_CREATION,BOOKING_CASES,BOOKING_COMMANDS,RELEASE_CASES,RELEASE_COMMANDS,REFERRAL_BOOKING,EMAIL}_ENABLED` (default `false`). Granot Health state (`granot_lifecycle_health_state`) has no environment settings; its windows and thresholds are code constants.

## Daily Operations, bookings and Granot CSV

Redis doorbell (`dailyOperations.ts`): `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` / `KV_REST_API_TOKEN`. The tokens are secrets. `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL` and `REDIS_URL` are not read. Since the slimming no other server module reads Redis.

Booking reconciliation (`bookingReconciliation.ts`, `employeeBookingMatching.ts`): `BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED` (on unless `false`), `BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS`, `BOOKING_RECONCILIATION_AUTO_REMATCH_DELAYS_MINUTES`, `BOOKING_RECONCILIATION_AUTO_REMATCH_BATCH_SIZE`, `EMPLOYEE_BOOKING_PUBLIC_THROTTLE_WINDOW_SECONDS`, `EMPLOYEE_BOOKING_PUBLIC_THROTTLE_PER_CLIENT_LIMIT`, `EMPLOYEE_BOOKING_PUBLIC_THROTTLE_GLOBAL_LIMIT`, `EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION`, `EMPLOYEE_BOOKING_AUTO_MATCH_RULES`. Optional, not secrets.

Granot CSV (`granotCsv.ts`): `GRANOT_CRM_CSV_BUCKET`, `GRANOT_CRM_CSV_PREFIX`, `AWS_REGION` (alias `AWS_DEFAULT_REGION`), `GRANOT_CRM_AWS_PROFILE` (alias `AWS_PROFILE`).

## Operator tooling only

Read under `ops/` or the gitignored `scripts/`, never by the API process. Do not add them to the server's Vercel environment.

- `ops/slimming/**` (one-time purge): `MONGO_URI`, `MONGO_DNS_SERVERS` and `BLOB_READ_WRITE_TOKEN` from the server `.env`, `MONGODB_URI` and `ADMIN_AUTH_DB_NAME` from the Admin `.env`.
- `ops/quality/**` (developer quality checkpoints, local only):
  - `AGENT_QUALITY_CHILD`: set in model children.
  - `AGENT_QUALITY_HOME`, `AGENT_QUALITY_WORK`: state locations; tests override them.
  - `AGENT_QUALITY_CLAUDE_BIN`, `AGENT_QUALITY_CURSOR_BIN`, `AGENT_QUALITY_CODEX_BIN`: executable overrides.
  - `CURSOR_API_KEY`: read from `.env` when not exported, and passed to Cursor only.
  - OS variables such as `LOCALAPPDATA`.

  `ANTHROPIC_API_KEY` is deliberately never passed to children. This is developer tooling, not a server AI pipeline.
- `ops/cloud/mongodb-backup/`: `CLOUD_RUN_EXECUTION` and its own job configuration ([mongodb-backup.md](services/mongodb-backup.md)).
- `ops/dev-server.ts`: `PORT`.

## Retired by slimming

The 2026-10 server/admin slimming removed every reader of the names below. Status 2026-10-04: the slim server is live (`6123f85e`) and the purge has run, but the [slimming ledger](../server-admin-slimming/LEDGER.md) does not yet record these deletions; [CUTOVER.md](../server-admin-slimming/CUTOVER.md) §10 deletes them after the +1 day recreation check (`BLOB_READ_WRITE_TOKEN` last). After the slim server deployment is **Ready** and its observation window has passed, the operator deletes them from the `vantage-movers-main-server` Vercel project (Production, Preview and Development). Never print values while doing it. Do **not** delete `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` or `ALERT_EMAIL_REPLY_TO` (Admin invitations still use them) or `KV_REST_API_*` / `UPSTASH_*` (Daily Operations). Sources: [INTEGRATION-SERVER.md](../server-admin-slimming/evidence/INTEGRATION-SERVER.md), [S-AI.md](../server-admin-slimming/evidence/S-AI.md), [S-OUT.md](../server-admin-slimming/evidence/S-OUT.md), [S-OBS.md](../server-admin-slimming/evidence/S-OBS.md).

**OperationalEvents and alert email** (`config/domain/observability.ts`, deleted): `OBSERVABILITY_ENABLED`, `OBSERVABILITY_WRITE_MODE`, `OBSERVABILITY_COLLECTION_MODE`, `OBSERVABILITY_COLLECTION_PREFIX`, `OBSERVABILITY_EVENTS_COLLECTION`, `OBSERVABILITY_INCIDENTS_COLLECTION`, `OBSERVABILITY_NOTIFICATIONS_COLLECTION`, `OBSERVABILITY_REPORT_RUNS_COLLECTION`, `OBSERVABILITY_EVENT_MIN_LEVEL`, `OBSERVABILITY_CAPTURE_OWNER_EVENTS`, `OBSERVABILITY_CAPTURE_INFO_EVENTS`, `OBSERVABILITY_CAPTURE_HTTP_5XX`, `OBSERVABILITY_CAPTURE_AUTH_EVENTS`, `OBSERVABILITY_CAPTURE_ZIP_STATE_EVENTS`, `OBSERVABILITY_SLOW_REQUEST_MS`, `OBSERVABILITY_DETAILS_MAX_BYTES`, `OBSERVABILITY_BULK_BATCH_SIZE`, `EMAIL_PROVIDER`, `EMAIL_NOTIFICATIONS_ENABLED`, `EMAIL_NOTIFICATIONS_MODE`, `SENDGRID_TO_EMAIL`, `SENDGRID_DEVELOPER_TO_EMAIL`, `ALERT_EMAIL_MIN_LEVEL`, `ALERT_EMAIL_IMMEDIATE_LEVELS`, `ALERT_EMAIL_THROTTLE_MINUTES`, `ALERT_EMAIL_DAILY_DIGEST_ENABLED`, `ALERT_EMAIL_DAILY_DIGEST_CRON_TIME`, `ALERT_EMAIL_OWNER_EVENTS`, `ALERT_EMAIL_NEAR_WORTHY_DIGEST_EVENTS`. Test-only: `ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS`, `ALLOW_TEST_EMAIL_NOTIFICATIONS`, `ALLOW_TEST_OBSERVABILITY`.

**Server AI, media and transcription:** `AI_GATEWAY_API_KEY`, `BLOB_STORE_ID`, `BLOB_STORE_NAME`, `SALES_INTELLIGENCE_MCP_ENDPOINT`, `SALES_INTELLIGENCE_MCP_API_SECRET`, `SALES_INTELLIGENCE_RUN_TOKEN_SECRET`, `SALES_INTELLIGENCE_EXTRACTION_MODEL`, `SALES_INTELLIGENCE_STT_MODEL`, `SALES_INTELLIGENCE_STT_CENTS_PER_SECOND`, `SALES_INTELLIGENCE_MEDIA_MAX_BYTES`, `SALES_INTELLIGENCE_ANALYSIS_V3`, `SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION`, `SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION`, `SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION`, `SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON`, `SALES_INTELLIGENCE_PERSONAL_LEDGER`, `SALES_INTELLIGENCE_LEGACY_CONVERSATION_FALLBACK_DISABLED`, `SALES_INTELLIGENCE_AI_MONTHLY_CEILING_CENTS`, `SALES_INTELLIGENCE_AI_PER_RECORDING_CEILING_CENTS`, `SALES_INTELLIGENCE_RETENTION_AUDIO_DAYS`, `SALES_INTELLIGENCE_RETENTION_TRANSCRIPT_DAYS`.

**`BLOB_READ_WRITE_TOKEN`:** no server reader remains, but the one-time purge (`ops/slimming`) reads it from the local `.env` to back up and delete the `conversations/` Blob objects. Delete it from Vercel after the purge has run and its backup is verified.

**Retired Sales Intelligence flags:** `SALES_INTELLIGENCE_{MEDIA_ENABLED,STT_ENABLED,EXTRACTION_ENABLED,EXACT_EVIDENCE_VERIFICATION,PROVIDER_READS,MOVE_ASSESSMENT,CITATION_HANDLES,CASE_FILE,OUTREACH_ENSURE,ATTENTION_MANIFEST,ATTENTION_V2,ATTENTION_EVOLUTION,LEAD_PROGRESS,PROGRESS_PLAN,PRIORITY5_CLOSURE,RECEIVER_ASSIGNMENT,OVERVIEW,TIMELINE_V2,LIVE_SSE}`.

**Retired Sales Intelligence settings:** `SALES_INTELLIGENCE_BACKFILL_DAYS`, `SALES_INTELLIGENCE_FIRST_ACTION_DUE_STAFFED_MINUTES`, `SALES_INTELLIGENCE_MISSED_CALLBACK_DUE_STAFFED_MINUTES`, `SALES_INTELLIGENCE_GOING_COLD_STAFFED_MINUTES`.

**Later, not with this deploy:** `SALES_INTELLIGENCE_SCOPED_KEY_NAME` and the Sales Intelligence entry inside `VANTAGE_SCOPED_API_KEYS` stay until no caller sends that key; the server refuses it meanwhile. Edit `VANTAGE_SCOPED_API_KEYS` by removing only that entry, never by replacing the whole value.

**Not server names:** `SALES_INTELLIGENCE_SCOPED_API_KEY`, `SALES_INTELLIGENCE_API_BASE_URL`, `SALES_INTELLIGENCE_DATABASE` (and the MCP's own `SALES_INTELLIGENCE_RUN_TOKEN_SECRET`, `SALES_INTELLIGENCE_DEPLOYMENT_ID` copies) belonged to the retired `/api/intelligence-mcp` endpoint of the `vantage-movers-mcp` project. They are removed from that project per its [deploy skill](../../../.agents/skills/deploy-vantage-movers-mcp/SKILL.md). The server's own `SALES_INTELLIGENCE_DEPLOYMENT_ID` stays.

**Historical database tooling:** `HISTORICAL_IMPORT_BATCH_ID`, `HISTORICAL_IMPORT_RECONCILE`, `HISTORICAL_AGENT_REPAIR_DRY_RUN` were read only by the deleted local historical scripts.
