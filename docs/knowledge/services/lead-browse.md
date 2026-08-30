---
type: Service
title: Lead Browse
description: Extension GET browse for form and call leads with pagination and attachment chips.
tags: [search, form-lead, call-lead]
status: draft
stale_after: 2026-11-20
resource: src/services/search/formLeadBrowse.service.ts
applies_to:
  - src/services/search/formLeadBrowse.service.ts
  - src/services/search/callLeadBrowse.service.ts
  - src/services/search/leadBrowseShared.ts
  - src/validation/v1/leads.validation.ts
  - src/routes/v1.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/search/formLeadBrowse.service.ts
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
**Primary code:** `src/services/search/formLeadBrowse.service.ts`, `callLeadBrowse.service.ts`, `leadBrowseShared.ts`  
**Domain terms used:** [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md), [Admin Dashboard (extension search workspace)](../../../../CONTEXT.md)

# Lead Browse

**Role:** Read-only **paginated list** for the Granot extension Search workspace. Every filter is optional — empty query returns the newest leads. Populates Booking + Cancellation + receiver-agent for chips without extra round trips.

**Shared helpers:** `search/leadBrowseShared.ts`.

**Distinct from scored search:** [`form-lead-search.md`](./form-lead-search.md) / [`call-lead-search.md`](./call-lead-search.md).

## HTTP entry points

| Route | Service | Schema |
|-------|---------|--------|
| `GET /api/v1/form-leads` | `browseFormLeads` | `browseFormLeadsQuerySchema` |
| `GET /api/v1/call-leads` | `browseCallLeads` | `browseCallLeadsQuerySchema` |

Schemas are `.strict()` — unknown keys 400 (tested). Defaults: `limit` 50 (max 100), `skip` 0. `booked` / `cancelled` coerce from query strings.

| Param | Notes |
|-------|-------|
| `q` | Loose substring across identifying + source-snapshot fields. Form `q` also hits ingested and Granot snapshot contact paths |
| `source_company` | Standalone **exact** match (case-insensitive) on slug **or** three label snapshots |
| `lead_source_company` | `objectIdSchema` — exact `{ lead_source_company }` (not regex) |
| `source_granularity_key` | Anchored exact (`fieldEqualsClause`) |
| `name`, `email`, `phone_number` | Per-field substring |
| `job_no` | Call browse only — substring on `job_no` |
| `booked`, `cancelled` | Boolean attachment presence |

All provided filters are **ANDed** (`combineClauses` → `$and`). Empty clause list → `{}` (view all).

## Happy path

```
build AND filter → Promise.all(
  Model.find(filter).sort({ createdAt: -1 }).skip.limit
    .populate(booked, cancelled, receiver_agent)
    .lean(),
  Model.countDocuments(filter)
) → map cards
```

## Full-text `q`

Case-insensitive substring (`fullTextClause`) on:

| Lead type | Fields |
|-----------|--------|
| Form | Live + ingested + Granot contact name / email / phone paths (`FORM_LEAD_CONTACT_NAME_PATHS` / `EMAIL` / `PHONE` in `leadBrowseShared.ts`), then `source_company`, three label snapshots, `ref_no` |
| Call | live name / email / phone, `source_company`, three label snapshots, `job_no` (no `ref_no`, no contact snapshots) |

## Field-specific filters

| Filter | Behavior |
|--------|----------|
| `source_company` | `$or` of anchored exact on `source_company`, `source_company_label_snapshot`, `source_granularity_label_snapshot`, `crm_source_label_snapshot` — **not** slug-only |
| `lead_source_company` | Exact ObjectId string |
| `source_granularity_key` | Anchored exact |
| `name` | Form: substring `$or` on `FORM_LEAD_CONTACT_NAME_PATHS` (live + ingested + Granot). Call: `name` / `first_name` / `last_name` |
| `email` | Form: lowercase input, substring `$or` on `FORM_LEAD_CONTACT_EMAIL_PATHS`. Call: substring on `email` |
| `phone_number` | Form: typed-substring `$or` on `FORM_LEAD_CONTACT_PHONE_PATHS` (not `normalizePhoneNumberForMatch`, not scored digit-flex). Call: substring on `phone_number` |
| `job_no` | Substring on `job_no` (call only) |
| `booked: true` | `{ booked: { $ne: null, $exists: true } }` |
| `booked: false` | null or missing |
| `cancelled: true/false` | Same pattern on `cancelled` |

## Response shape

```ts
{ results: [...], count: number }
```

`count` = matching documents (same filter, no skip/limit).

### Result card fields

Shared: `_id`, source slug + `lead_source_company` + `source_granularity_key` + three label snapshots, name parts, email, phone, pickup/delivery location, `cubic_feet`, `createdAt`, `receiver_agent_name_snapshot`, `receiver_agent_granot_crm_username` (from populated `receiver_agent.granot_crm_username`), `booked`, `cancelled`.

**Form only:** `ref_no`, `quoted`, `destination_zip` (not `delivery_zip`).  
**Call only:** `job_no`, `delivery_zip`. No `quoted`, no `local` on the card.

Populate selects:

| Ref | Select | Summary |
|-----|--------|---------|
| `booked` | `job_no book_date cancelled` | `LeadBookingSummary` (`cancelled` stringified or null) |
| `cancelled` | `cancel_date reason job_no` | `LeadCancellationSummary` |
| `receiver_agent` | `granot_crm_username` | Username only on the card |

Unpopulated or missing `_id` on a ref → `null` chip (`toBookingSummary` / `toCancellationSummary`).

Form cards stay live-field cards. `ingested_contact_snapshot` and `granot_contact_snapshot` are not projected onto `FormLeadBrowseResult`.

## Shared helpers (do not duplicate)

| Helper | Purpose |
|--------|---------|
| `fieldContainsClause` | Case-insensitive substring |
| `fieldEqualsClause` | Anchored exact |
| `fullTextClause` | `$or` regex across field list |
| `attachmentClause` | Booked/cancelled presence |
| `combineClauses` | `{}` / single clause / `$and` |
| `toBookingSummary` / `toCancellationSummary` | Lean-doc → chip |
| `FORM_LEAD_CONTACT_NAME_PATHS` / `EMAIL` / `PHONE` | Shared any-known-contact paths. Admin browse, Admin typeahead, Form browse, and Owner Form candidate `q` (`browseCandidateLeadViews`) import these. Match style stays per surface. |

## Skip / fail paths

- Unknown query keys fail Zod (tested)
- Empty `{}` is valid — latest leads
- Schema coverage is `v1.validation.test.ts`. Form browse filter + card-shape tests are `formLeadBrowse.service.test.ts`

## Browse vs search vs admin

| | Lead browse (this doc) | POST lead search | Admin search |
|--|------------------------|------------------|--------------|
| Audience | Extension Search workspace | Extension identify / CSV / Granot-match fallback | Observational admin UI |
| Pagination | `skip`/`limit` + `count` | Limit only | Per-type cap |
| Duplicate form leads | **Included** | Excluded by default | Included |
| Source labels | `q` + `source_company` hit snapshots | No | Search fields include snapshots |
| Historical DB | Production only | Production only | Optional scope | // pragma: allowlist secret

## Invariants

- **Read-only** — never write Mongo or enqueue sheet sync.
- Empty filter `{}` is the extension “view all”.
- Browse AND ≠ POST call search OR.
- Keep populate selects minimal.
- Form and call browse stay parallel — shared behavior belongs in `leadBrowseShared.ts`.

## Related modules

- POST search: [`form-lead-search.md`](./form-lead-search.md), [`call-lead-search.md`](./call-lead-search.md)
- Admin list/detail: [`admin-search.md`](./admin-search.md) + `admin/adminBrowse.service.ts`
- Barrel: `src/services/search/index.ts`
