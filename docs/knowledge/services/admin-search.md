---
type: Service
title: Admin Search Service
description: Global admin free-text search across the four Lead/Booking/Cancellation resources (production database only), unlike paginated browse.
tags: [search, admin]
status: draft
stale_after: 2026-11-20
resource: src/services/admin/adminSearch.service.ts
applies_to:
  - src/services/admin/adminSearch.service.ts
  - src/services/admin/adminBrowse.service.ts
  - src/services/admin/adminExport.service.ts
  - src/services/admin/adminScope.service.ts
  - src/validation/v1/admin.validation.ts
  - src/routes/v1.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/admin/adminSearch.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-09-04T21:50:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/admin/adminSearch.service.ts`  
**Domain terms used:** [Admin Dashboard](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [No-Sync Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Admin Search Service

**Role:** Cross-resource typeahead for the **Admin Dashboard**. Read-only Mongo lookups; no mutations, **Sheet Sync**, or **CRM Posting**.

**Entry:** `GET /api/v1/admin/search` → `adminSearchQuerySchema` → `globalAdminSearch`.

## Query parameters (`AdminSearchQuery`)

| Param | Default | Notes |
|-------|---------|-------|
| `q` | required | Trimmed, min length 1 |
| `database_scope` | omitted | Transitional: omitted or `production` only. `historical` and `combined` return 400 (the historical database was retired in the 2026-10 slimming). | // pragma: allowlist secret
| `limit` | `5` | Per resource type **after** scopes are flattened; max 25 |

Unlike browse (`adminBrowse.service.ts`), search has no pagination, date filters, or facet filters — only free-text `q`. Schema uses `.strip()`.

## Database scope

Every admin read (search, browse, detail, facets, export, Analytics, Overview) reads the live production models from `getAdminModels()` in `adminScope.service.ts`. The historical database and its models were removed (SLIM-03); handlers validate the query before connecting, so a retired scope never reaches Mongo.

## Happy path

For each of the 4 `SEARCH_CONFIGS` keys, in parallel:

1. `q.trim()`; if `mongoose.isValidObjectId(q)` add `{ _id: toObjectId(q) }` **or** (always) regex `$or` across configured string fields (escaped, `/i`).
2. `find(filter).sort({ createdAt: -1 }).limit(limit).lean()`.
3. Map → `AdminSearchItem`.
4. At most `limit` items per resource.
5. Drop groups with `items.length === 0`.

No cross-resource ranking. Empty groups omitted (tested: one form-lead hit → one group).

ObjectId probe uses `mongoose.isValidObjectId` (more permissive than 24-hex) then `toObjectId`. The regex `$or` still runs even when the ObjectId clause is present.

## Resources and indexed fields

| Resource | Search fields | `href` | Badges |
|----------|---------------|--------|--------|
| `form-leads` | live + ingested + Granot contact name / email / phone paths (`FORM_LEAD_CONTACT_*_PATHS`), source_company, **three label snapshots**, **source_granularity_key**, ref_no, lid | `/form-leads/:id` | booked/unbooked, cancelled |
| `call-leads` | live + ingested + Granot contact name / email / phone paths (`CALL_LEAD_CONTACT_*_PATHS`), source_company, **three label snapshots**, **source_granularity_key**, job_no | `/call-leads/:id` | booked/unbooked, cancelled |
| `booked-leads` | job_no, normalized_job_no, customer_name, customer_name_snapshot, source, merchant, `agent_allocations.agent_name_snapshot` | `/bookings/:id` | booked + cancelled if ref set |
| `cancelled-leads` | job_no, normalized_job_no, customer_name, reason, cancelled_by, source, merchant, agent | `/cancellations/:id` | cancelled |

Lead badges: `doc.booked` truthy → `booked` else `unbooked`; plus `cancelled` if the ref is set.

**Labels:** first non-empty string among listed fields (`label()`). Form typeahead **labels stay live** `name` / `email` / `phone_number` — a Granot-only match still shows the Form submitted name. Call typeahead labels stay live **Called**. Source fallback for secondary: `crm_source_label_snapshot` → granularity snapshot → company snapshot → `source_company`.

Admin browse (`adminBrowse.service.ts`) Form and Call `q` / `name` / `email` / `phone_number` use the same shared contact path lists, including Manual attach dedicated filters without `q`. Processor identity still omits Call snapshot phone.

| Resource | Primary order | Secondary order |
|----------|---------------|-----------------|
| form-leads | ref_no, name, phone, `"Form lead"` | name, email, phone, sourceLabel |
| call-leads | job_no, name, phone, `"Call lead"` | name, email, phone, sourceLabel |
| booked-leads | job_no, `"Booking"` | customer_name, snapshot, source, merchant |
| cancelled-leads | job_no, `"Cancellation"` | customer_name, reason, source |

## Response shape

```ts
{ groups: [{ record_type, items: [{ id, primary_label, secondary_label, badges, href }] }] }
```

Items carry no `database_scope`: every hit is a production record. Customers and Agents are not searchable (their browse resources were removed); the Agent catalog serves the Operations Registry.

## Skip / fail paths

- Empty / missing `q` → Zod fail
- No matches → `{ groups: [] }`
- Does **not** filter Duplicate Leads or bad leads

## Invariants

- Search is **read-only**.
- ObjectId lookup is exact; other matching is substring regex (no `normalizePhoneNumberForMatch`).
- Adding a searchable resource requires `AdminResource`, `SEARCH_CONFIGS`, `getAdminModels`, and usually browse/export configs.

## Related admin modules

| Module | Relationship |
|--------|----------------|
| `adminScope.service.ts` | `getAdminModels()`: the four production resource models |
| `adminBrowse.service.ts` | Paginated list/filter/detail. Form/Call **Source Company** filter is exact `source_granularity_key` (plus snapshot / catalog id). Leftover `source_company` is bookmark compatibility only, exact (not substring), and loses when both params are present. Form-leads / call-leads browse accept optional `no_sync`: Yes `{ no_sync: true }`, No `{ no_sync: { $ne: true } }` (missing-field counts as No), omit no clause. Not a global-search filter or badge. Owner desk copy is Hidden from Master Leads; the API field is `no_sync`. Customers and Agents are no longer browse resources: `GET /api/v1/admin/agents` and `/:id` serve the Agent catalog (`{ items }`, honors `include_inactive`) for the Operations Registry. |
| `adminFacets.service.ts` / `filterCatalog.ts` | Filter Catalog (`catalog`) plus compatibility arrays, production only. `"facets"` invalidation evicts the cache. Catalog rows carry no `origin`. |
| `adminExport.service.ts` | CSV export for the four Lead/Booking/Cancellation resources. |

## When to use search vs browse

- **Admin search (this doc):** jump by name, phone, job no, ref no, granularity key, or Mongo id across types.
- **Admin browse:** tables with pagination, sort, date range, Source Company (`source_granularity_key`), duplicate flag.
- **Extension lead browse:** [`lead-browse.md`](./lead-browse.md).
- **Extension POST search:** [`form-lead-search.md`](./form-lead-search.md), [`call-lead-search.md`](./call-lead-search.md).

Tests: `admin.service.test.ts` (`global admin search returns grouped results`).
