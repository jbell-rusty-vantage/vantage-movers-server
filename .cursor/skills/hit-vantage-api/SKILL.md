---
name: hit-vantage-api
description: Call the Vantage main-server HTTP API from operator scripts using VANTAGE_API_SECRET and x-api-secret. Use when hitting production or local /api/v1 routes, writing a scripts/api script, curling vantage-movers-main-server.vercel.app, probing form-leads, admin, Granot lifecycle, or observability, or when the user asks to hit our own API.
---

# Hit the Vantage API

Work from `vantage-main-server`. Do not read `.env`. Never print, log, or commit `VANTAGE_API_SECRET` or signing secrets.

## When to use

The user wants to call **this server's HTTP API** (production or local), not Mongo / Sheets / CRM clients.

## Defaults

| Item | Value |
|------|--------|
| Production host | `vantage-movers-main-server.vercel.app` |
| Production base | `https://vantage-movers-main-server.vercel.app` |
| Local base | `http://localhost:3000` (`pnpm dev`) |
| Auth header | `x-api-secret: process.env.VANTAGE_API_SECRET` |
| Env file | `vantage-main-server/.env` via `node --env-file=.env` / `pnpm` |
| Route source | `src/routes/v1.routes.ts` plus mounted routers |
| Same route list | `.cursor/rules/production-url.mdc` |

Override host with `VANTAGE_API_BASE_URL` (Preview URL, localhost). Unguarded probes: `GET /`, `GET /health`, `GET /db`.

## Auth

`router.use("/api/v1", requireApiSecret)` in `v1.routes.ts`. Send `x-api-secret`. Missing secret → `401`. Unset server secret → `500`.

Exceptions (no API secret): `/`, `/health`, `/db`, `/api/v1/extension/auth/*`, `GET /api/v1/admin/google-drive/oauth/callback`. Cron/webhook routes use other secrets — not this skill.

### Owner-gated admin

Registry, Granot lifecycle mutations, booking-lead recon, ingestion/reporting/automation owner writes need signed proxy headers **in addition to** `x-api-secret`:

`x-vantage-admin-user-id`, `x-vantage-admin-email`, `x-vantage-admin-role`, `x-vantage-admin-request-id`, `x-vantage-admin-timestamp`, `x-vantage-admin-signature`

HMAC is `VANTAGE_ADMIN_PROXY_SIGNING_SECRET` over the canonical payload in `src/services/operationsRegistry/trustedActorCanonical.ts`. `vantageApi({ signAdmin: true })` builds them when `VANTAGE_ADMIN_USER_ID`, `VANTAGE_ADMIN_EMAIL`, and `VANTAGE_ADMIN_PROXY_SIGNING_SECRET` are set. Role defaults to `owner`.

`POST /api/v1/employee-booking-submissions` is secret-only and also needs `x-public-client-key-hash` (64-char hex).

## Workflow

Copy this checklist:

```
API hit
- [ ] 1. Confirm target (production vs VANTAGE_API_BASE_URL / localhost)
- [ ] 2. Pick METHOD + path from the catalog below
- [ ] 3. Prefer scripts/api/vantageApi.ts; write a custom script if the task has branching
- [ ] 4. GET/read first; production POST/PATCH/DELETE needs explicit user OK + --i-mean-it
- [ ] 5. Run via pnpm / --env-file=.env
- [ ] 6. Report status + JSON. Never echo secrets.
```

### Reusable client

```ts
import { vantageApi } from "./vantageApi";

const result = await vantageApi({
  method: "GET",
  path: "/api/v1/form-leads",
  query: { limit: 5 },
});
```

```bash
pnpm api:hit
pnpm api:hit -- GET /api/v1/form-leads
pnpm api:hit -- POST /api/v1/form-leads/search --body '{"phone_number":"5551234567"}'
pnpm api:hit -- GET /api/v1/admin/granot-lifecycle/cases --sign-admin
pnpm api:hit -- POST /api/v1/form-leads --body '{...}' --i-mean-it
```

### Custom script

1. Add `scripts/api/<task>.ts` (not `scripts/migrations/`).
2. Import `vantageApi` from `./vantageApi`.
3. Put looping, filters, and output files in the custom script.
4. Run: `node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/api/<task>.ts`

Zod schemas live in `src/validation/v1.validation.ts` and `src/validation/v1/`. Typical JSON envelope: `{ ok: true, data }` or `{ ok: false, error }`. Deletes often return `204`.

When a route is added or renamed, update this catalog **and** `.cursor/rules/production-url.mdc`.

## Route catalog

Source: `src/routes/v1.routes.ts`, `extension-auth.routes.ts`, `google-drive-oauth.routes.ts`, `extension-granot-apply.routes.ts`, `ringcentral-registry.routes.ts`, `granot-lifecycle-admin.routes.ts`, `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `src/app.ts`.

### Unguarded

```
GET    /
GET    /health
GET    /db
POST   /api/v1/extension/auth/login
POST   /api/v1/extension/auth/refresh
GET    /api/v1/extension/auth/me
POST   /api/v1/extension/auth/logout
GET    /api/v1/admin/google-drive/oauth/callback
```

### Public v1 (behind x-api-secret)

```
GET    /api/v1/form-leads
GET    /api/v1/form-leads/:id
POST   /api/v1/form-leads
POST   /api/v1/form-leads/search
POST   /api/v1/form-leads/granot-match
PATCH  /api/v1/form-leads/:id
PATCH  /api/v1/form-leads/:id/granot-sync
DELETE /api/v1/form-leads/:id
POST   /api/v1/create-form-test
POST   /api/v1/tariff-adjustments
GET    /api/v1/call-leads
POST   /api/v1/call-leads
POST   /api/v1/call-leads/search
POST   /api/v1/call-leads/enrichment/preview
POST   /api/v1/call-leads/enrichment/sync
POST   /api/v1/call-leads/booked-reconciliation/preview
POST   /api/v1/call-leads/booked-reconciliation/sync
PATCH  /api/v1/call-leads/:id
DELETE /api/v1/call-leads/:id
GET    /api/v1/booked-leads
POST   /api/v1/booked-leads
POST   /api/v1/booked-leads/from-source
PATCH  /api/v1/booked-leads/:id
DELETE /api/v1/booked-leads/:id
POST   /api/v1/referral-bookings
POST   /api/v1/leadless-bookings
GET    /api/v1/employee-booking-options
POST   /api/v1/employee-booking-submissions
GET    /api/v1/cancelled-leads
POST   /api/v1/cancelled-leads
PATCH  /api/v1/cancelled-leads/:id
DELETE /api/v1/cancelled-leads/:id
GET    /api/v1/customers
POST   /api/v1/customers
PATCH  /api/v1/customers/:id
DELETE /api/v1/customers/:id
GET    /api/v1/testimonials
GET    /api/v1/moving-carriers
GET    /api/v1/granot-crm/csv/sources
POST   /api/v1/granot-crm/csv/uploads
```

### Admin discovery, catalog, sources, CPL

```
GET    /api/v1/admin/search
GET    /api/v1/admin/facets
GET    /api/v1/admin/catalog/agents
GET    /api/v1/admin/catalog/merchants
GET    /api/v1/admin/agents
GET    /api/v1/admin/agents/:id
POST   /api/v1/admin/agents
PATCH  /api/v1/admin/agents/:id
POST   /api/v1/admin/agents/:id/activation
GET    /api/v1/admin/agents/:id/dependencies
GET    /api/v1/admin/merchants
GET    /api/v1/admin/merchants/:id
POST   /api/v1/admin/merchants
PATCH  /api/v1/admin/merchants/:id
POST   /api/v1/admin/merchants/:id/activation
GET    /api/v1/admin/merchants/:id/dependencies
GET    /api/v1/admin/cpl-rates
GET    /api/v1/admin/source-companies
GET    /api/v1/admin/source-companies/:id
POST   /api/v1/admin/source-companies
PATCH  /api/v1/admin/source-companies/:id
POST   /api/v1/admin/source-companies/:id/activation
GET    /api/v1/admin/source-companies/:id/dependencies
GET    /api/v1/admin/source-granularities
GET    /api/v1/admin/source-granularities/:id
POST   /api/v1/admin/source-granularities
PATCH  /api/v1/admin/source-granularities/:id
POST   /api/v1/admin/source-granularities/:id/activation
GET    /api/v1/admin/source-granularities/:id/dependencies
GET    /api/v1/admin/source-granularities/:id/cpl-periods
POST   /api/v1/admin/source-granularities/:id/cpl-schedule/commands
GET    /api/v1/admin/granot-crm-sources
GET    /api/v1/admin/granot-crm-sources/:id
PATCH  /api/v1/admin/granot-crm-sources/:id
PATCH  /api/v1/admin/granot-crm-sources/:id/activation
POST   /api/v1/admin/source-resolution/preview
GET    /api/v1/admin/cpl/snapshot
POST   /api/v1/admin/cpl/simple-schedule
POST   /api/v1/admin/cpl-corrections/preview
POST   /api/v1/admin/cpl-corrections
GET    /api/v1/admin/cpl-corrections/:id
POST   /api/v1/admin/cpl-corrections/:id/cancel
```

### Admin browse, exports, analytics

Browse resources: `form-leads` | `call-leads` | `booked-leads` | `cancelled-leads` | `customers` | `agents`

```
GET    /api/v1/admin/{resource}
GET    /api/v1/admin/{resource}/:id
GET    /api/v1/admin/exports/{resource}.csv
GET    /api/v1/admin/analytics/overview
GET    /api/v1/admin/analytics/{report}
GET    /api/v1/admin/exports/analytics/:report.csv
GET    /api/v1/admin/reports/agent-sales
GET    /api/v1/admin/exports/reports/agent-sales.csv
```

`{report}`: `summary` | `revenue-trend` | `source-company-performance` | `agent-performance` | `booking-cancellation-ratio` | `source-company-funnel` | `cancellation-reasons` | `lead-source-performance` | `local-vs-long-distance` | `geographic-lanes` | `pickup-state-performance` | `delivery-state-performance` | `receiver-agent-performance` | `receiver-agent-trend` | `receiver-agent-source-breakdown` | `sms-successfully-sent-then-booked`

### Admin ops, messages, Drive, registry, observability

```
GET    /api/v1/admin/testimonials
GET    /api/v1/admin/testimonials/reviewer-names
GET    /api/v1/admin/testimonials/:id
GET    /api/v1/admin/moving-carriers
POST   /api/v1/admin/moving-carriers
POST   /api/v1/admin/moving-carriers/import
PATCH  /api/v1/admin/moving-carriers/:id
GET    /api/v1/admin/sheet-sync/health
GET    /api/v1/admin/sheet-sync/jobs
GET    /api/v1/admin/sheet-sync/runs
GET    /api/v1/admin/sheet-sync/runs/:id
POST   /api/v1/admin/sheet-sync/retry
GET    /api/v1/admin/google-maps/geocoding-health
POST   /api/v1/admin/google-drive/oauth/authorize
GET    /api/v1/admin/google-drive/status
POST   /api/v1/admin/google-drive/picker/bootstrap
POST   /api/v1/admin/google-drive/picker/selections/verify
POST   /api/v1/admin/google-drive/folders
DELETE /api/v1/admin/google-drive/connection
POST   /api/v1/admin/google-drive/test-spreadsheet
GET    /api/v1/admin/lead-messages
GET    /api/v1/admin/lead-messages/:id
POST   /api/v1/admin/lead-messages/:id/retry
GET    /api/v1/admin/booking-lead-reconciliations
GET    /api/v1/admin/booking-lead-reconciliations/:id
POST   /api/v1/admin/booking-lead-reconciliations/:id/candidates/search
POST   /api/v1/admin/booking-lead-reconciliations/:id/candidates/refresh
PATCH  /api/v1/admin/booking-lead-reconciliations/:id/booking
POST   /api/v1/admin/booking-lead-reconciliations/:id/resolve
POST   /api/v1/admin/booking-lead-reconciliations/:id/reopen
GET    /api/v1/admin/operations-registry/overview
GET    /api/v1/admin/operations-registry/health
GET    /api/v1/admin/operations-registry/changes
GET    /api/v1/admin/observability/overview
GET    /api/v1/admin/observability/facets
GET    /api/v1/admin/observability/events
GET    /api/v1/admin/observability/events/:id
GET    /api/v1/admin/observability/incidents
GET    /api/v1/admin/observability/incidents/:id
PATCH  /api/v1/admin/observability/incidents/status
PATCH  /api/v1/admin/observability/incidents/:id/status
GET    /api/v1/admin/observability/notifications
GET    /api/v1/admin/observability/reports
POST   /api/v1/admin/observability/reports/run
GET    /api/v1/admin/observability/reports/:id
POST   /api/v1/admin/observability/:collection/delete
DELETE /api/v1/admin/observability/:collection/:id
GET    /api/v1/admin/exports/observability/events.csv
GET    /api/v1/admin/exports/observability/incidents.csv
GET    /api/v1/admin/exports/observability/reports/:id.csv
```

### RingCentral inbound routes

```
GET    /api/v1/admin/ringcentral/inbound-routes
GET    /api/v1/admin/ringcentral/inbound-routes/:id
POST   /api/v1/admin/ringcentral/inbound-routes
PATCH  /api/v1/admin/ringcentral/inbound-routes/:id
POST   /api/v1/admin/ringcentral/inbound-routes/:id/validate
POST   /api/v1/admin/ringcentral/inbound-routes/:id/activate
POST   /api/v1/admin/ringcentral/inbound-routes/:id/reassign
POST   /api/v1/admin/ringcentral/inbound-routes/:id/deactivate
GET    /api/v1/admin/ringcentral/inbound-routes/:id/dependencies
```

### Granot lifecycle

```
GET    /api/v1/admin/granot-lifecycle/operations/health
GET    /api/v1/admin/granot-lifecycle/cases
GET    /api/v1/admin/granot-lifecycle/cases/:case_id
GET    /api/v1/admin/granot-lifecycle/cases/:case_id/candidates
GET    /api/v1/admin/granot-lifecycle/cases/:case_id/creating-observation
GET    /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no
GET    /api/v1/admin/leads/:lead_model/:lead_id/lifecycle
GET    /api/v1/admin/granot-lifecycle/discrepancies
GET    /api/v1/admin/granot-lifecycle/discrepancies/:id
POST   /api/v1/admin/granot-lifecycle/discrepancies/:id/re-evaluate
POST   /api/v1/admin/granot-lifecycle/discrepancies/:id/correct-record-link
POST   /api/v1/admin/granot-lifecycle/discrepancies/:id/no-action
POST   /api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking
POST   /api/v1/admin/granot-lifecycle/booking-cases/:id/update-booking
POST   /api/v1/admin/granot-lifecycle/booking-cases/:id/create-referral-booking
POST   /api/v1/admin/granot-lifecycle/booking-cases/:id/no-action
POST   /api/v1/admin/granot-lifecycle/release-cases/:id/confirm-cancellation
POST   /api/v1/admin/granot-lifecycle/release-cases/:id/update-booking
POST   /api/v1/admin/granot-lifecycle/release-cases/:id/no-action
POST   /api/v1/admin/granot-lifecycle/activation
POST   /api/v1/admin/granot-lifecycle/receipts/:id/requeue
```

### Job Number timeline

```
GET    /api/v1/admin/job-number-timeline
```

### Granot automation, ingestion, reporting

```
GET    /api/v1/admin/granot-automation/runs
GET    /api/v1/admin/granot-automation/runs/:runId
GET    /api/v1/admin/granot-automation/runs/sources
POST   /api/v1/admin/granot-automation/runs
POST   /api/v1/admin/granot-automation/runs/sources
POST   /api/v1/admin/granot-automation/runs/worker
POST   /api/v1/admin/granot-automation/runs/:runId/approve
POST   /api/v1/admin/granot-automation/run-groups
GET    /api/v1/admin/ingestion/connections/best-relocation
PATCH  /api/v1/admin/ingestion/connections/best-relocation
POST   /api/v1/admin/ingestion/connections/best-relocation/inspect
POST   /api/v1/admin/ingestion/connections/best-relocation/preview
POST   /api/v1/admin/ingestion/connections/best-relocation/run
GET    /api/v1/admin/ingestion/runs
GET    /api/v1/admin/ingestion/runs/:runId
POST   /api/v1/admin/ingestion/runs/:runId/retry
GET    /api/v1/admin/ingestion/conflicts
POST   /api/v1/admin/ingestion/conflicts/:conflictId/resolve
GET    /api/v1/admin/reporting/catalog
GET    /api/v1/admin/reporting/destinations
POST   /api/v1/admin/reporting/destinations
GET    /api/v1/admin/reporting/destinations/:id
PATCH  /api/v1/admin/reporting/destinations/:id
POST   /api/v1/admin/reporting/destinations/:id/verify
DELETE /api/v1/admin/reporting/destinations/:id
GET    /api/v1/admin/reporting/definitions
POST   /api/v1/admin/reporting/definitions
GET    /api/v1/admin/reporting/definitions/:id
POST   /api/v1/admin/reporting/definitions/:id/revisions
POST   /api/v1/admin/reporting/definitions/:id/preview
POST   /api/v1/admin/reporting/definitions/:id/clone
POST   /api/v1/admin/reporting/definitions/:id/run
DELETE /api/v1/admin/reporting/definitions/:id
POST   /api/v1/admin/reporting/draft/preview
GET    /api/v1/admin/reporting/runs
GET    /api/v1/admin/reporting/runs/:id
POST   /api/v1/admin/reporting/runs/:id/cancel
```
