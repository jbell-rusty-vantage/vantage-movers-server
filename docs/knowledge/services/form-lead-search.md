---
type: Service
title: Form Lead Search
description: Scored Form Lead identity search with ambiguity handling and duplicate quarantine.
tags: [form-lead, search]
status: draft
stale_after: 2026-11-20
resource: src/services/search/formLeadSearch.service.ts
applies_to:
  - src/services/search/formLeadSearch.service.ts
  - src/validation/v1/leads.validation.ts
  - src/routes/v1.routes.ts
  - src/services/granotCrmCsv/sync.service.ts
  - src/services/granotHttpCollector/granotFormLeadMatcher.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/search/formLeadSearch.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T04:51:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [Final Granot Lead Lifecycle specification](../../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) for Granot identity  
**Primary code:** `src/services/search/formLeadSearch.service.ts`  
**Domain terms used:** [Form Lead](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md), [Granot Form Reference](../../../../CONTEXT.md), [Tracking Reference](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md)

# Form Lead Search

**Role:** Read-only **identity resolution** for Form Leads — pull a bounded candidate set, score in memory, return one lead or an explicit miss/tie. Backs Granot extension smart search and contact fallback after stronger identity paths miss.

Scored search still ignores ingested and Granot contact snapshots. Extension Form browse, Admin browse, and Admin typeahead are the any-known-contact surfaces.

**Not the same as:**

| Module | Purpose |
|--------|---------|
| [`lead-browse.md`](./lead-browse.md) | Paginated list (`GET /form-leads`) — optional filters, no scoring |
| [`admin-search.md`](./admin-search.md) | Cross-resource admin typeahead |
| `POST /api/v1/form-leads/granot-match` | `resolveGranotFormLead` — exact **Tracking Reference**, then Mongo id, then this search as fallback |

**Legacy import:** `src/services/formLeadSearch.service.ts` re-exports this file. Prefer `src/services/search`.

## HTTP entry point

`POST /api/v1/form-leads/search` → `searchFormLeadsSchema` → `searchFormLeads`. Route wraps `{ ok, data }`.

| Field | Notes |
|-------|-------|
| `ref_no`, `name`, `email`, `phone_number` | Identity fields the scorer uses |
| `first_name`, `last_name` | Schema refine accepts them (`requireAtLeastOneTruthySearchField`). **Search ignores them.** Name-only first/last → `not_found` after normalize. Refine error text still says “ref_no, name, email, or phone_number” (known gap vs the function). |
| `email` | `looseEmailString` — not RFC-strict (typo emails pass) |
| `limit` | 1–25, default 10. Service also `clampSearchLimit` (trunc, same bounds) |
| `include_duplicates` | Default `false` — `{ duplicate: { $ne: true } }` |

## Response status

| Status | `found` | Meaning |
|--------|---------|---------|
| `found` | `true` | Unique top score; `lead` + `best_match` + all scored `matches` |
| `not_found` | `false` | No usable fields after normalize, empty `$or`, or every pulled candidate scores 0 |
| `ambiguous` | `false` | Top two scored matches share the same score |

Ambiguous message (verbatim): `Multiple form leads matched with the same confidence. Add another identifier before updating quoted.`

`not_found` with no usable fields: `No usable form lead search fields were provided.`  
`not_found` after a pull: `No form lead matched the supplied \`field\`, …`.

## Happy path

```
normalize → searched_fields empty? not_found
         → build $or (null? not_found)
         → FormLead.find($or + optional duplicate exclude)
              .sort({ createdAt: -1 }).limit(limit)
         → score each candidate; drop score === 0
         → sort score desc, then createdAt desc
         → 0 matches: not_found
         → top two scores equal: ambiguous
         → else found
```

**Mongo `limit` runs before scoring.** The newest `limit` `$or` hits are the only scored set. An older exact `ref_no` can lose to newer email/phone hits when both fields are supplied.

## Normalization

| Field | Rule |
|-------|------|
| `ref_no` | Trim; drop `"not provided"` (case-insensitive). No ObjectId special-case in this service — exact string only |
| `name` | Trim, collapse whitespace, lowercase |
| `email` | Trim, lowercase |
| `phone_number` | Trim; `phone_digits` = digits only |

## Candidate `$or`

Any supplied field can pull a row:

- `ref_no` — exact string
- `email` — exact lowercase
- `phone_number` — exact submitted string
- `phone_digits` length ≥ 7 — digit-flex regex on `phone_number` (`(?:^|\D)d\D*…(?:\D|$)`)
- `name` — anchored whole-name regex (`^word\s+word$`, case-insensitive)

Default query adds `{ duplicate: { $ne: true } }` unless `include_duplicates: true` (tested).

## Scoring (`FIELD_WEIGHTS`)

| Field | Weight | Match after normalize |
|-------|--------|------------------------|
| `ref_no` | 100 | `lead.ref_no.trim() === criteria.ref_no` |
| `email` | 40 | lowercase equality |
| `phone_number` | 35 | digit-string equality (`phone_digits`) |
| `name` | 15 | lowercase collapsed-whitespace equality |

Score 0 rows are dropped (a candidate can be pulled by formatted phone and still fail digit scoring).

### Confidence (informational)

| Condition | Confidence |
|-----------|------------|
| Matched `ref_no` **or** score ≥ email + phone (75) | `high` |
| Score ≥ phone (35) or ≥ email (40) | `medium` |
| Else | `low` |

`found` vs `ambiguous` is **score-tie only**. Confidence does not break ties.

## Skip / fail paths

- First/last name only (schema-legal) → no criteria → `not_found`
- `"not provided"` `ref_no` only → unused → `not_found`
- Phone with fewer than 7 digits: no regex clause; exact string clause still pulls; scoring still uses whatever digits exist
- Duplicate quarantine excluded unless `include_duplicates`
- Score tie on the top two → `ambiguous` (do not pick newest)

## Internal callers (not the POST /search contract)

| Caller | How it uses `searchFormLeads` |
|--------|-------------------------------|
| `granotCrmCsv/sync.service.ts` `resolveFormLead` | If Granot `ref_no` is `mongoose.isValidObjectId`, **skips search** and treats the string as `leadId`. Else phone + email + name, limit 10. `found` → that id; `ambiguous` → sync `conflict`; else `no_match`. **No exact `FormLead.ref_no` lookup here.** |
| `granotHttpCollector/granotFormLeadMatcher.ts` / `POST /form-leads/granot-match` | Exact non-duplicate `ref_no`, then Mongo `_id` (`isObjectIdString`). Fallback **requires phone or email**, then `searchFormLeads` (limit 25, duplicates off). Matcher then source-gates by `resolveSourceCompanyFromLabel` and may use Granot `prior` `0`/`1`/`5` to break quoted ties. Ambiguous after that gate → `conflict`. |
| Best Relocation ingest script | HTTP client of `POST /form-leads/search` |

## Invariants

- **Read-only** — never mutate Mongo or enqueue **Sheet Sync**.
- Duplicate exclusion is search-only; browse includes Duplicate Leads.
- Do not loosen score-tie `ambiguous` for quoted/extension updates without owner sign-off.
- Changing weights, the pre-score Mongo cap, or tie logic affects extension search, CSV fallback, and Granot HTTP match fallback.

## Related modules

- Browse: [`lead-browse.md`](./lead-browse.md)
- Form writes: [`form-lead.md`](./form-lead.md)
- Tests: `formLeadSearch.service.test.ts` (duplicate filter on/off); `v1.validation.test.ts` (`include_duplicates`, loose email)
