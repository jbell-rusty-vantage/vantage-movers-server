# Session story-bookings-booking-mirror-2026-08-25T1230Z

- Date (UTC): 2026-08-25T12:30Z
- Service / module: `bookings` / `bookingMirror.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/20

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 1 / 1 / 36
- Recommendations on disk: 16 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, `leads-source-lead-lookup.md`, `leads-call-lead-source-match.md`, `leads-lead-source-compatibility.md`, `bookings-booked-lead.md`, `bookings-booked-lead-from-source.md`, `bookings-referral-booking.md`, `bookings-leadless-booking.md`)
- Current service / next module (TRAVERSAL): `bookings` (in-progress) / `bookingMirror.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/bookings-booking-mirror.md`
- operations named: Stamp this Lead booked / Claim this Lead before someone else books it / Tell the Booking what the Lead just became / Take the Booking off the Lead (preserve-CPL OR vs Source Company; claim vs stamp; queued `syncAfterClear`)
- remaining in this service: `bookingSourceResolver.ts`, `bookingIdentity.ts`

## Stock at end

- Visited / in-progress / unvisited: 1 / 1 / 36
- Current service / next module: `bookings` / `bookingSourceResolver.ts`

## Messages posted

- 2026-08-25T1230Z next-run

## Ideas parked

- none

## Contradictions

- Knowledge “preserveExistingCpl skips CPL” vs `sourceCompany || !preserveExistingCpl`; employee submit claims only, attach claims then stamps with preserve. See CONTRADICTIONS.md.
