---
type: Service
title: Analytics Service
description: Admin analytics reports, scopes, and overview/agent-sales siblings.
tags: [analytics, reporting]
status: draft
stale_after: 2026-11-20
resource: src/services/analytics/
applies_to:
  - src/services/analytics/analytics.service.ts
  - src/services/analytics/analyticsFilters.ts
  - src/services/analytics/analyticsMerge.ts
  - src/services/analytics/analyticsExport.service.ts
  - src/services/analytics/overview.service.ts
  - src/services/analytics/leadCost.service.ts
  - src/services/analytics/agentSalesReport.service.ts
  - src/validation/v1/analytics.validation.ts
  - src/routes/v1.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/analytics/
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T04:51:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/analytics/`  
**Domain terms used:** [Analytics](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md), [CPL](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [Agent Allocation](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md)

# Analytics Service

**System of Record:** Read-only MongoDB aggregations over [REDACTED] and/or historical Form Lead, Call Lead, Booking, and Cancellation collections. **Analytics** does not query **Reporting Sheets**. No writes, no **Sheet Sync**. // pragma: allowlist secret

**Role:** Dispatch `report` + `query` to a concrete report, resolve `database_scope` to model sets, merge when `combined`.

**Not this module:** Ring Central call analytics reconciliation (`ringcentral/analytics-reconcile.service.ts`) — count-only; must not create Call Leads.

## HTTP entry points

| Route | Handler |
|-------|---------|
| `GET /api/v1/admin/analytics/:report` | `getAnalyticsReport` |
| `GET /api/v1/admin/exports/analytics/:report.csv` | `exportAnalyticsReportCsv` → `getAnalyticsReport` |
| `GET /api/v1/admin/analytics/overview` | `getOverviewReport` (`overviewQuerySchema`: scope only) |
| `GET /api/v1/admin/reports/agent-sales` | `getAgentSalesReport` (`agentSalesReportQuerySchema`) |

Admin auth (same family as browse/search). Report names: `analyticsReportSchema`.

## Orchestration (`getAnalyticsReport`)

1. `concreteScopes(query.database_scope)` → `[REDACTED]`, `historical`, or both. // pragma: allowlist secret
2. Each scope: `getAdminModels(scope)` + switch on report.
3. **`combined`:** `mergeAnalyticsPayload(report, payloads)` — sum numeric fields, re-derive rates by stable keys. **Does not dedupe rows by business id.**
4. Return `{ report, database_scope, generated_at, data }`.

| Report | Implementation | Primary collections |
|--------|----------------|---------------------|
| `summary` | `summary.service.ts` | form + call + booked + cancelled |
| `revenue-trend` | `revenueTrend.service.ts` | booked (period from `report_date`) |
| `source-company-performance` | `sourcePerformance.service.ts` | booked |
| `agent-performance` | `agentPerformance.service.ts` | booked (unwind allocations) |
| `booking-cancellation-ratio` | `cancellationAnalytics.service.ts` | booked |
| `source-company-funnel` | `sourcePerformance.service.ts` | form + call + booked |
| `cancellation-reasons` | `cancellationAnalytics.service.ts` | cancelled |
| `lead-source-performance` | `sourcePerformance.service.ts` | booked (`source` field) |
| `local-vs-long-distance` | `geographicAnalytics.service.ts` | booked (`local`) |
| `geographic-lanes` | `geographicAnalytics.service.ts` | form + call (pickup × delivery) |
| `pickup-state-performance` / `delivery-state-performance` | `geographicAnalytics.service.ts` | form + call |
| `receiver-agent-performance` / `trend` / `source-breakdown` | `receiverAgentPerformance.service.ts` | form + call (`receiver_agent`) |

**Historical skip:** each receiver-agent report returns `unsupportedReceiverAgentReport()` (`items: []` + `historical_receiver_agent_supported: false`). Combined merge keeps [REDACTED] rows and that warning metadata. // pragma: allowlist secret

## Query filters (`analyticsQuerySchema`)

`.strip()`. `lead_type` `form`/`call` → `FormLead`/`CallLead`. `granularity` default `month`. `receiver_agent` must be 24-hex or omitted.

| Param | Effect |
|-------|--------|
| `database_scope` | `[REDACTED]` (default), `historical`, `combined` | // pragma: allowlist secret
| `from` / `to` | Date range — field depends on collection |
| `source_company` | Alias-aware exact regex set (`derived_source_company` on bookings; `source_company` `$in` variants on leads) |
| `source_granularity_key` | Anchored exact on `derived_source_granularity_key` (bookings) or `source_granularity_key` (leads) |
| `source` | Booking/cancelled `source` (exact, case-insensitive) |
| `agent` | Booking: `agent_allocations.agent_name_snapshot`; cancelled: `agent` |
| `merchant` | Booking/cancelled merchant |
| `local` | Booking or lead `local` |
| `lead_type` | Booking/cancelled `lead_model`; leads: excludes the other type via `{ _id: { $exists: false } }` |
| `granularity` | `day` or `month` — **revenue-trend** date format |
| `receiver_agent` | Registry agent ObjectId on receiver-agent reports |

### Date fields

| Collection | Range field |
|------------|-------------|
| `form_leads` / `call_leads` | `timestamp` (`leadMatch`) |
| `booked_leads` | `book_date` (`directBookedLeadMatch`) |
| `cancelled_leads` | `cancel_date` |
| Revenue trend buckets | `report_date` via `trendDateExpression` (`%Y-%m-%d` or `%Y-%m`) |

## Shared pipeline helpers (`analyticsFilters.ts`)

**`bookedLeadPrefix`:** leading `$match` on booking fields (dates, source, merchant, local, agent, lead_model) → `$lookup` form + call on `lead_ref` → set derived source fields + `is_cancelled` → optional company/granularity `$match`.

**`derived_source_company` order (tested):**

1. `employee_source_snapshot.source_company`
2. `form_lead.source_company`
3. `call_lead.source_company`
4. `form_lead.source_company_label_snapshot`
5. `call_lead.source_company_label_snapshot`
6. booking `source`
7. `"unknown"`

**`derived_source_granularity_key`:** employee snapshot → form key → call key.

**`cancelledLeadPrefix`:** cancel-field match → lookup booking → join lead_ref/model → lookup form/call → same derived fields + filters.

**`leadMatch`:** timestamp range, local, source_company variants, source_granularity_key, lead_type exclusion.

Company variants: `resolveSourceCompany` + config label/aliases + `SOURCE_LABEL_TO_COMPANY` reverse map; each becomes an anchored `/i` regex.

## Combined merge (`analyticsMerge.ts`)

Keys: `source_company` via `normalizeSourceDimension`; other dimensions lowercased. Numeric counters sum; `booking_rate` / `cancellation_rate` / `average_cpl` recomputed.

Special shapes: `summary` → `{ totals }`; `booking-cancellation-ratio` → `{ overall, by_source_company }`; `geographic-lanes` → `{ form_lanes, call_lanes }`; receiver-agent reports keep warning metadata. Source-company funnel merge retains [REDACTED] `granularities` children only (tested). // pragma: allowlist secret

## Report semantics (high-signal)

**Summary** — `countDocuments` form/call; booking deposit/binder + `is_cancelled` count; separate cancelled-collection `cancellations` + refund. `active_bookings = max(bookings - cancelled_bookings, 0)`. `booking_rate = bookings / (form+call)`.

**Agent performance** — `$unwind` `agent_allocations`. Binder from **allocation** `binder_amount`; **deposit is `$deposit_amount` per unwound row** (split bookings credit the full deposit to each agent). Sort deposit desc; **top 50**.

**Source company funnel** — lead-level `sheet_*` counts from form/call refs plus **reconciled** booking aggregates.

**Booking cancellation ratio** — booked collection `is_cancelled` only (not cancelled-leads count).

**Cancellation reasons** — groups cancelled docs; joins booking for affected deposit/binder and `linked_to_booked`.

**Lead source performance** — booking `source` field, not `derived_source_company`.

**Receiver-agent reports** — historical empty + unsupported metadata. Combined = [REDACTED] rows + warning. Source breakdown uses persisted registry snapshots; owner-created Source Companies keep their slug/label (never remapped to the legacy Main Site fallback). // pragma: allowlist secret

**Lead cost** (`leadCost.service.ts`) — **overview only**, [REDACTED] all-time / last-7-days. Sums stored **CPL**: Form Leads `duplicate: { $ne: true }`; Call Leads `created_on_unmatched: { $ne: true }`. Null `cpl` increments `unresolved_count` and contributes 0. Production groups by company + granularity; historical group id is company only. // pragma: allowlist secret

## Overview (`overview.service.ts`)

- **All time:** `getSummary` + top 5 agents by deposit; `lead_cost` only when requested scope **and** concrete scope are `[REDACTED]`. // pragma: allowlist secret
- **Last 7 days:** `[REDACTED]` only — rolling window (`from` midnight 7 days ago → now), summary + by-source bookings + lead cost + top agents. Historical and combined set `last_7_days: null`. // pragma: allowlist secret
- **Combined all-time:** merges totals and top agents; `lead_cost` is `null`.

## Agent Sales (`agentSalesReport.service.ts`)

Hard-coded `getAdminModels("[REDACTED]")`. Requires `from`/`to`. Optional `agents[]` (exact `/i` on allocation snapshot). Unwind allocations; `leads` = `booked_deals` (no standalone lead attribution). Separate CSV route. // pragma: allowlist secret

## CSV export (`analyticsExport.service.ts`)

`getAnalyticsReport` then flatten. Source-company reports emit **leaves or a childless company, never both** (tested). Combined funnel CSV does not also emit the parent total (avoids double-counting the [REDACTED] contribution). Filename: `analytics-{report}-{database_scope}.csv`. // pragma: allowlist secret

## Invariants

- Analytics is read-only.
- Booking cancellation in booking reports = `BookedLead.cancelled` ref set (`is_cancelled`), not merely a cancelled-leads row.
- `derived_source_company` prefers **employee snapshot** over joined lead slugs.
- `combined` sums collections; it does not join by business id.
- Do not bypass `bookedLeadPrefix` / `cancelledLeadPrefix` / `leadMatch` when adding booking- or lead-scoped reports.

## Related modules

- Scope/models: `admin/adminScope.service.ts`
- Admin search: [`admin-search.md`](./admin-search.md)
- Agent allocations: [`agent-allocation.md`](./agent-allocation.md)
- CPL on leads: [`form-lead.md`](./form-lead.md), [`call-lead.md`](./call-lead.md)
- RingCentral ops reconcile: `ringcentral/analytics-reconcile.service.ts`

Tests: `analytics.service.test.ts` (query schema, booked prefix + employee snapshot, combined merges, receiver-agent warning, CSV flatten).
