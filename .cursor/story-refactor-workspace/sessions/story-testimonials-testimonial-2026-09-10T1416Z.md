# Session story-testimonials-testimonial-2026-09-10T1416Z

- Date (UTC): 2026-09-10
- Service / module: `testimonials` / `testimonial.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 34 / 0 / 4
- Recommendations on disk: 292 (through `historical-consolidation-mongo-values.md`)
- Current service / next module (TRAVERSAL): `testimonials` (unvisited) / enumerate first

## This pass

- opened new service?: yes — modules enumerated (`testimonial.service.ts`, `testimonial.helpers.ts`, `index.ts` barrel skip)
- path or skip: recommended → `recommendations/testimonials-testimonial.md`
- operations named: show the Main Site the curated reviews they asked for (omitted `published` includes unpublished; hide fingerprint / customer / source company); show the owner the same reviews with the Customer attached; open one review for the owner or 404; hand the owner the sorted reviewer-name catalog — never publish a review, never fingerprint ingest, never force `published=true`
- remaining in this service: `testimonial.helpers.ts`

## Stock at end

- Visited / in-progress / unvisited: 34 / 1 / 3
- Current service / next module: `testimonials` (in-progress) / `testimonial.helpers.ts`

## Messages posted

- 2026-09-10T1416Z next

## Ideas parked

- Wave A tour rows omit `conversations`, `extensionUsers`, `jobNumberTimeline`, `tariff` — enumerate after listed Wave A, do not jump an in-progress checklist

## Contradictions

- Empty public query is `find({})`; unpublished rows stay in unless the site sent `published=true`
- Public card hides `content_fingerprint`, `normalized_reviewer_name`, `source_company`, `customer`, timestamps
- `published` / `featured` on the card are `=== true`
- `business_response` needs both `responded_at` and `text` or it is `null`
- Filter builders are exported and tested as the surface; runtime callers are the two lists
- Owner `q` plus exact `reviewer_name` ANDs `$or` with exact display name
- Unpopulated Customer paints id + empty contact strings, not 404
- `getAdminTestimonial` has no test
- `has_next_page` is `skip + docs.length < total`
- Owner sort flips `createdAt` with `review_date`
- Sibling helpers are not imported; ingest is ops/script, not a route
- `v1.service.ts` and `adminBrowse.service.ts` do not import this file
- This checkout’s `CONTEXT.md` does not define Testimonial; `docs/adr/` is absent
