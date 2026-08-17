**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/testimonials/testimonial.service.ts`  
**Domain terms used:** Main Site (marketing consumer)

# Testimonial Service

**System of Record:** MongoDB `testimonials` collection — curated review content for the public marketing site (**Main Site** consumer).

**Role:** Read-only list API for published reviews. **No create/update/delete** in this service; documents are loaded externally (scripts/ops) using shared helpers.

## Consumer

`vantage-movers-clients` fetches via `GET /api/v1/testimonials` with `published=true`, optional `featured`, and `limit` (default 24). Uses `x-api-secret`; returns `[]` on failure so the site can fall back to static copy. Next.js revalidate: 300s.

## API

| Route | Handler |
|-------|---------|
| `GET /api/v1/testimonials` | `listTestimonials` |

Requires `x-api-secret` (all `/api/v1` routes).

### Query (`listTestimonialsQuerySchema`)

| Param | Default | Effect |
|-------|---------|--------|
| `page` | `1` | 1-based |
| `limit` | `20` | Max 100 |
| `source` | — | Filter `Testimonial.source` enum |
| `published` | — | Boolean filter when provided |
| `featured` | — | Boolean filter when provided |

Omitted filters are not applied (`buildTestimonialFilter` only sets defined flags).

### List behavior

- Sort: `review_date` desc, then `createdAt` desc.
- Returns `{ items, page, limit, total, has_next_page }`.
- Maps Mongo docs → `TestimonialListItem` (public projection).

### Response projection (`TestimonialListItem`)

Exposed: `id`, `source`, `reviewer_name`, `review_date`, `rating`, `review_text`, `business_response`, `published`, `featured`.

**Not exposed** in list API: `content_fingerprint`, `normalized_reviewer_name`, `source_company`, timestamps.

## Model invariants (`Testimonial`)

| Field | Notes |
|-------|-------|
| `source` | Enum `TESTIMONIAL_SOURCES` (currently `BBB` only) |
| `reviewer_name` / `normalized_reviewer_name` | Display + dedupe helper field |
| `review_date` | Required `Date` |
| `rating` | 1–5 |
| `review_text` | Required body |
| `business_response` | Optional `{ responded_at, text }` or null |
| `content_fingerprint` | Required; part of unique key |
| `published` | Default `true`; website requests `published=true` |
| `featured` | Default `false`; optional homepage filter |

**Unique index:** `{ source, content_fingerprint }` — ingest must compute fingerprint before insert.

**List index:** `{ source, published, review_date }` for filtered landing-page queries.

## Ingest helpers (`testimonial.helpers.ts`)

Exported for ops/scripts; not used by `listTestimonials`:

| Helper | Purpose |
|--------|---------|
| `normalizeReviewerName` | `trim().toLowerCase()` |
| `parseReviewDate` | Strict `YYYY-MM-DD` → UTC midnight `Date` |
| `buildContentFingerprint` | SHA-256 of `source\|normalized_reviewer_name\|YYYY-MM-DD\|review_text` |

Ingest flow (outside this service): normalize name → parse date → fingerprint → upsert/insert with unique `(source, content_fingerprint)`.

## Invariants

- List endpoint is read-only; changing publish/feature flags or adding reviews is a data/ops concern, not route CRUD.
- Website should filter `published=true`; unpublished rows remain in Mongo for staging.
- New sources require updating `TESTIMONIAL_SOURCES` in `config/domain/constants.ts` and validation enum.
- Do not expose internal dedupe fields in the public list DTO without an explicit product reason.

## Related modules

- Model: `models/Testimonial.ts`
- Validation: `validation/v1/testimonials.validation.ts`
- Barrel exports helpers: `testimonials/index.ts`
- Tests: `testimonials/testimonial.service.test.ts`
- Website client: `vantage-movers-clients/src/lib/vantage/server.ts` (`getTestimonials`)
