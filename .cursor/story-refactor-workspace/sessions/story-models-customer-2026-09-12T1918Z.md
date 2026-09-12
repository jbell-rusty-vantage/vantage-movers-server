# Session story-models-customer-2026-09-12T1918Z

- Date (UTC): 2026-09-12T1918Z
- Service / module: `models` / `Customer.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 343
- Current service / next module (TRAVERSAL): `models` (in-progress) / `Customer.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-customer.md` (`src/models/Customer.ts`)
- operations named: Hold the Customer as the System of Record row; Keep phone / folded name / email browse-indexed and never unique; Register inverse virtuals for Bookings, Cancellations, and Testimonials
- remaining in this service: `Agent.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `Agent.ts`

## Messages posted

- 2026-09-12T1918Z next

## Ideas parked

- none (do not invent `getCustomerModel` in this pass; leftover booking-time upsert, leftover recon, leftover admin non-historical scope, and leftover historical-consolidation validate already import default `Customer`)

## Contradictions

- Knowledge says Customer virtuals populate from admin detail; leftover admin queries Booking / Cancellation collections by `{ customer: id }`
- Live Customer does not set `autoIndex: false`; Form / Call / Booking / Cancellation do
- Live Customer requires `full_name` and has a `testimonials` virtual; leftover historical Customer does neither
- Hand-write does not stamp `normalized_name`; booking-time upsert does
- Phone / folded name / email are not unique; leftover booking-time upsert elects the match
- Form / Call have selected-database getters; Customer writes ask default `Customer`
- knowledge Service is `customer.md` (hand-write + booking-time upsert); this file is the Mongo row
