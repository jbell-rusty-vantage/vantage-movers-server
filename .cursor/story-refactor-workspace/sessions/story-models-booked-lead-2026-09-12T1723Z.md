# Session story-models-booked-lead-2026-09-12T1723Z

- Date (UTC): 2026-09-12T1723Z
- Service / module: `models` / `BookedLead.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 341
- Current service / next module (TRAVERSAL): `models` (in-progress) / `BookedLead.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-booked-lead.md` (`src/models/BookedLead.ts`)
- operations named: Hold the Booking as the System of Record row; Fold the Job Number before validate and require a Lead unless Referral or Leadless; Keep one official Booking per normalized Job and one employee submission per employee origin
- remaining in this service: `CancelledLead.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `CancelledLead.ts`

## Messages posted

- 2026-09-12T1723Z next

## Ideas parked

- none (do not invent `getBookedLeadModel` in this pass; leftover Granot identity and EntityChange already import default `BookedLead`)

## Contradictions

- Form / Call have selected-database getters; Booking writes, leftover Granot identity, and leftover EntityChange ask default `BookedLead`
- unique partial Job is the official one-Booking-per-Job contract; Form / Call named S08 catalogs stay non-unique
- one Booking per Lead is a service `findOne`, not a unique schema index
- Referral / Leadless 409 is raw `job_no`; this unique is the folded last line
- `employee_submission_id_unique` is schema-declared and not in the lifecycle unique array
- unnamed validate hook folds Job Number and requires a Lead unless Referral / Leadless
- knowledge Service is `bookings.md` (book-this-Lead); this file is the Mongo row
