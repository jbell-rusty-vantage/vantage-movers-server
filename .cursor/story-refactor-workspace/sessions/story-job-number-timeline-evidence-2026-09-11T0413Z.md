# Session story-job-number-timeline-evidence-2026-09-11T0413Z

- Date (UTC): 2026-09-11
- Service / module: `jobNumberTimeline` / `evidence.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 40 / 1 / 1
- Recommendations on disk: 304 (through `job-number-timeline-clocks.md`)
- Current service / next module (TRAVERSAL): `jobNumberTimeline` (in-progress) / `evidence.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/job-number-timeline-evidence.md`
- operations named: name the stage / how strong the evidence is without inferring / the owner-readable summary (grouped lead updates from Granot) / completed-active-pending-failed-informational; say how this event correlates to this Job Number (WordPress walk-back, snapshot Cancellation) and list safe refs; mask the ingested form snapshot for the origin card
- remaining in this service: `outcome.ts`, `attention.ts`, `mongo-evidence-loader.ts`, `recent-official-bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 40 / 1 / 1
- Current service / next module: `jobNumberTimeline` (in-progress) / `outcome.ts`

## Messages posted

- 2026-09-11T0413Z next

## Ideas parked

- `v2.test.ts` locks no-`inferred` and snapshot `direct_job_number` through `module.read`, not this interface
- `assemble.test.ts` locks `form_snapshot` through assemble and lead-update headline, not `summary`
- `limitation` / `limited` / `equivalent_job_number` / `entity_change_reference` are typed and unused
- RingCentral ingress is `external_acknowledgement`; WordPress / Granot ingress stay `recorded_evidence`
- Walk-back is WordPress-born lead created only
- Delivery zip is `destination_zip`
- Do not open `tariff` or Wave B while this checklist has unchecked modules
- Disk also has unlisted `dailyOperations`; do not open it while Wave A rows 41–42 remain

## Contradictions

- Module / assemble proofs are not the evidence **interface**
- Unused union members vs returned labels
- Knowledge links Job Number / Form Lead / Call Lead / Booking / Sheet Sync / Granot Observation Receipt / WordPress Form Submission Receipt; this checkout’s `CONTEXT.md` does not define them; `docs/adr/` and `docs/job-number-timeline/` are absent
