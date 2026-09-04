---
type: Service
title: Call Lead Search
description: OR-based Call Lead lookup returning search summaries.
tags: [call-lead, search]
status: draft
stale_after: 2026-11-20
resource: src/services/search/callLeadSearch.service.ts
applies_to:
  - src/services/search/callLeadSearch.service.ts
  - src/utils/phone.ts
  - src/validation/v1/leads.validation.ts
  - src/routes/v1.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/search/callLeadSearch.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-09-04T20:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/search/callLeadSearch.service.ts`  
**Domain terms used:** [Call Lead](../../../../CONTEXT.md), [Caller Match Key](../../../../CONTEXT.md), [Job Number](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md)

# Call Lead Search

**Role:** Read-only **multi-criteria lookup** for Call Leads — newest-first summaries, no scoring, no `found`/`ambiguous` wrapper.

**Not the same as:**

| Module | Purpose |
|--------|---------|
| [`lead-browse.md`](./lead-browse.md) | Paginated browse (`GET /call-leads`) with `q`, attachment filters, populate |
| [`admin-search.md`](./admin-search.md) | Admin cross-resource typeahead |
| Ring Central **Call Lead Ingestion** | Creates Call Leads; does not call this search |

**Legacy import:** `src/services/callLeadSearch.service.ts` re-exports this file. Prefer `src/services/search`.

## HTTP entry point

`POST /api/v1/call-leads/search` → `searchCallLeadsSchema` → `searchCallLeads`. Route wraps `{ ok, data }`.

| Field | Notes |
|-------|-------|
| `phone_number`, `job_no`, `email`, `name` | Fields the filter uses |
| `first_name`, `last_name` | Schema refine accepts them. **Filter ignores them.** Name-part-only → empty filter `{ _id: { $exists: false } }` → `[]` |
| `email` | `looseEmailString` |
| `limit` | 1–25, default 10 (`Math.min(Math.max(limit ?? 10, 1), 25)`) |

No `include_duplicates` flag. Duplicate and non-duplicate Call Leads both appear.

## Response

Flat `CallLeadSearchSummary[]` (not a status object):

`_id`, `timestamp`, `source_company`, `name`, `email`, `phone_number`, `normalized_phone_number`, `job_no`, pickup/delivery city/zip/state, `local`, `cubic_feet`, `booked`, `cancelled`, `createdAt`, `updatedAt`.

`summarizeCallLead()` is the mapper. Booking/cancellation stay raw refs (ids), not populated chips.

## Happy path

```
build $or clauses → 0 clauses? { _id: { $exists: false } }
                 → 1 clause? that clause (not wrapped)
                 → else { $or: clauses }
CallLead.find(filter).sort({ createdAt: -1 }).limit(limit) → map summaries
```

## Filter clauses (`$or` across provided fields)

| Field | Match |
|-------|-------|
| `phone_number` | `normalizePhoneNumberForMatch` → **undefined when fewer than 8 digits**. Else `$or` across `CALL_LEAD_CONTACT_PHONE_PATHS` (live + ingested + Granot): exact on `*normalized_phone_number`, digit-flex regex on the other phone paths |
| `job_no` | Exact trim on `job_no` only — **not** `normalized_job_no` |
| `email` | Exact lowercase trim `$or` across `CALL_LEAD_CONTACT_EMAIL_PATHS` |
| `name` | Trim + collapse whitespace (**not** lowercased). Unanchored word-sequence regex (`word\s+word`, `/i`) `$or` across `CALL_LEAD_CONTACT_NAME_PATHS` |

Name is looser than form search (form name is anchored `^…$` after lowercase).

## Skip / fail paths

- Schema-legal `first_name`/`last_name` only → empty clauses → guaranteed empty list
- Phone with fewer than 8 digits after `normalizePhoneNumberForMatch` → no phone clause (form search still uses a 7-or-more-digit regex)
- All provided identity strings empty after trim → empty list
- Filter builder tests live in `callLeadSearch.service.test.ts`. Schema tests live in `v1.validation.test.ts`.

## Search vs browse

| | POST search | GET browse |
|--|-------------|------------|
| Multi-field semantics | OR across provided fields | AND across query params |
| Empty criteria | Schema requires a field; unused first/last still yield `[]` | Lists latest leads |
| Duplicate filter | None | None |
| Booking/cancellation | Raw ids on summary | Populated compact summaries |
| Pagination | Limit only | `skip` + `limit` (max 100) |

## Invariants

- **Read-only** — no writes or side effects.
- Phone matching must go through `normalizePhoneNumberForMatch` + the shared digit-flex regex.
- OR semantics are intentional; switching to AND would shrink extension hits.
- Does not search `normalized_job_no`, RingCentral nested fields, or source snapshots. Summaries stay live **Called** fields. Processor identity still omits Call snapshot phone.

## Related modules

- Browse: [`lead-browse.md`](./lead-browse.md)
- Call writes / duplicates: [`call-lead.md`](./call-lead.md)
- Phone utils: `src/utils/phone.ts`
