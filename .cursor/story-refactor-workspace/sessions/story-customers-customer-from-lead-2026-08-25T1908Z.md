# Session story-customers-customer-from-lead-2026-08-25T1908Z

- Date (UTC): 2026-08-25T19:08Z
- Service / module: `customers` / `customerFromLead.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (opening — PR #26 already merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 3 / 1 / 34
- Recommendations on disk: 23 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, `customers-customer.md`)
- Current service / next module (TRAVERSAL): `customers` (in-progress) / `customerFromLead.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/customers-customer-from-lead.md`
- operations named: Remember the Customer this Lead names (no name → undefined; phone as typed, else `normalized_name`; retitles on phone match) / Remember the Customer this Booking contact names (form name; phone/email form then Lead; blank name → undefined even if Lead has a name)
- remaining in this service: none — `customers` visited

## Stock at end

- Visited / in-progress / unvisited: 4 / 0 / 34
- Current service / next module: `agents` (unvisited) / enumerate, then first story-worthy module

## Messages posted

- 2026-08-25T1908Z next-run

## Ideas parked

- none

## Contradictions

- Hand-write vs upsert `normalized_name` already recorded. Name-only remember then same person with a phone is a second row (phone key misses). Do not silently also match by name when a phone is present. See CONTRADICTIONS.md (existing Customer glossary + hand-write gap).
