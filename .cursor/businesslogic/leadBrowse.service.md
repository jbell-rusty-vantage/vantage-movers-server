---
type: Service
title: Lead Browse
description: Extension GET browse for form and call leads with pagination and attachment chips.
tags: [search, form-lead, call-lead]
status: draft
stale_after: 2026-11-19
resource: src/services/search/formLeadBrowse.service.ts
applies_to:
  - src/services/search/formLeadBrowse.service.ts
  - src/services/search/callLeadBrowse.service.ts
  - src/services/search/leadBrowseShared.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/search/formLeadBrowse.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:okf-docs-conversion
  at: 2026-08-21T02:20:00Z
---
**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/search/formLeadBrowse.service.ts`, `callLeadBrowse.service.ts`, `leadBrowseShared.ts`  
**Domain terms used:** [Form Lead](../../../CONTEXT.md), [Call Lead](../../../CONTEXT.md), [Lead ID](../../../CONTEXT.md), [Admin Dashboard (extension search workspace)](../../../CONTEXT.md)

# Lead Browse

**Role:** Read-only **paginated list/browse** for the Granot extension Search workspace. Every filter is optional — empty query returns the latest leads. Populates Booking + Cancellation refs for attachment chips without extra round trips.

**Shared helpers:** `search/leadBrowseShared.ts` (filter builders, summary mappers, populate selects).

**Distinct from scored search:** `formLeadSearch.service.md` / `callLeadSearch.service.md` (POST identity resolution).

## HTTP entry points

| Route | Service |
|-------|---------|
| `GET /api/v1/form-leads` | `browseFormLeads` |
| `GET /api/v1/call-leads` | `browseCallLeads` |

Query schemas: `browseFormLeadsQuerySchema`, `browseCallLeadsQuerySchema`.

| Param | Default | Max | Notes |
|-------|---------|-----|-------|
| `limit` | 50 | 100 | Page size |
| `skip` | 0 | — | Offset |
| `q` | — | — | Loose full-text substring across identifying fields |
| `source_company` | — | — | Standalone exact match (case-insensitive) |
| `name`, `email`, `phone_number` | — | — | Per-field substring filters |
| `job_no` | — | — | Call browse only |
| `booked`, `cancelled` | — | — | Boolean attachment presence |

All provided filters are **ANDed** (`combineClauses` → `$and`).

## Full-text `q`

| Lead type | Fields searched |
|-----------|-----------------|
| Form | `name`, `first_name`, `last_name`, `email`, `phone_number`, `source_company`, `ref_no` |
| Call | `name`, `first_name`, `last_name`, `email`, `phone_number`, `source_company`, `job_no` |

Case-insensitive substring regex on each field (`fullTextClause`).

## Field-specific filters

| Filter | Behavior |
|--------|----------|
| `source_company` | Anchored exact match `^value$` (case-insensitive) — not substring |
| `name` | Substring on `name`, `first_name`, or `last_name` (`$or`) |
| `email` | Substring on `email` (lowercased input) |
| `phone_number` | Substring on `phone_number` |
| `job_no` | Substring on `job_no` (call only) |
| `booked: true` | `{ booked: { $ne: null, $exists: true } }` |
| `booked: false` | null or missing |
| `cancelled: true/false` | Same pattern on `cancelled` |

## Response shape

```ts
{ results: [...], count: number }
```

`count` = total matching documents (same filter, no skip/limit).

### Result card fields

**Form:** `_id`, contact/source fields, `ref_no`, `quoted`, `cubic_feet`, `createdAt`, `booked`, `cancelled`.

**Call:** same minus `ref_no`/`quoted`; includes `job_no`.

### Attachment summaries (`leadBrowseShared.ts`)

Populated with minimal selects:

| Ref | Select fields | Summary type |
|-----|---------------|--------------|
| `booked` | `job_no`, `book_date`, `cancelled` | `LeadBookingSummary` |
| `cancelled` | `cancel_date`, `reason`, `job_no` | `LeadCancellationSummary` |

Unpopulated or broken refs → `null` on the result row.

## Shared helpers (do not duplicate)

| Helper | Purpose |
|--------|---------|
| `fieldContainsClause` | Case-insensitive substring on one field |
| `fieldEqualsClause` | Anchored exact match (used for `source_company`) |
| `fullTextClause` | `$or` regex across field list |
| `attachmentClause` | Booked/cancelled presence |
| `combineClauses` | `{}` if empty, single clause, else `$and` |
| `toBookingSummary` / `toCancellationSummary` | Safe lean-doc → chip shape |

## Browse vs search vs admin

| | Lead browse (this doc) | POST lead search | Admin search |
|--|------------------------|------------------|--------------|
| Audience | Extension Search workspace | Extension identify / CSV fallback | Observational admin UI |
| Pagination | Yes (`skip`/`limit`) | Limit only | Per-type cap |
| Duplicate form leads | **Included** | Excluded by default in form search | Included |
| Ambiguity | N/A | Form search only | N/A |
| Historical DB | Production only | Production only | Optional scope |

## Invariants

- **Read-only** — never write Mongo or enqueue sheet sync.
- Empty filter `{}` is valid — returns latest leads (extension “view all”).
- Browse AND semantics differ from POST call search OR semantics — document changes carefully.
- Keep populate selects minimal; expand only if extension UI needs more booking/cancellation fields.
- Form and call browse should stay parallel — shared behavior belongs in `leadBrowseShared.ts`.

## Related modules

- Form/call POST search: `formLeadSearch.service.md`, `callLeadSearch.service.md`
- Admin list/detail: `adminSearch.service.md` + `admin/adminBrowse.service.ts`
- Barrel: `src/services/search/index.ts`
