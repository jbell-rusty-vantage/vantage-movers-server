---
type: Service
title: Admin Search Service
description: Global admin free-text search across scoped resources, unlike paginated browse.
tags: [search, admin]
status: draft
stale_after: 2026-11-20
resource: src/services/admin/adminSearch.service.ts
applies_to:
  - src/services/admin/adminSearch.service.ts
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
  by: process:okf-docs-optimization
  at: 2026-08-28T16:13:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/admin/adminSearch.service.ts`  
**Domain terms used:** [Admin Dashboard](../../../../CONTEXT.md), [Workflow Observational](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Admin Search Service

**Role:** Cross-resource typeahead for the **Admin Dashboard**. Read-only Mongo lookups; no mutations, **Sheet Sync**, or **CRM Posting**.

**Entry:** `GET /api/v1/admin/search` → `adminSearchQuerySchema` → `globalAdminSearch`.

## Query parameters (`AdminSearchQuery`)

| Param | Default | Notes |
|-------|---------|-------|
| `q` | required | Trimmed, min length 1 |
| `database_scope` | `[REDACTED]` | `[REDACTED]` \| `historical` \| `combined` | // pragma: allowlist secret
| `limit` | `5` | Per resource type **after** scopes are flattened; max 25 |

Unlike browse (`adminBrowse.service.ts`), search has no pagination, date filters, or facet filters — only free-text `q`. Schema uses `.strip()`.

## Database scope

`concreteScopes` in `adminScope.service.ts`:

| `database_scope` | Behavior |
|------------------|----------|
| `[REDACTED]` | Live Mongoose models | // pragma: allowlist secret
| `historical` | `registerHistoricalModels()` |
| `combined` | Both scopes in parallel; each item tagged with `database_scope` |

Detail endpoints reject `combined` (`rejectCombinedDetailScope`). Search is one of the few reads that allow it.

## Happy path

For each of 6 `SEARCH_CONFIGS` keys, in parallel:

1. Expand scope → one or two concrete scopes.
2. Per scope: `q.trim()`; if `mongoose.isValidObjectId(q)` add `{ _id: toObjectId(q) }` **or** (always) regex `$or` across configured string fields (escaped, `/i`).
3. `find(filter).sort({ createdAt: -1 }).limit(limit).lean()`.
4. Map → `AdminSearchItem`.
5. Flatten scopes, **`slice(0, limit)`** per resource (combined can mix scopes but still caps at `limit`).
6. Drop groups with `items.length === 0`.

No cross-resource ranking. Empty groups omitted (tested: one form-lead hit → one group).

ObjectId probe uses `mongoose.isValidObjectId` (more permissive than 24-hex) then `toObjectId`. The regex `$or` still runs even when the ObjectId clause is present.

## Resources and indexed fields

| Resource | Search fields | `href` | Badges |
|----------|---------------|--------|--------|
| `form-leads` | live + ingested + Granot contact name / email / phone paths (`FORM_LEAD_CONTACT_*_PATHS`), source_company, **three label snapshots**, **source_granularity_key**, ref_no, lid | `/form-leads/:id` | booked/unbooked, cancelled |
| `call-leads` | name, email, phone_number, normalized_phone_number, source_company, **three label snapshots**, **source_granularity_key**, job_no | `/call-leads/:id` | booked/unbooked, cancelled |
| `booked-leads` | job_no, normalized_job_no, customer_name, customer_name_snapshot, source, merchant, `agent_allocations.agent_name_snapshot` | `/bookings/:id` | booked + cancelled if ref set |
| `cancelled-leads` | job_no, normalized_job_no, customer_name, reason, cancelled_by, source, merchant, agent | `/cancellations/:id` | cancelled |
| `customers` | full_name, normalized_name, phone_number, email | `/customers/:id` | customer |
| `agents` | name, normalized_name, role | `/agents/:id` | active/inactive, agent |

Lead badges: `doc.booked` truthy → `booked` else `unbooked`; plus `cancelled` if the ref is set.

**Labels:** first non-empty string among listed fields (`label()`). Form typeahead **labels stay live** `name` / `email` / `phone_number` — a Granot-only match still shows the Form submitted name. Source fallback for secondary: `crm_source_label_snapshot` → granularity snapshot → company snapshot → `source_company`.

Admin browse (`adminBrowse.service.ts`) Form `q` / `name` / `email` / `phone_number` use the same shared contact path lists. Call typeahead still omits `granot_contact_snapshot`.

| Resource | Primary order | Secondary order |
|----------|---------------|-----------------|
| form-leads | ref_no, name, phone, `"Form lead"` | name, email, phone, sourceLabel |
| call-leads | job_no, name, phone, `"Call lead"` | name, email, phone, sourceLabel |
| booked-leads | job_no, `"Booking"` | customer_name, snapshot, source, merchant |
| cancelled-leads | job_no, `"Cancellation"` | customer_name, reason, source |
| customers | full_name, phone, `"Customer"` | email, phone |
| agents | name, `"Agent"` | role, `"inactive"`/`"active"` |

## Response shape

```ts
{ groups: [{ record_type, items: [{ id, database_scope, primary_label, secondary_label, badges, href }] }] }
```

`database_scope` on each item tells the UI which DB to open when `combined` was requested.

## Skip / fail paths

- Empty / missing `q` → Zod fail
- No matches → `{ groups: [] }`
- Combined cap can hide extra historical hits after the flattened `limit`
- Does **not** filter Duplicate Leads, bad leads, or inactive agents (inactive is a badge only)

## Invariants

- Search is **read-only**.
- ObjectId lookup is exact; other matching is substring regex (no `normalizePhoneNumberForMatch`).
- Adding a searchable resource requires `AdminResource`, `SEARCH_CONFIGS`, `getAdminModels`, and usually browse/export configs.

## Related admin modules

| Module | Relationship |
|--------|----------------|
| `adminScope.service.ts` | Model resolution + `concreteScopes` |
| `adminBrowse.service.ts` | Paginated list/filter/detail. Form/Call **Source Company** filter is exact `source_granularity_key` (plus snapshot / catalog id). Historical scope (including the historical half of combined) also exact-matches catalog `company_slug` on the matching channel. Leftover `source_company` is bookmark compatibility only, exact (not substring), and loses when both params are present. |
| `adminFacets.service.ts` / `filterCatalog.ts` | Filter Catalog (`catalog`) plus compatibility arrays. `"facets"` invalidation evicts production **and** historical caches. Historical catalog attaches label snapshots onto the matching key row; overlay dedupes by `granularity_key` and drops company-slug options when a keyed child exists for that company. |
| `adminExport.service.ts` | CSV export |

## When to use search vs browse

- **Admin search (this doc):** jump by name, phone, job no, ref no, granularity key, or Mongo id across types.
- **Admin browse:** tables with pagination, sort, date range, Source Company (`source_granularity_key`), duplicate flag.
- **Extension lead browse:** [`lead-browse.md`](./lead-browse.md).
- **Extension POST search:** [`form-lead-search.md`](./form-lead-search.md), [`call-lead-search.md`](./call-lead-search.md).

Tests: `admin.service.test.ts` (`global admin search returns grouped results`).
