---
type: Service
title: Testimonial Service
description: Read-only public and admin testimonials; ingest stays in helpers and ops scripts.
tags: [testimonial, main-site]
status: draft
stale_after: 2026-11-20
resource: src/services/testimonials/testimonial.service.ts
applies_to:
  - src/services/testimonials/testimonial.service.ts
  - src/services/testimonials/testimonial.helpers.ts
  - src/validation/v1/testimonials.validation.ts
  - src/routes/v1.routes.ts
  - src/models/Testimonial.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/testimonials/testimonial.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T05:53:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Primary code:** `src/services/testimonials/testimonial.service.ts`  
**Domain terms used:** [Main Site (marketing consumer)](../../../../CONTEXT.md)

# Testimonial Service

**System of Record:** MongoDB `testimonials` — curated review content for the public marketing site (**Main Site**) and Owner/admin browse.

**Role:** Read-only list and admin detail. **No create/update/delete routes.** Documents are loaded externally (scripts/ops) using `testimonial.helpers.ts`.

## HTTP entry points

All of these sit behind the `/api/v1` `x-api-secret` guard (`v1.routes.ts`). No Owner actor gate.

| Route | Handler |
|-------|---------|
| `GET /api/v1/testimonials` | `listTestimonials` |
| `GET /api/v1/admin/testimonials` | `listAdminTestimonials` |
| `GET /api/v1/admin/testimonials/reviewer-names` | `listAdminTestimonialReviewerNames` |
| `GET /api/v1/admin/testimonials/:id` | `getAdminTestimonial` (404 `Testimonial not found`) |

The marketing-site client (`vantage-movers-clients`) is not in this checkout. Do not treat its `limit`, revalidate, or empty-array fallback as this service’s contract.

## Public list (`listTestimonialsQuerySchema`)

| Param | Default | Effect |
|-------|---------|--------|
| `page` | `1` | 1-based |
| `limit` | `20` | Max 100 |
| `source` | — | `TESTIMONIAL_SOURCES` enum (currently `BBB` only) |
| `published` | — | Applied only when provided |
| `featured` | — | Applied only when provided |

`buildTestimonialFilter` starts as `{}`. Omitted flags are not applied. Sort is always `review_date` desc, then `createdAt` desc. Response: `{ items, page, limit, total, has_next_page }`.

`has_next_page` is `skip + docs.length < total`.

### Public projection (`TestimonialListItem`)

Exposed: `id`, `source`, `reviewer_name`, `review_date`, `rating`, `review_text`, `business_response`, `published`, `featured`.

**Not exposed:** `content_fingerprint`, `normalized_reviewer_name`, `source_company`, `customer`, timestamps.

`published` / `featured` in the DTO are strict `=== true` (missing/false → false). `business_response` requires both `responded_at` and `text` or it becomes `null`.

## Admin list (`adminTestimonialsQuerySchema`)

Adds `q` (case-insensitive regex on `reviewer_name` **or** `normalized_reviewer_name`; regex is escaped), exact `reviewer_name`, `rating` 1–5, `customer` ObjectId, `from` / `to` on `review_date`, `sort` (`review_date` only), `direction` (`asc`/`desc`, default `desc`). Default `limit` 50, max 250.

Admin find `.populate("customer", "full_name phone_number email")`. Extra DTO fields: `source_company`, `customer { id, full_name, phone_number, email }`, `createdAt`, `updatedAt`. Unpopulated ObjectId/string customer yields empty name/phone/email.

Reviewer-names: `distinct("reviewer_name")` excluding null/empty, trim, drop blanks, `localeCompare` base sensitivity.

## Happy path — public list

```
listTestimonialsQuerySchema.parse(query)
  → buildTestimonialFilter (only provided flags)
  → Testimonial.find(filter).sort({ review_date: -1, createdAt: -1 }).skip.limit
  → countDocuments(same filter)
  → map toTestimonialListItem
```

## Skip / fail

| Condition | Result |
|-----------|--------|
| Invalid `source` / pagination / rating / customer id | Zod 400 at the route |
| Admin detail unknown id | 404 `Testimonial not found` |
| Omitted `published` | Unpublished rows are included (public site must send `published=true` if it wants only live copy) |
| No write route | Changing publish/feature or adding reviews is ops/script work |

## Model + ingest helpers

`TESTIMONIAL_SOURCES` in `src/config/domain/constants.ts` is `["BBB"]`. New sources need that enum, the Zod enums, and ingest.

| Field | Notes |
|-------|-------|
| `source` | Enum; default `BBB` |
| `reviewer_name` / `normalized_reviewer_name` | Display + lowercase-trim helper |
| `review_date` | Required `Date` |
| `rating` | 1–5 |
| `review_text` | Required |
| `business_response` | Optional `{ responded_at, text }` or null |
| `content_fingerprint` | Required; unique with `source` |
| `published` | Default `true` |
| `featured` | Default `false` |
| `customer` | Optional ObjectId |
| `source_company` | Optional; admin-only in list DTO |

**Unique index:** `{ source, content_fingerprint }`. **List index:** `{ source, published, review_date }`.

Helpers (`testimonial.helpers.ts`; not used by `listTestimonials`):

| Helper | Purpose |
|--------|---------|
| `normalizeReviewerName` | `trim().toLowerCase()` |
| `parseReviewDate` | Strict `YYYY-MM-DD` → UTC midnight; throws otherwise |
| `buildContentFingerprint` | SHA-256 of `source\|normalized_reviewer_name\|YYYY-MM-DD\|review_text.trim()` |
| `hasBbbRedaction` | Word-boundary `REMOVED` or `REMOVE` (BBB PII tokens) |

Ingest (outside this service): normalize name → parse date → fingerprint → upsert on `(source, content_fingerprint)`.

## Invariants

- List and admin endpoints are read-only. Do not add public CRUD without an explicit product path.
- Do not expose fingerprint / normalized name on the public DTO without an explicit product reason.
- Website filters belong in the query (`published=true`); this service does not force them.

## Related modules

- Model: `src/models/Testimonial.ts`
- Validation: `src/validation/v1/testimonials.validation.ts`
- Barrel: `src/services/testimonials/index.ts`
- Tests: `src/services/testimonials/testimonial.service.test.ts`, `testimonial.helpers.test.ts`
