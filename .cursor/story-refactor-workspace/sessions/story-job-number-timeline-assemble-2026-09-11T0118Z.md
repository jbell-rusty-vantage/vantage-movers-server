# Session story-job-number-timeline-assemble-2026-09-11T0118Z

- Date (UTC): 2026-09-11
- Service / module: `jobNumberTimeline` / `assemble.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 40 / 0 / 2
- Recommendations on disk: 301 (through `extension-users-extension-users.md`)
- Current service / next module (TRAVERSAL): `jobNumberTimeline` (unvisited) / enumerate first

## This pass

- opened new service?: yes — 18 service modules enumerated (10 skipped, 1 recommended, 7 remain)
- path or skip: recommended → `recommendations/job-number-timeline-assemble.md`
- operations named: refuse a Job Number that does not normalize; refuse a first-hop miss including a lead-only row or an orphan cancellation without a snapshot; filter out a company or granularity that does not own this job; assemble the owner-facing chain from the loaded rows (source received only from a loaded receipt, latest Decision attempt only, Sheet Sync by entity id, snapshot-only Cancellation without inventing a Booking)
- remaining in this service: `projector.ts`, `clocks.ts`, `evidence.ts`, `outcome.ts`, `attention.ts`, `mongo-evidence-loader.ts`, `recent-official-bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 40 / 1 / 1
- Current service / next module: `jobNumberTimeline` (in-progress) / `projector.ts`

## Messages posted

- 2026-09-11T0118Z next

## Ideas parked

- `assemble` already **asks** `projectEnhancedPage` on `ok`; the export name says v1, the return is v2
- Module company/granularity mismatch returns empty `scopes` before assemble; assemble’s miss returns resolved scopes
- Discrepancies keep the first hop found and never emit an event
- `proofShape` infers `wordpress_born` when create predates acquire
- `hasSuccessfulLeadMessage` is a CLI discover leak
- `module.ts` skipped as thin facade; HTTP/CLI **seam** stays `createJobNumberTimelineModule({ loader }).read`
- Do not open `tariff` or Wave B while this checklist has unchecked modules
- Disk also has unlisted `dailyOperations`; do not open it while Wave A rows 41–42 remain

## Contradictions

- Module `filtered_out` (company + granularity not in company list) returns empty `scopes`; assemble `filtered_out` returns resolved scopes
- Knowledge + tests lock snapshot-only Cancellation / WordPress `source_received` through `module.read`, not `assemble.test.ts`
- Knowledge links Job Number / Form Lead / Call Lead / Booking / Sheet Sync / Granot Observation Receipt / WordPress Form Submission Receipt; this checkout’s `CONTEXT.md` does not define them; `docs/adr/` is absent
