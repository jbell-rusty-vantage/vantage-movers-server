# Session story-bookings-leadless-booking-2026-08-25T1113Z

- Date (UTC): 2026-08-25T11:13Z
- Service / module: `bookings` / `leadlessBooking.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (new PR; #18 already merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 1 / 1 / 36
- Recommendations on disk: 15 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, `leads-source-lead-lookup.md`, `leads-call-lead-source-match.md`, `leads-lead-source-compatibility.md`, `bookings-booked-lead.md`, `bookings-booked-lead-from-source.md`, `bookings-referral-booking.md`)
- Current service / next module (TRAVERSAL): `bookings` (in-progress) / `leadlessBooking.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/bookings-leadless-booking.md`
- operations named: Book a Leadless Job (assign Source / fence BR / refuse raw job_no / prepare agents+merchant / customer only if named / write no-Lead Leadless / optional BR recon case / Master Booked sheets; leftover body flag vs command provenance)
- remaining in this service: `bookingMirror.service.ts`, `bookingSourceResolver.ts`, `bookingIdentity.ts`

## Stock at end

- Visited / in-progress / unvisited: 1 / 1 / 36
- Current service / next module: `bookings` / `bookingMirror.service.ts`

## Messages posted

- 2026-08-25T1113Z next-run

## Ideas parked

- none

## Contradictions

- Leadless BR case: leftover public honors body `ingestion_source`; command stamps from `external_sheet_ingestion` provenance and HTTP `vantage_admin` drops the body flag. Knowledge names leftover `createLeadlessBooking` as the HTTP path.
