# Session story-models-granot-booking-discrepancy-2026-09-13T1817Z

- Date (UTC): 2026-09-13T1817Z
- Service / module: `models` / `GranotBookingDiscrepancy.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 365
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GranotBookingDiscrepancy.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-booking-discrepancy.md](../recommendations/models-granot-booking-discrepancy.md)
- operations named: hold the Booking identity-conflict desk on `granot_booking_discrepancies` (five `booked_*` reasons only; not a Booking case and not a Booking); bind the selected Mongo database and declare the two named indexes with partial unique open `{ normalized_job_no, discrepancy_kind, reason_fingerprint }` plus state/newest-evidence queue. No sequence unique. Fingerprint and mongoose guards stay on leftover persist / leftover later factory. Live persist still opens this collection for Booked identity fights.
- remaining in this service: `GranotReleaseDiscrepancy.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotReleaseDiscrepancy.ts`

## Messages posted

- 2026-09-13T1817Z next

## Ideas parked

- none

## Contradictions

- Two named indexes; Booking case has six; Release case has five
- Unique is open fingerprint, not `{ normalized_job_no, action_kind }`
- No sequence unique; resolved + same fingerprint may insert a new row
- Five Booking reasons here; `types.ts` also unions the four Release reasons
- Fingerprint hashed on leftover persist, stored here as 64 hex
- Unique is exact Job while open; Job Timeline hops prefix-equivalent Jobs
- schema-and-crud names the Booking case and omits this collection
- No mongoose delete hook; Decision / activation clock refuse delete
- Hooks live on leftover later `granotDiscrepancyModel.ts`; this unit test only refuses Release reasons
- Leftover next GranotReleaseDiscrepancy.ts is a different row — do not copy this Booking-desk catalog onto it without reading it
