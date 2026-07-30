**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `api/services/analytics/analytics.service.ts`  
**Domain terms used:** Analytics, System of Record, CPL, Source Company, Agent Allocation, Cancellation, Reporting Sheets

# Analytics Service

**System of Record:** Read-only MongoDB aggregations over production and/or historical Form Lead, Call Lead, Booking, and Cancellation collections. **Analytics** does not query **Reporting Sheets**. No writes, no **Sheet Sync**.

**Role:** Orchestrator for **Admin Dashboard** **Analytics** reports. Routes `report` + `query` to a concrete report service, resolves `database_scope` to model sets, and merges results when scope is `combined`.

**Not this module:** Ring Central call analytics reconciliation lives in `ringcentral/analytics-reconcile.service.ts` (cron/ops) — count-only; must not create Call Leads.

## HTTP entry points

| Route | Handler |
|-------|---------|
| `GET /api/v1/admin/analytics/:report` | `getAnalyticsReport` |
| `GET /api/v1/admin/exports/analytics/:report.csv` | `exportAnalyticsReportCsv` → `getAnalyticsReport` |
| `GET /api/v1/admin/analytics/overview` | `getOverviewReport` (`overview.service.ts`) |
| `GET /api/v1/admin/reports/agent-sales` | `getAgentSalesReport` (`agentSalesReport.service.ts`) |

All use admin auth (same family as browse/search).

## Orchestration (`getAnalyticsReport`)

1. `concreteScopes(query.database_scope)` → `["production"]`, `["historical"]`, or both.
2. For each scope: `getAdminModels(scope)` + dispatch to report function.
3. **`combined`:** `mergeAnalyticsPayload(report, payloads)` sums numeric fields and re-derives rates by stable dimension keys.
4. Return `{ report, database_scope, generated_at, data }`.

Report names (validated by `analyticsReportSchema`):

| Report | Implementation | Primary collections |
|--------|----------------|---------------------|
| `summary` | `summary.service.ts` | form + call + booked + cancelled |
| `revenue-trend` | `revenueTrend.service.ts` | booked (by period) |
| `source-company-performance` | `sourcePerformance.service.ts` | booked |
| `agent-performance` | `agentPerformance.service.ts` | booked (unwind allocations) |
| `booking-cancellation-ratio` | `cancellationAnalytics.service.ts` | booked |
| `source-company-funnel` | `sourcePerformance.service.ts` | form + call + booked |
| `cancellation-reasons` | `cancellationAnalytics.service.ts` | cancelled |
| `lead-source-performance` | `sourcePerformance.service.ts` | booked (`source` field) |
| `local-vs-long-distance` | `geographicAnalytics.service.ts` | booked (`local`) |
| `geographic-lanes` | `geographicAnalytics.service.ts` | form + call (pickup × delivery) |
| `pickup-state-performance` | `geographicAnalytics.service.ts` | form + call |
| `delivery-state-performance` | `geographicAnalytics.service.ts` | form + call |

## Query filters (`analyticsQuerySchema`)

Shared across reports unless a report ignores a field.

| Param | Effect |
|-------|--------|
| `database_scope` | `production` (default), `historical`, or `combined` |
| `from` / `to` | Date range — field depends on collection (see below) |
| `source_company` | Canonical source filter via alias-aware regex (`derived_source_company` on bookings; direct on leads) |
| `source` | Booking `source` field (exact, case-insensitive) |
| `agent` | Booking: `agent_allocations.agent_name_snapshot`; cancelled: `agent` snapshot |
| `merchant` | Booking/cancelled merchant (exact) |
| `local` | Booking `local` or lead `local` |
| `lead_type` | `form`/`FormLead` or `call`/`CallLead` — excludes the other lead type |
| `granularity` | `day` or `month` (default `month`) — **revenue-trend only** |

### Date fields by collection

| Collection | Range field | Notes |
|------------|-------------|-------|
| `form_leads` / `call_leads` | `timestamp` | Via `leadMatch` |
| `booked_leads` | `book_date` | Via `bookedLeadPrefix` |
| `cancelled_leads` | `cancel_date` | Via `cancelledLeadPrefix` |
| Revenue trend grouping | `book_date` ?? `timestamp` | Bucketed by `granularity` |

## Shared pipeline helpers (`analyticsFilters.ts`)

**`bookedLeadPrefix(query)`** — standard booking analytics prefix:

1. Direct `$match` on booking fields (dates, source, merchant, local, agent, lead_model).
2. `$lookup` form + call leads on `lead_ref`.
3. Set `derived_source_company` (form → call → booking `source` → `"unknown"`).
4. Set `is_cancelled` when `cancelled` ref is non-null.
5. Optional `source_company` filter on `derived_source_company` (label/alias variants).

**`cancelledLeadPrefix(query)`** — cancelled analytics prefix:

1. Direct match on cancel fields.
2. Lookup booking + source lead to derive `derived_source_company` for filtering.

**`leadMatch(leadType, query)`** — form/call lead filters: timestamp range, local, source_company, lead_type exclusion.

Utilities: `normalizeSourceDimension`, `roundMoney`, `rate`, `numberValue`, `trendDateExpression`.

## `database_scope` and models

From `adminScope.service.ts`:

- **`production`** — live Mongoose models (`FormLead`, `CallLead`, `BookedLead`, …).
- **`historical`** — separate collections via `registerHistoricalModels()`.
- **`combined`** — runs both scopes in parallel, merges payloads (does **not** dedupe cross-database rows by id).

Merge keys (`analyticsMerge.ts`): e.g. `source_company` normalized via `normalizeSourceCompany`, other dimensions lowercased. Numeric counters sum; `booking_rate` / `cancellation_rate` recomputed after merge.

Special merge shapes: `summary` → `{ totals }`, `booking-cancellation-ratio` → `{ overall, by_source_company }`, `geographic-lanes` → `{ form_lanes, call_lanes }`.

## Report semantics (high-signal)

**Summary** — counts form/call leads; booking deposit/binder totals; cancellation count + refund total; `active_bookings = bookings - cancelled_bookings` on booked side; separate `cancellations` count from cancelled collection.

**Agent performance** — `$unwind` on `agent_allocations`. Binder credited per allocation; **deposit is summed per unwound row** (split bookings count deposit once per agent row). Top 50 by deposit.

**Source company funnel** — lead-level `sheet_*` counts from form/call `booked`/`cancelled` refs plus **reconciled** booking aggregates (`reconciled_bookings`). Useful for comparing sheet-attributed vs booking-collection truth.

**Booking cancellation ratio** — uses booked collection only; `is_cancelled` flag (not cancelled-leads count) for ratio.

**Cancellation reasons** — groups cancelled docs; joins booking for affected deposit/binder and `linked_to_booked`.

**Lead source performance** — groups booked leads by booking `source` field (marketing label), not `derived_source_company`.

**Receiver-Agent source breakdown** — uses persisted registry source-company
and granularity/CRM label snapshots. Owner-created Source Companies are kept as
their canonical dynamic slug/label and are never remapped to the legacy Main
Site fallback.

**Lead cost** (`leadCost.service.ts`) — **overview only**, production all-time / last-7-days. Sums **CPL** on billable leads: Form Leads exclude Duplicate Leads; Call Leads exclude **Unmatched Call Leads** (`created_on_unmatched: true`).

**CPL config lag:** Stored CPL at ingestion may not reflect full Source Company + Lead Channel + Move Type granularity (see [`form-lead.service.md`](form-lead.service.md)).

## Overview (`overview.service.ts`)

- **All time:** `getSummary` + top 5 agents by deposit; `lead_cost` only when `database_scope === "production"`.
- **Last 7 days:** production only — rolling window, summary + by-source bookings + lead cost + top agents.
- **Combined all-time:** merges totals and top agents; `lead_cost` is `null` (no cross-scope CPL merge).

## Agent Sales report (`agentSalesReport.service.ts`)

Production-only. Requires explicit `from`/`to`. Optional `agents[]` filter. Counts booked deals per agent from unwound allocations; **`leads` = `booked_deals`** (no standalone lead attribution). Separate CSV export route.

## CSV export (`analyticsExport.service.ts`)

Calls `getAnalyticsReport`, flattens payload per report shape (summary single row; ratio adds `overall` row; geographic-lanes tags `lead_type`). Filename: `analytics-{report}-{database_scope}.csv`.

## Invariants

- Analytics is read-only; never mutate leads/bookings from these services.
- Booking cancellation in reports = `BookedLead.cancelled` ref set, not merely existence of a cancelled doc.
- `derived_source_company` is the canonical dimension for source-company booking reports; aliases merge in `combined` scope.
- Historical vs production data are separate collections — `combined` sums both, it does not join by business id.
- Do not bypass `bookedLeadPrefix` / `cancelledLeadPrefix` / `leadMatch` when adding booking- or lead-scoped reports.
- Agent binder attribution follows allocation snapshots (see `agentAllocation.service.md`).

## Related modules

- Scope/models: `admin/adminScope.service.ts`
- Admin browse/search filters: `adminSearch.service.md`
- Agent allocations on bookings: `agentAllocation.service.md`
- CPL on leads: `form-lead.service.md`, `call-lead.service.md`
- RingCentral ops reconcile: `ringcentral/analytics-reconcile.service.ts`
