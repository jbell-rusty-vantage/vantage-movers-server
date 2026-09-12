# Session story-models-cancelled-lead-2026-09-12T1813Z

- Date (UTC): 2026-09-12T1813Z
- Service / module: `models` / `CancelledLead.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 342
- Current service / next module (TRAVERSAL): `models` (in-progress) / `CancelledLead.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-cancelled-lead.md` (`src/models/CancelledLead.ts`)
- operations named: Hold the Cancellation as the System of Record row; Freeze the four Booking-correlation snapshots after insert; Keep a named non-unique Job snapshot browse index
- remaining in this service: `Customer.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `Customer.ts`

## Messages posted

- 2026-09-12T1813Z next

## Ideas parked

- none (do not invent `getCancelledLeadModel` in this pass; leftover official write and EntityChange already import default `CancelledLead`)

## Contradictions

- Form / Call have selected-database getters; Cancellation writes, leftover official write, and leftover EntityChange ask default `CancelledLead`
- Booking unique partial Job is one official Booking per folded Job; this snapshot catalog stays non-unique
- one Cancellation per Booking is a service find (`booking.cancelled` / `find({ booked_lead })`), not a unique schema index
- stamp lives on leftover `cancellationCorrelationSnapshots.ts`; this file only freezes after insert
- display `job_no` is not `job_no_snapshot`
- Cancellation has no optimistic concurrency; Form / Call / Booking turn it on
- leftover `pnpm migration:granot-lifecycle:indexes` does not apply this snapshot catalog; leftover `pnpm migration:cancellation-correlation-snapshots` does
- knowledge Service is `cancelled-lead.md` (cancel-this-Booking); this file is the Mongo row
