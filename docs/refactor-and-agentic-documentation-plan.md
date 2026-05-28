# Vantage Main Server Refactor And Agentic Documentation Plan

## Purpose

This document is a discovery and planning artifact for a future refactor. It does not propose immediate code changes. Its goal is to help agents and engineers understand the `vantage-main-server` codebase quickly, protect production data, and choose a refactor path for stronger error handling, logging, configuration, and service boundaries.

The current server is a Vercel-hosted Express API with MongoDB, Google Sheets, Granot CRM posting, Google Form workflows, reconciliation/backfill scripts, and Postman collection generation. It is both a testing and production codebase. `TEST_MODE=true` changes the runtime database name, sheet environment variables, and Google service account environment variables, so every future refactor must treat environment selection as a first-class safety boundary.

## Current System Map

### Runtime Entry Points

- `api/index.ts` owns the Express app, request logging middleware, CORS, JSON/urlencoded parsing, health probes, `/db`, and route mounting.
- `api/routes/v1.routes.ts` owns protected `/api/v1` route definitions, Zod parsing, generic CRUD handlers, specialized form lead logging, enrichment endpoints, and reconciliation endpoints.
- `api/db.ts` owns the shared Mongoose connection cache and chooses the Mongo database through `MONGO_DATABASE_NAME` from `api/config/domain.ts`.
- `api/logger.ts` and `api/middleware/httpLogger.ts` provide `pino` and request IDs.
- `api/middleware/requireApiSecret.ts` protects `/api/v1` with `VANTAGE_API_SECRET`.

### Domain And Configuration

- `api/config/domain.ts` is the current central registry for `TEST_MODE`, Mongo database names, source companies, source labels, CPL rules, sheet tab names, sheet headers, sheet container environment variables, and Google service account environment variable selection.
- `api/models/schemaHelpers.ts` provides shared Mongoose enum fields and the `sheet_sync[]` subdocument.
- `api/validation/v1.validation.ts` is the API boundary for payload shape, identity requirements, and batch limits.

### Core Services

- `api/services/v1.service.ts` is the main orchestration service for form leads, call leads, bookings, cancellations, customers, cascading updates, CRM submission decisions, and Google Sheets sync scheduling.
- `api/services/googleSheets.service.ts` owns Google Sheets auth, tab/header creation, row projection, row lookup, row upsert/delete, sync metadata, and Google API diagnostics.
- `api/services/crm.service.ts` owns Granot CRM payload building and HTTP submission for form leads.
- `api/services/callLeadEnrichment.service.ts` previews and syncs call lead updates from CRM/browser-extension data.
- `api/services/bookedCallLeadReconciliation.service.ts` previews and syncs Booked Jobs rows against call leads and bookings.
- `api/services/formLeadSearch.service.ts` and `api/services/callLeadSearch.service.ts` implement search behavior used by operational tools and future analytics/search work.

### Scripts And Historical Data

- `scripts/` currently mixes destructive DB utilities, diagnostics, Postman collection sync, Google Sheets inspection, historical ingestion, reconciliation, analytics, repair jobs, and one-off creation scripts.
- `scripts/historical/models/` registers relaxed replicas of the main models against `vantagemovershistorical`, a separate Mongo database on the same cluster.
- Historical ingestion and analytics scripts use the main app Mongo connection helper, then switch to the historical database with `mongoose.connection.useDb(...)`.
- Existing historical documentation already lives in `docs/historical-db-schema-reference.md`, `docs/mongo-sheets-crm-schema-map.md`, and related relationship docs.

### External Business Workflows

- Form lead intake: website/form payload -> Vantage API -> Mongo `form_leads` -> optional Granot CRM POST -> Google Sheets sync.
- Call lead intake: call source/browser/operational tool -> Vantage API -> Mongo `call_leads` -> Google Sheets sync -> later enrichment from CRM data.
- Booking: Booking Google Form or API client -> Vantage API -> Mongo `booked_leads` + customer upsert + source lead status mirror -> `Booked Deals` sheet sync.
- Cancellation: Cancellation Google Form or API client -> Vantage API -> Mongo `cancelled_leads` + booking/source lead mirror -> `Cancelled Deals` sheet sync.
- Reconciliation: CRM/Booked Jobs rows -> preview endpoint -> sync endpoint -> call lead and booking/customer updates -> sheet sync scheduling.
- Historical backfill: source workbooks -> relaxed historical DB -> reconciliation/analytics reports -> future analytics/search sources.

## Production And Test Safety Boundary

Future work must preserve these invariants:

- `TEST_MODE=true` must select `testvantagemovers`, `TEST_*_SHEET_ID` values, and test Google service account environment variables.
- `TEST_MODE` must be logged at startup or first DB/sheets use without leaking secrets.
- Production database `vantagemovers` and production sheets contain real values. Valid smoke tests can write real customer/business data unless the caller explicitly runs in test mode.
- Destructive scripts must refuse to run against production unless the command name, environment, and an explicit confirmation all agree.
- Historical DB `vantagemovershistorical` is separate from production operational data but shares the cluster, so scripts should still log the selected database and workbook IDs.
- Postman should split local/test and production collections or environments so test requests cannot silently target production secrets or sheets.

## Refactor Pathway 1: Stabilize The Current Modular Monolith

This pathway keeps the existing Express/Vercel architecture and folder layout, then hardens boundaries in place. It is the lower-risk path and should come first if production reliability is the priority.

### Goal

Make the current service easier to operate safely by centralizing runtime configuration, error classification, logging context, and side-effect orchestration while preserving API behavior.

### Recommended Workstreams

- Create a typed runtime config layer around `api/config/domain.ts` that validates required environment variables by mode, reports selected database/sheet/auth mode, and distinguishes missing config from request/service errors.
- Introduce a shared API error model beyond `V1ServiceError`, with stable error codes, HTTP status codes, public messages, internal messages, and structured log metadata.
- Replace route-level repeated `try/catch` patterns with a request handler wrapper that logs request ID, route, operation, error code, and safe context consistently.
- Split `api/services/v1.service.ts` into narrower domain services: form leads, call leads, bookings, cancellations, customers, and sheet-sync orchestration.
- Keep Google Sheets as an adapter service, but isolate auth/config resolution, tab/header management, row projection, and sync persistence into smaller modules.
- Add operation names to all side effects: CRM POST, Mongo write, sheet sync schedule, sheet sync execution, Google API request, reconciliation row sync, and script batch run.
- Normalize script logging around the same event vocabulary as the API, even if scripts continue writing human-readable console output.

### Benefits

- Lowest migration risk.
- Easier to test incrementally with existing `pnpm test` and `pnpm typecheck`.
- Preserves current API, Postman collection, Google Form integrations, and sheet schema.
- Gives agents clear local modules to inspect before deeper architectural changes.

### Main Risks

- The system remains one deployable service with many responsibilities.
- If service extraction is done too timidly, `v1.service.ts` may become a set of thin wrappers over hidden shared state.
- Side effects can still be hard to reason about unless sheet sync scheduling and execution are made explicit.

### Best Fit

Use this path when the immediate priority is safer production operations, clearer errors, faster debugging, and preserving the live business workflows.

## Refactor Pathway 2: Domain Boundary And Workflow Refactor

This pathway reorganizes the server around business domains and durable workflows. It is a deeper refactor and should follow after the safety layer is in place.

### Goal

Move from one broad v1 orchestration service to explicit domains with stable contracts: lead intake, lead enrichment, booking lifecycle, cancellation lifecycle, sheet synchronization, CRM integration, historical ingestion, reconciliation, search, and analytics.

### Recommended Workstreams

- Define domain packages or folders under `api/` such as `api/domains/leads`, `api/domains/bookings`, `api/domains/sheets`, `api/domains/crm`, and `api/domains/reconciliation`.
- Keep `api/routes/` thin: routes should authenticate, parse, call a use case, and return a standardized envelope.
- Model side effects as explicit workflow steps with idempotency keys and result records, especially for CRM submission and multi-target sheet sync.
- Consider a persistent job/outbox collection for sheet sync and CRM side effects if failures need retry, visibility, or replay beyond the current `waitUntil` flow.
- Move historical ingestion/backfill code into `scripts/historical/` or `scripts/backfill/` with shared adapters for sheets and historical models.
- Make analytics/search a read-model layer over operational and historical data instead of mixing aggregation experiments with ingestion scripts.
- Split Postman into environment-safe collections: local/test mutation flows, production read/probe flows, and explicitly approved production mutation flows.

### Benefits

- Clearer ownership for future search and analytics.
- Better replay and audit options for CRM, sheets, reconciliation, and backfill.
- Easier to create folder-specific agent instructions because domains map directly to business processes.
- Reduces the chance that booking, cancellation, or reconciliation edits accidentally break lead intake.

### Main Risks

- Higher migration cost.
- Requires careful compatibility with Google Forms, Postman scripts, existing sheets, and live production data.
- Needs stronger tests before moving code, especially around side effects and sheet row identity.

### Best Fit

Use this path when the safety layer exists, tests are stable, and the next priority is long-term maintainability, analytics/search growth, or workflow observability.

## Error Handling And Logging Recommendations

### Current Strengths

- Request IDs are already generated by `pino-http`.
- `api/logger.ts` redacts common auth headers.
- Form lead creation logs request metadata, payload keys, sanitized payload preview, validation success/failure, service errors, creation success, CRM status, and sheet sync state.
- Google Sheets auth configuration is summarized once, and Google API errors have diagnostics helpers.
- Reconciliation and enrichment return per-row statuses, which is a good pattern for batch operations.

### Gaps To Address

- Generic route handlers call `sendError` without structured logs, so many failures will only show up as HTTP logs and raw response messages.
- `sendError` returns raw 500 error messages to clients. Public responses should be stable and safe; detailed messages belong in logs.
- `V1ServiceError` only carries a message and status code. It should carry an error code, public message, internal message, cause, and safe metadata.
- Scripts mostly use `console.log` and `console.error`, with inconsistent mode/database/sheet logging.
- CRM submission logs the full payload and endpoint. Review whether phone/email/name and API query credentials need stronger redaction.
- `requireApiSecret` returns config failure responses without structured logging.

### Target Pattern

Every operation should have:

- `operation`: stable name such as `form_lead.create`, `sheet_sync.form_lead`, `crm.form_lead.submit`, `historical.ingest`.
- `requestId` or `runId`: request ID for API calls, generated run ID for scripts.
- `mode`: `test` or `production`.
- `database`: selected Mongo database, when relevant.
- `resource`: domain object type.
- `resourceId`: Mongo ID when available.
- `externalTarget`: sheet target, CRM, Postman, or workbook, when relevant.
- `errorCode`: stable app-owned code on failures.
- `cause`: original error attached for logs, not leaked to API clients.

## Cursor Agentic Documentation Plan

The repo already has `.cursor/rules/` files for project organization, branch/test workflow, sheet sync, schema/company maps, and form lead CRM. The next documentation pass should keep rules short and move longer system context into docs. Use `AGENTS.md` files for folder-local orientation and `.cursor/rules/*.mdc` for persistent behavioral guardrails.

### Proposed Files

| Path | Purpose | Scope |
| --- | --- | --- |
| `AGENTS.md` | Repo-wide quick orientation, production/test warning, command map, where to look first. | Whole repo |
| `api/AGENTS.md` | Runtime API architecture, request lifecycle, env mode behavior, testing expectations. | `api/**` |
| `api/config/AGENTS.md` | Domain constants, env var mode selection, source company and sheet maps. | `api/config/**` |
| `api/routes/AGENTS.md` | Route-handler expectations: auth, validation, error envelope, logging, no business logic. | `api/routes/**` |
| `api/services/AGENTS.md` | Service boundaries, side-effect rules, sheet/CRM/reconciliation ownership. | `api/services/**` |
| `api/models/AGENTS.md` | Mongoose schema conventions, relationships, `sheet_sync[]`, enum source of truth. | `api/models/**` |
| `api/validation/AGENTS.md` | Zod boundary rules, create/update/search schema behavior, client-owned vs server-owned fields. | `api/validation/**` |
| `scripts/AGENTS.md` | Script categories, production safeguards, historical DB guidance, run logging, dry-run requirements. | `scripts/**` |
| `scripts/historical/models/AGENTS.md` | Historical DB replica model rules and differences from main models. | `scripts/historical/models/**` |
| `docs/AGENTS.md` | Where architecture, business process, rollout, and schema docs belong. | `docs/**` |

### Proposed Cursor Rules

Keep each rule under roughly 50 lines and focused.

- `runtime-mode-safety.mdc`: Always identify `TEST_MODE`, selected DB, selected sheet env vars, and selected Google auth source before changing code that writes externally.
- `api-error-handling.mdc`: API routes must return stable error envelopes and log structured details with request IDs.
- `service-side-effects.mdc`: Mongo is source of truth; CRM and Sheets are side effects with operation names, idempotency notes, and safe retry behavior.
- `scripts-production-safety.mdc`: Destructive or write scripts must default to dry-run or explicit test mode and must log selected database/workbooks.
- `postman-environment-safety.mdc`: Keep test/local and production environments separated; production mutation requests require explicit naming and approval.
- `historical-data-boundary.mdc`: Historical DB models are relaxed replicas for backfill/analytics and must not be treated as runtime API models.

## Folder-Specific Agent Notes

### `vantage-main-server/`

Agents should start here to understand commands, package scripts, existing rules, and docs. Before running any mutating command, inspect `package.json`, `.cursor/rules/`, and relevant docs. Do not assume a script is safe because it is local; many scripts can touch MongoDB, Google Sheets, Postman, or production APIs.

### `api/`

This is runtime server code. Agents should trace requests in this order: `api/index.ts` -> `api/routes/v1.routes.ts` -> `api/validation/v1.validation.ts` -> `api/services/*` -> `api/models/*` -> external adapters. Preserve `snake_case` payloads and Mongo fields. Treat `TEST_MODE` as part of runtime behavior, not just testing.

### `api/routes/`

Routes should stay thin. They should authenticate, parse with Zod, call a service/use case, and format success or error responses. Business rules belong in services. Future route work should standardize error handling instead of adding new bespoke `try/catch` blocks.

### `api/services/`

Services currently hold most business behavior and side effects. Agents should identify whether a change affects Mongo state, CRM submission, Google Sheets sync, reconciliation, enrichment, or search. Any side-effecting service should log operation names and safe identifiers, update Mongo before external sync when appropriate, and preserve sheet row identity via `Mongo ID`.

### `api/config/`

This folder should remain the source of truth for mode-aware configuration and domain constants. Agents should add new source companies, sheet tabs, headers, auth env vars, and CPL rules here rather than scattering `process.env` reads across services.

### `scripts/`

Scripts should be refactored by category: `scripts/db`, `scripts/sheets`, `scripts/historical`, `scripts/postman`, `scripts/diagnostics`, and `scripts/one-off` or `scripts/migrations`. Historical ingestion and analytics should share connection/mode logging utilities. Destructive scripts should require explicit confirmation and should not infer production safety from file names alone.

## Postman Split Recommendation

The current sync script creates local and production environments and duplicates production request siblings. Going forward, split Postman assets by intent:

- Local/test mutation collection: safe create/update/delete flows against localhost or test deployment.
- Production probe collection: health, `/db`, read-only/search endpoints, and explicitly non-mutating checks.
- Production mutation collection: disabled or separately managed by default, with request names and descriptions that make production writes obvious.

The Postman generator should make `TEST_MODE`, base URL, API secret, and expected data target visible in environment names and request descriptions.

## Documentation Sequence

1. Add folder-local `AGENTS.md` files using the proposed scope above.
2. Add concise `.cursor/rules/*.mdc` guardrails for runtime mode safety, API errors, services, scripts, and Postman.
3. Add a short `docs/runtime-mode-and-data-safety.md` that enumerates every production/test env var and write target.
4. Add a `docs/service-map.md` that expands the service map in this document into request and side-effect diagrams.
5. Add a `docs/scripts-refactor-plan.md` that categorizes each script and marks read-only, write, destructive, historical, and production-sensitive behavior.
6. Add a `docs/error-handling-and-logging-standard.md` before implementation so future code changes have a consistent target.

## Suggested First Refactor Decision

Start with Pathway 1. It creates the safety and observability foundation needed before deeper movement of business domains. Once runtime mode safety, structured errors, and service logging are consistent, move selected areas toward Pathway 2, beginning with Google Sheets sync and scripts because they carry the highest production-data risk and the most operational complexity.
