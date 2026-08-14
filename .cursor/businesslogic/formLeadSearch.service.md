**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Authority:** [Final Granot Lead Lifecycle specification](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) for Granot identity
**Primary code:** `api/services/search/formLeadSearch.service.ts`  
**Domain terms used:** Form Lead, Lead ID, Granot Form Reference, Tracking Reference, Duplicate Lead, Form Lead Enrichment

# Form Lead Search

**Role:** Read-only **identity resolution** for Form Leads — find one lead from partial identifiers with scored confidence and explicit ambiguity handling. Backs Granot extension smart search and Granot CSV sync fallback matching after stronger exact identity paths do not resolve a Lead.

**Not the same as:**

| Module | Purpose |
|--------|---------|
| `leadBrowse.service.md` | Paginated list/browse (`GET /form-leads`) — optional filters, no scoring |
| `adminSearch.service.md` | Cross-resource admin typeahead (`GET /admin/search`) |

**Legacy import:** `api/services/formLeadSearch.service.ts` re-exports this file. Prefer `api/services/search`.

## HTTP entry point

`POST /api/v1/form-leads/search` — body validated by `searchFormLeadsSchema`.

| Field | Notes |
|-------|-------|
| `ref_no`, `name`, `email`, `phone_number` | At least one required |
| `first_name`, `last_name` | Accepted by schema but **not used** by search logic today |
| `limit` | 1–25, default 10 |
| `include_duplicates` | Default `false` — excludes **Duplicate Lead** quarantine rows |

## Response status

| Status | `found` | Meaning |
|--------|---------|---------|
| `found` | `true` | Single best match; includes full `lead` + `best_match` |
| `not_found` | `false` | No candidates, no usable fields, or zero score after pull |
| `ambiguous` | `false` | Top two matches share the same score — caller must add another identifier |

Ambiguous message (extension): *“Add another identifier before updating quoted.”*

## Algorithm

```
normalize input → build candidate $or filter → Mongo find (newest first, limit)
        → score each candidate in memory → sort by score, then createdAt
        → 0 matches: not_found
        → tie on top score: ambiguous
        → else: found (best_match)
```

### Normalization

| Field | Rule |
|-------|------|
| `ref_no` | Trim; ignore `"not provided"` (case-insensitive) — current Granot Form Reference is the **Tracking Reference**; a Mongo Lead ID-shaped value is historical compatibility evidence |
| `name` | Trim, collapse whitespace, lowercase |
| `email` | Trim, lowercase (`looseEmailString` at API — not strict RFC) |
| `phone_number` | Trim; derive `phone_digits` (digits only) for matching |

### Candidate Mongo filter (`$or`)

Any supplied field can pull a candidate:

- `ref_no` — exact string
- `email` — exact
- `phone_number` — exact **or** digit-flex regex when ≥ 7 digits
- `name` — anchored whole-name regex (`^name$`, case-insensitive, flexible whitespace)

Default query also adds `{ duplicate: { $ne: true } }` unless `include_duplicates: true`.

### Scoring (`FIELD_WEIGHTS`)

| Field | Weight |
|-------|--------|
| `ref_no` | 100 |
| `email` | 40 |
| `phone_number` | 35 |
| `name` | 15 |

Score = sum of weights for fields that **exactly** match after normalization. Candidates with `score === 0` are dropped.

### Confidence label

| Condition | Confidence |
|-----------|------------|
| Matched `ref_no` or score ≥ email + phone | `high` |
| Score ≥ phone alone or ≥ email alone | `medium` |
| Else | `low` |

Confidence is informational; **`found` vs `ambiguous` is score-tie only**.

## Internal callers

| Caller | Usage |
|--------|-------|
| Granot CSV sync (`granotCrmCsv/sync.service.ts`) | Contact fallback after exact `FormLead.ref_no` and Mongo ID compatibility do not resolve — phone + email + name; `ambiguous` → sync conflict |

## Invariants

- **Read-only** — never mutate Mongo or trigger **Sheet Sync**.
- Duplicate exclusion is **search-only**; browse lists include Duplicate Leads unless filtered elsewhere.
- Do not loosen ambiguity rules for quoted/extension updates without owner sign-off.
- Scoring runs in memory after a broad `$or` pull — changing weights or tie logic affects extension + CSV sync.

## Related modules

- Browse/list UI: `leadBrowse.service.md`
- Form lead writes: `form-lead.service.md`
- Tests: `formLeadSearch.service.test.ts` (duplicate filter default)
