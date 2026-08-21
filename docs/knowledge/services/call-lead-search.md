---
type: Service
title: Call Lead Search
description: OR-based Call Lead lookup returning search summaries.
tags: [call-lead, search]
status: draft
stale_after: 2026-11-19
resource: src/services/search/callLeadSearch.service.ts
applies_to:
  - src/services/search/callLeadSearch.service.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/search/callLeadSearch.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:okf-docs-conversion
  at: 2026-08-21T02:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/search/callLeadSearch.service.ts`  
**Domain terms used:** [Call Lead](../../../../CONTEXT.md), [Caller Match Key](../../../../CONTEXT.md), [Job Number](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [Form Fill](../../../../CONTEXT.md)

# Call Lead Search

**Role:** Read-only **multi-criteria lookup** for Call Leads — returns up to N matching summaries sorted newest-first. Simpler than form search: no scoring, no `found`/`ambiguous` status.

**Not the same as:**

| Module | Purpose |
|--------|---------|
| `lead-browse.md` | Paginated browse (`GET /call-leads`) with `q`, attachment filters, population |
| `admin-search.md` | Admin cross-resource typeahead |
| Ring Central **Call Lead Ingestion** | Creates Call Leads; does not use this search |

**Legacy import:** `src/services/callLeadSearch.service.ts` re-exports this file. Prefer `src/services/search`.

## HTTP entry point

`POST /api/v1/call-leads/search` — body validated by `searchCallLeadsSchema`.

| Field | Notes |
|-------|-------|
| `phone_number`, `job_no`, `email`, `name` | At least one required |
| `first_name`, `last_name` | Accepted by schema but **not used** by search logic today |
| `limit` | 1–25, default 10 |

## Response

Flat array of `CallLeadSearchSummary` (not wrapped in status object):

`_id`, `timestamp`, `source_company`, `name`, `email`, `phone_number`, `normalized_phone_number`, `job_no`, location fields, `local`, `cubic_feet`, `booked`, `cancelled`, `createdAt`, `updatedAt`.

`summarizeCallLead()` is exported for reuse when mapping `CallLeadDocument` → summary shape.

## Filter logic

Each provided field adds a clause; **multiple fields combine with `$or`** (match any field, not all).

| Field | Match |
|-------|-------|
| `phone_number` | `normalized_phone_number` exact (via `normalizePhoneNumberForMatch`) **or** flexible digit regex on `phone_number` |
| `job_no` | Exact trim match |
| `email` | Exact lowercase trim |
| `name` | Case-insensitive regex with flexible internal whitespace (substring-style word sequence) |

If **no** usable fields after normalization → `{ _id: { $exists: false } }` (empty result set).

Does **not** filter Duplicate Leads — duplicate and non-duplicate Call Leads can both appear.

Sort: `{ createdAt: -1 }`.

## Search vs browse

| | POST search | GET browse |
|--|-------------|------------|
| Multi-field semantics | OR across provided fields | AND across query params |
| Empty criteria | Impossible (schema) | Lists latest leads |
| Duplicate filter | None | None |
| Booking/cancellation chips | IDs only on summary | Populated compact summaries |
| Pagination | Limit only | `skip` + `limit` (max 100) |

Use **search** when the extension has one or two identifiers and wants quick hits. Use **browse** for workspace list/filter UX.

## Invariants

- **Read-only** — no writes or side effects.
- Phone matching must go through `normalizePhoneNumberForMatch` + shared regex helpers — do not ad-hoc strip/format.
- OR semantics are intentional; switching to AND would break callers expecting broad match.
- Does not search `normalized_job_no` or RingCentral fields — only the columns listed above.

## Related modules

- Browse: `lead-browse.md`
- Call lead writes / duplicates: `call-lead.md`
- Phone utils: `utils/phone.ts`
