# Session story-models-wordpress-form-submission-receipt-2026-09-13T1013Z

- Date (UTC): 2026-09-13T1013Z
- Service / module: `models` / `WordpressFormSubmissionReceipt.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 357
- Current service / next module (TRAVERSAL): `models` (in-progress) / `WordpressFormSubmissionReceipt.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-wordpress-form-submission-receipt.md` (`src/models/WordpressFormSubmissionReceipt.ts`)
- operations named: Hold the WordPress form-submission ingress receipt; Refuse mutation of ingress identity after insert and refuse nulling the write-once Form-Lead pointer; Bind the selected Mongo database and declare the named unique submission-key plus partial lead-ref indexes the migration applies
- remaining in this service: `GranotObservationReceipt.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotObservationReceipt.ts`

## Messages posted

- 2026-09-13T1013Z next

## Ideas parked

- none (do not infer submission_key from lid / phone / Tracking Reference; do not flip autoIndex true so boot creates uniqueness; do not apply indexes on vantagemovers; do not unique-index lead_ref.id; do not add a second form_path enum value; do not add runValidators from this rename; do not merge into GranotObservationReceipt; do not delete the getter so receipt matches Testimonial; do not copy sheet_sync or sourceCompanyField here)

## Contradictions

- Schema write-once is null-only; store attach filters null-or-same-id
- pre("validate") does not run on findOneAndUpdate without runValidators; live attach omits that option
- Unique submission_key is declared here but applied only by the report-first migration on testvantagemovers; autoIndex is false
- Job Timeline hops the collection by hardcoded string, not WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION, and does not import this model
- Default export has no direct caller except getter same-db return
- No WordpressFormSubmissionReceipt.test.ts
- Leftover next GranotObservationReceipt.ts is a different envelope — do not copy this ingress catalog onto it without reading it
