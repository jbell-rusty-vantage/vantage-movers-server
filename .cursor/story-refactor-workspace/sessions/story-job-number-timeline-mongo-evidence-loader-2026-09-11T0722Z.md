# Session story-job-number-timeline-mongo-evidence-loader-2026-09-11T0722Z

- Date (UTC): 2026-09-11
- Service / module: `jobNumberTimeline` / `mongo-evidence-loader.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 40 / 1 / 1
- Recommendations on disk: 307 (through `job-number-timeline-attention.md`)
- Current service / next module (TRAVERSAL): `jobNumberTimeline` (in-progress) / `mongo-evidence-loader.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/job-number-timeline-mongo-evidence-loader.md`
- operations named: name this company’s granularity ids so a typed company filter can refuse before the job hop; hop the first facts that can found this Job Number (observations on `identity.normalized_job_no`, record links, bookings, booking/release cases, discrepancies, plus the account RingCentral cursor); hop Decisions and Granot receipts those observations point at with a safe projection; hop Cancellations by live Booking and by indexed snapshot then merge so a snapshot-only cancel is a first-hop survivor; resolve the Lead (active record link → Booking → applied/created Decision) then hop Lead-scoped texts, WordPress receipts by `lead_ref.id`, and processed calls; hop official-fact EntityChanges and Sheet Sync by entity id never Job Number
- remaining in this service: `recent-official-bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 40 / 1 / 1
- Current service / next module: `jobNumberTimeline` (in-progress) / `recent-official-bookings.ts`

## Messages posted

- 2026-09-11T0722Z next

## Ideas parked

- Tests lock snapshot-only cancel / WordPress receipt / Sheet-by-entity-id through the memory adapter, not this interface
- Lead resolve is copied with assemble — same order, two depths (hop needs the id; assemble needs the row)
- `observationJobFilter` should ask `remapNormalizedJobFilter`
- Knowledge “safe projections only” is not true on every hop; ingested contact snapshot is kept for the origin card
- Orphan-only cancel cannot be loaded here; do not collection-scan `cancelled_leads`
- Leftover lifecycle-assurance asks `loadJobNumberTimelineRows` then assemble and skips redact
- Account cursor is always hopped; `RINGCENTRAL_CURSOR_BOUNDED` stays on attention
- Do not open `tariff` or Wave B while this checklist has unchecked modules
- Disk also has unlisted `dailyOperations`; do not open it while Wave A rows 41–42 remain

## Contradictions

- Module proofs are not the Mongo-loader interface
- Safe-projection sentence vs full-document finds
- Lead-resolve duplication with assemble
- Knowledge links Job Number / Form Lead / Call Lead / Booking / Cancellation / Sheet Sync / Granot Observation Receipt / WordPress Form Submission Receipt; this checkout’s `CONTEXT.md` does not define them; `docs/adr/` and `docs/job-number-timeline/` are absent
