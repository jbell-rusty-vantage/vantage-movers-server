# Session story-bookings-referral-booking-2026-08-25T1014Z

- Date (UTC): 2026-08-25T10:14Z
- Service / module: `bookings` / `referralBooking.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/18

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 1 / 1 / 36
- Recommendations on disk: 14 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, `leads-source-lead-lookup.md`, `leads-call-lead-source-match.md`, `leads-lead-source-compatibility.md`, `bookings-booked-lead.md`, `bookings-booked-lead-from-source.md`)
- Current service / next module (TRAVERSAL): `bookings` (in-progress) / `referralBooking.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/bookings-referral-booking.md`
- operations named: Book a Referral (refuse raw job_no / prepare agents+merchant / customer from typed contact / write no-Lead Referral / Master Booked sheets; public vs begin/complete)
- remaining in this service: `leadlessBooking.service.ts`, `bookingMirror.service.ts`, `bookingSourceResolver.ts`, `bookingIdentity.ts`

## Stock at end

- Visited / in-progress / unvisited: 1 / 1 / 36
- Current service / next module: `bookings` / `leadlessBooking.service.ts`

## Messages posted

- 2026-08-25T1014Z next-run

## Ideas parked

- none

## Contradictions

- none (knowledge already records raw `job_no` 409 vs normalized unique index; leftover public clock is `new Date()` vs command `tx.now`)
