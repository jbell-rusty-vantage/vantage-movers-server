# Session story-bookings-booking-source-resolver-2026-08-25T1310Z

- Date (UTC): 2026-08-25T13:10Z
- Service / module: `bookings` / `bookingSourceResolver.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/21

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 1 / 1 / 36
- Recommendations on disk: 17 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, `leads-source-lead-lookup.md`, `leads-call-lead-source-match.md`, `leads-lead-source-compatibility.md`, `bookings-booked-lead.md`, `bookings-booked-lead-from-source.md`, `bookings-referral-booking.md`, `bookings-leadless-booking.md`, `bookings-booking-mirror.md`)
- Current service / next module (TRAVERSAL): `bookings` (in-progress) / `bookingSourceResolver.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/bookings-booking-source-resolver.md`
- operations named: Find the Lead this booking names (Form id / Call raw job 409 / phone write / invent Unmatched Call) / Read the company the Booking will persist from the Lead (override unused) / Correct the Form Lead company if Booking source maps differently (config aliases, not Registry)
- remaining in this service: `bookingIdentity.ts`

## Stock at end

- Visited / in-progress / unvisited: 1 / 1 / 36
- Current service / next module: `bookings` / `bookingIdentity.ts`

## Messages posted

- 2026-08-25T1310Z next-run

## Ideas parked

- none

## Contradictions

- `effectiveBookingSourceCompany` JSDoc vs cast; from-source never passes override; Form company correction is `resolveSourceCompany`; finder writes commit before Book This Lead with no session. See CONTRADICTIONS.md.
