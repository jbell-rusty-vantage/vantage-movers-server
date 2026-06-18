# Call Lead Search (`search/callLeadSearch.service.ts`)

**Role:** Read-only **multi-criteria lookup** for call leads — returns up to N matching summaries sorted newest-first. Simpler than form search: no scoring, no `found`/`ambiguous` status.

**Not the same as:**

| Module | Purpose |
|--------|---------|
| `leadBrowse.service.md` | Paginated browse (`GET /call-leads`) with `q`, attachment filters, population |
| `adminSearch.service.md` | Admin cross-resource typeahead |
| RingCentral ingest | Creates call leads; does not use this search |

**Legacy import:** `api/services/callLeadSearch.service.ts` re-exports this file. Prefer `api/services/search`.

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

Does **not** filter `duplicate` — duplicate and non-duplicate call leads can both appear.

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

- Browse: `leadBrowse.service.md`
- Call lead writes / duplicates: `call-lead.service.md`
- Phone utils: `utils/phone.ts`
