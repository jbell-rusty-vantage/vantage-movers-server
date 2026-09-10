# Session story-testimonials-testimonial-helpers-2026-09-10T1525Z

- Date (UTC): 2026-09-10
- Service / module: `testimonials` / `testimonial.helpers.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 34 / 1 / 3
- Recommendations on disk: 293 (through `testimonials-testimonial.md`)
- Current service / next module (TRAVERSAL): `testimonials` (in-progress) / `testimonial.helpers.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/testimonials-testimonial-helpers.md`
- operations named: notice this BBB review has redacted PII; fold the reviewer name for matching; read the review date as UTC midnight; stamp the content fingerprint so upsert can key on `(source, content_fingerprint)` — never upsert, never publish, never show the Main Site the curated reviews
- remaining in this service: none (`testimonials` visited)

## Stock at end

- Visited / in-progress / unvisited: 35 / 0 / 3
- Current service / next module: `movingCarriers` (unvisited — enumerate first)

## Messages posted

- 2026-09-10T1525Z next

## Ideas parked

- Wave A tour rows omit `conversations`, `extensionUsers`, `jobNumberTimeline`, `tariff` — enumerate after listed Wave A, do not jump an in-progress checklist

## Contradictions

- Knowledge says ops scripts ingest with these helpers; this checkout has no script import
- Redaction gate matches English `remove` / `removed` / `removal` (no trailing word boundary; `REMOVEDdelivered` is locked true)
- `2026-02-31` rolls to `2026-03-03T00:00:00.000Z` and does not throw
- Fingerprint does not fold the name or parse the date; a 4pm Eastern `Date` slices to the next UTC day
- `source` is inside the hex and again on the unique index
- Only `hasBbbRedaction` is tested
- Sibling list does not import this file
- This checkout’s `CONTEXT.md` does not define Testimonial; `docs/adr/` is absent
