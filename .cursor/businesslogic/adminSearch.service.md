**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md)
**Primary code:** `api/services/admin/adminSearch.service.ts`  
**Domain terms used:** Admin Dashboard, Workflow Observational, Lead ID, Form Lead, Call Lead, Booking, Cancellation, System of Record

# Admin Search Service

**Role:** Cross-resource typeahead / global search for the **Admin Dashboard**. Read-only Mongo lookups; no mutations, **Sheet Sync**, or **CRM Posting**.

**Entry:** `GET /api/v1/admin/search?q=...&database_scope=...&limit=...` → `globalAdminSearch`.

## Query parameters (`AdminSearchQuery`)

| Param | Default | Notes |
|-------|---------|-------|
| `q` | required | Trimmed, min length 1; case-insensitive regex match |
| `database_scope` | `production` | `production` \| `historical` \| `combined` |
| `limit` | `5` | Per resource type, per concrete scope; max 25 |

Unlike browse (`adminBrowse.service.ts`), search has no pagination, date filters, or facet filters — only free-text `q`.

## Database scope

Resolved via `adminScope.service.ts`:

| `database_scope` | Behavior |
|------------------|----------|
| `production` | Live Mongoose models (`FormLead`, `CallLead`, etc.) |
| `historical` | Historical collections via `registerHistoricalModels()` |
| `combined` | Runs search in **both** scopes; results tagged with `database_scope` on each item |

Detail endpoints reject `combined`; search is one of the few places that supports it.

## Search algorithm

For each of 6 resource types, in parallel:

1. Expand scope → one or two concrete scopes (`production`, `historical`).
2. Per scope: build Mongo filter:
   - If `q` is valid ObjectId → `{ _id: ObjectId(q) }` **or**
   - Regex `$or` across configured string fields (escaped special chars)
3. `find(filter).sort({ createdAt: -1 }).limit(limit).lean()`
4. Map docs → `AdminSearchItem` (labels, badges, admin UI `href`)
5. Flatten scopes, **slice to `limit`** per resource type
6. Return only groups with `items.length > 0`

No cross-resource ranking — each type is capped independently. Empty groups are omitted from the response.

## Resources and indexed fields

| Resource | Search fields | Admin `href` | Badges |
|----------|---------------|--------------|--------|
| `form-leads` | name, email, phone_number, source_company, ref_no, lid | `/form-leads/:id` | booked/unbooked, cancelled |
| `call-leads` | name, email, phone_number, normalized_phone_number, source_company, job_no | `/call-leads/:id` | booked/unbooked, cancelled |
| `booked-leads` | job_no, normalized_job_no, customer_name, customer_name_snapshot, source, merchant, agent_allocations.agent_name_snapshot | `/bookings/:id` | booked, cancelled |
| `cancelled-leads` | job_no, normalized_job_no, customer_name, reason, cancelled_by, source, merchant, agent | `/cancellations/:id` | cancelled |
| `customers` | full_name, normalized_name, phone_number, email | `/customers/:id` | customer |
| `agents` | name, normalized_name, role | `/agents/:id` | active/inactive, agent |

**Labels:** `primary_label` / `secondary_label` use first non-empty string among configured doc fields (`label()` helper). Resource-specific primary/secondary precedence is in `SEARCH_CONFIGS`.

## Response shape

```ts
{ groups: [{ record_type, items: [{ id, database_scope, primary_label, secondary_label, badges, href }] }] }
```

`database_scope` on each item tells the UI which DB to open when `combined` was requested.

## Invariants

- Search is **read-only** — never write Mongo or trigger side effects.
- ObjectId lookup is exact; all other matching is substring regex (not normalized phone logic beyond indexed fields).
- Does **not** filter out duplicates, bad leads, or shadow records — whatever matches in the collection is returned.
- Adding a searchable resource requires updates to `AdminResource`, `SEARCH_CONFIGS`, `getAdminModels`, and likely browse/export configs elsewhere.

## Related admin modules

| Module | Relationship |
|--------|----------------|
| `adminScope.service.ts` | Model resolution + `concreteScopes` |
| `adminBrowse.service.ts` | Paginated list/filter/detail (richer filters, duplicate toggle) |
| `adminFacets.service.ts` | Filter option counts |
| `adminExport.service.ts` | CSV export |

## When to use search vs browse

- **Admin search (this doc):** quick jump by name, phone, job no, ref no, or Mongo id across all entity types.
- **Admin browse:** filtered tables with pagination, sort, date range, source company, duplicate flag, etc. (`adminBrowse.service.ts`).
- **Extension lead browse:** paginated form/call lists for the Granot extension Search workspace — `leadBrowse.service.md`.
- **Extension lead search (POST):** scored form identity resolution or call OR-search — `formLeadSearch.service.md`, `callLeadSearch.service.md`.
