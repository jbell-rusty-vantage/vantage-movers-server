# Session story-models-testimonial-2026-09-13T0713Z

- Date (UTC): 2026-09-13T0713Z
- Service / module: `models` / `Testimonial.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 355
- Current service / next module (TRAVERSAL): `models` (in-progress) / `Testimonial.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-testimonial.md` (`src/models/Testimonial.ts`)
- operations named: Hold the Testimonial as the curated review row; Keep one review per source plus content fingerprint and index published browse plus folded reviewer plus customer without uniqueness; Bind the default Mongo connection
- remaining in this service: `schemaHelpers.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `schemaHelpers.ts`

## Messages posted

- 2026-09-13T0713Z next

## Ideas parked

- none (do not stamp leftover fingerprint or leftover folded reviewer on validate; do not invent `getTestimonialModel` so review matches Form; do not delete the default `Testimonial` export so review matches evidence; do not copy Booking autoIndex-false without a migration; do not copy leftover `sourceCompanyField` onto optional `source_company`; do not add `{ published: true }` onto leftover public find; do not invent absent ops ingest; do not copy this unique source-plus-fingerprint onto leftover next `schemaHelpers.ts` without reading it)

## Contradictions

- Schema unique is `{ source, content_fingerprint }`; helpers stamp the hash; no ingest script in this checkout
- `published` defaults `true`; leftover list omitting `published` includes unpublished
- Knowledge names two compounds; schema also field-indexes five paths; `featured` is filterable and not indexed
- Optional `source_company` is not leftover `sourceCompanyField`
- Overview does not count this collection; historical-consolidation does not validate it
- There is no `historical/Testimonial.ts`
- There is no `getTestimonialModel`
- Leftover next `schemaHelpers.ts` leftover-exports Lead field catalog — do not copy this desk onto it without reading it
