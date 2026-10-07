---
type: Service
title: Analytics Service
description: Admin analytics reports and the Overview sibling, read from the production database only.
tags: [analytics, reporting]
status: draft
stale_after: 2026-11-20
resource: src/services/analytics/
applies_to:
  - src/services/analytics/analytics.service.ts
  - src/services/analytics/analyticsFilters.ts
  - src/services/analytics/analyticsExport.service.ts
  - src/services/analytics/overview.service.ts
  - src/services/analytics/leadCost.service.ts
  - src/services/analytics/smsConversion.service.ts
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
**Domain terms used:** [Analytics](../../../../CONTEXT.md), [Lead Message](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md), [CPL](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [Agent Allocation](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md)

# Analytics Service

> **Insights (2026-10-06):** the admin's Insights › Analytics page reads [`insights.md`](./insights.md) (live lead cost,
> comparisons, New York half-open periods, split credit). These reports stay for compatibility and CSV export; their
> known gaps (UTC `$lte to` cuts off the last day, full deposit credited to each split agent, stamped `cpl` sums) are
> fixed there, not here.

**System of Record:** Read-only MongoDB aggregations over the production Form Lead, Call Lead, Booking, and Cancellation collections. **Analytics** does not query **Reporting Sheets**. No writes, no **Sheet Sync**. The historical database was retired in the 2026-10 slimming (SLIM-03). // pragma: allowlist secret

**Role:** Dispatch `report` + `query` to a concrete report over the production models. // pragma: allowlist secret

**Not this module:** Ring Central call analytics reconciliation (`ringcentral/analytics-reconcile.service.ts`) — count-only; must not create Call Leads.

## HTTP entry points

| Route | Handler |
|-------|---------|
| `GET /api/v1/admin/analytics/:report` | `getAnalyticsReport` |
| `GET /api/v1/admin/exports/analytics/:report.csv` | `exportAnalyticsReportCsv` → `getAnalyticsReport` |
| `GET /api/v1/admin/analytics/overview` | `getOverviewReport` (`overviewQuerySchema`: transitional scope only) |

Admin auth (same family as browse/search). Report names: `analyticsReportSchema`. The dedicated Agent Sales report routes were removed; Agent performance stays a report here. Handlers validate the query before connecting to Mongo.

## Orchestration (`getAnalyticsReport`)

1. `getAdminModels()` + switch on report.
2. Return `{ report, generated_at, data }` (no `database_scope`).

| Report | Implementation | Primary collections |
|--------|----------------|---------------------|
| `summary` | `summary.service.ts` | form + call + booked + cancelled |
| `revenue-trend` | `revenueTrend.service.ts` | booked (period from `report_date`) |
| `source-company-performance` | `sourcePerformance.service.ts` | booked |
| `agent-performance` | `agentPerformance.service.ts` | booked (unwind allocations) |
| `booking-cancellation-ratio` | `cancellationAnalytics.service.ts` | booked |
| `source-company-funnel` | `sourcePerformance.service.ts` | form + call + booked |
| `cancellation-reasons` | `cancellationAnalytics.service.ts` | cancelled |
| `lead-source-performance` | `sourcePerformance.service.ts` | booked (`source_granularity_key`) |
| `local-vs-long-distance` | `geographicAnalytics.service.ts` | booked (`local`) |
| `geographic-lanes` | `geographicAnalytics.service.ts` | form + call (pickup × delivery) |
| `pickup-state-performance` / `delivery-state-performance` | `geographicAnalytics.service.ts` | form + call |
| `receiver-agent-performance` / `trend` / `source-breakdown` | `receiverAgentPerformance.service.ts` | form + call (`receiver_agent`) |
| `sms-successfully-sent-then-booked` | `smsConversion.service.ts` | `lead_messages` + form/call (`lead.booked`) |

Receiver-agent and `sms-successfully-sent-then-booked` reports always return production rows; there is no unsupported/warning payload any more. // pragma: allowlist secret

## Query filters (`analyticsQuerySchema`)

`.strip()`. `lead_type` `form`/`call` → `FormLead`/`CallLead`. `granularity` default `month`. `receiver_agent` must be 24-hex or omitted.

| Param | Effect |
|-------|--------|
| `database_scope` | Transitional: omitted or `production` only; `historical` / `combined` return 400 | // pragma: allowlist secret
| `from` / `to` | Date range — field depends on collection |
| `source_company` | Compatibility only. Alias-aware exact regex set (`derived_source_company` on bookings; `source_company` `$in` variants on leads). Not applied when `source_granularity_key` is set. |
| `source_granularity_key` | Admin **Source Company** dropdown. Bookings/cancelled: `sourceGranularityMatch` only — anchored exact on `derived_source_granularity_key` (last fallback is booked `source`). Leads: `leadMatchForQuery` loads the Filter Catalog, then exact-matches key, snapshot, submitted `source_company`, and catalog id. |
| `source` | Compatibility only. Booking/cancelled `source` (exact, case-insensitive) |
| `agent` | Booking: `agent_allocations.agent_name_snapshot`; cancelled: `agent` |
| `merchant` | Booking/cancelled merchant |
| `local` | Booking or lead `local` |
| `lead_type` | Booking/cancelled `lead_model`; leads: excludes the other type via `{ _id: { $exists: false } }` |
| `granularity` | `day` or `month` — **revenue-trend** date format |
| `receiver_agent` | Registry agent ObjectId on receiver-agent reports |

### Date fields

| Collection | Range field |
|------------|-------------|
| `form_leads` / `call_leads` | `timestamp` (`leadMatchForQuery`) |
| `sms-successfully-sent-then-booked` | joined Lead `timestamp` after a successful Lead Message |
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

**`derived_source_granularity_key`:** employee snapshot → form key → call key → booking `source`.

**`cancelledLeadPrefix`:** cancel-field match → lookup booking → join lead_ref/model → lookup form/call → same derived fields + filters.

**`leadMatchForQuery`:** when `source_granularity_key` is set, loads the Filter Catalog via `getAdminFacets()` then calls `leadMatch`. Callers: `sourcePerformance`, `leadCost`, `summary`, `geographicAnalytics`, `receiverAgentPerformance`, `smsConversion`.

**`leadMatch`:** timestamp range, local, leftover `source_company` variants when the dropdown is unset, otherwise exact key / snapshot / submitted `source_company` / catalog id, lead_type exclusion.

Company variants: `resolveSourceCompany` + config label/aliases + `SOURCE_LABEL_TO_COMPANY` reverse map; each becomes an anchored `/i` regex.

## Report semantics (high-signal)

**Summary** — `countDocuments` form/call; booking deposit/binder + `is_cancelled` count; separate cancelled-collection `cancellations` + refund. `active_bookings = max(bookings - cancelled_bookings, 0)`. `booking_rate = bookings / (form+call)`.

**Agent performance** — `$unwind` `agent_allocations`. Binder from **allocation** `binder_amount`; **deposit is `$deposit_amount` per unwound row** (split bookings credit the full deposit to each agent). Sort deposit desc; **top 50**.

**Source company performance / funnel** — `nestObservedSourceRows` seeds every Filter Catalog Source Granularity in scope (zeros remain), then overlays observed metrics. Funnel also includes lead-level `sheet_*` counts from form/call refs plus **reconciled** booking aggregates. Parent totals = sum of children.

**Booking cancellation ratio** — booked collection `is_cancelled` only (not cancelled-leads count).

**Cancellation reasons** — groups cancelled docs; joins booking for affected deposit/binder and `linked_to_booked`.

**Lead source performance** — groups by `source_granularity_key` and catalog `owner_label`, same hierarchy as source-company performance. Does not group by `booked_leads.source`.

**Receiver-agent reports** — production rows. Source breakdown groups by `source_granularity_key` and catalog `owner_label`. // pragma: allowlist secret

**SMS successfully sent then booked** — production `lead_messages` only. Successful text = status `accepted` | `sent` | `delivered`. One Lead, one vote (`lead_ref.id`, fallback `form_lead`). Booked is the official Lead `booked` ref, not a `booked_leads` lookup. Rate = distinct texted-and-booked Leads / distinct texted Leads. Payload is an `all` totals row plus a breakout by message `origin`. Date/source/`local` filters apply to the joined Lead, not the message.

**Lead cost** (`leadCost.service.ts`) — **overview only**, all-time / last-7-days. Sums stored **CPL**: Form Leads `duplicate: { $ne: true }`; Call Leads `created_on_unmatched: { $ne: true }`. Null `cpl` increments `unresolved_count` and contributes 0. Reports seed every catalog Source Granularity in scope (zeros remain).

## Overview (`overview.service.ts`)

- **All time:** `getSummary` + top 5 agents by deposit + `lead_cost` (always present).
- **Last 7 days:** rolling window (`from` midnight 7 days ago → now), summary + by-source bookings + lead cost + top agents (always present).
- Overview HTTP stays unfiltered (`overviewQuerySchema`: scope only). Home source tables still list catalog Source Granularities from that payload, including zeros.

## CSV export (`analyticsExport.service.ts`)

`getAnalyticsReport` then flatten. Source-company, lead-source, and booking-cancellation-ratio reports emit **leaves (including zeros) or a childless company, never both** (tested). Leaf labels use catalog `owner_label`. Filename: `analytics-{report}.csv`.

## Invariants

- Analytics is read-only.
- Booking cancellation in booking reports = `BookedLead.cancelled` ref set (`is_cancelled`), not merely a cancelled-leads row.
- `derived_source_company` prefers **employee snapshot** over joined lead slugs.
- Do not bypass `bookedLeadPrefix` / `cancelledLeadPrefix` / `leadMatchForQuery` when adding booking- or lead-scoped reports.

## Related modules

- Models: `admin/adminScope.service.ts` (`getAdminModels()`)
- Admin search: [`admin-search.md`](./admin-search.md)
- Agent allocations: [`agent-allocation.md`](./agent-allocation.md)
- CPL on leads: [`form-lead.md`](./form-lead.md), [`call-lead.md`](./call-lead.md)
- Lead Messages / successful-text statuses: [`lead-messaging.md`](./lead-messaging.md)
- RingCentral ops reconcile: `ringcentral/analytics-reconcile.service.ts`

Tests: `analytics.service.test.ts` (query schema, booked prefix + employee snapshot, receiver-agent and SMS-conversion reports, CSV flatten); `smsConversion.service.test.ts` (origin rows); `adminDatabaseScope.test.ts` and `v1-admin-database-scope.routes.test.ts` (retired scopes return 400).
